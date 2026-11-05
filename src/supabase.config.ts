/**
 * Supabase project for accounts (Google / email sign-in) and cloud-saved stats.
 *
 * Paste the values from Supabase dashboard → Project Settings → API (or "Connect"):
 *   url     — Project URL, e.g. https://abcdefghijklmnop.supabase.co
 *   anonKey — the "anon" public key (or the newer "publishable" key, sb_publishable_…)
 *
 * Both are public by design (access is protected by the row-level security policies in
 * `supabase/schema.sql`), so it is fine to commit them. Never put the service_role / secret key here.
 *
 * While these are empty, sign-in is shown but disabled and stats stay in this browser only.
 */
export const supabaseConfig = {
  url: 'https://xxkjtqcltfzbalsavgva.supabase.co',
  anonKey: 'sb_publishable_WJwUJMI-0wlZatRmBopnVQ_E7ABNCxe',
};
