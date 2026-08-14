import { apiFailure, requireOfficer } from "../../../../backend/auth";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireOfficer(request, ["admin", "technical_officer"]);
    const { data: pending, error: pendingError } = await supabase
      .from("worker_credentials")
      .select("worker_id,updated_at")
      .eq("password_missing", true)
      .order("updated_at", { ascending: true });
    if (pendingError) throw new Error(pendingError.message);
    const workerIds = (pending ?? []).map((item) => item.worker_id);
    if (!workerIds.length) return Response.json({ items: [] }, { headers: { "Cache-Control": "no-store" } });

    const { data: workers, error: workerError } = await supabase
      .from("workers")
      .select("id,user_id,name")
      .in("id", workerIds)
      .eq("active", true)
      .is("deleted_at", null)
      .is("source_deleted_by_file_id", null)
      .order("user_id");
    if (workerError) throw new Error(workerError.message);
    const updatedAt = new Map((pending ?? []).map((item) => [item.worker_id, item.updated_at]));
    const items = (workers ?? []).map((worker) => ({
      worker_id: worker.id,
      user_id: worker.user_id,
      name: worker.name,
      updated_at: updatedAt.get(worker.id) ?? null,
    }));
    return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
