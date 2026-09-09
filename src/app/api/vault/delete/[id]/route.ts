import { NextRequest, NextResponse } from "next/server";
import { authVaultForFile, canDeleteVault } from "@/lib/vault-auth";
import { logPhiAccess, requestContext } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const BUCKET = "care-circle-vault";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await authVaultForFile(req, params.id);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  if (!canDeleteVault(auth.role)) {
    return NextResponse.json(
      { error: "only a Care Circle admin can delete documents" },
      { status: 403 },
    );
  }

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/vault_files?id=eq.${encodeURIComponent(params.id)}&select=storage_path&limit=1`,
    {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      cache: "no-store",
    },
  );
  if (!r.ok) {
    return NextResponse.json({ error: "lookup failed" }, { status: 502 });
  }
  const rows = (await r.json()) as Array<{ storage_path: string }>;
  if (rows.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const path = rows[0].storage_path;

  const delRow = await fetch(
    `${SUPABASE_URL}/rest/v1/vault_files?id=eq.${encodeURIComponent(params.id)}`,
    {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    },
  );
  if (!delRow.ok) {
    return NextResponse.json({ error: "delete row failed" }, { status: 502 });
  }

  await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {});

  const ctx = requestContext(req.headers);
  await logPhiAccess({
    patientId: auth.patientId,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: "delete",
    resourceType: "vault_file",
    resourceId: params.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return NextResponse.json({ ok: true });
}
