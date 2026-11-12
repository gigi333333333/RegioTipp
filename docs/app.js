// RegioTipp – Resultat-Tippspiel für FVRZ-Spiele
// Reine Web-App ohne Build-Schritt; Daten und Logik liegen in Supabase.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const $view = document.getElementById("view");
const $tabbar = document.getElementById("tabbar");
const $topRight = document.getElementById("topbar-right");
const $toast = document.getElementById("toast");

const state = {
  session: null,
  profile: null,
  sourceLeagues: [],
  leagues: [],
  recovery: false,
};

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TZ = "Europe/Zurich";
const fmtDay = (d) => new Intl.DateTimeFormat("de-CH", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(d));
const fmtTime = (d) => new Intl.DateTimeFormat("de-CH", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(d));
const fmtShort = (d) => new Intl.DateTimeFormat("de-CH", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));

function toast(msg, isError = false) {
  $toast.textContent = msg;
  $toast.className = "toast" + (isError ? " error" : "");
  $toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { $toast.hidden = true; }, isError ? 4500 : 2200);
}

function errMsg(e) {
  const m = e?.message || String(e);
  if (/Invalid login credentials/i.test(m)) return "E-Mail oder Passwort falsch.";
  if (/Email not confirmed/i.test(m)) return "Bitte bestätige zuerst deine E-Mail-Adresse (Link im Mail).";
  if (/User already registered/i.test(m)) return "Für diese E-Mail gibt es schon ein Konto.";
  if (/Password should be at least/i.test(m)) return "Das Passwort muss mindestens 6 Zeichen lang sein.";
  if (/rate limit/i.test(m)) return "Zu viele Versuche. Bitte warte kurz.";
  return m;
}

