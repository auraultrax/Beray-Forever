-- Education tenant-boundary integrity fixes for FOREVER.
-- Corrects unqualified RLS subquery references and enforces class -> school ownership
-- on every table that stores both a school_id and class_id.

create or replace function private.education_enforce_school_class_match()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_school_id uuid;
begin
  if new.class_id is null then
    return new;
  end if;

  select c.school_id into v_school_id
  from public.education_classes c
  where c.id = new.class_id;

  if v_school_id is null or v_school_id is distinct from new.school_id then
    raise exception 'Sınıf bu okula ait değil veya sınıf bulunamadı.';
  end if;
  return new;
end;
$function$;

revoke all on function private.education_enforce_school_class_match() from public, anon, authenticated;

drop trigger if exists education_teacher_assignments_school_match on public.education_teacher_assignments;
create trigger education_teacher_assignments_school_match
before insert or update of class_id, school_id on public.education_teacher_assignments
for each row execute function private.education_enforce_school_class_match();

drop trigger if exists education_teacher_invites_school_match on public.education_teacher_invites;
create trigger education_teacher_invites_school_match
before insert or update of class_id, school_id on public.education_teacher_invites
for each row execute function private.education_enforce_school_class_match();

drop trigger if exists education_teacher_requests_school_match on public.education_teacher_requests;
create trigger education_teacher_requests_school_match
before insert or update of class_id, school_id on public.education_teacher_requests
for each row execute function private.education_enforce_school_class_match();

drop trigger if exists education_student_requests_school_match on public.education_student_requests;
create trigger education_student_requests_school_match
before insert or update of class_id, school_id on public.education_student_requests
for each row execute function private.education_enforce_school_class_match();

drop trigger if exists education_class_students_school_match on public.education_class_students;
create trigger education_class_students_school_match
before insert or update of class_id, school_id on public.education_class_students
for each row execute function private.education_enforce_school_class_match();

drop trigger if exists education_class_feed_school_match on public.education_class_feed;
create trigger education_class_feed_school_match
before insert or update of class_id, school_id on public.education_class_feed
for each row execute function private.education_enforce_school_class_match();

drop trigger if exists education_class_points_school_match on public.education_class_points;
create trigger education_class_points_school_match
before insert or update of class_id, school_id on public.education_class_points
for each row execute function private.education_enforce_school_class_match();

drop trigger if exists education_class_board_state_school_match on public.education_class_board_state;
create trigger education_class_board_state_school_match
before insert or update of class_id, school_id on public.education_class_board_state
for each row execute function private.education_enforce_school_class_match();

drop trigger if exists education_board_events_school_match on public.education_board_events;
create trigger education_board_events_school_match
before insert or update of class_id, school_id on public.education_board_events
for each row execute function private.education_enforce_school_class_match();

drop trigger if exists education_class_sessions_school_match on public.education_class_sessions;
create trigger education_class_sessions_school_match
before insert or update of class_id, school_id on public.education_class_sessions
for each row execute function private.education_enforce_school_class_match();

drop trigger if exists education_audio_requests_school_match on public.education_audio_requests;
create trigger education_audio_requests_school_match
before insert or update of class_id, school_id on public.education_audio_requests
for each row execute function private.education_enforce_school_class_match();

-- A student who already has an active class membership cannot submit another join request.
-- A user's unrelated role in a different school must not block joining this school.
drop policy if exists education_student_requests_insert_self on public.education_student_requests;
create policy education_student_requests_insert_self
on public.education_student_requests
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and username = private.education_current_username()
  and status = 'pending'
  and exists (
    select 1 from public.education_classes c
    where c.id = education_student_requests.class_id
      and c.school_id = education_student_requests.school_id
      and c.is_active
  )
  and not exists (
    select 1 from public.education_class_students cs
    where cs.class_id = education_student_requests.class_id
      and cs.student_id = (select auth.uid())
      and cs.is_active
  )
  and not exists (
    select 1 from public.education_school_members m
    where m.school_id = education_student_requests.school_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role in ('school_admin','teacher')
  )
);

-- Students can draw only when enrolled in the exact target class, not merely any class.
drop policy if exists education_board_events_insert on public.education_board_events;
create policy education_board_events_insert
on public.education_board_events
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.education_classes c
    where c.id = education_board_events.class_id
      and c.school_id = education_board_events.school_id
  )
  and (
    private.education_can_manage_class(education_board_events.class_id)
    or (
      private.education_student_draw_allowed(education_board_events.class_id)
      and exists (
        select 1 from public.education_class_students cs
        where cs.class_id = education_board_events.class_id
          and cs.school_id = education_board_events.school_id
          and cs.student_id = (select auth.uid())
          and cs.is_active
      )
    )
  )
);

-- A student may request audio moderation only for a class they actually belong to.
-- A teacher/admin may request it only for a currently enrolled student.
drop policy if exists education_audio_requests_insert on public.education_audio_requests;
create policy education_audio_requests_insert
on public.education_audio_requests
for insert to authenticated
with check (
  requested_by = (select auth.uid())
  and exists (
    select 1 from public.education_class_sessions cs
    where cs.id = education_audio_requests.session_id
      and cs.class_id = education_audio_requests.class_id
      and cs.school_id = education_audio_requests.school_id
      and cs.status = 'live'
  )
  and (
    (
      private.education_can_manage_class(education_audio_requests.class_id)
      and exists (
        select 1 from public.education_class_students cs
        where cs.class_id = education_audio_requests.class_id
          and cs.school_id = education_audio_requests.school_id
          and cs.student_id = education_audio_requests.student_id
          and cs.is_active
      )
    )
    or (
      education_audio_requests.student_id = (select auth.uid())
      and private.education_is_class_member(education_audio_requests.class_id)
    )
  )
);
