-- Allow only trusted SECURITY DEFINER follow RPCs to update relationship arrays.
-- Direct authenticated table updates still cannot modify followers/following.

create or replace function private.guard_forever_document_update()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_key text;
  v_uid text := (select auth.uid())::text;
  v_protected_fields text[] := array[
    'uid','username','authUid','email','birthDate','createdAt',
    'suspended','restricted','role','admin','isAdmin','verified','isVerified',
    'plus','isPlus','isLider','votes','followers','following','banned','banUntil',
    'ip','ipAddress','ipHash','deviceHash'
  ];
begin
  if (select private.is_forever_admin()) then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.collection_name is distinct from old.collection_name
     or new.owner_id is distinct from old.owner_id then
    raise exception 'Belge kimliği veya sahibi istemci tarafından değiştirilemez.';
  end if;

  if old.collection_name = 'users' then
    foreach v_key in array v_protected_fields loop
      -- This exception is limited to PostgreSQL-owned SECURITY DEFINER calls.
      -- The public follow RPC is SECURITY DEFINER and independently derives
      -- both user IDs from auth.uid(); direct REST updates run as authenticated.
      if current_user = 'postgres' and v_key in ('followers','following') then
        continue;
      end if;
      if (old.data -> v_key) is distinct from (new.data -> v_key) then
        raise exception 'Bu profil alanı yalnızca güvenli sunucu işlemiyle değiştirilebilir: %', v_key;
      end if;
    end loop;
  elsif old.collection_name = 'notifications'
        and old.data ->> 'toUid' = v_uid then
    if (new.data - 'read') is distinct from (old.data - 'read') then
      raise exception 'Bildirim alıcısı yalnızca okundu bilgisini değiştirebilir.';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function private.guard_forever_document_update() from public, anon, authenticated;
