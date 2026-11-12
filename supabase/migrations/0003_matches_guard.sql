-- Resultate für Spiele, die noch nicht angepfiffen wurden, ignorieren.
-- footstats.ch zeigt bei manchen künftigen Spielen "0 0" als Platzhalter.

create or replace function private.matches_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'finished' and new.kickoff > now() and new.source <> 'admin' then
    new.status := 'scheduled';
    new.home_goals := null;
    new.away_goals := null;
  end if;
  return new;
end $$;
revoke execute on function private.matches_guard() from public, anon, authenticated;

create trigger matches_guard before insert or update on public.matches
  for each row execute function private.matches_guard();

-- bestehende falsche Einträge korrigieren
update public.matches set status = status where status = 'finished' and kickoff > now();
