-- FOREVER: Supabase schema + access control
-- Run this entire file in Supabase SQL Editor. Firebase is not used.
create extension if not exists pgcrypto;

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

alter table public.forever_admins enable row level security;
alter table public.forever_plus_members enable row level security;
alter table public.forever_private_user_data enable row level security;
alter table public.forever_documents enable row level security;

create or replace function public.is_forever_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.forever_admins a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.is_forever_plus()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.forever_plus_members p where p.user_id = auth.uid()
  );
$$;

create or replace function public.is_forever_room_member(p_room_id text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.forever_documents m
    where m.collection_name = 'room_members'
      and m.data ->> 'roomId' = p_room_id
      and m.data ->> 'userId' = auth.uid()::text
  );
$$;

grant execute on function public.is_forever_admin() to authenticated;
grant execute on function public.is_forever_plus() to authenticated;
grant execute on function public.is_forever_room_member(text) to authenticated;

drop policy if exists forever_documents_select on public.forever_documents;
create policy forever_documents_select on public.forever_documents
for select to authenticated
using (
  public.is_forever_admin()
  or owner_id = auth.uid()
  or collection_name in ('users','usernames','posts','stories','rooms','stickers')
  or (collection_name = 'notifications' and data ->> 'toUid' = auth.uid()::text)
  or (collection_name = 'reports' and data ->> 'reporterId' = auth.uid()::text)
  or (collection_name = 'room_members' and public.is_forever_room_member(data ->> 'roomId'))
  or (collection_name = 'room_messages' and public.is_forever_room_member(data ->> 'roomId'))
  or (collection_name = 'blocks' and (
    data ->> 'blockerId' = auth.uid()::text or data ->> 'blockedId' = auth.uid()::text
  ))
  or (collection_name = 'room_bans' and public.is_forever_admin())
);

drop policy if exists forever_documents_insert on public.forever_documents;
create policy forever_documents_insert on public.forever_documents
for insert to authenticated
with check (
  public.is_forever_admin()
  or (
    owner_id = auth.uid()
    and collection_name in (
      'posts','stories','comments','notifications',
      'reports','blocks','rooms','room_members','room_messages','stickers'
    )
    and (collection_name <> 'room_members' or data ->> 'userId' = auth.uid()::text)
    and (collection_name <> 'reports' or data ->> 'reporterId' = auth.uid()::text)
  )
);

drop policy if exists forever_documents_update on public.forever_documents;
create policy forever_documents_update on public.forever_documents
for update to authenticated
using (
  public.is_forever_admin()
  or (owner_id = auth.uid() and collection_name not in ('room_members','usernames','room_bans','modlogs'))
  or collection_name in ('posts','users')
  or (collection_name = 'notifications' and data ->> 'toUid' = auth.uid()::text)
  or (collection_name = 'room_messages' and public.is_forever_plus() and public.is_forever_room_member(data ->> 'roomId'))
)
with check (
  public.is_forever_admin()
  or (owner_id = auth.uid() and collection_name not in ('room_members','usernames','room_bans','modlogs'))
  or collection_name in ('posts','users')
  or (collection_name = 'notifications' and data ->> 'toUid' = auth.uid()::text)
  or (collection_name = 'room_messages' and public.is_forever_plus() and public.is_forever_room_member(data ->> 'roomId'))
);

drop policy if exists forever_documents_delete on public.forever_documents;
create policy forever_documents_delete on public.forever_documents
for delete to authenticated
using (
  public.is_forever_admin()
  or (owner_id = auth.uid() and collection_name not in ('users','usernames','room_bans','modlogs'))
);

drop policy if exists forever_private_user_data_select on public.forever_private_user_data;
create policy forever_private_user_data_select on public.forever_private_user_data
for select to authenticated
using (user_id = auth.uid() or public.is_forever_admin());

drop policy if exists forever_admins_no_client_access on public.forever_admins;
create policy forever_admins_no_client_access on public.forever_admins
for all to authenticated using (false) with check (false);

drop policy if exists forever_plus_members_no_client_access on public.forever_plus_members;
create policy forever_plus_members_no_client_access on public.forever_plus_members
for all to authenticated using (false) with check (false);

