-- FOREVER EDUCATION CORE
-- Project: gfuewsdkytfssumxwyxz
-- Created: 2026-11-26
-- RLS-first schema. No student data is readable outside its approved school/class.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.education_schools (
  id uuid primary key default gen_random_uuid(),
  institution_code text not null unique
    check (institution_code ~ '^[0-9]{4,12}$'),
  official_email text generated always as (institution_code || '@meb.k12.tr') stored,
  school_name text not null check (char_length(btrim(school_name)) between 2 and 120),
  region text check (region is null or char_length(region) <= 80),
  status text not null default 'active' check (status in ('active','suspended')),
  verified_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.education_school_members (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.education_schools(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null check (char_length(username) between 3 and 40),
  role text not null check (role in ('school_admin','teacher','student')),
  status text not null default 'pending' check (status in ('pending','active','rejected','revoked')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id,user_id)
);

create table if not exists public.education_classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.education_schools(id) on delete cascade,
  grade_level smallint not null check (grade_level between 1 and 12),
  section text not null check (section ~ '^[A-Z0-9]{1,3}$'),
  name text generated always as (grade_level::text || section) stored,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id,grade_level,section)
);

create table if not exists public.education_teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.education_schools(id) on delete cascade,
  class_id uuid not null references public.education_classes(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  is_class_teacher boolean not null default false,
  is_active boolean not null default true,
  assigned_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (class_id,teacher_id)
);

create unique index if not exists education_one_class_teacher_per_class
  on public.education_teacher_assignments(class_id)
  where is_class_teacher = true and is_active = true;

create table if not exists public.education_teacher_invites (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.education_schools(id) on delete cascade,
  class_id uuid references public.education_classes(id) on delete set null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  target_username text check (target_username is null or char_length(target_username) between 3 and 40),
  status text not null default 'active' check (status in ('active','claimed','revoked','expired')),
  created_by uuid not null references auth.users(id) on delete restrict,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at <= created_at + interval '48 hours')
);

create table if not exists public.education_teacher_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.education_schools(id) on delete cascade,
  invite_id uuid not null references public.education_teacher_invites(id) on delete restrict,
  class_id uuid references public.education_classes(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (invite_id,user_id)
);

create table if not exists public.education_student_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.education_schools(id) on delete cascade,
  class_id uuid not null references public.education_classes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists education_one_pending_student_request
  on public.education_student_requests(school_id,class_id,user_id)
  where status = 'pending';

create table if not exists public.education_class_students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.education_schools(id) on delete cascade,
  class_id uuid not null references public.education_classes(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  added_by uuid not null references auth.users(id) on delete restrict,
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  unique (class_id,student_id)
);

