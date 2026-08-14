import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { OfficerRole, Profile } from "../dashboard/types";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type OfficerContext = { supabase: SupabaseClient; user: User; profile: Profile; token: string };

export async function requireOfficer(request: Request, allowedRoles: OfficerRole[]): Promise<OfficerContext> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new ApiError(401, "Officer sign-in is required.");
  const token = authorization.slice(7);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new ApiError(503, "Secure data connection is unavailable.");
  const supabase = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) throw new ApiError(401, "Officer session is invalid or expired.");
  const { data: profile, error: profileError } = await supabase.from("profiles").select("id,display_name,role,active").eq("id", authData.user.id).maybeSingle();
  if (profileError || !profile || !profile.active) throw new ApiError(403, "Officer access has not been activated.");
  if (!allowedRoles.includes(profile.role as OfficerRole)) throw new ApiError(403, "Your officer role cannot perform this action.");
  return { supabase, user: authData.user, profile: profile as Profile, token };
}

export function apiFailure(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : "Unexpected operation failure.";
  return Response.json({ error: message }, { status: 500 });
}
