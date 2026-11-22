-- FOREVER: Supabase schema + access control
-- Run this entire file in Supabase SQL Editor. Firebase is not used.
create extension if not exists pgcrypto;

-- Security-definer implementations stay outside the exposed Data API schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.forever_admins (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table if not exists public.forever_plus_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.forever_private_user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  birth_date date not null,
  ip_address text,
  kvkk_notice_accepted_at timestamptz not null,
  terms_accepted_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.forever_documents (
  collection_name text not null,
  id text not null,
  owner_id uuid references auth.users(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection_name, id)
);

create index if not exists forever_documents_collection_created_idx
  on public.forever_documents (collection_name, created_at desc);
create index if not exists forever_documents_owner_idx
  on public.forever_documents (owner_id);
create index if not exists forever_documents_data_gin_idx
  on public.forever_documents using gin (data);

-- Explicit API privileges; row-level policies below remain the authorization boundary.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.forever_documents to authenticated;
grant select on public.forever_private_user_data to authenticated;

alter table public.forever_admins enable row level security;
alter table public.forever_plus_members enable row level security;
alter table public.forever_private_user_data enable row level security;
alter table public.forever_documents enable row level security;

create or replace function private.is_forever_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.forever_admins a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function private.is_forever_plus()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.forever_plus_members p where p.user_id = auth.uid()
  );
$$;

create or replace function private.is_forever_room_member(p_room_id text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.forever_documents m
    where m.collection_name = 'room_members'
      and m.data ->> 'roomId' = p_room_id
      and m.data ->> 'userId' = auth.uid()::text
  );
$$;
create or replace function private.can_view_forever_story(p_author_id text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    p_author_id = auth.uid()::text
    or exists (
      select 1 from public.forever_documents profile
      where profile.collection_name = 'users'
        and profile.id = auth.uid()::text
        and coalesce(profile.data -> 'following', '[]'::jsonb) @> jsonb_build_array(p_author_id)
    )
  );
$$;
revoke all on function private.is_forever_admin() from public, anon;
grant execute on function private.is_forever_admin() to authenticated;
revoke all on function private.is_forever_plus() from public, anon;
grant execute on function private.is_forever_plus() to authenticated;
revoke all on function private.is_forever_room_member(text) from public, anon;
grant execute on function private.is_forever_room_member(text) to authenticated;
revoke all on function private.can_view_forever_story(text) from public, anon;
grant execute on function private.can_view_forever_story(text) to authenticated;

drop policy if exists forever_documents_select on public.forever_documents;
create policy forever_documents_select on public.forever_documents
for select to authenticated
using (
  (select private.is_forever_admin())
  or owner_id = (select auth.uid())
  or collection_name in ('users','usernames','posts','rooms','stickers')
  or (collection_name = 'stories' and private.can_view_forever_story(data ->> 'userId'))
  or (collection_name = 'notifications' and data ->> 'toUid' = (select auth.uid())::text)
  or (collection_name = 'reports' and data ->> 'reporterId' = (select auth.uid())::text)
  or (collection_name = 'room_members' and private.is_forever_room_member(data ->> 'roomId'))
  or (collection_name = 'room_messages' and private.is_forever_room_member(data ->> 'roomId'))
  or (collection_name = 'blocks' and (
    data ->> 'blockerId' = (select auth.uid())::text or data ->> 'blockedId' = (select auth.uid())::text
  ))
  or (collection_name = 'room_bans' and (select private.is_forever_admin()))
);

drop policy if exists forever_documents_insert on public.forever_documents;
create policy forever_documents_insert on public.forever_documents
for insert to authenticated
with check (
  (select private.is_forever_admin())
  or (
    owner_id = (select auth.uid())
    and collection_name in (
      'posts','stories','comments','notifications',
      'reports','blocks','rooms','room_members','room_messages','stickers'
    )
    and (collection_name <> 'room_members' or data ->> 'userId' = (select auth.uid())::text)
    and (collection_name <> 'reports' or data ->> 'reporterId' = (select auth.uid())::text)
  )
);

drop policy if exists forever_documents_update on public.forever_documents;
create policy forever_documents_update on public.forever_documents
for update to authenticated
using (
  (select private.is_forever_admin())
  or (owner_id = (select auth.uid()) and collection_name not in ('room_members','usernames','room_bans','modlogs'))
  or collection_name in ('posts','users')
  or (collection_name = 'notifications' and data ->> 'toUid' = (select auth.uid())::text)
  or (collection_name = 'room_messages' and (select private.is_forever_plus()) and private.is_forever_room_member(data ->> 'roomId'))
)
with check (
  (select private.is_forever_admin())
  or (owner_id = (select auth.uid()) and collection_name not in ('room_members','usernames','room_bans','modlogs'))
  or collection_name in ('posts','users')
  or (collection_name = 'notifications' and data ->> 'toUid' = (select auth.uid())::text)
  or (collection_name = 'room_messages' and (select private.is_forever_plus()) and private.is_forever_room_member(data ->> 'roomId'))
);

