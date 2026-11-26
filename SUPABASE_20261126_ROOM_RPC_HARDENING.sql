-- FOREVER room RPC hardening — 2026-11-26
-- Keep RPC signatures stable for clients, but derive identity and authority
-- from auth.uid() and the server-owned public profile projection.

create unique index if not exists forever_rooms_unique_lower_name
  on public.forever_documents (lower(data ->> 'name'))
  where collection_name = 'rooms' and nullif(data ->> 'name', '') is not null;

create or replace function public.forever_create_room(
  p_room_id text,
  p_room_name text,
  p_password text,
  p_username text,
  p_features jsonb default '{}'::jsonb
)
returns text
language plpgsql security definer set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_room_name, ''));
  v_room_id text := btrim(coalesce(p_room_id, ''));
  v_username text;
  v_owned_count integer := 0;
begin
  if v_uid is null then raise exception 'Oda oluşturmak için giriş yapmalısın.'; end if;
  if v_name = '' or char_length(v_name) < 2 or char_length(v_name) > 40 then
    raise exception 'Oda adı 2-40 karakter olmalı.';
  end if;
  if v_name ~ E'[<>"''&]' or position(chr(96) in v_name) > 0 then
    raise exception 'Oda adında geçersiz karakter var.';
  end if;
  if coalesce(p_password, '') = '' or char_length(p_password) < 8 or char_length(p_password) > 128 then
    raise exception 'Oda şifresi en az 8, en fazla 128 karakter olmalı.';
  end if;
  if v_room_id = '' or char_length(v_room_id) > 80 then
    raise exception 'Oda kimliği geçersiz.';
  end if;

  -- Serialize room creation per account so the free-room quota cannot be raced.
  perform 1 from public.forever_documents
  where collection_name = 'users' and id = v_uid::text
  for update;
  if not found then raise exception 'Forever profili bulunamadı.'; end if;

  select pp.data ->> 'username' into v_username
  from public.public_profiles pp
  where pp.data ->> 'uid' = v_uid::text
  limit 1;
  if coalesce(v_username, '') = '' then raise exception 'Kullanıcı adı doğrulanamadı.'; end if;

  if not private.is_forever_plus() then
    select count(*) into v_owned_count
    from public.forever_documents
    where collection_name = 'rooms'
      and data ->> 'ownerId' = v_uid::text;
    if v_owned_count >= 3 then
      raise exception 'Ücretsiz hesap en fazla 3 oda oluşturabilir. Plus ile bu sınır kalkar.';
    end if;
  end if;

  if exists (
    select 1 from public.forever_documents
    where collection_name = 'rooms' and lower(data ->> 'name') = lower(v_name)
  ) then
    raise exception 'Bu isimde bir oda zaten var.';
  end if;

  insert into public.forever_documents(collection_name,id,owner_id,data)
  values (
    'rooms', v_room_id, v_uid,
    jsonb_build_object(
      'name', v_name,
      'ownerId', v_uid::text,
      'createdByUsername', left(v_username,40),
      'isPrivate', true,
      'messagesLocked', false,
      'mutedUserIds', '[]'::jsonb,
      'adminIds', '[]'::jsonb,
      'theme', 'Mor',
      'features', jsonb_build_object(
        'stickers', coalesce((p_features ->> 'stickers')::boolean, true),
        'youtube', coalesce((p_features ->> 'youtube')::boolean, false)
      ),
      'pinnedMessageId', null,
      'createdAt', jsonb_build_object('seconds', floor(extract(epoch from now()))::bigint)
    )
  );

  insert into private.forever_room_secrets(room_id,owner_id,password_hash)
  values (v_room_id, v_uid, extensions.crypt(p_password, extensions.gen_salt('bf',12)));

  insert into public.forever_documents(collection_name,id,owner_id,data)
  values (
    'room_members', v_uid::text || '_' || v_room_id, v_uid,
    jsonb_build_object(
      'roomId', v_room_id,
      'userId', v_uid::text,
      'username', left(v_username,40),
      'role', 'owner',
      'joinedAt', jsonb_build_object('seconds', floor(extract(epoch from now()))::bigint)
    )
  );

  return v_room_id;
end;
$function$;

create or replace function public.forever_invite_room_member(
  p_room_id text,
  p_target_user uuid,
  p_username text
)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_room jsonb;
  v_target_username text;
