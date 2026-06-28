/* ====================================================================
   AUTH.JS — Supabase Authentication
   Project : vayzgyadhfwvyfsxkwrv.supabase.co
   Key     : sb_publishable_Ukasj4C0e3IiKDfBHH1KWA_MmAYKXcG
   ==================================================================== */

const SUPABASE_URL      = 'https://vayzgyadhfwvyfsxkwrv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Ukasj4C0e3IiKDfBHH1KWA_MmAYKXcG';

/* Create Supabase client — CDN must be loaded before this file */
const { createClient } = supabase;
const supabaseClient   = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* Return current session, or null */
async function getSession() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) { console.error('getSession error:', error); return null; }
  return data.session;
}

/* Sign in with email + password */
async function signIn(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  return { session: data?.session || null, error };
}

/* Sign out and go to login page */
async function signOut() {
  await supabaseClient.auth.signOut();
  window.location.replace('login.html');
}

/* Protect a page — redirects to login if no session */
async function requireAuth() {
  const session = await getSession();
  if (!session) { window.location.replace('login.html'); return null; }
  return session;
}

/* Expose to all scripts */
window.Auth = { getSession, signIn, signOut, requireAuth, supabaseClient };
