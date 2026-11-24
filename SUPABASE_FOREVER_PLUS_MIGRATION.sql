-- ============================================================================
-- FOREVER PLUS — güvenli üyelik, Plus yetkileri ve gönderi sabitleme
-- Yeni kurulum: SUPABASE_TUM_KURULUM.sql dosyasının sonuna eklidir.
-- Mevcut kurulum: bu dosyayı bir kez Supabase SQL Editor üzerinden çalıştırın.
-- ============================================================================

create or replace function public.aurax_base_is_plus_user(p_uid uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plus boolean := false;
begin
  if p_uid is null then
    return false;
  end if;
  -- Kullanıcılar yalnızca kendi Plus durumlarını sorgulayabilir; admin ve service_role istisnadır.
  if auth.uid() is not null
     and p_uid is distinct from auth.uid()
     and not public.aurax_base_is_admin(auth.uid()) then
    return false;
  end if;
  select coalesce(u.data ->> 'plusMember', 'false') = 'true'
    into v_plus
  from public.users u
  where u.data ->> 'authUid' = p_uid::text
  limit 1;
  return coalesce(v_plus, false);
end;
$$;
revoke all on function public.aurax_base_is_plus_user(uuid) from public, anon;
grant execute on function public.aurax_base_is_plus_user(uuid) to authenticated, service_role;

-- İstemcinin kendi JSONB profilini düzenleyerek yönetici/Plus/rozet yetkisi kazanmasını önler.
-- Güvenilir SQL Editor / service_role çağrıları (auth.uid() IS NULL) engellenmez.
create or replace function public.aurax_protect_user_entitlements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_sticker_limit integer;
begin
  if auth.uid() is not null and not public.aurax_base_is_admin(auth.uid()) then
    if tg_op = 'INSERT' then
      foreach v_key in array array[
        'role','sysAdmin','sysAdminCodeHash','plusMember','plusGrantedAt','plusGrantedBy',
        'verified','special','banned','bannedAt','bannedBy'
      ] loop
        new.data := coalesce(new.data, '{}'::jsonb) - v_key;
      end loop;
    else
      foreach v_key in array array[
        'role','sysAdmin','sysAdminCodeHash','plusMember','plusGrantedAt','plusGrantedBy',
        'verified','special','banned','bannedAt','bannedBy'
      ] loop
        if old.data ? v_key then
          new.data := jsonb_set(coalesce(new.data, '{}'::jsonb), array[v_key], old.data -> v_key, true);
        else
          new.data := coalesce(new.data, '{}'::jsonb) - v_key;
        end if;
      end loop;
    end if;
  end if;

  if tg_op = 'INSERT' then
    v_sticker_limit := case
      when coalesce(new.data ->> 'plusMember', 'false') = 'true' then 200
      else 40
    end;
    if jsonb_typeof(new.data -> 'stickers') = 'array'
       and jsonb_array_length(new.data -> 'stickers') > v_sticker_limit then
      new.data := jsonb_set(
        coalesce(new.data, '{}'::jsonb),
        '{stickers}',
        coalesce((
          select jsonb_agg(sticker.value order by sticker.ordinality)
          from jsonb_array_elements(new.data -> 'stickers') with ordinality as sticker(value, ordinality)
          where sticker.ordinality <= v_sticker_limit
        ), '[]'::jsonb),
        true
      );
    end if;
  elsif new.data -> 'stickers' is distinct from old.data -> 'stickers'
     or new.data -> 'plusMember' is distinct from old.data -> 'plusMember' then
    v_sticker_limit := case
      when coalesce(new.data ->> 'plusMember', 'false') = 'true' then 200
      else 40
    end;
    if jsonb_typeof(new.data -> 'stickers') = 'array'
       and jsonb_array_length(new.data -> 'stickers') > v_sticker_limit then
      -- Üyelik iptalinde listenin ilk 40 öğesini koruyarak normal hesaba döndür.
      new.data := jsonb_set(
        coalesce(new.data, '{}'::jsonb),
        '{stickers}',
        coalesce((
          select jsonb_agg(sticker.value order by sticker.ordinality)
          from jsonb_array_elements(new.data -> 'stickers') with ordinality as sticker(value, ordinality)
          where sticker.ordinality <= v_sticker_limit
        ), '[]'::jsonb),
        true
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists aurax_protect_user_entitlements on public.users;
create trigger aurax_protect_user_entitlements
before insert or update on public.users
for each row execute function public.aurax_protect_user_entitlements();

-- Plus üyeliği yalnızca gerçek A_UR_A_XX admin oturumu üzerinden açılır/kapatılır.
create or replace function public.aurax_admin_set_plus_member(p_username text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested text := btrim(coalesce(p_username, ''));
  v_user_id text;
  v_user_data jsonb;
  v_actor text;
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null
     or not public.aurax_base_is_admin(auth.uid())
     or public.aurax_base_current_username(auth.uid()) is distinct from 'A_UR_A_XX' then
    raise exception 'Only A_UR_A_XX can manage Forever Plus membership.' using errcode = '42501';
  end if;
  if v_requested = '' or length(v_requested) > 40 then
    raise exception 'Geçerli bir kullanıcı adı girin.' using errcode = '22023';
  end if;
  if lower(v_requested) = lower('A_UR_A_XX') then
    raise exception 'Yönetici hesabına Plus üyeliği atanamaz.' using errcode = '22023';
  end if;

  select u.id, u.data
    into v_user_id, v_user_data
  from public.users u
  where lower(u.id) = lower(v_requested)
     or lower(coalesce(u.data ->> 'username', '')) = lower(v_requested)
  order by case when lower(u.id) = lower(v_requested) then 0 else 1 end
  limit 1
  for update;

  if v_user_id is null then
    raise exception 'Bu kullanıcı adıyla eşleşen üye bulunamadı.' using errcode = 'P0002';
  end if;

  v_actor := coalesce(public.aurax_base_current_username(auth.uid()), 'A_UR_A_XX');
  update public.users
  set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
    'plusMember', coalesce(p_enabled, false),
    'plusGrantedAt', case when coalesce(p_enabled, false) then v_now_ms else null end,
    'plusGrantedBy', case when coalesce(p_enabled, false) then v_actor else null end
  )
  where id = v_user_id;

  return jsonb_build_object(
    'ok', true,
    'userId', v_user_id,
    'username', coalesce(v_user_data ->> 'username', v_user_id),
    'plusMember', coalesce(p_enabled, false)
  );
end;
$$;
revoke all on function public.aurax_admin_set_plus_member(text, boolean) from public, anon;
grant execute on function public.aurax_admin_set_plus_member(text, boolean) to authenticated, service_role;

-- Normal hesaplar pin değerini doğrudan JSONB içine yazarak Plus kuralını aşamaz.
create or replace function public.aurax_guard_post_pin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text;
  v_is_admin boolean;
begin
  if coalesce(new.data ->> 'pinned', 'false') = 'true' then
    v_is_admin := public.aurax_base_is_admin(auth.uid());
    if not v_is_admin then
      v_actor := public.aurax_base_current_username(auth.uid());
      if not public.aurax_base_is_plus_user(auth.uid())
         or v_actor is null
         or new.data ->> 'author' is distinct from v_actor then
        new.data := jsonb_set(coalesce(new.data, '{}'::jsonb), '{pinned}', 'false'::jsonb, true) - 'pinnedAt' - 'pinnedBy';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists aurax_guard_post_pin on public.posts;
create trigger aurax_guard_post_pin
before insert or update on public.posts
for each row execute function public.aurax_guard_post_pin();

-- A_UR_A_XX herhangi bir gönderiyi; Plus üyesi yalnızca kendi gönderisini sabitleyebilir.
create or replace function public.aurax_set_post_pin(p_post text, p_pinned boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text;
  v_is_admin boolean;
  v_post jsonb;
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  v_is_admin := public.aurax_base_is_admin(auth.uid());
  v_actor := public.aurax_base_current_username(auth.uid());

  select p.data into v_post
  from public.posts p
  where p.id = p_post
  for update;
  if v_post is null then
    raise exception 'Gönderi bulunamadı.' using errcode = 'P0002';
  end if;

  if not v_is_admin then
    if not public.aurax_base_is_plus_user(auth.uid()) then
      raise exception 'Forever Plus membership required.' using errcode = '42501';
    end if;
    if v_actor is null or v_post ->> 'author' is distinct from v_actor then
      raise exception 'Plus members can pin only their own posts.' using errcode = '42501';
    end if;
  end if;

  update public.posts
  set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
    'pinned', coalesce(p_pinned, false),
    'pinnedAt', case when coalesce(p_pinned, false) then v_now_ms else null end,
    'pinnedBy', case when coalesce(p_pinned, false) then v_actor else null end
  )
  where id = p_post;
  return true;
end;
$$;
revoke all on function public.aurax_set_post_pin(text, boolean) from public, anon;
grant execute on function public.aurax_set_post_pin(text, boolean) to authenticated, service_role;




-- Forever medya kovası: public URL kullanımı için public kalır; upsert için sahip SELECT/UPDATE izni tanımlanır.
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 52428800)
on conflict (id) do update
set public = true,
    file_size_limit = case
      when storage.buckets.file_size_limit is null then null
      else greatest(storage.buckets.file_size_limit, 52428800)
    end;

create or replace function public.aurax_can_manage_media_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_username text := public.aurax_base_current_username(auth.uid());
begin
  if auth.uid() is null or v_username is null or p_name is null then
    return false;
  end if;
  if public.aurax_base_is_admin(auth.uid()) then
    return true;
  end if;
  return starts_with(p_name, 'avatars/' || v_username || '_')
      or starts_with(p_name, 'postImages/' || v_username || '_')
      or starts_with(p_name, 'postVideos/' || v_username || '_')
      or starts_with(p_name, 'statusImages/' || v_username || '_')
      or starts_with(p_name, 'statusVideos/' || v_username || '_')
      or starts_with(p_name, 'stickers/' || v_username || '/')
      or (starts_with(p_name, 'room-media/') and position('/' || v_username || '_' in p_name) > 0);
end;
$$;
revoke all on function public.aurax_can_manage_media_path(text) from public, anon;
grant execute on function public.aurax_can_manage_media_path(text) to authenticated, service_role;

create or replace function public.aurax_is_animated_sticker_upload(p_name text, p_metadata jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_animated boolean;
  v_size_text text;
begin
  v_animated := starts_with(coalesce(p_name, ''), 'stickers/')
    and (
      coalesce(p_name, '') ~* '\.(gif|apng|webp)$'
      or lower(coalesce(p_metadata ->> 'mimetype', '')) in ('image/gif','image/apng','image/webp')
    );
  if not v_animated then return false; end if;
  v_size_text := coalesce(p_metadata ->> 'size', '');
  if auth.uid() is not null and public.aurax_base_is_admin(auth.uid()) then return false; end if;
  if not public.aurax_base_is_plus_user(auth.uid()) then return true; end if;
  return case when v_size_text ~ '^[0-9]+$' then v_size_text::bigint > 8388608 else true end;
end;
$$;
revoke all on function public.aurax_is_animated_sticker_upload(text, jsonb) from public, anon;
grant execute on function public.aurax_is_animated_sticker_upload(text, jsonb) to authenticated, service_role;

-- x-upsert kullandığımız için INSERT'in yanında sahip SELECT ve UPDATE politikaları da zorunludur.
drop policy if exists aurax_media_select_own on storage.objects;
create policy aurax_media_select_own on storage.objects
for select to authenticated
using (bucket_id = 'media' and public.aurax_can_manage_media_path(name));

drop policy if exists aurax_media_update_own on storage.objects;
create policy aurax_media_update_own on storage.objects
for update to authenticated
using (bucket_id = 'media' and public.aurax_can_manage_media_path(name))
with check (
  bucket_id = 'media'
  and public.aurax_can_manage_media_path(name)
  and (
    public.aurax_base_is_admin(auth.uid())
    or not public.aurax_is_animated_sticker_upload(name, metadata)
  )
);

drop policy if exists aurax_media_insert on storage.objects;
create policy aurax_media_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'media'
  and public.aurax_can_manage_media_path(name)
  and (
    public.aurax_base_is_admin(auth.uid())
    or not public.aurax_is_animated_sticker_upload(name, metadata)
  )
);

notify pgrst, 'reload schema';
