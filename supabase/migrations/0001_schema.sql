-- FVRZ Tippspiel – Datenbankschema
-- Tokens sind rein virtuell und nicht kaufbar.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null unique check (char_length(username) between 2 and 30),
  tokens        integer not null default 1000,
  is_admin      boolean not null default false,
  last_bonus_at timestamptz,
  created_at    timestamptz not null default now()
);

create table public.source_leagues (
  slug           text primary key,               -- footstats-Slug, z.B. fvrz-3-liga
  name           text not null,
  category       text not null,                  -- Aktive, Frauen, Junioren A/B/C
  sort_order     integer not null default 0,
  active         boolean not null default true,
  last_synced_at timestamptz
);

create table public.leagues (                      -- eine Zeile pro Gruppe
  id          bigint generated always as identity primary key,
  source_slug text not null references public.source_leagues(slug) on delete cascade,
  fs_group_id text not null unique,                -- aus <section id="group-xxxx">
  name        text not null,                       -- z.B. "Gruppe 1", "Herbstrunde – Gruppe 2"
  season      text,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table public.teams (
  id                bigint generated always as identity primary key,
  fs_team_id        text not null unique,
  name              text not null,
  matches_synced_at timestamptz,
  created_at        timestamptz not null default now()
);

create table public.league_standings (
  league_id     bigint not null references public.leagues(id) on delete cascade,
  team_id       bigint not null references public.teams(id) on delete cascade,
  rank          integer not null,
  played        integer not null default 0,
  won           integer not null default 0,
  drawn         integer not null default 0,
  lost          integer not null default 0,
  goals_for     integer not null default 0,
  goals_against integer not null default 0,
  points        integer not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (league_id, team_id)
);
create index on public.league_standings (team_id);

create table public.matches (
  id           bigint generated always as identity primary key,
  external_key text not null unique,
  league_id    bigint references public.leagues(id) on delete set null,  -- null = Cup/Freundschaft
  home_team_id bigint not null references public.teams(id),
  away_team_id bigint not null references public.teams(id),
  kickoff      timestamptz not null,
  home_goals   integer check (home_goals >= 0),
  away_goals   integer check (away_goals >= 0),
  status       text not null default 'scheduled' check (status in ('scheduled','finished','cancelled')),
  source       text not null default 'footstats',
  updated_at   timestamptz not null default now(),
  check (home_team_id <> away_team_id),
  check ((status = 'finished') = (home_goals is not null and away_goals is not null))
);
create index on public.matches (kickoff);
create index on public.matches (league_id, kickoff);
create index on public.matches (home_team_id);
create index on public.matches (away_team_id);
create index on public.matches (status, kickoff);

create table public.bets (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  match_id   bigint not null references public.matches(id) on delete cascade,
  pick       text not null check (pick in ('1','X','2')),
  stake      integer not null check (stake > 0),
  odds       numeric(6,2) not null check (odds >= 1),
  status     text not null default 'open' check (status in ('open','won','lost','refunded')),
  payout     integer not null default 0,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (user_id, match_id)
);
create index on public.bets (match_id);

create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 40),
  invite_code text not null unique,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index on public.group_members (user_id);

create table public.app_settings (
  key   text primary key,
  value jsonb not null
);

create table public.sync_log (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  kind    text not null,
  ok      boolean not null default true,
  detail  jsonb
);
create index on public.sync_log (at desc);

create table private.config (
  key   text primary key,
  value text not null
);

-- ---------------------------------------------------------------------------
-- Stammdaten
-- ---------------------------------------------------------------------------

