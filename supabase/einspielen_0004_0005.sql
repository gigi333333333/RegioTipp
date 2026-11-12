-- Sammeldatei: 0004 und 0005 in der richtigen Reihenfolge (einmal komplett ausführen)

-- Tipprunden (Gruppen) werden an eine Mannschaft gebunden. Getippt werden die Spiele ihrer
-- Tabellengruppe(n) während der ganzen Saison. Bei Junioren wechselt die Tabellengruppe im
-- Frühling; die Tipprunde folgt automatisch, weil sie an der Mannschaft hängt.

alter table public.groups add column if not exists team_id bigint references public.teams(id);
create index if not exists groups_team_id_idx on public.groups (team_id);

-- Anzeigename wie im Vereinsalltag: Junioren "FC Witikon a" in der B-Kategorie => "FC Witikon Ba"
create or replace function public.team_label(p_name text, p_category text)
returns text language sql immutable as $$
  select case
    when p_category like 'Junioren _' and p_name ~ ' [a-z]\*?$'
      then regexp_replace(p_name, ' ([a-z])(\*?)$', ' ' || right(p_category, 1) || '\1\2')
    when p_category like 'Junioren _'
      then p_name || ' (' || right(p_category, 1) || ')'
    when p_category = 'Frauen' and p_name !~* 'frauen|damen|women'
      then p_name || ' (Frauen)'
    else p_name
  end;
$$;

-- Aktuelle Tabellengruppe einer Mannschaft (aktiv, zuletzt aktualisiert)
create or replace view public.team_current_league with (security_invoker = true) as
select distinct on (ls.team_id)
       ls.team_id, l.id as league_id, l.name as league_name, sl.slug as source_slug,
       sl.name as source_name, sl.category, ls.rank, ls.played, ls.points,
       public.team_label(t.name, sl.category) as label
  from public.league_standings ls
  join public.leagues l on l.id = ls.league_id and l.active
  join public.source_leagues sl on sl.slug = l.source_slug
  join public.teams t on t.id = ls.team_id
 order by ls.team_id, l.updated_at desc;

-- Suche nach Verein/Mannschaft, z.B. "witikon ba", "Witikon 1", "wädenswil frauen"
create or replace function public.search_teams(p_query text)
returns table (team_id bigint, label text, league_id bigint, league_name text, source_name text,
               category text, rank integer, played integer, points integer)
language sql stable security definer set search_path = public as $$
  with words as (
    select w from regexp_split_to_table(lower(trim(coalesce(p_query, ''))), '\s+') w where w <> ''
  )
  select c.team_id, c.label, c.league_id, c.league_name, c.source_name, c.category, c.rank, c.played, c.points
    from public.team_current_league c
   where (select count(*) from words) > 0
     and not exists (
       select 1 from words
        where position(w in lower(c.label || ' ' || c.source_name || ' ' || c.category)) = 0
     )
   order by
     -- Treffer, bei denen ein Suchwort genau ein Wort im Namen ist (z.B. "ba"), zuerst
     cardinality(array(select unnest(string_to_array(lower(c.label), ' '))
                       intersect select w from words)) desc,
     c.category, c.label
   limit 30;
$$;

-- Ligen, die zu einer Tipprunde gehören: alle Tabellengruppen dieser Saison, in denen die Mannschaft spielt
create or replace function public.group_league_ids(p_group_id uuid)
returns bigint[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct ls.league_id), '{}')
    from public.groups g
    join public.league_standings ls on ls.team_id = g.team_id
    join public.leagues l on l.id = ls.league_id
   where g.id = p_group_id
     and l.season is not distinct from (select l2.season from public.leagues l2 where l2.active order by l2.updated_at desc limit 1);
$$;

-- Spiele, die in einer Tipprunde zählen: Spiele der Tabellengruppe(n) + Cupspiele der Mannschaft
create or replace function public.match_in_group(p_match public.matches, p_team_id bigint, p_league_ids bigint[])
returns boolean language sql stable as $$
  select p_team_id is null
      or p_match.league_id = any (p_league_ids)
      or (p_match.league_id is null and p_team_id in (p_match.home_team_id, p_match.away_team_id));
$$;

-- Meine Tipprunden inkl. Mannschaft, Tabellengruppe und Mitgliederzahl
create or replace function public.my_groups()
returns table (id uuid, name text, invite_code text, owner_id uuid, team_id bigint, team_label text,
               league_id bigint, league_name text, source_name text, league_ids bigint[], members bigint)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.invite_code, g.owner_id, g.team_id, c.label, c.league_id, c.league_name, c.source_name,
         public.group_league_ids(g.id),
         (select count(*) from public.group_members m where m.group_id = g.id)
    from public.groups g
    join public.group_members gm on gm.group_id = g.id and gm.user_id = auth.uid()
    left join public.team_current_league c on c.team_id = g.team_id
   order by gm.joined_at;
