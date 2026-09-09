import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { encryptGCM } from "@/lib/vault-crypto";
import { authVault, canWriteVault } from "@/lib/vault-auth";
import { logPhiAccess, requestContext } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const BUCKET = "care-circle-vault";
const ACCEPTED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const auth = await authVault(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  if (!canWriteVault(auth.role)) {
    return NextResponse.json(
      { error: "your role cannot upload documents" },
      { status: 403 },
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file too large (max 25 MB)" }, { status: 413 });
  }

  const mime = file.type || "application/octet-stream";
  if (!ACCEPTED_MIME.has(mime)) {
    return NextResponse.json(
      { error: "only PDF, JPG, or PNG accepted" },
      { status: 415 },
    );
  }

  const filenameRaw =
    (typeof form.get("filename") === "string" ? (form.get("filename") as string) : "") ||
    (file as File).name ||
    "upload";
  const filename = filenameRaw.slice(0, 200);

  const buf = Buffer.from(await file.arrayBuffer());
  let encrypted: { ivBase64: string; ciphertext: Buffer };
  try {
    encrypted = encryptGCM(buf);
  } catch (e) {
    return NextResponse.json(
      { error: `encrypt failed: ${(e as Error).message}` },
      { status: 500 },
    );
  }

  const objectKey = `${auth.patientId}/${randomUUID()}.enc`;
  const upRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectKey}`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/octet-stream",
        "x-upsert": "false",
      },
      body: new Uint8Array(encrypted.ciphertext),
    },
  );
  if (!upRes.ok) {
    const body = await upRes.text().catch(() => "");
    return NextResponse.json(
      { error: `storage upload ${upRes.status}: ${body.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/vault_files`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      patient_id: auth.patientId,
      filename,
      mime_type: mime,
      size_bytes: buf.length,
      storage_path: objectKey,
      iv: encrypted.ivBase64,
      uploaded_by: auth.userId,
    }),
  });
  if (!insertRes.ok) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectKey}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    }).catch(() => {});
    const body = await insertRes.text().catch(() => "");
    return NextResponse.json(
      { error: `db insert ${insertRes.status}: ${body.slice(0, 200)}` },
      { status: 502 },
    );
  }
  const rows = (await insertRes.json()) as Array<{
    id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    uploaded_at: string;
  }>;

  const ctx = requestContext(req.headers);
  await logPhiAccess({
    patientId: auth.patientId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "upload",
    resourceType: "vault_file",
    resourceId: rows[0].id,
    detail: { filename, mime_type: mime, size_bytes: buf.length },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return NextResponse.json({ file: rows[0] });
}