insert into public.source_leagues (slug, name, category, sort_order) values
  ('fvrz-2-liga',                        '2. Liga',                     'Aktive',     10),
  ('fvrz-3-liga',                        '3. Liga',                     'Aktive',     20),
  ('fvrz-4-liga',                        '4. Liga',                     'Aktive',     30),
  ('fvrz-5-liga',                        '5. Liga',                     'Aktive',     40),
  ('fvrz-frauen-2-liga',                 'Frauen 2. Liga',              'Frauen',     50),
  ('fvrz-frauen-3-liga',                 'Frauen 3. Liga',              'Frauen',     60),
  ('fvrz-frauen-4-liga',                 'Frauen 4. Liga',              'Frauen',     70),
  ('fvrz-brack-youth-league-a',          'Junioren A Youth League',     'Junioren A', 80),
  ('fvrz-junioren-a-promotion',          'Junioren A Promotion',        'Junioren A', 90),
  ('fvrz-brack-youth-league-b',          'Junioren B Youth League',     'Junioren B', 100),
  ('fvrz-junioren-b-promotion',          'Junioren B Promotion',        'Junioren B', 110),
  ('fvrz-junioren-b-1-starkeklasse',     'Junioren B 1. Stärkeklasse',  'Junioren B', 120),
  ('fvrz-junioren-b-2-starkeklasse',     'Junioren B 2. Stärkeklasse',  'Junioren B', 130),
  ('fvrz-brack-youth-league-c',          'Junioren C Youth League',     'Junioren C', 140),
  ('fvrz-junioren-c-promotion',          'Junioren C Promotion',        'Junioren C', 150),
  ('fvrz-junioren-c-1-starkeklasse',     'Junioren C 1. Stärkeklasse',  'Junioren C', 160),
  ('fvrz-junioren-c-2-starkeklasse',     'Junioren C 2. Stärkeklasse',  'Junioren C', 170);

insert into public.app_settings (key, value) values
  ('start_tokens',      '1000'),
  ('weekly_bonus',      '100'),
  ('home_advantage',    '0.35'),
  ('margin',            '0.93'),
  ('min_odds',          '1.05'),
  ('max_odds',          '15'),
  ('cancel_after_days', '21');

insert into private.config (key, value)
values ('sync_secret', encode(extensions.gen_random_bytes(24), 'hex'));

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------

create or replace function public.setting_num(p_key text, p_default numeric)
returns numeric language sql stable set search_path = public as $$
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = p_key), p_default);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_group_member(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = p_group and user_id = auth.uid());
$$;

-- Neues Profil bei Registrierung; der erste Benutzer wird Admin.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_try  text;
  i      integer := 0;
begin
  v_name := coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''),
                     split_part(coalesce(new.email, 'spieler'), '@', 1));
  v_name := left(v_name, 26);
  if char_length(v_name) < 2 then v_name := 'spieler'; end if;
  v_try := v_name;
  while exists (select 1 from public.profiles where lower(username) = lower(v_try)) loop
    i := i + 1;
    v_try := v_name || i::text;
  end loop;

  perform pg_advisory_xact_lock(4711);
  insert into public.profiles (id, username, tokens, is_admin, last_bonus_at)
  values (new.id, v_try, public.setting_num('start_tokens', 1000)::int,
          not exists (select 1 from public.profiles), now());
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.set_username(p_username text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  p_username := trim(p_username);
  if char_length(p_username) not between 2 and 30 then
    raise exception 'Name muss 2 bis 30 Zeichen lang sein';
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(p_username) and id <> auth.uid()) then
    raise exception 'Name ist schon vergeben';
  end if;
  update public.profiles set username = p_username where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------------
-- Quoten
-- Stärke = Punkte pro Spiel (+ Heimvorteil); Unentschieden-Wahrscheinlichkeit
-- sinkt mit dem Stärkeunterschied. Quote = 0,93 / Wahrscheinlichkeit,
-- begrenzt auf 1,05 bis 15.
-- ---------------------------------------------------------------------------

create or replace function public.match_odds(p_match_id bigint)
returns table (odds_home numeric, odds_draw numeric, odds_away numeric)
language plpgsql stable set search_path = public as $$
declare
  m        public.matches;
  ppg_h    numeric;
  ppg_a    numeric;
  s_h      numeric;
  s_a      numeric;
  p_d      numeric;
  p_h      numeric;
  p_a      numeric;
  v_margin numeric := public.setting_num('margin', 0.93);
  v_min    numeric := public.setting_num('min_odds', 1.05);
  v_max    numeric := public.setting_num('max_odds', 15);