$$;

-- Vorschau einer Tipprunde über den Einladungscode (auch ohne Login, für den Einladungslink)
create or replace function public.group_preview(p_code text)
returns table (name text, team_label text, league_name text, source_name text, members bigint)
language sql stable security definer set search_path = public as $$
  select g.name, c.label, c.league_name, c.source_name,
         (select count(*) from public.group_members m where m.group_id = g.id)
    from public.groups g
    left join public.team_current_league c on c.team_id = g.team_id
   where g.invite_code = upper(trim(p_code));
$$;

-- Tipprunde erstellen (mit Mannschaft)
create or replace function public.create_group(p_name text, p_team_id bigint)
returns public.groups language plpgsql security definer set search_path = public as $$
declare
  g      public.groups;
  v_code text;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if p_team_id is not null and not exists (select 1 from public.teams where id = p_team_id) then
    raise exception 'Mannschaft nicht gefunden';
  end if;
  loop
    v_code := upper(substr(encode(extensions.gen_random_bytes(6), 'base64'), 1, 6));
    v_code := translate(v_code, '+/0O1I', 'XYZQRS');
    exit when not exists (select 1 from public.groups where invite_code = v_code);
  end loop;
  insert into public.groups (name, invite_code, owner_id, team_id)
  values (trim(p_name), v_code, auth.uid(), p_team_id) returning * into g;
  insert into public.group_members (group_id, user_id) values (g.id, auth.uid());
  return g;
end $$;

-- Gruppen-Vergleich: Durchschnitt der Punkte in der eigenen Tipprunde
create or replace function public.group_ranking()
returns table (rank bigint, group_id uuid, name text, members bigint, avg_points numeric, is_member boolean)
language sql stable security definer set search_path = public as $$
  with grp as (
    select g.id, g.name, g.team_id, public.group_league_ids(g.id) league_ids from public.groups g
  ), pts as (
    select grp.id group_id, gm.user_id,
           coalesce((select sum(t.points) from public.tips t
                       join public.matches mt on mt.id = t.match_id and mt.status = 'finished'
                      where t.user_id = gm.user_id
                        and public.match_in_group(mt, grp.team_id, grp.league_ids)), 0) points
      from grp join public.group_members gm on gm.group_id = grp.id
  )
  select rank() over (order by avg(p.points) desc), grp.id, grp.name, count(*), round(avg(p.points), 1),
         public.is_group_member(grp.id)
    from grp join pts p on p.group_id = grp.id
   group by grp.id, grp.name
   order by 1, grp.name;
$$;

-- Rechte
revoke execute on function public.team_label(text, text), public.search_teams(text),
  public.group_league_ids(uuid), public.match_in_group(public.matches, bigint, bigint[]),
  public.my_groups(), public.group_preview(text), public.create_group(text, bigint), public.group_ranking()
  from public, anon;
grant execute on function public.team_label(text, text), public.search_teams(text),
  public.group_preview(text), public.match_in_group(public.matches, bigint, bigint[])
  to anon, authenticated;
grant execute on function public.group_league_ids(uuid), public.my_groups(),
  public.create_group(text, bigint), public.group_ranking()
  to authenticated;


-- Profilbilder (Standard: Vereinswappen) und Wochen-/Gesamtrangliste