drop policy if exists forever_documents_delete on public.forever_documents;
create policy forever_documents_delete on public.forever_documents
for delete to authenticated
using (
  (select private.is_forever_admin())
  or (owner_id = (select auth.uid()) and collection_name not in ('users','usernames','room_bans','modlogs'))
);

drop policy if exists forever_private_user_data_select on public.forever_private_user_data;
create policy forever_private_user_data_select on public.forever_private_user_data
for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_forever_admin()));

drop policy if exists forever_admins_no_client_access on public.forever_admins;
create policy forever_admins_no_client_access on public.forever_admins
for all to authenticated using (false) with check (false);

drop policy if exists forever_plus_members_no_client_access on public.forever_plus_members;
create policy forever_plus_members_no_client_access on public.forever_plus_members
for all to authenticated using (false) with check (false);

create or replace function private.register_forever_profile(
  p_username text,
  p_first_name text,
  p_last_name text,
  p_birth_date date,
  p_kvkk_notice_accepted boolean,
  p_terms_accepted boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_username text := lower(trim(coalesce(p_username, '')));
  v_first_name text := trim(coalesce(p_first_name, ''));
  v_last_name text := trim(coalesce(p_last_name, ''));
  v_headers jsonb;
  v_ip text;
  v_name text;
begin
  if v_uid is null then raise exception 'Google hesabıyla giriş yapmalısınız.'; end if;
  if v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Kullanıcı adı 3-24 karakter olmalı; küçük harf, rakam ve alt çizgi kullanılabilir.';
  end if;
  if length(v_first_name) < 2 or length(v_first_name) > 50
     or length(v_last_name) < 2 or length(v_last_name) > 50 then
    raise exception 'Ad ve soyad 2-50 karakter arasında olmalı.';
  end if;
  if p_birth_date is null or p_birth_date > current_date then
    raise exception 'Geçerli bir doğum tarihi girin.';
  end if;
  if not coalesce(p_kvkk_notice_accepted, false) or not coalesce(p_terms_accepted, false) then
    raise exception 'KVKK aydınlatma metni ve kullanım koşulları onaylanmalıdır.';
  end if;
  if exists (
    select 1 from public.forever_documents
    where collection_name = 'users' and id = v_uid::text
  ) then
    raise exception 'Bu hesap için Forever profili zaten oluşturulmuş.';
  end if;
  if exists (
    select 1 from public.forever_documents
    where collection_name = 'usernames' and id = v_username
  ) then
    raise exception 'Bu kullanıcı adı alınmış. Başka bir ad deneyin.';
  end if;

  v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ip := coalesce(
    nullif(v_headers ->> 'cf-connecting-ip', ''),
    nullif(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), ''),
    nullif(v_headers ->> 'x-real-ip', '')
  );
  v_name := v_username;

  insert into public.forever_documents(collection_name,id,owner_id,data)
  values ('usernames', v_username, v_uid,
    jsonb_build_object('uid',v_uid::text,'username',v_username,'createdAt',jsonb_build_object('seconds',extract(epoch from now())::bigint)));

  insert into public.forever_documents(collection_name,id,owner_id,data)
  values ('users', v_uid::text, v_uid,
    jsonb_build_object(
      'uid',v_uid::text,'username',v_username,'displayName',v_name,
      'following','[]'::jsonb,'followers','[]'::jsonb,'bio','',
      'isPlus',false,'suspended',false,'createdAt',
      jsonb_build_object('seconds',extract(epoch from now())::bigint)
    ));

  insert into public.forever_private_user_data(
    user_id,first_name,last_name,birth_date,ip_address,
    kvkk_notice_accepted_at,terms_accepted_at
  ) values (v_uid,v_first_name,v_last_name,p_birth_date,v_ip,now(),now());

  return jsonb_build_object('success',true,'uid',v_uid::text,'username',v_username);
end;
$$;
revoke all on function private.register_forever_profile(text,text,text,date,boolean,boolean) from public, anon;
grant execute on function private.register_forever_profile(text,text,text,date,boolean,boolean) to authenticated;