begin
  select * into m from public.matches where id = p_match_id;
  if not found then return; end if;

  -- Punkte pro Spiel: bevorzugt aus der Gruppe des Spiels, sonst aus der aktuellsten Tabelle des Teams
  select ls.points::numeric / nullif(ls.played, 0) into ppg_h
    from public.league_standings ls
   where ls.team_id = m.home_team_id
   order by (ls.league_id = m.league_id) desc nulls last, ls.updated_at desc
   limit 1;
  select ls.points::numeric / nullif(ls.played, 0) into ppg_a
    from public.league_standings ls
   where ls.team_id = m.away_team_id
   order by (ls.league_id = m.league_id) desc nulls last, ls.updated_at desc
   limit 1;

  s_h := greatest(coalesce(ppg_h, 1.35), 0.15) + public.setting_num('home_advantage', 0.35);
  s_a := greatest(coalesce(ppg_a, 1.35), 0.15);

  p_d := 0.28 - 0.12 * least(abs(s_h - s_a) / 1.5, 1);
  p_h := (1 - p_d) * s_h ^ 1.6 / (s_h ^ 1.6 + s_a ^ 1.6);
  p_a := 1 - p_d - p_h;

  odds_home := round(least(greatest(v_margin / p_h, v_min), v_max), 2);
  odds_draw := round(least(greatest(v_margin / p_d, v_min), v_max), 2);
  odds_away := round(least(greatest(v_margin / p_a, v_min), v_max), 2);
  return next;
end $$;

-- Spiele inkl. Teamnamen und Quoten für das Frontend
create or replace view public.match_list with (security_invoker = true) as
select m.id, m.league_id, l.name as league_name, sl.slug as source_slug, sl.name as source_name,
       sl.category, m.kickoff, m.status, m.home_goals, m.away_goals,
       m.home_team_id, th.name as home_name, m.away_team_id, ta.name as away_name,
       o.odds_home, o.odds_draw, o.odds_away
  from public.matches m
  join public.teams th on th.id = m.home_team_id
  join public.teams ta on ta.id = m.away_team_id
  left join public.leagues l on l.id = m.league_id
  left join public.source_leagues sl on sl.slug = l.source_slug
  left join lateral public.match_odds(m.id) o on true;

-- ---------------------------------------------------------------------------
-- Tipps
-- ---------------------------------------------------------------------------

create or replace function public.place_bet(p_match_id bigint, p_pick text, p_stake integer)
returns public.bets language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  m      public.matches;
  o      record;
  v_odds numeric;
  b      public.bets;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  if p_pick not in ('1','X','2') then raise exception 'Ungültiger Tipp'; end if;
  if p_stake is null or p_stake < 1 then raise exception 'Einsatz muss mindestens 1 Token sein'; end if;

  select * into m from public.matches where id = p_match_id for share;
  if not found then raise exception 'Spiel nicht gefunden'; end if;
  if m.status <> 'scheduled' or m.kickoff <= now() then
    raise exception 'Auf dieses Spiel kann nicht mehr getippt werden';
  end if;
  if exists (select 1 from public.bets where user_id = v_uid and match_id = p_match_id) then
    raise exception 'Du hast auf dieses Spiel schon getippt';
  end if;

  update public.profiles set tokens = tokens - p_stake
   where id = v_uid and tokens >= p_stake;
  if not found then raise exception 'Nicht genug Tokens'; end if;

  select * into o from public.match_odds(p_match_id);
  v_odds := case p_pick when '1' then o.odds_home when 'X' then o.odds_draw else o.odds_away end;

  insert into public.bets (user_id, match_id, pick, stake, odds)
  values (v_uid, p_match_id, p_pick, p_stake, v_odds)
  returning * into b;
  return b;
end $$;

