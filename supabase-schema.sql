-- FOREVER + AURA X -> SUPABASE
-- Run once in Supabase Dashboard > SQL Editor.
-- This migration creates the database model, RLS, Plus workflows and storage buckets.
-- IMPORTANT: never add a service_role key to frontend code.

begin;

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- Public profile data only. Email and date of birth are deliberately kept out of this table.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  onboarding_complete boolean not null default false,
  display_name text not null default '',
  avatar_url text,
  bio text not null default '',
  region text not null default '',
  plus_member boolean not null default false,
  plus_granted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (char_length(username) between 3 and 24 and username = lower(username) and username !~ '[^a-z0-9_]'),
  constraint profiles_bio_length check (char_length(bio) <= 240)
);

alter table public.profiles add column if not exists onboarding_complete boolean not null default false;

create table if not exists public.private_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  date_of_birth date,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','moderator')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table if not exists public.account_restrictions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  suspended boolean not null default false,
  banned boolean not null default false,
  restricted_until timestamptz,
  reason text,
  message text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Helper functions are in a non-exposed schema. They run with a fixed search_path.
create or replace function private.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = (select auth.uid()) and r.role = 'admin'
  );
$$;

create or replace function private.is_moderator()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = (select auth.uid()) and r.role in ('admin','moderator')
  );
$$;

create or replace function private.is_plus(p_user_id uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select p.plus_member from public.profiles p where p.id = p_user_id), false);
$$;

create or replace function private.is_blocked(p_user_id uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select a.banned or a.suspended or (a.restricted_until is not null and a.restricted_until > now())
    from public.account_restrictions a where a.user_id = p_user_id
  ), false);
$$;

create or replace function private.is_room_member(p_room_id uuid, p_user_id uuid default auth.uid())
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  return exists (
    select 1 from public.room_members m
    where m.room_id = p_room_id and m.user_id = p_user_id
  );
end;
$$;

create or replace function private.is_conversation_member(p_conversation_id uuid, p_user_id uuid default auth.uid())
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  return exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation_id and m.user_id = p_user_id
  );
end;
$$;

grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_moderator() to authenticated;
grant execute on function private.is_plus(uuid) to authenticated;
grant execute on function private.is_blocked(uuid) to authenticated;
grant execute on function private.is_room_member(uuid,uuid) to authenticated;
grant execute on function private.is_conversation_member(uuid,uuid) to authenticated;

-- Create a public profile automatically whenever Supabase Auth creates a user.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  generated_username text;
  desired_name text;
begin
  generated_username := 'member_' || replace(left(new.id::text, 12), '-', '');
  desired_name := coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', '');
  insert into public.profiles(id, username, display_name)
  values (new.id, generated_username, left(desired_name, 80))
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_forever on auth.users;
create trigger on_auth_user_created_forever
after insert on auth.users
for each row execute procedure private.handle_new_auth_user();

-- Prevent users from making themselves Plus or changing moderation-managed fields.
create or replace function private.guard_profile_privileged_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    if new.plus_member is distinct from old.plus_member
       or new.plus_granted_at is distinct from old.plus_granted_at then
      raise exception 'Plus üyeliği yalnızca yönetim tarafından değiştirilebilir.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists guard_profile_privileged_fields on public.profiles;
create trigger guard_profile_privileged_fields
before update on public.profiles
for each row execute procedure private.guard_profile_privileged_fields();

-- Social graph.
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows(following_id);

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_no_self check (blocker_id <> blocked_id)
);

-- Feed, reactions and comments.
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null default '',
  content text not null default '',
  media_path text,
  media_url text,
  media_type text check (media_type in ('image','video') or media_type is null),
  tags text[] not null default '{}',
  poll jsonb,
  sparks integer not null default 0 check (sparks >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_content_length check (char_length(content) <= 2000)
);
create index if not exists posts_created_at_idx on public.posts(created_at desc);
create index if not exists posts_user_created_idx on public.posts(user_id, created_at desc);
create index if not exists posts_tags_gin_idx on public.posts using gin(tags);

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null default '',
  content text not null,
  created_at timestamptz not null default now(),
  constraint comments_length check (char_length(content) between 1 and 500)
);
create index if not exists post_comments_post_created_idx on public.post_comments(post_id, created_at);

create table if not exists public.saved_posts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

