import { apiFailure, requireOfficer } from "../../../../backend/auth";
import { fetchGcsObject } from "../../../../backend/gcs";

export async function GET(request: Request, context: { params: Promise<{ evidenceId: string }> }) {
  try {
    const { evidenceId } = await context.params;
    const { supabase } = await requireOfficer(request, ["admin", "technical_officer", "field_officer", "auditor"]);

    const { data: item, error } = await supabase
      .from("evidence_files")
      .select("id,storage_provider,storage_bucket,storage_path,object_key,mime_type,original_filename")
      .eq("id", evidenceId)
      .maybeSingle();

    if (error || !item) return Response.json({ error: "Evidence file was not found or is not accessible." }, { status: 404 });

    let source: Response;
    if (item.storage_provider === "google_cloud_storage") {
      source = await fetchGcsObject(item.storage_bucket, item.object_key || item.storage_path);
    } else if (item.storage_provider === "supabase") {
      const { data: signed, error: signError } = await supabase.storage
        .from(item.storage_bucket)
        .createSignedUrl(item.storage_path, 60);
      if (signError || !signed?.signedUrl) throw new Error("Legacy Supabase evidence could not be authorized.");
      source = await fetch(signed.signedUrl);
      if (!source.ok) throw new Error(`Legacy evidence read failed (${source.status}).`);
    } else {
      return Response.json({ error: "This evidence provider is not supported by the current viewer." }, { status: 400 });
    }

    const headers = new Headers();
    headers.set("Content-Type", item.mime_type || source.headers.get("content-type") || "application/octet-stream");
    headers.set("Cache-Control", "private, no-store, max-age=0");
    headers.set("Content-Disposition", `inline; filename="${String(item.original_filename || "evidence").replace(/"/g, "")}"`);
    return new Response(source.body, { status: 200, headers });
  } catch (error) {
    return apiFailure(error);
  }
}