create or replace function public.cancel_bet(p_bet_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  b public.bets;
begin
  select b2.* into b from public.bets b2
   where b2.id = p_bet_id and b2.user_id = auth.uid() for update;
  if not found then raise exception 'Tipp nicht gefunden'; end if;
  if b.status <> 'open' or exists (
       select 1 from public.matches where id = b.match_id and (kickoff <= now() or status <> 'scheduled')) then
    raise exception 'Tipp kann nicht mehr zurückgezogen werden';
  end if;
  delete from public.bets where id = b.id;
  update public.profiles set tokens = tokens + b.stake where id = b.user_id;
end $$;

-- ---------------------------------------------------------------------------
-- Auswertung: rechnet bei jeder Resultatänderung neu (auch bei Korrekturen)
-- ---------------------------------------------------------------------------

create or replace function private.settle_match(p_match_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  m        public.matches;
  v_result text;
begin
  select * into m from public.matches where id = p_match_id;
  if not found then return; end if;

  -- 1. Bisherige Auswertung rückgängig machen
  update public.profiles p set tokens = p.tokens - s.total
    from (select user_id, sum(payout) total from public.bets
           where match_id = p_match_id and status <> 'open' group by user_id) s
   where p.id = s.user_id;
  update public.bets set status = 'open', payout = 0, settled_at = null
   where match_id = p_match_id and status <> 'open';

  -- 2. Neu auswerten
  if m.status = 'cancelled' then
    update public.bets set status = 'refunded', payout = stake, settled_at = now()
     where match_id = p_match_id;
  elsif m.status = 'finished' then
    v_result := case when m.home_goals > m.away_goals then '1'
                     when m.home_goals < m.away_goals then '2' else 'X' end;
    update public.bets
       set status = case when pick = v_result then 'won' else 'lost' end,
           payout = case when pick = v_result then floor(stake * odds)::int else 0 end,
           settled_at = now()
     where match_id = p_match_id;
  else
    return;
  end if;

  update public.profiles p set tokens = p.tokens + s.total
    from (select user_id, sum(payout) total from public.bets
           where match_id = p_match_id and status <> 'open' group by user_id) s
   where p.id = s.user_id;
end $$;

create or replace function private.matches_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     or new.home_goals is distinct from old.home_goals
     or new.away_goals is distinct from old.away_goals then
    perform private.settle_match(new.id);
  end if;
  return null;
end $$;

create trigger matches_settle
  after update of status, home_goals, away_goals on public.matches
  for each row execute function private.matches_after_change();

create or replace function private.matches_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger matches_touch before update on public.matches
  for each row execute function private.matches_touch();

-- ---------------------------------------------------------------------------
-- Wochenbonus
-- ---------------------------------------------------------------------------

create or replace function public.grant_weekly_bonus()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.profiles
     set tokens = tokens + public.setting_num('weekly_bonus', 100)::int,
         last_bonus_at = now()
   where last_bonus_at is null or last_bonus_at < now() - interval '6 days 12 hours';
  get diagnostics n = row_count;
  insert into public.sync_log (kind, detail) values ('weekly_bonus', jsonb_build_object('users', n));
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Gruppen
-- ---------------------------------------------------------------------------

create or replace function public.create_group(p_name text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare
  g      public.groups;
  v_code text;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  loop
    v_code := upper(substr(encode(extensions.gen_random_bytes(6), 'base64'), 1, 6));
    v_code := translate(v_code, '+/0O1I', 'XYZQRS');
    exit when not exists (select 1 from public.groups where invite_code = v_code);
  end loop;
  insert into public.groups (name, invite_code, owner_id)
  values (trim(p_name), v_code, auth.uid()) returning * into g;
  insert into public.group_members (group_id, user_id) values (g.id, auth.uid());
  return g;
end $$;

create or replace function public.join_group(p_code text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select * into g from public.groups where invite_code = upper(trim(p_code));
  if not found then raise exception 'Einladungscode ungültig'; end if;
  insert into public.group_members (group_id, user_id) values (g.id, auth.uid())
  on conflict do nothing;
  return g;
end $$;

create or replace function public.leave_group(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.group_members where group_id = p_group_id and user_id = auth.uid();
  -- leere Gruppen löschen, sonst Besitz weitergeben
  if not exists (select 1 from public.group_members where group_id = p_group_id) then
    delete from public.groups where id = p_group_id;
  else
    update public.groups g set owner_id = (
      select user_id from public.group_members where group_id = p_group_id order by joined_at limit 1)
     where g.id = p_group_id and g.owner_id = auth.uid();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Ranglisten (gesamt oder pro Gruppe). Wert = Tokens + offene Einsätze.
-- ---------------------------------------------------------------------------

create or replace function public.leaderboard(p_group_id uuid default null)
returns table (rank bigint, user_id uuid, username text, tokens integer, open_stakes bigint,
               total bigint, bets_count bigint, won_count bigint)
language sql stable security definer set search_path = public as $$
  with members as (
    select p.* from public.profiles p
     where p_group_id is null
        or (public.is_group_member(p_group_id)
            and exists (select 1 from public.group_members gm
                         where gm.group_id = p_group_id and gm.user_id = p.id))
  ), stats as (
    select m.id, m.username, m.tokens,
           coalesce(sum(b.stake) filter (where b.status = 'open'), 0) open_stakes,
           count(b.id) bets_count,
           count(b.id) filter (where b.status = 'won') won_count
      from members m left join public.bets b on b.user_id = m.id
     group by m.id, m.username, m.tokens
  )
  select rank() over (order by tokens + open_stakes desc), id, username, tokens, open_stakes,
         tokens + open_stakes, bets_count, won_count
    from stats
   order by 1, username;
$$;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_result(p_match_id bigint, p_home integer, p_away integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur für Admins'; end if;
  update public.matches
     set home_goals = p_home, away_goals = p_away,
         status = case when p_home is null then 'scheduled' else 'finished' end,
         source = 'admin'
   where id = p_match_id;
end $$;

create or replace function public.admin_cancel_match(p_match_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur für Admins'; end if;
  update public.matches set status = 'cancelled', home_goals = null, away_goals = null, source = 'admin'
   where id = p_match_id;
end $$;

create or replace function public.admin_set_tokens(p_user_id uuid, p_tokens integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur für Admins'; end if;
  update public.profiles set tokens = p_tokens where id = p_user_id;
end $$;

create or replace function public.admin_set_admin(p_user_id uuid, p_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur für Admins'; end if;
  if p_user_id = auth.uid() and not p_admin then raise exception 'Du kannst dir selbst die Admin-Rechte nicht entziehen'; end if;
  update public.profiles set is_admin = p_admin where id = p_user_id;
end $$;

-- ---------------------------------------------------------------------------
-- footstats-Sync (wird nur von der Edge Function "sync" mit service_role aufgerufen)
-- ---------------------------------------------------------------------------

create or replace function private.call_sync(p_mode text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  select value into v_url from private.config where key = 'functions_url';
  if v_url is null then
    v_url := 'https://saguzhqngpyafvwetsnw.supabase.co/functions/v1';
  end if;
  return net.http_post(
    url := v_url || '/sync?mode=' || p_mode,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select value from private.config where key = 'sync_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
end $$;

-- Löst einen sofortigen Import aus (ruft die Edge Function "sync" über pg_net auf)
create or replace function public.admin_trigger_sync(p_mode text default 'all')
returns bigint language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Nur für Admins'; end if;
  return private.call_sync(p_mode);
end $$;

create or replace function public.fs_check_secret(p_secret text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from private.config where key = 'sync_secret' and value = p_secret);
$$;

create or replace function private.upsert_team(p_fs_id text, p_name text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.teams (fs_team_id, name) values (p_fs_id, coalesce(nullif(p_name, ''), p_fs_id))
  on conflict (fs_team_id) do update
     set name = case when excluded.name <> excluded.fs_team_id then excluded.name else public.teams.name end
  returning id into v_id;
  return v_id;
end $$;

-- p_groups: [{fs_group_id, name, standings: [{fs_team_id, team_name, rank, played, won, drawn, lost, gf, ga, points}]}]
create or replace function public.fs_sync_league(p_slug text, p_season text, p_groups jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  g       jsonb;
  s       jsonb;
  v_lid   bigint;
  v_tid   bigint;
  v_tids  bigint[];
  v_seen  text[] := '{}';
  n       integer := 0;
begin
  for g in select * from jsonb_array_elements(p_groups) loop
    insert into public.leagues (source_slug, fs_group_id, name, season, active, updated_at)
    values (p_slug, g->>'fs_group_id', g->>'name', p_season, true, now())
    on conflict (fs_group_id) do update
       set name = excluded.name, season = coalesce(excluded.season, public.leagues.season),
           active = true, updated_at = now()
    returning id into v_lid;
    v_seen := v_seen || (g->>'fs_group_id');
    v_tids := '{}';

    for s in select * from jsonb_array_elements(g->'standings') loop
      v_tid := private.upsert_team(s->>'fs_team_id', s->>'team_name');
      v_tids := v_tids || v_tid;
      insert into public.league_standings
        (league_id, team_id, rank, played, won, drawn, lost, goals_for, goals_against, points, updated_at)
      values (v_lid, v_tid, (s->>'rank')::int, (s->>'played')::int, (s->>'won')::int, (s->>'drawn')::int,
              (s->>'lost')::int, (s->>'gf')::int, (s->>'ga')::int, (s->>'points')::int, now())
      on conflict (league_id, team_id) do update
         set rank = excluded.rank, played = excluded.played, won = excluded.won, drawn = excluded.drawn,
             lost = excluded.lost, goals_for = excluded.goals_for, goals_against = excluded.goals_against,
             points = excluded.points, updated_at = now();
    end loop;
    -- Teams, die nicht mehr in der Tabelle stehen, entfernen
    delete from public.league_standings where league_id = v_lid and not (team_id = any (v_tids));
    n := n + 1;
  end loop;

  -- Gruppen, die nicht mehr auf der Liga-Seite stehen (z.B. Herbstrunde im Frühling), deaktivieren
  if n > 0 then
    update public.leagues set active = false
     where source_slug = p_slug and active and not (fs_group_id = any (v_seen));
  end if;
  update public.source_leagues set last_synced_at = now() where slug = p_slug;
  return n;
end $$;

-- Teams, deren Spielplan als Nächstes geholt werden soll:
-- zuerst Teams mit vergangenen Spielen ohne Resultat, dann die am längsten nicht aktualisierten.
create or replace function public.fs_teams_to_refresh(p_limit integer default 40)
returns table (fs_team_id text, reason text)
language sql stable security definer set search_path = public as $$
  with active_teams as (
    select distinct t.id, t.fs_team_id, t.matches_synced_at
      from public.teams t
      join public.league_standings ls on ls.team_id = t.id
      join public.leagues l on l.id = ls.league_id and l.active
  ), pending as (
    select at.id, min(m.kickoff) oldest_pending
      from active_teams at
      join public.matches m on (m.home_team_id = at.id or m.away_team_id = at.id)
     where m.status = 'scheduled'
       and m.kickoff < now() - interval '2 hours'
       and m.kickoff > now() - interval '21 days'
     group by at.id
  )
  select at.fs_team_id,
         case when at.matches_synced_at is null then 'neu'
              when p.id is not null then 'resultat fehlt' else 'routine' end
    from active_teams at left join pending p on p.id = at.id
   where at.matches_synced_at is null
      or (p.id is not null and at.matches_synced_at < now() - interval '50 minutes')
      or at.matches_synced_at < now() - interval '20 hours'
   order by (at.matches_synced_at is null) desc,
            (p.id is not null) desc,
            at.matches_synced_at nulls first
   limit p_limit;
$$;

-- p_matches: [{date:'YYYY-MM-DD', time:'HH:MM', home_id, home_name, away_id, away_name, home_goals, away_goals}]
create or replace function public.fs_sync_team_matches(p_fs_team_id text, p_matches jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  x       jsonb;
  v_home  bigint;
  v_away  bigint;
  v_lid   bigint;
  v_ko    timestamptz;
  v_key   text;
  v_hg    integer;
  v_ag    integer;
  v_cur   public.matches;
  n       integer := 0;
begin
  for x in select * from jsonb_array_elements(p_matches) loop
    v_home := private.upsert_team(x->>'home_id', x->>'home_name');
    v_away := private.upsert_team(x->>'away_id', x->>'away_name');
    if v_home = v_away then continue; end if;
    v_ko := ((x->>'date') || ' ' || coalesce(nullif(x->>'time', ''), '12:00'))::timestamp
            at time zone 'Europe/Zurich';
    v_hg := nullif(x->>'home_goals', '')::int;
    v_ag := nullif(x->>'away_goals', '')::int;
    if v_hg is null or v_ag is null then v_hg := null; v_ag := null; end if;

    -- Meisterschaftsspiel, wenn beide Teams in derselben aktiven Gruppe sind
    v_lid := null;
    select l.id into v_lid
      from public.leagues l
      join public.league_standings a on a.league_id = l.id and a.team_id = v_home
      join public.league_standings b on b.league_id = l.id and b.team_id = v_away
     where l.active
     order by l.updated_at desc
     limit 1;

    v_key := case when v_lid is not null
                  then 'L' || v_lid || ':' || (x->>'home_id') || ':' || (x->>'away_id')
                  else 'C:' || (x->>'date') || ':' || (x->>'home_id') || ':' || (x->>'away_id') end;

    select * into v_cur from public.matches where external_key = v_key;
    if not found then
      insert into public.matches (external_key, league_id, home_team_id, away_team_id, kickoff,
                                  home_goals, away_goals, status)
      values (v_key, v_lid, v_home, v_away, v_ko, v_hg, v_ag,
              case when v_hg is not null then 'finished' else 'scheduled' end);
      n := n + 1;
    elsif v_cur.source = 'admin' and v_hg is null then
      -- manuell gesetztes Resultat nicht mit "leer" überschreiben
      update public.matches set kickoff = v_ko where id = v_cur.id and kickoff is distinct from v_ko;
    elsif v_cur.kickoff is distinct from v_ko
       or v_cur.home_goals is distinct from v_hg
       or v_cur.away_goals is distinct from v_ag
       or (v_cur.status = 'cancelled' and (v_hg is not null or v_ko > now())) then
      update public.matches
         set kickoff = v_ko, home_goals = v_hg, away_goals = v_ag,
             status = case when v_hg is not null then 'finished' else 'scheduled' end,
             source = 'footstats'
       where id = v_cur.id;
      n := n + 1;
    end if;
  end loop;

  update public.teams set matches_synced_at = now() where fs_team_id = p_fs_team_id;
  return n;
end $$;

-- Spiele ohne Resultat nach 21 Tagen gelten als abgesagt (Einsätze zurück); Log aufräumen.
create or replace function public.fs_housekeeping()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.matches set status = 'cancelled'
   where status = 'scheduled'
     and kickoff < now() - make_interval(days => public.setting_num('cancel_after_days', 21)::int);
  get diagnostics n = row_count;
  delete from public.sync_log where at < now() - interval '30 days';
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public  from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;

grant execute on function
  public.match_odds(bigint), public.is_admin(), public.is_group_member(uuid), public.setting_num(text, numeric)
  to anon, authenticated;
grant execute on function
  public.place_bet(bigint, text, integer), public.cancel_bet(bigint), public.set_username(text),
  public.create_group(text), public.join_group(text), public.leave_group(uuid),
  public.leaderboard(uuid),
  public.admin_set_result(bigint, integer, integer), public.admin_cancel_match(bigint),
  public.admin_set_tokens(uuid, integer), public.admin_set_admin(uuid, boolean),
  public.admin_trigger_sync(text)
  to authenticated;

revoke execute on function
  public.fs_sync_league(text, text, jsonb), public.fs_teams_to_refresh(integer),
  public.fs_sync_team_matches(text, jsonb), public.fs_housekeeping(), public.fs_check_secret(text),
  public.grant_weekly_bonus(), public.handle_new_user()
  from authenticated;
grant usage on schema private to service_role;
grant execute on function
  public.fs_sync_league(text, text, jsonb), public.fs_teams_to_refresh(integer),
  public.fs_sync_team_matches(text, jsonb), public.fs_housekeeping(), public.fs_check_secret(text),
  public.grant_weekly_bonus()
  to service_role;

alter default privileges in schema public revoke execute on functions from public, anon;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.source_leagues   enable row level security;
alter table public.leagues          enable row level security;
alter table public.teams            enable row level security;
alter table public.league_standings enable row level security;
alter table public.matches          enable row level security;
alter table public.bets             enable row level security;
alter table public.groups           enable row level security;
alter table public.group_members    enable row level security;
alter table public.app_settings     enable row level security;
alter table public.sync_log         enable row level security;

-- Öffentliche Fussballdaten: lesen für alle, schreiben nur über Funktionen
create policy "lesen" on public.source_leagues   for select using (true);
create policy "lesen" on public.leagues          for select using (true);
create policy "lesen" on public.teams            for select using (true);
create policy "lesen" on public.league_standings for select using (true);
create policy "lesen" on public.matches          for select using (true);
create policy "lesen" on public.app_settings     for select using (true);

create policy "angemeldete sehen Profile" on public.profiles
  for select to authenticated using (true);

create policy "eigene Tipps" on public.bets
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

create policy "Gruppen der Mitglieder" on public.groups
  for select to authenticated using (public.is_group_member(id));
create policy "Besitzer benennt um" on public.groups
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "Mitglieder sehen Mitglieder" on public.group_members
  for select to authenticated using (public.is_group_member(group_id));

create policy "Admins sehen Sync-Log" on public.sync_log
  for select to authenticated using (public.is_admin());

-- Spaltenrechte: Gruppen dürfen nur umbenannt werden
revoke update on public.groups from authenticated;
grant update (name) on public.groups to authenticated;

-- ---------------------------------------------------------------------------
-- Zeitpläne (pg_cron)
-- ---------------------------------------------------------------------------

select cron.schedule('fs-sync-leagues', '7 * * * *',  $$select private.call_sync('leagues')$$);
select cron.schedule('fs-sync-teams',   '22,52 * * * *', $$select private.call_sync('teams')$$);
select cron.schedule('fs-housekeeping', '15 3 * * *', $$select public.fs_housekeeping()$$);
select cron.schedule('weekly-bonus',    '0 6 * * 1',  $$select public.grant_weekly_bonus()$$);
select cron.schedule('net-cleanup',     '40 4 * * *', $$delete from net._http_response where created < now() - interval '2 days'$$);
