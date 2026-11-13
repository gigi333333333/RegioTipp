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
  const { data, error } = await sb.from("profile_cards").select("*").eq("id", state.session.user.id).maybeSingle();
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

async function loadGroups(force = false) {
  if (state.groups && !force) return state.groups;
  const { data, error } = await sb.rpc("my_groups");
  if (error) throw error;
  state.groups = data;
  return data;
}

// Profilbild: eigenes Foto (rund, gefüllt) oder Vereinswappen (eingepasst); Initiale als Rückfall
function avatar(url, name, size = 36) {
  const initial = esc((String(name || "?").trim()[0] || "?").toUpperCase());
  const photo = url && url.includes("/storage/v1/object/public/avatars/");
  const img = url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
  return `<span class="av ${photo ? "photo" : url ? "crest" : ""}" style="--s:${size}px" data-i="${initial}" aria-hidden="true">${img}</span>`;
}

function vibrate(ms = 12) { try { navigator.vibrate?.(ms); } catch { /* egal */ } }

// Kleines Konfetti ohne Bibliothek
function confetti(amount = 120) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.createElement("canvas");
  c.className = "confetti";
  document.body.appendChild(c);
  const ctx = c.getContext("2d");
  const W = c.width = innerWidth * devicePixelRatio, H = c.height = innerHeight * devicePixelRatio;
  const colors = ["#0b6e4f", "#3fbf8f", "#f0c43c", "#d81e48", "#4a90e2", "#ffffff"];
  const parts = Array.from({ length: amount }, () => ({
    x: W / 2 + (Math.random() - .5) * W * .3, y: H * .35,
    vx: (Math.random() - .5) * 26 * devicePixelRatio, vy: (-Math.random() * 22 - 8) * devicePixelRatio,
    s: (6 + Math.random() * 6) * devicePixelRatio, r: Math.random() * 6, vr: (Math.random() - .5) * .4,
    col: colors[(Math.random() * colors.length) | 0],
  }));
  let t = 0;
  (function tick() {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += .9 * devicePixelRatio; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.col;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    }
    if (++t < 140) requestAnimationFrame(tick); else c.remove();
  })();
}

function renderTop() {
  if (state.profile) {
    $topRight.innerHTML = `<a href="#/profil" class="me-link">${avatar(state.profile.picture, state.profile.username, 30)}<span>${esc(state.profile.username)}</span></a>`;
  } else {
    $topRight.textContent = "";
  }
}

async function route() {
  const hash = location.hash || "#/home";
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
    if (location.search) history.replaceState(null, "", location.pathname);
    try {
      const { data, error } = await sb.rpc("join_group", { p_code: pending });
      if (error) throw error;
      state.groups = null;
      location.hash = `#/willkommen/${data.id}`;
    } catch (e) { toast(errMsg(e), true); location.hash = "#/start"; }
    return;
  }

  // Wer noch in keiner Tipprunde ist, landet zuerst im Onboarding
  const flow = ["start", "neu", "beitreten", "willkommen"].includes(page);
  if (!flow && (page === "home" || page === "spiele" || !page) && !store.get("onboardSkip", false)) {
    const groups = await loadGroups().catch(() => []);
    if (!groups.length) { location.hash = "#/start"; return; }
  }

  const tab = { home: "home", spiele: "spiele", resultate: "mehr", spiel: "mehr", rangliste: "rangliste",
                gruppen: "gruppen", gruppe: "gruppen", neu: "gruppen", beitreten: "gruppen" }[page] ?? "mehr";
  for (const a of $tabbar.querySelectorAll("a")) a.classList.toggle("on", a.dataset.tab === tab);
  $tabbar.hidden = page === "start" || page === "willkommen";

  setView(`<div class="loading">Laden …</div>`);
  try {
    switch (page) {
      case "start": return renderStart();
      case "neu": return await renderNeu(arg);
      case "beitreten": return renderBeitreten(arg);
      case "willkommen": return await renderWillkommen(arg);
      case "home": return await renderHome();
      case "spiele": return await renderSpiele(arg);
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
      default: location.hash = "#/home";
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
  if (changed) { state.profile = null; state.groups = null; route(); }
});

(async () => {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  route();
})();

// ---------------------------------------------------------------------------
// Login / Registrieren
// ---------------------------------------------------------------------------

