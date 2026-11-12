// Edge Function "logos": lädt die Vereinswappen von footstats.ch herunter und legt sie
// im eigenen Supabase-Speicher (Bucket "logos") ab. Danach zeigt die App nur noch eigene Kopien.
// Aufruf nur mit Header x-sync-secret.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function sniff(b: Uint8Array): { mime: string; ext: string; w: number | null; h: number | null } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { mime: "image/png", ext: "png", w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { mime: "image/gif", ext: "gif", w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    // JPEG: SOF-Marker suchen
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = dv.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3) return { mime: "image/jpeg", ext: "jpg", w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) };
      i += 2 + len;
    }
    return { mime: "image/jpeg", ext: "jpg", w: null, h: null };
  }
  if (b.length > 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return { mime: "image/webp", ext: "webp", w: null, h: null };
  }
  const head = new TextDecoder().decode(b.slice(0, 200)).toLowerCase();
  if (head.includes("<svg") || head.includes("<?xml")) return { mime: "image/svg+xml", ext: "svg", w: null, h: null };
  return null;
}

Deno.serve(async (req) => {
  const { data: valid } = await db.rpc("fs_check_secret", { p_secret: req.headers.get("x-sync-secret") ?? "" });
  if (!valid) return new Response("forbidden", { status: 403 });

  const started = Date.now();
  const { data: list, error } = await db.rpc("logos_to_mirror", { p_limit: 200 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results: Record<string, unknown>[] = [];
  const queue = [...(list as { source: string }[])];
  const worker = async () => {
    while (queue.length) {
      const { source } = queue.shift()!;
      try {
        if (!/^https:\/\/[a-z0-9.-]+\.amazonaws\.com\//.test(source)) throw new Error("unbekannte Quelle");
        const res = await fetch(source, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const info = sniff(bytes);
        if (!info) throw new Error("kein Bild");
        const base = source.split("/").pop()!.replace(/\.[a-z]+$/i, "");
        const path = `club/${base}.${info.ext}`;
        const { error: upErr } = await db.storage.from("logos").upload(path, bytes, { contentType: info.mime, upsert: true });
        if (upErr) throw upErr;
        const url = db.storage.from("logos").getPublicUrl(path).data.publicUrl;
        const { data: n, error: e2 } = await db.rpc("logo_mirrored", {
          p_source: source, p_url: url, p_mime: info.mime, p_bytes: bytes.length, p_w: info.w, p_h: info.h,
        });
        if (e2) throw e2;
        results.push({ source, ok: true, w: info.w, h: info.h, mime: info.mime, teams: n });
      } catch (e) {
        results.push({ source, ok: false, error: String(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  const summary = {
    mirrored: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    ms: Date.now() - started,
  };
  await db.from("sync_log").insert({ kind: "logos", ok: summary.failed.length === 0, detail: summary });
  return Response.json({ ...summary, results });
});
