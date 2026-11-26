-- Forever security hardening — 2026-11-26
-- Target: FOREVER project gfuewsdkytfssumxwyxz
-- No service_role or server secret is exposed to the browser.

create table if not exists public.public_profiles (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create unique index if not exists public_profiles_uid_unique
  on public.public_profiles ((data ->> 'uid'));
create unique index if not exists public_profiles_username_lower_unique
  on public.public_profiles (lower(id));

alter table public.public_profiles enable row level security;
revoke all on table public.public_profiles from public, anon, authenticated;
grant select on table public.public_profiles to authenticated;
drop policy if exists public_profiles_authenticated_read on public.public_profiles;
create policy public_profiles_authenticated_read
  on public.public_profiles for select to authenticated using (true);

create or replace function private.forever_current_username()
returns text
language sql stable security definer
set search_path to ''
as $function$
  select nullif(d.data ->> 'username', '')
  from public.forever_documents d
  where d.collection_name = 'users'
    and d.id = (select auth.uid())::text
  limit 1;
$function$;

revoke all on function private.forever_current_username() from public, anon;
grant execute on function private.forever_current_username() to authenticated;

create or replace function private.guard_forever_document_update()
returns trigger
language plpgsql security definer
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

drop trigger if exists forever_document_update_guard on public.forever_documents;
create trigger forever_document_update_guard
before update on public.forever_documents
for each row execute function private.guard_forever_document_update();

create or replace function private.sync_forever_public_profile()
returns trigger language plpgsql security definer set search_path to ''
as $function$
declare
  v_username text;
  v_profile jsonb;
begin
  if tg_op = 'DELETE' then
    if old.collection_name = 'users' then
      delete from public.public_profiles where data ->> 'uid' = old.id;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.collection_name = 'users' and new.collection_name <> 'users' then
    delete from public.public_profiles where data ->> 'uid' = old.id;
  end if;

  if new.collection_name <> 'users' then
    return new;
  end if;

  v_username := nullif(btrim(new.data ->> 'username'), '');
  if v_username is null then
    delete from public.public_profiles where data ->> 'uid' = new.id;
    return new;
  end if;

  if exists (
    select 1 from public.public_profiles p
    where lower(p.id) = lower(v_username) and p.data ->> 'uid' <> new.id
  ) then
    raise exception 'Bu kullanıcı adı başka bir hesaba ait.' using errcode = '23505';
  end if;

  -- Explicit allow-list. savedPosts, e-mail, birth date, IP address,
  -- private user data and moderation notes are never copied here.
  v_profile := jsonb_strip_nulls(jsonb_build_object(
    'uid', coalesce(new.data -> 'uid', to_jsonb(new.id)),
    'username', to_jsonb(v_username),
    'displayName', new.data -> 'displayName',
    'avatarUrl', new.data -> 'avatarUrl',
    'avatarPath', new.data -> 'avatarPath',
    'bio', new.data -> 'bio',
    'region', new.data -> 'region',
    'followers', case when jsonb_typeof(new.data -> 'followers') = 'array'
      then new.data -> 'followers' else '[]'::jsonb end,
    'following', case when jsonb_typeof(new.data -> 'following') = 'array'
      then new.data -> 'following' else '[]'::jsonb end,
    'votes', new.data -> 'votes',
    'isLider', new.data -> 'isLider',
    'appIconPreset', new.data -> 'appIconPreset',
    'privacyMode', new.data -> 'privacyMode'
  ));

  insert into public.public_profiles(id, data, updated_at)
  values (v_username, v_profile, now())
  on conflict (id) do update
    set data = excluded.data, updated_at = now()
    where public.public_profiles.data ->> 'uid' = excluded.data ->> 'uid';

  if not found then
    raise exception 'Bu kullanıcı adı başka bir hesaba ait.' using errcode = '23505';
  end if;

  delete from public.public_profiles
  where data ->> 'uid' = new.id and id <> v_username;

  return new;
end;
$function$;

revoke all on function private.sync_forever_public_profile() from public, anon, authenticated;

drop trigger if exists forever_public_profile_sync on public.forever_documents;
create trigger forever_public_profile_sync
after insert or update or delete on public.forever_documents
for each row execute function private.sync_forever_public_profile();

do $function$
begin
  if exists (
    select 1 from public.forever_documents
    where collection_name = 'users'
      and nullif(btrim(data ->> 'username'), '') is not null
    group by lower(btrim(data ->> 'username'))
    having count(*) > 1
  ) then
    raise exception 'Aynı kullanıcı adına sahip birden fazla profil var; güvenli profil görünümü oluşturulmadı.';
  end if;
end;
$function$;

insert into public.public_profiles(id, data, updated_at)
select
  btrim(d.data ->> 'username'),
  jsonb_strip_nulls(jsonb_build_object(
    'uid', coalesce(d.data -> 'uid', to_jsonb(d.id)),
    'username', to_jsonb(btrim(d.data ->> 'username')),
    'displayName', d.data -> 'displayName',
    'avatarUrl', d.data -> 'avatarUrl',
    'avatarPath', d.data -> 'avatarPath',
    'bio', d.data -> 'bio',
    'region', d.data -> 'region',
    'followers', case when jsonb_typeof(d.data -> 'followers') = 'array'
      then d.data -> 'followers' else '[]'::jsonb end,
    'following', case when jsonb_typeof(d.data -> 'following') = 'array'
      then d.data -> 'following' else '[]'::jsonb end,
    'votes', d.data -> 'votes',
    'isLider', d.data -> 'isLider',
    'appIconPreset', d.data -> 'appIconPreset',
    'privacyMode', d.data -> 'privacyMode'
  )),
  coalesce(d.updated_at, now())
from public.forever_documents d
where d.collection_name = 'users'
  and nullif(btrim(d.data ->> 'username'), '') is not null
on conflict (id) do update
set data = excluded.data, updated_at = excluded.updated_at
where public.public_profiles.data ->> 'uid' = excluded.data ->> 'uid';

do $function$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'
         and tablename = 'public_profiles'
     ) then
    alter publication supabase_realtime add table public.public_profiles;
  end if;