async function renderAuth(mode = "register") {
  // Einladung? Dann zeigen wir, wohin man eingeladen wurde.
  const code = store.get("pendingJoin", null);
  let invite = null;
  if (code) {
    const { data } = await sb.rpc("group_preview", { p_code: code });
    invite = data?.[0] ?? null;
  }

  const hero = invite ? html`
      <div class="hero">
        <div class="hero-emoji">🎟️</div>
        <h1>Du bist eingeladen!</h1>
        <div class="invite-card">
          <div class="invite-name">${esc(invite.name)}</div>
          ${invite.team_label ? `<div class="muted">⚽ ${esc(invite.team_label)} · ${esc(invite.source_name ?? "")} ${esc(invite.league_name ?? "")}</div>` : ""}
          <div class="muted small">${invite.members} ${invite.members === 1 ? "Mitglied" : "Mitglieder"} tippen schon mit</div>
        </div>
      </div>` : html`
      <div class="hero">
        <div class="hero-emoji">⚽</div>
        <h1>Tippe die Spiele deines Vereins</h1>
        <p class="hero-sub">Resultate tippen, Punkte sammeln und deine Freunde schlagen. Alle FVRZ-Ligen, von der 2. Liga bis zu den C-Junioren.</p>
      </div>`;

  const forms = {
    register: html`
      <form id="authform" class="card auth-card">
        <label class="field"><span>Dein Name in der Rangliste</span>
          <input type="text" name="username" minlength="2" maxlength="30" required autocomplete="nickname" placeholder="z.B. Gigi"></label>
        <label class="field"><span>E-Mail</span>
          <input type="email" name="email" required autocomplete="email"></label>
        <label class="field"><span>Passwort</span>
          <input type="password" name="password" minlength="6" required autocomplete="new-password" placeholder="mindestens 6 Zeichen"></label>
        <button class="btn primary block big" type="submit">${invite ? "Beitreten & loslegen 🚀" : "Kostenlos starten 🚀"}</button>
        <p class="small center">Schon dabei? <a href="#" data-mode="login">Anmelden</a></p>
      </form>`,
    login: html`
      <form id="authform" class="card auth-card">
        <label class="field"><span>E-Mail</span>
          <input type="email" name="email" required autocomplete="email"></label>
        <label class="field"><span>Passwort</span>
          <input type="password" name="password" minlength="6" required autocomplete="current-password"></label>
        <button class="btn primary block big" type="submit">Anmelden</button>
        <p class="small center"><a href="#" data-mode="reset">Passwort vergessen?</a> · <a href="#" data-mode="register">Neu registrieren</a></p>
      </form>`,
    reset: html`
      <form id="authform" class="card auth-card">
        <label class="field"><span>E-Mail</span>
          <input type="email" name="email" required autocomplete="email"></label>
        <button class="btn primary block big" type="submit">Link senden</button>
        <p class="small center"><a href="#" data-mode="login">Zurück zur Anmeldung</a></p>
      </form>`,
  };

  setView(`<div class="auth">${hero}${forms[mode]}</div>`);

  for (const a of $view.querySelectorAll("[data-mode]")) {
    a.onclick = (e) => { e.preventDefault(); renderAuth(a.dataset.mode); };
  }

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
          setView(`<div class="auth card"><div class="hero-emoji">📬</div><h1>Fast geschafft</h1><p>Wir haben dir ein Mail an <b>${esc(f.get("email"))}</b> geschickt. Klicke auf den Link darin, dann geht's los.</p><p class="muted small">Kein Mail? Schau im Spam-Ordner nach.</p></div>`);
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

// ---------------------------------------------------------------------------
// Onboarding: Tipprunde starten oder beitreten
// ---------------------------------------------------------------------------

function steps(n, total = 3) {
  return `<div class="steps" aria-label="Schritt ${n} von ${total}">${Array.from({ length: total }, (_, i) =>
    `<span class="${i < n ? "on" : ""}"></span>`).join("")}</div>`;
}

function renderStart() {
  setView(html`
    <div class="onb">
      <div class="hero">
        <div class="hero-emoji bounce">👋</div>
        <h1>Hoi ${esc(state.profile.username)}!</h1>
        <p class="hero-sub">Tippen macht zusammen am meisten Spass. Wie willst du starten?</p>
      </div>
      <a class="choice" href="#/neu">
        <span class="choice-emoji">✨</span>
        <span><b>Neue Tipprunde starten</b><br><span class="muted">Wähle dein Team und lade deine Freunde ein</span></span>
        <span class="chev">›</span>
      </a>
      <a class="choice" href="#/beitreten">
        <span class="choice-emoji">🔑</span>
        <span><b>Ich habe einen Code</b><br><span class="muted">Einer Tipprunde von Freunden beitreten</span></span>
        <span class="chev">›</span>
      </a>
      <p class="center" style="margin-top:28px"><a href="#" id="skip" class="muted">Zuerst nur alleine tippen</a></p>
    </div>
  `);
  $view.querySelector("#skip").onclick = (e) => {
    e.preventDefault(); store.set("onboardSkip", true); location.hash = "#/home";
  };
}

function renderBeitreten(code = "") {
  setView(html`
    <div class="onb">
      <p><a href="#/start">‹ Zurück</a></p>
      <div class="hero"><div class="hero-emoji">🔑</div><h1>Code eingeben</h1>
        <p class="hero-sub">Den Code bekommst du von der Person, die dich eingeladen hat.</p></div>
      <form id="join">
        <input class="code-input" name="code" maxlength="6" required autocomplete="off" autocapitalize="characters"
               spellcheck="false" placeholder="ABC123" value="${esc(code)}" aria-label="Einladungscode">
        <div id="preview" class="preview"></div>
        <button class="btn primary block big" id="joinbtn" disabled>Beitreten</button>
      </form>
    </div>
  `);
  const inp = $view.querySelector(".code-input");
  const prev = $view.querySelector("#preview");
  const btn = $view.querySelector("#joinbtn");
  let t;
  const check = async () => {
    const v = inp.value.trim().toUpperCase();
    if (v.length < 6) { prev.innerHTML = ""; btn.disabled = true; return; }
    const { data } = await sb.rpc("group_preview", { p_code: v });
    const g = data?.[0];
    if (!g) { prev.innerHTML = `<span class="err">Diesen Code gibt es nicht.</span>`; btn.disabled = true; return; }
    vibrate();
    prev.innerHTML = `<div class="invite-card pop"><div class="invite-name">${esc(g.name)}</div>
      ${g.team_label ? `<div class="muted">⚽ ${esc(g.team_label)} · ${esc(g.league_name ?? "")}</div>` : ""}
      <div class="muted small">${g.members} ${g.members === 1 ? "Mitglied" : "Mitglieder"}</div></div>`;
    btn.disabled = false;
  };
  inp.addEventListener("input", () => { inp.value = inp.value.toUpperCase(); clearTimeout(t); t = setTimeout(check, 250); });
  if (code) check(); else setTimeout(() => inp.focus(), 50);
  $view.querySelector("#join").onsubmit = async (e) => {
    e.preventDefault();
    btn.disabled = true;
    const { data, error } = await sb.rpc("join_group", { p_code: inp.value.trim() });
    if (error) { btn.disabled = false; return toast(errMsg(error), true); }
    state.groups = null;
    location.hash = `#/willkommen/${data.id}`;
  };
}

async function renderNeu() {
  // Schritt 1: Mannschaft suchen
  const step1 = () => {
    setView(html`
      <div class="onb">
        <p><a href="javascript:history.back()">‹ Zurück</a></p>
        ${steps(1)}
        <h1>Welches Team willst du tippen?</h1>
        <p class="muted">Suche deinen Verein und deine Mannschaft, z.B. <i>Witikon Ba</i>, <i>Wädenswil 1</i> oder <i>Kloten Frauen</i>.</p>
        <input type="search" id="q" class="search-big" placeholder="🔍 Verein oder Mannschaft" autocomplete="off" enterkeyhint="search">
        <div id="results" class="results"></div>
      </div>
    `);
    const q = $view.querySelector("#q");
    const res = $view.querySelector("#results");
    let t, seq = 0;
    const search = async () => {
      const v = q.value.trim();
      if (v.length < 2) { res.innerHTML = ""; return; }
      const my = ++seq;
      const { data, error } = await sb.rpc("search_teams", { p_query: v });
      if (my !== seq) return;
      if (error) { res.innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
      res.innerHTML = data.length ? data.map((r, i) => html`
        <button class="result" data-i="${i}">
          <span class="result-main"><b>${esc(r.label)}</b><br>
            <span class="muted small">${esc(r.source_name)} · ${esc(r.league_name)}</span></span>
          <span class="result-rank">${r.rank}.<br><span class="muted small">Platz</span></span>
        </button>`).join("")
        : `<div class="empty">Nichts gefunden. Versuch es mit dem Ortsnamen, z.B. <i>Witikon</i>.</div>`;
      for (const b of res.querySelectorAll(".result")) b.onclick = () => { vibrate(); step2(data[Number(b.dataset.i)]); };
    };
    q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(search, 200); });
    setTimeout(() => q.focus(), 50);
  };

  // Schritt 2: Tabellengruppe anzeigen und auswählen
  const step2 = async (team) => {
    setView(`<div class="loading">Laden …</div>`);
    const [{ data: table, error }, { count }] = await Promise.all([
      sb.from("league_standings").select("rank,played,points,team_id,teams(name)").eq("league_id", team.league_id).order("rank"),
      sb.from("matches").select("id", { count: "exact", head: true }).eq("league_id", team.league_id)
        .eq("status", "scheduled").gt("kickoff", new Date().toISOString()),
    ]);
    if (error) return toast(errMsg(error), true);
    setView(html`
      <div class="onb">
        <p><a href="#" id="back">‹ Andere Mannschaft</a></p>
        ${steps(2)}
        <h1>${esc(team.source_name)}<br><span class="muted">${esc(team.league_name)}</span></h1>
        <p>Deine Tipprunde tippt <b>alle Spiele dieser Gruppe</b>, die ganze Saison lang${count ? `, noch <b>${count} Spiele</b>` : ""}. Cupspiele von ${esc(team.label)} zählen doppelt.</p>
        <div class="card"><table class="tbl">
          <tr><th>#</th><th class="l">Team</th><th>Sp</th><th>P</th></tr>
          ${table.map((r) => `<tr class="${r.team_id === team.team_id ? "me" : ""}"><td>${r.rank}</td><td class="name">${esc(r.teams?.name)}</td><td>${r.played}</td><td><b>${r.points}</b></td></tr>`).join("")}
        </table></div>
        <div class="sticky-cta"><button class="btn primary block big" id="pick">✅ Diese Gruppe auswählen</button></div>
      </div>
    `);
    $view.querySelector("#back").onclick = (e) => { e.preventDefault(); step1(); };
    $view.querySelector("#pick").onclick = () => { vibrate(); step3(team); };
  };

  // Schritt 3: Name der Tipprunde
  const step3 = (team) => {
    const suggestion = `Tipprunde ${team.label}`.slice(0, 40);
    setView(html`
      <div class="onb">
        <p><a href="#" id="back">‹ Zurück</a></p>
        ${steps(3)}
        <div class="hero"><div class="hero-emoji">🏆</div><h1>Wie soll deine Tipprunde heissen?</h1></div>
        <form id="create">
          <input type="text" name="name" class="search-big" value="${esc(suggestion)}" minlength="2" maxlength="40" required>
          <p class="muted small">Zum Beispiel „Familie Meier“, „Ba-Eltern“ oder „Stammtisch Witikon“.</p>
          <button class="btn primary block big">Tipprunde erstellen 🎉</button>
        </form>
      </div>
    `);
    $view.querySelector("#back").onclick = (e) => { e.preventDefault(); step2(team); };
    $view.querySelector("#create").onsubmit = async (e) => {
      e.preventDefault();
      const b = e.target.querySelector("button"); b.disabled = true;
      const { data, error } = await sb.rpc("create_group", { p_name: new FormData(e.target).get("name"), p_team_id: team.team_id });
      if (error) { b.disabled = false; return toast(errMsg(error), true); }
      state.groups = null;
      store.set("activeGroup", data.id);
      location.hash = `#/willkommen/${data.id}`;
    };
  };

  step1();
}