begin
  if v_uid is null then raise exception 'Oturum gerekli.'; end if;
  if p_target_user is null then raise exception 'Davet edilecek kullanıcı seçilmedi.'; end if;

  select data into v_room
  from public.forever_documents
  where collection_name = 'rooms' and id = p_room_id;
  if v_room is null then raise exception 'Oda bulunamadı.'; end if;

  if (v_room ->> 'ownerId') is distinct from v_uid::text
     and not (coalesce(v_room -> 'adminIds','[]'::jsonb) ? v_uid::text)
     and not private.is_forever_admin() then
    raise exception 'Yalnızca oda yöneticisi davet gönderebilir.';
  end if;

  if not exists (select 1 from auth.users where id = p_target_user) then
    raise exception 'Kullanıcı bulunamadı.';
  end if;

  select pp.data ->> 'username' into v_target_username
  from public.public_profiles pp
  where pp.data ->> 'uid' = p_target_user::text
  limit 1;
  if coalesce(v_target_username, '') = '' then
    raise exception 'Davet edilecek kullanıcının Forever profili bulunamadı.';
  end if;

  insert into public.forever_documents(collection_name,id,owner_id,data)
  values (
    'room_members', p_target_user::text || '_' || p_room_id, v_uid,
    jsonb_build_object(
      'roomId',p_room_id,
      'userId',p_target_user::text,
      'username',left(v_target_username,40),
      'role','member',
      'invitedBy',v_uid::text,
      'joinedAt',jsonb_build_object('seconds',floor(extract(epoch from now()))::bigint)
    )
  )
  on conflict(collection_name,id) do nothing;

  return true;
end;
$function$;

create or replace function public.forever_join_room(
  p_room_name text,
  p_password text,
  p_username text
)
returns text
language plpgsql security definer set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_room_id text;
  v_hash text;
  v_username text;
begin
  if v_uid is null then raise exception 'Odaya katılmak için giriş yapmalısın.'; end if;
  if btrim(coalesce(p_room_name,'')) = '' or coalesce(p_password,'') = '' then
    raise exception 'Oda adı ve şifre zorunludur.';
  end if;
  if char_length(p_room_name) > 40 or char_length(p_password) > 128 then
    raise exception 'Oda adı veya şifre çok uzun.';
  end if;

  select pp.data ->> 'username' into v_username
  from public.public_profiles pp
  where pp.data ->> 'uid' = v_uid::text
  limit 1;
  if coalesce(v_username, '') = '' then raise exception 'Kullanıcı adı doğrulanamadı.'; end if;

  select r.id,s.password_hash into v_room_id,v_hash
  from public.forever_documents r
  join private.forever_room_secrets s on s.room_id = r.id
  where r.collection_name = 'rooms'
    and lower(r.data ->> 'name') = lower(btrim(p_room_name))
  limit 1;

  if v_room_id is null or v_hash is null
     or extensions.crypt(p_password,v_hash) <> v_hash then
    raise exception 'Oda adı veya şifre hatalı.';
  end if;

  if exists (
    select 1 from public.forever_documents
    where collection_name = 'room_bans'
      and data ->> 'roomId' = v_room_id
      and data ->> 'userId' = v_uid::text
  ) then
    raise exception 'Bu odaya katılman engellenmiş.';
  end if;

  insert into public.forever_documents(collection_name,id,owner_id,data)
  values (
    'room_members', v_uid::text || '_' || v_room_id, v_uid,
    jsonb_build_object(
      'roomId',v_room_id,'userId',v_uid::text,
      'username',left(v_username,40),'role','member',
      'joinedAt',jsonb_build_object('seconds',floor(extract(epoch from now()))::bigint)
    )
  )
  on conflict (collection_name,id) do update
    set data = excluded.data, owner_id = excluded.owner_id;

  return v_room_id;
end;
$function$;

create or replace function public.forever_moderate_room(
  p_room_id text,
  p_action text,
  p_message_id text default null,
  p_target_user uuid default null
)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_room jsonb;
  v_is_mod boolean;
  v_muted jsonb;