end;
$function$;

-- Only the owner/admin may read a full users document.
-- Everyone else reads a narrow, explicitly allow-listed public profile row.
drop policy if exists forever_documents_select on public.forever_documents;
create policy forever_documents_select on public.forever_documents
for select to authenticated
using (
  (select private.is_forever_admin())
  or owner_id = (select auth.uid())
  or collection_name = any (array['usernames','posts','rooms','stickers']::text[])
  or (collection_name = 'stories' and private.can_view_forever_story(data ->> 'userId'))
  or (collection_name = 'notifications' and data ->> 'toUid' = (select auth.uid())::text)
  or (collection_name = 'reports' and data ->> 'reporterId' = (select auth.uid())::text)
  or (collection_name = 'room_members' and private.is_forever_room_member(data ->> 'roomId'))
  or (collection_name = 'room_messages' and private.is_forever_room_member(data ->> 'roomId'))
  or (
    collection_name = 'blocks'
    and (
      data ->> 'blockerId' = (select auth.uid())::text
      or data ->> 'blockedId' = (select auth.uid())::text
    )
  )
  or (collection_name = 'room_bans' and (select private.is_forever_admin()))
);

-- Rooms and room memberships must be created only by validated RPCs.
-- Room messages require a matching sender and active room membership.
drop policy if exists forever_documents_insert on public.forever_documents;
create policy forever_documents_insert on public.forever_documents
for insert to authenticated
with check (
  (select private.is_forever_admin())
  or (
    owner_id = (select auth.uid())
    and collection_name = any (
      array['posts','stories','comments','notifications','reports','blocks','room_messages','stickers']::text[]
    )
    and (
      collection_name <> 'room_messages'
      or (
        data ->> 'userId' = (select auth.uid())::text
        and private.is_forever_room_member(data ->> 'roomId')
      )
    )
    and (
      collection_name <> 'reports'
      or data ->> 'reporterId' = (select auth.uid())::text
    )
    and (collection_name <> 'posts' or data ->> 'author' = private.forever_current_username())
    and (collection_name <> 'blocks' or data ->> 'blockerId' = (select auth.uid())::text)
  )
);

