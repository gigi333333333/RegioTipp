-- Umbau: vom Wettspiel (Tokens + Quoten) zum Resultat-Tippspiel nach SRF-Regeln.
--
-- Punkte pro Spiel (wie SRF-WM-Tippspiel, Gruppenphase):
--   5  richtige Tendenz (Sieger bzw. Unentschieden)
--   1  richtige Anzahl Heimtore
--   1  richtige Anzahl Gasttore
--   3  richtige Tordifferenz
--   => exaktes Resultat = 10 Punkte
-- Cupspiele zählen wie die K.-o.-Phase bei SRF doppelt (10/2/2/3*2 => max. 20).
-- Tippgruppen werden wie bei SRF nach dem Punkte-Durchschnitt ihrer Mitglieder verglichen.

-- ---------------------------------------------------------------------------
-- Alte Wett-Logik entfernen
-- ---------------------------------------------------------------------------

select cron.unschedule('weekly-bonus');

drop view if exists public.match_list;
drop function if exists public.place_bet(bigint, text, integer);
drop function if exists public.cancel_bet(bigint);
drop function if exists public.leaderboard(uuid);
drop function if exists public.match_odds(bigint);
drop function if exists public.grant_weekly_bonus();
drop function if exists public.admin_set_tokens(uuid, integer);
drop table if exists public.bets;

delete from public.app_settings
 where key in ('start_tokens', 'weekly_bonus', 'home_advantage', 'margin', 'min_odds', 'max_odds');
insert into public.app_settings (key, value) values
  ('points_tendency', '5'),
  ('points_home_goals', '1'),
  ('points_away_goals', '1'),
  ('points_goal_diff', '3'),
  ('cup_multiplier', '2')
on conflict (key) do update set value = excluded.value;

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
  insert into public.profiles (id, username, is_admin)
  values (new.id, v_try, not exists (select 1 from public.profiles));
  return new;
end $$;

alter table public.profiles drop column if exists tokens;
alter table public.profiles drop column if exists last_bonus_at;

-- ---------------------------------------------------------------------------
-- Tipps
-- ---------------------------------------------------------------------------

create table public.tips (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  match_id   bigint not null references public.matches(id) on delete cascade,
  home_goals integer not null check (home_goals between 0 and 30),
  away_goals integer not null check (away_goals between 0 and 30),
  points     integer,                 -- null = noch nicht ausgewertet
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, match_id)
);
create index on public.tips (match_id);

-- Punkte für einen Tipp
create or replace function public.tip_points(p_tip_home integer, p_tip_away integer,
                                             p_res_home integer, p_res_away integer, p_cup boolean)
returns integer language sql stable set search_path = public as $$
  select (
      case when sign(p_tip_home - p_tip_away) = sign(p_res_home - p_res_away)
           then public.setting_num('points_tendency', 5) else 0 end
    + case when p_tip_home = p_res_home then public.setting_num('points_home_goals', 1) else 0 end
    + case when p_tip_away = p_res_away then public.setting_num('points_away_goals', 1) else 0 end
    + case when p_tip_home - p_tip_away = p_res_home - p_res_away
           then public.setting_num('points_goal_diff', 3) else 0 end
  )::int * case when p_cup then public.setting_num('cup_multiplier', 2)::int else 1 end;
$$;

-- Tipp abgeben oder ändern (bis zum Anpfiff)
create or replace function public.save_tip(p_match_id bigint, p_home integer, p_away integer)
returns public.tips language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  t public.tips;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if p_home is null or p_away is null or p_home not between 0 and 30 or p_away not between 0 and 30 then
    raise exception 'Ungültiges Resultat';
  end if;
  select * into m from public.matches where id = p_match_id;
  if not found then raise exception 'Spiel nicht gefunden'; end if;
  if m.status <> 'scheduled' or m.kickoff <= now() then
    raise exception 'Das Spiel hat schon begonnen, Tippen ist nicht mehr möglich';
  end if;
  insert into public.tips (user_id, match_id, home_goals, away_goals)
  values (auth.uid(), p_match_id, p_home, p_away)
  on conflict (user_id, match_id) do update
     set home_goals = excluded.home_goals, away_goals = excluded.away_goals, updated_at = now()
  returning * into t;
  return t;
end $$;

create or replace function public.delete_tip(p_match_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.matches where id = p_match_id and (kickoff <= now() or status <> 'scheduled')) then
    raise exception 'Das Spiel hat schon begonnen, der Tipp bleibt bestehen';
  end if;
  delete from public.tips where match_id = p_match_id and user_id = auth.uid();