const store = {
  get(k, d) { try { const v = localStorage.getItem("rt_" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("rt_" + k, JSON.stringify(v)); } catch { /* egal */ } },
};

function html(strings, ...vals) {
  return strings.reduce((a, s, i) => a + s + (i < vals.length ? vals[i] : ""), "");
}

function setView(content) { $view.innerHTML = content; }

function pointsBadge(p, max = 10) {
  if (p === null || p === undefined) return "";
  const cls = p === 0 ? "badge zero" : p >= max ? "badge top" : "badge";
  return `<span class="${cls}">${p} P</span>`;
}

function leagueLabel(m) {
  if (m.is_cup) return `<span class="cup">Cup / Freundschaft</span>`;
  return esc(`${m.source_name ?? ""} · ${m.league_name ?? ""}`);
}

const appUrl = () => location.origin + location.pathname;

// ---------------------------------------------------------------------------
// Start und Routing
// ---------------------------------------------------------------------------

async function loadProfile() {
  if (!state.session) { state.profile = null; return; }
  const { data, error } = await sb.from("profiles").select("*").eq("id", state.session.user.id).maybeSingle();
  if (error) throw error;
  state.profile = data;
}

async function loadMeta() {
  if (state.sourceLeagues.length) return;
  const [a, b] = await Promise.all([
    sb.from("source_leagues").select("slug,name,category,sort_order").eq("active", true).order("sort_order"),
    sb.from("leagues").select("id,source_slug,name,season").eq("active", true).order("name"),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  state.sourceLeagues = a.data;
  state.leagues = b.data;
}

function renderTop() {
  if (state.profile) {
    $topRight.innerHTML = `<a href="#/profil" style="color:#fff;text-decoration:none">👤 ${esc(state.profile.username)}</a>`;
  } else {
    $topRight.textContent = "";
  }
}

async function route() {
  const hash = location.hash || "#/spiele";
  const [, page, arg] = hash.split("/");

  // Einladungslink merken, auch wenn man noch nicht angemeldet ist
  const joinCode = new URLSearchParams(location.search).get("join") || (page === "join" ? arg : null);
  if (joinCode) store.set("pendingJoin", joinCode.toUpperCase());

  if (state.recovery) return renderNewPassword();
  if (!state.session) { $tabbar.hidden = true; renderTop(); return renderAuth(); }
  if (!state.profile) {
    try { await loadProfile(); } catch (e) { return setView(`<p class="err">${esc(errMsg(e))}</p>`); }
    if (!state.profile) {
      return setView(`<div class="card"><p>Dein Profil wird erstellt … Bitte lade die Seite in ein paar Sekunden neu.</p></div>`);
    }
  }
  $tabbar.hidden = false;
  renderTop();

  const pending = store.get("pendingJoin", null);
  if (pending) {
    store.set("pendingJoin", null);
    if (location.search) history.replaceState(null, "", location.pathname + "#/gruppen");
    try {
      const { data, error } = await sb.rpc("join_group", { p_code: pending });
      if (error) throw error;
      toast(`Du bist der Gruppe „${data.name}“ beigetreten.`);
    } catch (e) { toast(errMsg(e), true); }
    location.hash = "#/gruppen";
    return;
  }

  const tab = { spiele: "spiele", resultate: "resultate", spiel: "resultate", rangliste: "rangliste",
                gruppen: "gruppen", gruppe: "gruppen" }[page] ?? "mehr";
  for (const a of $tabbar.querySelectorAll("a")) a.classList.toggle("on", a.dataset.tab === tab);

  setView(`<div class="loading">Laden …</div>`);
  try {
    switch (page) {
      case "spiele": return await renderSpiele();
      case "resultate": return await renderResultate();
      case "spiel": return await renderSpielDetail(Number(arg));
      case "rangliste": return await renderRangliste(arg);
      case "gruppen": return await renderGruppen();
      case "gruppe": return await renderGruppe(arg);
      case "tabellen": return await renderTabellen();
      case "profil": return renderProfil();
      case "regeln": return renderRegeln();
      case "admin": return await renderAdmin();
      case "mehr": return renderMehr();
      default: location.hash = "#/spiele";
    }
  } catch (e) {
    console.error(e);
    setView(`<div class="card"><p class="err">Fehler: ${esc(errMsg(e))}</p><button class="btn" onclick="location.reload()">Neu laden</button></div>`);
  }
}

window.addEventListener("hashchange", route);

sb.auth.onAuthStateChange((event, session) => {
  const changed = (state.session?.user?.id ?? null) !== (session?.user?.id ?? null);
  state.session = session;
  if (event === "PASSWORD_RECOVERY") { state.recovery = true; route(); return; }
  if (changed) { state.profile = null; route(); }
});

(async () => {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  route();
})();

// ---------------------------------------------------------------------------
// Login / Registrieren
// ---------------------------------------------------------------------------

function renderAuth(mode = "login") {
  setView(html`
    <div class="auth">
      <h1>Willkommen beim RegioTipp</h1>
      <p class="muted">Tippe die Resultate der FVRZ-Spiele, sammle Punkte und miss dich mit deinen Freunden.</p>
      <div class="tabs2">
        <button data-mode="login" class="${mode === "login" ? "on" : ""}">Anmelden</button>
        <button data-mode="register" class="${mode === "register" ? "on" : ""}">Registrieren</button>
      </div>
      <form id="authform" class="card">
        ${mode === "register" ? `
        <label class="field"><span>Benutzername (sichtbar in der Rangliste)</span>
          <input type="text" name="username" minlength="2" maxlength="30" required autocomplete="nickname"></label>` : ""}
        <label class="field"><span>E-Mail</span>
          <input type="email" name="email" required autocomplete="email"></label>
        ${mode !== "reset" ? `
        <label class="field"><span>Passwort</span>
          <input type="password" name="password" minlength="6" required autocomplete="${mode === "register" ? "new-password" : "current-password"}"></label>` : ""}
        <button class="btn primary block" type="submit">${mode === "login" ? "Anmelden" : mode === "register" ? "Konto erstellen" : "Link senden"}</button>
        ${mode === "login" ? `<p class="small" style="text-align:center"><a href="#" id="forgot">Passwort vergessen?</a></p>` : ""}
        ${mode === "reset" ? `<p class="small" style="text-align:center"><a href="#" id="back">Zurück zur Anmeldung</a></p>` : ""}
      </form>
    </div>`);

  for (const b of $view.querySelectorAll(".tabs2 button")) b.onclick = () => renderAuth(b.dataset.mode);
  $view.querySelector("#forgot")?.addEventListener("click", (e) => { e.preventDefault(); renderAuth("reset"); });
  $view.querySelector("#back")?.addEventListener("click", (e) => { e.preventDefault(); renderAuth("login"); });

  $view.querySelector("#authform").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      if (mode === "login") {
        const { error } = await sb.auth.signInWithPassword({ email: f.get("email"), password: f.get("password") });
        if (error) throw error;
      } else if (mode === "register") {
        const { data, error } = await sb.auth.signUp({
          email: f.get("email"), password: f.get("password"),
          options: { data: { username: String(f.get("username")).trim() }, emailRedirectTo: appUrl() },
        });
        if (error) throw error;
        if (!data.session) {
          setView(`<div class="auth card"><h1>Fast geschafft</h1><p>Wir haben dir ein Mail an <b>${esc(f.get("email"))}</b> geschickt. Klicke auf den Link darin, um dein Konto zu bestätigen.</p><p class="muted small">Kein Mail? Schau im Spam-Ordner nach.</p></div>`);
        }
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(f.get("email"), { redirectTo: appUrl() });
        if (error) throw error;
        setView(`<div class="auth card"><h1>Mail unterwegs</h1><p>Falls es ein Konto mit dieser Adresse gibt, bekommst du einen Link zum Zurücksetzen des Passworts.</p></div>`);
      }
    } catch (err) {
      toast(errMsg(err), true);
      btn.disabled = false;
    }
  };
}

function renderNewPassword() {
  $tabbar.hidden = true;
  setView(`
    <div class="auth">
      <h1>Neues Passwort</h1>
      <form id="pwform" class="card">
        <label class="field"><span>Neues Passwort</span><input type="password" name="pw" minlength="6" required autocomplete="new-password"></label>
        <button class="btn primary block">Speichern</button>
      </form>
    </div>`);
  $view.querySelector("#pwform").onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: new FormData(e.target).get("pw") });
    if (error) return toast(errMsg(error), true);
    state.recovery = false;
    toast("Passwort gespeichert.");
    location.hash = "#/spiele";
    route();
  };
}

// ---------------------------------------------------------------------------
// Tippen
// ---------------------------------------------------------------------------