create or replace function private.grant_forever_plus(p_username text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid;
begin
  if not private.is_forever_admin() then raise exception 'Bu işlem yalnızca yöneticilere açıktır.'; end if;
  select (data ->> 'uid')::uuid into v_uid
  from public.forever_documents
  where collection_name='users' and lower(data ->> 'username')=lower(trim(p_username))
  limit 1;
  if v_uid is null then raise exception 'Bu kullanıcı adıyla bir hesap bulunamadı.'; end if;
  insert into public.forever_plus_members(user_id,created_by)
  values(v_uid,lower(coalesce(auth.jwt() ->> 'email','')))
  on conflict(user_id) do nothing;
  update public.forever_documents
  set data = data || jsonb_build_object('isPlus',true,'plusSince',now()::text,'plusFollowerBonus',10),
      updated_at=now()
  where collection_name='users' and id=v_uid::text;
  return jsonb_build_object('success',true,'uid',v_uid::text,'username',lower(trim(p_username)));
end;
$$;
revoke all on function private.grant_forever_plus(text) from public, anon;
grant execute on function private.grant_forever_plus(text) to authenticated;

create or replace function private.revoke_forever_plus(p_username text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid;
begin
  if not private.is_forever_admin() then raise exception 'Bu işlem yalnızca yöneticilere açıktır.'; end if;
  select (data ->> 'uid')::uuid into v_uid
  from public.forever_documents
  where collection_name='users' and lower(data ->> 'username')=lower(trim(p_username))
  limit 1;
  if v_uid is null then raise exception 'Kullanıcı bulunamadı.'; end if;
  delete from public.forever_plus_members where user_id=v_uid;
  update public.forever_documents
  set data = data || jsonb_build_object('isPlus',false) - 'plusSince' - 'plusFollowerBonus',
      updated_at=now()
  where collection_name='users' and id=v_uid::text;
  return jsonb_build_object('success',true,'uid',v_uid::text);
end;
$$;
revoke all on function private.revoke_forever_plus(text) from public, anon;
grant execute on function private.revoke_forever_plus(text) to authenticated;

create or replace function private.enforce_forever_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_is_plus boolean;
  v_daily_limit integer;
  v_count integer;
  v_room_id text;
  v_user_id text;
  v_username text;
  v_new_media boolean := false;
  v_comment jsonb;
  v_vote record;
  v_expected_counts jsonb;
  v_option_index integer;
begin
  v_is_admin := private.is_forever_admin();
  v_is_plus := private.is_forever_plus();
  if v_is_plus then
    v_daily_limit := 10;
  else
    v_daily_limit := 5;
  end if;

  if not v_is_admin and tg_op in ('INSERT','UPDATE') then
    if new.collection_name = 'users' then
      new.data := new.data - 'email' - 'firstName' - 'lastName' - 'birthDate'
        - 'dateOfBirth' - 'ipAddress' - 'ip_address' - 'kvkkAcceptedAt' - 'termsAcceptedAt';
    elsif new.collection_name in ('posts','stories','room_messages','comments') then
      new.data := new.data - 'email' - 'authorEmail';
    end if;
  end if;

  if tg_op = 'INSERT' and not v_is_admin then
    if new.collection_name in ('posts','stories','room_messages') then
      if new.data ->> 'userId' is distinct from auth.uid()::text then
        raise exception 'İçerik yalnızca kendi hesabın adına oluşturulabilir.';
      end if;
      select data ->> 'username' into v_username
      from public.forever_documents
      where collection_name = 'users' and id = auth.uid()::text
      limit 1;
      if v_username is null then
        raise exception 'Önce Forever profilini tamamlamalısın.';
      end if;
      if new.collection_name = 'room_messages' then
        if new.data ->> 'username' is distinct from v_username then
          raise exception 'Oda mesajı kullanıcı adı profilinle eşleşmiyor.';
        end if;
      else
        if new.data ->> 'authorUsername' is distinct from v_username
           or new.data ->> 'authorName' is distinct from v_username then
          raise exception 'Gönderi kullanıcı adı profilinle eşleşmiyor.';
        end if;
      end if;
    end if;

    if new.collection_name = 'users' then
      if new.id is distinct from auth.uid()::text
         or new.owner_id is distinct from auth.uid()
         or new.data ->> 'uid' is distinct from auth.uid()::text
         or coalesce(new.data ->> 'isPlus','false') <> 'false' then
        raise exception 'Kullanıcı profili yalnızca güvenli kayıt işlemiyle oluşturulabilir.';
      end if;
    elsif new.collection_name = 'usernames' then
      if new.owner_id is distinct from auth.uid()
         or new.data ->> 'uid' is distinct from auth.uid()::text
         or lower(coalesce(new.data ->> 'username','')) is distinct from lower(new.id) then
        raise exception 'Kullanıcı adı yalnızca hesabına ait güvenli kayıt işlemiyle ayrılabilir.';
      end if;
    elsif new.collection_name = 'blocks' then
      if new.data ->> 'blockerId' is distinct from auth.uid()::text then
        raise exception 'Engelleme işlemi yalnızca kendi hesabın adına yapılabilir.';
      end if;
    elsif new.collection_name = 'notifications' then
      if new.data ->> 'fromUid' is distinct from auth.uid()::text then
        raise exception 'Bildirim yalnızca kendi hesabın adına gönderilebilir.';
      end if;
    elsif new.collection_name = 'room_members' then
      v_user_id := new.data ->> 'userId';
      v_room_id := new.data ->> 'roomId';
      if v_user_id is distinct from auth.uid()::text then
        raise exception 'Yalnızca kendi hesabını odaya ekleyebilirsin.';
      end if;
      if exists (
        select 1 from public.forever_documents ban
        where ban.collection_name = 'room_bans'
          and ban.data ->> 'roomId' = v_room_id
          and ban.data ->> 'userId' = v_user_id
      ) then
        raise exception 'Bu odaya katılman yönetim tarafından engellenmiş.';
      end if;
      if not v_is_plus then
        select count(*) into v_count
        from public.forever_documents member
        where member.collection_name = 'room_members'
          and member.data ->> 'userId' = v_user_id;
        if v_count >= 3 then
          raise exception 'Ücretsiz üyeler en fazla 3 odaya katılabilir. Plus ile sınırı kaldır.';
        end if;
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' and not v_is_admin then
    if new.collection_name is distinct from old.collection_name
       or new.id is distinct from old.id
       or new.owner_id is distinct from old.owner_id then
      raise exception 'Kayıt kimliği ve sahibi değiştirilemez.';
    end if;

    -- Comments are append-only and must belong to the signed-in user.
    if new.collection_name = 'posts' then
      if jsonb_typeof(coalesce(new.data -> 'comments','[]'::jsonb)) <> 'array'
         or jsonb_typeof(coalesce(old.data -> 'comments','[]'::jsonb)) <> 'array' then
        raise exception 'Yorum verisi geçersiz.';
      end if;
      if not (coalesce(new.data -> 'comments','[]'::jsonb) @>
              coalesce(old.data -> 'comments','[]'::jsonb)) then
        raise exception 'Yorumları silemez veya değiştiremezsin.';
      end if;

      select profile.data ->> 'username' into v_username
      from public.forever_documents profile
      where profile.collection_name = 'users'
        and profile.id = auth.uid()::text
      limit 1;

      for v_comment in
        select item.value
        from jsonb_array_elements(coalesce(new.data -> 'comments','[]'::jsonb)) as item(value)
      loop
        if not (coalesce(old.data -> 'comments','[]'::jsonb) @> jsonb_build_array(v_comment)) then
          if jsonb_typeof(v_comment) <> 'object'
             or v_username is null
             or v_comment ->> 'userId' is distinct from auth.uid()::text
             or v_comment ->> 'author' is distinct from v_username
             or coalesce(v_comment ->> 'authorIsPlus','false') is distinct from v_is_plus::text
             or length(trim(coalesce(v_comment ->> 'text',''))) < 1
             or length(coalesce(v_comment ->> 'text','')) > 500 then
            raise exception 'Yorum yalnızca kendi hesabın adına eklenebilir ve en fazla 500 karakter olabilir.';
          end if;
        end if;
      end loop;
    end if;

    -- Poll definitions are immutable; one vote per account.
    -- Counts are recalculated in PostgreSQL, never trusted from the browser.
    if new.collection_name = 'posts' and (old.data ? 'poll' or new.data ? 'poll') then
      if not (old.data ? 'poll') then
        if not v_is_plus then raise exception 'Anket oluşturma Plus özelliğidir.'; end if;
        if jsonb_typeof(new.data -> 'poll' -> 'options') <> 'array'
           or jsonb_array_length(new.data -> 'poll' -> 'options') < 2
           or jsonb_array_length(new.data -> 'poll' -> 'options') > 4
           or jsonb_typeof(coalesce(new.data -> 'poll' -> 'voters','{}'::jsonb)) <> 'object'
           or coalesce(new.data -> 'poll' -> 'voters','{}'::jsonb) <> '{}'::jsonb then
          raise exception 'Yeni anket 2-4 seçenekle ve sıfır oyla oluşturulmalıdır.';
        end if;
      elsif not (new.data ? 'poll') then
        raise exception 'Oluşturulmuş anket kaldırılamaz.';
      elsif (new.data -> 'poll' - 'counts' - 'voters') is distinct from
            (old.data -> 'poll' - 'counts' - 'voters') then
        raise exception 'Anket sorusunu veya seçeneklerini değiştiremezsin.';
      end if;

      if jsonb_typeof(coalesce(new.data -> 'poll' -> 'options','[]'::jsonb)) <> 'array'
         or jsonb_array_length(new.data -> 'poll' -> 'options') < 2
         or jsonb_array_length(new.data -> 'poll' -> 'options') > 4
         or jsonb_typeof(coalesce(new.data -> 'poll' -> 'voters','{}'::jsonb)) <> 'object' then
        raise exception 'Anket oy verisi geçersiz.';
      end if;

      if (coalesce(new.data -> 'poll' -> 'voters','{}'::jsonb) - auth.uid()::text)
         is distinct from (coalesce(old.data -> 'poll' -> 'voters','{}'::jsonb) - auth.uid()::text) then
        raise exception 'Yalnızca kendi oyununu kaydedebilirsin.';
      end if;

      if (coalesce(old.data -> 'poll' -> 'voters','{}'::jsonb) ? auth.uid()::text)
         and (new.data -> 'poll' -> 'voters' -> auth.uid()::text)
             is distinct from (old.data -> 'poll' -> 'voters' -> auth.uid()::text) then
        raise exception 'Verilmiş oy değiştirilemez.';
      end if;

      if (coalesce(new.data -> 'poll' -> 'voters','{}'::jsonb) ? auth.uid()::text)
         and not (coalesce(old.data -> 'poll' -> 'voters','{}'::jsonb) ? auth.uid()::text) then
        if jsonb_typeof(new.data -> 'poll' -> 'voters' -> auth.uid()::text) <> 'number'
           or (new.data -> 'poll' -> 'voters' ->> auth.uid()::text) !~ '^[0-9]+$' then
          raise exception 'Oy seçimi geçersiz.';
        end if;
        v_option_index := (new.data -> 'poll' -> 'voters' ->> auth.uid()::text)::integer;
        if v_option_index < 0 or v_option_index >= jsonb_array_length(new.data -> 'poll' -> 'options') then
          raise exception 'Oy seçimi geçersiz.';
        end if;
      end if;

      for v_vote in
        select key, value
        from jsonb_each(coalesce(new.data -> 'poll' -> 'voters','{}'::jsonb))
      loop
        if jsonb_typeof(v_vote.value) <> 'number'
           or (v_vote.value #>> '{}') !~ '^[0-9]+$'
           or (v_vote.value #>> '{}')::integer < 0
           or (v_vote.value #>> '{}')::integer >= jsonb_array_length(new.data -> 'poll' -> 'options') then
          raise exception 'Anket oy kayıtlarından biri geçersiz.';
        end if;
      end loop;

      select coalesce(jsonb_agg(vote_count order by option_order),'[]'::jsonb)
      into v_expected_counts
      from (
        select option_item.ord as option_order, count(voter.key)::integer as vote_count
        from jsonb_array_elements(new.data -> 'poll' -> 'options')
             with ordinality as option_item(value,ord)
        left join jsonb_each(coalesce(new.data -> 'poll' -> 'voters','{}'::jsonb)) as voter(key,value)
          on (voter.value #>> '{}')::integer = option_item.ord - 1
        group by option_item.ord
      ) tally;
      new.data := jsonb_set(new.data,'{poll,counts}',v_expected_counts,true);
    end if;

    if new.collection_name = 'usernames' then
      raise exception 'Kayıtlı kullanıcı adı eşlemesi değiştirilemez.';
    elsif new.collection_name = 'users' then
      if new.data ->> 'username' is distinct from old.data ->> 'username'
         or new.data ->> 'uid' is distinct from old.data ->> 'uid' then
        raise exception 'Kullanıcı adı ve hesap kimliği değiştirilemez.';
      end if;
      if old.owner_id = auth.uid() then
        if new.data -> 'followers' is distinct from old.data -> 'followers' then
          raise exception 'Takipçi listen yalnızca takip işlemleriyle güncellenebilir.';
        end if;
        if (new.data - 'bio' - 'displayName' - 'following') is distinct from
           (old.data - 'bio' - 'displayName' - 'following') then
          raise exception 'Yalnızca profil açıklamanı ve takip ettiklerini değiştirebilirsin.';
        end if;
      else
        if (new.data - 'followers') is distinct from (old.data - 'followers') then
          raise exception 'Başka kullanıcıların profilinde yalnızca takipçi listen güncellenebilir.';
        end if;
        if ((new.data -> 'followers') - auth.uid()::text) is distinct from
           ((old.data -> 'followers') - auth.uid()::text) then
          raise exception 'Yalnızca kendi takip ilişkini değiştirebilirsin.';
        end if;
      end if;
    elsif new.collection_name = 'posts' then
      if old.owner_id is distinct from auth.uid() then
        if (new.data - 'likes' - 'comments' - 'sparks' - 'poll') is distinct from
           (old.data - 'likes' - 'comments' - 'sparks' - 'poll') then
          raise exception 'Başkasının gönderi metnini veya medyasını değiştiremezsin.';
        end if;
        if ((new.data -> 'likes') - auth.uid()::text) is distinct from
           ((old.data -> 'likes') - auth.uid()::text) then
          raise exception 'Yalnızca kendi beğenini ekleyebilir veya kaldırabilirsin.';
        end if;
        if not (coalesce(new.data -> 'comments','[]'::jsonb) @>
                coalesce(old.data -> 'comments','[]'::jsonb)) then
          raise exception 'Yorumları silemez veya değiştiremezsin.';
        end if;
        if (new.data -> 'poll' - 'counts' - 'voters') is distinct from
           (old.data -> 'poll' - 'counts' - 'voters') then
          raise exception 'Anket sorusunu veya seçeneklerini değiştiremezsin.';
        end if;
        if ((new.data -> 'poll' -> 'voters') - auth.uid()::text) is distinct from
           ((old.data -> 'poll' -> 'voters') - auth.uid()::text) then
          raise exception 'Ankette yalnızca kendi oyununu kaydedebilirsin.';
        end if;
      end if;
    elsif new.collection_name in ('stories','room_messages') then
      if new.data ->> 'userId' is distinct from old.data ->> 'userId'
         or new.data ->> 'roomId' is distinct from old.data ->> 'roomId' then
        raise exception 'İçeriğin sahibi ve oda kimliği değiştirilemez.';
      end if;
      if new.collection_name = 'room_messages'
         and old.owner_id is distinct from auth.uid() then
        if (new.data - 'pinned') is distinct from (old.data - 'pinned') then
          raise exception 'Başkasının oda mesajı içeriğini değiştiremezsin.';
        end if;
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' and new.collection_name = 'posts' and new.data ? 'poll' then
    if not v_is_plus and not v_is_admin then
      raise exception 'Anket oluşturma Plus özelliğidir.';
    end if;
    if jsonb_typeof(new.data -> 'poll' -> 'options') <> 'array'
       or jsonb_array_length(new.data -> 'poll' -> 'options') < 2
       or jsonb_array_length(new.data -> 'poll' -> 'options') > 4
       or jsonb_typeof(coalesce(new.data -> 'poll' -> 'voters','{}'::jsonb)) <> 'object'
       or coalesce(new.data -> 'poll' -> 'voters','{}'::jsonb) <> '{}'::jsonb then
      raise exception 'Yeni anket 2-4 seçenekle ve sıfır oyla oluşturulmalıdır.';
    end if;
    select coalesce(jsonb_agg(0 order by option_item.ord),'[]'::jsonb)
    into v_expected_counts
    from jsonb_array_elements(new.data -> 'poll' -> 'options')
         with ordinality as option_item(value,ord);
    new.data := jsonb_set(new.data,'{poll,counts}',v_expected_counts,true);
  end if;

  if new.collection_name = 'posts' and (new.data ->> 'imageUrl') is null
     and not v_is_plus and not v_is_admin then
    raise exception 'Yalnızca Plus üyeleri sadece metin gönderisi paylaşabilir.';
  end if;

  if new.collection_name in ('posts','stories') then
    if tg_op = 'INSERT' then
      v_new_media := coalesce(new.data ->> 'imageUrl', new.data ->> 'imagePath') is not null;
    else
      v_new_media := coalesce(new.data ->> 'imageUrl', new.data ->> 'imagePath') is not null
        and coalesce(new.data ->> 'imageUrl', new.data ->> 'imagePath') is distinct from
            coalesce(old.data ->> 'imageUrl', old.data ->> 'imagePath');
    end if;
    if v_new_media then
      select count(*) into v_count
      from public.forever_documents document
      where document.collection_name in ('posts','stories')
        and document.owner_id = new.owner_id
        and document.created_at >= date_trunc('day', now())
        and (tg_op <> 'UPDATE' or document.collection_name <> new.collection_name or document.id <> new.id);
      if v_count >= v_daily_limit and not v_is_admin then
        raise exception 'Günlük toplam medya yükleme sınırına ulaştın.';
      end if;
    end if;
  end if;

  if new.collection_name = 'room_messages' then
    v_room_id := new.data ->> 'roomId';
    if not v_is_admin and not private.is_forever_room_member(v_room_id) then
      raise exception 'Bu odanın üyesi değilsin.';
    end if;
    if (coalesce(new.data ->> 'kind','') in ('sticker','drawing','custom_sticker')
        or coalesce(new.data ->> 'stickerUrl','') <> ''
        or coalesce(new.data ->> 'drawingData','') <> '')
       and not v_is_plus and not v_is_admin then
      raise exception 'Animasyonlu çıkartmalar ve oda çizimi Plus üyeliği gerektirir.';
    end if;
    if tg_op = 'UPDATE'
       and coalesce((new.data ->> 'pinned')::boolean,false)
       and not coalesce((old.data ->> 'pinned')::boolean,false)
       and not v_is_plus and not v_is_admin then
      raise exception 'Mesaj sabitleme Plus üyeliği gerektirir.';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists forever_limits_guard on public.forever_documents;
create trigger forever_limits_guard
before insert or update on public.forever_documents
for each row execute function private.enforce_forever_limits();
revoke all on function private.enforce_forever_limits() from public, anon, authenticated;

-- Supabase Storage: images, videos and user-uploaded Plus stickers.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'forever-media','forever-media',true,26214400,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']
)
on conflict(id) do update set public=true,file_size_limit=26214400,
  allowed_mime_types=excluded.allowed_mime_types;

create or replace function private.can_upload_forever_media()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    private.is_forever_admin()
    or (
      select count(*) < case when private.is_forever_plus() then 10 else 5 end
      from storage.objects o
      where o.bucket_id in ('forever-media','forever-stories')
        and (storage.foldername(o.name))[1] = auth.uid()::text
        and (storage.foldername(o.name))[2] in ('posts','stories')
        and o.created_at >= date_trunc('day', now())
    )
  );
$$;
revoke all on function private.can_upload_forever_media() from public, anon;
grant execute on function private.can_upload_forever_media() to authenticated;

drop policy if exists forever_media_public_read on storage.objects;
create policy forever_media_public_read on storage.objects
for select using (bucket_id='forever-media');

drop policy if exists forever_media_owner_insert on storage.objects;
create policy forever_media_owner_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='forever-media'
  and (storage.foldername(name))[1]=auth.uid()::text
  and (storage.foldername(name))[2] <> 'stories'
  and (
    (storage.foldername(name))[2] not in ('posts','stories')
    or private.can_upload_forever_media()
  )
);

drop policy if exists forever_media_owner_update on storage.objects;
create policy forever_media_owner_update on storage.objects
for update to authenticated
using (bucket_id='forever-media' and (storage.foldername(name))[1]=auth.uid()::text)
with check (
  bucket_id='forever-media'
  and (storage.foldername(name))[1]=auth.uid()::text
  and (storage.foldername(name))[2] <> 'stories'
  and (
    (storage.foldername(name))[2] not in ('posts','stories')
    or private.can_upload_forever_media()
  )
);

drop policy if exists forever_media_owner_delete on storage.objects;
create policy forever_media_owner_delete on storage.objects
for delete to authenticated
using (
  bucket_id='forever-media'
  and ((storage.foldername(name))[1]=auth.uid()::text or private.is_forever_admin())
);

-- Private story media: only the owner and accounts following them may create signed URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'forever-stories','forever-stories',false,26214400,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']
)
on conflict(id) do update set public=false,file_size_limit=26214400,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists forever_stories_owner_insert on storage.objects;
create policy forever_stories_owner_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='forever-stories'
  and (storage.foldername(name))[1]=auth.uid()::text
  and (storage.foldername(name))[2]='stories'
  and private.can_upload_forever_media()
);

drop policy if exists forever_stories_followers_read on storage.objects;
create policy forever_stories_followers_read on storage.objects
for select to authenticated
using (
  bucket_id='forever-stories'
  and private.can_view_forever_story((storage.foldername(name))[1])
);

drop policy if exists forever_stories_owner_update on storage.objects;
create policy forever_stories_owner_update on storage.objects
for update to authenticated
using (
  bucket_id='forever-stories'
  and (storage.foldername(name))[1]=auth.uid()::text
)
with check (
  bucket_id='forever-stories'
  and (storage.foldername(name))[1]=auth.uid()::text
  and private.can_upload_forever_media()
);

drop policy if exists forever_stories_owner_delete on storage.objects;
create policy forever_stories_owner_delete on storage.objects
for delete to authenticated
using (
  bucket_id='forever-stories'
  and ((storage.foldername(name))[1]=auth.uid()::text or private.is_forever_admin())
);

-- Enable realtime for the document adapter.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='forever_documents'
  ) then
    alter publication supabase_realtime add table public.forever_documents;
  end if;
