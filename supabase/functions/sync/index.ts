// Edge Function "sync": importiert Tabellen, Spiele und Resultate von footstats.ch.
//
// Aufruf (nur mit Header x-sync-secret, kommt aus private.config):
//   POST /functions/v1/sync?mode=leagues   Liga-Seiten -> Gruppen + Tabellen
//   POST /functions/v1/sync?mode=teams     Team-Spielpläne (Portion von ~40 Teams)
//   POST /functions/v1/sync?mode=all       beides + Aufräumen
//
// footstats.ch erlaubt laut robots.txt alle Seiten ausser /api/.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const BASE = "https://footstats.ch";
const TEAM_BATCH = 40;
const PARALLEL = 4;

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function decode(s: string): string {
  return s
    .replace(/<!-- -->/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(s: string): string {
  return decode(s.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, ""));
}

async function fetchPage(path: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; TippspielSync/1.0)",
          "Accept": "text/html",
          "Accept-Language": "de-CH,de",
        },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 404) throw new Error(`404 ${path}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (String(e).includes("404")) break;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------------
// Parser: Liga-Seite
// ---------------------------------------------------------------------------

type Standing = {
  fs_team_id: string; team_name: string; rank: number; played: number;
  won: number; drawn: number; lost: number; gf: number; ga: number; points: number;
  logo: string | null;
};
type Group = { fs_group_id: string; name: string; standings: Standing[] };

export function parseLeague(html: string): { season: string | null; groups: Group[] } {
  const season = html.match(/<title>[^<]*?(\d{4}\/\d{2})/)?.[1] ?? null;
  const parts = html.split('<section id="group-');
  const groups: Group[] = [];

  for (const part of parts.slice(1)) {
    const id = part.slice(0, part.indexOf('"'));
    const heading = part.match(/<h2[^>]*>([^<]*)<\/h2>/)?.[1] ?? "";
    const name = decode(heading).replace(/^Tabelle\s*·\s*/, "") || "Gruppe";
    const tbody = part.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
    if (!id || !tbody) continue;

    const standings: Standing[] = [];
    for (const row of tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
      if (cells.length < 8) continue;
      const teamId = cells[1].match(/href="\/de\/teams\/([^/"]+)\//)?.[1];
      if (!teamId) continue;
      const teamName = decode(cells[1].match(/<span class="truncate">([^<]*)<\/span>/)?.[1] ?? "") ||
        stripTags(cells[1]);
      // Vereinswappen: <img src="/_next/image/?url=https%3A%2F%2F...png%3Fv%3D...&amp;w=48">
      const logoEnc = cells[1].match(/src="\/_next\/image\/\?url=([^&"]+)/)?.[1];
      let logo: string | null = null;
      try { logo = logoEnc ? decodeURIComponent(logoEnc) : null; } catch { logo = null; }
      if (logo && !/^https:\/\/[a-z0-9.-]+\.amazonaws\.com\//.test(logo)) logo = null;
      const goals = stripTags(cells[6]).match(/(\d+)\s*-\s*(\d+)/);
      const num = (s: string) => parseInt(stripTags(s), 10) || 0;
      standings.push({
        fs_team_id: teamId,
        team_name: teamName,
        rank: num(cells[0]),
        played: num(cells[2]),
        won: num(cells[3]),
        drawn: num(cells[4]),
        lost: num(cells[5]),
        gf: goals ? parseInt(goals[1], 10) : 0,
        ga: goals ? parseInt(goals[2], 10) : 0,
        points: num(cells[7]),
        logo,
      });
    }
    if (standings.length > 0) groups.push({ fs_group_id: id, name, standings });
  }
  return { season, groups };
}

// ---------------------------------------------------------------------------
// Parser: Team-Spielplan
// ---------------------------------------------------------------------------

type Match = {
  date: string; time: string; home_id: string; home_name: string;
  away_id: string; away_name: string; home_goals: number | null; away_goals: number | null;
};

export function parseTeamMatches(html: string): Match[] {
  const token =
    /<h2[^>]*>(\d\d)\.(\d\d)\.(\d{4})<\/h2>|min-h-\[76px\]|>(\d\d:\d\d)<\/span>|href="\/de\/teams\/([^/"]+)\/"[^>]*>((?:(?!<\/a>)[\s\S])*)<\/a>|<span>(\d*)<\/span><span>(\d*)<\/span>/g;

  const out: Match[] = [];
  let date: string | null = null;
  let cur: { time: string; teams: { id: string; name: string }[] } | null = null;

  for (const m of html.matchAll(token)) {
    if (m[1]) {
      date = `${m[3]}-${m[2]}-${m[1]}`;
      cur = null;
    } else if (m[0] === "min-h-[76px]") {
      cur = date ? { time: "", teams: [] } : null;
    } else if (m[4]) {
      if (cur && cur.teams.length === 0) cur.time = m[4];
    } else if (m[5]) {
      if (cur && cur.teams.length < 2) {
        const name = decode(m[6].match(/<span class="truncate">([^<]*)<\/span>/)?.[1] ?? "") ||
          stripTags(m[6]);
        cur.teams.push({ id: m[5], name });
      }
    } else if (m[7] !== undefined) {
      if (cur && date && cur.teams.length === 2) {
        const hg = m[7] === "" ? null : parseInt(m[7], 10);
        const ag = m[8] === "" ? null : parseInt(m[8], 10);
        out.push({
          date,
          time: cur.time,
          home_id: cur.teams[0].id,
          home_name: cur.teams[0].name,
          away_id: cur.teams[1].id,
          away_name: cur.teams[1].name,
          home_goals: hg !== null && ag !== null ? hg : null,
          away_goals: hg !== null && ag !== null ? ag : null,
        });
        cur = null;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sync-Schritte
// ---------------------------------------------------------------------------

async function syncLeagues() {
  const { data: leagues, error } = await db
    .from("source_leagues").select("slug").eq("active", true).order("sort_order");
  if (error) throw error;

  const results = await pool(leagues ?? [], PARALLEL, async ({ slug }) => {
    try {
      const html = await fetchPage(`/de/leagues/${slug}/`);
      const { season, groups } = parseLeague(html);
      if (groups.length === 0) return { slug, ok: false, error: "keine Gruppen gefunden" };
      const { data, error } = await db.rpc("fs_sync_league", {
        p_slug: slug, p_season: season, p_groups: groups,
      });
      if (error) throw error;
      // Vereinswappen separat speichern
      const logos = groups.flatMap((g) => g.standings.filter((s) => s.logo).map((s) => ({ fs_team_id: s.fs_team_id, logo: s.logo })));
      if (logos.length) {
        const { error: le } = await db.rpc("fs_set_team_logos", { p_logos: logos });
        if (le) throw le;
      }
      return { slug, ok: true, groups: data, teams: groups.reduce((s, g) => s + g.standings.length, 0) };
    } catch (e) {
      return { slug, ok: false, error: String(e) };
    }
  });
  return results;
}

async function syncTeams(limit: number) {
  const { data: teams, error } = await db.rpc("fs_teams_to_refresh", { p_limit: limit });
  if (error) throw error;

  const results = await pool((teams ?? []) as { fs_team_id: string; reason: string }[], PARALLEL,
    async ({ fs_team_id, reason }) => {
      try {
        const html = await fetchPage(`/de/teams/${fs_team_id}/matches/`);
        const matches = parseTeamMatches(html);
        const { data, error } = await db.rpc("fs_sync_team_matches", {
          p_fs_team_id: fs_team_id, p_matches: matches,
        });
        if (error) throw error;
        return { team: fs_team_id, reason, ok: true, found: matches.length, changed: data };
      } catch (e) {
        return { team: fs_team_id, reason, ok: false, error: String(e) };
      }
    });
  return results;
}

// ---------------------------------------------------------------------------
// HTTP-Einstieg
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  const secret = req.headers.get("x-sync-secret") ?? "";
  const { data: valid } = await db.rpc("fs_check_secret", { p_secret: secret });
  if (!valid) return new Response("forbidden", { status: 403 });

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "all";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "", 10) || TEAM_BATCH, 100);
  const started = Date.now();
  const summary: Record<string, unknown> = { mode };

  try {
    if (mode === "leagues" || mode === "all") {
      const r = await syncLeagues();
      summary.leagues_ok = r.filter((x) => x.ok).length;
      summary.leagues_failed = r.filter((x) => !x.ok);
    }
    if (mode === "teams" || mode === "all") {
      const r = await syncTeams(limit);
      summary.teams_ok = r.filter((x) => x.ok).length;
      summary.teams_failed = r.filter((x) => !x.ok);
      summary.matches_changed = r.reduce((s, x) => s + (x.ok ? Number(x.changed) : 0), 0);
    }
    if (mode === "all") {
      const { data } = await db.rpc("fs_housekeeping");
      summary.cancelled = data;
    }
    summary.ms = Date.now() - started;
    const failed = ((summary.leagues_failed as unknown[]) ?? []).length +
      ((summary.teams_failed as unknown[]) ?? []).length;
    await db.from("sync_log").insert({ kind: `sync:${mode}`, ok: failed === 0, detail: summary });
    return Response.json(summary);
  } catch (e) {
    summary.error = String(e);
    summary.ms = Date.now() - started;
    await db.from("sync_log").insert({ kind: `sync:${mode}`, ok: false, detail: summary });
    return Response.json(summary, { status: 500 });
  }
});