end $$;

-- ---------------------------------------------------------------------------
-- Auswertung: bei jeder Resultatänderung (auch Korrekturen) neu berechnen
-- ---------------------------------------------------------------------------

create or replace function private.settle_match(p_match_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match_id;
  if not found then return; end if;
  if m.status = 'finished' then
    update public.tips
       set points = public.tip_points(home_goals, away_goals, m.home_goals, m.away_goals, m.league_id is null)
     where match_id = p_match_id;
  else
    update public.tips set points = null where match_id = p_match_id and points is not null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Spiele-Ansicht fürs Frontend
-- ---------------------------------------------------------------------------

create view public.match_list with (security_invoker = true) as
select m.id, m.league_id, l.name as league_name, sl.slug as source_slug, sl.name as source_name,
       sl.category, (m.league_id is null) as is_cup, m.kickoff, m.status, m.home_goals, m.away_goals,
       m.home_team_id, th.name as home_name, m.away_team_id, ta.name as away_name
  from public.matches m
  join public.teams th on th.id = m.home_team_id
  join public.teams ta on ta.id = m.away_team_id
  left join public.leagues l on l.id = m.league_id
  left join public.source_leagues sl on sl.slug = l.source_slug;

-- ---------------------------------------------------------------------------
-- Ranglisten
-- ---------------------------------------------------------------------------

-- Spieler-Rangliste (gesamt oder innerhalb einer Gruppe, in der man Mitglied ist)
create or replace function public.leaderboard(p_group_id uuid default null)
returns table (rank bigint, user_id uuid, username text, points bigint, tips_count bigint,
               exact_count bigint, tendency_count bigint)
language sql stable security definer set search_path = public as $$
  with members as (
    select p.id, p.username from public.profiles p
     where p_group_id is null
        or (public.is_group_member(p_group_id)
            and exists (select 1 from public.group_members gm
                         where gm.group_id = p_group_id and gm.user_id = p.id))
  ), stats as (
    select m.id, m.username,
           coalesce(sum(t.points), 0) points,
           count(t.id) filter (where t.points is not null) tips_count,
           count(t.id) filter (where mt.home_goals = t.home_goals and mt.away_goals = t.away_goals) exact_count,
           count(t.id) filter (where mt.status = 'finished'
                                 and sign(mt.home_goals - mt.away_goals) = sign(t.home_goals - t.away_goals)) tendency_count
      from members m
      left join public.tips t on t.user_id = m.id
      left join public.matches mt on mt.id = t.match_id and mt.status = 'finished'
     group by m.id, m.username
  )
  select rank() over (order by points desc, exact_count desc), id, username, points, tips_count,
         exact_count, tendency_count
    from stats
   order by 1, username;
$$;

-- Gruppen-Rangliste: Durchschnitt der Punkte aller Mitglieder (wie bei SRF)
create or replace function public.group_ranking()
returns table (rank bigint, group_id uuid, name text, members bigint, avg_points numeric, is_member boolean)
language sql stable security definer set search_path = public as $$
  with pts as (
    select gm.group_id, gm.user_id, coalesce(sum(t.points), 0) points
      from public.group_members gm
      left join public.tips t on t.user_id = gm.user_id
     group by gm.group_id, gm.user_id
  )
  select rank() over (order by avg(p.points) desc), g.id, g.name, count(*), round(avg(p.points), 1),
         public.is_group_member(g.id)
    from public.groups g join pts p on p.group_id = g.id
   group by g.id, g.name
   order by 1, g.name;
$$;

-- ---------------------------------------------------------------------------
-- Rechte und RLS
-- ---------------------------------------------------------------------------

alter table public.tips enable row level security;

-- Eigene Tipps immer; Tipps der anderen erst ab Anpfiff (damit niemand abschreibt)
create policy "Tipps lesen" on public.tips
  for select to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.matches m where m.id = match_id and m.kickoff <= now())
  );

revoke execute on function public.tip_points(integer, integer, integer, integer, boolean),
  public.save_tip(bigint, integer, integer), public.delete_tip(bigint),
  public.leaderboard(uuid), public.group_ranking(), private.settle_match(bigint)
  from public, anon;
grant execute on function public.tip_points(integer, integer, integer, integer, boolean)
  to anon, authenticated;
grant execute on function public.save_tip(bigint, integer, integer), public.delete_tip(bigint),
  public.leaderboard(uuid), public.group_ranking()
  to authenticated;
revoke execute on function private.settle_match(bigint) from authenticated;
