// Edge Function "logos": erstellt eigene RegioTipp-Vereinsabzeichen (Schild in Vereinsfarben mit Kürzel).
// Die Original-Wappen von footstats.ch werden nur kurz geladen, um die Vereinsfarben auszulesen,
// und nicht gespeichert. Die Abzeichen liegen im Bucket "logos" unter badge/.
// Aufruf nur mit Header x-sync-secret.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { decode } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { badgeSvg, clubName, initials, palette } from "./badge.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function colorsOf(source: string): Promise<[string, string]> {
  try {
    if (!/^https:\/\/[a-z0-9.-]+\.amazonaws\.com\//.test(source)) throw new Error("unbekannte Quelle");
    const res = await fetch(source, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // deno-lint-ignore no-explicit-any
    const img: any = await decode(new Uint8Array(await res.arrayBuffer()), true);
    const frame = Array.isArray(img) ? img[0] : img;
    return palette(frame.bitmap);
  } catch {
    return ["#0b6e4f", "#ffffff"]; // RegioTipp-Grün als Rückfall
  }
}

Deno.serve(async (req) => {
  const { data: valid } = await db.rpc("fs_check_secret", { p_secret: req.headers.get("x-sync-secret") ?? "" });
  if (!valid) return new Response("forbidden", { status: 403 });

  const started = Date.now();
  const { data: list, error } = await db.rpc("badges_todo", { p_limit: 300 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results: Record<string, unknown>[] = [];
  const queue = [...(list as { source: string; team_names: string[] }[])];
  const worker = async () => {
    while (queue.length) {
      const { source, team_names } = queue.shift()!;
      try {
        const club = clubName(team_names);
        const ini = initials(club);
        const [c1, c2] = await colorsOf(source);
        const svg = badgeSvg(ini, c1, c2);
        const id = source.split("/").pop()!.replace(/\.[a-z]+$/i, "");
        const path = `badge/${id}.svg`;
        const { error: upErr } = await db.storage.from("logos")
          .upload(path, new TextEncoder().encode(svg), { contentType: "image/svg+xml", upsert: true, cacheControl: "86400" });
        if (upErr) throw upErr;
        const url = db.storage.from("logos").getPublicUrl(path).data.publicUrl + `?v=${Date.now().toString(36)}`;
        const { data: n, error: e2 } = await db.rpc("badge_saved", {
          p_source: source, p_url: url, p_club: club, p_initials: ini, p_c1: c1, p_c2: c2,
        });
        if (e2) throw e2;
        results.push({ club, ini, c1, c2, teams: n, ok: true });
      } catch (e) {
        results.push({ source, ok: false, error: String(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  // Früher gespeicherte Original-Wappen entfernen (nur noch eigene Abzeichen im Speicher)
  let removed = 0;
  const { data: old } = await db.storage.from("logos").list("club", { limit: 1000 });
  if (old?.length) {
    const { data: rm } = await db.storage.from("logos").remove(old.map((f) => `club/${f.name}`));
    removed = rm?.length ?? 0;
  }

  const summary = { created: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok), removed, ms: Date.now() - started };
  await db.from("sync_log").insert({ kind: "badges", ok: summary.failed.length === 0, detail: summary });
  return Response.json({ ...summary, results });
});
