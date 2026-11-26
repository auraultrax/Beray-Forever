-- Move Education SECURITY DEFINER business logic into the non-exposed private schema.
-- Public RPC endpoints become SECURITY INVOKER wrappers; authenticated users can call
-- the public endpoints, but cannot select arbitrary private data through PostgREST.

create or replace function private.education_claim_teacher_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to ''
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

create or replace function private.education_decide_teacher_request(
  p_request_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_request public.education_teacher_requests%rowtype;
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

create or replace function private.education_assign_teacher(
  p_class_id uuid,
  p_teacher_id uuid,
  p_is_class_teacher boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_school_id uuid;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;
  select school_id into v_school_id
  from public.education_classes
  where id=p_class_id and is_active;
  if v_school_id is null then raise exception 'Sınıf bulunamadı.'; end if;
  if not private.education_is_school_admin(v_school_id) then
    raise exception 'Öğretmen atamak için okul yöneticisi olmalısın.';
  end if;
  if not exists (
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

create or replace function private.education_decide_student_request(
  p_request_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_request public.education_student_requests%rowtype;
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

create or replace function private.education_award_points(
  p_class_id uuid,
  p_student_id uuid,
  p_points integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_school_id uuid;
  v_point_id uuid;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;
  if p_points < 1 or p_points > 100 then raise exception 'Puan 1 ile 100 arasında olmalı.'; end if;
  if p_reason is not null and char_length(p_reason) > 250 then raise exception 'Açıklama çok uzun.'; end if;
  select school_id into v_school_id
  from public.education_classes
  where id=p_class_id and is_active;
  if v_school_id is null or not private.education_can_manage_class(p_class_id) then
    raise exception 'Bu sınıfta puan verme yetkin yok.';
  end if;
  if not exists (
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

create or replace function private.education_clear_board(p_class_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_school_id uuid;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;
  select school_id into v_school_id
  from public.education_classes
  where id=p_class_id and is_active;
  if v_school_id is null or not private.education_can_manage_class(p_class_id) then
    raise exception 'Tahtayı temizleme yetkin yok.';
  end if;
  insert into public.education_board_events(school_id,class_id,created_by,event_type,payload)
  values(v_school_id,p_class_id,auth.uid(),'clear','{}'::jsonb);
  return true;
end;
$function$;

revoke all on function private.education_claim_teacher_invite(text) from public, anon, authenticated;
revoke all on function private.education_decide_teacher_request(uuid,boolean) from public, anon, authenticated;
revoke all on function private.education_assign_teacher(uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function private.education_decide_student_request(uuid,boolean) from public, anon, authenticated;
revoke all on function private.education_award_points(uuid,uuid,integer,text) from public, anon, authenticated;
revoke all on function private.education_clear_board(uuid) from public, anon, authenticated;

-- Private function execution is granted only to authenticated users. The private
-- schema is not exposed through the API, so these are only reachable through the
-- public SECURITY INVOKER wrappers below.
grant execute on function private.education_claim_teacher_invite(text) to authenticated;
grant execute on function private.education_decide_teacher_request(uuid,boolean) to authenticated;
grant execute on function private.education_assign_teacher(uuid,uuid,boolean) to authenticated;
grant execute on function private.education_decide_student_request(uuid,boolean) to authenticated;
grant execute on function private.education_award_points(uuid,uuid,integer,text) to authenticated;
grant execute on function private.education_clear_board(uuid) to authenticated;

create or replace function public.education_claim_teacher_invite(p_token text)
returns jsonb
language sql
security invoker
set search_path to ''
as $function$
  select private.education_claim_teacher_invite(p_token);
$function$;

create or replace function public.education_decide_teacher_request(p_request_id uuid,p_approve boolean)
returns jsonb
language sql
security invoker
set search_path to ''
as $function$
  select private.education_decide_teacher_request(p_request_id,p_approve);
$function$;

create or replace function public.education_assign_teacher(
  p_class_id uuid,
  p_teacher_id uuid,
  p_is_class_teacher boolean default false
)
returns jsonb
language sql
security invoker
set search_path to ''
as $function$
  select private.education_assign_teacher(p_class_id,p_teacher_id,p_is_class_teacher);
$function$;

create or replace function public.education_decide_student_request(p_request_id uuid,p_approve boolean)
returns jsonb
language sql
security invoker
set search_path to ''
as $function$
  select private.education_decide_student_request(p_request_id,p_approve);
$function$;

create or replace function public.education_award_points(
  p_class_id uuid,
  p_student_id uuid,
  p_points integer,
  p_reason text default null
)
returns jsonb
language sql
security invoker
set search_path to ''
as $function$
  select private.education_award_points(p_class_id,p_student_id,p_points,p_reason);
$function$;

create or replace function public.education_clear_board(p_class_id uuid)
returns boolean
language sql
security invoker
set search_path to ''
as $function$
  select private.education_clear_board(p_class_id);
$function$;

revoke all on function public.education_claim_teacher_invite(text) from public,anon;
revoke all on function public.education_decide_teacher_request(uuid,boolean) from public,anon;
revoke all on function public.education_assign_teacher(uuid,uuid,boolean) from public,anon;
revoke all on function public.education_decide_student_request(uuid,boolean) from public,anon;
revoke all on function public.education_award_points(uuid,uuid,integer,text) from public,anon;
revoke all on function public.education_clear_board(uuid) from public,anon;

grant execute on function public.education_claim_teacher_invite(text) to authenticated;
grant execute on function public.education_decide_teacher_request(uuid,boolean) to authenticated;
grant execute on function public.education_assign_teacher(uuid,uuid,boolean) to authenticated;
grant execute on function public.education_decide_student_request(uuid,boolean) to authenticated;
grant execute on function public.education_award_points(uuid,uuid,integer,text) to authenticated;
grant execute on function public.education_clear_board(uuid) to authenticated;
