-- Eigenes Konto löschen (Recht auf Löschung nach DSG).
-- Tipprunden, die man besitzt, gehen an das älteste andere Mitglied; leere Tipprunden werden entfernt.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  g     record;
  v_new uuid;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  for g in select id from public.groups where owner_id = v_uid loop
    select user_id into v_new from public.group_members
     where group_id = g.id and user_id <> v_uid order by joined_at limit 1;
    if v_new is null then
      delete from public.groups where id = g.id;
    else
      update public.groups set owner_id = v_new where id = g.id;
    end if;
  end loop;
  delete from auth.users where id = v_uid;
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
