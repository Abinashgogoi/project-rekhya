import { z } from "zod";
import { apiFailure, requireOfficer } from "../../../../backend/auth";

const portalRecord = z.object({ sourceRowNumber: z.number().int().positive(), userId: z.string().trim().min(1), transactionDate: z.string().date(), amount: z.number().nonnegative().nullable(), policyId: z.string().nullable(), applicantName: z.string().nullable(), status: z.string().nullable(), fingerprintSource: z.string().min(1), possibleDuplicateWithinFile: z.boolean(), rawFields: z.record(z.string(), z.unknown()) });
const bodySchema = z.object({ sourceLabel: z.string().trim().min(1), originalFilename: z.string().trim().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/i), mimeType: z.string().trim().min(1), rowCount: z.number().int().nonnegative(), ignoredOutOfScope: z.number().int().nonnegative(), headerMap: z.record(z.string(), z.string()), records: z.array(portalRecord).min(1) });

export async function POST(request: Request) {
  try {
    const { supabase } = await requireOfficer(request, ["admin", "technical_officer"]);
    const body = bodySchema.parse(await request.json());
    const records = body.records.map((record) => ({ source_row_number: record.sourceRowNumber, user_id: record.userId, transaction_date: record.transactionDate, amount: record.amount, policy_id: record.policyId, applicant_name: record.applicantName, status: record.status, fingerprint_source: record.fingerprintSource, possible_duplicate_within_file: record.possibleDuplicateWithinFile, raw_fields: record.rawFields }));
    const { data, error } = await supabase.rpc("ingest_portal_payload", { p_payload: { source_label: body.sourceLabel, original_filename: body.originalFilename, sha256: body.sha256, mime_type: body.mimeType, row_count: body.rowCount, ignored_out_of_scope: body.ignoredOutOfScope, header_map: body.headerMap, records } });
    if (error) throw new Error(error.code === "23505" ? "This exact source file was already imported; nothing was duplicated." : error.message);
    return Response.json({ result: data });
  } catch (error) { return apiFailure(error); }
}