-- Stories are visible only to their owner and their followers.
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_path text not null,
  media_url text,
  media_type text not null check (media_type in ('image','video')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index if not exists stories_user_expiry_idx on public.stories(user_id, expires_at desc);

-- Reports and in-app notifications.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  content_type text not null check (content_type in ('post','story','user','room','message')),
  target_id text not null,
  reason text not null,
  status text not null default 'open' check (status in ('open','reviewing','resolved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint report_reason_length check (char_length(reason) between 1 and 500)
);
create index if not exists reports_status_created_idx on public.reports(status, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null,
  body text not null default '',
  target_type text,
  target_id text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_created_idx on public.notifications(user_id, created_at desc);

-- Rooms, memberships and messages. Limits are enforced in database functions, not in browser code.
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text not null default '',
  visibility text not null default 'public' check (visibility in ('public','private')),
  created_at timestamptz not null default now(),
  constraint room_name_length check (char_length(name) between 3 and 40),
  constraint room_description_length check (char_length(description) <= 160)
);
create index if not exists rooms_created_idx on public.rooms(created_at desc);
create index if not exists rooms_owner_idx on public.rooms(owner_id, created_at desc);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists room_members_user_idx on public.room_members(user_id, room_id);

create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_name text not null default '',
  content text not null default '',
  media_path text,
  media_type text check (media_type in ('image','video') or media_type is null),
  created_at timestamptz not null default now(),
  constraint room_message_length check (char_length(content) <= 1000)
);
create index if not exists room_messages_room_created_idx on public.room_messages(room_id, created_at desc);

create or replace function public.create_room(p_name text, p_description text default '')
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid;
  v_count integer;
  v_max integer;
begin
  if v_uid is null then raise exception 'Giriş gerekli.'; end if;
  if private.is_blocked(v_uid) then raise exception 'Hesabın oda oluşturamaz.'; end if;
  v_max := case when private.is_plus(v_uid) then 6 else 3 end;
  select count(*) into v_count from public.rooms where owner_id = v_uid;
  if v_count >= v_max then raise exception 'Oda oluşturma sınırına ulaştın (%).', v_max; end if;
  if char_length(trim(p_name)) not between 3 and 40 then raise exception 'Oda adı 3-40 karakter olmalı.'; end if;
  insert into public.rooms(owner_id, name, description)
  values (v_uid, trim(p_name), left(coalesce(p_description,''),160))
  returning id into v_room_id;
  insert into public.room_members(room_id,user_id,member_role) values (v_room_id,v_uid,'owner');
  return v_room_id;
end;
$$;

create or replace function public.join_room(p_room_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_visibility text;
  v_count integer;
  v_max integer;
begin
  if v_uid is null then raise exception 'Giriş gerekli.'; end if;
  if private.is_blocked(v_uid) then raise exception 'Hesabın odaya katılamaz.'; end if;
  select owner_id, visibility into v_owner, v_visibility
  from public.rooms where id = p_room_id for update;
  if v_owner is null then raise exception 'Oda bulunamadı.'; end if;
  if v_visibility <> 'public' and not private.is_room_member(p_room_id,v_uid) then raise exception 'Bu oda özel.'; end if;
  if private.is_room_member(p_room_id,v_uid) then return; end if;
  select count(*) into v_count from public.room_members where room_id = p_room_id;
  v_max := case when private.is_plus(v_owner) then 30 else 20 end;
  if v_count >= v_max then raise exception 'Oda dolu (en fazla % kişi).', v_max; end if;
  insert into public.room_members(room_id,user_id,member_role) values (p_room_id,v_uid,'member');
end;
$$;

-- Plus-approved users can open a conversation with a mutual follower; a non-Plus recipient may reply.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (id, created_by)
);
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members(user_id, conversation_id);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  media_path text,
  created_at timestamptz not null default now(),
  constraint direct_message_length check (char_length(content) between 1 and 2000)
);
create index if not exists direct_messages_conversation_created_idx on public.direct_messages(conversation_id, created_at desc);

create or replace function public.create_direct_conversation(p_other_user uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'Giriş gerekli.'; end if;
  if private.is_blocked(v_uid) then raise exception 'Bu işlem hesabına açık değil.'; end if;
  if not private.is_plus(v_uid) then raise exception 'Özel mesaj başlatmak Forever Plus özelliğidir.'; end if;
  if p_other_user = v_uid then raise exception 'Kendinle konuşma başlatamazsın.'; end if;
  if not exists(select 1 from public.follows where follower_id=v_uid and following_id=p_other_user)
     or not exists(select 1 from public.follows where follower_id=p_other_user and following_id=v_uid) then
    raise exception 'Özel mesaj için karşılıklı takip gerekli.';
  end if;
  select c.id into v_id
  from public.conversation_members a
  join public.conversation_members b on b.conversation_id=a.conversation_id
  join public.conversations c on c.id=a.conversation_id
  where a.user_id=v_uid and b.user_id=p_other_user
  limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.conversations(created_by) values(v_uid) returning id into v_id;
  insert into public.conversation_members(conversation_id,user_id)
  values (v_id,v_uid),(v_id,p_other_user);
  return v_id;
end;
$$;

-- Plus stickers and collaborative drawings. A drawing owner may invite at most three guests.
create table if not exists public.stickers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  media_path text not null,
  animated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint sticker_name_length check (char_length(name) between 1 and 40)
);
create table if not exists public.drawings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Yeni çizim',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.drawing_members (
  drawing_id uuid not null references public.drawings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_owner boolean not null default false,
  added_at timestamptz not null default now(),
  primary key (drawing_id,user_id)
);
create index if not exists drawing_members_user_idx on public.drawing_members(user_id,drawing_id);
create or replace function private.is_drawing_member(p_drawing_id uuid, p_user_id uuid default auth.uid())
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  return exists (
    select 1 from public.drawing_members m
    where m.drawing_id = p_drawing_id and m.user_id = p_user_id
  );