create table if not exists public.education_class_feed (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.education_schools(id) on delete cascade,
  class_id uuid not null references public.education_classes(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.education_class_points (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.education_schools(id) on delete cascade,
  class_id uuid not null references public.education_classes(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete restrict,
  teacher_id uuid not null references auth.users(id) on delete restrict,
  points smallint not null check (points between 1 and 100),
  reason text check (reason is null or char_length(reason) <= 250),
  created_at timestamptz not null default now()
);

create table if not exists public.education_class_board_state (
  class_id uuid primary key references public.education_classes(id) on delete cascade,
  school_id uuid not null references public.education_schools(id) on delete cascade,
  students_can_draw boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.education_board_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.education_schools(id) on delete cascade,
  class_id uuid not null references public.education_classes(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (event_type in ('stroke','clear')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (octet_length(payload::text) <= 24000),
  check (event_type <> 'stroke' or jsonb_typeof(payload -> 'points') = 'array'),
  check (event_type <> 'stroke' or jsonb_array_length(coalesce(payload -> 'points','[]'::jsonb)) between 2 and 250),
  check (event_type <> 'stroke' or (payload ->> 'color') ~ '^#[0-9A-Fa-f]{6}

create table if not exists public.education_class_sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.education_schools(id) on delete cascade,
  class_id uuid not null references public.education_classes(id) on delete cascade,
  opened_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'live' check (status in ('live','closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create unique index if not exists education_one_live_session_per_class
  on public.education_class_sessions(class_id)
  where status = 'live';

-- These are requests, not remote microphone controls. A student always controls
-- their own microphone and must accept any mute/unmute request locally.
create table if not exists public.education_audio_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.education_schools(id) on delete cascade,
  class_id uuid not null references public.education_classes(id) on delete cascade,
  session_id uuid not null references public.education_class_sessions(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('mute','unmute')),
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.education_audit_log (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.education_schools(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 2 and 80),
  target_user_id uuid references auth.users(id) on delete set null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Service-only tables: no browser role has access.
create table if not exists public.education_email_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  institution_code text not null check (institution_code ~ '^[0-9]{4,12}$'),
  official_email text not null,
  code_hmac text not null check (code_hmac ~ '^[a-f0-9]{64}$'),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists education_email_challenges_latest
  on public.education_email_challenges(user_id,institution_code,created_at desc);

create table if not exists public.education_email_rate_limits (
  scope_key text primary key,
  window_start date not null,
  request_count integer not null default 0,
  last_request_at timestamptz
);

-- Helper predicates live in the non-exposed schema. They are narrowly scoped
-- and used by RLS only; auth.uid() is always the authenticated caller.
create or replace function private.education_is_school_admin(p_school_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1 from public.education_school_members m
    where m.school_id = p_school_id
      and m.user_id = (select auth.uid())
      and m.role = 'school_admin'
      and m.status = 'active'
  );
$function$;

create or replace function private.education_is_school_member(p_school_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1 from public.education_school_members m
    where m.school_id = p_school_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$function$;

create or replace function private.education_can_manage_class(p_class_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1
    from public.education_classes c
    where c.id = p_class_id and c.is_active
      and (
        private.education_is_school_admin(c.school_id)
        or exists (
          select 1
          from public.education_teacher_assignments a
          join public.education_school_members m
            on m.school_id = a.school_id and m.user_id = a.teacher_id
          where a.class_id = c.id and a.teacher_id = (select auth.uid())
            and a.is_active and m.role = 'teacher' and m.status = 'active'
        )
      )
  );
$function$;

create or replace function private.education_is_class_teacher(p_class_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1 from public.education_classes c
    where c.id = p_class_id
      and (
        private.education_is_school_admin(c.school_id)
        or exists (
          select 1
          from public.education_teacher_assignments a
          join public.education_school_members m
            on m.school_id = a.school_id and m.user_id = a.teacher_id
          where a.class_id = c.id and a.teacher_id = (select auth.uid())
            and a.is_active and a.is_class_teacher
            and m.role = 'teacher' and m.status = 'active'
        )
      )
  );
$function$;

create or replace function private.education_is_class_member(p_class_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1
    from public.education_classes c
    where c.id = p_class_id and c.is_active
      and (
        private.education_is_school_admin(c.school_id)
        or exists (
          select 1 from public.education_teacher_assignments a
          join public.education_school_members m
            on m.school_id = a.school_id and m.user_id = a.teacher_id
          where a.class_id = c.id and a.teacher_id = (select auth.uid())
            and a.is_active and m.role = 'teacher' and m.status = 'active'
        )
        or exists (
          select 1 from public.education_class_students s
          join public.education_school_members m
            on m.school_id = s.school_id and m.user_id = s.student_id
          where s.class_id = c.id and s.student_id = (select auth.uid())
            and s.is_active and m.role = 'student' and m.status = 'active'
        )
      )
  );
$function$;

create or replace function private.education_student_draw_allowed(p_class_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select coalesce((
    select b.students_can_draw
    from public.education_class_board_state b
    where b.class_id = p_class_id
  ),false);
$function$;

create or replace function private.education_current_username()
returns text
language sql stable security definer set search_path to ''
as $function$
  select p.data ->> 'username'
  from public.public_profiles p
  where p.data ->> 'uid' = (select auth.uid())::text
  limit 1;
$function$;

revoke all on function private.education_is_school_admin(uuid) from public, anon;
revoke all on function private.education_is_school_member(uuid) from public, anon;
revoke all on function private.education_can_manage_class(uuid) from public, anon;
revoke all on function private.education_is_class_teacher(uuid) from public, anon;
revoke all on function private.education_is_class_member(uuid) from public, anon;
revoke all on function private.education_student_draw_allowed(uuid) from public, anon;
revoke all on function private.education_current_username() from public, anon;
grant execute on function private.education_is_school_admin(uuid) to authenticated;
grant execute on function private.education_is_school_member(uuid) to authenticated;
grant execute on function private.education_can_manage_class(uuid) to authenticated;
grant execute on function private.education_is_class_teacher(uuid) to authenticated;
grant execute on function private.education_is_class_member(uuid) to authenticated;
grant execute on function private.education_student_draw_allowed(uuid) to authenticated;
grant execute on function private.education_current_username() to authenticated;

-- Automatic empty board state whenever a new class is created.
create or replace function private.education_create_board_state()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
begin
  insert into public.education_class_board_state(class_id,school_id)
  values (new.id,new.school_id)
  on conflict (class_id) do nothing;
  return new;
end;
$function$;

revoke all on function private.education_create_board_state() from public, anon, authenticated;
drop trigger if exists education_class_board_state_init on public.education_classes;
create trigger education_class_board_state_init
after insert on public.education_classes
for each row execute function private.education_create_board_state();

-- RLS on every exposed table.
alter table public.education_schools enable row level security;
alter table public.education_school_members enable row level security;
alter table public.education_classes enable row level security;
alter table public.education_teacher_assignments enable row level security;
alter table public.education_teacher_invites enable row level security;
alter table public.education_teacher_requests enable row level security;
alter table public.education_student_requests enable row level security;
alter table public.education_class_students enable row level security;
alter table public.education_class_feed enable row level security;
alter table public.education_class_points enable row level security;
alter table public.education_class_board_state enable row level security;
alter table public.education_board_events enable row level security;
alter table public.education_class_sessions enable row level security;
alter table public.education_audio_requests enable row level security;
alter table public.education_audit_log enable row level security;
alter table public.education_email_challenges enable row level security;
alter table public.education_email_rate_limits enable row level security;

-- School directory only contains institution directory fields, not member lists.
drop policy if exists education_schools_directory_read on public.education_schools;
create policy education_schools_directory_read
on public.education_schools for select to authenticated
using (status = 'active');

drop policy if exists education_schools_admin_update on public.education_schools;
create policy education_schools_admin_update
on public.education_schools for update to authenticated
using (private.education_is_school_admin(id))
with check (private.education_is_school_admin(id));

drop policy if exists education_school_members_read on public.education_school_members;
create policy education_school_members_read
on public.education_school_members for select to authenticated
using (
  user_id = (select auth.uid())
  or private.education_is_school_admin(school_id)
);

drop policy if exists education_classes_directory_read on public.education_classes;
create policy education_classes_directory_read
on public.education_classes for select to authenticated
using (is_active = true);

drop policy if exists education_classes_admin_insert on public.education_classes;
create policy education_classes_admin_insert
on public.education_classes for insert to authenticated
with check (
  private.education_is_school_admin(school_id)
  and created_by = (select auth.uid())
);

drop policy if exists education_classes_admin_update on public.education_classes;
create policy education_classes_admin_update
on public.education_classes for update to authenticated
using (private.education_is_school_admin(school_id))
with check (private.education_is_school_admin(school_id));

drop policy if exists education_classes_admin_delete on public.education_classes;
create policy education_classes_admin_delete
on public.education_classes for delete to authenticated
using (private.education_is_school_admin(school_id));

drop policy if exists education_teacher_assignments_read on public.education_teacher_assignments;
create policy education_teacher_assignments_read
on public.education_teacher_assignments for select to authenticated
using (
  teacher_id = (select auth.uid())
  or private.education_is_school_admin(school_id)
  or private.education_is_class_member(class_id)
);

drop policy if exists education_teacher_invites_admin_read on public.education_teacher_invites;
create policy education_teacher_invites_admin_read
on public.education_teacher_invites for select to authenticated
using (private.education_is_school_admin(school_id));

drop policy if exists education_teacher_invites_admin_insert on public.education_teacher_invites;
create policy education_teacher_invites_admin_insert
on public.education_teacher_invites for insert to authenticated
with check (
  private.education_is_school_admin(school_id)
  and created_by = (select auth.uid())
  and (education_teacher_invites.class_id is null or exists (
    select 1 from public.education_classes c
    where c.id = education_teacher_invites.class_id
      and c.school_id = education_teacher_invites.school_id
  ))
  and expires_at > now()
  and expires_at <= now() + interval '48 hours'
);

drop policy if exists education_teacher_invites_admin_update on public.education_teacher_invites;
create policy education_teacher_invites_admin_update
on public.education_teacher_invites for update to authenticated
using (private.education_is_school_admin(school_id))
with check (private.education_is_school_admin(school_id));

drop policy if exists education_teacher_requests_read on public.education_teacher_requests;
create policy education_teacher_requests_read
on public.education_teacher_requests for select to authenticated
using (
  user_id = (select auth.uid())
  or private.education_is_school_admin(school_id)
);

drop policy if exists education_student_requests_read on public.education_student_requests;
create policy education_student_requests_read
on public.education_student_requests for select to authenticated
using (
  user_id = (select auth.uid())
  or private.education_is_school_admin(school_id)
  or private.education_is_class_teacher(class_id)
);

drop policy if exists education_student_requests_insert_self on public.education_student_requests;
create policy education_student_requests_insert_self
on public.education_student_requests for insert to authenticated
with check (
  user_id = (select auth.uid())
  and username = private.education_current_username()
  and status = 'pending'
  and exists (
    select 1 from public.education_classes c
    where c.id = education_student_requests.class_id
      and c.school_id = education_student_requests.school_id and c.is_active
  )
  and not exists (
    select 1 from public.education_class_students cs
    where cs.class_id = education_student_requests.class_id
      and cs.student_id = (select auth.uid()) and cs.is_active
  )
  and not exists (
    select 1 from public.education_school_members m
    where m.school_id = school_id and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role in ('school_admin','teacher')
  )
);

drop policy if exists education_class_students_read on public.education_class_students;
create policy education_class_students_read
on public.education_class_students for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_class_feed_read on public.education_class_feed;
create policy education_class_feed_read
on public.education_class_feed for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_class_feed_insert on public.education_class_feed;
create policy education_class_feed_insert
on public.education_class_feed for insert to authenticated
with check (
  author_id = (select auth.uid())
  and private.education_can_manage_class(class_id)
  and exists (
    select 1 from public.education_classes c
    where c.id = education_class_feed.class_id
      and c.school_id = education_class_feed.school_id
  )
);

drop policy if exists education_class_feed_update on public.education_class_feed;
create policy education_class_feed_update
on public.education_class_feed for update to authenticated
using (author_id = (select auth.uid()) and private.education_can_manage_class(class_id))
with check (author_id = (select auth.uid()) and private.education_can_manage_class(class_id));

drop policy if exists education_class_feed_delete on public.education_class_feed;
create policy education_class_feed_delete
on public.education_class_feed for delete to authenticated
using (private.education_can_manage_class(class_id));

drop policy if exists education_class_points_read on public.education_class_points;
create policy education_class_points_read
on public.education_class_points for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_class_board_state_read on public.education_class_board_state;
create policy education_class_board_state_read
on public.education_class_board_state for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_class_board_state_insert on public.education_class_board_state;
create policy education_class_board_state_insert
on public.education_class_board_state for insert to authenticated
with check (
  updated_by = (select auth.uid())
  and private.education_can_manage_class(class_id)
  and exists (select 1 from public.education_classes c
    where c.id = education_class_board_state.class_id
      and c.school_id = education_class_board_state.school_id)
);

drop policy if exists education_class_board_state_update on public.education_class_board_state;
create policy education_class_board_state_update
on public.education_class_board_state for update to authenticated
using (private.education_can_manage_class(class_id))
with check (
  private.education_can_manage_class(class_id)
  and updated_by = (select auth.uid())
  and exists (select 1 from public.education_classes c
    where c.id = education_class_board_state.class_id
      and c.school_id = education_class_board_state.school_id)
);

drop policy if exists education_board_events_read on public.education_board_events;
create policy education_board_events_read
on public.education_board_events for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_board_events_insert on public.education_board_events;
create policy education_board_events_insert
on public.education_board_events for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.education_classes c
    where c.id = education_board_events.class_id
      and c.school_id = education_board_events.school_id
  )
  and (
    private.education_can_manage_class(class_id)
    or (
      private.education_student_draw_allowed(class_id)
      and exists (
        select 1 from public.education_class_students s
        where s.class_id = class_id and s.student_id = (select auth.uid()) and s.is_active
      )
    )
  )
);

drop policy if exists education_board_events_delete on public.education_board_events;
create policy education_board_events_delete
on public.education_board_events for delete to authenticated
using (private.education_can_manage_class(class_id));

drop policy if exists education_class_sessions_read on public.education_class_sessions;
create policy education_class_sessions_read
on public.education_class_sessions for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_class_sessions_insert on public.education_class_sessions;
create policy education_class_sessions_insert
on public.education_class_sessions for insert to authenticated
with check (
  opened_by = (select auth.uid())
  and private.education_can_manage_class(class_id)
  and exists (select 1 from public.education_classes c
    where c.id = education_class_sessions.class_id
      and c.school_id = education_class_sessions.school_id)
);

drop policy if exists education_class_sessions_update on public.education_class_sessions;
create policy education_class_sessions_update
on public.education_class_sessions for update to authenticated
using (private.education_can_manage_class(class_id))
with check (
  private.education_can_manage_class(class_id)
  and exists (select 1 from public.education_classes c
    where c.id = education_class_sessions.class_id
      and c.school_id = education_class_sessions.school_id)
);

drop policy if exists education_audio_requests_read on public.education_audio_requests;
create policy education_audio_requests_read
on public.education_audio_requests for select to authenticated
using (
  student_id = (select auth.uid())
  or private.education_can_manage_class(class_id)
);

drop policy if exists education_audio_requests_insert on public.education_audio_requests;
create policy education_audio_requests_insert
on public.education_audio_requests for insert to authenticated
with check (
  requested_by = (select auth.uid())
  and exists (
    select 1 from public.education_class_sessions s
    where s.id = education_audio_requests.session_id
      and s.class_id = education_audio_requests.class_id
      and s.school_id = education_audio_requests.school_id and s.status = 'live'
  )
  and (
    (
      private.education_can_manage_class(class_id)
      and exists (
        select 1 from public.education_class_students cs
        where cs.class_id = education_audio_requests.class_id
          and cs.school_id = education_audio_requests.school_id
          and cs.student_id = education_audio_requests.student_id
          and cs.is_active
      )
    )
    or student_id = (select auth.uid())
  )
);

drop policy if exists education_audio_requests_student_respond on public.education_audio_requests;
create policy education_audio_requests_student_respond
on public.education_audio_requests for update to authenticated
using (student_id = (select auth.uid()) and status = 'pending')
with check (
  student_id = (select auth.uid())
  and status in ('accepted','declined')
  and responded_at is not null
);

drop policy if exists education_audit_log_admin_read on public.education_audit_log;
create policy education_audit_log_admin_read
on public.education_audit_log for select to authenticated
using (private.education_is_school_admin(school_id));


create or replace function private.education_guard_audio_request_update()
returns trigger
language plpgsql security invoker set search_path to ''
as $function$
begin
  if auth.uid() is null
     or old.student_id <> auth.uid()
     or old.status <> 'pending'
     or new.status not in ('accepted','declined')
     or new.responded_at is null
     or new.id is distinct from old.id
     or new.school_id is distinct from old.school_id
     or new.class_id is distinct from old.class_id
     or new.session_id is distinct from old.session_id
     or new.student_id is distinct from old.student_id
     or new.requested_by is distinct from old.requested_by
     or new.action is distinct from old.action
     or new.created_at is distinct from old.created_at then
    raise exception 'Ses isteğini yalnızca öğrenci kendi yanıtlayabilir.';
  end if;
  return new;
end;
$function$;

revoke all on function private.education_guard_audio_request_update() from public,anon,authenticated;
drop trigger if exists education_audio_request_guard on public.education_audio_requests;
create trigger education_audio_request_guard
before update on public.education_audio_requests
for each row execute function private.education_guard_audio_request_update();

-- Service-role policies only. No anon/authenticated access is granted below.
drop policy if exists education_email_challenges_service on public.education_email_challenges;
create policy education_email_challenges_service
on public.education_email_challenges for all to service_role
using (true) with check (true);

drop policy if exists education_email_rate_limits_service on public.education_email_rate_limits;
create policy education_email_rate_limits_service
on public.education_email_rate_limits for all to service_role
using (true) with check (true);

-- Table privileges are explicit; RLS is the row-level boundary.
grant select on public.education_schools to authenticated;
grant update (school_name,region,updated_at) on public.education_schools to authenticated;
grant select on public.education_school_members to authenticated;
grant select,insert,update,delete on public.education_classes to authenticated;
grant select on public.education_teacher_assignments to authenticated;
grant select,insert,update on public.education_teacher_invites to authenticated;
grant select on public.education_teacher_requests to authenticated;
grant select,insert on public.education_student_requests to authenticated;
grant select on public.education_class_students to authenticated;
grant select,insert,update,delete on public.education_class_feed to authenticated;
grant select on public.education_class_points to authenticated;
grant select,insert,update on public.education_class_board_state to authenticated;
grant select,insert,delete on public.education_board_events to authenticated;
grant select,insert,update on public.education_class_sessions to authenticated;
grant select,insert,update on public.education_audio_requests to authenticated;
grant select on public.education_audit_log to authenticated;

revoke all on public.education_email_challenges from public,anon,authenticated;
revoke all on public.education_email_rate_limits from public,anon,authenticated;
grant all on public.education_email_challenges to service_role;
grant all on public.education_email_rate_limits to service_role;

-- A single active school membership is created only after the MEB inbox OTP
-- is verified by the server-side Edge Function.
create or replace function public.education_reserve_school_verification_send(
  p_user_id uuid,
  p_institution_code text
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_count integer;
begin
  insert into public.education_email_rate_limits(scope_key,window_start,request_count,last_request_at)
  values ('school:' || p_institution_code,current_date,1,now())
  on conflict (scope_key) do update
    set request_count = case
          when public.education_email_rate_limits.window_start < current_date then 1
          else public.education_email_rate_limits.request_count + 1 end,
        window_start = current_date,
        last_request_at = now()
    where (public.education_email_rate_limits.window_start < current_date
           or public.education_email_rate_limits.request_count < 10)
      and (public.education_email_rate_limits.last_request_at is null
           or public.education_email_rate_limits.last_request_at <= now() - interval '60 seconds')
  returning request_count into v_count;

  if v_count is null then
    return jsonb_build_object('allowed',false,'reason','institution_rate_limit');
  end if;

  insert into public.education_email_rate_limits(scope_key,window_start,request_count,last_request_at)
  values ('user:' || p_user_id::text || ':' || p_institution_code,current_date,1,now())
  on conflict (scope_key) do update
    set request_count = case
          when public.education_email_rate_limits.window_start < current_date then 1
          else public.education_email_rate_limits.request_count + 1 end,
        window_start = current_date,
        last_request_at = now()
    where (public.education_email_rate_limits.window_start < current_date
           or public.education_email_rate_limits.request_count < 5)
      and (public.education_email_rate_limits.last_request_at is null
           or public.education_email_rate_limits.last_request_at <= now() - interval '60 seconds')
  returning request_count into v_count;

  if v_count is null then
    return jsonb_build_object('allowed',false,'reason','user_rate_limit');
  end if;

  return jsonb_build_object('allowed',true);
end;
$function$;

create or replace function public.education_complete_school_verification(
  p_challenge_id uuid,
  p_user_id uuid,
  p_code_hmac text,
  p_school_name text,
  p_region text default null
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_challenge public.education_email_challenges%rowtype;
  v_school_id uuid;
  v_username text;
begin
  select * into v_challenge
  from public.education_email_challenges
  where id = p_challenge_id and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('success',false,'error','challenge_not_found');
  end if;
  if v_challenge.consumed_at is not null or v_challenge.expires_at <= now() then
    return jsonb_build_object('success',false,'error','challenge_expired');
  end if;
  if v_challenge.attempts >= 5 then
    update public.education_email_challenges
      set consumed_at = now()
      where id = p_challenge_id;
    return jsonb_build_object('success',false,'error','too_many_attempts');
  end if;
  if p_code_hmac is null or p_code_hmac !~ '^[a-f0-9]{64}$'
     or v_challenge.code_hmac <> p_code_hmac then
    update public.education_email_challenges
      set attempts = attempts + 1,
          consumed_at = case when attempts + 1 >= 5 then now() else null end
      where id = p_challenge_id;
    return jsonb_build_object('success',false,'error','invalid_code','attempts_left',greatest(0,4-v_challenge.attempts));
  end if;

  if char_length(btrim(coalesce(p_school_name,''))) < 2
     or char_length(btrim(coalesce(p_school_name,''))) > 120 then
    return jsonb_build_object('success',false,'error','invalid_school_name');
  end if;
  select p.data ->> 'username' into v_username
  from public.public_profiles p
  where p.data ->> 'uid' = p_user_id::text
  limit 1;
  if coalesce(v_username,'') = '' then
    return jsonb_build_object('success',false,'error','forever_profile_not_found');
  end if;

  insert into public.education_schools(institution_code,school_name,region,created_by)
  values (
    v_challenge.institution_code,
    btrim(p_school_name),
    nullif(btrim(coalesce(p_region,'')),''),
    p_user_id
  )
  returning id into v_school_id;

  insert into public.education_school_members(school_id,user_id,username,role,status,created_by)
  values(v_school_id,p_user_id,v_username,'school_admin','active',p_user_id);

  update public.education_email_challenges
    set consumed_at = now()
    where id = p_challenge_id;

  insert into public.education_audit_log(school_id,actor_user_id,action,target_type,target_id,details)
  values(
    v_school_id,p_user_id,'school_verified','education_schools',v_school_id::text,
    jsonb_build_object('official_email',v_challenge.official_email)
  );

  return jsonb_build_object('success',true,'school_id',v_school_id::text);
exception when unique_violation then
  return jsonb_build_object('success',false,'error','school_already_registered');
end;
$function$;

revoke all on function public.education_reserve_school_verification_send(uuid,text) from public,anon,authenticated;
grant execute on function public.education_reserve_school_verification_send(uuid,text) to service_role;
revoke all on function public.education_complete_school_verification(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.education_complete_school_verification(uuid,uuid,text,text,text) to service_role;

-- Claim a teacher invitation. The raw token is never stored and can be used once.
create or replace function public.education_claim_teacher_invite(p_token text)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_invite public.education_teacher_invites%rowtype;
  v_username text;
  v_request_id uuid;
begin
  if v_uid is null then raise exception 'Oturum gerekli.'; end if;
  if p_token is null or p_token !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'Davet bağlantısı geçersiz veya eksik.';
  end if;

  select * into v_invite
  from public.education_teacher_invites
  where token_hash = encode(extensions.digest(convert_to(lower(p_token),'UTF8'),'sha256'),'hex')
  for update;

  if not found or v_invite.status <> 'active' or v_invite.expires_at <= now() then
    raise exception 'Davet bağlantısı geçersiz, kullanılmış veya süresi dolmuş.';
  end if;

  v_username := private.education_current_username();
  if coalesce(v_username,'') = '' then raise exception 'Forever kullanıcı adı doğrulanamadı.'; end if;

  if v_invite.target_username is not null
     and lower(v_invite.target_username) <> lower(v_username) then
    raise exception 'Bu davet farklı bir Forever kullanıcı adına gönderilmiş.';
  end if;

  if exists (
    select 1 from public.education_school_members m
    where m.school_id = v_invite.school_id and m.user_id = v_uid
      and m.status = 'active' and m.role <> 'teacher'
  ) then
    raise exception 'Bu okulda farklı bir aktif rolün bulunuyor.';
  end if;

  insert into public.education_teacher_requests(school_id,invite_id,class_id,user_id,username)
  values(v_invite.school_id,v_invite.id,v_invite.class_id,v_uid,v_username)
  returning id into v_request_id;

  insert into public.education_school_members(school_id,user_id,username,role,status,created_by)
  values(v_invite.school_id,v_uid,v_username,'teacher','pending',v_invite.created_by)
  on conflict (school_id,user_id) do update
    set username = excluded.username,
        role = 'teacher',
        status = case when public.education_school_members.status = 'active'
                      then 'active' else 'pending' end,
        updated_at = now();

  update public.education_teacher_invites
    set status = 'claimed', claimed_by = v_uid, claimed_at = now()
    where id = v_invite.id;

  insert into public.education_audit_log(school_id,actor_user_id,action,target_user_id,target_type,target_id)
  values(v_invite.school_id,v_uid,'teacher_invite_claimed',v_uid,'education_teacher_requests',v_request_id::text);

  return jsonb_build_object('success',true,'request_id',v_request_id::text,'school_id',v_invite.school_id::text);
end;
$function$;

-- School administrators approve or reject teacher requests.
create or replace function public.education_decide_teacher_request(
  p_request_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_request public.education_teacher_requests%rowtype;
  v_invite public.education_teacher_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;

  select * into v_request
  from public.education_teacher_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'Öğretmen başvurusu bulunamadı.'; end if;
  if not private.education_is_school_admin(v_request.school_id) then
    raise exception 'Bu okulda yönetici yetkin yok.';
  end if;
  if v_request.status <> 'pending' then raise exception 'Başvuru daha önce işlenmiş.'; end if;

  if p_approve then
    update public.education_school_members
      set role='teacher',status='active',updated_at=now()
      where school_id=v_request.school_id and user_id=v_request.user_id;
    if not found then
      raise exception 'Öğretmen üyelik kaydı bulunamadı.';
    end if;

    if v_request.class_id is not null then
      insert into public.education_teacher_assignments(
        school_id,class_id,teacher_id,is_class_teacher,is_active,assigned_by
      )
      values(v_request.school_id,v_request.class_id,v_request.user_id,false,true,auth.uid())
      on conflict(class_id,teacher_id) do update set is_active=true;
    end if;

    update public.education_teacher_requests
      set status='approved',reviewed_by=auth.uid(),reviewed_at=now()
      where id=p_request_id;
  else
    update public.education_school_members
      set status='rejected',updated_at=now()
      where school_id=v_request.school_id and user_id=v_request.user_id and status='pending';
    update public.education_teacher_requests
      set status='rejected',reviewed_by=auth.uid(),reviewed_at=now()
      where id=p_request_id;
  end if;

  update public.education_teacher_invites
    set status='claimed'
    where id=v_request.invite_id;

  insert into public.education_audit_log(school_id,actor_user_id,action,target_user_id,target_type,target_id)
  values(v_request.school_id,auth.uid(),
    case when p_approve then 'teacher_approved' else 'teacher_rejected' end,
    v_request.user_id,'education_teacher_requests',p_request_id::text);

  return jsonb_build_object('success',true,'approved',p_approve);
end;
$function$;

-- Admin assigns/reassigns the single class-teacher role.
create or replace function public.education_assign_teacher(
  p_class_id uuid,
  p_teacher_id uuid,
  p_is_class_teacher boolean default false
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_school_id uuid;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;
  select school_id into v_school_id from public.education_classes where id=p_class_id and is_active;
  if v_school_id is null then raise exception 'Sınıf bulunamadı.'; end if;
  if not private.education_is_school_admin(v_school_id) then
    raise exception 'Öğretmen atamak için okul yöneticisi olmalısın.';
  end if;
  if not exists(
    select 1 from public.education_school_members
    where school_id=v_school_id and user_id=p_teacher_id
      and role='teacher' and status='active'
  ) then raise exception 'Bu kullanıcı okulda onaylı öğretmen değil.'; end if;

  if p_is_class_teacher then
    update public.education_teacher_assignments
      set is_class_teacher=false
      where class_id=p_class_id and is_active and is_class_teacher;
  end if;

  insert into public.education_teacher_assignments(
    school_id,class_id,teacher_id,is_class_teacher,is_active,assigned_by
  )
  values(v_school_id,p_class_id,p_teacher_id,p_is_class_teacher,true,auth.uid())
  on conflict(class_id,teacher_id) do update
    set is_class_teacher=excluded.is_class_teacher,
        is_active=true,
        assigned_by=auth.uid();

  insert into public.education_audit_log(school_id,actor_user_id,action,target_user_id,target_type,target_id,details)
  values(v_school_id,auth.uid(),'teacher_assigned',p_teacher_id,'education_classes',p_class_id::text,
    jsonb_build_object('is_class_teacher',p_is_class_teacher));

  return jsonb_build_object('success',true);
end;
$function$;

-- Class teacher or school admin approves/rejects a student request.
create or replace function public.education_decide_student_request(
  p_request_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_request public.education_student_requests%rowtype;
  v_username text;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;
  select * into v_request
  from public.education_student_requests
  where id=p_request_id
  for update;
  if not found then raise exception 'Öğrenci başvurusu bulunamadı.'; end if;
  if not private.education_is_class_teacher(v_request.class_id) then
    raise exception 'Bu sınıfın sınıf öğretmeni veya okul yöneticisi değilsin.';
  end if;
  if v_request.status <> 'pending' then raise exception 'Başvuru daha önce işlenmiş.'; end if;

  if p_approve then
    if exists (
      select 1 from public.education_school_members
      where school_id=v_request.school_id and user_id=v_request.user_id
        and status='active' and role <> 'student'
    ) then raise exception 'Bu kullanıcı okulda farklı bir aktif role sahip.'; end if;

    insert into public.education_school_members(school_id,user_id,username,role,status,created_by)
    values(v_request.school_id,v_request.user_id,v_request.username,'student','active',auth.uid())
    on conflict(school_id,user_id) do update
      set username=excluded.username,role='student',status='active',updated_at=now();

    insert into public.education_class_students(school_id,class_id,student_id,added_by,is_active)
    values(v_request.school_id,v_request.class_id,v_request.user_id,auth.uid(),true)
    on conflict(class_id,student_id) do update set is_active=true;

    update public.education_student_requests
      set status='approved',reviewed_by=auth.uid(),reviewed_at=now()
      where id=p_request_id;
  else
    update public.education_student_requests
      set status='rejected',reviewed_by=auth.uid(),reviewed_at=now()
      where id=p_request_id;
  end if;

  insert into public.education_audit_log(school_id,actor_user_id,action,target_user_id,target_type,target_id)
  values(v_request.school_id,auth.uid(),
    case when p_approve then 'student_approved' else 'student_rejected' end,
    v_request.user_id,'education_student_requests',p_request_id::text);

  return jsonb_build_object('success',true,'approved',p_approve);
end;
$function$;

create or replace function public.education_award_points(
  p_class_id uuid,
  p_student_id uuid,
  p_points integer,
  p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_school_id uuid;
  v_point_id uuid;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;
  if p_points < 1 or p_points > 100 then raise exception 'Puan 1 ile 100 arasında olmalı.'; end if;
  if p_reason is not null and char_length(p_reason) > 250 then raise exception 'Açıklama çok uzun.'; end if;
  select school_id into v_school_id from public.education_classes where id=p_class_id and is_active;
  if v_school_id is null or not private.education_can_manage_class(p_class_id) then
    raise exception 'Bu sınıfta puan verme yetkin yok.';
  end if;
  if not exists(
    select 1 from public.education_class_students
    where class_id=p_class_id and student_id=p_student_id and is_active
  ) then raise exception 'Öğrenci bu sınıfa kayıtlı değil.'; end if;

  insert into public.education_class_points(school_id,class_id,student_id,teacher_id,points,reason)
  values(v_school_id,p_class_id,p_student_id,auth.uid(),p_points,nullif(btrim(coalesce(p_reason,'')),''))
  returning id into v_point_id;

  insert into public.education_audit_log(school_id,actor_user_id,action,target_user_id,target_type,target_id,details)
  values(v_school_id,auth.uid(),'points_awarded',p_student_id,'education_class_points',v_point_id::text,
    jsonb_build_object('points',p_points));

  return jsonb_build_object('success',true,'point_id',v_point_id::text);
end;
$function$;

create or replace function public.education_clear_board(p_class_id uuid)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare
  v_school_id uuid;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;
  select school_id into v_school_id from public.education_classes where id=p_class_id and is_active;
  if v_school_id is null or not private.education_can_manage_class(p_class_id) then
    raise exception 'Tahtayı temizleme yetkin yok.';
  end if;
  insert into public.education_board_events(school_id,class_id,created_by,event_type,payload)
  values(v_school_id,p_class_id,auth.uid(),'clear','{}'::jsonb);
  return true;
end;
$function$;

-- These authenticated RPCs are SECURITY DEFINER because they atomically touch
-- multiple RLS-protected rows. Each verifies auth.uid() and school/class role.
revoke all on function public.education_claim_teacher_invite(text) from public,anon;
grant execute on function public.education_claim_teacher_invite(text) to authenticated;
revoke all on function public.education_decide_teacher_request(uuid,boolean) from public,anon;
grant execute on function public.education_decide_teacher_request(uuid,boolean) to authenticated;
revoke all on function public.education_assign_teacher(uuid,uuid,boolean) from public,anon;
grant execute on function public.education_assign_teacher(uuid,uuid,boolean) to authenticated;
revoke all on function public.education_decide_student_request(uuid,boolean) from public,anon;
grant execute on function public.education_decide_student_request(uuid,boolean) to authenticated;
revoke all on function public.education_award_points(uuid,uuid,integer,text) from public,anon;
grant execute on function public.education_award_points(uuid,uuid,integer,text) to authenticated;
revoke all on function public.education_clear_board(uuid) from public,anon;
grant execute on function public.education_clear_board(uuid) to authenticated;

-- Safe class leaderboard: invoker rights means underlying RLS remains active.
create or replace view public.education_class_leaderboard
with (security_invoker = true)
as
select
  s.school_id,
  s.class_id,
  s.student_id,
  coalesce(sum(p.points),0)::bigint as total_points,
  dense_rank() over (
    partition by s.class_id
    order by coalesce(sum(p.points),0) desc
  ) as rank
from public.education_class_students s
left join public.education_class_points p
  on p.class_id=s.class_id and p.student_id=s.student_id
where s.is_active
group by s.school_id,s.class_id,s.student_id;

grant select on public.education_class_leaderboard to authenticated;

-- Realtime is used only for class board/feed/session updates. RLS remains active.
do $function$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    foreach t in array array[
      'education_class_feed','education_board_events',
      'education_class_board_state','education_class_sessions',
      'education_audio_requests'
    ] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public' and tablename=t
      ) then
        execute format('alter publication supabase_realtime add table public.%I',t);
      end if;
    end loop;
  end if;
end;
$function$;
),
  check (event_type <> 'stroke' or (payload ->> 'width') ~ '^[1-9]

create table if not exists public.education_class_sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.education_schools(id) on delete cascade,
  class_id uuid not null references public.education_classes(id) on delete cascade,
  opened_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'live' check (status in ('live','closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create unique index if not exists education_one_live_session_per_class
  on public.education_class_sessions(class_id)
  where status = 'live';

-- These are requests, not remote microphone controls. A student always controls
-- their own microphone and must accept any mute/unmute request locally.
create table if not exists public.education_audio_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.education_schools(id) on delete cascade,
  class_id uuid not null references public.education_classes(id) on delete cascade,
  session_id uuid not null references public.education_class_sessions(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('mute','unmute')),
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.education_audit_log (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.education_schools(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 2 and 80),
  target_user_id uuid references auth.users(id) on delete set null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Service-only tables: no browser role has access.
create table if not exists public.education_email_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  institution_code text not null check (institution_code ~ '^[0-9]{4,12}$'),
  official_email text not null,
  code_hmac text not null check (code_hmac ~ '^[a-f0-9]{64}$'),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists education_email_challenges_latest
  on public.education_email_challenges(user_id,institution_code,created_at desc);

create table if not exists public.education_email_rate_limits (
  scope_key text primary key,
  window_start date not null,
  request_count integer not null default 0,
  last_request_at timestamptz
);

-- Helper predicates live in the non-exposed schema. They are narrowly scoped
-- and used by RLS only; auth.uid() is always the authenticated caller.
create or replace function private.education_is_school_admin(p_school_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1 from public.education_school_members m
    where m.school_id = p_school_id
      and m.user_id = (select auth.uid())
      and m.role = 'school_admin'
      and m.status = 'active'
  );
$function$;

create or replace function private.education_is_school_member(p_school_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1 from public.education_school_members m
    where m.school_id = p_school_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$function$;

create or replace function private.education_can_manage_class(p_class_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1
    from public.education_classes c
    where c.id = p_class_id and c.is_active
      and (
        private.education_is_school_admin(c.school_id)
        or exists (
          select 1
          from public.education_teacher_assignments a
          join public.education_school_members m
            on m.school_id = a.school_id and m.user_id = a.teacher_id
          where a.class_id = c.id and a.teacher_id = (select auth.uid())
            and a.is_active and m.role = 'teacher' and m.status = 'active'
        )
      )
  );
$function$;

create or replace function private.education_is_class_teacher(p_class_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1 from public.education_classes c
    where c.id = p_class_id
      and (
        private.education_is_school_admin(c.school_id)
        or exists (
          select 1
          from public.education_teacher_assignments a
          join public.education_school_members m
            on m.school_id = a.school_id and m.user_id = a.teacher_id
          where a.class_id = c.id and a.teacher_id = (select auth.uid())
            and a.is_active and a.is_class_teacher
            and m.role = 'teacher' and m.status = 'active'
        )
      )
  );
$function$;

create or replace function private.education_is_class_member(p_class_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1
    from public.education_classes c
    where c.id = p_class_id and c.is_active
      and (
        private.education_is_school_admin(c.school_id)
        or exists (
          select 1 from public.education_teacher_assignments a
          join public.education_school_members m
            on m.school_id = a.school_id and m.user_id = a.teacher_id
          where a.class_id = c.id and a.teacher_id = (select auth.uid())
            and a.is_active and m.role = 'teacher' and m.status = 'active'
        )
        or exists (
          select 1 from public.education_class_students s
          join public.education_school_members m
            on m.school_id = s.school_id and m.user_id = s.student_id
          where s.class_id = c.id and s.student_id = (select auth.uid())
            and s.is_active and m.role = 'student' and m.status = 'active'
        )
      )
  );
$function$;

create or replace function private.education_student_draw_allowed(p_class_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select coalesce((
    select b.students_can_draw
    from public.education_class_board_state b
    where b.class_id = p_class_id
  ),false);
$function$;

create or replace function private.education_current_username()
returns text
language sql stable security definer set search_path to ''
as $function$
  select p.data ->> 'username'
  from public.public_profiles p
  where p.data ->> 'uid' = (select auth.uid())::text
  limit 1;
$function$;

revoke all on function private.education_is_school_admin(uuid) from public, anon;
revoke all on function private.education_is_school_member(uuid) from public, anon;
revoke all on function private.education_can_manage_class(uuid) from public, anon;
revoke all on function private.education_is_class_teacher(uuid) from public, anon;
revoke all on function private.education_is_class_member(uuid) from public, anon;
revoke all on function private.education_student_draw_allowed(uuid) from public, anon;
revoke all on function private.education_current_username() from public, anon;
grant execute on function private.education_is_school_admin(uuid) to authenticated;
grant execute on function private.education_is_school_member(uuid) to authenticated;
grant execute on function private.education_can_manage_class(uuid) to authenticated;
grant execute on function private.education_is_class_teacher(uuid) to authenticated;
grant execute on function private.education_is_class_member(uuid) to authenticated;
grant execute on function private.education_student_draw_allowed(uuid) to authenticated;
grant execute on function private.education_current_username() to authenticated;

-- Automatic empty board state whenever a new class is created.
create or replace function private.education_create_board_state()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
begin
  insert into public.education_class_board_state(class_id,school_id)
  values (new.id,new.school_id)
  on conflict (class_id) do nothing;
  return new;
end;
$function$;

revoke all on function private.education_create_board_state() from public, anon, authenticated;
drop trigger if exists education_class_board_state_init on public.education_classes;
create trigger education_class_board_state_init
after insert on public.education_classes
for each row execute function private.education_create_board_state();

-- RLS on every exposed table.
alter table public.education_schools enable row level security;
alter table public.education_school_members enable row level security;
alter table public.education_classes enable row level security;
alter table public.education_teacher_assignments enable row level security;
alter table public.education_teacher_invites enable row level security;
alter table public.education_teacher_requests enable row level security;
alter table public.education_student_requests enable row level security;
alter table public.education_class_students enable row level security;
alter table public.education_class_feed enable row level security;
alter table public.education_class_points enable row level security;
alter table public.education_class_board_state enable row level security;
alter table public.education_board_events enable row level security;
alter table public.education_class_sessions enable row level security;
alter table public.education_audio_requests enable row level security;
alter table public.education_audit_log enable row level security;
alter table public.education_email_challenges enable row level security;
alter table public.education_email_rate_limits enable row level security;

-- School directory only contains institution directory fields, not member lists.
drop policy if exists education_schools_directory_read on public.education_schools;
create policy education_schools_directory_read
on public.education_schools for select to authenticated
using (status = 'active');

drop policy if exists education_schools_admin_update on public.education_schools;
create policy education_schools_admin_update
on public.education_schools for update to authenticated
using (private.education_is_school_admin(id))
with check (private.education_is_school_admin(id));

drop policy if exists education_school_members_read on public.education_school_members;
create policy education_school_members_read
on public.education_school_members for select to authenticated
using (
  user_id = (select auth.uid())
  or private.education_is_school_admin(school_id)
);

drop policy if exists education_classes_directory_read on public.education_classes;
create policy education_classes_directory_read
on public.education_classes for select to authenticated
using (is_active = true);

drop policy if exists education_classes_admin_insert on public.education_classes;
create policy education_classes_admin_insert
on public.education_classes for insert to authenticated
with check (
  private.education_is_school_admin(school_id)
  and created_by = (select auth.uid())
);

drop policy if exists education_classes_admin_update on public.education_classes;
create policy education_classes_admin_update
on public.education_classes for update to authenticated
using (private.education_is_school_admin(school_id))
with check (private.education_is_school_admin(school_id));

drop policy if exists education_classes_admin_delete on public.education_classes;
create policy education_classes_admin_delete
on public.education_classes for delete to authenticated
using (private.education_is_school_admin(school_id));

drop policy if exists education_teacher_assignments_read on public.education_teacher_assignments;
create policy education_teacher_assignments_read
on public.education_teacher_assignments for select to authenticated
using (
  teacher_id = (select auth.uid())
  or private.education_is_school_admin(school_id)
  or private.education_is_class_member(class_id)
);

drop policy if exists education_teacher_invites_admin_read on public.education_teacher_invites;
create policy education_teacher_invites_admin_read
on public.education_teacher_invites for select to authenticated
using (private.education_is_school_admin(school_id));

drop policy if exists education_teacher_invites_admin_insert on public.education_teacher_invites;
create policy education_teacher_invites_admin_insert
on public.education_teacher_invites for insert to authenticated
with check (
  private.education_is_school_admin(school_id)
  and created_by = (select auth.uid())
  and (education_teacher_invites.class_id is null or exists (
    select 1 from public.education_classes c
    where c.id = education_teacher_invites.class_id
      and c.school_id = education_teacher_invites.school_id
  ))
  and expires_at > now()
  and expires_at <= now() + interval '48 hours'
);

drop policy if exists education_teacher_invites_admin_update on public.education_teacher_invites;
create policy education_teacher_invites_admin_update
on public.education_teacher_invites for update to authenticated
using (private.education_is_school_admin(school_id))
with check (private.education_is_school_admin(school_id));

drop policy if exists education_teacher_requests_read on public.education_teacher_requests;
create policy education_teacher_requests_read
on public.education_teacher_requests for select to authenticated
using (
  user_id = (select auth.uid())
  or private.education_is_school_admin(school_id)
);

drop policy if exists education_student_requests_read on public.education_student_requests;
create policy education_student_requests_read
on public.education_student_requests for select to authenticated
using (
  user_id = (select auth.uid())
  or private.education_is_school_admin(school_id)
  or private.education_is_class_teacher(class_id)
);

drop policy if exists education_student_requests_insert_self on public.education_student_requests;
create policy education_student_requests_insert_self
on public.education_student_requests for insert to authenticated
with check (
  user_id = (select auth.uid())
  and username = private.education_current_username()
  and status = 'pending'
  and exists (
    select 1 from public.education_classes c
    where c.id = education_student_requests.class_id
      and c.school_id = education_student_requests.school_id and c.is_active
  )
  and not exists (
    select 1 from public.education_class_students cs
    where cs.class_id = education_student_requests.class_id
      and cs.student_id = (select auth.uid()) and cs.is_active
  )
  and not exists (
    select 1 from public.education_school_members m
    where m.school_id = school_id and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role in ('school_admin','teacher')
  )
);

drop policy if exists education_class_students_read on public.education_class_students;
create policy education_class_students_read
on public.education_class_students for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_class_feed_read on public.education_class_feed;
create policy education_class_feed_read
on public.education_class_feed for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_class_feed_insert on public.education_class_feed;
create policy education_class_feed_insert
on public.education_class_feed for insert to authenticated
with check (
  author_id = (select auth.uid())
  and private.education_can_manage_class(class_id)
  and exists (
    select 1 from public.education_classes c
    where c.id = education_class_feed.class_id
      and c.school_id = education_class_feed.school_id
  )
);

drop policy if exists education_class_feed_update on public.education_class_feed;
create policy education_class_feed_update
on public.education_class_feed for update to authenticated
using (author_id = (select auth.uid()) and private.education_can_manage_class(class_id))
with check (author_id = (select auth.uid()) and private.education_can_manage_class(class_id));

drop policy if exists education_class_feed_delete on public.education_class_feed;
create policy education_class_feed_delete
on public.education_class_feed for delete to authenticated
using (private.education_can_manage_class(class_id));

drop policy if exists education_class_points_read on public.education_class_points;
create policy education_class_points_read
on public.education_class_points for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_class_board_state_read on public.education_class_board_state;
create policy education_class_board_state_read
on public.education_class_board_state for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_class_board_state_insert on public.education_class_board_state;
create policy education_class_board_state_insert
on public.education_class_board_state for insert to authenticated
with check (
  updated_by = (select auth.uid())
  and private.education_can_manage_class(class_id)
  and exists (select 1 from public.education_classes c
    where c.id = education_class_board_state.class_id
      and c.school_id = education_class_board_state.school_id)
);

drop policy if exists education_class_board_state_update on public.education_class_board_state;
create policy education_class_board_state_update
on public.education_class_board_state for update to authenticated
using (private.education_can_manage_class(class_id))
with check (
  private.education_can_manage_class(class_id)
  and updated_by = (select auth.uid())
  and exists (select 1 from public.education_classes c
    where c.id = education_class_board_state.class_id
      and c.school_id = education_class_board_state.school_id)
);

drop policy if exists education_board_events_read on public.education_board_events;
create policy education_board_events_read
on public.education_board_events for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_board_events_insert on public.education_board_events;
create policy education_board_events_insert
on public.education_board_events for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.education_classes c
    where c.id = education_board_events.class_id
      and c.school_id = education_board_events.school_id
  )
  and (
    private.education_can_manage_class(class_id)
    or (
      private.education_student_draw_allowed(class_id)
      and exists (
        select 1 from public.education_class_students s
        where s.class_id = class_id and s.student_id = (select auth.uid()) and s.is_active
      )
    )
  )
);

drop policy if exists education_board_events_delete on public.education_board_events;
create policy education_board_events_delete
on public.education_board_events for delete to authenticated
using (private.education_can_manage_class(class_id));

drop policy if exists education_class_sessions_read on public.education_class_sessions;
create policy education_class_sessions_read
on public.education_class_sessions for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_class_sessions_insert on public.education_class_sessions;
create policy education_class_sessions_insert
on public.education_class_sessions for insert to authenticated
with check (
  opened_by = (select auth.uid())
  and private.education_can_manage_class(class_id)
  and exists (select 1 from public.education_classes c
    where c.id = education_class_sessions.class_id
      and c.school_id = education_class_sessions.school_id)
);

drop policy if exists education_class_sessions_update on public.education_class_sessions;
create policy education_class_sessions_update
on public.education_class_sessions for update to authenticated
using (private.education_can_manage_class(class_id))
with check (
  private.education_can_manage_class(class_id)
  and exists (select 1 from public.education_classes c
    where c.id = education_class_sessions.class_id
      and c.school_id = education_class_sessions.school_id)
);

drop policy if exists education_audio_requests_read on public.education_audio_requests;
create policy education_audio_requests_read
on public.education_audio_requests for select to authenticated
using (
  student_id = (select auth.uid())
  or private.education_can_manage_class(class_id)
);

drop policy if exists education_audio_requests_insert on public.education_audio_requests;
create policy education_audio_requests_insert
on public.education_audio_requests for insert to authenticated
with check (
  requested_by = (select auth.uid())
  and exists (
    select 1 from public.education_class_sessions s
    where s.id = education_audio_requests.session_id
      and s.class_id = education_audio_requests.class_id
      and s.school_id = education_audio_requests.school_id and s.status = 'live'
  )
  and (
    (
      private.education_can_manage_class(class_id)
      and exists (
        select 1 from public.education_class_students cs
        where cs.class_id = education_audio_requests.class_id
          and cs.school_id = education_audio_requests.school_id
          and cs.student_id = education_audio_requests.student_id
          and cs.is_active
      )
    )
    or student_id = (select auth.uid())
  )
);

drop policy if exists education_audio_requests_student_respond on public.education_audio_requests;
create policy education_audio_requests_student_respond
on public.education_audio_requests for update to authenticated
using (student_id = (select auth.uid()) and status = 'pending')
with check (
  student_id = (select auth.uid())
  and status in ('accepted','declined')
  and responded_at is not null
);

drop policy if exists education_audit_log_admin_read on public.education_audit_log;
create policy education_audit_log_admin_read
on public.education_audit_log for select to authenticated
using (private.education_is_school_admin(school_id));

-- Service-role policies only. No anon/authenticated access is granted below.
drop policy if exists education_email_challenges_service on public.education_email_challenges;
create policy education_email_challenges_service
on public.education_email_challenges for all to service_role
using (true) with check (true);

drop policy if exists education_email_rate_limits_service on public.education_email_rate_limits;
create policy education_email_rate_limits_service
on public.education_email_rate_limits for all to service_role
using (true) with check (true);

-- Table privileges are explicit; RLS is the row-level boundary.
grant select on public.education_schools to authenticated;
grant update (school_name,region,updated_at) on public.education_schools to authenticated;
grant select on public.education_school_members to authenticated;
grant select,insert,update,delete on public.education_classes to authenticated;
grant select on public.education_teacher_assignments to authenticated;
grant select,insert,update on public.education_teacher_invites to authenticated;
grant select on public.education_teacher_requests to authenticated;
grant select,insert on public.education_student_requests to authenticated;
grant select on public.education_class_students to authenticated;
grant select,insert,update,delete on public.education_class_feed to authenticated;
grant select on public.education_class_points to authenticated;
grant select,insert,update on public.education_class_board_state to authenticated;
grant select,insert,delete on public.education_board_events to authenticated;
grant select,insert,update on public.education_class_sessions to authenticated;
grant select,insert,update on public.education_audio_requests to authenticated;
grant select on public.education_audit_log to authenticated;

revoke all on public.education_email_challenges from public,anon,authenticated;
revoke all on public.education_email_rate_limits from public,anon,authenticated;
grant all on public.education_email_challenges to service_role;
grant all on public.education_email_rate_limits to service_role;

-- A single active school membership is created only after the MEB inbox OTP
-- is verified by the server-side Edge Function.
create or replace function public.education_reserve_school_verification_send(
  p_user_id uuid,
  p_institution_code text
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_count integer;
begin
  insert into public.education_email_rate_limits(scope_key,window_start,request_count,last_request_at)
  values ('school:' || p_institution_code,current_date,1,now())
  on conflict (scope_key) do update
    set request_count = case
          when public.education_email_rate_limits.window_start < current_date then 1
          else public.education_email_rate_limits.request_count + 1 end,
        window_start = current_date,
        last_request_at = now()
    where (public.education_email_rate_limits.window_start < current_date
           or public.education_email_rate_limits.request_count < 10)
      and (public.education_email_rate_limits.last_request_at is null
           or public.education_email_rate_limits.last_request_at <= now() - interval '60 seconds')
  returning request_count into v_count;

  if v_count is null then
    return jsonb_build_object('allowed',false,'reason','institution_rate_limit');
  end if;

  insert into public.education_email_rate_limits(scope_key,window_start,request_count,last_request_at)
  values ('user:' || p_user_id::text || ':' || p_institution_code,current_date,1,now())
  on conflict (scope_key) do update
    set request_count = case
          when public.education_email_rate_limits.window_start < current_date then 1
          else public.education_email_rate_limits.request_count + 1 end,
        window_start = current_date,
        last_request_at = now()
    where (public.education_email_rate_limits.window_start < current_date
           or public.education_email_rate_limits.request_count < 5)
      and (public.education_email_rate_limits.last_request_at is null
           or public.education_email_rate_limits.last_request_at <= now() - interval '60 seconds')
  returning request_count into v_count;

  if v_count is null then
    return jsonb_build_object('allowed',false,'reason','user_rate_limit');
  end if;

  return jsonb_build_object('allowed',true);
end;
$function$;

create or replace function public.education_complete_school_verification(
  p_challenge_id uuid,
  p_user_id uuid,
  p_code_hmac text,
  p_school_name text,
  p_region text default null
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_challenge public.education_email_challenges%rowtype;
  v_school_id uuid;
  v_username text;
begin
  select * into v_challenge
  from public.education_email_challenges
  where id = p_challenge_id and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('success',false,'error','challenge_not_found');
  end if;
  if v_challenge.consumed_at is not null or v_challenge.expires_at <= now() then
    return jsonb_build_object('success',false,'error','challenge_expired');
  end if;
  if v_challenge.attempts >= 5 then
    update public.education_email_challenges
      set consumed_at = now()
      where id = p_challenge_id;
    return jsonb_build_object('success',false,'error','too_many_attempts');
  end if;
  if p_code_hmac is null or p_code_hmac !~ '^[a-f0-9]{64}$'
     or v_challenge.code_hmac <> p_code_hmac then
    update public.education_email_challenges
      set attempts = attempts + 1,
          consumed_at = case when attempts + 1 >= 5 then now() else null end
      where id = p_challenge_id;
    return jsonb_build_object('success',false,'error','invalid_code','attempts_left',greatest(0,4-v_challenge.attempts));
  end if;

  if char_length(btrim(coalesce(p_school_name,''))) < 2
     or char_length(btrim(coalesce(p_school_name,''))) > 120 then
    return jsonb_build_object('success',false,'error','invalid_school_name');
  end if;
  select p.data ->> 'username' into v_username
  from public.public_profiles p
  where p.data ->> 'uid' = p_user_id::text
  limit 1;
  if coalesce(v_username,'') = '' then
    return jsonb_build_object('success',false,'error','forever_profile_not_found');
  end if;

  insert into public.education_schools(institution_code,school_name,region,created_by)
  values (
    v_challenge.institution_code,
    btrim(p_school_name),
    nullif(btrim(coalesce(p_region,'')),''),
    p_user_id
  )
  returning id into v_school_id;

  insert into public.education_school_members(school_id,user_id,username,role,status,created_by)
  values(v_school_id,p_user_id,v_username,'school_admin','active',p_user_id);

  update public.education_email_challenges
    set consumed_at = now()
    where id = p_challenge_id;

  insert into public.education_audit_log(school_id,actor_user_id,action,target_type,target_id,details)
  values(
    v_school_id,p_user_id,'school_verified','education_schools',v_school_id::text,
    jsonb_build_object('official_email',v_challenge.official_email)
  );

  return jsonb_build_object('success',true,'school_id',v_school_id::text);
exception when unique_violation then
  return jsonb_build_object('success',false,'error','school_already_registered');
end;
$function$;

revoke all on function public.education_reserve_school_verification_send(uuid,text) from public,anon,authenticated;
grant execute on function public.education_reserve_school_verification_send(uuid,text) to service_role;
revoke all on function public.education_complete_school_verification(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.education_complete_school_verification(uuid,uuid,text,text,text) to service_role;

-- Claim a teacher invitation. The raw token is never stored and can be used once.
create or replace function public.education_claim_teacher_invite(p_token text)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_invite public.education_teacher_invites%rowtype;
  v_username text;
  v_request_id uuid;
begin
  if v_uid is null then raise exception 'Oturum gerekli.'; end if;
  if p_token is null or p_token !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'Davet bağlantısı geçersiz veya eksik.';
  end if;

  select * into v_invite
  from public.education_teacher_invites
  where token_hash = encode(extensions.digest(convert_to(lower(p_token),'UTF8'),'sha256'),'hex')
  for update;

  if not found or v_invite.status <> 'active' or v_invite.expires_at <= now() then
    raise exception 'Davet bağlantısı geçersiz, kullanılmış veya süresi dolmuş.';
  end if;

  v_username := private.education_current_username();
  if coalesce(v_username,'') = '' then raise exception 'Forever kullanıcı adı doğrulanamadı.'; end if;

  if v_invite.target_username is not null
     and lower(v_invite.target_username) <> lower(v_username) then
    raise exception 'Bu davet farklı bir Forever kullanıcı adına gönderilmiş.';
  end if;

  if exists (
    select 1 from public.education_school_members m
    where m.school_id = v_invite.school_id and m.user_id = v_uid
      and m.status = 'active' and m.role <> 'teacher'
  ) then
    raise exception 'Bu okulda farklı bir aktif rolün bulunuyor.';
  end if;

  insert into public.education_teacher_requests(school_id,invite_id,class_id,user_id,username)
  values(v_invite.school_id,v_invite.id,v_invite.class_id,v_uid,v_username)
  returning id into v_request_id;

  insert into public.education_school_members(school_id,user_id,username,role,status,created_by)
  values(v_invite.school_id,v_uid,v_username,'teacher','pending',v_invite.created_by)
  on conflict (school_id,user_id) do update
    set username = excluded.username,
        role = 'teacher',
        status = case when public.education_school_members.status = 'active'
                      then 'active' else 'pending' end,
        updated_at = now();

  update public.education_teacher_invites
    set status = 'claimed', claimed_by = v_uid, claimed_at = now()
    where id = v_invite.id;

  insert into public.education_audit_log(school_id,actor_user_id,action,target_user_id,target_type,target_id)
  values(v_invite.school_id,v_uid,'teacher_invite_claimed',v_uid,'education_teacher_requests',v_request_id::text);

  return jsonb_build_object('success',true,'request_id',v_request_id::text,'school_id',v_invite.school_id::text);
end;
$function$;

-- School administrators approve or reject teacher requests.
create or replace function public.education_decide_teacher_request(
  p_request_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_request public.education_teacher_requests%rowtype;
  v_invite public.education_teacher_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;

  select * into v_request
  from public.education_teacher_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'Öğretmen başvurusu bulunamadı.'; end if;
  if not private.education_is_school_admin(v_request.school_id) then
    raise exception 'Bu okulda yönetici yetkin yok.';
  end if;
  if v_request.status <> 'pending' then raise exception 'Başvuru daha önce işlenmiş.'; end if;

  if p_approve then
    update public.education_school_members
      set role='teacher',status='active',updated_at=now()
      where school_id=v_request.school_id and user_id=v_request.user_id;
    if not found then
      raise exception 'Öğretmen üyelik kaydı bulunamadı.';
    end if;

    if v_request.class_id is not null then
      insert into public.education_teacher_assignments(
        school_id,class_id,teacher_id,is_class_teacher,is_active,assigned_by
      )
      values(v_request.school_id,v_request.class_id,v_request.user_id,false,true,auth.uid())
      on conflict(class_id,teacher_id) do update set is_active=true;
    end if;

    update public.education_teacher_requests
      set status='approved',reviewed_by=auth.uid(),reviewed_at=now()
      where id=p_request_id;
  else
    update public.education_school_members
      set status='rejected',updated_at=now()
      where school_id=v_request.school_id and user_id=v_request.user_id and status='pending';
    update public.education_teacher_requests
      set status='rejected',reviewed_by=auth.uid(),reviewed_at=now()
      where id=p_request_id;
  end if;

  update public.education_teacher_invites
    set status='claimed'
    where id=v_request.invite_id;

  insert into public.education_audit_log(school_id,actor_user_id,action,target_user_id,target_type,target_id)
  values(v_request.school_id,auth.uid(),
    case when p_approve then 'teacher_approved' else 'teacher_rejected' end,
    v_request.user_id,'education_teacher_requests',p_request_id::text);

  return jsonb_build_object('success',true,'approved',p_approve);
end;
$function$;

-- Admin assigns/reassigns the single class-teacher role.
create or replace function public.education_assign_teacher(
  p_class_id uuid,
  p_teacher_id uuid,
  p_is_class_teacher boolean default false
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_school_id uuid;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;
  select school_id into v_school_id from public.education_classes where id=p_class_id and is_active;
  if v_school_id is null then raise exception 'Sınıf bulunamadı.'; end if;
  if not private.education_is_school_admin(v_school_id) then
    raise exception 'Öğretmen atamak için okul yöneticisi olmalısın.';
  end if;
  if not exists(
    select 1 from public.education_school_members
    where school_id=v_school_id and user_id=p_teacher_id
      and role='teacher' and status='active'
  ) then raise exception 'Bu kullanıcı okulda onaylı öğretmen değil.'; end if;

  if p_is_class_teacher then
    update public.education_teacher_assignments
      set is_class_teacher=false
      where class_id=p_class_id and is_active and is_class_teacher;
  end if;

  insert into public.education_teacher_assignments(
    school_id,class_id,teacher_id,is_class_teacher,is_active,assigned_by
  )
  values(v_school_id,p_class_id,p_teacher_id,p_is_class_teacher,true,auth.uid())
  on conflict(class_id,teacher_id) do update
    set is_class_teacher=excluded.is_class_teacher,
        is_active=true,
        assigned_by=auth.uid();

  insert into public.education_audit_log(school_id,actor_user_id,action,target_user_id,target_type,target_id,details)
  values(v_school_id,auth.uid(),'teacher_assigned',p_teacher_id,'education_classes',p_class_id::text,
    jsonb_build_object('is_class_teacher',p_is_class_teacher));

  return jsonb_build_object('success',true);
end;
$function$;

-- Class teacher or school admin approves/rejects a student request.
create or replace function public.education_decide_student_request(
  p_request_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_request public.education_student_requests%rowtype;
  v_username text;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;
  select * into v_request
  from public.education_student_requests
  where id=p_request_id
  for update;
  if not found then raise exception 'Öğrenci başvurusu bulunamadı.'; end if;
  if not private.education_is_class_teacher(v_request.class_id) then
    raise exception 'Bu sınıfın sınıf öğretmeni veya okul yöneticisi değilsin.';
  end if;
  if v_request.status <> 'pending' then raise exception 'Başvuru daha önce işlenmiş.'; end if;

  if p_approve then
    if exists (
      select 1 from public.education_school_members
      where school_id=v_request.school_id and user_id=v_request.user_id
        and status='active' and role <> 'student'
    ) then raise exception 'Bu kullanıcı okulda farklı bir aktif role sahip.'; end if;

    insert into public.education_school_members(school_id,user_id,username,role,status,created_by)
    values(v_request.school_id,v_request.user_id,v_request.username,'student','active',auth.uid())
    on conflict(school_id,user_id) do update
      set username=excluded.username,role='student',status='active',updated_at=now();

    insert into public.education_class_students(school_id,class_id,student_id,added_by,is_active)
    values(v_request.school_id,v_request.class_id,v_request.user_id,auth.uid(),true)
    on conflict(class_id,student_id) do update set is_active=true;

    update public.education_student_requests
      set status='approved',reviewed_by=auth.uid(),reviewed_at=now()
      where id=p_request_id;
  else
    update public.education_student_requests
      set status='rejected',reviewed_by=auth.uid(),reviewed_at=now()
      where id=p_request_id;
  end if;

  insert into public.education_audit_log(school_id,actor_user_id,action,target_user_id,target_type,target_id)
  values(v_request.school_id,auth.uid(),
    case when p_approve then 'student_approved' else 'student_rejected' end,
    v_request.user_id,'education_student_requests',p_request_id::text);

  return jsonb_build_object('success',true,'approved',p_approve);
end;
$function$;

create or replace function public.education_award_points(
  p_class_id uuid,
  p_student_id uuid,
  p_points integer,
  p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_school_id uuid;
  v_point_id uuid;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;
  if p_points < 1 or p_points > 100 then raise exception 'Puan 1 ile 100 arasında olmalı.'; end if;
  if p_reason is not null and char_length(p_reason) > 250 then raise exception 'Açıklama çok uzun.'; end if;
  select school_id into v_school_id from public.education_classes where id=p_class_id and is_active;
  if v_school_id is null or not private.education_can_manage_class(p_class_id) then
    raise exception 'Bu sınıfta puan verme yetkin yok.';
  end if;
  if not exists(
    select 1 from public.education_class_students
    where class_id=p_class_id and student_id=p_student_id and is_active
  ) then raise exception 'Öğrenci bu sınıfa kayıtlı değil.'; end if;

  insert into public.education_class_points(school_id,class_id,student_id,teacher_id,points,reason)
  values(v_school_id,p_class_id,p_student_id,auth.uid(),p_points,nullif(btrim(coalesce(p_reason,'')),''))
  returning id into v_point_id;

  insert into public.education_audit_log(school_id,actor_user_id,action,target_user_id,target_type,target_id,details)
  values(v_school_id,auth.uid(),'points_awarded',p_student_id,'education_class_points',v_point_id::text,
    jsonb_build_object('points',p_points));

  return jsonb_build_object('success',true,'point_id',v_point_id::text);
end;
$function$;

create or replace function public.education_clear_board(p_class_id uuid)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare
  v_school_id uuid;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;
  select school_id into v_school_id from public.education_classes where id=p_class_id and is_active;
  if v_school_id is null or not private.education_can_manage_class(p_class_id) then
    raise exception 'Tahtayı temizleme yetkin yok.';
  end if;
  insert into public.education_board_events(school_id,class_id,created_by,event_type,payload)
  values(v_school_id,p_class_id,auth.uid(),'clear','{}'::jsonb);
  return true;
end;
$function$;

-- These authenticated RPCs are SECURITY DEFINER because they atomically touch
-- multiple RLS-protected rows. Each verifies auth.uid() and school/class role.
revoke all on function public.education_claim_teacher_invite(text) from public,anon;
grant execute on function public.education_claim_teacher_invite(text) to authenticated;
revoke all on function public.education_decide_teacher_request(uuid,boolean) from public,anon;
grant execute on function public.education_decide_teacher_request(uuid,boolean) to authenticated;
revoke all on function public.education_assign_teacher(uuid,uuid,boolean) from public,anon;
grant execute on function public.education_assign_teacher(uuid,uuid,boolean) to authenticated;
revoke all on function public.education_decide_student_request(uuid,boolean) from public,anon;
grant execute on function public.education_decide_student_request(uuid,boolean) to authenticated;
revoke all on function public.education_award_points(uuid,uuid,integer,text) from public,anon;
grant execute on function public.education_award_points(uuid,uuid,integer,text) to authenticated;
revoke all on function public.education_clear_board(uuid) from public,anon;
grant execute on function public.education_clear_board(uuid) to authenticated;

-- Safe class leaderboard: invoker rights means underlying RLS remains active.
create or replace view public.education_class_leaderboard
with (security_invoker = true)
as
select
  s.school_id,
  s.class_id,
  s.student_id,
  coalesce(sum(p.points),0)::bigint as total_points,
  dense_rank() over (
    partition by s.class_id
    order by coalesce(sum(p.points),0) desc
  ) as rank
from public.education_class_students s
left join public.education_class_points p
  on p.class_id=s.class_id and p.student_id=s.student_id
where s.is_active
group by s.school_id,s.class_id,s.student_id;

grant select on public.education_class_leaderboard to authenticated;

-- Realtime is used only for class board/feed/session updates. RLS remains active.
do $function$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    foreach t in array array[
      'education_class_feed','education_board_events',
      'education_class_board_state','education_class_sessions',
      'education_audio_requests'
    ] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public' and tablename=t
      ) then
        execute format('alter publication supabase_realtime add table public.%I',t);
      end if;
    end loop;
  end if;
end;
$function$;
)
);

create table if not exists public.education_class_sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.education_schools(id) on delete cascade,
  class_id uuid not null references public.education_classes(id) on delete cascade,
  opened_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'live' check (status in ('live','closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create unique index if not exists education_one_live_session_per_class
  on public.education_class_sessions(class_id)
  where status = 'live';

-- These are requests, not remote microphone controls. A student always controls
-- their own microphone and must accept any mute/unmute request locally.
create table if not exists public.education_audio_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.education_schools(id) on delete cascade,
  class_id uuid not null references public.education_classes(id) on delete cascade,
  session_id uuid not null references public.education_class_sessions(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('mute','unmute')),
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.education_audit_log (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.education_schools(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 2 and 80),
  target_user_id uuid references auth.users(id) on delete set null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Service-only tables: no browser role has access.
create table if not exists public.education_email_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  institution_code text not null check (institution_code ~ '^[0-9]{4,12}$'),
  official_email text not null,
  code_hmac text not null check (code_hmac ~ '^[a-f0-9]{64}$'),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists education_email_challenges_latest
  on public.education_email_challenges(user_id,institution_code,created_at desc);

create table if not exists public.education_email_rate_limits (
  scope_key text primary key,
  window_start date not null,
  request_count integer not null default 0,
  last_request_at timestamptz
);

-- Helper predicates live in the non-exposed schema. They are narrowly scoped
-- and used by RLS only; auth.uid() is always the authenticated caller.
create or replace function private.education_is_school_admin(p_school_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1 from public.education_school_members m
    where m.school_id = p_school_id
      and m.user_id = (select auth.uid())
      and m.role = 'school_admin'
      and m.status = 'active'
  );
$function$;

create or replace function private.education_is_school_member(p_school_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1 from public.education_school_members m
    where m.school_id = p_school_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$function$;

create or replace function private.education_can_manage_class(p_class_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1
    from public.education_classes c
    where c.id = p_class_id and c.is_active
      and (
        private.education_is_school_admin(c.school_id)
        or exists (
          select 1
          from public.education_teacher_assignments a
          join public.education_school_members m
            on m.school_id = a.school_id and m.user_id = a.teacher_id
          where a.class_id = c.id and a.teacher_id = (select auth.uid())
            and a.is_active and m.role = 'teacher' and m.status = 'active'
        )
      )
  );
$function$;

create or replace function private.education_is_class_teacher(p_class_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1 from public.education_classes c
    where c.id = p_class_id
      and (
        private.education_is_school_admin(c.school_id)
        or exists (
          select 1
          from public.education_teacher_assignments a
          join public.education_school_members m
            on m.school_id = a.school_id and m.user_id = a.teacher_id
          where a.class_id = c.id and a.teacher_id = (select auth.uid())
            and a.is_active and a.is_class_teacher
            and m.role = 'teacher' and m.status = 'active'
        )
      )
  );
$function$;

create or replace function private.education_is_class_member(p_class_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1
    from public.education_classes c
    where c.id = p_class_id and c.is_active
      and (
        private.education_is_school_admin(c.school_id)
        or exists (
          select 1 from public.education_teacher_assignments a
          join public.education_school_members m
            on m.school_id = a.school_id and m.user_id = a.teacher_id
          where a.class_id = c.id and a.teacher_id = (select auth.uid())
            and a.is_active and m.role = 'teacher' and m.status = 'active'
        )
        or exists (
          select 1 from public.education_class_students s
          join public.education_school_members m
            on m.school_id = s.school_id and m.user_id = s.student_id
          where s.class_id = c.id and s.student_id = (select auth.uid())
            and s.is_active and m.role = 'student' and m.status = 'active'
        )
      )
  );
$function$;

create or replace function private.education_student_draw_allowed(p_class_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select coalesce((
    select b.students_can_draw
    from public.education_class_board_state b
    where b.class_id = p_class_id
  ),false);
$function$;

create or replace function private.education_current_username()
returns text
language sql stable security definer set search_path to ''
as $function$
  select p.data ->> 'username'
  from public.public_profiles p
  where p.data ->> 'uid' = (select auth.uid())::text
  limit 1;
$function$;

revoke all on function private.education_is_school_admin(uuid) from public, anon;
revoke all on function private.education_is_school_member(uuid) from public, anon;
revoke all on function private.education_can_manage_class(uuid) from public, anon;
revoke all on function private.education_is_class_teacher(uuid) from public, anon;
revoke all on function private.education_is_class_member(uuid) from public, anon;
revoke all on function private.education_student_draw_allowed(uuid) from public, anon;
revoke all on function private.education_current_username() from public, anon;
grant execute on function private.education_is_school_admin(uuid) to authenticated;
grant execute on function private.education_is_school_member(uuid) to authenticated;
grant execute on function private.education_can_manage_class(uuid) to authenticated;
grant execute on function private.education_is_class_teacher(uuid) to authenticated;
grant execute on function private.education_is_class_member(uuid) to authenticated;
grant execute on function private.education_student_draw_allowed(uuid) to authenticated;
grant execute on function private.education_current_username() to authenticated;

-- Automatic empty board state whenever a new class is created.
create or replace function private.education_create_board_state()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
begin
  insert into public.education_class_board_state(class_id,school_id)
  values (new.id,new.school_id)
  on conflict (class_id) do nothing;
  return new;
end;
$function$;

revoke all on function private.education_create_board_state() from public, anon, authenticated;
drop trigger if exists education_class_board_state_init on public.education_classes;
create trigger education_class_board_state_init
after insert on public.education_classes
for each row execute function private.education_create_board_state();

-- RLS on every exposed table.
alter table public.education_schools enable row level security;
alter table public.education_school_members enable row level security;
alter table public.education_classes enable row level security;
alter table public.education_teacher_assignments enable row level security;
alter table public.education_teacher_invites enable row level security;
alter table public.education_teacher_requests enable row level security;
alter table public.education_student_requests enable row level security;
alter table public.education_class_students enable row level security;
alter table public.education_class_feed enable row level security;
alter table public.education_class_points enable row level security;
alter table public.education_class_board_state enable row level security;
alter table public.education_board_events enable row level security;
alter table public.education_class_sessions enable row level security;
alter table public.education_audio_requests enable row level security;
alter table public.education_audit_log enable row level security;
alter table public.education_email_challenges enable row level security;
alter table public.education_email_rate_limits enable row level security;

-- School directory only contains institution directory fields, not member lists.
drop policy if exists education_schools_directory_read on public.education_schools;
create policy education_schools_directory_read
on public.education_schools for select to authenticated
using (status = 'active');

drop policy if exists education_schools_admin_update on public.education_schools;
create policy education_schools_admin_update
on public.education_schools for update to authenticated
using (private.education_is_school_admin(id))
with check (private.education_is_school_admin(id));

drop policy if exists education_school_members_read on public.education_school_members;
create policy education_school_members_read
on public.education_school_members for select to authenticated
using (
  user_id = (select auth.uid())
  or private.education_is_school_admin(school_id)
);

drop policy if exists education_classes_directory_read on public.education_classes;
create policy education_classes_directory_read
on public.education_classes for select to authenticated
using (is_active = true);

drop policy if exists education_classes_admin_insert on public.education_classes;
create policy education_classes_admin_insert
on public.education_classes for insert to authenticated
with check (
  private.education_is_school_admin(school_id)
  and created_by = (select auth.uid())
);

drop policy if exists education_classes_admin_update on public.education_classes;
create policy education_classes_admin_update
on public.education_classes for update to authenticated
using (private.education_is_school_admin(school_id))
with check (private.education_is_school_admin(school_id));

drop policy if exists education_classes_admin_delete on public.education_classes;
create policy education_classes_admin_delete
on public.education_classes for delete to authenticated
using (private.education_is_school_admin(school_id));

drop policy if exists education_teacher_assignments_read on public.education_teacher_assignments;
create policy education_teacher_assignments_read
on public.education_teacher_assignments for select to authenticated
using (
  teacher_id = (select auth.uid())
  or private.education_is_school_admin(school_id)
  or private.education_is_class_member(class_id)
);

drop policy if exists education_teacher_invites_admin_read on public.education_teacher_invites;
create policy education_teacher_invites_admin_read
on public.education_teacher_invites for select to authenticated
using (private.education_is_school_admin(school_id));

drop policy if exists education_teacher_invites_admin_insert on public.education_teacher_invites;
create policy education_teacher_invites_admin_insert
on public.education_teacher_invites for insert to authenticated
with check (
  private.education_is_school_admin(school_id)
  and created_by = (select auth.uid())
  and (education_teacher_invites.class_id is null or exists (
    select 1 from public.education_classes c
    where c.id = education_teacher_invites.class_id
      and c.school_id = education_teacher_invites.school_id
  ))
  and expires_at > now()
  and expires_at <= now() + interval '48 hours'
);

drop policy if exists education_teacher_invites_admin_update on public.education_teacher_invites;
create policy education_teacher_invites_admin_update
on public.education_teacher_invites for update to authenticated
using (private.education_is_school_admin(school_id))
with check (private.education_is_school_admin(school_id));

drop policy if exists education_teacher_requests_read on public.education_teacher_requests;
create policy education_teacher_requests_read
on public.education_teacher_requests for select to authenticated
using (
  user_id = (select auth.uid())
  or private.education_is_school_admin(school_id)
);

drop policy if exists education_student_requests_read on public.education_student_requests;
create policy education_student_requests_read
on public.education_student_requests for select to authenticated
using (
  user_id = (select auth.uid())
  or private.education_is_school_admin(school_id)
  or private.education_is_class_teacher(class_id)
);

drop policy if exists education_student_requests_insert_self on public.education_student_requests;
create policy education_student_requests_insert_self
on public.education_student_requests for insert to authenticated
with check (
  user_id = (select auth.uid())
  and username = private.education_current_username()
  and status = 'pending'
  and exists (
    select 1 from public.education_classes c
    where c.id = education_student_requests.class_id
      and c.school_id = education_student_requests.school_id and c.is_active
  )
  and not exists (
    select 1 from public.education_class_students cs
    where cs.class_id = education_student_requests.class_id
      and cs.student_id = (select auth.uid()) and cs.is_active
  )
  and not exists (
    select 1 from public.education_school_members m
    where m.school_id = school_id and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role in ('school_admin','teacher')
  )
);

drop policy if exists education_class_students_read on public.education_class_students;
create policy education_class_students_read
on public.education_class_students for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_class_feed_read on public.education_class_feed;
create policy education_class_feed_read
on public.education_class_feed for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_class_feed_insert on public.education_class_feed;
create policy education_class_feed_insert
on public.education_class_feed for insert to authenticated
with check (
  author_id = (select auth.uid())
  and private.education_can_manage_class(class_id)
  and exists (
    select 1 from public.education_classes c
    where c.id = education_class_feed.class_id
      and c.school_id = education_class_feed.school_id
  )
);

drop policy if exists education_class_feed_update on public.education_class_feed;
create policy education_class_feed_update
on public.education_class_feed for update to authenticated
using (author_id = (select auth.uid()) and private.education_can_manage_class(class_id))
with check (author_id = (select auth.uid()) and private.education_can_manage_class(class_id));

drop policy if exists education_class_feed_delete on public.education_class_feed;
create policy education_class_feed_delete
on public.education_class_feed for delete to authenticated
using (private.education_can_manage_class(class_id));

drop policy if exists education_class_points_read on public.education_class_points;
create policy education_class_points_read
on public.education_class_points for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_class_board_state_read on public.education_class_board_state;
create policy education_class_board_state_read
on public.education_class_board_state for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_class_board_state_insert on public.education_class_board_state;
create policy education_class_board_state_insert
on public.education_class_board_state for insert to authenticated
with check (
  updated_by = (select auth.uid())
  and private.education_can_manage_class(class_id)
  and exists (select 1 from public.education_classes c
    where c.id = education_class_board_state.class_id
      and c.school_id = education_class_board_state.school_id)
);

drop policy if exists education_class_board_state_update on public.education_class_board_state;
create policy education_class_board_state_update
on public.education_class_board_state for update to authenticated
using (private.education_can_manage_class(class_id))
with check (
  private.education_can_manage_class(class_id)
  and updated_by = (select auth.uid())
  and exists (select 1 from public.education_classes c
    where c.id = education_class_board_state.class_id
      and c.school_id = education_class_board_state.school_id)
);

drop policy if exists education_board_events_read on public.education_board_events;
create policy education_board_events_read
on public.education_board_events for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_board_events_insert on public.education_board_events;
create policy education_board_events_insert
on public.education_board_events for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.education_classes c
    where c.id = education_board_events.class_id
      and c.school_id = education_board_events.school_id
  )
  and (
    private.education_can_manage_class(class_id)
    or (
      private.education_student_draw_allowed(class_id)
      and exists (
        select 1 from public.education_class_students s
        where s.class_id = class_id and s.student_id = (select auth.uid()) and s.is_active
      )
    )
  )
);

drop policy if exists education_board_events_delete on public.education_board_events;
create policy education_board_events_delete
on public.education_board_events for delete to authenticated
using (private.education_can_manage_class(class_id));

drop policy if exists education_class_sessions_read on public.education_class_sessions;
create policy education_class_sessions_read
on public.education_class_sessions for select to authenticated
using (private.education_is_class_member(class_id));

drop policy if exists education_class_sessions_insert on public.education_class_sessions;
create policy education_class_sessions_insert
on public.education_class_sessions for insert to authenticated
with check (
  opened_by = (select auth.uid())
  and private.education_can_manage_class(class_id)
  and exists (select 1 from public.education_classes c
    where c.id = education_class_sessions.class_id
      and c.school_id = education_class_sessions.school_id)
);

drop policy if exists education_class_sessions_update on public.education_class_sessions;
create policy education_class_sessions_update
on public.education_class_sessions for update to authenticated
using (private.education_can_manage_class(class_id))
with check (
  private.education_can_manage_class(class_id)
  and exists (select 1 from public.education_classes c
    where c.id = education_class_sessions.class_id
      and c.school_id = education_class_sessions.school_id)
);

drop policy if exists education_audio_requests_read on public.education_audio_requests;
create policy education_audio_requests_read
on public.education_audio_requests for select to authenticated
using (
  student_id = (select auth.uid())
  or private.education_can_manage_class(class_id)
);

drop policy if exists education_audio_requests_insert on public.education_audio_requests;
create policy education_audio_requests_insert
on public.education_audio_requests for insert to authenticated
with check (
  requested_by = (select auth.uid())
  and exists (
    select 1 from public.education_class_sessions s
    where s.id = education_audio_requests.session_id
      and s.class_id = education_audio_requests.class_id
      and s.school_id = education_audio_requests.school_id and s.status = 'live'
  )
  and (
    (
      private.education_can_manage_class(class_id)
      and exists (
        select 1 from public.education_class_students cs
        where cs.class_id = education_audio_requests.class_id
          and cs.school_id = education_audio_requests.school_id
          and cs.student_id = education_audio_requests.student_id
          and cs.is_active
      )
    )
    or student_id = (select auth.uid())
  )
);

drop policy if exists education_audio_requests_student_respond on public.education_audio_requests;
create policy education_audio_requests_student_respond
on public.education_audio_requests for update to authenticated
using (student_id = (select auth.uid()) and status = 'pending')
with check (
  student_id = (select auth.uid())
  and status in ('accepted','declined')
  and responded_at is not null
);

drop policy if exists education_audit_log_admin_read on public.education_audit_log;
create policy education_audit_log_admin_read
on public.education_audit_log for select to authenticated
using (private.education_is_school_admin(school_id));

-- Service-role policies only. No anon/authenticated access is granted below.
drop policy if exists education_email_challenges_service on public.education_email_challenges;
create policy education_email_challenges_service
on public.education_email_challenges for all to service_role
using (true) with check (true);

drop policy if exists education_email_rate_limits_service on public.education_email_rate_limits;
create policy education_email_rate_limits_service
on public.education_email_rate_limits for all to service_role
using (true) with check (true);

-- Table privileges are explicit; RLS is the row-level boundary.
grant select on public.education_schools to authenticated;
grant update (school_name,region,updated_at) on public.education_schools to authenticated;
grant select on public.education_school_members to authenticated;
grant select,insert,update,delete on public.education_classes to authenticated;
grant select on public.education_teacher_assignments to authenticated;
grant select,insert,update on public.education_teacher_invites to authenticated;
grant select on public.education_teacher_requests to authenticated;
grant select,insert on public.education_student_requests to authenticated;
grant select on public.education_class_students to authenticated;
grant select,insert,update,delete on public.education_class_feed to authenticated;
grant select on public.education_class_points to authenticated;
grant select,insert,update on public.education_class_board_state to authenticated;
grant select,insert,delete on public.education_board_events to authenticated;
grant select,insert,update on public.education_class_sessions to authenticated;
grant select,insert,update on public.education_audio_requests to authenticated;
grant select on public.education_audit_log to authenticated;

revoke all on public.education_email_challenges from public,anon,authenticated;
revoke all on public.education_email_rate_limits from public,anon,authenticated;
grant all on public.education_email_challenges to service_role;
grant all on public.education_email_rate_limits to service_role;

-- A single active school membership is created only after the MEB inbox OTP
-- is verified by the server-side Edge Function.
create or replace function public.education_reserve_school_verification_send(
  p_user_id uuid,
  p_institution_code text
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_count integer;
begin
  insert into public.education_email_rate_limits(scope_key,window_start,request_count,last_request_at)
  values ('school:' || p_institution_code,current_date,1,now())
  on conflict (scope_key) do update
    set request_count = case
          when public.education_email_rate_limits.window_start < current_date then 1
          else public.education_email_rate_limits.request_count + 1 end,
        window_start = current_date,
        last_request_at = now()
    where (public.education_email_rate_limits.window_start < current_date
           or public.education_email_rate_limits.request_count < 10)
      and (public.education_email_rate_limits.last_request_at is null
           or public.education_email_rate_limits.last_request_at <= now() - interval '60 seconds')
  returning request_count into v_count;

  if v_count is null then
    return jsonb_build_object('allowed',false,'reason','institution_rate_limit');
  end if;

  insert into public.education_email_rate_limits(scope_key,window_start,request_count,last_request_at)
  values ('user:' || p_user_id::text || ':' || p_institution_code,current_date,1,now())
  on conflict (scope_key) do update
    set request_count = case
          when public.education_email_rate_limits.window_start < current_date then 1
          else public.education_email_rate_limits.request_count + 1 end,
        window_start = current_date,
        last_request_at = now()
    where (public.education_email_rate_limits.window_start < current_date
           or public.education_email_rate_limits.request_count < 5)
      and (public.education_email_rate_limits.last_request_at is null
           or public.education_email_rate_limits.last_request_at <= now() - interval '60 seconds')
  returning request_count into v_count;

  if v_count is null then
    return jsonb_build_object('allowed',false,'reason','user_rate_limit');
  end if;

  return jsonb_build_object('allowed',true);
end;
$function$;

create or replace function public.education_complete_school_verification(
  p_challenge_id uuid,
  p_user_id uuid,
  p_code_hmac text,
  p_school_name text,
  p_region text default null
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_challenge public.education_email_challenges%rowtype;
  v_school_id uuid;
  v_username text;
begin
  select * into v_challenge
  from public.education_email_challenges
  where id = p_challenge_id and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('success',false,'error','challenge_not_found');
  end if;
  if v_challenge.consumed_at is not null or v_challenge.expires_at <= now() then
    return jsonb_build_object('success',false,'error','challenge_expired');
  end if;
  if v_challenge.attempts >= 5 then
    update public.education_email_challenges
      set consumed_at = now()
      where id = p_challenge_id;
    return jsonb_build_object('success',false,'error','too_many_attempts');
  end if;
  if p_code_hmac is null or p_code_hmac !~ '^[a-f0-9]{64}$'
     or v_challenge.code_hmac <> p_code_hmac then
    update public.education_email_challenges
      set attempts = attempts + 1,
          consumed_at = case when attempts + 1 >= 5 then now() else null end
      where id = p_challenge_id;
    return jsonb_build_object('success',false,'error','invalid_code','attempts_left',greatest(0,4-v_challenge.attempts));
  end if;

  if char_length(btrim(coalesce(p_school_name,''))) < 2
     or char_length(btrim(coalesce(p_school_name,''))) > 120 then
    return jsonb_build_object('success',false,'error','invalid_school_name');
  end if;
  select p.data ->> 'username' into v_username
  from public.public_profiles p
  where p.data ->> 'uid' = p_user_id::text
  limit 1;
  if coalesce(v_username,'') = '' then
    return jsonb_build_object('success',false,'error','forever_profile_not_found');
  end if;

  insert into public.education_schools(institution_code,school_name,region,created_by)
  values (
    v_challenge.institution_code,
    btrim(p_school_name),
    nullif(btrim(coalesce(p_region,'')),''),
    p_user_id
  )
  returning id into v_school_id;

  insert into public.education_school_members(school_id,user_id,username,role,status,created_by)
  values(v_school_id,p_user_id,v_username,'school_admin','active',p_user_id);

  update public.education_email_challenges
    set consumed_at = now()
    where id = p_challenge_id;

  insert into public.education_audit_log(school_id,actor_user_id,action,target_type,target_id,details)
  values(
    v_school_id,p_user_id,'school_verified','education_schools',v_school_id::text,
    jsonb_build_object('official_email',v_challenge.official_email)
  );

  return jsonb_build_object('success',true,'school_id',v_school_id::text);
exception when unique_violation then
  return jsonb_build_object('success',false,'error','school_already_registered');
end;
$function$;

revoke all on function public.education_reserve_school_verification_send(uuid,text) from public,anon,authenticated;
grant execute on function public.education_reserve_school_verification_send(uuid,text) to service_role;
revoke all on function public.education_complete_school_verification(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.education_complete_school_verification(uuid,uuid,text,text,text) to service_role;

-- Claim a teacher invitation. The raw token is never stored and can be used once.
create or replace function public.education_claim_teacher_invite(p_token text)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_invite public.education_teacher_invites%rowtype;
  v_username text;
  v_request_id uuid;
begin
  if v_uid is null then raise exception 'Oturum gerekli.'; end if;
  if p_token is null or p_token !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'Davet bağlantısı geçersiz veya eksik.';
  end if;

  select * into v_invite
  from public.education_teacher_invites
  where token_hash = encode(extensions.digest(convert_to(lower(p_token),'UTF8'),'sha256'),'hex')
  for update;

  if not found or v_invite.status <> 'active' or v_invite.expires_at <= now() then
    raise exception 'Davet bağlantısı geçersiz, kullanılmış veya süresi dolmuş.';
  end if;

  v_username := private.education_current_username();
  if coalesce(v_username,'') = '' then raise exception 'Forever kullanıcı adı doğrulanamadı.'; end if;

  if v_invite.target_username is not null
     and lower(v_invite.target_username) <> lower(v_username) then
    raise exception 'Bu davet farklı bir Forever kullanıcı adına gönderilmiş.';
  end if;

  if exists (
    select 1 from public.education_school_members m
    where m.school_id = v_invite.school_id and m.user_id = v_uid
      and m.status = 'active' and m.role <> 'teacher'
  ) then
    raise exception 'Bu okulda farklı bir aktif rolün bulunuyor.';
  end if;

  insert into public.education_teacher_requests(school_id,invite_id,class_id,user_id,username)
  values(v_invite.school_id,v_invite.id,v_invite.class_id,v_uid,v_username)
  returning id into v_request_id;

  insert into public.education_school_members(school_id,user_id,username,role,status,created_by)
  values(v_invite.school_id,v_uid,v_username,'teacher','pending',v_invite.created_by)
  on conflict (school_id,user_id) do update
    set username = excluded.username,
        role = 'teacher',
        status = case when public.education_school_members.status = 'active'
                      then 'active' else 'pending' end,
        updated_at = now();

  update public.education_teacher_invites
    set status = 'claimed', claimed_by = v_uid, claimed_at = now()
    where id = v_invite.id;

  insert into public.education_audit_log(school_id,actor_user_id,action,target_user_id,target_type,target_id)
  values(v_invite.school_id,v_uid,'teacher_invite_claimed',v_uid,'education_teacher_requests',v_request_id::text);

  return jsonb_build_object('success',true,'request_id',v_request_id::text,'school_id',v_invite.school_id::text);
end;
$function$;

-- School administrators approve or reject teacher requests.
create or replace function public.education_decide_teacher_request(
  p_request_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_request public.education_teacher_requests%rowtype;
  v_invite public.education_teacher_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;

  select * into v_request
  from public.education_teacher_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'Öğretmen başvurusu bulunamadı.'; end if;
  if not private.education_is_school_admin(v_request.school_id) then
    raise exception 'Bu okulda yönetici yetkin yok.';
  end if;
  if v_request.status <> 'pending' then raise exception 'Başvuru daha önce işlenmiş.'; end if;

  if p_approve then
    update public.education_school_members
      set role='teacher',status='active',updated_at=now()
      where school_id=v_request.school_id and user_id=v_request.user_id;
    if not found then
      raise exception 'Öğretmen üyelik kaydı bulunamadı.';
    end if;

    if v_request.class_id is not null then
      insert into public.education_teacher_assignments(
        school_id,class_id,teacher_id,is_class_teacher,is_active,assigned_by
      )
      values(v_request.school_id,v_request.class_id,v_request.user_id,false,true,auth.uid())
      on conflict(class_id,teacher_id) do update set is_active=true;
    end if;

    update public.education_teacher_requests
      set status='approved',reviewed_by=auth.uid(),reviewed_at=now()
      where id=p_request_id;
  else
    update public.education_school_members
      set status='rejected',updated_at=now()
      where school_id=v_request.school_id and user_id=v_request.user_id and status='pending';
    update public.education_teacher_requests
      set status='rejected',reviewed_by=auth.uid(),reviewed_at=now()
      where id=p_request_id;
  end if;

  update public.education_teacher_invites
    set status='claimed'
    where id=v_request.invite_id;

  insert into public.education_audit_log(school_id,actor_user_id,action,target_user_id,target_type,target_id)
  values(v_request.school_id,auth.uid(),
    case when p_approve then 'teacher_approved' else 'teacher_rejected' end,
    v_request.user_id,'education_teacher_requests',p_request_id::text);

  return jsonb_build_object('success',true,'approved',p_approve);
end;
$function$;

-- Admin assigns/reassigns the single class-teacher role.
create or replace function public.education_assign_teacher(
  p_class_id uuid,
  p_teacher_id uuid,
  p_is_class_teacher boolean default false
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_school_id uuid;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;
  select school_id into v_school_id from public.education_classes where id=p_class_id and is_active;
  if v_school_id is null then raise exception 'Sınıf bulunamadı.'; end if;
  if not private.education_is_school_admin(v_school_id) then
    raise exception 'Öğretmen atamak için okul yöneticisi olmalısın.';
  end if;
  if not exists(
    select 1 from public.education_school_members
    where school_id=v_school_id and user_id=p_teacher_id
      and role='teacher' and status='active'
  ) then raise exception 'Bu kullanıcı okulda onaylı öğretmen değil.'; end if;

  if p_is_class_teacher then
    update public.education_teacher_assignments
      set is_class_teacher=false
      where class_id=p_class_id and is_active and is_class_teacher;
  end if;

  insert into public.education_teacher_assignments(
    school_id,class_id,teacher_id,is_class_teacher,is_active,assigned_by
  )
  values(v_school_id,p_class_id,p_teacher_id,p_is_class_teacher,true,auth.uid())
  on conflict(class_id,teacher_id) do update
    set is_class_teacher=excluded.is_class_teacher,
        is_active=true,
        assigned_by=auth.uid();

  insert into public.education_audit_log(school_id,actor_user_id,action,target_user_id,target_type,target_id,details)
  values(v_school_id,auth.uid(),'teacher_assigned',p_teacher_id,'education_classes',p_class_id::text,
    jsonb_build_object('is_class_teacher',p_is_class_teacher));

  return jsonb_build_object('success',true);
end;
$function$;

-- Class teacher or school admin approves/rejects a student request.
create or replace function public.education_decide_student_request(
  p_request_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_request public.education_student_requests%rowtype;
  v_username text;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;
  select * into v_request
  from public.education_student_requests
  where id=p_request_id
  for update;
  if not found then raise exception 'Öğrenci başvurusu bulunamadı.'; end if;
  if not private.education_is_class_teacher(v_request.class_id) then
    raise exception 'Bu sınıfın sınıf öğretmeni veya okul yöneticisi değilsin.';
  end if;
  if v_request.status <> 'pending' then raise exception 'Başvuru daha önce işlenmiş.'; end if;

  if p_approve then
    if exists (
      select 1 from public.education_school_members
      where school_id=v_request.school_id and user_id=v_request.user_id
        and status='active' and role <> 'student'
    ) then raise exception 'Bu kullanıcı okulda farklı bir aktif role sahip.'; end if;

    insert into public.education_school_members(school_id,user_id,username,role,status,created_by)
    values(v_request.school_id,v_request.user_id,v_request.username,'student','active',auth.uid())
    on conflict(school_id,user_id) do update
      set username=excluded.username,role='student',status='active',updated_at=now();

    insert into public.education_class_students(school_id,class_id,student_id,added_by,is_active)
    values(v_request.school_id,v_request.class_id,v_request.user_id,auth.uid(),true)
    on conflict(class_id,student_id) do update set is_active=true;

    update public.education_student_requests
      set status='approved',reviewed_by=auth.uid(),reviewed_at=now()
      where id=p_request_id;
  else
    update public.education_student_requests
      set status='rejected',reviewed_by=auth.uid(),reviewed_at=now()
      where id=p_request_id;
  end if;

  insert into public.education_audit_log(school_id,actor_user_id,action,target_user_id,target_type,target_id)
  values(v_request.school_id,auth.uid(),
    case when p_approve then 'student_approved' else 'student_rejected' end,
    v_request.user_id,'education_student_requests',p_request_id::text);

  return jsonb_build_object('success',true,'approved',p_approve);
end;
$function$;

create or replace function public.education_award_points(
  p_class_id uuid,
  p_student_id uuid,
  p_points integer,
  p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_school_id uuid;
  v_point_id uuid;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;
  if p_points < 1 or p_points > 100 then raise exception 'Puan 1 ile 100 arasında olmalı.'; end if;
  if p_reason is not null and char_length(p_reason) > 250 then raise exception 'Açıklama çok uzun.'; end if;
  select school_id into v_school_id from public.education_classes where id=p_class_id and is_active;
  if v_school_id is null or not private.education_can_manage_class(p_class_id) then
    raise exception 'Bu sınıfta puan verme yetkin yok.';
  end if;
  if not exists(
    select 1 from public.education_class_students
    where class_id=p_class_id and student_id=p_student_id and is_active
  ) then raise exception 'Öğrenci bu sınıfa kayıtlı değil.'; end if;

  insert into public.education_class_points(school_id,class_id,student_id,teacher_id,points,reason)
  values(v_school_id,p_class_id,p_student_id,auth.uid(),p_points,nullif(btrim(coalesce(p_reason,'')),''))
  returning id into v_point_id;

  insert into public.education_audit_log(school_id,actor_user_id,action,target_user_id,target_type,target_id,details)
  values(v_school_id,auth.uid(),'points_awarded',p_student_id,'education_class_points',v_point_id::text,
    jsonb_build_object('points',p_points));

  return jsonb_build_object('success',true,'point_id',v_point_id::text);
end;
$function$;

create or replace function public.education_clear_board(p_class_id uuid)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare
  v_school_id uuid;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;
  select school_id into v_school_id from public.education_classes where id=p_class_id and is_active;
  if v_school_id is null or not private.education_can_manage_class(p_class_id) then
    raise exception 'Tahtayı temizleme yetkin yok.';
  end if;
  insert into public.education_board_events(school_id,class_id,created_by,event_type,payload)
  values(v_school_id,p_class_id,auth.uid(),'clear','{}'::jsonb);
  return true;
end;
$function$;

-- These authenticated RPCs are SECURITY DEFINER because they atomically touch
-- multiple RLS-protected rows. Each verifies auth.uid() and school/class role.
revoke all on function public.education_claim_teacher_invite(text) from public,anon;
grant execute on function public.education_claim_teacher_invite(text) to authenticated;
revoke all on function public.education_decide_teacher_request(uuid,boolean) from public,anon;
grant execute on function public.education_decide_teacher_request(uuid,boolean) to authenticated;
revoke all on function public.education_assign_teacher(uuid,uuid,boolean) from public,anon;
grant execute on function public.education_assign_teacher(uuid,uuid,boolean) to authenticated;
revoke all on function public.education_decide_student_request(uuid,boolean) from public,anon;
grant execute on function public.education_decide_student_request(uuid,boolean) to authenticated;
revoke all on function public.education_award_points(uuid,uuid,integer,text) from public,anon;
grant execute on function public.education_award_points(uuid,uuid,integer,text) to authenticated;
revoke all on function public.education_clear_board(uuid) from public,anon;
grant execute on function public.education_clear_board(uuid) to authenticated;

-- Safe class leaderboard: invoker rights means underlying RLS remains active.
create or replace view public.education_class_leaderboard
with (security_invoker = true)
as
select
  s.school_id,
  s.class_id,
  s.student_id,
  coalesce(sum(p.points),0)::bigint as total_points,
  dense_rank() over (
    partition by s.class_id
    order by coalesce(sum(p.points),0) desc
  ) as rank
from public.education_class_students s
left join public.education_class_points p
  on p.class_id=s.class_id and p.student_id=s.student_id
where s.is_active
group by s.school_id,s.class_id,s.student_id;

grant select on public.education_class_leaderboard to authenticated;

-- Realtime is used only for class board/feed/session updates. RLS remains active.
do $function$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    foreach t in array array[
      'education_class_feed','education_board_events',
      'education_class_board_state','education_class_sessions',
      'education_audio_requests'
    ] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public' and tablename=t
      ) then
        execute format('alter publication supabase_realtime add table public.%I',t);
      end if;
    end loop;
  end if;
end;
$function$;