-- ---------------------------------------------------------------------------
-- Spalten
-- ---------------------------------------------------------------------------
alter table public.teams    add column if not exists logo_url text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists team_id bigint references public.teams(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Wappen beim Liga-Import speichern (die Edge Function ruft das nach fs_sync_league auf)
-- ---------------------------------------------------------------------------
create or replace function public.fs_set_team_logos(p_logos jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.teams t
     set logo_url = x->>'logo'
    from jsonb_array_elements(p_logos) x
   where t.fs_team_id = x->>'fs_team_id'
     and nullif(x->>'logo', '') is not null
     and x->>'logo' ~ '^https://[a-z0-9.-]+\.amazonaws\.com/'
     and t.logo_url is distinct from x->>'logo';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.fs_set_team_logos(jsonb) from public, anon, authenticated;
grant execute on function public.fs_set_team_logos(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Verein des Profils: wird beim ersten Beitritt zu einer Tipprunde gesetzt
-- ---------------------------------------------------------------------------
create or replace function private.set_profile_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles p
     set team_id = g.team_id
    from public.groups g
   where g.id = new.group_id and g.team_id is not null
     and p.id = new.user_id and p.team_id is null;
  return null;
end $$;
revoke execute on function private.set_profile_team() from public, anon, authenticated;

create trigger group_members_profile_team after insert on public.group_members
  for each row execute function private.set_profile_team();

create or replace function public.set_my_team(p_team_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if p_team_id is not null and not exists (select 1 from public.teams where id = p_team_id) then
    raise exception 'Mannschaft nicht gefunden';
  end if;
  update public.profiles set team_id = p_team_id where id = auth.uid();
end $$;

-- Eigenes Profilbild setzen (nur Bilder aus dem eigenen Ordner im Speicher "avatars") oder entfernen (null)
create or replace function public.set_avatar(p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if p_url is not null and p_url not like
     'https://saguzhqngpyafvwetsnw.supabase.co/storage/v1/object/public/avatars/' || auth.uid()::text || '/%' then
    raise exception 'Ungültige Bildadresse';
  end if;
  update public.profiles set avatar_url = p_url where id = auth.uid();
end $$;

-- Profilbild zum Anzeigen: eigenes Foto, sonst Vereinswappen
create or replace view public.profile_cards with (security_invoker = true) as
select p.id, p.username, p.is_admin, p.team_id, p.avatar_url,
       coalesce(c.label, t.name) as team_name, t.logo_url as team_logo,
       coalesce(p.avatar_url, t.logo_url) as picture
  from public.profiles p
  left join public.teams t on t.id = p.team_id
  left join public.team_current_league c on c.team_id = p.team_id;

-- ---------------------------------------------------------------------------
-- Rangliste mit Zeitraum: 'all' (Gesamt) oder 'week' (aktuelle Woche, Mo–So, Schweizer Zeit)
-- ---------------------------------------------------------------------------
create or replace function public.leaderboard(p_group_id uuid, p_period text)
returns table (rank bigint, user_id uuid, username text, picture text, team_name text, points bigint,
               tips_count bigint, exact_count bigint, tendency_count bigint)
language sql stable security definer set search_path = public as $$
  with params as (
    select case when p_period = 'week'
                then date_trunc('week', now() at time zone 'Europe/Zurich') at time zone 'Europe/Zurich'
           end as since
  ), grp as (
    select g.team_id, public.group_league_ids(g.id) league_ids
      from public.groups g where g.id = p_group_id
  ), members as (
    select p.id, p.username, coalesce(p.avatar_url, t.logo_url) picture, coalesce(c.label, t.name) team_name
      from public.profiles p
      left join public.teams t on t.id = p.team_id
      left join public.team_current_league c on c.team_id = p.team_id
     where p_group_id is null
        or (public.is_group_member(p_group_id)
            and exists (select 1 from public.group_members gm
                         where gm.group_id = p_group_id and gm.user_id = p.id))
  ), scored as (
    select t.user_id, t.points, mt.home_goals, mt.away_goals, t.home_goals th, t.away_goals ta
      from public.tips t
      join public.matches mt on mt.id = t.match_id and mt.status = 'finished'
     cross join params
     where (params.since is null or mt.kickoff >= params.since)
       and (p_group_id is null
            or exists (select 1 from grp where public.match_in_group(mt, grp.team_id, grp.league_ids)))
  ), stats as (
    select m.id, m.username, m.picture, m.team_name,
           coalesce(sum(s.points), 0) points,
           count(s.user_id) tips_count,
           count(s.user_id) filter (where s.home_goals = s.th and s.away_goals = s.ta) exact_count,
           count(s.user_id) filter (where sign(s.home_goals - s.away_goals) = sign(s.th - s.ta)) tendency_count
      from members m left join scored s on s.user_id = m.id
     group by m.id, m.username, m.picture, m.team_name
  )
  select rank() over (order by points desc, exact_count desc), id, username, picture, team_name, points,
         tips_count, exact_count, tendency_count
    from stats
   order by 1, username;
$$;

revoke execute on function public.leaderboard(uuid, text), public.set_my_team(bigint), public.set_avatar(text)
  from public, anon;
grant execute on function public.leaderboard(uuid, text), public.set_my_team(bigint), public.set_avatar(text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Speicher für Profilbilder: öffentlich lesbar, jede Person schreibt nur in ihren Ordner
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 1048576,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];


create policy "Avatar hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Avatar ändern" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Avatar entfernen" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
-- (Überschreiben mit upsert braucht auch Leserechte auf die eigenen Dateien)
create policy "Avatar lesen" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
