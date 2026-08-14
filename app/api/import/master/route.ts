import { z } from "zod";
import { apiFailure, requireOfficer } from "../../../../backend/auth";
import { encryptCredential } from "../../../../backend/crypto";

const masterRecord = z.object({ sourceRowNumber: z.number().int().positive(), name: z.string().trim().min(1), userId: z.string().trim().min(1), password: z.string(), block: z.string().nullable(), group: z.enum(["Krishi Sakhi", "Vendor", "SeSTA"]).nullable(), rawFields: z.record(z.string(), z.unknown()) });
const bodySchema = z.object({ sourceLabel: z.string().trim().min(1), originalFilename: z.string().trim().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/i), mimeType: z.string().trim().min(1), rowCount: z.number().int().nonnegative(), headerMap: z.record(z.string(), z.string()), records: z.array(masterRecord).min(1) });

export async function POST(request: Request) {
  try {
    const { supabase } = await requireOfficer(request, ["admin", "technical_officer"]);
    const body = bodySchema.parse(await request.json());
    const records = await Promise.all(body.records.map(async (record) => ({ name: record.name, user_id: record.userId, password_ciphertext: await encryptCredential(record.password), block: record.block, group: record.group, source_row_number: record.sourceRowNumber, extra_fields: record.rawFields })));
    const { data, error } = await supabase.rpc("ingest_master_payload", { p_payload: { source_label: body.sourceLabel, original_filename: body.originalFilename, sha256: body.sha256, mime_type: body.mimeType, row_count: body.rowCount, header_map: body.headerMap, records } });
    if (error) throw new Error(error.code === "23505" ? "This exact source file was already imported; nothing was duplicated." : error.message);
    return Response.json({ result: data });
  } catch (error) { return apiFailure(error); }
}
