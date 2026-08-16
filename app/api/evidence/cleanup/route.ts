import { z } from "zod";
import { apiFailure, requireOfficer } from "../../../../backend/auth";
import { deleteGcsObject } from "../../../../backend/gcs";

const cleanupRequest = z.object({
  objects: z.array(z.object({
    provider: z.string().optional(),
    bucket: z.string().min(1),
    path: z.string().min(1),
  })).max(5000),
});

export async function POST(request: Request) {
  try {
    const { supabase } = await requireOfficer(request, ["admin"]);
    const body = cleanupRequest.parse(await request.json());
    const failures: string[] = [];

    for (const item of body.objects) {
      try {
        if (item.provider === "google_cloud_storage") {
          await deleteGcsObject(item.bucket, item.path);
        } else {
          const { error } = await supabase.storage.from(item.bucket).remove([item.path]);
          if (error) throw error;
        }
      } catch (error) {
        failures.push(`${item.bucket}/${item.path}: ${error instanceof Error ? error.message : "cleanup failed"}`);
      }
    }

    if (failures.length) {
      return Response.json({ error: `Evidence cleanup failed for ${failures.length} object(s).`, failures: failures.slice(0, 20) }, { status: 502 });
    }
    return Response.json({ deleted: body.objects.length });
  } catch (error) {
    return apiFailure(error);
  }
}