begin
  if v_uid is null then raise exception 'Oturum gerekli.'; end if;

  select data into v_room
  from public.forever_documents
  where collection_name = 'rooms' and id = p_room_id
  for update;
  if v_room is null then raise exception 'Oda bulunamadı.'; end if;

  v_is_mod :=
    coalesce(v_room ->> 'ownerId' = v_uid::text, false)
    or coalesce((coalesce(v_room -> 'adminIds','[]'::jsonb) ? v_uid::text), false)
    or private.is_forever_admin();

  if not v_is_mod then
    raise exception 'Bu işlem için oda yöneticisi olmalısın.';
  end if;

  if p_action in ('mute','unmute') then
    if p_target_user is null then raise exception 'Kullanıcı bulunamadı.'; end if;
    if p_target_user::text = (v_room ->> 'ownerId') then
      raise exception 'Oda sahibi susturulamaz.';
    end if;
    if not exists (
      select 1 from public.forever_documents
      where collection_name = 'room_members'
        and data ->> 'roomId' = p_room_id
        and data ->> 'userId' = p_target_user::text
    ) then raise exception 'Kullanıcı bu odanın üyesi değil.'; end if;

    v_muted := coalesce(v_room -> 'mutedUserIds','[]'::jsonb);
    if p_action = 'mute' then
      v_muted := (v_muted - p_target_user::text) || jsonb_build_array(p_target_user::text);
    else
      v_muted := v_muted - p_target_user::text;
    end if;
    update public.forever_documents
      set data = jsonb_set(v_room,'{mutedUserIds}',v_muted,true), updated_at = now()
      where collection_name = 'rooms' and id = p_room_id;
    return true;

  elsif p_action in ('pin','unpin') then
    if p_action = 'pin' then
      if p_message_id is null or not exists (
        select 1 from public.forever_documents
        where collection_name = 'room_messages'
          and id = p_message_id and data ->> 'roomId' = p_room_id
      ) then raise exception 'Mesaj bulunamadı.'; end if;
      v_room := jsonb_set(v_room,'{pinnedMessageId}',to_jsonb(p_message_id),true);
    else
      v_room := jsonb_set(v_room,'{pinnedMessageId}','null'::jsonb,true);
    end if;
    update public.forever_documents set data = v_room, updated_at = now()
    where collection_name = 'rooms' and id = p_room_id;
    return true;

  elsif p_action = 'delete_message' then
    if p_message_id is null then raise exception 'Mesaj seçilmedi.'; end if;
    delete from public.forever_documents
    where collection_name = 'room_messages'
      and id = p_message_id and data ->> 'roomId' = p_room_id;
    return found;

  elsif p_action = 'delete_room' then
    -- Co-admins may moderate messages, but only the owner or system admin
    -- may destroy the room itself.
    if (v_room ->> 'ownerId') is distinct from v_uid::text
       and not private.is_forever_admin() then
      raise exception 'Odayı yalnızca sahibi silebilir.';
    end if;
    delete from public.forever_documents
    where collection_name in ('room_messages','room_reactions','room_members','room_bans')
      and data ->> 'roomId' = p_room_id;
    delete from private.forever_room_secrets where room_id = p_room_id;
    delete from public.forever_documents
    where collection_name = 'rooms' and id = p_room_id;
    return true;

  else
    raise exception 'Desteklenmeyen yönetim işlemi.';
  end if;
end;
$function$;

