-- Correct the actor recorded for updates. The creator/opening user is not necessarily
-- the administrator who later changes or closes the record.

create or replace function private.education_audit_row_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_school_id uuid;
  v_action text;
  v_target_type text := tg_table_name;
  v_target_id text;
  v_target_user uuid;
  v_details jsonb := '{}'::jsonb;
begin
  v_school_id := coalesce(new.school_id,old.school_id);

  if tg_table_name = 'education_classes' then
    v_target_id := coalesce(new.id,old.id)::text;
    if tg_op = 'INSERT' then
      v_actor := coalesce(new.created_by,v_actor);
      v_action := 'class_created';
      v_details := jsonb_build_object('grade_level',new.grade_level,'section',new.section);
    elsif tg_op = 'UPDATE' then
      v_action := 'class_updated';
      v_details := jsonb_build_object('active',new.is_active);
    else
      v_action := 'class_deleted';
    end if;

  elsif tg_table_name = 'education_teacher_invites' then
    v_target_id := coalesce(new.id,old.id)::text;
    if tg_op = 'INSERT' then
      v_actor := coalesce(new.created_by,v_actor);
      v_action := 'teacher_invite_created';
      v_details := jsonb_build_object('class_id',new.class_id,'target_username',new.target_username,'expires_at',new.expires_at);
    elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
      v_action := 'teacher_invite_status_changed';
      v_target_user := new.claimed_by;
      v_details := jsonb_build_object('from',old.status,'to',new.status);
    end if;

  elsif tg_table_name = 'education_student_requests' then
    v_target_id := coalesce(new.id,old.id)::text;
    v_target_user := coalesce(new.user_id,old.user_id);
    if tg_op = 'INSERT' then
      v_actor := coalesce(new.user_id,v_actor);
      v_action := 'student_request_created';
      v_details := jsonb_build_object('class_id',new.class_id);
    elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
      v_actor := coalesce(new.reviewed_by,v_actor);
      v_action := 'student_request_status_changed';
      v_details := jsonb_build_object('from',old.status,'to',new.status,'reviewed_by',new.reviewed_by);
    end if;

  elsif tg_table_name = 'education_class_board_state' then
    v_target_id := coalesce(new.class_id,old.class_id)::text;
    v_actor := coalesce(new.updated_by,v_actor);
    if tg_op = 'INSERT' then
      v_action := 'board_state_created';
      v_details := jsonb_build_object('students_can_draw',new.students_can_draw);
    elsif tg_op = 'UPDATE' and old.students_can_draw is distinct from new.students_can_draw then
      v_action := 'board_student_draw_permission_changed';
      v_details := jsonb_build_object('students_can_draw',new.students_can_draw);
    end if;

  elsif tg_table_name = 'education_class_sessions' then
    v_target_id := coalesce(new.id,old.id)::text;
    if tg_op = 'INSERT' then
      v_actor := coalesce(new.opened_by,v_actor);
      v_action := 'class_session_opened';
    elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
      v_action := case when new.status = 'closed' then 'class_session_closed' else 'class_session_status_changed' end;
    end if;
  end if;

  if v_action is not null and v_school_id is not null then
    insert into public.education_audit_log(
      school_id,actor_user_id,action,target_user_id,target_type,target_id,details
    )
    values(v_school_id,v_actor,v_action,v_target_user,v_target_type,v_target_id,v_details);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function private.education_audit_row_change() from public,anon,authenticated;