function filterControls(f) {
  const cats = [...new Set(state.sourceLeagues.map((s) => s.category))];
  const slugs = state.sourceLeagues.filter((s) => !f.cat || f.cat === "cup" || s.category === f.cat);
  const groups = state.leagues.filter((l) => l.source_slug === f.slug);
  return html`
    <div class="chips" id="catchips">
      <button class="chip ${!f.cat ? "on" : ""}" data-cat="">Alle</button>
      ${cats.map((c) => `<button class="chip ${f.cat === c ? "on" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}
      <button class="chip ${f.cat === "cup" ? "on" : ""}" data-cat="cup">Cup</button>
    </div>
    ${f.cat && f.cat !== "cup" ? `
    <div class="filters">
      <select id="f-slug" class="${f.slug ? "" : "full"}" aria-label="Liga">
        <option value="">Alle Ligen</option>
        ${slugs.map((s) => `<option value="${esc(s.slug)}" ${f.slug === s.slug ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
      </select>
      ${f.slug ? `
      <select id="f-league" aria-label="Gruppe">
        <option value="">Alle Gruppen</option>
        ${groups.map((l) => `<option value="${l.id}" ${String(f.league) === String(l.id) ? "selected" : ""}>${esc(l.name)}</option>`).join("")}
      </select>` : ""}
    </div>` : ""}`;
}

function bindFilters(f, rerender) {
  for (const b of $view.querySelectorAll("#catchips .chip")) {
    b.onclick = () => { f.cat = b.dataset.cat; f.slug = ""; f.league = ""; store.set("filter", f); rerender(); };
  }
  const s = $view.querySelector("#f-slug");
  if (s) s.onchange = () => { f.slug = s.value; f.league = ""; store.set("filter", f); rerender(); };
  const l = $view.querySelector("#f-league");
  if (l) l.onchange = () => { f.league = l.value; store.set("filter", f); rerender(); };
}

function applyFilter(q, f) {
  if (f.cat === "cup") q = q.eq("is_cup", true);
  else if (f.cat) q = q.eq("category", f.cat);
  if (f.slug) q = q.eq("source_slug", f.slug);
  if (f.league) q = q.eq("league_id", Number(f.league));
  return q;
}

async function myTipsFor(ids) {
  if (!ids.length) return new Map();
  const { data, error } = await sb.from("tips").select("match_id,home_goals,away_goals,points")
    .eq("user_id", state.session.user.id).in("match_id", ids);
  if (error) throw error;
  return new Map(data.map((t) => [t.match_id, t]));
}

async function renderSpiele() {
  await loadMeta();
  const f = store.get("filter", { cat: "", slug: "", league: "" });
  let days = 7;

  const draw = async () => {
    const until = new Date(Date.now() + days * 86400000).toISOString();
    let q = sb.from("match_list").select("*").eq("status", "scheduled")
      .gt("kickoff", new Date().toISOString()).lte("kickoff", until)
      .order("kickoff").order("id").limit(300);
    q = applyFilter(q, f);
    const { data: matches, error } = await q;
    if (error) throw error;
    const tips = await myTipsFor(matches.map((m) => m.id));
    const open = matches.filter((m) => !tips.has(m.id)).length;

    let lastDay = "";
    const items = matches.map((m) => {
      const t = tips.get(m.id);
      const dk = dayKey(m.kickoff);
      const head = dk !== lastDay ? `<div class="day">${esc(fmtDay(m.kickoff))}</div>` : "";
      lastDay = dk;
      return head + html`
        <div class="match" data-id="${m.id}">
          <div class="meta"><span class="league">${leagueLabel(m)}</span><span>${fmtTime(m.kickoff)}</span></div>
          <div class="line">
            <div class="teams">
              <div class="team">${esc(m.home_name)}</div>
              <div class="team">${esc(m.away_name)}</div>
            </div>
            <div class="scores">
              <input class="score-in" data-side="h" type="number" inputmode="numeric" min="0" max="30" aria-label="Tore ${esc(m.home_name)}" value="${t ? t.home_goals : ""}">
              <input class="score-in" data-side="a" type="number" inputmode="numeric" min="0" max="30" aria-label="Tore ${esc(m.away_name)}" value="${t ? t.away_goals : ""}">
            </div>
          </div>
          <div class="foot"><span class="status">${t ? '<span class="saved">✓ getippt</span>' : '<span class="muted">noch nicht getippt</span>'}</span>${m.is_cup ? '<span class="cup small">doppelte Punkte</span>' : ""}</div>
        </div>`;
    }).join("");

    setView(html`
      <h1>Tippen</h1>
      ${filterControls(f)}
      <p class="muted small">${matches.length} Spiele in den nächsten ${days} Tagen${matches.length ? ` · ${open} noch offen` : ""}. Tipps sind bis zum Anpfiff änderbar.</p>
      ${items || `<div class="empty">Keine Spiele in diesem Zeitraum.</div>`}
      ${days < 120 ? `<button class="btn block" id="more">Weitere Spiele laden</button>` : ""}
    `);
    bindFilters(f, draw);
    $view.querySelector("#more")?.addEventListener("click", () => { days = days < 14 ? 14 : days < 30 ? 30 : 120; draw(); });
    bindTipInputs();
  };
  await draw();
}

function bindTipInputs() {
  for (const card of $view.querySelectorAll(".match[data-id]")) {
    const inputs = card.querySelectorAll(".score-in");
    const status = card.querySelector(".status");
    let timer;
    const save = async () => {
      const h = inputs[0].value.trim(), a = inputs[1].value.trim();
      const id = Number(card.dataset.id);
      try {
        if (h === "" && a === "") {
          const { error } = await sb.rpc("delete_tip", { p_match_id: id });
          if (error) throw error;
          status.innerHTML = '<span class="muted">Tipp gelöscht</span>';
        } else if (h !== "" && a !== "") {
          const hn = parseInt(h, 10), an = parseInt(a, 10);
          if (!(hn >= 0 && hn <= 30 && an >= 0 && an <= 30)) throw new Error("Bitte Zahlen von 0 bis 30 eingeben");
          const { error } = await sb.rpc("save_tip", { p_match_id: id, p_home: hn, p_away: an });
          if (error) throw error;
          status.innerHTML = `<span class="saved">✓ gespeichert (${hn}:${an})</span>`;
        } else {
          status.innerHTML = '<span class="muted">beide Werte eingeben …</span>';
        }
      } catch (e) {
        status.innerHTML = `<span class="err">${esc(errMsg(e))}</span>`;
      }
    };
    for (const inp of inputs) {
      inp.addEventListener("input", () => {
        if (inp.value.length > 2) inp.value = inp.value.slice(0, 2);
        clearTimeout(timer);
        timer = setTimeout(save, 700);
        // nach Eingabe der Heimtore direkt zu den Gasttoren springen
        if (inp.dataset.side === "h" && inp.value !== "") inputs[1].focus();
      });
      inp.addEventListener("focus", () => inp.select());
    }
  }
}

// ---------------------------------------------------------------------------
// Resultate (eigene Tipps mit Punkten)
// ---------------------------------------------------------------------------

async function renderResultate() {
  await loadMeta();
  const f = store.get("filterRes", { cat: "", slug: "", league: "", mine: true });
  let days = 7;

  const draw = async () => {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    let matches, tips;
    if (f.mine) {
      const { data: myTips, error } = await sb.from("tips").select("match_id,home_goals,away_goals,points")
        .eq("user_id", state.session.user.id);
      if (error) throw error;
      tips = new Map(myTips.map((t) => [t.match_id, t]));
      const ids = myTips.map((t) => t.match_id);
      matches = [];
      for (let i = 0; i < ids.length; i += 150) {
        let q = sb.from("match_list").select("*").in("id", ids.slice(i, i + 150))
          .lte("kickoff", new Date().toISOString()).gte("kickoff", since);
        q = applyFilter(q, f);
        const { data, error: e2 } = await q;
        if (e2) throw e2;
        matches.push(...data);
      }
    } else {
      let q = sb.from("match_list").select("*").eq("status", "finished")
        .lte("kickoff", new Date().toISOString()).gte("kickoff", since)
        .order("kickoff", { ascending: false }).limit(300);
      q = applyFilter(q, f);
      const { data, error } = await q;
      if (error) throw error;
      matches = data;
      tips = await myTipsFor(matches.map((m) => m.id));
    }
    matches.sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff) || a.id - b.id);

    const total = [...tips.values()].reduce((s, t) => s + (matches.some((m) => m.id === t.match_id) ? (t.points ?? 0) : 0), 0);
    let lastDay = "";
    const items = matches.map((m) => {
      const t = tips.get(m.id);
      const dk = dayKey(m.kickoff);
      const head = dk !== lastDay ? `<div class="day">${esc(fmtDay(m.kickoff))}</div>` : "";
      lastDay = dk;
      const res = m.status === "finished" ? `${m.home_goals}:${m.away_goals}` : m.status === "cancelled" ? "abgesagt" : "läuft / offen";
      return head + html`
        <a class="match" href="#/spiel/${m.id}" style="display:block;color:inherit;text-decoration:none">
          <div class="meta"><span class="league">${leagueLabel(m)}</span><span>${fmtTime(m.kickoff)}</span></div>
          <div class="line">
            <div class="teams">
              <div class="team">${esc(m.home_name)}</div>
              <div class="team">${esc(m.away_name)}</div>
            </div>
            <div class="scores">
              <div class="score-fixed">${m.status === "finished" ? m.home_goals : "–"}</div>
              <div class="score-fixed">${m.status === "finished" ? m.away_goals : "–"}</div>
            </div>
          </div>
          <div class="foot">
            <span>${t ? `Dein Tipp: <b>${t.home_goals}:${t.away_goals}</b>` : '<span class="muted">nicht getippt</span>'}${m.status !== "finished" ? ` · <span class="muted">${esc(res)}</span>` : ""}</span>
            ${t ? pointsBadge(t.points, m.is_cup ? 20 : 10) : ""}
          </div>
        </a>`;
    }).join("");

    setView(html`
      <h1>Resultate</h1>
      <div class="tabs2">
        <button data-mine="1" class="${f.mine ? "on" : ""}">Meine Tipps</button>
        <button data-mine="0" class="${!f.mine ? "on" : ""}">Alle Spiele</button>
      </div>
      ${filterControls(f)}
      ${f.mine ? `<p class="muted small">Letzte ${days} Tage: <b>${total} Punkte</b> aus ${matches.length} Tipps. Tippe auf ein Spiel, um die Tipps der anderen zu sehen.</p>` : `<p class="muted small">Gespielte Spiele der letzten ${days} Tage.</p>`}
      ${items || `<div class="empty">${f.mine ? "Noch keine getippten Spiele in diesem Zeitraum." : "Keine Spiele."}</div>`}
      ${days < 365 ? `<button class="btn block" id="more">Ältere laden</button>` : ""}
    `);
    for (const b of $view.querySelectorAll("[data-mine]")) b.onclick = () => { f.mine = b.dataset.mine === "1"; store.set("filterRes", f); draw(); };
    bindFilters(f, () => { store.set("filterRes", f); draw(); });
    $view.querySelector("#more")?.addEventListener("click", () => { days = days < 30 ? 30 : days < 90 ? 90 : 365; draw(); });
  };
  await draw();
}