create or replace function public.register_forever_profile(
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
set search_path = public, auth
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
grant execute on function public.register_forever_profile(text,text,text,date,boolean,boolean) to authenticated;

create or replace function public.grant_forever_plus(p_username text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_uid uuid;
begin
  if not public.is_forever_admin() then raise exception 'Bu işlem yalnızca yöneticilere açıktır.'; end if;
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
grant execute on function public.grant_forever_plus(text) to authenticated;

create or replace function public.revoke_forever_plus(p_username text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_uid uuid;
begin
  if not public.is_forever_admin() then raise exception 'Bu işlem yalnızca yöneticilere açıktır.'; end if;
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
grant execute on function public.revoke_forever_plus(text) to authenticated;

create or replace function public.enforce_forever_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_plus boolean := public.is_forever_plus();
  v_count integer;
  v_room_id text;
  v_user_id text;
  v_username text;
  v_new_media boolean := false;
begin
  if not public.is_forever_admin() and tg_op in ('INSERT','UPDATE') then
    if new.collection_name='users' then
      new.data := new.data - 'email' - 'firstName' - 'lastName' - 'birthDate' - 'dateOfBirth'
        - 'ipAddress' - 'ip_address' - 'kvkkAcceptedAt' - 'termsAcceptedAt';
    elsif new.collection_name in ('posts','stories','room_messages','comments') then
      new.data := new.data - 'email' - 'authorEmail';
    end if;
  end if;

  if tg_op='INSERT' and not public.is_forever_admin() then
    if new.collection_name in ('posts','stories','room_messages') then
      if new.data ->> 'userId' is distinct from auth.uid()::text then
        raise exception 'İçerik yalnızca kendi hesabın adına oluşturulabilir.';
      end if;
      select data ->> 'username' into v_username
      from public.forever_documents
      where collection_name='users' and id=auth.uid()::text
      limit 1;
      if v_username is null then
        raise exception 'Önce Forever profilini tamamlamalısın.';
      end if;
      if new.collection_name='room_messages'
         and new.data ->> 'username' is distinct from v_username then
        raise exception 'Oda mesajı kullanıcı adı profilinle eşleşmiyor.';
      elsif new.collection_name in ('posts','stories')
         and (
           new.data ->> 'authorUsername' is distinct from v_username
           or new.data ->> 'authorName' is distinct from v_username
         ) then
        raise exception 'Gönderi kullanıcı adı profilinle eşleşmiyor.';
      end if;
    elsif new.collection_name='blocks' and new.data ->> 'blockerId' is distinct from auth.uid()::text then
      raise exception 'Engelleme işlemi yalnızca kendi hesabın adına yapılabilir.';
    elsif new.collection_name='notifications' and new.data ->> 'fromUid' is distinct from auth.uid()::text then
      raise exception 'Bildirim yalnızca kendi hesabın adına gönderilebilir.';
    end if;

    if new.collection_name='users' then
      if new.id is distinct from auth.uid()::text
         or new.owner_id is distinct from auth.uid()
         or new.data ->> 'uid' is distinct from auth.uid()::text
         or coalesce(new.data ->> 'isPlus','false') <> 'false' then
        raise exception 'Kullanıcı profili yalnızca güvenli kayıt işlemiyle oluşturulabilir.';
      end if;
    elsif new.collection_name='usernames' then
      if new.owner_id is distinct from auth.uid()
         or new.data ->> 'uid' is distinct from auth.uid()::text
         or lower(coalesce(new.data ->> 'username','')) is distinct from lower(new.id) then
        raise exception 'Kullanıcı adı yalnızca hesabına ait güvenli kayıt işlemiyle ayrılabilir.';
      end if;
    end if;
  end if;

  if tg_op='UPDATE' and not public.is_forever_admin() then
    if new.collection_name is distinct from old.collection_name
       or new.id is distinct from old.id
       or new.owner_id is distinct from old.owner_id then
      raise exception 'Kayıt kimliği ve sahibi değiştirilemez.';
    end if;
  end if;

  if not public.is_forever_admin() then
    if new.collection_name='usernames' and tg_op='UPDATE' then
      raise exception 'Kayıtlı kullanıcı adı eşlemesi değiştirilemez.';
    end if;
    if new.collection_name='users' and tg_op='UPDATE' then
      if (new.data ->> 'username') is distinct from (old.data ->> 'username')
         or (new.data ->> 'uid') is distinct from (old.data ->> 'uid') then
        raise exception 'Kullanıcı adı ve hesap kimliği değiştirilemez.';
      end if;
      if old.owner_id = auth.uid()
         and (new.data -> 'followers') is distinct from (old.data -> 'followers') then
        raise exception 'Takipçi listen yalnızca takip işlemleriyle güncellenebilir.';
      end if;
      if old.owner_id is distinct from auth.uid() then
        if (new.data - 'followers') is distinct from (old.data - 'followers') then
          raise exception 'Başka kullanıcıların profilinde yalnızca takipçi listen güncellenebilir.';
        end if;
        if exists (
          select 1 from jsonb_array_elements_text(coalesce(old.data -> 'followers','[]'::jsonb)) old_follower(value)
          where not (coalesce(new.data -> 'followers','[]'::jsonb) @> jsonb_build_array(old_follower.value))
             and old_follower.value <> auth.uid()::text
        ) or exists (
          select 1 from jsonb_array_elements_text(coalesce(new.data -> 'followers','[]'::jsonb)) new_follower(value)
          where not (coalesce(old.data -> 'followers','[]'::jsonb) @> jsonb_build_array(new_follower.value))
             and new_follower.value <> auth.uid()::text
        ) then
          raise exception 'Yalnızca kendi takip ilişkini değiştirebilirsin.';
        end if;
      end if;
      if (new.data ->> 'isPlus') is distinct from (old.data ->> 'isPlus') then
        new.data := jsonb_set(new.data,'{isPlus}',coalesce(old.data -> 'isPlus','false'::jsonb),true);
      end if;
      foreach v_room_id in array array['suspended','banned','warnCount','restrictedUntil','suspendedReason','suspendedMessage'] loop
        if (new.data -> v_room_id) is distinct from (old.data -> v_room_id) then
          if old.data ? v_room_id then
            new.data := jsonb_set(new.data,array[v_room_id],old.data -> v_room_id,true);
          else
            new.data := new.data - v_room_id;
          end if;
        end if;
      end loop;
    end if;

    if tg_op='UPDATE' and new.collection_name in ('posts','stories','room_messages') then
      if (new.data ->> 'userId') is distinct from (old.data ->> 'userId')
         or (new.data ->> 'authorUsername') is distinct from (old.data ->> 'authorUsername')
         or (new.data ->> 'authorName') is distinct from (old.data ->> 'authorName')
         or (new.data ->> 'username') is distinct from (old.data ->> 'username')
         or (new.data ->> 'roomId') is distinct from (old.data ->> 'roomId') then
        raise exception 'İçeriğin sahibi ve oda kimliği değiştirilemez.';
      end if;
    end if;

    if new.collection_name='posts' and tg_op='UPDATE'
       and old.owner_id = auth.uid()
       and (new.data ->> 'imageUrl') is null
       and not v_is_plus then
      raise exception 'Sadece metin gönderisi paylaşımı Plus özelliğidir.';
    end if;

    if new.collection_name='posts' and tg_op='UPDATE' and old.owner_id is distinct from auth.uid() then
      if (new.data - 'likes' - 'comments' - 'sparks' - 'poll') is distinct from (old.data - 'likes' - 'comments' - 'sparks' - 'poll') then
        raise exception 'Başkasının gönderi metnini veya medyasını değiştiremezsin.';
      end if;
      if exists (
        select 1 from jsonb_array_elements_text(coalesce(old.data -> 'likes','[]'::jsonb)) old_like(value)
        where not (coalesce(new.data -> 'likes','[]'::jsonb) @> jsonb_build_array(old_like.value))
           and old_like.value <> auth.uid()::text
      ) or exists (
        select 1 from jsonb_array_elements_text(coalesce(new.data -> 'likes','[]'::jsonb)) new_like(value)
        where not (coalesce(old.data -> 'likes','[]'::jsonb) @> jsonb_build_array(new_like.value))
           and new_like.value <> auth.uid()::text
      ) then
        raise exception 'Yalnızca kendi beğenini ekleyebilir veya kaldırabilirsin.';
      end if;
      if exists (
        select 1 from jsonb_array_elements(coalesce(old.data -> 'comments','[]'::jsonb)) old_comment(value)
        where not (coalesce(new.data -> 'comments','[]'::jsonb) @> jsonb_build_array(old_comment.value))
      ) or exists (
        select 1 from jsonb_array_elements(coalesce(new.data -> 'comments','[]'::jsonb)) new_comment(value)
        where not (coalesce(old.data -> 'comments','[]'::jsonb) @> jsonb_build_array(new_comment.value))
          and (new_comment.value ->> 'userId') is distinct from auth.uid()::text
      ) then
        raise exception 'Yorumları düzenleyemez veya başkasının adına yorum ekleyemezsin.';
      end if;
      if (new.data -> 'poll' - 'counts' - 'voters') is distinct from (old.data -> 'poll' - 'counts' - 'voters') then
        raise exception 'Anket sorusunu veya seçeneklerini değiştiremezsin.';
      end if;
    end if;

    if new.collection_name='room_messages' and tg_op='UPDATE' and old.owner_id is distinct from auth.uid() then
      if (new.data - 'pinned') is distinct from (old.data - 'pinned') then
        raise exception 'Başkasının oda mesajı içeriğini değiştiremezsin.';
      end if;
    end if;
  end if;

  if new.collection_name='posts' and tg_op='INSERT'
     and (new.data ->> 'imageUrl') is null
     and not v_is_plus and not public.is_forever_admin() then
    raise exception 'Yalnızca Plus üyeleri sadece metin gönderisi paylaşabilir.';
  end if;

  if new.collection_name in ('posts','stories') then
    if tg_op='INSERT' then
      v_new_media := (new.data ->> 'imageUrl') is not null;
    else
      v_new_media := (new.data ->> 'imageUrl') is not null
        and (new.data ->> 'imageUrl') is distinct from (old.data ->> 'imageUrl');
    end if;
    if v_new_media then
      select count(*) into v_count
      from public.forever_documents d
      where d.collection_name in ('posts','stories') and d.owner_id=new.owner_id
        and d.created_at >= date_trunc('day', now())
        and (tg_op <> 'UPDATE' or d.collection_name <> new.collection_name or d.id <> new.id);
      if v_count >= case when v_is_plus then 10 else 5 end and not public.is_forever_admin() then
        raise exception 'Günlük toplam medya yükleme sınırına ulaştın.';
      end if;
    end if;
  end if;

  if new.collection_name='room_members' and tg_op='INSERT' then
    v_user_id := new.data ->> 'userId';
    v_room_id := new.data ->> 'roomId';
    if v_user_id is distinct from auth.uid()::text and not public.is_forever_admin() then
      raise exception 'Yalnızca kendi hesabını odaya ekleyebilirsin.';
    end if;
    if exists (
      select 1 from public.forever_documents b
      where b.collection_name='room_bans'
        and b.data ->> 'roomId'=v_room_id and b.data ->> 'userId'=v_user_id
    ) and not public.is_forever_admin() then
      raise exception 'Bu odaya katılman yönetim tarafından engellenmiş.';
    end if;
    if not v_is_plus and not public.is_forever_admin() then
      select count(*) into v_count
      from public.forever_documents d
      where d.collection_name='room_members' and d.data ->> 'userId'=v_user_id;
      if v_count >= 3 then raise exception 'Ücretsiz üyeler en fazla 3 odaya katılabilir. Plus ile sınırı kaldır.'; end if;
    end if;
  end if;

  if new.collection_name='room_messages' then
    v_room_id := new.data ->> 'roomId';
    if not public.is_forever_admin() and not public.is_forever_room_member(v_room_id) then
      raise exception 'Bu odanın üyesi değilsin.';
    end if;
    if (
      coalesce(new.data ->> 'kind','') in ('sticker','drawing','custom_sticker')
      or coalesce(new.data ->> 'stickerUrl','') <> ''
      or coalesce(new.data ->> 'drawingData','') <> ''
    ) and not v_is_plus and not public.is_forever_admin() then
      raise exception 'Animasyonlu çıkartmalar ve oda çizimi Plus üyeliği gerektirir.';
    end if;
    if tg_op='UPDATE' and coalesce((new.data ->> 'pinned')::boolean,false)
       and not coalesce((old.data ->> 'pinned')::boolean,false)
       and not v_is_plus and not public.is_forever_admin() then
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
for each row execute function public.enforce_forever_limits();

-- Supabase Storage: images, videos and user-uploaded Plus stickers.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'forever-media','forever-media',true,26214400,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']
)
on conflict(id) do update set public=true,file_size_limit=26214400,
  allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.can_upload_forever_media()
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $
  select auth.uid() is not null and (
    public.is_forever_admin()
    or (
      select count(*) < case when public.is_forever_plus() then 10 else 5 end
      from storage.objects o
      where o.bucket_id = 'forever-media'
        and (storage.foldername(o.name))[1] = auth.uid()::text
        and (storage.foldername(o.name))[2] in ('posts','stories')
        and o.created_at >= date_trunc('day', now())
    )
  );
$;
grant execute on function public.can_upload_forever_media() to authenticated;

drop policy if exists forever_media_public_read on storage.objects;
create policy forever_media_public_read on storage.objects
for select using (bucket_id='forever-media');

drop policy if exists forever_media_owner_insert on storage.objects;
create policy forever_media_owner_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='forever-media'
  and (storage.foldername(name))[1]=auth.uid()::text
  and (
    (storage.foldername(name))[2] not in ('posts','stories')
    or public.can_upload_forever_media()
  )
);

drop policy if exists forever_media_owner_update on storage.objects;
create policy forever_media_owner_update on storage.objects
for update to authenticated
using (bucket_id='forever-media' and (storage.foldername(name))[1]=auth.uid()::text)
with check (bucket_id='forever-media' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists forever_media_owner_delete on storage.objects;
create policy forever_media_owner_delete on storage.objects
for delete to authenticated
using (
  bucket_id='forever-media'
  and ((storage.foldername(name))[1]=auth.uid()::text or public.is_forever_admin())
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

-- IP addresses are personal data. Keep them only for a documented, limited purpose;
-- define a retention schedule with your privacy notice and delete expired records periodically.
