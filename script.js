/* ====================================================================
   COST SAVING DASHBOARD — APP LOGIC
   Supabase-backed version. All data reads/writes go to Supabase.
   Authentication is handled by auth.js (Supabase Auth).
   ==================================================================== */

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const FINANCIAL_YEARS = ['FY 2025-26', 'FY 2026-27', 'Future Planned'];
const STATUSES = ['Completed', 'In Progress', 'Delayed'];

/* ---------------- Formatting helpers ---------------- */
function formatINR(val){
  if (val === null || val === undefined || isNaN(val)) return '₹ 0.00';
  return new Intl.NumberFormat('en-IN', { style:'currency', currency:'INR', minimumFractionDigits:2, maximumFractionDigits:2 }).format(val);
}
function formatPercent(val){
  if (val === null || val === undefined || isNaN(val)) return '0.0%';
  return `${val.toFixed(1)}%`;
}
function formatAbbreviatedINR(val){
  if (val === 0) return '₹ 0';
  const neg = val < 0;
  const abs = Math.abs(val);
  let out;
  if (abs >= 10000000) out = `${(abs/10000000).toFixed(2)} Cr`;
  else if (abs >= 100000) out = `${(abs/100000).toFixed(2)} L`;
  else if (abs >= 1000) out = `${(abs/1000).toFixed(1)} K`;
  else out = abs.toFixed(0);
  return `${neg ? '-' : ''}₹ ${out}`;
}
function escapeHtml(str){
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function downloadCsv(filename, headers, rows){
  let content = 'data:text/csv;charset=utf-8,\uFEFF';
  content += headers.join(',') + '\n';
  rows.forEach(r => { content += r.join(',') + '\n'; });
  const link = document.createElement('a');
  link.setAttribute('href', encodeURI(content));
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/* ====================================================================
   SUPABASE DATA LAYER
   Replaces the old localStorage-based readDatabase / writeDatabase.
   All functions are async and use window.Auth.supabaseClient.
   ==================================================================== */

/* Helper: map a Supabase task row (snake_case) → camelCase object */
function mapTask(t){
  return {
    id:                t.id,
    teamCode:          t.team_code,
    teamName:          t.team_name,
    member:            t.member,
    title:             t.title,
    description:       t.description   || '',
    month:             t.month,
    year:              t.year,
    fy:                t.fy,
    status:            t.status,
    costSaved:         Number(t.cost_saved)    || 0,
    targetSaving:      Number(t.target_saving) || 0,
    remarks:           t.remarks              || '',
    supportingDocName: t.supporting_doc_name  || '',
    createdAt:         t.created_at,
  };
}

/* Helper: map a Supabase team row (snake_case) → camelCase object */
function mapTeam(t){
  return {
    code:            t.code,
    name:            t.name,
    module:          t.module,
    leader:          t.leader,
    fy25Expenses:    Number(t.fy25_expenses)    || 0,
    targetReduction: Number(t.target_reduction) || 0,
    costSaved25_26:  Number(t.cost_saved_25_26) || 0,
    costSaved26_27:  Number(t.cost_saved_26_27) || 0,
  };
}

/* Load all teams and tasks from Supabase into STATE */
async function loadData(){
  const client = window.Auth.supabaseClient;

  const { data: teams, error: e1 } = await client.from('teams').select('*').order('code');
  const { data: tasks, error: e2 } = await client.from('tasks').select('*').order('created_at');

  if(e1){ console.error('Error loading teams:', e1); showToast('error','DB Error','Could not load teams from Supabase.'); return; }
  if(e2){ console.error('Error loading tasks:', e2); showToast('error','DB Error','Could not load tasks from Supabase.'); return; }

  STATE.teams = (teams || []).map(mapTeam);
  STATE.tasks = (tasks || []).map(mapTask);
}

/* Create a new task in Supabase */
async function apiCreateTask(payload){
  const client = window.Auth.supabaseClient;
  const team = STATE.teams.find(t => t.code === payload.teamCode);
  const costSaved = payload.status === 'Completed' ? Number(payload.costSaved) || 0 : 0;

  const row = {
    id:                  `task-${Date.now()}`,
    team_code:           payload.teamCode,
    team_name:           team ? team.name : 'Unknown Team',
    member:              payload.member            || 'Unassigned',
    title:               payload.title,
    description:         payload.description       || '',
    month:               payload.month             || 'January',
    year:                Number(payload.year)      || 2026,
    fy:                  payload.fy                || 'FY 2025-26',
    status:              payload.status            || 'In Progress',
    cost_saved:          costSaved,
    target_saving:       Number(payload.targetSaving) || 0,
    remarks:             payload.remarks           || '',
    supporting_doc_name: payload.supportingDocName || '',
  };

  const { data, error } = await client.from('tasks').insert(row).select().single();
  if(error){ console.error('Create task error:', error); showToast('error','Error','Could not save task. Please try again.'); return null; }
  return mapTask(data);
}

/* Update an existing task in Supabase */
async function apiUpdateTask(id, payload){
  const client = window.Auth.supabaseClient;
  const existing = STATE.tasks.find(t => t.id === id);
  if(!existing) return null;

  const status    = payload.status    !== undefined ? payload.status    : existing.status;
  const costSaved = status === 'Completed'
    ? (payload.costSaved !== undefined ? Number(payload.costSaved) : existing.costSaved)
    : 0;

  const team = payload.teamCode ? STATE.teams.find(t => t.code === payload.teamCode) : null;

  const updates = {
    team_code:           payload.teamCode          || existing.teamCode,
    team_name:           team ? team.name           : existing.teamName,
    member:              payload.member             || existing.member,
    title:               payload.title              || existing.title,
    description:         payload.description        ?? existing.description,
    month:               payload.month              || existing.month,
    year:                Number(payload.year        || existing.year),
    fy:                  payload.fy                 || existing.fy,
    status,
    cost_saved:          costSaved,
    target_saving:       Number(payload.targetSaving ?? existing.targetSaving),
    remarks:             payload.remarks            ?? existing.remarks,
    supporting_doc_name: payload.supportingDocName  ?? existing.supportingDocName,
  };

  const { data, error } = await client.from('tasks').update(updates).eq('id', id).select().single();
  if(error){ console.error('Update task error:', error); showToast('error','Error','Could not update task. Please try again.'); return null; }
  return mapTask(data);
}

/* Delete a task from Supabase */
async function apiDeleteTask(id){
  const { error } = await window.Auth.supabaseClient.from('tasks').delete().eq('id', id);
  if(error){ console.error('Delete task error:', error); showToast('error','Error','Could not delete task. Please try again.'); return false; }
  return true;
}

/* Reset: delete ALL tasks (keeps teams intact) */
async function apiResetDatabase(){
  const { error } = await window.Auth.supabaseClient.from('tasks').delete().neq('id','');
  if(error){ console.error('Reset error:', error); showToast('error','Error','Could not reset database.'); return; }
  await loadData();
}

/* ====================================================================
   APP STATE
   ==================================================================== */
const STATE = {
  teams: [],
  tasks: [],
  editingTaskId: null,
  activeView: 'dashboard',
  activeChartTab: 'financial',
  quickFilter: 'all',
  taskSearch: '',
  taskTeamFilter: 'All',
  taskMemberFilter: 'All',
  filters: {
    teamCode: 'All',
    fy: 'All',
    month: 'All',
    status: 'All',
    savingsMin: '',
    savingsMax: '',
  },
  tsFilters: { teamCode: 'All', month: 'All', fy: 'All' },
  charts: {},
};

/* ====================================================================
   FILTERING & STATS
   ==================================================================== */
function getFilteredTasks(){
  const f = STATE.filters;
  return STATE.tasks.filter(task => {
    if (f.teamCode !== 'All' && task.teamCode !== f.teamCode) return false;
    if (f.fy !== 'All' && task.fy !== f.fy) return false;
    if (f.month !== 'All' && task.month !== f.month) return false;
    if (f.status !== 'All' && task.status !== f.status) return false;
    if (f.savingsMin !== '' && task.costSaved < Number(f.savingsMin)) return false;
    if (f.savingsMax !== '' && task.costSaved > Number(f.savingsMax)) return false;
    return true;
  });
}

function getStats(filteredTasks){
  const targetTeams = STATE.filters.teamCode === 'All' ? STATE.teams : STATE.teams.filter(t => t.code === STATE.filters.teamCode);
  const totalTarget = targetTeams.reduce((s,t) => s + t.targetReduction, 0);
  const totalSaved = filteredTasks.filter(t => t.status === 'Completed').reduce((s,t) => s + t.costSaved, 0);
  const remainingRequired = Math.max(0, totalTarget - totalSaved);
  const achievementPercentage = totalTarget > 0 ? (totalSaved / totalTarget) * 100 : 0;
  const completedProjectsCount = filteredTasks.filter(t => t.status === 'Completed').length;
  const ongoingProjectsCount = filteredTasks.filter(t => t.status === 'In Progress').length;
  const delayedProjectsCount = filteredTasks.filter(t => t.status === 'Delayed').length;
  const savingsByFY = {
    'FY 2025-26': filteredTasks.filter(t => t.fy === 'FY 2025-26' && t.status === 'Completed').reduce((s,t) => s + t.costSaved, 0),
    'FY 2026-27': filteredTasks.filter(t => t.fy === 'FY 2026-27' && t.status === 'Completed').reduce((s,t) => s + t.costSaved, 0),
    'Future Planned': filteredTasks.filter(t => t.fy === 'Future Planned' && t.status === 'Completed').reduce((s,t) => s + t.costSaved, 0),
  };
  return { totalTarget, totalSaved, remainingRequired, achievementPercentage, completedProjectsCount, ongoingProjectsCount, delayedProjectsCount, savingsByFY };
}

function getTeamRows(filteredTasks){
  return STATE.teams.map(team => {
    const teamTasks = filteredTasks.filter(t => t.teamCode === team.code);
    const teamAllTasks = STATE.tasks.filter(t => t.teamCode === team.code);
    const actualSaved = teamTasks.filter(t => t.status === 'Completed').reduce((s,t) => s + t.costSaved, 0);
    const target = team.targetReduction;
    const achievementPercent = target > 0 ? (actualSaved / target) * 100 : 0;
    const totalProjects = teamAllTasks.length;
    const completedProjects = teamAllTasks.filter(t => t.status === 'Completed').length;
    const ongoingProjects = teamAllTasks.filter(t => t.status === 'In Progress').length;
    const delayedProjects = teamAllTasks.filter(t => t.status === 'Delayed').length;

    let statusKey = 'plan', statusLabel = 'Plan Stage';
    if (totalProjects > 0){
      if (achievementPercent >= 90){ statusKey='exceptional'; statusLabel='Exceptional'; }
      else if (achievementPercent >= 60){ statusKey='ontrack'; statusLabel='On Track'; }
      else if (achievementPercent >= 30){ statusKey='inprogress'; statusLabel='In Progress'; }
      else { statusKey='needspeed'; statusLabel='Needs Speed'; }
    }
    return { ...team, actualSaved, target, achievementPercent, totalProjects, completedProjects, ongoingProjects, delayedProjects, statusKey, statusLabel };
  });
}

/* ====================================================================
   RENDER: FILTER DROPDOWNS
   ==================================================================== */
function populateStaticDropdowns(){
  const teamOptionsHtml = (includeAll) =>
    (includeAll ? '<option value="All">All Teams</option>' : '') +
    STATE.teams.map(t => `<option value="${t.code}">${escapeHtml(t.name)} (${t.code})</option>`).join('');

  document.getElementById('filterTeam').innerHTML = teamOptionsHtml(true);
  document.getElementById('filterFY').innerHTML = '<option value="All">All Financial Years</option>' + FINANCIAL_YEARS.map(fy=>`<option value="${fy}">${fy}</option>`).join('');
  document.getElementById('filterMonth').innerHTML = '<option value="All">All Months</option>' + MONTHS.map(m=>`<option value="${m}">${m}</option>`).join('');
  document.getElementById('filterStatus').innerHTML = '<option value="All">All Statuses</option>' + STATUSES.map(s=>`<option value="${s}">${s}</option>`).join('');
  document.getElementById('taskTeamFilter').innerHTML = teamOptionsHtml(true);
  document.getElementById('f_teamCode').innerHTML = '<option value="">-- Select Team --</option>' + teamOptionsHtml(false);
  document.getElementById('f_month').innerHTML = MONTHS.map(m=>`<option value="${m}">${m}</option>`).join('');
  document.getElementById('f_fy').innerHTML = FINANCIAL_YEARS.map(f=>`<option value="${f}">${f}</option>`).join('');
}

function populateTaskMemberFilter(){
  const members = Array.from(new Set(STATE.tasks.map(t => (t.member||'').trim()).filter(Boolean))).sort();
  const sel = document.getElementById('taskMemberFilter');
  const current = sel.value;
  sel.innerHTML = '<option value="All">All Members</option>' + members.map(m=>`<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  if(members.includes(current)) sel.value = current;
}

/* ====================================================================
   RENDER: KPI CARDS
   ==================================================================== */
const KPI_ICONS = {
  trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 4v5"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>',
};

function renderKpis(stats){
  const cards = [
    { title:'Total Target Reduction', value: formatINR(stats.totalTarget), accent:'--accent-sky', accentSoft:'--accent-sky-soft', icon: KPI_ICONS.trend, sub: `<span>Baseline for reduction goals</span>` },
    { title:'Actual Cost Saved', value: formatINR(stats.totalSaved), accent:'--accent-emerald', accentSoft:'--accent-emerald-soft', icon: KPI_ICONS.trend, sub: `<span class="up">${KPI_ICONS.up}${formatPercent(stats.achievementPercentage)} of Target</span>` },
    {
      title:'Remaining Savings Required', value: formatINR(stats.remainingRequired),
      accent: stats.remainingRequired === 0 ? '--accent-emerald' : '--accent-amber',
      accentSoft: stats.remainingRequired === 0 ? '--accent-emerald-soft' : '--accent-amber-soft',
      icon: KPI_ICONS.shield,
      sub: stats.remainingRequired === 0 ? '<span>Reduction target fully achieved!</span>' : `<span>${formatPercent(100-stats.achievementPercentage)} gap to close</span>`
    },
    { title:'Project Statistics', value: `${stats.completedProjectsCount} Completed`, accent:'--accent-indigo', accentSoft:'--accent-indigo-soft', icon: KPI_ICONS.clipboard, sub: `<span class="ongoing">${stats.ongoingProjectsCount} In Progress</span> <span class="delayed">${stats.delayedProjectsCount} Delayed</span>` },
  ];
  document.getElementById('kpiGrid').innerHTML = cards.map(c => `
    <div class="panel glass kpi-card" style="--kpi-accent: var(${c.accent}); --kpi-accent-soft: var(${c.accentSoft});">
      <div class="kpi-top"><span class="kpi-title">${c.title}</span><span class="kpi-icon">${c.icon}</span></div>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-sub">${c.sub}</div>
    </div>`).join('');
}

function renderFyStrip(stats){
  const cells = [
    { label:'FY 2025-26 Savings', value: stats.savingsByFY['FY 2025-26'], note:'Total completed cost reduction actions in FY 25-26' },
    { label:'FY 2026-27 Savings', value: stats.savingsByFY['FY 2026-27'], note:'Total completed cost reduction actions in FY 26-27' },
    { label:'Future Planned Savings', value: stats.savingsByFY['Future Planned'], note:'Validated savings ready for subsequent launches' },
  ];
  document.getElementById('fyStrip').innerHTML = cells.map(c => `
    <div class="fy-cell">
      <span class="fy-label">${c.label}</span>
      <span class="fy-value mono">${formatINR(c.value)}</span>
      <span class="fy-note">${c.note}</span>
    </div>`).join('');
}

/* ====================================================================
   RENDER: TEAM TABLE + LEADERBOARD
   ==================================================================== */
const TEAM_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>';
const USER_ICON_SM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

function renderTeamTable(filteredTasks){
  const rows = getTeamRows(filteredTasks);
  document.getElementById('teamCountPill').textContent = `${STATE.teams.length} Active Teams`;
  document.getElementById('teamTableBody').innerHTML = rows.map(row => `
    <tr class="clickable" onclick="selectTeamFromDashboard('${row.code}')">
      <td>
        <div class="team-cell">
          <div class="team-cell-icon">${TEAM_ICON}</div>
          <div>
            <div class="team-cell-name">${escapeHtml(row.name)} <span class="team-cell-code">${row.code}</span></div>
            <div class="team-cell-module">${escapeHtml(row.module)}</div>
            <div class="team-cell-leader">${USER_ICON_SM}<span>Leader: ${escapeHtml(row.leader)}</span></div>
          </div>
        </div>
      </td>
      <td class="num mono">${formatINR(row.fy25Expenses)}</td>
      <td class="num mono">${formatINR(row.target)}</td>
      <td class="num mono" style="color:var(--accent-emerald);font-weight:600;">${formatINR(row.actualSaved)}</td>
      <td>
        <div class="achv-cell">
          <div class="achv-top">
            <span class="achv-badge status-${row.statusKey}">${row.statusLabel}</span>
            <span class="achv-pct">${formatPercent(row.achievementPercent)}</span>
          </div>
          <div class="achv-bar"><div class="achv-bar-fill" style="width:${Math.min(100,row.achievementPercent)}%;background:${row.achievementPercent>=100?'var(--accent-emerald)':row.achievementPercent>=60?'var(--accent-sky)':row.achievementPercent>=30?'var(--accent-amber)':'var(--accent-rose)'};"></div></div>
        </div>
      </td>
    </tr>`).join('');
}

function renderLeaderboard(filteredTasks){
  const rows = getTeamRows(filteredTasks).slice().sort((a,b) => b.actualSaved - a.actualSaved);
  document.getElementById('leaderboardList').innerHTML = rows.map((team, rank) => `
    <div class="leader-row" onclick="selectTeamFromDashboard('${team.code}')">
      <div class="leader-left">
        <span class="rank-badge ${rank===0?'rank-1':rank===1?'rank-2':rank===2?'rank-3':'rank-n'}">${rank+1}</span>
        <div class="leader-info">
          <div class="leader-name">${escapeHtml(team.name)}</div>
          <div class="leader-sub">${team.completedProjects} Completed Projects</div>
        </div>
      </div>
      <div class="leader-right">
        <div class="leader-amt">${formatINR(team.actualSaved)}</div>
        <div class="leader-pct">${formatPercent(team.achievementPercent)} achievement</div>
      </div>
    </div>`).join('');
}

function selectTeamFromDashboard(teamCode){
  STATE.filters.teamCode = teamCode;
  document.getElementById('filterTeam').value = teamCode;
  switchView('tasks');
  renderAll();
}

/* ====================================================================
   CHARTS (Chart.js)
   ==================================================================== */
const CHART_PALETTE = ['#38bdf8','#34d399','#fbbf24','#818cf8','#fb7185','#2dd4bf','#c084fc'];
const STATUS_COLORS = { Completed:'#34d399', 'In Progress':'#38bdf8', Delayed:'#fb7185' };

Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.color = '#b7bedd';

function destroyChart(id){
  if (STATE.charts[id]){ STATE.charts[id].destroy(); delete STATE.charts[id]; }
}

const gridColor = 'rgba(255,255,255,0.06)';
const tickColor = '#7d84ac';

function baseTooltip(){
  return {
    backgroundColor:'rgba(10,14,33,0.95)', titleColor:'#f3f5fb', bodyColor:'#e2e6f5',
    borderColor:'rgba(255,255,255,0.12)', borderWidth:1, padding:11, titleFont:{weight:'700',size:12}, bodyFont:{size:11.5},
    callbacks:{ label: (ctx) => `${ctx.dataset.label}: ${formatINR(ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed)}` }
  };
}

function renderFinancialCharts(filteredTasks){
  const teamComparisonData = STATE.teams.map(team => ({
    code: team.code,
    actual: filteredTasks.filter(t => t.teamCode===team.code && t.status==='Completed').reduce((s,t)=>s+t.costSaved,0),
    target: team.targetReduction,
  }));

  destroyChart('chartTargetActual');
  STATE.charts.chartTargetActual = new Chart(document.getElementById('chartTargetActual'), {
    type:'bar',
    data:{ labels: teamComparisonData.map(t=>t.code), datasets:[
      { label:'Target reduction', data: teamComparisonData.map(t=>t.target), backgroundColor:'#64748b', borderRadius:5 },
      { label:'Actual Saved', data: teamComparisonData.map(t=>t.actual), backgroundColor:'#34d399', borderRadius:5 },
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ position:'bottom', labels:{ boxWidth:10, boxHeight:10, font:{size:11} } }, tooltip: baseTooltip() },
      scales:{ x:{ grid:{ display:false }, ticks:{ color: tickColor, font:{size:11} } }, y:{ grid:{ color: gridColor }, ticks:{ color: tickColor, font:{size:10}, callback:(v)=>formatAbbreviatedINR(v) } } }
    }
  });

  let running = 0;
  const cumulative = MONTHS.map(monthName => {
    const sum = filteredTasks.filter(t=>t.month===monthName && t.status==='Completed').reduce((s,t)=>s+t.costSaved,0);
    running += sum; return running;
  });
  destroyChart('chartCumulative');
  const cumCtx = document.getElementById('chartCumulative').getContext('2d');
  const grad = cumCtx.createLinearGradient(0,0,0,260);
  grad.addColorStop(0, 'rgba(56,189,248,0.35)'); grad.addColorStop(1, 'rgba(56,189,248,0)');
  STATE.charts.chartCumulative = new Chart(cumCtx, {
    type:'line',
    data:{ labels: MONTHS.map(m=>m.slice(0,3)), datasets:[{ label:'Cumulative Savings', data: cumulative, borderColor:'#38bdf8', backgroundColor: grad, fill:true, tension:0.35, pointRadius:0 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false }, tooltip: baseTooltip() }, scales:{ x:{ grid:{ display:false }, ticks:{ color: tickColor, font:{size:11} } }, y:{ grid:{ color: gridColor }, ticks:{ color: tickColor, font:{size:10}, callback:(v)=>formatAbbreviatedINR(v) } } } }
  });
}

function renderTeamCharts(filteredTasks){
  const teamComparisonData = STATE.teams.map(team => ({
    name: team.name, code: team.code,
    actual: filteredTasks.filter(t => t.teamCode===team.code && t.status==='Completed').reduce((s,t)=>s+t.costSaved,0),
  }));
  let contribution = teamComparisonData.filter(t=>t.actual>0);
  if (contribution.length === 0) contribution = [{ name:'No Achieved Savings', actual:1 }];

  destroyChart('chartContribution');
  STATE.charts.chartContribution = new Chart(document.getElementById('chartContribution'), {
    type:'doughnut',
    data:{ labels: contribution.map(c=>c.name), datasets:[{ data: contribution.map(c=>c.actual), backgroundColor: contribution.map((_,i)=>CHART_PALETTE[i%CHART_PALETTE.length]), borderWidth:0, hoverOffset:6 }] },
    options:{ responsive:true, maintainAspectRatio:false, cutout:'62%', plugins:{ legend:{ display:false }, tooltip:{ ...baseTooltip(), callbacks:{ label:(ctx)=>`${ctx.label}: ${formatAbbreviatedINR(ctx.parsed)}` } } } }
  });
  const totalVal = contribution.reduce((s,c)=>s+c.actual,0);
  document.getElementById('contributionLegend').innerHTML = contribution.map((c,i) => `
    <div class="legend-row">
      <span class="legend-name"><span class="dot-sw" style="background:${CHART_PALETTE[i%CHART_PALETTE.length]}"></span><span class="txt">${escapeHtml(c.name)}</span></span>
      <span class="legend-val">${totalVal>0 ? ((c.actual/totalVal)*100).toFixed(1) : '0.0'}%</span>
    </div>`).join('');

  destroyChart('chartTeamRank');
  STATE.charts.chartTeamRank = new Chart(document.getElementById('chartTeamRank'), {
    type:'bar',
    data:{ labels: teamComparisonData.map(t=>t.code), datasets:[{ label:'Actual Saved', data: teamComparisonData.map(t=>t.actual), backgroundColor:'#818cf8', borderRadius:5 }] },
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false }, tooltip: baseTooltip() }, scales:{ x:{ grid:{ color: gridColor }, ticks:{ color: tickColor, font:{size:10}, callback:(v)=>formatAbbreviatedINR(v) } }, y:{ grid:{ display:false }, ticks:{ color: tickColor, font:{size:11} } } } }
  });
}

function renderTimelineCharts(filteredTasks){
  const monthlyData = MONTHS.map(monthName => filteredTasks.filter(t=>t.month===monthName && t.status==='Completed').reduce((s,t)=>s+t.costSaved,0));
  destroyChart('chartMonthly');
  STATE.charts.chartMonthly = new Chart(document.getElementById('chartMonthly'), {
    type:'line',
    data:{ labels: MONTHS.map(m=>m.slice(0,3)), datasets:[{ label:'Completed Savings', data: monthlyData, borderColor:'#34d399', backgroundColor:'#34d399', tension:0.35, pointRadius:4, pointBackgroundColor:'#34d399' }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false }, tooltip: baseTooltip() }, scales:{ x:{ grid:{ display:false }, ticks:{ color: tickColor, font:{size:11} } }, y:{ grid:{ color: gridColor }, ticks:{ color: tickColor, font:{size:10}, callback:(v)=>formatAbbreviatedINR(v) } } } }
  });

  const statusDist = [
    { name:'Completed', value: filteredTasks.filter(t=>t.status==='Completed').length, color: STATUS_COLORS.Completed },
    { name:'In Progress', value: filteredTasks.filter(t=>t.status==='In Progress').length, color: STATUS_COLORS['In Progress'] },
    { name:'Delayed', value: filteredTasks.filter(t=>t.status==='Delayed').length, color: STATUS_COLORS.Delayed },
  ];
  destroyChart('chartStatus');
  STATE.charts.chartStatus = new Chart(document.getElementById('chartStatus'), {
    type:'pie',
    data:{ labels: statusDist.map(s=>s.name), datasets:[{ data: statusDist.map(s=>s.value), backgroundColor: statusDist.map(s=>s.color), borderWidth:0, hoverOffset:6 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false }, tooltip:{ ...baseTooltip(), callbacks:{ label:(ctx)=>`${ctx.label}: ${ctx.parsed} Projects` } } } }
  });
  document.getElementById('statusLegend').innerHTML = statusDist.map(s => `
    <div class="legend-row">
      <span class="legend-name"><span class="dot-sw" style="background:${s.color}"></span><span class="txt">${s.name} Projects</span></span>
      <span class="legend-val mono">${s.value}</span>
    </div>`).join('');
}

function renderActiveChartTab(filteredTasks){
  if (STATE.activeChartTab === 'financial') renderFinancialCharts(filteredTasks);
  if (STATE.activeChartTab === 'teams') renderTeamCharts(filteredTasks);
  if (STATE.activeChartTab === 'timeline') renderTimelineCharts(filteredTasks);
}

/* ====================================================================
   RENDER: TASK LEDGER VIEW
   ==================================================================== */
const STATUS_ICONS = {
  Completed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  'In Progress': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  Delayed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
};
const STATUS_CLASS = { Completed:'completed', 'In Progress':'inprogress', Delayed:'delayed' };

function getCurrentMonthName(){ return MONTHS[new Date().getMonth()]; }
function getCurrentYear(){ return new Date().getFullYear(); }

function renderQuickTabs(){
  const tasks = STATE.tasks;
  const cmn = getCurrentMonthName(), cy = getCurrentYear();
  const tabs = [
    { key:'all', label:`All Projects (${tasks.length})`, color:'#94a3b8' },
    { key:'completed-month', label:`Completed This Month (${tasks.filter(t=>t.status==='Completed'&&t.month===cmn).length})`, color:'#34d399' },
    { key:'completed-year', label:`Completed This Year (${tasks.filter(t=>t.status==='Completed'&&t.year===cy).length})`, color:'#818cf8' },
    { key:'in-progress', label:`In Progress (${tasks.filter(t=>t.status==='In Progress').length})`, color:'#38bdf8' },
    { key:'delayed', label:`Delayed (${tasks.filter(t=>t.status==='Delayed').length})`, color:'#fb7185' },
  ];
  document.getElementById('quickTabs').innerHTML = tabs.map(t => `
    <button class="quick-tab-btn ${STATE.quickFilter===t.key?'active':''}" style="--qt-color:${t.color};" data-quick="${t.key}">${t.label}</button>`).join('');
  document.querySelectorAll('#quickTabs .quick-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => { STATE.quickFilter = btn.dataset.quick; renderTaskLedger(); });
  });
}

function getLedgerFilteredTasks(){
  const cmn = getCurrentMonthName(), cy = getCurrentYear();
  return STATE.tasks.filter(task => {
    const q = STATE.taskSearch.toLowerCase();
    const textMatch = !q || task.title.toLowerCase().includes(q) || task.description.toLowerCase().includes(q) || task.remarks.toLowerCase().includes(q);
    const teamMatch = STATE.taskTeamFilter === 'All' || task.teamCode === STATE.taskTeamFilter;
    const memberMatch = STATE.taskMemberFilter === 'All' || task.member === STATE.taskMemberFilter;
    let quickMatch = true;
    if (STATE.quickFilter === 'completed-month') quickMatch = task.status==='Completed' && task.month===cmn;
    else if (STATE.quickFilter === 'completed-year') quickMatch = task.status==='Completed' && task.year===cy;
    else if (STATE.quickFilter === 'in-progress') quickMatch = task.status==='In Progress';
    else if (STATE.quickFilter === 'delayed') quickMatch = task.status==='Delayed';
    return textMatch && teamMatch && memberMatch && quickMatch;
  });
}

const DOC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
const EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

function renderTaskTable(){
  const tasks = getLedgerFilteredTasks();
  const tbody = document.getElementById('taskTableBody');
  if (tasks.length === 0){
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No cost-saving tasks match the current active criteria.</td></tr>`;
  } else {
    tbody.innerHTML = tasks.map(task => `
      <tr>
        <td>
          <div class="task-title-cell">
            <span class="t-name">${escapeHtml(task.title)}</span>
            <span class="t-desc">${escapeHtml(task.description)}</span>
            <span class="t-team">${escapeHtml(task.teamName)} (${task.teamCode})</span>
          </div>
        </td>
        <td><div class="party-cell"><span class="party-icon">${USER_ICON_SM}</span><span>${escapeHtml(task.member)}</span></div></td>
        <td><div class="schedule-cell"><span>${task.month} ${task.year}</span><span class="s-fy">${task.fy}</span></div></td>
        <td>
          <div class="fin-cell">
            <span class="saved" style="font-size:13px;">Saved: <span class="mono">${formatINR(task.costSaved)}</span></span>
          </div>
        </td>
        <td class="center"><span class="status-chip ${STATUS_CLASS[task.status]}">${STATUS_ICONS[task.status]}${task.status}</span></td>
        <td class="num no-print">
          <div class="row-actions">
            ${task.supportingDocName ? `<button class="doc" title="${escapeHtml(task.supportingDocName)}" onclick="alert('Document attached: ${escapeHtml(task.supportingDocName)}')">${DOC_ICON}</button>` : ''}
            <button class="edit" title="Edit Task" onclick="openTaskModal('${task.id}')">${EDIT_ICON}</button>
            <button class="delete" title="Delete Task" onclick="confirmDeleteTask('${task.id}')">${TRASH_ICON}</button>
          </div>
        </td>
      </tr>`).join('');
  }

  const footer = document.getElementById('ledgerFooter');
  if (tasks.length > 0){
    const totalSaved = tasks.reduce((s,t)=>s+t.costSaved,0);
    footer.innerHTML = `
      <span>Showing <strong>${tasks.length}</strong> of <strong>${STATE.tasks.length}</strong> total tasks</span>
      <div class="stats-group">
        <span>Total Cost Saved (Shown Tasks): <span class="saved-amt">${formatINR(totalSaved)}</span></span>
      </div>`;
  } else {
    footer.innerHTML = '';
  }
}

function renderTaskLedger(){
  renderQuickTabs();
  populateTaskMemberFilter();
  renderTaskTable();
}

function confirmDeleteTask(id){
  openConfirmModal(
    'Delete this task?',
    'This cost-saving task will be permanently removed and its totals will no longer count toward team, monthly, or yearly savings. This action cannot be undone.',
    async () => {
      const ok = await apiDeleteTask(id);
      if(ok){
        await loadData();
        renderAll();
        showToast('success', 'Task Deleted', 'The cost-saving task was removed.');
      }
    }
  );
}

/* ====================================================================
   TASK FORM MODAL
   ==================================================================== */
function openTaskModal(taskId){
  STATE.editingTaskId = taskId || null;
  const task = taskId ? STATE.tasks.find(t => t.id === taskId) : null;

  document.getElementById('formError').hidden = true;
  document.getElementById('modalTitle').textContent = task ? 'Edit Cost Saving Task' : 'Add New Cost Saving Task';
  document.getElementById('saveTaskBtn').textContent = task ? 'Update Task' : 'Add Task';

  document.getElementById('f_teamCode').value = task ? task.teamCode : (STATE.teams[0]?.code || '');
  document.getElementById('f_member').value = task ? task.member : '';
  document.getElementById('f_title').value = task ? task.title : '';
  document.getElementById('f_description').value = task ? task.description : '';
  document.getElementById('f_month').value = task ? task.month : 'June';
  document.getElementById('f_year').value = task ? String(task.year) : '2026';
  document.getElementById('f_fy').value = task ? task.fy : 'FY 2026-27';
  document.getElementById('f_status').value = task ? task.status : 'In Progress';
  document.getElementById('f_costSaved').value = task ? String(task.costSaved) : '';
  document.getElementById('f_remarks').value = task ? task.remarks : '';
  document.getElementById('f_supportingDocName').value = task ? (task.supportingDocName || '') : '';

  updateCostSavedFieldState();
  document.getElementById('taskModalOverlay').classList.add('open');
}

function closeTaskModal(){
  document.getElementById('taskModalOverlay').classList.remove('open');
  STATE.editingTaskId = null;
}

/* ====================================================================
   CONFIRMATION MODAL
   ==================================================================== */
let _confirmModalCallback = null;

function openConfirmModal(title, message, onConfirm, opts){
  document.getElementById('confirmModalTitle').textContent = title;
  document.getElementById('confirmModalMsg').textContent = message;
  const okBtn = document.getElementById('confirmModalOkBtn');
  okBtn.textContent = (opts && opts.okLabel) || 'Delete';
  const icon = document.getElementById('confirmModalIcon');
  icon.classList.toggle('neutral', !!(opts && opts.neutral));
  _confirmModalCallback = onConfirm;
  document.getElementById('confirmModalOverlay').classList.add('open');
}

function closeConfirmModal(){
  document.getElementById('confirmModalOverlay').classList.remove('open');
  _confirmModalCallback = null;
}

function updateCostSavedFieldState(){
  const status = document.getElementById('f_status').value;
  const input = document.getElementById('f_costSaved');
  const label = document.getElementById('f_costSavedLabel');
  const hint = document.getElementById('f_costSavedHint');
  const isCompleted = status === 'Completed';
  input.disabled = !isCompleted;
  if (!isCompleted) input.value = '';
  input.placeholder = isCompleted ? 'e.g. 450000' : '0 (Only active when Completed)';
  label.textContent = `Actual Cost Saved Amount (₹) ${isCompleted ? '*' : '(Disabled)'}`;
  hint.hidden = isCompleted;
}

function handleTeamSelectChange(){
  const code = document.getElementById('f_teamCode').value;
  const memberInput = document.getElementById('f_member');
  const team = STATE.teams.find(t => t.code === code);
  if (team && !memberInput.value.trim()) memberInput.value = team.leader;
}

function showFormError(msg){
  const el = document.getElementById('formError');
  el.textContent = msg;
  el.hidden = false;
}

async function submitTaskForm(e){
  e.preventDefault();
  const teamCode    = document.getElementById('f_teamCode').value;
  const member      = document.getElementById('f_member').value.trim();
  const title       = document.getElementById('f_title').value.trim();
  const description = document.getElementById('f_description').value.trim();
  const month       = document.getElementById('f_month').value;
  const year        = document.getElementById('f_year').value;
  const fy          = document.getElementById('f_fy').value;
  const status      = document.getElementById('f_status').value;
  const costSaved   = document.getElementById('f_costSaved').value;
  const remarks     = document.getElementById('f_remarks').value.trim();
  const supportingDocName = document.getElementById('f_supportingDocName').value.trim();

  if (!teamCode){ showFormError('Please select a Team.'); return; }
  if (!title){ showFormError('Please enter a Project/Task Title.'); return; }
  if (!member){ showFormError('Please enter a Team Member name.'); return; }
  if (status === 'Completed' && (!costSaved || Number(costSaved) < 0)){ showFormError('Please enter a Cost Saved Amount (₹) for completed projects.'); return; }

  const targetSaving = status === 'Completed' ? costSaved : 0;
  const payload = { teamCode, member, title, description, month, year, fy, status, costSaved: status==='Completed'?costSaved:0, targetSaving, remarks, supportingDocName };

  // Disable save button while in flight
  const saveBtn = document.getElementById('saveTaskBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  if (STATE.editingTaskId){
    const updated = await apiUpdateTask(STATE.editingTaskId, payload);
    if(updated){
      showToast('success', 'Task Updated', `${title} has been updated for ${month} ${year}.`);
      closeTaskModal();
      await loadData();
      renderAll();
    }
  } else {
    const created = await apiCreateTask(payload);
    if(created){
      showToast('success', 'Task Added', `${title} has been added to ${month} ${year} for this team.`);
      closeTaskModal();
      await loadData();
      renderAll();
    }
  }

  saveBtn.disabled = false;
  saveBtn.textContent = STATE.editingTaskId ? 'Update Task' : 'Add Task';
}

function generateMockDoc(){
  const docs = ['contract_amendment_signed.pdf','pantry_billing_audit.xlsx','telecom_rates_comparison.pdf','energy_saving_report.docx','travel_vendor_mou_2026.pdf'];
  document.getElementById('f_supportingDocName').value = docs[Math.floor(Math.random()*docs.length)];
}

/* ====================================================================
   RENDER: REPORTS VIEW
   ==================================================================== */
function renderBaselineTable(){
  document.getElementById('baselineTableBody').innerHTML = STATE.teams.map(t => {
    const saved2526 = STATE.tasks.filter(task => task.teamCode===t.code && task.fy==='FY 2025-26' && task.status==='Completed').reduce((s,task)=>s+task.costSaved,0);
    const saved2627 = STATE.tasks.filter(task => task.teamCode===t.code && task.fy==='FY 2026-27' && task.status==='Completed').reduce((s,task)=>s+task.costSaved,0);
    return `<tr>
      <td style="font-weight:700;color:var(--text-1);">${escapeHtml(t.name)}</td>
      <td>${escapeHtml(t.module)}</td>
      <td class="num mono">${formatINR(t.fy25Expenses)}</td>
      <td class="num mono" style="font-weight:600;color:var(--text-1);">${formatINR(t.targetReduction)}</td>
      <td class="num mono" style="color:var(--accent-emerald);">${formatINR(saved2526)}</td>
      <td class="num mono" style="color:var(--accent-indigo);">${formatINR(saved2627)}</td>
    </tr>`;
  }).join('');
}

/* CSV Exports */
function exportAllDataToCSV(){
  const headers = ['Task ID','Team Code','Team Name','Team Member','Project Title','Description','Month','Year','Financial Year','Status','Target Saving (INR)','Cost Saved Actual (INR)','Remarks','Created At'];
  const rows = STATE.tasks.map(t => [t.id, t.teamCode, csvEscape(t.teamName), csvEscape(t.member), csvEscape(t.title), csvEscape(t.description), t.month, t.year, t.fy, t.status, t.targetSaving, t.costSaved, csvEscape(t.remarks), t.createdAt]);
  downloadCsv(`Cost_Saving_Master_Database_${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
}
function csvEscape(val){ return `"${String(val).replace(/"/g,'""')}"`; }

function downloadTeamReportCSV(){
  const headers = ['Team Code','Team Name','Module Managed','Module Leader','FY-25 Base Expenses (INR)','Total Reduction Target (INR)','Actual Achieved Savings (INR)','Remaining Required (INR)','Target Achievement %','Completed Initiatives','In Progress Initiatives','Delayed Initiatives'];
  const rows = STATE.teams.map(team => {
    const teamTasks = STATE.tasks.filter(t => t.teamCode === team.code);
    const saved = teamTasks.filter(t=>t.status==='Completed').reduce((s,t)=>s+t.costSaved,0);
    const remaining = Math.max(0, team.targetReduction - saved);
    const pct = team.targetReduction > 0 ? (saved/team.targetReduction)*100 : 0;
    return [team.code, csvEscape(team.name), csvEscape(team.module), csvEscape(team.leader), team.fy25Expenses, team.targetReduction, saved, remaining, pct.toFixed(2),
      teamTasks.filter(t=>t.status==='Completed').length, teamTasks.filter(t=>t.status==='In Progress').length, teamTasks.filter(t=>t.status==='Delayed').length];
  });
  downloadCsv(`Cost_Saving_Teamwise_Report_${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
}

function downloadFYReportCSV(){
  const headers = ['Financial Year','Total Registered Projects','Completed Projects','Ongoing Projects','Delayed Projects','Registered Targets (INR)','Actual Achieved Savings (INR)','Financial Year Target Achievement %'];
  const rows = FINANCIAL_YEARS.map(fy => {
    const fyTasks = STATE.tasks.filter(t => t.fy === fy);
    const target = fyTasks.reduce((s,t)=>s+t.targetSaving,0);
    const saved = fyTasks.filter(t=>t.status==='Completed').reduce((s,t)=>s+t.costSaved,0);
    const pct = target > 0 ? (saved/target)*100 : 0;
    return [fy, fyTasks.length, fyTasks.filter(t=>t.status==='Completed').length, fyTasks.filter(t=>t.status==='In Progress').length, fyTasks.filter(t=>t.status==='Delayed').length, target, saved, pct.toFixed(2)];
  });
  downloadCsv(`Cost_Saving_FY_Report_${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
}

/* ====================================================================
   TOASTS
   ==================================================================== */
const TOAST_ICONS = {
  success:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  error:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
};
function showToast(type, title, msg){
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast glass ${type}`;
  el.innerHTML = `${TOAST_ICONS[type]}<div><div class="toast-title">${escapeHtml(title)}</div><div class="toast-msg">${escapeHtml(msg)}</div></div>`;
  stack.appendChild(el);
  setTimeout(() => { el.style.transition='opacity .3s ease, transform .3s ease'; el.style.opacity='0'; el.style.transform='translateX(20px)'; setTimeout(()=>el.remove(), 300); }, 3800);
}

/* ====================================================================
   TEAM SAVINGS — SIMPLE OVERVIEW MODULE
   ==================================================================== */
function populateTeamSavingsFilters(){
  const teamSel = document.getElementById('tsFilterTeam');
  const monthSel = document.getElementById('tsFilterMonth');
  const fySel = document.getElementById('tsFilterFY');
  if (teamSel.options.length === 0){
    teamSel.innerHTML = '<option value="All">All Teams</option>' + STATE.teams.map(t=>`<option value="${t.code}">${escapeHtml(t.name)}</option>`).join('');
    monthSel.innerHTML = '<option value="All">All Months</option>' + MONTHS.map(m=>`<option value="${m}">${m}</option>`).join('');
    fySel.innerHTML = '<option value="All">All Financial Years</option>' + FINANCIAL_YEARS.map(fy=>`<option value="${fy}">${fy}</option>`).join('');
  }
  teamSel.value = STATE.tsFilters.teamCode;
  monthSel.value = STATE.tsFilters.month;
  fySel.value = STATE.tsFilters.fy;
}

function getTeamSavingsFilteredTasks(){
  const f = STATE.tsFilters;
  return STATE.tasks.filter(t => {
    if (t.status !== 'Completed') return false;
    if (f.teamCode !== 'All' && t.teamCode !== f.teamCode) return false;
    if (f.month !== 'All' && t.month !== f.month) return false;
    if (f.fy !== 'All' && t.fy !== f.fy) return false;
    return true;
  });
}

function renderTeamSavingsKpis(tasks){
  const totalSaved = tasks.reduce((s,t)=>s+t.costSaved, 0);
  const teamsInvolved = new Set(tasks.map(t=>t.teamCode)).size;
  const monthsInvolved = new Set(tasks.map(t=>t.month+'-'+t.year)).size;
  const cards = [
    { title:'Total Savings (Filtered)', value: formatINR(totalSaved), icon: KPI_ICONS.trend, accent:'--accent-emerald', accentSoft:'--accent-emerald-soft', sub:'Sum of all completed savings shown below' },
    { title:'Teams With Savings', value: `${teamsInvolved} of ${STATE.teams.length}`, icon: TEAM_ICON, accent:'--accent-sky', accentSoft:'--accent-sky-soft', sub:'Teams contributing under the current filter' },
    { title:'Months With Activity', value: monthsInvolved, icon: KPI_ICONS.clipboard, accent:'--accent-indigo', accentSoft:'--accent-indigo-soft', sub:'Distinct months with at least one completed saving' },
  ];
  document.getElementById('tsKpiGrid').innerHTML = cards.map(c => `
    <div class="panel glass kpi-card" style="--kpi-accent: var(${c.accent}); --kpi-accent-soft: var(${c.accentSoft});">
      <div class="kpi-top"><span class="kpi-title">${c.title}</span><span class="kpi-icon">${c.icon}</span></div>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-sub"><span>${c.sub}</span></div>
    </div>`).join('');
}

function getActiveMonthBuckets(tasks){
  const seen = new Map();
  tasks.forEach(t => {
    const key = `${t.year}-${t.month}`;
    if (!seen.has(key)) seen.set(key, { month: t.month, year: t.year, monthIdx: MONTHS.indexOf(t.month) });
  });
  return Array.from(seen.values()).sort((a,b) => (a.year - b.year) || (a.monthIdx - b.monthIdx));
}

function renderTeamSavingsGrid(tasks){
  const buckets = getActiveMonthBuckets(tasks);
  const teamsToShow = STATE.tsFilters.teamCode === 'All' ? STATE.teams : STATE.teams.filter(t=>t.code===STATE.tsFilters.teamCode);
  const headRow = document.getElementById('tsGridHeadRow');
  const body = document.getElementById('tsGridBody');
  const foot = document.getElementById('tsGridFoot');

  if (buckets.length === 0 || teamsToShow.length === 0){
    headRow.innerHTML = '<th>Team</th>';
    body.innerHTML = `<tr class="empty-row"><td>No completed savings match the current filters.</td></tr>`;
    foot.innerHTML = ''; return;
  }

  headRow.innerHTML = '<th>Team</th>' + buckets.map(b => `<th class="num">${b.month.slice(0,3)} ${String(b.year).slice(2)}</th>`).join('') + '<th class="num">Team Total</th>';
  const colTotals = buckets.map(()=>0);
  let grandTotal = 0;

  body.innerHTML = teamsToShow.map(team => {
    let rowTotal = 0;
    const cells = buckets.map((b, idx) => {
      const sum = tasks.filter(t => t.teamCode === team.code && t.month === b.month && t.year === b.year).reduce((s,t)=>s+t.costSaved, 0);
      rowTotal += sum; colTotals[idx] += sum;
      return `<td class="num mono" style="${sum>0?'color:var(--accent-emerald);font-weight:600;':'color:var(--text-3);'}">${sum>0 ? formatAbbreviatedINR(sum) : '—'}</td>`;
    }).join('');
    grandTotal += rowTotal;
    return `<tr><td style="font-weight:700;color:var(--text-1);">${escapeHtml(team.name)}</td>${cells}<td class="num mono" style="font-weight:700;color:var(--text-1);">${formatINR(rowTotal)}</td></tr>`;
  }).join('');

  foot.innerHTML = `<tr style="background:rgba(255,255,255,0.05);">
    <td style="font-weight:700;">Monthly Total</td>
    ${colTotals.map(v => `<td class="num mono" style="font-weight:700;color:var(--accent-sky);">${formatAbbreviatedINR(v)}</td>`).join('')}
    <td class="num mono" style="font-weight:800;color:var(--accent-emerald);">${formatINR(grandTotal)}</td>
  </tr>`;
}

function renderTeamSavingsCharts(tasks){
  const byTeam = STATE.teams.map(team => ({
    name: team.name,
    total: tasks.filter(t=>t.teamCode===team.code).reduce((s,t)=>s+t.costSaved,0),
  })).filter(t => STATE.tsFilters.teamCode === 'All' || t.name === STATE.teams.find(x=>x.code===STATE.tsFilters.teamCode)?.name);

  destroyChart('tsChartByTeam');
  STATE.charts.tsChartByTeam = new Chart(document.getElementById('tsChartByTeam'), {
    type: 'bar',
    data: { labels: byTeam.map(t=>t.name), datasets: [{ label:'Total Saved', data: byTeam.map(t=>t.total), backgroundColor:'#34d399', borderRadius:6 }] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false }, tooltip: baseTooltip() }, scales:{ x:{ grid:{ display:false }, ticks:{ color: tickColor, font:{size:10.5} } }, y:{ grid:{ color: gridColor }, ticks:{ color: tickColor, font:{size:10}, callback:(v)=>formatAbbreviatedINR(v) } } } }
  });

  const buckets = getActiveMonthBuckets(tasks);
  const trendData = buckets.map(b => tasks.filter(t=>t.month===b.month && t.year===b.year).reduce((s,t)=>s+t.costSaved,0));
  destroyChart('tsChartTrend');
  const ctx = document.getElementById('tsChartTrend').getContext('2d');
  const grad = ctx.createLinearGradient(0,0,0,260);
  grad.addColorStop(0, 'rgba(56,189,248,0.35)'); grad.addColorStop(1, 'rgba(56,189,248,0)');
  STATE.charts.tsChartTrend = new Chart(ctx, {
    type:'line',
    data:{ labels: buckets.map(b=>`${b.month.slice(0,3)} ${String(b.year).slice(2)}`), datasets:[{ label:'Total Savings', data: trendData, borderColor:'#38bdf8', backgroundColor: grad, fill:true, tension:0.3, pointRadius:3, pointBackgroundColor:'#38bdf8' }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false }, tooltip: baseTooltip() }, scales:{ x:{ grid:{ display:false }, ticks:{ color: tickColor, font:{size:10.5} } }, y:{ grid:{ color: gridColor }, ticks:{ color: tickColor, font:{size:10}, callback:(v)=>formatAbbreviatedINR(v) } } } }
  });
}

function renderTeamSavingsView(){
  populateTeamSavingsFilters();
  const tasks = getTeamSavingsFilteredTasks();
  renderTeamSavingsKpis(tasks);
  renderTeamSavingsGrid(tasks);
  renderTeamSavingsCharts(tasks);
}

function resetTeamSavingsFilters(){
  STATE.tsFilters = { teamCode:'All', month:'All', fy:'All' };
  renderTeamSavingsView();
}

function switchView(viewName){
  STATE.activeView = viewName;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-'+viewName).classList.add('active');
  document.querySelectorAll('.view-btn').forEach(btn => {
    const active = btn.dataset.view === viewName;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  renderAll();
}

/* ====================================================================
   FILTERS WIRING
   ==================================================================== */
function readFiltersFromDom(){
  STATE.filters.teamCode = document.getElementById('filterTeam').value;
  STATE.filters.fy = document.getElementById('filterFY').value;
  STATE.filters.month = document.getElementById('filterMonth').value;
  STATE.filters.status = document.getElementById('filterStatus').value;
  STATE.filters.savingsMin = document.getElementById('filterMin').value;
  STATE.filters.savingsMax = document.getElementById('filterMax').value;
}
function resetFilters(){
  STATE.filters = { teamCode:'All', fy:'All', month:'All', status:'All', savingsMin:'', savingsMax:'' };
  document.getElementById('filterTeam').value = 'All';
  document.getElementById('filterFY').value = 'All';
  document.getElementById('filterMonth').value = 'All';
  document.getElementById('filterStatus').value = 'All';
  document.getElementById('filterMin').value = '';
  document.getElementById('filterMax').value = '';
  renderAll();
}

/* ====================================================================
   MASTER RENDER
   ==================================================================== */
function renderAll(){
  const filteredTasks = getFilteredTasks();
  const stats = getStats(filteredTasks);
  if (STATE.activeView === 'dashboard'){
    renderKpis(stats); renderFyStrip(stats);
    renderActiveChartTab(filteredTasks);
    renderTeamTable(filteredTasks); renderLeaderboard(filteredTasks);
  } else if (STATE.activeView === 'tasks'){
    renderTaskLedger();
  } else if (STATE.activeView === 'teamsavings'){
    renderTeamSavingsView();
  } else if (STATE.activeView === 'reports'){
    renderBaselineTable();
  }
}

/* ====================================================================
   INIT — Auth guard runs first, then loads data from Supabase
   ==================================================================== */
async function init(){
  /* ---- 1. Auth guard: verify session, redirect to login if needed ---- */
  const guard = document.getElementById('authGuard');
  try {
    const session = await window.Auth.requireAuth();
    if (!session) return; // requireAuth already redirected

    // Show logged-in user email in topbar
    const email = session.user?.email || '';
    const emailDisplay = document.getElementById('userEmailDisplay');
    if(emailDisplay) emailDisplay.textContent = email;

    // Wire logout button
    document.getElementById('logoutBtn')?.addEventListener('click', () => window.Auth.signOut());

  } catch(e){
    console.error('Auth check failed:', e);
    window.location.href = 'login.html';
    return;
  }

  /* ---- 2. Load data from Supabase ---- */
  await loadData();

  /* ---- 3. Populate dropdowns & static content ---- */
  populateStaticDropdowns();
  document.getElementById('footerYear').textContent = new Date().getFullYear();
  document.getElementById('printGeneratedAt').textContent = `Generated on ${new Date().toLocaleString('en-IN')}`;

  /* ---- 4. Hide auth guard and show the app ---- */
  if(guard){ guard.classList.add('hidden'); setTimeout(() => guard.remove(), 500); }

  /* ---- 5. Wire up all UI events ---- */

  // Nav
  document.querySelectorAll('.view-btn').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));

  // Refresh buttons — reload from Supabase
  const doRefresh = async (btnEl) => {
    btnEl.classList.add('spinning');
    await loadData();
    renderAll();
    setTimeout(() => btnEl.classList.remove('spinning'), 500);
  };
  document.getElementById('refreshBtn').addEventListener('click', () => doRefresh(document.getElementById('refreshBtn')));
  document.getElementById('refreshBtn2').addEventListener('click', () => doRefresh(document.getElementById('refreshBtn2')));

  // New task buttons
  document.getElementById('newTaskBtn').addEventListener('click', () => openTaskModal(null));
  document.getElementById('newTaskBtn2').addEventListener('click', () => openTaskModal(null));

  // Dashboard filters
  ['filterTeam','filterFY','filterMonth','filterStatus','filterMin','filterMax'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => { readFiltersFromDom(); renderAll(); });
  });
  document.getElementById('resetFiltersBtn').addEventListener('click', resetFilters);

  // Team Savings filters
  document.getElementById('tsFilterTeam').addEventListener('change', (e) => { STATE.tsFilters.teamCode = e.target.value; renderTeamSavingsView(); });
  document.getElementById('tsFilterMonth').addEventListener('change', (e) => { STATE.tsFilters.month = e.target.value; renderTeamSavingsView(); });
  document.getElementById('tsFilterFY').addEventListener('change', (e) => { STATE.tsFilters.fy = e.target.value; renderTeamSavingsView(); });
  document.getElementById('tsResetFiltersBtn').addEventListener('click', resetTeamSavingsFilters);

  // Chart tabs
  document.querySelectorAll('#chartTabs .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.activeChartTab = btn.dataset.tab;
      document.querySelectorAll('#chartTabs .seg-btn').forEach(b => b.classList.toggle('active', b===btn));
      document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
      document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
      renderActiveChartTab(getFilteredTasks());
    });
  });

  // Task ledger search & filters
  document.getElementById('taskSearch').addEventListener('input', (e) => { STATE.taskSearch = e.target.value; renderTaskTable(); });
  document.getElementById('taskTeamFilter').addEventListener('change', (e) => { STATE.taskTeamFilter = e.target.value; renderTaskTable(); });
  document.getElementById('taskMemberFilter').addEventListener('change', (e) => { STATE.taskMemberFilter = e.target.value; renderTaskTable(); });

  // Task form modal
  document.getElementById('closeModalBtn').addEventListener('click', closeTaskModal);
  document.getElementById('cancelModalBtn').addEventListener('click', closeTaskModal);
  document.getElementById('taskModalOverlay').addEventListener('click', (e) => { if (e.target.id === 'taskModalOverlay') closeTaskModal(); });
  document.getElementById('taskForm').addEventListener('submit', submitTaskForm);
  document.getElementById('saveTaskBtn').addEventListener('click', submitTaskForm);
  document.getElementById('f_status').addEventListener('change', updateCostSavedFieldState);
  document.getElementById('f_teamCode').addEventListener('change', handleTeamSelectChange);
  document.getElementById('generateDocBtn').addEventListener('click', generateMockDoc);

  // Confirmation modal
  document.getElementById('confirmModalOkBtn').addEventListener('click', async () => {
    const cb = _confirmModalCallback;
    closeConfirmModal();
    if (cb) await cb();
  });
  document.getElementById('confirmModalCancelBtn').addEventListener('click', closeConfirmModal);
  document.getElementById('confirmModalOverlay').addEventListener('click', (e) => { if (e.target.id === 'confirmModalOverlay') closeConfirmModal(); });

  // Reports
  document.getElementById('exportAllBtn').addEventListener('click', exportAllDataToCSV);
  document.getElementById('exportTeamBtn').addEventListener('click', downloadTeamReportCSV);
  document.getElementById('exportFYBtn').addEventListener('click', downloadFYReportCSV);
  document.getElementById('printBtn').addEventListener('click', () => window.print());
  document.getElementById('resetDataBtn').addEventListener('click', () => {
    openConfirmModal(
      'Reset all tasks?',
      'This will permanently delete ALL tasks from Supabase. Team data will remain. This action cannot be undone.',
      async () => {
        await apiResetDatabase();
        renderAll();
        showToast('success', 'Tasks Cleared', 'All tasks have been deleted from Supabase.');
      },
      { okLabel: 'Delete All Tasks' }
    );
  });

  /* ---- 6. Initial render ---- */
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