async function renderSpielDetail(id) {
  const { data: m, error } = await sb.from("match_list").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!m) return setView(`<div class="empty">Spiel nicht gefunden.</div>`);
  const started = new Date(m.kickoff) <= new Date();
  const { data: tips, error: e2 } = await sb.from("tips")
    .select("user_id,home_goals,away_goals,points,profiles(username)").eq("match_id", id);
  if (e2) throw e2;
  tips.sort((a, b) => (b.points ?? -1) - (a.points ?? -1) || (a.profiles?.username ?? "").localeCompare(b.profiles?.username ?? ""));
  const me = state.session.user.id;
  setView(html`
    <p><a href="javascript:history.back()">‹ Zurück</a></p>
    <div class="card">
      <div class="muted small">${leagueLabel(m)} · ${esc(fmtDay(m.kickoff))}, ${fmtTime(m.kickoff)}</div>
      <h2 style="margin:8px 0">${esc(m.home_name)} – ${esc(m.away_name)}</h2>
      <div style="font-size:28px;font-weight:800">${m.status === "finished" ? `${m.home_goals} : ${m.away_goals}` : m.status === "cancelled" ? "abgesagt" : "– : –"}</div>
    </div>
    <h2>Tipps (${tips.length})</h2>
    ${!started ? `<p class="muted">Die Tipps der anderen werden ab Anpfiff sichtbar.</p>` : ""}
    ${tips.length ? `
    <div class="card"><table class="tbl">
      <tr><th class="l">Spieler</th><th>Tipp</th><th>Punkte</th></tr>
      ${tips.map((t) => `<tr class="${t.user_id === me ? "me" : ""}"><td class="name">${esc(t.profiles?.username ?? "?")}</td><td>${t.home_goals}:${t.away_goals}</td><td>${t.points ?? "–"}</td></tr>`).join("")}
    </table></div>` : `<div class="empty">Keine Tipps.</div>`}
  `);
}