create or replace function public.forever_set_room_admin(
  p_room_id text,
  p_target_user uuid,
  p_make_admin boolean
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_room jsonb;
  v_admins jsonb;
begin
  if v_uid is null then raise exception 'Oturum gerekli.'; end if;
  if p_target_user is null then raise exception 'Kullanıcı seçilmedi.'; end if;

  select data into v_room from public.forever_documents
  where collection_name = 'rooms' and id = p_room_id for update;
  if v_room is null then raise exception 'Oda bulunamadı.'; end if;

  if (v_room ->> 'ownerId') is distinct from v_uid::text
     and not private.is_forever_admin() then
    raise exception 'Oda yöneticisi yetkisini yalnızca oda sahibi verebilir.';
  end if;
  if p_target_user::text = (v_room ->> 'ownerId') then
    raise exception 'Oda sahibi rolü değiştirilemez.';
  end if;
  if not exists (
    select 1 from public.forever_documents
    where collection_name = 'room_members'
      and data ->> 'roomId' = p_room_id
      and data ->> 'userId' = p_target_user::text
  ) then raise exception 'Kullanıcı bu odanın üyesi değil.'; end if;

  v_admins := coalesce(v_room -> 'adminIds','[]'::jsonb);
  if p_make_admin then
    v_admins := (v_admins - p_target_user::text) || jsonb_build_array(p_target_user::text);
  else
    v_admins := v_admins - p_target_user::text;
  end if;
  v_room := jsonb_set(v_room,'{adminIds}',v_admins,true);
  update public.forever_documents set data = v_room, updated_at = now()
  where collection_name = 'rooms' and id = p_room_id;
  return v_room;
end;
$function$;

create or replace function public.forever_update_room_settings(
  p_room_id text,
  p_is_private boolean default null,
  p_messages_locked boolean default null,
  p_theme text default null
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_data jsonb;
  v_owner text;
begin
  if v_uid is null then raise exception 'Oturum gerekli.'; end if;
  select data into v_data from public.forever_documents
  where collection_name = 'rooms' and id = p_room_id for update;
  if v_data is null then raise exception 'Oda bulunamadı.'; end if;

  v_owner := v_data ->> 'ownerId';
  if v_owner is distinct from v_uid::text and not private.is_forever_admin() then
    raise exception 'Bu ayarı yalnızca oda sahibi değiştirebilir.';
  end if;

  if p_is_private is not null then
    v_data := jsonb_set(v_data,'{isPrivate}',to_jsonb(p_is_private),true);
  end if;
  if p_messages_locked is not null then
    v_data := jsonb_set(v_data,'{messagesLocked}',to_jsonb(p_messages_locked),true);
  end if;
  if p_theme is not null then
    if p_theme not in (
      'Mars','Derin Uzay','Kutup Işıkları','Okyanus','Gün Batımı','Sakura',
      'Zümrüt','Cyber Neon','Şeker Bulutu','Volkan','Bulutların Üstü',
      'Gece Mavisi','Prizma','Mor'
    ) then raise exception 'Geçersiz oda teması.'; end if;
    v_data := jsonb_set(v_data,'{theme}',to_jsonb(p_theme),true);
  end if;

  update public.forever_documents set data = v_data, updated_at = now()
  where collection_name = 'rooms' and id = p_room_id;
  return v_data;
end;
$function$;

create or replace function public.forever_delete_room(p_room_id text)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_room jsonb;
begin
  if v_uid is null then raise exception 'Oturum gerekli.'; end if;

  select data into v_room from public.forever_documents
  where collection_name = 'rooms' and id = p_room_id for update;
  if v_room is null then return false; end if;

  if (v_room ->> 'ownerId') is distinct from v_uid::text
     and not private.is_forever_admin() then
    raise exception 'Odayı yalnızca sahibi silebilir.';
  end if;

  delete from private.forever_room_secrets where room_id = p_room_id;
  delete from public.forever_documents
  where collection_name in ('room_members','room_messages','room_bans','room_reactions')
    and data ->> 'roomId' = p_room_id;
  delete from public.forever_documents
  where collection_name = 'rooms' and id = p_room_id;

  return true;
end;
$function$;

revoke all on function public.forever_create_room(text,text,text,text,jsonb) from public, anon;
grant execute on function public.forever_create_room(text,text,text,text,jsonb) to authenticated;
revoke all on function public.forever_invite_room_member(text,uuid,text) from public, anon;
grant execute on function public.forever_invite_room_member(text,uuid,text) to authenticated;
revoke all on function public.forever_join_room(text,text,text) from public, anon;
grant execute on function public.forever_join_room(text,text,text) to authenticated;
revoke all on function public.forever_moderate_room(text,text,text,uuid) from public, anon;
grant execute on function public.forever_moderate_room(text,text,text,uuid) to authenticated;
revoke all on function public.forever_set_room_admin(text,uuid,boolean) from public, anon;
grant execute on function public.forever_set_room_admin(text,uuid,boolean) to authenticated;
revoke all on function public.forever_update_room_settings(text,boolean,boolean,text) from public, anon;
grant execute on function public.forever_update_room_settings(text,boolean,boolean,text) to authenticated;
revoke all on function public.forever_delete_room(text) from public, anon;
grant execute on function public.forever_delete_room(text) to authenticated;