-- No generic client update for rooms, memberships or another user's profile.
-- Follow changes and room administration remain on validated RPCs.
drop policy if exists forever_documents_update on public.forever_documents;
create policy forever_documents_update on public.forever_documents
for update to authenticated
using (
  (select private.is_forever_admin())
  or (
    owner_id = (select auth.uid())
    and collection_name <> all (
      array['room_members','usernames','room_bans','modlogs','rooms']::text[]
    )
    and (
      collection_name <> 'users'
      or (
        id = (select auth.uid())::text
        and data ->> 'uid' = (select auth.uid())::text
      )
    )
    and (
      collection_name <> 'room_messages'
      or (
        data ->> 'userId' = (select auth.uid())::text
        and private.is_forever_room_member(data ->> 'roomId')
      )
    )
    and (collection_name <> 'posts' or data ->> 'author' = private.forever_current_username())
    and (collection_name <> 'blocks' or data ->> 'blockerId' = (select auth.uid())::text)
  )
  or (
    collection_name = 'notifications'
    and data ->> 'toUid' = (select auth.uid())::text
  )
  or (
    collection_name = 'room_messages'
    and private.is_forever_room_moderator(data ->> 'roomId')
  )
)
with check (
  (select private.is_forever_admin())
  or (
    owner_id = (select auth.uid())
    and collection_name <> all (
      array['room_members','usernames','room_bans','modlogs','rooms']::text[]
    )
    and (
      collection_name <> 'users'
      or (
        id = (select auth.uid())::text
        and data ->> 'uid' = (select auth.uid())::text
      )
    )
    and (
      collection_name <> 'room_messages'
      or (
        data ->> 'userId' = (select auth.uid())::text
        and private.is_forever_room_member(data ->> 'roomId')
      )
    )
    and (collection_name <> 'posts' or data ->> 'author' = private.forever_current_username())
    and (collection_name <> 'blocks' or data ->> 'blockerId' = (select auth.uid())::text)
  )
  or (
    collection_name = 'notifications'
    and data ->> 'toUid' = (select auth.uid())::text
  )
  or (
    collection_name = 'room_messages'
    and private.is_forever_room_moderator(data ->> 'roomId')
  )
);

-- Generic deletion cannot remove room membership or room records.
-- A dedicated owner/admin function performs room cleanup.
drop policy if exists forever_documents_delete on public.forever_documents;
create policy forever_documents_delete on public.forever_documents
for delete to authenticated
using (
  (select private.is_forever_admin())
  or (
    owner_id = (select auth.uid())
    and collection_name <> all (
      array['users','usernames','room_bans','modlogs','rooms','room_members']::text[]
    )
  )
);

create or replace function public.forever_delete_room(p_room_id text)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_room jsonb;
begin
  if v_uid is null then raise exception 'Oturum gerekli.'; end if;

  select data into v_room
  from public.forever_documents
  where collection_name = 'rooms' and id = p_room_id
  for update;

  if v_room is null then return false; end if;

  if (v_room ->> 'ownerId') <> v_uid::text
     and not private.is_forever_admin() then
    raise exception 'Odayı yalnızca sahibi silebilir.';
  end if;

  delete from private.forever_room_secrets where room_id = p_room_id;
  delete from public.forever_documents
  where collection_name in ('room_members','room_messages','room_bans')
    and data ->> 'roomId' = p_room_id;
  delete from public.forever_documents
  where collection_name = 'rooms' and id = p_room_id;

  return true;
end;
$function$;

revoke all on function public.forever_delete_room(text) from public, anon;
grant execute on function public.forever_delete_room(text) to authenticated;

-- Remove the room drawing feature only; unrelated client canvas tools remain.
update public.forever_documents
set data = (
  jsonb_set(coalesce(data, '{}'::jsonb), '{features}',
    coalesce(data -> 'features', '{}'::jsonb) - 'drawing', true)
  - 'drawingAccess' - 'drawing'
),
updated_at = now()
where collection_name = 'rooms';

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
  v_owned_count integer := 0;
begin
  if v_uid is null then raise exception 'Oda oluşturmak için giriş yapmalısın.'; end if;
  if v_name = '' or char_length(v_name) < 2 or char_length(v_name) > 40 then
    raise exception 'Oda adı 2-40 karakter olmalı.';
  end if;
  if v_name ~ E'[<>"''&]' or position(chr(96) in v_name) > 0 then
    raise exception 'Oda adında geçersiz karakter var.';
  end if;
  if coalesce(p_password, '') = '' or char_length(p_password) < 4 or char_length(p_password) > 128 then
    raise exception 'Oda şifresi 4-128 karakter olmalı.';
  end if;
  if v_room_id = '' or char_length(v_room_id) > 80 then
    raise exception 'Oda kimliği geçersiz.';
  end if;

  if not private.is_forever_plus() then
    select count(*) into v_owned_count
    from public.forever_documents
    where collection_name = 'rooms' and data ->> 'ownerId' = v_uid::text;
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
      'createdByUsername', left(coalesce(p_username,'Kullanıcı'),40),
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
      'username', left(coalesce(p_username,'Kullanıcı'),40),
      'role', 'owner',
      'joinedAt', jsonb_build_object('seconds', floor(extract(epoch from now()))::bigint)
    )
  );

  return v_room_id;
end;
$function$;

revoke all on function public.forever_create_room(text,text,text,text,jsonb) from public, anon;
grant execute on function public.forever_create_room(text,text,text,text,jsonb) to authenticated;