// ---------------------------------------------------------------------------
// Ranglisten
// ---------------------------------------------------------------------------

async function myGroups() {
  const { data, error } = await sb.from("groups").select("id,name,invite_code,owner_id").order("name");
  if (error) throw error;
  return data;
}

async function renderRangliste(sel = "gesamt") {
  const groups = await myGroups();
  const chips = html`
    <div class="chips">
      <a class="chip ${sel === "gesamt" ? "on" : ""}" href="#/rangliste/gesamt" style="display:flex;align-items:center;text-decoration:none">Gesamt</a>
      ${groups.map((g) => `<a class="chip ${sel === g.id ? "on" : ""}" href="#/rangliste/${g.id}" style="display:flex;align-items:center;text-decoration:none">${esc(g.name)}</a>`).join("")}
      <a class="chip ${sel === "gruppen" ? "on" : ""}" href="#/rangliste/gruppen" style="display:flex;align-items:center;text-decoration:none">Gruppen-Vergleich</a>
    </div>`;

  if (sel === "gruppen") {
    const { data, error } = await sb.rpc("group_ranking");
    if (error) throw error;
    return setView(html`
      <h1>Rangliste</h1>${chips}
      <p class="muted small">Gruppen werden nach dem Punkte-Durchschnitt ihrer Mitglieder verglichen.</p>
      ${data.length ? `<div class="card"><table class="tbl">
        <tr><th>#</th><th class="l">Gruppe</th><th>Mitgl.</th><th>Ø Punkte</th></tr>
        ${data.map((r) => `<tr class="${r.is_member ? "me" : ""}"><td>${r.rank}</td><td class="name">${esc(r.name)}</td><td>${r.members}</td><td><b>${r.avg_points}</b></td></tr>`).join("")}
      </table></div>` : `<div class="empty">Noch keine Gruppen.</div>`}
    `);
  }

  const groupId = sel === "gesamt" ? null : sel;
  const { data, error } = await sb.rpc("leaderboard", { p_group_id: groupId });
  if (error) throw error;
  const me = state.session.user.id;
  const mine = data.find((r) => r.user_id === me);
  setView(html`
    <h1>Rangliste</h1>${chips}
    ${mine ? `<div class="stat">
      <div class="card"><b>${mine.rank}.</b><span>Rang</span></div>
      <div class="card"><b>${mine.points}</b><span>Punkte</span></div>
      <div class="card"><b>${mine.exact_count}</b><span>genau richtig</span></div>
    </div>` : ""}
    <div class="card"><table class="tbl">
      <tr><th>#</th><th class="l">Spieler</th><th title="ausgewertete Tipps">Tipps</th><th title="genaue Resultate">🎯</th><th>Punkte</th></tr>
      ${data.map((r) => `<tr class="${r.user_id === me ? "me" : ""}"><td>${r.rank}</td><td class="name">${esc(r.username)}</td><td>${r.tips_count}</td><td>${r.exact_count}</td><td><b>${r.points}</b></td></tr>`).join("")}
    </table></div>
    <p class="muted small">Bei Punktgleichheit entscheidet die Anzahl genau richtiger Resultate.</p>
  `);
}