async function renderWillkommen(id) {
  const groups = await loadGroups(true);
  const g = groups.find((x) => x.id === id);
  if (!g) { location.hash = "#/home"; return; }
  store.set("activeGroup", g.id);
  const link = `${appUrl()}?join=${g.invite_code}`;
  const isOwner = g.owner_id === state.session.user.id;
  setView(html`
    <div class="onb">
      <div class="hero">
        <div class="hero-emoji bounce">🎉</div>
        <h1>${isOwner ? "Deine Tipprunde ist bereit!" : `Willkommen in „${esc(g.name)}“!`}</h1>
        ${g.team_label ? `<p class="hero-sub">⚽ ${esc(g.team_label)} · ${esc(g.source_name ?? "")} ${esc(g.league_name ?? "")}</p>` : ""}
      </div>
      <div class="card center">
        <div class="muted small">${isOwner ? "Lade jetzt deine Freunde ein" : "Mehr Leute, mehr Spass. Lade weitere ein"}</div>
        <div class="code" style="margin:8px 0">${esc(g.invite_code)}</div>
        <button class="btn primary block big" id="share">📲 Freunde einladen</button>
      </div>
      <a class="btn block big" href="#/spiele/${g.id}" style="margin-top:12px">Jetzt erste Tipps abgeben →</a>
    </div>
  `);
  confetti(); vibrate([20, 40, 20]);
  $view.querySelector("#share").onclick = () => shareInvite(g, link);
}

