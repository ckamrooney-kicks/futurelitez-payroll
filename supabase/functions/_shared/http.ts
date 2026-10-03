import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
}

/** Returns a client acting AS the signed-in user (RLS applies) and their verified email. */
export async function userFromRequest(req: Request): Promise<{ client: SupabaseClient; email: string } | null> {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (error || !data.user?.email) return null;
  return { client, email: data.user.email.toLowerCase() };
}

/** Service-role client: bypasses RLS. Only used after the caller has been verified. */
export function adminClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}