// ---------------------------------------------------------------------------
// Gruppen
// ---------------------------------------------------------------------------

async function renderGruppen() {
  const groups = await myGroups();
  setView(html`
    <h1>Gruppen</h1>
    <p class="muted">Tippe mit Freunden, Familie oder deinem Team in einer eigenen Gruppe.</p>
    <div class="list">
      ${groups.map((g) => `<a class="item" href="#/gruppe/${g.id}"><span>👥 ${esc(g.name)}</span><span class="muted">›</span></a>`).join("") || `<div class="empty">Du bist noch in keiner Gruppe.</div>`}
    </div>
    <h2>Gruppe beitreten</h2>
    <form id="join" class="card row">
      <input class="grow" type="text" name="code" placeholder="Einladungscode" maxlength="8" required autocapitalize="characters" style="text-transform:uppercase">
      <button class="btn primary">Beitreten</button>
    </form>
    <h2>Neue Gruppe erstellen</h2>
    <form id="create" class="card row">
      <input class="grow" type="text" name="name" placeholder="Name der Gruppe" minlength="2" maxlength="40" required>
      <button class="btn primary">Erstellen</button>
    </form>
  `);
  $view.querySelector("#join").onsubmit = async (e) => {
    e.preventDefault();
    const { data, error } = await sb.rpc("join_group", { p_code: new FormData(e.target).get("code") });
    if (error) return toast(errMsg(error), true);
    toast(`Willkommen in „${data.name}“!`);
    location.hash = `#/gruppe/${data.id}`;
  };
  $view.querySelector("#create").onsubmit = async (e) => {
    e.preventDefault();
    const { data, error } = await sb.rpc("create_group", { p_name: new FormData(e.target).get("name") });
    if (error) return toast(errMsg(error), true);
    toast("Gruppe erstellt.");
    location.hash = `#/gruppe/${data.id}`;
  };
}

async function renderGruppe(id) {
  const { data: g, error } = await sb.from("groups").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!g) return setView(`<p><a href="#/gruppen">‹ Gruppen</a></p><div class="empty">Gruppe nicht gefunden.</div>`);
  const { data: board, error: e2 } = await sb.rpc("leaderboard", { p_group_id: id });
  if (e2) throw e2;
  const link = `${appUrl()}?join=${g.invite_code}`;
  const me = state.session.user.id;
  setView(html`
    <p><a href="#/gruppen">‹ Gruppen</a></p>
    <h1>${esc(g.name)}</h1>
    <div class="card">
      <div class="muted small">Einladungscode</div>
      <div class="row"><span class="code grow">${esc(g.invite_code)}</span>
        <button class="btn small" id="share">Einladen</button></div>
      <p class="muted small">Teile den Link oder den Code. Wer ihn hat, kann beitreten.</p>
    </div>
    <h2>Rangliste (${board.length})</h2>
    <div class="card"><table class="tbl">
      <tr><th>#</th><th class="l">Spieler</th><th>🎯</th><th>Punkte</th></tr>
      ${board.map((r) => `<tr class="${r.user_id === me ? "me" : ""}"><td>${r.rank}</td><td class="name">${esc(r.username)}</td><td>${r.exact_count}</td><td><b>${r.points}</b></td></tr>`).join("")}
    </table></div>
    ${g.owner_id === me ? `
    <h2>Umbenennen</h2>
    <form id="rename" class="card row"><input class="grow" type="text" name="name" value="${esc(g.name)}" minlength="2" maxlength="40" required><button class="btn">Speichern</button></form>` : ""}
    <p style="margin-top:24px"><button class="btn danger block" id="leave">Gruppe verlassen</button></p>
  `);
  $view.querySelector("#share").onclick = async () => {
    const text = `Tippe mit mir im RegioTipp, Gruppe „${g.name}“: ${link}`;
    try {
      if (navigator.share) await navigator.share({ title: "RegioTipp", text, url: link });
      else { await navigator.clipboard.writeText(text); toast("Einladung kopiert."); }
    } catch { /* abgebrochen */ }
  };
  $view.querySelector("#rename")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error: er } = await sb.from("groups").update({ name: new FormData(e.target).get("name") }).eq("id", id);
    if (er) return toast(errMsg(er), true);
    toast("Gespeichert."); route();
  });
  $view.querySelector("#leave").onclick = async () => {
    if (!confirm(`Gruppe „${g.name}“ wirklich verlassen?`)) return;
    const { error: er } = await sb.rpc("leave_group", { p_group_id: id });
    if (er) return toast(errMsg(er), true);
    toast("Gruppe verlassen."); location.hash = "#/gruppen";
  };
}

// ---------------------------------------------------------------------------
// Tabellen
// ---------------------------------------------------------------------------

