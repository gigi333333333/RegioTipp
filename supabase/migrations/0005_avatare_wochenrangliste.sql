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