async function shareInvite(g, link) {
  const text = `⚽ Tippst du mit? Tipprunde „${g.name}“${g.team_label ? ` (${g.team_label})` : ""} im RegioTipp: ${link}`;
  try {
    if (navigator.share) await navigator.share({ title: "RegioTipp", text });
    else { await navigator.clipboard.writeText(text); toast("Einladung kopiert. Jetzt in WhatsApp einfügen!"); }
  } catch { /* abgebrochen */ }
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
    location.hash = "#/home";
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

// Filter für die Spiele einer Tipprunde: Spiele ihrer Tabellengruppe(n) + Cupspiele des Teams
function groupFilter(q, g) {
  const parts = [];
  if (g.league_ids?.length) parts.push(`league_id.in.(${g.league_ids.join(",")})`);
  if (g.team_id) parts.push(`and(is_cup.eq.true,or(home_team_id.eq.${g.team_id},away_team_id.eq.${g.team_id}))`);
  return parts.length ? q.or(parts.join(",")) : q.eq("id", -1);
}

// Neue Punkte seit dem letzten Besuch feiern
async function pointsBanner() {
  const { data } = await sb.from("tips").select("points").eq("user_id", state.session.user.id).not("points", "is", null);
  const total = (data ?? []).reduce((s, t) => s + t.points, 0);
  const key = "seenPoints_" + state.session.user.id;
  const seen = store.get(key, null);
  store.set(key, total);
  if (seen !== null && total > seen) return { gained: total - seen, total };
  return null;
}

// ---------------------------------------------------------------------------
// Startseite (persönliches Cockpit)
// ---------------------------------------------------------------------------

function countdown(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return "jetzt";
  const min = Math.round(ms / 60000);
  if (min < 60) return `in ${min} Min.`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return `in ${h} Std.${m ? ` ${m} Min.` : ""}`;
  const d = Math.round(h / 24);
  return d === 1 ? "morgen" : `in ${d} Tagen`;
}

// Filter für alle Tipprunden zusammen (Tabellengruppen + Cupspiele der Teams)
function allGroupsFilter(q, groups) {
  const leagues = [...new Set(groups.flatMap((g) => g.league_ids ?? []))];
  const teams = [...new Set(groups.map((g) => g.team_id).filter(Boolean))];
  const parts = [];
  if (leagues.length) parts.push(`league_id.in.(${leagues.join(",")})`);
  for (const t of teams) parts.push(`and(is_cup.eq.true,or(home_team_id.eq.${t},away_team_id.eq.${t}))`);
  return parts.length ? q.or(parts.join(",")) : q;
}

// Pfeil für die Veränderung der Platzierung seit dem letzten Spieltag
function trendIcon(t) {
  if (!t || t.rank_now == null || t.rank_before == null) return "";
  const d = Number(t.rank_before) - Number(t.rank_now);
  if (d > 0) return `<span class="trend up" title="${d} ${d === 1 ? "Platz" : "Plätze"} gestiegen">▲</span>`;
  if (d < 0) return `<span class="trend down" title="${-d} ${d === -1 ? "Platz" : "Plätze"} gesunken">▼</span>`;
  return `<span class="trend same" title="Platzierung unverändert"></span>`;
}

async function renderHome() {
  const me = state.session.user.id;
  const p = state.profile;
  const groups = await loadGroups();
  const main = groups[0] ?? null;
  const now = new Date().toISOString();
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString();

  // Offene Spiele der nächsten 7 Tage (in den eigenen Tipprunden, sonst alle)
  let openQ = sb.from("match_list").select("id,kickoff").eq("status", "scheduled").gt("kickoff", now).lte("kickoff", in7).order("kickoff").limit(400);
  if (groups.length) openQ = allGroupsFilter(openQ, groups);

  const teamId = p.team_id;
  const [week, all, open, myTips, nextTeam, teamLeague] = await Promise.all([
    sb.rpc("leaderboard", { p_group_id: null, p_period: "week" }),
    sb.rpc("leaderboard", { p_group_id: null, p_period: "all" }),
    openQ,
    sb.from("tips").select("match_id,home_goals,away_goals,points").eq("user_id", me),
    teamId ? sb.from("match_list").select("*").eq("status", "scheduled").gt("kickoff", now)
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`).order("kickoff").limit(1) : { data: [] },
    teamId ? sb.from("team_current_league").select("*").eq("team_id", teamId).maybeSingle() : { data: null },
  ]);
  for (const r of [week, all, open, myTips]) if (r.error) throw r.error;

  const tipMap = new Map(myTips.data.map((t) => [t.match_id, t]));
  const openMatches = open.data.filter((m) => !tipMap.has(m.id));
  const meWeek = week.data.find((r) => r.user_id === me);
  const meAll = all.data.find((r) => r.user_id === me);

  // Letzte ausgewertete Tipps
  const scoredIds = myTips.data.filter((t) => t.points !== null).map((t) => t.match_id);
  let recent = [];
  if (scoredIds.length) {
    const { data } = await sb.from("match_list").select("*").in("id", scoredIds.slice(-300)).order("kickoff", { ascending: false }).limit(5);
    recent = data ?? [];
  }

  // Mini-Tabelle rund um das eigene Team
  let miniTable = [];
  if (teamLeague.data) {
    const { data } = await sb.from("league_standings").select("rank,played,points,team_id,teams(name)")
      .eq("league_id", teamLeague.data.league_id).order("rank");
    const i = (data ?? []).findIndex((r) => r.team_id === teamId);
    miniTable = i < 0 ? [] : data.slice(Math.max(0, i - 2), i + 3);
  }

  // Tipprunde: Top 3 und Neuigkeiten
  let board = [], feed = [], trend = null;
  if (main) {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const [b, fin, mem, tr] = await Promise.all([
      sb.rpc("leaderboard", { p_group_id: main.id, p_period: "all" }),
      groupFilter(sb.from("match_list").select("id,home_name,away_name,home_goals,away_goals,kickoff,is_cup")
        .eq("status", "finished").gte("kickoff", since).order("kickoff", { ascending: false }).limit(100), main),
      sb.from("group_members").select("user_id").eq("group_id", main.id),
      sb.rpc("group_rank_trend", { p_group_id: main.id }),
    ]);
    board = b.data ?? [];
    trend = tr.data?.[0] ?? null;
    const memberIds = new Set((mem.data ?? []).map((x) => x.user_id));
    const finById = new Map((fin.data ?? []).map((m) => [m.id, m]));
    if (finById.size) {
      const { data: hits } = await sb.from("tips").select("user_id,match_id,points,home_goals,away_goals,profiles(username)")
        .in("match_id", [...finById.keys()]).gte("points", 8);
      feed = (hits ?? []).filter((h) => memberIds.has(h.user_id))
        .map((h) => ({ ...h, m: finById.get(h.match_id) }))
        .sort((a, b) => new Date(b.m.kickoff) - new Date(a.m.kickoff) || b.points - a.points).slice(0, 5);
    }
  }

  const next = openMatches[0];
  const nt = nextTeam.data?.[0];
  const ntTip = nt ? tipMap.get(nt.id) : null;
  const hour = Number(new Intl.DateTimeFormat("de-CH", { timeZone: TZ, hour: "numeric" }).format(new Date()));
  const hello = hour < 11 ? "Guete Morge" : hour < 18 ? "Hoi" : "Guete Abig";

  setView(html`
    <div class="home-hello">
      ${avatar(p.picture, p.username, 52)}
      <div><div class="muted small">${hello}</div><h1 style="margin:0">${esc(p.username)} 👋</h1></div>
    </div>

    <div class="stat">
      ${main ? (() => { const mine = board.find((r) => r.user_id === me); return html`
      <a class="card stat-link" href="#/gruppe/${main.id}"><b class="rank-line">${mine ? mine.rank + "." : "–"}${trendIcon(trend)}</b><span class="stat-group">${esc(main.name)}</span></a>`; })()
      : `<a class="card stat-link" href="#/neu"><b>–</b><span>Keine Tipprunde</span></a>`}
      <a class="card stat-link" href="#/rangliste/alle"><b>${meWeek?.points ?? 0}</b><span>Punkte diese Woche</span></a>
      <a class="card stat-link" href="#/resultate"><b>${meAll?.points ?? 0}</b><span>Punkte total</span></a>
    </div>

    <a class="tip-cta ${openMatches.length ? "" : "done"}" href="#/spiele${main ? "/" + main.id : ""}">
      ${openMatches.length ? html`
        <span class="tip-cta-big">📝 Jetzt tippen</span>
        <span><b>${openMatches.length} ${openMatches.length === 1 ? "Spiel" : "Spiele"} offen</b> · nächster Anpfiff ${countdown(next.kickoff)}</span>`
      : `<span class="tip-cta-big">✅ Alles getippt!</span><span>Die nächsten Spiele findest du unter „Tippen“.</span>`}
    </a>

    ${nt ? html`
      <h2>⭐ Dein Team</h2>
      <a class="card team-next" href="#/spiele${main ? "/" + main.id : ""}">
        <div class="muted small center">${esc(fmtDay(nt.kickoff))}, ${fmtTime(nt.kickoff)} Uhr · ${countdown(nt.kickoff)}</div>
        <div class="tn-row">
          <div class="side">${crest(nt.home_logo, nt.home_name, 48)}<div class="tname">${esc(nt.home_name)}</div></div>
          <div class="tn-mid">${ntTip ? `<div class="tn-tip">${ntTip.home_goals} : ${ntTip.away_goals}</div><div class="muted small">dein Tipp</div>` : `<div class="tn-vs">vs</div><div class="small" style="color:var(--accent)">noch nicht getippt</div>`}</div>
          <div class="side">${crest(nt.away_logo, nt.away_name, 48)}<div class="tname">${esc(nt.away_name)}</div></div>
        </div>
      </a>` : ""}
    ${miniTable.length ? html`
      <div class="card" style="padding:4px 10px">
        <div class="muted small" style="padding:6px 2px 0">${esc(teamLeague.data.source_name)} · ${esc(teamLeague.data.league_name)}</div>
        <table class="tbl">${miniTable.map((r) => `<tr class="${r.team_id === teamId ? "me" : ""}"><td>${r.rank}</td><td class="name">${esc(r.teams?.name)}</td><td class="nowrap muted small">${r.played} Sp</td><td><b>${r.points}</b></td></tr>`).join("")}</table>
        <p class="small center" style="margin:6px 0"><button type="button" class="linkbtn form-btn" data-team="${teamId}">Ganze Tabelle & Form ansehen ›</button></p>
      </div>` : !teamId ? `<div class="card"><p style="margin:0">⚽ Wähle deinen Verein unter <a href="#/profil">Profil</a>, dann siehst du hier sein nächstes Spiel und die Tabelle.</p></div>` : ""}

    ${recent.length ? html`
      <h2>Deine letzten Resultate</h2>
      <div class="card" style="padding:2px 12px">
        ${recent.map((m) => { const t = tipMap.get(m.id); return html`
          <a class="recent" href="#/spiel/${m.id}">
            <span class="recent-teams">${esc(m.home_name)} <b>${m.home_goals}:${m.away_goals}</b> ${esc(m.away_name)}<br><span class="muted small">Dein Tipp ${t.home_goals}:${t.away_goals}</span></span>
            ${pointsBadge(t.points, m.is_cup ? 20 : 10)}
          </a>`; }).join("")}
      </div>
      <p class="small center"><a href="#/resultate">Alle meine Tipps ›</a></p>` : ""}

    ${main ? html`
      <h2>👥 ${esc(main.name)}</h2>
      ${podium(board) || ""}
      <div class="card" style="padding:4px 10px"><table class="tbl board">
        ${boardRows(board.filter((r, i) => i < 3 || r.user_id === me), me, { tips: false })}
      </table></div>
      ${feed.length ? html`
        <h3>Neuigkeiten</h3>
        <div class="card feed">
          ${feed.map((f) => html`<div class="feed-item">${f.points >= (f.m.is_cup ? 20 : 10) ? "🎯" : "✨"} <b>${esc(f.profiles?.username ?? "?")}</b> ${f.points >= (f.m.is_cup ? 20 : 10) ? "hat genau getippt" : "lag fast richtig"}: ${esc(f.m.home_name)} – ${esc(f.m.away_name)} ${f.m.home_goals}:${f.m.away_goals} <span class="badge">+${f.points}</span></div>`).join("")}
        </div>` : ""}
      <p class="small center"><a href="#/gruppe/${main.id}">Zur Tipprunde ›</a></p>
    ` : html`
      <div class="invite-card" style="text-align:center">
        <div style="font-size:34px">👥</div>
        <b>Tippe mit Freunden</b>
        <p class="muted small" style="margin:4px 0 10px">Gegen Freunde tippen macht am meisten Spass.</p>
        <div class="cta-grid" style="margin:0">
          <a class="cta" href="#/neu"><span class="cta-emoji">✨</span><b>Tipprunde starten</b></a>
          <a class="cta alt" href="#/beitreten"><span class="cta-emoji">🔑</span><b>Code eingeben</b></a>
        </div>
      </div>`}
  `);
}

// ---------------------------------------------------------------------------
// Form eines Teams: Tabelle der Gruppe und alle Spiele der Saison (als Blatt von unten)
// ---------------------------------------------------------------------------

function closeSheet() {
  document.querySelector(".sheet-wrap")?.remove();
  document.body.classList.remove("no-scroll");
}

async function showForm(teamId) {
  closeSheet();
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap";
  wrap.innerHTML = `<div class="sheet-bg"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Form"><div class="sheet-grip"></div><div class="sheet-body"><div class="loading">Laden …</div></div></div>`;
  document.body.appendChild(wrap);
  document.body.classList.add("no-scroll");
  wrap.querySelector(".sheet-bg").onclick = closeSheet;
  const body = wrap.querySelector(".sheet-body");

  try {
    const [team, league, games] = await Promise.all([
      sb.from("teams").select("id,name,logo_url").eq("id", teamId).maybeSingle(),
      sb.from("team_current_league").select("*").eq("team_id", teamId).maybeSingle(),
      sb.from("match_list").select("*").or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .order("kickoff", { ascending: false }).limit(60),
    ]);
    if (team.error) throw team.error;
    const t = team.data;
    if (!t) throw new Error("Team nicht gefunden.");
    let table = [];
    if (league.data) {
      const { data } = await sb.from("league_standings")
        .select("rank,played,won,drawn,lost,goals_for,goals_against,points,team_id,teams(name)")
        .eq("league_id", league.data.league_id).order("rank");
      table = data ?? [];
    }
    const played = (games.data ?? []).filter((m) => m.status === "finished");
    const upcoming = (games.data ?? []).filter((m) => m.status === "scheduled" && new Date(m.kickoff) > new Date()).reverse().slice(0, 3);
    const res = (m) => {
      const own = m.home_team_id === teamId ? m.home_goals : m.away_goals;
      const opp = m.home_team_id === teamId ? m.away_goals : m.home_goals;
      return own > opp ? "S" : own < opp ? "N" : "U";
    };
    const last5 = played.slice(0, 5);
    const sum = played.reduce((a, m) => { a[res(m)]++; return a; }, { S: 0, U: 0, N: 0 });
    const label = league.data?.label ?? t.name;

    body.innerHTML = html`
      <button type="button" class="sheet-close" aria-label="Schliessen">✕</button>
      <div class="form-head">
        ${crest(t.logo_url, t.name, 64)}
        <div><h2 style="margin:0">${esc(label)}</h2>
          ${league.data ? `<div class="muted small">${esc(league.data.source_name)} · ${esc(league.data.league_name)} · ${league.data.rank}. Platz</div>` : ""}</div>
      </div>

      <h3>Form (letzte ${last5.length})</h3>
      <div class="form-chips">
        ${last5.length ? last5.map((m) => `<span class="fc fc-${res(m)}" title="${esc(m.home_name)} ${m.home_goals}:${m.away_goals} ${esc(m.away_name)}">${res(m)}</span>`).join("") : `<span class="muted small">Noch keine Spiele.</span>`}
        ${played.length ? `<span class="muted small" style="margin-left:6px">Saison: ${sum.S} S · ${sum.U} U · ${sum.N} N</span>` : ""}
      </div>

      ${table.length ? html`
        <h3>Tabelle</h3>
        <div class="card" style="padding:4px 8px"><table class="tbl">
          <tr><th>#</th><th class="l">Team</th><th>Sp</th><th>S</th><th>U</th><th>N</th><th>Tore</th><th>P</th></tr>
          ${table.map((r) => `<tr class="${r.team_id === teamId ? "me" : ""}"><td>${r.rank}</td><td class="name">${esc(r.teams?.name)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.goals_for}:${r.goals_against}</td><td><b>${r.points}</b></td></tr>`).join("")}
        </table></div>` : ""}

      ${upcoming.length ? html`
        <h3>Nächste Spiele</h3>
        <div class="card" style="padding:2px 12px">${upcoming.map((m) => html`
          <div class="fm-row"><span class="fm-date">${new Intl.DateTimeFormat("de-CH", { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(new Date(m.kickoff))}</span>
          <span class="fm-teams ${m.home_team_id === teamId ? "home" : ""}">${esc(m.home_name)} – ${esc(m.away_name)}</span><span class="muted small">${fmtTime(m.kickoff)}</span></div>`).join("")}</div>` : ""}

      <h3>Alle Spiele dieser Saison (${played.length})</h3>
      <div class="card" style="padding:2px 12px">
        ${played.map((m) => html`
          <div class="fm-row"><span class="fm-date">${new Intl.DateTimeFormat("de-CH", { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(new Date(m.kickoff))}</span>
          <span class="fm-teams"><span class="${m.home_team_id === teamId ? "own" : ""}">${esc(m.home_name)}</span> – <span class="${m.away_team_id === teamId ? "own" : ""}">${esc(m.away_name)}</span>${m.is_cup ? ' <span class="cup small">Cup</span>' : ""}</span>
          <span class="fm-res fc-${res(m)}">${m.home_goals}:${m.away_goals}</span></div>`).join("") || `<div class="empty">Noch keine Spiele gespielt.</div>`}
      </div>
    `;
    body.querySelector(".sheet-close").onclick = closeSheet;
  } catch (e) {
    body.innerHTML = `<p class="err">${esc(errMsg(e))}</p><button class="btn" type="button">Schliessen</button>`;
    body.querySelector("button").onclick = closeSheet;
  }
}

document.addEventListener("click", (e) => {
  const b = e.target.closest?.(".form-btn");
  if (b) { e.preventDefault(); e.stopPropagation(); vibrate(8); showForm(Number(b.dataset.team)); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
window.addEventListener("hashchange", closeSheet);

async function renderSpiele(groupArg) {
  await loadMeta();
  const groups = await loadGroups();
  let active = groupArg || store.get("activeGroup", groups[0]?.id ?? "alle");
  if (active !== "alle" && !groups.some((g) => g.id === active)) active = groups[0]?.id ?? "alle";
  store.set("activeGroup", active);
  const group = groups.find((g) => g.id === active);
  const f = store.get("filter", { cat: "", slug: "", league: "" });
  let days = group ? 14 : 7;
  const gained = await pointsBanner();

  const draw = async () => {
    const until = new Date(Date.now() + days * 86400000).toISOString();
    let q = sb.from("match_list").select("*").eq("status", "scheduled")
      .gt("kickoff", new Date().toISOString()).lte("kickoff", until)
      .order("kickoff").order("id").limit(300);
    q = group ? groupFilter(q, group) : applyFilter(q, f);
    const { data: matches, error } = await q;
    if (error) throw error;
    const tips = await myTipsFor(matches.map((m) => m.id));
    const done = matches.filter((m) => tips.has(m.id)).length;
    const pct = matches.length ? Math.round(done / matches.length * 100) : 0;

    let lastDay = "";
    const items = matches.map((m) => {
      const t = tips.get(m.id);
      const dk = dayKey(m.kickoff);
      const head = dk !== lastDay ? `<div class="day">${esc(fmtDay(m.kickoff))}</div>` : "";
      lastDay = dk;
      const mine = group?.team_id && (m.home_team_id === group.team_id || m.away_team_id === group.team_id);
      void head; return tipCard(m, t, { mine, label: group && !m.is_cup ? (mine ? "⭐ Spiel deines Teams" : esc(m.league_name ?? "")) : leagueLabel(m) });
    }).join("");

    const chips = html`
      <div class="chips">
        ${groups.map((g) => `<a class="chip ${g.id === active ? "on" : ""}" href="#/spiele/${g.id}">${esc(g.team_label || g.name)}</a>`).join("")}
        <a class="chip ${active === "alle" ? "on" : ""}" href="#/spiele/alle">Alle Spiele</a>
        <a class="chip add" href="#/neu">＋ Tipprunde</a>
      </div>`;

    setView(html`
      ${gained ? `<div class="gain pop">🎉 <b>+${gained.gained} Punkte</b> seit deinem letzten Besuch!<br><span class="small">Total ${gained.total} Punkte. <a href="#/resultate">Ansehen ›</a></span></div>` : ""}
      ${chips}
      ${group ? `<h1 class="h-group">${esc(group.name)}</h1><p class="muted small" style="margin-top:-6px">${esc(group.source_name ?? "")} · ${esc(group.league_name ?? "")}</p>` : `<h1>Alle Spiele</h1>${filterControls(f)}`}
      ${matches.length ? html`
        <div class="progress-wrap">
          <div class="progress-label"><span id="plabel">${done === matches.length ? "🔥 Alles getippt!" : `${done} von ${matches.length} getippt`}</span><span class="muted small">nächste ${days} Tage</span></div>
          <div class="progress"><div class="bar" id="pbar" style="width:${pct}%"></div></div>
        </div>` : ""}
      ${items || `<div class="empty">Keine Spiele in den nächsten ${days} Tagen.${group ? " Die nächste Runde kommt bestimmt!" : ""}</div>`}
      ${days < 120 ? `<button class="btn block" id="more">Weitere Spiele laden</button>` : ""}
    `);
    if (!group) bindFilters(f, draw);
    $view.querySelector("#more")?.addEventListener("click", () => { days = days < 14 ? 14 : days < 30 ? 30 : 120; draw(); });
    bindTipInputs(() => {
      const total = $view.querySelectorAll(".match[data-id]").length;
      const n = $view.querySelectorAll(".match.tipped").length;
      const bar = $view.querySelector("#pbar"), lab = $view.querySelector("#plabel");
      if (bar) bar.style.width = `${Math.round(n / total * 100)}%`;
      if (lab) lab.textContent = n === total ? "🔥 Alles getippt!" : `${n} von ${total} getippt`;
      if (n === total && total > 0 && !draw.celebrated) { draw.celebrated = true; confetti(80); vibrate([15, 30, 15]); }
    });
  };
  await draw();
  if (gained) { confetti(100); vibrate([20, 40, 20]); }
}

// Vereinswappen (oder Initiale, falls keins vorhanden)
function crest(url, name, size = 64) {
  const initial = esc((String(name || "?").replace(/^(FC|SC|FC\.|SV|SC|US|AC|BC)\s+/i, "").trim()[0] || "?").toUpperCase());
  return `<span class="crest-big" style="--s:${size}px" data-i="${initial}">${url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</span>`;
}

const chevUp = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 15l7-7 7 7" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const chevDown = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Tipp-Karte: Wappen links/rechts, in der Mitte zwei Zähler mit Pfeilen
function tipCard(m, t, { mine = false, label = "" } = {}) {
  const set = !!t;
  const stepper = (side, val, team) => html`
    <div class="stepper" data-side="${side}">
      <button type="button" class="st-up" aria-label="Tor mehr für ${esc(team)}">${chevUp}</button>
      <div class="st-num ${set ? "" : "unset"}" aria-live="polite">${set ? val : 0}</div>
      <button type="button" class="st-down" aria-label="Tor weniger für ${esc(team)}" ${!set || val === 0 ? "disabled" : ""}>${chevDown}</button>
    </div>`;
  return html`
    <div class="match tipcard ${set ? "tipped" : ""} ${mine ? "mine" : ""}" data-id="${m.id}"
         data-h="${set ? t.home_goals : ""}" data-a="${set ? t.away_goals : ""}">
      <div class="tc-date">${esc(fmtDay(m.kickoff))}, ${fmtTime(m.kickoff)} Uhr</div>
      <div class="tc-league">${label}</div>
      <div class="duel">
        <div class="side">${crest(m.home_logo, m.home_name)}<div class="tname">${esc(m.home_name)}</div><button type="button" class="form-btn" data-team="${m.home_team_id}">📈 Form</button></div>
        ${stepper("h", t?.home_goals ?? 0, m.home_name)}
        <div class="colon">:</div>
        ${stepper("a", t?.away_goals ?? 0, m.away_name)}
        <div class="side">${crest(m.away_logo, m.away_name)}<div class="tname">${esc(m.away_name)}</div><button type="button" class="form-btn" data-team="${m.away_team_id}">📈 Form</button></div>
      </div>
      <div class="foot">
        <span class="status">${set ? '<span class="saved">✓ getippt</span>' : '<span class="muted">Tippe auf die Pfeile</span>'}</span>
        <span>${m.is_cup ? '<span class="cup small">2× Punkte</span> ' : ""}<button type="button" class="linkbtn clear" ${set ? "" : "hidden"}>Tipp löschen</button></span>
      </div>
    </div>`;
}

function bindTipInputs(onChange = () => {}) {
  for (const card of $view.querySelectorAll(".tipcard[data-id]")) {
    const id = Number(card.dataset.id);
    const status = card.querySelector(".status");
    const clearBtn = card.querySelector(".clear");
    const nums = { h: card.querySelector('[data-side="h"] .st-num'), a: card.querySelector('[data-side="a"] .st-num') };
    const downs = { h: card.querySelector('[data-side="h"] .st-down'), a: card.querySelector('[data-side="a"] .st-down') };
    let timer;

    const val = (s) => (card.dataset[s] === "" ? null : Number(card.dataset[s]));
    const paint = () => {
      for (const s of ["h", "a"]) {
        const v = val(s);
        nums[s].textContent = v ?? 0;
        nums[s].classList.toggle("unset", v === null);
        downs[s].disabled = v === null || v === 0;
      }
    };
    const save = async () => {
      const h = val("h"), a = val("a");
      try {
        if (h === null) {
          const { error } = await sb.rpc("delete_tip", { p_match_id: id });
          if (error) throw error;
          status.innerHTML = '<span class="muted">Tipp gelöscht</span>';
          card.classList.remove("tipped"); clearBtn.hidden = true;
        } else {
          const { error } = await sb.rpc("save_tip", { p_match_id: id, p_home: h, p_away: a });
          if (error) throw error;
          status.innerHTML = `<span class="saved pop">✓ gespeichert (${h}:${a})</span>`;
          card.classList.add("tipped"); clearBtn.hidden = false;
          card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
        }
        onChange();
      } catch (e) {
        status.innerHTML = `<span class="err">${esc(errMsg(e))}</span>`;
      }
    };
    const change = (side, delta) => {
      // erster Klick: beide Seiten starten bei 0
      if (val("h") === null) { card.dataset.h = "0"; card.dataset.a = "0"; }
      const next = Math.max(0, Math.min(20, val(side) + delta));
      card.dataset[side] = String(next);
      paint(); vibrate(8);
      nums[side].classList.remove("bump"); void nums[side].offsetWidth; nums[side].classList.add("bump");
      status.innerHTML = '<span class="muted">…</span>';
      clearTimeout(timer);
      timer = setTimeout(save, 650);
    };
    for (const s of ["h", "a"]) {
      card.querySelector(`[data-side="${s}"] .st-up`).onclick = () => change(s, +1);
      downs[s].onclick = () => change(s, -1);
      // Tippen auf die Zahl setzt einen 0:0-Tipp, wenn noch keiner da ist
      nums[s].onclick = () => { if (val("h") === null) change(s, 0); };
    }
    clearBtn.onclick = () => {
      card.dataset.h = ""; card.dataset.a = "";
      paint(); clearTimeout(timer); save();
    };
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


function boardRows(data, me, { tips = true } = {}) {
  return data.map((r) => html`
    <tr class="${r.user_id === me ? "me" : ""}">
      <td class="rk">${r.rank}</td>
      <td class="name"><span class="who">${avatar(r.picture, r.username, 32)}<span class="who-t"><b>${esc(r.username)}</b>${r.team_name ? `<span class="muted small">${esc(r.team_name)}</span>` : ""}</span></span></td>
      ${tips ? `<td>${r.tips_count}</td>` : ""}<td>${r.exact_count}</td><td><b>${r.points}</b></td>
    </tr>`).join("");
}

function podium(data) {
  const top = data.filter((r) => r.points > 0).slice(0, 3);
  if (top.length < 2) return "";
  const order = [top[1], top[0], top[2]].filter(Boolean);
  const medal = { 1: "🥇", 2: "🥈", 3: "🥉" };
  return `<div class="podium">${order.map((r) => html`
    <div class="pod pod-${r.rank <= 3 ? r.rank : 3}">
      ${avatar(r.picture, r.username, r.rank === 1 ? 64 : 52)}
      <div class="pod-name">${esc(r.username)}</div>
      <div class="pod-pts">${r.points} P</div>
      <div class="pod-step">${medal[r.rank] ?? r.rank}</div>
    </div>`).join("")}</div>`;
}

async function renderRangliste(sel = "alle") {
  const groups = await loadGroups(true);
  const period = store.get("period", "week");
  if (sel === "gesamt") sel = "alle";

  const chips = html`
    <div class="chips">
      <a class="chip ${sel === "alle" ? "on" : ""}" href="#/rangliste/alle">🌍 Alle</a>
      ${groups.map((g) => `<a class="chip ${sel === g.id ? "on" : ""}" href="#/rangliste/${g.id}">${esc(g.name)}</a>`).join("")}
      <a class="chip ${sel === "gruppen" ? "on" : ""}" href="#/rangliste/gruppen">Tipprunden-Vergleich</a>
    </div>`;

  if (sel === "gruppen") {
    const { data, error } = await sb.rpc("group_ranking");
    if (error) throw error;
    return setView(html`
      <h1>Rangliste</h1>${chips}
      <p class="muted small">Tipprunden werden nach dem Punkte-Durchschnitt ihrer Mitglieder verglichen.</p>
      ${data.length ? `<div class="card"><table class="tbl">
        <tr><th>#</th><th class="l">Tipprunde</th><th>Mitgl.</th><th>Ø Punkte</th></tr>
        ${data.map((r) => `<tr class="${r.is_member ? "me" : ""}"><td>${r.rank}</td><td class="name">${esc(r.name)}</td><td>${r.members}</td><td><b>${r.avg_points}</b></td></tr>`).join("")}
      </table></div>` : `<div class="empty">Noch keine Tipprunden.</div>`}
    `);
  }

  const groupId = sel === "alle" ? null : sel;
  const { data, error } = await sb.rpc("leaderboard", { p_group_id: groupId, p_period: period });
  if (error) throw error;
  const me = state.session.user.id;
  const mine = data.find((r) => r.user_id === me);
  setView(html`
    <h1>Rangliste</h1>
    <div class="tabs2">
      <button data-period="week" class="${period === "week" ? "on" : ""}">🔥 Diese Woche</button>
      <button data-period="all" class="${period === "all" ? "on" : ""}">🏆 All Time</button>
    </div>
    ${chips}
    ${period === "week" ? `<p class="muted small">Punkte aus Spielen seit Montag. Jeden Montag startet das Rennen neu.</p>` : ""}
    ${podium(data)}
    ${mine ? `<div class="stat">
      <div class="card"><b>${mine.rank}.</b><span>von ${data.length}</span></div>
      <div class="card"><b>${mine.points}</b><span>Punkte</span></div>
      <div class="card"><b>${mine.exact_count}</b><span>🎯 genau richtig</span></div>
    </div>` : ""}
    <div class="card" style="padding:4px 10px"><table class="tbl board">
      <tr><th>#</th><th class="l">Spieler:in</th><th title="ausgewertete Tipps">Tipps</th><th title="genaue Resultate">🎯</th><th>Punkte</th></tr>
      ${boardRows(data, me)}
    </table></div>
    <p class="muted small">Bei Punktgleichheit entscheidet die Anzahl genau richtiger Resultate.</p>
  `);
  for (const b of $view.querySelectorAll("[data-period]")) {
    b.onclick = () => { store.set("period", b.dataset.period); vibrate(); renderRangliste(sel); };
  }
}

// ---------------------------------------------------------------------------
// Gruppen
// ---------------------------------------------------------------------------

async function renderGruppen() {
  const groups = await loadGroups(true);
  const me = state.session.user.id;
  // Abzeichen der Teams und eigene Platzierung pro Tipprunde
  const teamIds = [...new Set(groups.map((g) => g.team_id).filter(Boolean))];
  const [logos, ranks] = await Promise.all([
    teamIds.length ? sb.from("teams").select("id,logo_url").in("id", teamIds) : { data: [] },
    Promise.all(groups.map((g) => sb.rpc("leaderboard", { p_group_id: g.id, p_period: "all" }))),
  ]);
  const logoOf = new Map((logos.data ?? []).map((t) => [t.id, t.logo_url]));
  const rankOf = new Map(groups.map((g, i) => [g.id, (ranks[i].data ?? []).find((r) => r.user_id === me)]));
  setView(html`
    <h1>Tipprunden</h1>
    ${groups.length ? "" : `<div class="hero small-hero"><div class="hero-emoji bounce">👥</div>
      <p class="hero-sub">Allein tippen ist gut, gegen Freunde tippen ist besser.</p></div>`}
    <div class="cta-grid">
      <a class="cta" href="#/neu"><span class="cta-emoji">✨</span><b>Neue Tipprunde</b><span class="small">Team wählen & Freunde einladen</span></a>
      <a class="cta alt" href="#/beitreten"><span class="cta-emoji">🔑</span><b>Code eingeben</b><span class="small">Einer Runde beitreten</span></a>
    </div>
    ${groups.length ? `<h2>Deine Tipprunden</h2>` : ""}
    <div class="list">
      ${groups.map((g) => html`
        <a class="group-card" href="#/gruppe/${g.id}">
          ${crest(logoOf.get(g.team_id), g.team_label || g.name, 56)}
          <span class="gc-text">
            <span class="gc-name">${esc(g.name)}</span>
            <span class="gc-sub">${g.team_label ? `⚽ ${esc(g.team_label)}` : "Alle Spiele"}</span>
            <span class="gc-sub">👥 ${g.members} ${g.members === 1 ? "Mitglied" : "Mitglieder"}</span>
          </span>
          <span class="gc-rank">${rankOf.get(g.id) ? `<b>${rankOf.get(g.id).rank}.</b><span>${rankOf.get(g.id).points} P</span>` : ""}</span>
          <span class="gc-chev">›</span>
        </a>`).join("")}
    </div>
  `);
}

async function renderGruppe(id) {
  const groups = await loadGroups(true);
  const g = groups.find((x) => x.id === id);
  if (!g) return setView(`<p><a href="#/gruppen">‹ Tipprunden</a></p><div class="empty">Tipprunde nicht gefunden.</div>`);
  const { data: board, error } = await sb.rpc("leaderboard", { p_group_id: id, p_period: "all" });
  if (error) throw error;
  const link = `${appUrl()}?join=${g.invite_code}`;
  const me = state.session.user.id;
  setView(html`
    <p><a href="#/gruppen">‹ Tipprunden</a></p>
    <h1 style="margin-bottom:2px">${esc(g.name)}</h1>
    ${g.team_label ? `<p class="muted" style="margin-top:0">⚽ ${esc(g.team_label)} · ${esc(g.source_name ?? "")} ${esc(g.league_name ?? "")}</p>` : ""}
    <a class="btn primary block big" href="#/spiele/${g.id}">📝 Spiele tippen</a>
    <h2>Rangliste</h2>
    ${podium(board)}
    <div class="card" style="padding:4px 10px"><table class="tbl board">
      <tr><th>#</th><th class="l">Spieler:in</th><th title="genaue Resultate">🎯</th><th>Punkte</th></tr>
      ${boardRows(board, me, { tips: false })}
    </table></div>
    <p class="center small"><a href="#/rangliste/${g.id}">Wochen-Rangliste dieser Tipprunde ›</a></p>
    ${board.length < 3 ? `<p class="muted small center">Zu zweit ist's ein Duell, ab drei wird's eine Liga. Lade mehr Leute ein!</p>` : ""}
    <div class="card center">
      <div class="muted small">Einladungscode</div>
      <div class="code" style="margin:6px 0">${esc(g.invite_code)}</div>
      <button class="btn primary block" id="share">📲 Freunde einladen</button>
    </div>
    ${g.owner_id === me ? `
    <h2>Umbenennen</h2>
    <form id="rename" class="card row"><input class="grow" type="text" name="name" value="${esc(g.name)}" minlength="2" maxlength="40" required><button class="btn">Speichern</button></form>` : ""}
    <p style="margin-top:24px"><button class="btn danger block" id="leave">Tipprunde verlassen</button></p>
  `);
  $view.querySelector("#share").onclick = () => shareInvite(g, link);
  $view.querySelector("#rename")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error: er } = await sb.from("groups").update({ name: new FormData(e.target).get("name") }).eq("id", id);
    if (er) return toast(errMsg(er), true);
    toast("Gespeichert."); route();
  });
  $view.querySelector("#leave").onclick = async () => {
    if (!confirm(`Tipprunde „${g.name}“ wirklich verlassen?`)) return;
    const { error: er } = await sb.rpc("leave_group", { p_group_id: id });
    if (er) return toast(errMsg(er), true);
    state.groups = null;
    toast("Tipprunde verlassen."); location.hash = "#/gruppen";
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
      <a class="item" href="#/resultate"><span>✅ Meine Tipps & Resultate</span><span class="muted">›</span></a>
      <a class="item" href="#/tabellen"><span>📊 Tabellen</span><span class="muted">›</span></a>
      <a class="item" href="#/regeln"><span>📖 Spielregeln</span><span class="muted">›</span></a>
      <a class="item" href="#/profil"><span>👤 Profil</span><span class="muted">›</span></a>
      ${state.profile?.is_admin ? `<a class="item" href="#/admin"><span>🛠️ Admin</span><span class="muted">›</span></a>` : ""}
      <button class="item" id="logout"><span>🚪 Abmelden</span><span></span></button>
    </div>
  `);
  $view.querySelector("#logout").onclick = async () => { await sb.auth.signOut(); location.hash = "#/home"; };
}

// Bild quadratisch zuschneiden und auf 256 px verkleinern (spart Speicher und Daten)
async function squareJpeg(file, size = 256) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  const src = bmp ?? await new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file);
  });
  const w = src.width, h = src.height, s = Math.min(w, h);
  const c = document.createElement("canvas"); c.width = c.height = size;
  c.getContext("2d").drawImage(src, (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size);
  return await new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
}

function renderProfil() {
  const p = state.profile;
  const hasPhoto = !!p.avatar_url;
  setView(html`
    <p><a href="#/mehr">‹ Mehr</a></p>
    <div class="profile-head">
      <label class="av-edit" title="Profilbild ändern">
        ${avatar(p.picture, p.username, 112)}
        <span class="av-badge">📷</span>
        <input type="file" id="file" accept="image/*" hidden>
      </label>
      <h1>${esc(p.username)}</h1>
      <p class="muted" style="margin:0">${p.team_name ? `⚽ ${esc(p.team_name)}` : "Noch kein Verein gewählt"}</p>
      <div class="row" style="justify-content:center;margin-top:10px">
        <button class="btn small" id="pick">📷 Foto wählen</button>
        ${hasPhoto && p.team_logo ? `<button class="btn small" id="crest">🛡️ Vereinsabzeichen verwenden</button>` : ""}
        ${hasPhoto && !p.team_logo ? `<button class="btn small" id="crest">Foto entfernen</button>` : ""}
      </div>
    </div>

    <h2>Mein Verein</h2>
    <p class="muted small">Das Abzeichen deines Vereins ist dein Profilbild, solange du kein eigenes Foto hast.</p>
    <input type="search" id="teamq" class="search-big" placeholder="🔍 Verein oder Mannschaft suchen" autocomplete="off">
    <div id="teamres" class="results"></div>

    <h2>Name</h2>
    <form id="prof" class="card row">
      <input class="grow" type="text" name="username" value="${esc(p.username)}" minlength="2" maxlength="30" required>
      <button class="btn primary">Speichern</button>
    </form>
    <h2>Passwort</h2>
    <form id="pw" class="card row">
      <input class="grow" type="password" name="pw" minlength="6" autocomplete="new-password" required placeholder="Neues Passwort">
      <button class="btn">Ändern</button>
    </form>
    <p class="muted small">E-Mail: ${esc(state.session.user.email)}</p>
    <p><button class="btn danger block" id="logout">Abmelden</button></p>
  `);

  const file = $view.querySelector("#file");
  $view.querySelector("#pick").onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      toast("Bild wird hochgeladen …");
      const blob = await squareJpeg(f);
      const path = `${state.session.user.id}/avatar.jpg`;
      const { error: upErr } = await sb.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl + `?v=${Date.now()}`;
      const { error } = await sb.rpc("set_avatar", { p_url: url });
      if (error) throw error;
      await loadProfile(); renderTop(); renderProfil();
      vibrate(); toast("Neues Profilbild gespeichert. Sieht gut aus! 😎");
    } catch (e) { toast(errMsg(e), true); }
  };
  $view.querySelector("#crest")?.addEventListener("click", async () => {
    const { error } = await sb.rpc("set_avatar", { p_url: null });
    if (error) return toast(errMsg(error), true);
    await sb.storage.from("avatars").remove([`${state.session.user.id}/avatar.jpg`]);
    await loadProfile(); renderTop(); renderProfil();
    toast(p.team_logo ? "Du zeigst jetzt dein Vereinsabzeichen." : "Foto entfernt.");
  });

  const q = $view.querySelector("#teamq"), res = $view.querySelector("#teamres");
  let t, seq = 0;
  q.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const v = q.value.trim();
      if (v.length < 2) { res.innerHTML = ""; return; }
      const my = ++seq;
      const { data, error } = await sb.rpc("search_teams", { p_query: v });
      if (my !== seq) return;
      if (error) { res.innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
      res.innerHTML = data.slice(0, 8).map((r, i) => `<button class="result" data-i="${i}"><span class="result-main"><b>${esc(r.label)}</b><br><span class="muted small">${esc(r.source_name)} · ${esc(r.league_name)}</span></span><span class="chev">›</span></button>`).join("")
        || `<div class="empty">Nichts gefunden.</div>`;
      for (const b of res.querySelectorAll(".result")) {
        b.onclick = async () => {
          const { error: er } = await sb.rpc("set_my_team", { p_team_id: data[Number(b.dataset.i)].team_id });
          if (er) return toast(errMsg(er), true);
          await loadProfile(); renderTop(); renderProfil();
          vibrate(); toast("Verein gespeichert ⚽");
        };
      }
    }, 200);
  });

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
  $view.querySelector("#logout").onclick = async () => { await sb.auth.signOut(); location.hash = "#/home"; };
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