async function renderTabellen() {
  await loadMeta();
  const f = store.get("filterTab", { slug: state.sourceLeagues[0]?.slug ?? "", league: "" });
  const draw = async () => {
    const groups = state.leagues.filter((l) => l.source_slug === f.slug);
    if (!groups.some((l) => String(l.id) === String(f.league))) f.league = groups[0]?.id ?? "";
    let rows = [];
    if (f.league) {
      const { data, error } = await sb.from("league_standings")
        .select("rank,played,won,drawn,lost,goals_for,goals_against,points,teams(name)")
        .eq("league_id", f.league).order("rank");
      if (error) throw error;
      rows = data;
    }
    setView(html`
      <p><a href="#/mehr">‹ Mehr</a></p>
      <h1>Tabellen</h1>
      <div class="filters">
        <select id="t-slug" aria-label="Liga">
          ${state.sourceLeagues.map((s) => `<option value="${esc(s.slug)}" ${f.slug === s.slug ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
        </select>
        <select id="t-league" aria-label="Gruppe">
          ${groups.map((l) => `<option value="${l.id}" ${String(f.league) === String(l.id) ? "selected" : ""}>${esc(l.name)}</option>`).join("")}
        </select>
      </div>
      ${rows.length ? `<div class="card"><table class="tbl">
        <tr><th>#</th><th class="l">Team</th><th>Sp</th><th>S</th><th>U</th><th>N</th><th>Tore</th><th>P</th></tr>
        ${rows.map((r) => `<tr><td>${r.rank}</td><td class="name">${esc(r.teams?.name)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.goals_for}:${r.goals_against}</td><td><b>${r.points}</b></td></tr>`).join("")}
      </table></div>` : `<div class="empty">Keine Tabelle vorhanden.</div>`}
      <p class="muted small">Quelle: footstats.ch, wird stündlich aktualisiert.</p>
    `);
    $view.querySelector("#t-slug").onchange = (e) => { f.slug = e.target.value; f.league = ""; store.set("filterTab", f); draw(); };
    $view.querySelector("#t-league").onchange = (e) => { f.league = e.target.value; store.set("filterTab", f); draw(); };
  };
  await draw();
}

// ---------------------------------------------------------------------------
// Mehr, Profil, Regeln
// ---------------------------------------------------------------------------

function renderMehr() {
  setView(html`
    <h1>Mehr</h1>
    <div class="list">
      <a class="item" href="#/tabellen"><span>📊 Tabellen</span><span class="muted">›</span></a>
      <a class="item" href="#/regeln"><span>📖 Spielregeln</span><span class="muted">›</span></a>
      <a class="item" href="#/profil"><span>👤 Profil</span><span class="muted">›</span></a>
      ${state.profile?.is_admin ? `<a class="item" href="#/admin"><span>🛠️ Admin</span><span class="muted">›</span></a>` : ""}
      <button class="item" id="logout"><span>🚪 Abmelden</span><span></span></button>
    </div>
  `);
  $view.querySelector("#logout").onclick = async () => { await sb.auth.signOut(); location.hash = "#/spiele"; };
}

function renderProfil() {
  setView(html`
    <p><a href="#/mehr">‹ Mehr</a></p>
    <h1>Profil</h1>
    <form id="prof" class="card">
      <label class="field"><span>Benutzername</span>
        <input type="text" name="username" value="${esc(state.profile.username)}" minlength="2" maxlength="30" required></label>
      <p class="muted small">E-Mail: ${esc(state.session.user.email)}</p>
      <button class="btn primary">Speichern</button>
    </form>
    <form id="pw" class="card">
      <label class="field"><span>Neues Passwort</span><input type="password" name="pw" minlength="6" autocomplete="new-password" required></label>
      <button class="btn">Passwort ändern</button>
    </form>
    <p><button class="btn danger block" id="logout">Abmelden</button></p>
  `);
  $view.querySelector("#prof").onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.rpc("set_username", { p_username: new FormData(e.target).get("username") });
    if (error) return toast(errMsg(error), true);
    await loadProfile(); renderTop(); toast("Gespeichert.");
  };
  $view.querySelector("#pw").onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: new FormData(e.target).get("pw") });
    if (error) return toast(errMsg(error), true);
    e.target.reset(); toast("Passwort geändert.");
  };
  $view.querySelector("#logout").onclick = async () => { await sb.auth.signOut(); location.hash = "#/spiele"; };
}

function renderRegeln() {
  setView(html`
    <p><a href="#/mehr">‹ Mehr</a></p>
    <h1>Spielregeln</h1>
    <div class="card">
      <p>Tippe das <b>genaue Resultat</b> der FVRZ-Spiele. Bis zum Anpfiff kannst du deinen Tipp beliebig ändern.</p>
      <h3>Punkte pro Spiel</h3>
      <table class="tbl pts-table">
        <tr><td>Richtige Tendenz (Sieger bzw. Unentschieden)</td><td><b>5</b></td></tr>
        <tr><td>Richtige Anzahl Tore Heimteam</td><td><b>1</b></td></tr>
        <tr><td>Richtige Anzahl Tore Gastteam</td><td><b>1</b></td></tr>
        <tr><td>Richtige Tordifferenz</td><td><b>3</b></td></tr>
        <tr><td><b>Genaues Resultat (alles zusammen)</b></td><td><b>10</b></td></tr>
      </table>
      <p class="small muted">Beispiel: Tipp 2:1, Resultat 3:2 → Tendenz und Tordifferenz richtig = 8 Punkte.</p>
      <h3>Cupspiele</h3>
      <p>Bei Cup- und Freundschaftsspielen gibt es <b>doppelte Punkte</b> (max. 20).</p>
      <h3>Ranglisten</h3>
      <p>Spieler werden nach Punkten rangiert, bei Gleichstand entscheiden die genauen Resultate. Gruppen werden über den <b>Punkte-Durchschnitt</b> ihrer Mitglieder verglichen.</p>
      <h3>Sonstiges</h3>
      <p>Die Tipps der anderen sind ab Anpfiff sichtbar. Abgesagte Spiele geben keine Punkte. Wird ein Resultat korrigiert, werden die Punkte neu berechnet.</p>
      <p class="small muted">Punkteregeln nach dem SRF-Tippspiel. Spiele und Resultate: footstats.ch.</p>
    </div>
  `);
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

async function renderAdmin() {
  if (!state.profile?.is_admin) return setView(`<div class="empty">Nur für Admins.</div>`);
  const [log, missing, users] = await Promise.all([
    sb.from("sync_log").select("*").order("at", { ascending: false }).limit(8),
    sb.from("match_list").select("*").eq("status", "scheduled").lt("kickoff", new Date(Date.now() - 3 * 3600000).toISOString())
      .order("kickoff", { ascending: false }).limit(100),
    sb.from("profiles").select("id,username,is_admin,created_at").order("created_at"),
  ]);
  for (const r of [log, missing, users]) if (r.error) throw r.error;

  setView(html`
    <p><a href="#/mehr">‹ Mehr</a></p>
    <h1>Admin</h1>

    <h2>Import von footstats.ch</h2>
    <div class="card">
      <div class="row"><button class="btn small" data-sync="leagues">Tabellen jetzt holen</button><button class="btn small" data-sync="teams">Spiele jetzt holen</button></div>
      <table class="tbl" style="margin-top:8px">
        ${log.data.map((l) => `<tr><td class="l small">${esc(fmtShort(l.at))}</td><td class="l small">${esc(l.kind)}</td><td>${l.ok ? "✅" : "⚠️"}</td><td class="l small">${esc(l.detail?.teams_ok ?? l.detail?.leagues_ok ?? "")}</td></tr>`).join("")}
      </table>
    </div>

    <h2>Resultate nachtragen (${missing.data.length})</h2>
    <p class="muted small">Gespielte Spiele ohne Resultat. Nach 21 Tagen ohne Resultat gilt ein Spiel automatisch als abgesagt.</p>
    ${missing.data.map((m) => html`
      <div class="match" data-id="${m.id}">
        <div class="meta"><span class="league">${leagueLabel(m)}</span><span>${esc(fmtShort(m.kickoff))}</span></div>
        <div class="line">
          <div class="teams"><div class="team">${esc(m.home_name)}</div><div class="team">${esc(m.away_name)}</div></div>
          <div class="scores">
            <input class="score-in" type="number" inputmode="numeric" min="0" max="30">
            <input class="score-in" type="number" inputmode="numeric" min="0" max="30">
          </div>
        </div>
        <div class="foot"><button class="btn small" data-act="save">Resultat speichern</button><button class="btn small danger" data-act="cancel">Abgesagt</button></div>
      </div>`).join("") || `<div class="empty">Keine offenen Resultate.</div>`}

    <h2>Benutzer (${users.data.length})</h2>
    <div class="card"><table class="tbl">
      ${users.data.map((u) => `<tr><td class="name">${esc(u.username)}</td><td>${u.is_admin ? "Admin" : ""}</td>
        <td>${u.id !== state.session.user.id ? `<button class="btn small" data-admin="${u.id}" data-val="${!u.is_admin}">${u.is_admin ? "Admin entfernen" : "zum Admin"}</button>` : ""}</td></tr>`).join("")}
    </table></div>
  `);

  for (const b of $view.querySelectorAll("[data-sync]")) {
    b.onclick = async () => {
      b.disabled = true;
      const { error } = await sb.rpc("admin_trigger_sync", { p_mode: b.dataset.sync });
      if (error) { b.disabled = false; return toast(errMsg(error), true); }
      toast("Import gestartet. Ergebnis in ca. 30 Sekunden hier sichtbar.");
      setTimeout(route, 30000);
    };
  }
  for (const card of $view.querySelectorAll(".match[data-id]")) {
    const id = Number(card.dataset.id);
    const [h, a] = card.querySelectorAll(".score-in");
    card.querySelector('[data-act="save"]').onclick = async () => {
      if (h.value === "" || a.value === "") return toast("Bitte beide Werte eingeben.", true);
      const { error } = await sb.rpc("admin_set_result", { p_match_id: id, p_home: Number(h.value), p_away: Number(a.value) });
      if (error) return toast(errMsg(error), true);
      toast("Resultat gespeichert, Punkte vergeben."); card.remove();
    };
    card.querySelector('[data-act="cancel"]').onclick = async () => {
      if (!confirm("Spiel als abgesagt markieren?")) return;
      const { error } = await sb.rpc("admin_cancel_match", { p_match_id: id });
      if (error) return toast(errMsg(error), true);
      toast("Als abgesagt markiert."); card.remove();
    };
  }
  for (const b of $view.querySelectorAll("[data-admin]")) {
    b.onclick = async () => {
      const { error } = await sb.rpc("admin_set_admin", { p_user_id: b.dataset.admin, p_admin: b.dataset.val === "true" });
      if (error) return toast(errMsg(error), true);
      toast("Gespeichert."); route();
    };
  }
}