end;
$$;
grant execute on function private.is_drawing_member(uuid,uuid) to authenticated;


create table if not exists public.drawing_strokes (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.drawings(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  stroke jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists drawing_strokes_drawing_created_idx on public.drawing_strokes(drawing_id,created_at);

create or replace function public.create_drawing(p_title text default 'Yeni çizim')
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null or private.is_blocked(v_uid) then raise exception 'Giriş gerekli.'; end if;
  if not private.is_plus(v_uid) then raise exception 'Çizim oluşturmak Forever Plus özelliğidir.'; end if;
  insert into public.drawings(owner_id,title) values(v_uid,left(coalesce(p_title,'Yeni çizim'),80)) returning id into v_id;
  insert into public.drawing_members(drawing_id,user_id,is_owner) values(v_id,v_uid,true);
  return v_id;
end;
$$;

create or replace function public.grant_drawing_access(p_drawing_id uuid,p_guest_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_owner uuid; v_guests integer;
begin
  select owner_id into v_owner from public.drawings where id=p_drawing_id;
  if v_owner is null or v_owner <> v_uid then raise exception 'Yalnızca çizimin sahibi davet gönderebilir.'; end if;
  if not private.is_plus(v_uid) then raise exception 'Çizim paylaşma yetkisi Plus üyelerine açık.'; end if;
  if p_guest_id = v_uid then raise exception 'Kendini yeniden ekleyemezsin.'; end if;
  select count(*) into v_guests from public.drawing_members where drawing_id=p_drawing_id and is_owner=false;
  if not exists(select 1 from public.drawing_members where drawing_id=p_drawing_id and user_id=p_guest_id)
     and v_guests >= 3 then raise exception 'Bir çizime en fazla üç misafir ekleyebilirsin.'; end if;
  insert into public.drawing_members(drawing_id,user_id,is_owner)
  values(p_drawing_id,p_guest_id,false)
  on conflict(drawing_id,user_id) do nothing;
end;
$$;

-- Plus applications and admin moderation.
create table if not exists public.plus_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint plus_reason_length check (char_length(reason) <= 500)
);
create unique index if not exists one_pending_plus_application_per_user
  on public.plus_applications(user_id) where status='pending';
create index if not exists plus_applications_status_created_idx on public.plus_applications(status,created_at desc);

create or replace function public.admin_review_plus_application(
  p_application_id uuid,
  p_decision text,
  p_admin_note text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_user_id uuid;
begin
  if not private.is_admin() then raise exception 'Yalnızca yönetici bu işlemi yapabilir.'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Geçersiz karar.'; end if;
  select user_id into v_user_id from public.plus_applications where id=p_application_id for update;
  if v_user_id is null then raise exception 'Başvuru bulunamadı.'; end if;
  update public.plus_applications
    set status=p_decision, admin_note=left(coalesce(p_admin_note,''),500),
        reviewed_by=auth.uid(), reviewed_at=now()
    where id=p_application_id;
  if p_decision='approved' then
    update public.profiles set plus_member=true, plus_granted_at=now() where id=v_user_id;
  end if;
end;
$$;

-- Daily media counters. The Edge Function validates video duration before inserting/updating these rows.
create table if not exists public.daily_media_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  usage_date date not null,
  image_count integer not null default 0 check (image_count >= 0),
  video_seconds integer not null default 0 check (video_seconds between 0 and 180),
  updated_at timestamptz not null default now(),
  primary key(user_id,usage_date)
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  bucket_id text not null check (bucket_id in ('forever-public','forever-private')),
  object_path text not null,
  media_type text not null check (media_type in ('image','video','gif')),
  bytes bigint not null check (bytes > 0 and bytes <= 52428800),
  duration_seconds integer,
  visibility text not null default 'public' check (visibility in ('public','followers','private')),
  created_at timestamptz not null default now(),
  unique(bucket_id,object_path),
  constraint media_video_duration check (duration_seconds is null or duration_seconds between 1 and 180)
);
create index if not exists media_assets_owner_created_idx on public.media_assets(owner_id,created_at desc);


-- Atomic daily video quota reservation used only by the trusted video Edge Function.
create or replace function public.reserve_video_upload(p_user_id uuid,p_seconds integer)
returns void
language plpgsql security definer
set search_path = ''
as $
begin
  if p_seconds is null or p_seconds < 1 or p_seconds > 180 then
    raise exception 'Geçersiz video süresi.';
  end if;
  if not private.is_plus(p_user_id) then
    raise exception 'Video yükleme Plus üyelerine açıktır.';
  end if;
  insert into public.daily_media_usage(user_id,usage_date,video_seconds)
  values(p_user_id,(now() at time zone 'UTC')::date,p_seconds)
  on conflict(user_id,usage_date) do update
    set video_seconds=public.daily_media_usage.video_seconds + excluded.video_seconds,
        updated_at=now()
    where public.daily_media_usage.video_seconds + excluded.video_seconds <= 180;
  if not found then raise exception 'Günlük toplam video süresi 3 dakikayı aşamaz.'; end if;
end;
$;

create or replace function public.rollback_video_upload(p_user_id uuid,p_seconds integer)
returns void
language sql security definer
set search_path = ''
as $
  update public.daily_media_usage
  set video_seconds=greatest(0,video_seconds-greatest(p_seconds,0)),updated_at=now()
  where user_id=p_user_id and usage_date=(now() at time zone 'UTC')::date;
$;
revoke all on function public.reserve_video_upload(uuid,integer) from public, anon, authenticated;
revoke all on function public.rollback_video_upload(uuid,integer) from public, anon, authenticated;
grant execute on function public.reserve_video_upload(uuid,integer) to service_role;
grant execute on function public.rollback_video_upload(uuid,integer) to service_role;

-- Privacy-safe audit: store encrypted IP and a one-way hash only. The Edge Function supplies both.
create table if not exists public.security_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  ip_hash text,
  encrypted_ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists security_events_created_idx on public.security_events(created_at desc);
create index if not exists security_events_user_created_idx on public.security_events(user_id,created_at desc);

create table if not exists public.admin_activity_logs (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_activity_logs_created_idx on public.admin_activity_logs(created_at desc);

-- RLS helper for storage uploads (only images can use direct browser uploads).
create or replace function private.can_upload_public_image(p_object_name text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_date text := to_char(now() at time zone 'UTC','YYYY-MM-DD'); v_count integer;
begin
  if v_uid is null or private.is_blocked(v_uid) then return false; end if;
  if split_part(p_object_name,'/',1) <> v_uid::text or split_part(p_object_name,'/',2) <> v_date then return false; end if;
  if private.is_plus(v_uid) then return true; end if;
  select count(*) into v_count from storage.objects o
    where o.bucket_id='forever-public'
      and split_part(o.name,'/',1)=v_uid::text
      and split_part(o.name,'/',2)=v_date
      and coalesce(o.metadata->>'mimetype','') like 'image/%';
  return v_count < 5;
end;
$$;
grant execute on function private.can_upload_public_image(text) to authenticated;

-- Story media is private; the storage policy allows only the owner or their followers to read it.
create or replace function private.can_read_private_media(p_object_name text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select
    split_part(p_object_name,'/',1) = (select auth.uid())::text
    or (
      split_part(p_object_name,'/',3) = 'stories'
      and exists (
        select 1 from public.follows f
        where f.follower_id=(select auth.uid())
          and f.following_id=split_part(p_object_name,'/',1)::uuid
      )
    )
    or (
      exists (
        select 1 from public.conversation_members a
        join public.conversation_members b on b.conversation_id=a.conversation_id
        where a.user_id=(select auth.uid())
          and b.user_id=split_part(p_object_name,'/',1)::uuid
      )
    );
$$;
grant execute on function private.can_read_private_media(text) to authenticated;

-- Enable Row Level Security on every exposed table.
alter table public.profiles enable row level security;
alter table public.private_profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.account_restrictions enable row level security;
alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;
alter table public.saved_posts enable row level security;
alter table public.stories enable row level security;
alter table public.reports enable row level security;
alter table public.notifications enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_messages enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.direct_messages enable row level security;
alter table public.stickers enable row level security;
alter table public.drawings enable row level security;
alter table public.drawing_members enable row level security;
alter table public.drawing_strokes enable row level security;
alter table public.plus_applications enable row level security;
alter table public.daily_media_usage enable row level security;
alter table public.media_assets enable row level security;
alter table public.security_events enable row level security;
alter table public.admin_activity_logs enable row level security;

-- Profiles are public presentation data; personal email and birth date are not stored here.
drop policy if exists profiles_public_read on public.profiles;
create policy profiles_public_read on public.profiles for select to anon,authenticated using (true);
drop policy if exists profiles_owner_insert on public.profiles;
create policy profiles_owner_insert on public.profiles for insert to authenticated with check (id=(select auth.uid()));
drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update on public.profiles for update to authenticated
using (id=(select auth.uid()) or private.is_admin())
with check (id=(select auth.uid()) or private.is_admin());

drop policy if exists private_profiles_owner_all on public.private_profiles;
create policy private_profiles_owner_all on public.private_profiles for all to authenticated
using (user_id=(select auth.uid()))
with check (user_id=(select auth.uid()));

drop policy if exists user_roles_read_self_admin on public.user_roles;
create policy user_roles_read_self_admin on public.user_roles for select to authenticated
using (user_id=(select auth.uid()) or private.is_admin());
drop policy if exists user_roles_admin_manage on public.user_roles;
create policy user_roles_admin_manage on public.user_roles for all to authenticated
using (private.is_admin()) with check (private.is_admin());

drop policy if exists account_restrictions_self_admin_read on public.account_restrictions;
create policy account_restrictions_self_admin_read on public.account_restrictions for select to authenticated
using (user_id=(select auth.uid()) or private.is_moderator());
drop policy if exists account_restrictions_admin_manage on public.account_restrictions;
create policy account_restrictions_admin_manage on public.account_restrictions for all to authenticated
using (private.is_moderator()) with check (private.is_moderator());

drop policy if exists follows_public_read on public.follows;
create policy follows_public_read on public.follows for select to anon,authenticated using (true);
drop policy if exists follows_owner_insert on public.follows;
create policy follows_owner_insert on public.follows for insert to authenticated
with check (follower_id=(select auth.uid()) and not private.is_blocked());
drop policy if exists follows_owner_delete on public.follows;
create policy follows_owner_delete on public.follows for delete to authenticated
using (follower_id=(select auth.uid()));

drop policy if exists blocks_owner_read on public.blocks;
create policy blocks_owner_read on public.blocks for select to authenticated using (blocker_id=(select auth.uid()));
drop policy if exists blocks_owner_insert on public.blocks;
create policy blocks_owner_insert on public.blocks for insert to authenticated with check (blocker_id=(select auth.uid()));
drop policy if exists blocks_owner_delete on public.blocks;
create policy blocks_owner_delete on public.blocks for delete to authenticated using (blocker_id=(select auth.uid()));

drop policy if exists posts_public_read on public.posts;
create policy posts_public_read on public.posts for select to anon,authenticated using (true);
drop policy if exists posts_owner_insert on public.posts;
create policy posts_owner_insert on public.posts for insert to authenticated
with check (user_id=(select auth.uid()) and not private.is_blocked());
drop policy if exists posts_owner_update on public.posts;
create policy posts_owner_update on public.posts for update to authenticated
using (user_id=(select auth.uid()) or private.is_moderator())
with check (user_id=(select auth.uid()) or private.is_moderator());
drop policy if exists posts_owner_delete on public.posts;
create policy posts_owner_delete on public.posts for delete to authenticated
using (user_id=(select auth.uid()) or private.is_moderator());

drop policy if exists post_likes_read on public.post_likes;
create policy post_likes_read on public.post_likes for select to anon,authenticated using (true);
drop policy if exists post_likes_owner_insert on public.post_likes;
create policy post_likes_owner_insert on public.post_likes for insert to authenticated
with check (user_id=(select auth.uid()) and not private.is_blocked());
drop policy if exists post_likes_owner_delete on public.post_likes;
create policy post_likes_owner_delete on public.post_likes for delete to authenticated using (user_id=(select auth.uid()));

drop policy if exists comments_read on public.post_comments;
create policy comments_read on public.post_comments for select to anon,authenticated using (true);
drop policy if exists comments_insert on public.post_comments;
create policy comments_insert on public.post_comments for insert to authenticated
with check (user_id=(select auth.uid()) and not private.is_blocked());
drop policy if exists comments_owner_delete on public.post_comments;
create policy comments_owner_delete on public.post_comments for delete to authenticated
using (user_id=(select auth.uid()) or private.is_moderator());

drop policy if exists saves_owner_all on public.saved_posts;
create policy saves_owner_all on public.saved_posts for all to authenticated
using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

drop policy if exists stories_followers_read on public.stories;
create policy stories_followers_read on public.stories for select to authenticated
using (
  user_id=(select auth.uid())
  or exists(select 1 from public.follows f where f.follower_id=(select auth.uid()) and f.following_id=stories.user_id)
);
drop policy if exists stories_owner_insert on public.stories;
create policy stories_owner_insert on public.stories for insert to authenticated
with check (user_id=(select auth.uid()) and not private.is_blocked());
drop policy if exists stories_owner_update on public.stories;
create policy stories_owner_update on public.stories for update to authenticated
using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists stories_owner_delete on public.stories;
create policy stories_owner_delete on public.stories for delete to authenticated using (user_id=(select auth.uid()));

drop policy if exists reports_owner_insert on public.reports;
create policy reports_owner_insert on public.reports for insert to authenticated
with check (reporter_id=(select auth.uid()) and not private.is_blocked());
drop policy if exists reports_admin_read_update on public.reports;
create policy reports_admin_read_update on public.reports for all to authenticated
using (private.is_moderator()) with check (private.is_moderator());

drop policy if exists notifications_owner_read on public.notifications;
create policy notifications_owner_read on public.notifications for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists notifications_owner_update on public.notifications;
create policy notifications_owner_update on public.notifications for update to authenticated
using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists notifications_service_insert on public.notifications;
drop policy if exists notifications_admin_insert on public.notifications;
create policy notifications_admin_insert on public.notifications for insert to authenticated
with check (private.is_admin());

drop policy if exists rooms_public_member_read on public.rooms;
create policy rooms_public_member_read on public.rooms for select to anon,authenticated
using (visibility='public' or private.is_room_member(id));
drop policy if exists rooms_owner_update on public.rooms;
create policy rooms_owner_update on public.rooms for update to authenticated
using (owner_id=(select auth.uid()) or private.is_moderator())
with check (owner_id=(select auth.uid()) or private.is_moderator());
drop policy if exists rooms_owner_delete on public.rooms;
create policy rooms_owner_delete on public.rooms for delete to authenticated
using (owner_id=(select auth.uid()) or private.is_moderator());

drop policy if exists room_members_member_read on public.room_members;
create policy room_members_member_read on public.room_members for select to authenticated
using (private.is_room_member(room_id));
drop policy if exists room_messages_member_read on public.room_messages;
create policy room_messages_member_read on public.room_messages for select to authenticated
using (private.is_room_member(room_id));
drop policy if exists room_messages_member_insert on public.room_messages;
create policy room_messages_member_insert on public.room_messages for insert to authenticated
with check (sender_id=(select auth.uid()) and private.is_room_member(room_id) and not private.is_blocked());
drop policy if exists room_messages_sender_delete on public.room_messages;
create policy room_messages_sender_delete on public.room_messages for delete to authenticated
using (sender_id=(select auth.uid()) or private.is_moderator());

drop policy if exists conversations_member_read on public.conversations;
create policy conversations_member_read on public.conversations for select to authenticated
using (private.is_conversation_member(id));
drop policy if exists conversation_members_member_read on public.conversation_members;
create policy conversation_members_member_read on public.conversation_members for select to authenticated
using (private.is_conversation_member(conversation_id));
drop policy if exists direct_messages_member_read on public.direct_messages;
create policy direct_messages_member_read on public.direct_messages for select to authenticated
using (private.is_conversation_member(conversation_id));
drop policy if exists direct_messages_member_insert on public.direct_messages;
create policy direct_messages_member_insert on public.direct_messages for insert to authenticated
with check (
  sender_id=(select auth.uid())
  and private.is_conversation_member(conversation_id)
  and not private.is_blocked()
  and exists(select 1 from public.conversations c where c.id=conversation_id and (private.is_plus(c.created_by) or private.is_plus(sender_id)))
);

drop policy if exists stickers_public_read on public.stickers;
create policy stickers_public_read on public.stickers for select to anon,authenticated using (true);
drop policy if exists stickers_plus_insert on public.stickers;
create policy stickers_plus_insert on public.stickers for insert to authenticated
with check (owner_id=(select auth.uid()) and private.is_plus() and not private.is_blocked());
drop policy if exists stickers_owner_manage on public.stickers;
create policy stickers_owner_manage on public.stickers for update to authenticated
using (owner_id=(select auth.uid()) or private.is_moderator())
with check (owner_id=(select auth.uid()) or private.is_moderator());
drop policy if exists stickers_owner_delete on public.stickers;
create policy stickers_owner_delete on public.stickers for delete to authenticated
using (owner_id=(select auth.uid()) or private.is_moderator());

drop policy if exists drawings_member_read on public.drawings;
create policy drawings_member_read on public.drawings for select to authenticated
using (private.is_drawing_member(id));
drop policy if exists drawing_members_member_read on public.drawing_members;
create policy drawing_members_member_read on public.drawing_members for select to authenticated
using (private.is_drawing_member(drawing_id));
drop policy if exists drawing_strokes_member_read on public.drawing_strokes;
create policy drawing_strokes_member_read on public.drawing_strokes for select to authenticated
using (private.is_drawing_member(drawing_id));
drop policy if exists drawing_strokes_member_insert on public.drawing_strokes;
create policy drawing_strokes_member_insert on public.drawing_strokes for insert to authenticated
with check (author_id=(select auth.uid()) and not private.is_blocked()
  and private.is_drawing_member(drawing_id));

drop policy if exists plus_apps_owner_insert on public.plus_applications;
create policy plus_apps_owner_insert on public.plus_applications for insert to authenticated
with check (user_id=(select auth.uid()) and status='pending' and not private.is_blocked());
drop policy if exists plus_apps_owner_admin_read on public.plus_applications;
create policy plus_apps_owner_admin_read on public.plus_applications for select to authenticated
using (user_id=(select auth.uid()) or private.is_admin());
drop policy if exists plus_apps_admin_update on public.plus_applications;
create policy plus_apps_admin_update on public.plus_applications for update to authenticated
using (private.is_admin()) with check (private.is_admin());

drop policy if exists media_usage_owner_admin_read on public.daily_media_usage;
create policy media_usage_owner_admin_read on public.daily_media_usage for select to authenticated
using (user_id=(select auth.uid()) or private.is_admin());

drop policy if exists media_assets_owner_read on public.media_assets;
create policy media_assets_owner_read on public.media_assets for select to authenticated
using (owner_id=(select auth.uid()) or private.is_admin());
drop policy if exists media_assets_owner_insert on public.media_assets;
create policy media_assets_owner_insert on public.media_assets for insert to authenticated
with check (owner_id=(select auth.uid()) and not private.is_blocked());
drop policy if exists media_assets_owner_delete on public.media_assets;
create policy media_assets_owner_delete on public.media_assets for delete to authenticated
using (owner_id=(select auth.uid()) or private.is_admin());

drop policy if exists security_events_admin_read on public.security_events;
create policy security_events_admin_read on public.security_events for select to authenticated using (private.is_admin());
drop policy if exists admin_logs_admin_read on public.admin_activity_logs;
create policy admin_logs_admin_read on public.admin_activity_logs for select to authenticated using (private.is_admin());
drop policy if exists admin_logs_admin_insert on public.admin_activity_logs;
create policy admin_logs_admin_insert on public.admin_activity_logs for insert to authenticated
with check (admin_id=(select auth.uid()) and private.is_admin());


-- Notifications are generated by trusted database triggers, never forged by browser clients.
create or replace function private.notify_follow_event()
returns trigger language plpgsql security definer set search_path = ''
as $
begin
  if new.follower_id <> new.following_id then
    insert into public.notifications(user_id,actor_id,kind,body)
    values(new.following_id,new.follower_id,'follow','seni takip etmeye başladı');
  end if;
  return new;
end;
$;
drop trigger if exists notify_follow_event on public.follows;
create trigger notify_follow_event after insert on public.follows
for each row execute procedure private.notify_follow_event();

create or replace function private.notify_like_event()
returns trigger language plpgsql security definer set search_path = ''
as $
declare v_owner uuid;
begin
  select user_id into v_owner from public.posts where id=new.post_id;
  if v_owner is not null and v_owner <> new.user_id then
    insert into public.notifications(user_id,actor_id,kind,body,target_type,target_id)
    values(v_owner,new.user_id,'like','gönderini beğendi','post',new.post_id::text);
  end if;
  return new;
end;
$;
drop trigger if exists notify_like_event on public.post_likes;
create trigger notify_like_event after insert on public.post_likes
for each row execute procedure private.notify_like_event();

create or replace function private.notify_comment_event()
returns trigger language plpgsql security definer set search_path = ''
as $
declare v_owner uuid;
begin
  select user_id into v_owner from public.posts where id=new.post_id;
  if v_owner is not null and v_owner <> new.user_id then
    insert into public.notifications(user_id,actor_id,kind,body,target_type,target_id)
    values(v_owner,new.user_id,'comment','gönderine yorum yaptı','post',new.post_id::text);
  end if;
  return new;
end;
$;
drop trigger if exists notify_comment_event on public.post_comments;
create trigger notify_comment_event after insert on public.post_comments
for each row execute procedure private.notify_comment_event();

create or replace function private.notify_spark_event()
returns trigger language plpgsql security definer set search_path = ''
as $
begin
  if new.sparks > old.sparks then
    insert into public.notifications(user_id,actor_id,kind,body,target_type,target_id)
    values(new.user_id,auth.uid(),'spark','gönderine ışık yaktı ✦','post',new.id::text);
  end if;
  return new;
end;
$;
drop trigger if exists notify_spark_event on public.posts;
create trigger notify_spark_event after update of sparks on public.posts
for each row execute procedure private.notify_spark_event();

create or replace function private.notify_direct_message_event()
returns trigger language plpgsql security definer set search_path = ''
as $
begin
  insert into public.notifications(user_id,actor_id,kind,body,target_type,target_id)
  select m.user_id,new.sender_id,'direct_message','sana özel mesaj gönderdi','conversation',new.conversation_id::text
  from public.conversation_members m
  where m.conversation_id=new.conversation_id and m.user_id<>new.sender_id;
  return new;
end;
$;
drop trigger if exists notify_direct_message_event on public.direct_messages;
create trigger notify_direct_message_event after insert on public.direct_messages
for each row execute procedure private.notify_direct_message_event();

-- Enable Realtime for the tables watched by the app. Safe to re-run.
do $
declare t text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach t in array array['profiles','posts','post_likes','post_comments','stories','follows','blocks',
      'rooms','room_messages','notifications','account_restrictions','direct_messages'] loop
      if not exists(select 1 from pg_publication_tables
                    where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
        execute format('alter publication supabase_realtime add table public.%I',t);
      end if;
    end loop;
  end if;
end;
$;

-- The client receives only the permissions it needs. RLS remains the actual security boundary.
grant select on public.profiles, public.follows, public.posts, public.post_likes, public.post_comments,
  public.rooms, public.stickers to anon, authenticated;
grant select, insert, update, delete on public.profiles, public.private_profiles, public.user_roles,
  public.account_restrictions, public.follows, public.blocks, public.posts, public.post_likes,
  public.post_comments, public.saved_posts, public.stories, public.reports, public.notifications,
  public.rooms, public.room_members, public.room_messages, public.conversations, public.conversation_members,
  public.direct_messages, public.stickers, public.drawings, public.drawing_members, public.drawing_strokes,
  public.plus_applications, public.daily_media_usage, public.media_assets, public.security_events,
  public.admin_activity_logs to authenticated;
grant all on all tables in schema public to service_role;

revoke all on function public.create_room(text,text) from public, anon;
revoke all on function public.join_room(uuid) from public, anon;
revoke all on function public.create_direct_conversation(uuid) from public, anon;
revoke all on function public.create_drawing(text) from public, anon;
revoke all on function public.grant_drawing_access(uuid,uuid) from public, anon;
revoke all on function public.admin_review_plus_application(uuid,text,text) from public, anon;
grant execute on function public.create_room(text,text) to authenticated;
grant execute on function public.join_room(uuid) to authenticated;
grant execute on function public.create_direct_conversation(uuid) to authenticated;
grant execute on function public.create_drawing(text) to authenticated;
grant execute on function public.grant_drawing_access(uuid,uuid) to authenticated;
grant execute on function public.admin_review_plus_application(uuid,text,text) to authenticated;

-- Private buckets for follower-only stories and private media; public content has a separate public bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values
  ('forever-public','forever-public',true,52428800,array['image/jpeg','image/png','image/webp','image/gif','video/mp4']),
  ('forever-private','forever-private',false,52428800,array['image/jpeg','image/png','image/webp','image/gif','video/mp4'])
on conflict (id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists forever_public_read on storage.objects;
create policy forever_public_read on storage.objects for select to anon,authenticated
using (bucket_id='forever-public');
drop policy if exists forever_public_image_insert on storage.objects;
create policy forever_public_image_insert on storage.objects for insert to authenticated
with check (
  bucket_id='forever-public'
  and coalesce(metadata->>'mimetype','') like 'image/%'
  and private.can_upload_public_image(name)
);
drop policy if exists forever_public_owner_delete on storage.objects;
create policy forever_public_owner_delete on storage.objects for delete to authenticated
using (bucket_id='forever-public' and (storage.foldername(name))[1]=(select auth.uid())::text);

drop policy if exists forever_private_read on storage.objects;
create policy forever_private_read on storage.objects for select to authenticated
using (bucket_id='forever-private' and private.can_read_private_media(name));
drop policy if exists forever_private_insert on storage.objects;
create policy forever_private_insert on storage.objects for insert to authenticated
with check (
  bucket_id='forever-private'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and private.can_upload_public_image(name)
  and coalesce(metadata->>'mimetype','') like 'image/%'
);
drop policy if exists forever_private_owner_delete on storage.objects;
create policy forever_private_owner_delete on storage.objects for delete to authenticated
using (bucket_id='forever-private' and (storage.foldername(name))[1]=(select auth.uid())::text);

-- Run this function daily with Supabase Cron to enforce 30-day retention.
create or replace function public.cleanup_security_events()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare v_deleted integer;
begin
  if not private.is_admin() and coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Yetkisiz işlem.';
  end if;
  delete from public.security_events where created_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.cleanup_security_events() from public, anon;
grant execute on function public.cleanup_security_events() to authenticated, service_role;

commit;

-- FIRST ADMIN BOOTSTRAP:
-- 1) Create your own account from the site's normal registration screen.
-- 2) Copy that account's UUID from Authentication > Users.
-- 3) Run the following separately, replacing the UUID:
-- insert into public.user_roles(user_id,role) values ('YOUR-AUTH-USER-UUID','admin')
-- on conflict do nothing;
--
-- VIDEO UPLOAD NOTE:
-- Browser policies intentionally do not allow MP4 uploads. A Supabase Edge Function must
-- verify Plus membership, inspect the actual MP4 duration, enforce the daily 180-second
-- aggregate, then upload with server-side privileges. Never trust a duration sent by a browser.