exception when undefined_object then
  raise notice 'supabase_realtime publication is unavailable; enable Realtime in Supabase first.';
end $$;

-- Admin setup (run after replacing the address with the administrator Google email):
-- insert into public.forever_admins(email) values ('admin@example.com')
-- on conflict(email) do nothing;


-- Public invoker wrappers preserve the existing app RPC names.
-- Their privileged implementations remain private and verify the caller.
drop function if exists public.is_forever_admin();
drop function if exists public.is_forever_plus();
drop function if exists public.is_forever_room_member(text);
drop function if exists public.can_view_forever_story(text);
drop function if exists public.register_forever_profile(text,text,text,date,boolean,boolean);
drop function if exists public.grant_forever_plus(text);
drop function if exists public.revoke_forever_plus(text);
drop function if exists public.enforce_forever_limits();
drop function if exists public.can_upload_forever_media();

create or replace function public.is_forever_admin()
returns boolean language sql stable security invoker
set search_path = ''
as $forever$ select private.is_forever_admin(); $forever$;

create or replace function public.is_forever_plus()
returns boolean language sql stable security invoker
set search_path = ''
as $forever$ select private.is_forever_plus(); $forever$;

create or replace function public.is_forever_room_member(p_room_id text)
returns boolean language sql stable security invoker
set search_path = ''
as $forever$ select private.is_forever_room_member(p_room_id); $forever$;

