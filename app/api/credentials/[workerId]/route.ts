import { apiFailure, requireOfficer } from "../../../../backend/auth";
import { decryptCredential } from "../../../../backend/crypto";

export async function GET(request: Request, context: { params: Promise<{ workerId: string }> }) {
  try {
    const { workerId } = await context.params;
    const { supabase } = await requireOfficer(request, ["admin", "technical_officer", "field_officer"]);
    const { data, error } = await supabase.from("worker_credentials").select("password_ciphertext").eq("worker_id", workerId).single();
    if (error || !data) return Response.json({ error: "Credential is not available for this User ID." }, { status: 404 });
    const password = await decryptCredential(data.password_ciphertext);
    const { error: auditError } = await supabase.rpc("record_credential_access", { p_worker_id: workerId });
    if (auditError) throw new Error("Credential access could not be audited.");
    return Response.json({ password }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
