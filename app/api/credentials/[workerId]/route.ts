import { z } from "zod";
import { apiFailure, requireOfficer } from "../../../../backend/auth";
import { decryptCredential, encryptCredential } from "../../../../backend/crypto";

const credentialUpdate = z.object({
  password: z.string().max(256).refine((value) => value.trim().length > 0, "Confirmed password is required."),
});

export async function GET(request: Request, context: { params: Promise<{ workerId: string }> }) {
  try {
    const { workerId } = await context.params;
    const { supabase } = await requireOfficer(request, ["admin", "technical_officer", "field_officer"]);
    const { data: worker, error: workerError } = await supabase
      .from("workers")
      .select("id")
      .eq("id", workerId)
      .is("deleted_at", null)
      .eq("active", true)
      .maybeSingle();
    if (workerError || !worker) return Response.json({ error: "This User ID is not active or is in Trash." }, { status: 404 });
    const { data, error } = await supabase.from("worker_credentials").select("password_ciphertext,password_missing").eq("worker_id", workerId).single();
    if (error || !data) return Response.json({ error: "Credential is not available for this User ID." }, { status: 404 });
    if (data.password_missing) return Response.json({ password: "", status: "missing" }, { headers: { "Cache-Control": "no-store" } });
    const password = await decryptCredential(data.password_ciphertext);
    const { error: auditError } = await supabase.rpc("record_credential_access", { p_worker_id: workerId });
    if (auditError) throw new Error("Credential access could not be audited.");
    return Response.json({ password }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}

export async function PUT(request: Request, context: { params: Promise<{ workerId: string }> }) {
  try {
    const { workerId } = await context.params;
    const { supabase, user } = await requireOfficer(request, ["admin", "technical_officer"]);
    const body = credentialUpdate.parse(await request.json());
    const { data: worker, error: workerError } = await supabase
      .from("workers")
      .select("id")
      .eq("id", workerId)
      .is("deleted_at", null)
      .eq("active", true)
      .maybeSingle();
    if (workerError || !worker) return Response.json({ error: "This User ID is not active or is in Trash." }, { status: 404 });

    const passwordCiphertext = await encryptCredential(body.password);
    const { data: credential, error: credentialError } = await supabase
      .from("worker_credentials")
      .update({ password_ciphertext: passwordCiphertext, password_missing: false, updated_by: user.id })
      .eq("worker_id", workerId)
      .select("worker_id")
      .maybeSingle();
    if (credentialError) throw new Error(credentialError.message);
    if (!credential) return Response.json({ error: "Credential record is not available for this User ID." }, { status: 404 });

    const { error: sourceError } = await supabase
      .from("master_source_rows")
      .update({ password_ciphertext: passwordCiphertext, password_missing: false })
      .eq("worker_id", workerId);
    if (sourceError) throw new Error("The confirmed password could not be synchronized to the Master source record.");

    return Response.json({ updated: true, status: "confirmed" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