create or replace function public.can_view_forever_story(p_author_id text)
returns boolean language sql stable security invoker
set search_path = ''
as $forever$ select private.can_view_forever_story(p_author_id); $forever$;

create or replace function public.register_forever_profile(
  p_username text,
  p_first_name text,
  p_last_name text,
  p_birth_date date,
  p_kvkk_notice_accepted boolean,
  p_terms_accepted boolean
)
returns jsonb language sql security invoker
set search_path = ''
as $forever$ select private.register_forever_profile(
  p_username,p_first_name,p_last_name,p_birth_date,
  p_kvkk_notice_accepted,p_terms_accepted
); $forever$;

create or replace function public.grant_forever_plus(p_username text)
returns jsonb language sql security invoker
set search_path = ''
as $forever$ select private.grant_forever_plus(p_username); $forever$;

create or replace function public.revoke_forever_plus(p_username text)
returns jsonb language sql security invoker
set search_path = ''
as $forever$ select private.revoke_forever_plus(p_username); $forever$;

create or replace function public.can_upload_forever_media()
returns boolean language sql stable security invoker
set search_path = ''
as $forever$ select private.can_upload_forever_media(); $forever$;

revoke all on function public.is_forever_admin() from public, anon;
revoke all on function public.is_forever_plus() from public, anon;
revoke all on function public.is_forever_room_member(text) from public, anon;
revoke all on function public.can_view_forever_story(text) from public, anon;
revoke all on function public.register_forever_profile(text,text,text,date,boolean,boolean) from public, anon;
revoke all on function public.grant_forever_plus(text) from public, anon;
revoke all on function public.revoke_forever_plus(text) from public, anon;
revoke all on function public.can_upload_forever_media() from public, anon;
grant execute on function public.is_forever_admin() to authenticated;
grant execute on function public.is_forever_plus() to authenticated;
grant execute on function public.is_forever_room_member(text) to authenticated;
grant execute on function public.can_view_forever_story(text) to authenticated;
grant execute on function public.register_forever_profile(text,text,text,date,boolean,boolean) to authenticated;
grant execute on function public.grant_forever_plus(text) to authenticated;
grant execute on function public.revoke_forever_plus(text) to authenticated;
grant execute on function public.can_upload_forever_media() to authenticated;

-- IP addresses are personal data. Keep them only for a documented, limited purpose;
-- define a retention schedule with your privacy notice and delete expired records periodically.
