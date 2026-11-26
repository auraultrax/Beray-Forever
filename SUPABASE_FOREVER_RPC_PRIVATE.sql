-- Move the remaining exposed FOREVER SECURITY DEFINER room/follow logic
-- into the non-exposed private schema. Public RPC signatures stay compatible,
-- but their wrappers execute as INVOKER and only delegate to role-checking
-- private functions.

do $migration$
declare
  v_name text;
  v_def text;
  v_oid oid;
begin
  for v_name in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname = any(array[
        'forever_create_room',
        'forever_delete_room',
        'forever_invite_room_member',
        'forever_join_room',
        'forever_leave_room',
        'forever_moderate_room',
        'forever_set_room_admin',
        'forever_toggle_follow',
        'forever_update_room_settings'
      ])
      and p.prosecdef
  loop
    select p.oid into v_oid
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=v_name
    order by p.oid
    limit 1;

    if v_oid is null then
      raise exception 'Expected public function not found: %',v_name;
    end if;

    v_def := pg_get_functiondef(v_oid);
    v_def := replace(
      v_def,
      'FUNCTION public.' || v_name || '(',
      'FUNCTION private.' || v_name || '('
    );
    if v_def = pg_get_functiondef(v_oid) then
      raise exception 'Could not relocate function definition: %',v_name;
    end if;
    execute v_def;
  end loop;
end;
$migration$;

create or replace function public.forever_create_room(
  p_room_id text,
  p_room_name text,
  p_password text,
  p_username text,
  p_features jsonb default '{}'::jsonb
)
returns text
language sql
security invoker
set search_path to ''
as $function$
  select private.forever_create_room(p_room_id,p_room_name,p_password,p_username,p_features);
$function$;

create or replace function public.forever_delete_room(p_room_id text)
returns boolean
language sql
security invoker
set search_path to ''
as $function$
  select private.forever_delete_room(p_room_id);
$function$;

create or replace function public.forever_invite_room_member(
  p_room_id text,
  p_target_user uuid,
  p_username text
)
returns boolean
language sql
security invoker
set search_path to ''
as $function$
  select private.forever_invite_room_member(p_room_id,p_target_user,p_username);
$function$;

create or replace function public.forever_join_room(
  p_room_name text,
  p_password text,
  p_username text
)
returns text
language sql
security invoker
set search_path to ''
as $function$
  select private.forever_join_room(p_room_name,p_password,p_username);
$function$;

create or replace function public.forever_leave_room(p_room_id text)
returns boolean
language sql
security invoker
set search_path to ''
as $function$
  select private.forever_leave_room(p_room_id);
$function$;

create or replace function public.forever_moderate_room(
  p_room_id text,
  p_action text,
  p_message_id text default null,
  p_target_user uuid default null
)
returns boolean
language sql
security invoker
set search_path to ''
as $function$
  select private.forever_moderate_room(p_room_id,p_action,p_message_id,p_target_user);
$function$;

create or replace function public.forever_set_room_admin(
  p_room_id text,
  p_target_user uuid,
  p_make_admin boolean
)
returns jsonb
language sql
security invoker
set search_path to ''
as $function$
  select private.forever_set_room_admin(p_room_id,p_target_user,p_make_admin);
$function$;

create or replace function public.forever_toggle_follow(p_target_user uuid)
returns boolean
language sql
security invoker
set search_path to ''
as $function$
  select private.forever_toggle_follow(p_target_user);
$function$;

create or replace function public.forever_update_room_settings(
  p_room_id text,
  p_is_private boolean default null,
  p_messages_locked boolean default null,
  p_theme text default null
)
returns jsonb
language sql
security invoker
set search_path to ''
as $function$
  select private.forever_update_room_settings(p_room_id,p_is_private,p_messages_locked,p_theme);
$function$;

-- Private implementations must not be executable by anon or PUBLIC.
revoke all on function private.forever_create_room(text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function private.forever_delete_room(text) from public,anon,authenticated;
revoke all on function private.forever_invite_room_member(text,uuid,text) from public,anon,authenticated;
revoke all on function private.forever_join_room(text,text,text) from public,anon,authenticated;
revoke all on function private.forever_leave_room(text) from public,anon,authenticated;
revoke all on function private.forever_moderate_room(text,text,text,uuid) from public,anon,authenticated;
revoke all on function private.forever_set_room_admin(text,uuid,boolean) from public,anon,authenticated;
revoke all on function private.forever_toggle_follow(uuid) from public,anon,authenticated;
revoke all on function private.forever_update_room_settings(text,boolean,boolean,text) from public,anon,authenticated;

grant execute on function private.forever_create_room(text,text,text,text,jsonb) to authenticated;
grant execute on function private.forever_delete_room(text) to authenticated;
grant execute on function private.forever_invite_room_member(text,uuid,text) to authenticated;
grant execute on function private.forever_join_room(text,text,text) to authenticated;
grant execute on function private.forever_leave_room(text) to authenticated;
grant execute on function private.forever_moderate_room(text,text,text,uuid) to authenticated;
grant execute on function private.forever_set_room_admin(text,uuid,boolean) to authenticated;
grant execute on function private.forever_toggle_follow(uuid) to authenticated;
grant execute on function private.forever_update_room_settings(text,boolean,boolean,text) to authenticated;

revoke all on function public.forever_create_room(text,text,text,text,jsonb) from public,anon;
revoke all on function public.forever_delete_room(text) from public,anon;
revoke all on function public.forever_invite_room_member(text,uuid,text) from public,anon;
revoke all on function public.forever_join_room(text,text,text) from public,anon;
revoke all on function public.forever_leave_room(text) from public,anon;
revoke all on function public.forever_moderate_room(text,text,text,uuid) from public,anon;
revoke all on function public.forever_set_room_admin(text,uuid,boolean) from public,anon;
revoke all on function public.forever_toggle_follow(uuid) from public,anon;
revoke all on function public.forever_update_room_settings(text,boolean,boolean,text) from public,anon;

grant execute on function public.forever_create_room(text,text,text,text,jsonb) to authenticated;
grant execute on function public.forever_delete_room(text) to authenticated;
grant execute on function public.forever_invite_room_member(text,uuid,text) to authenticated;
grant execute on function public.forever_join_room(text,text,text) to authenticated;
grant execute on function public.forever_leave_room(text) to authenticated;
grant execute on function public.forever_moderate_room(text,text,text,uuid) to authenticated;
grant execute on function public.forever_set_room_admin(text,uuid,boolean) to authenticated;
grant execute on function public.forever_toggle_follow(uuid) to authenticated;
grant execute on function public.forever_update_room_settings(text,boolean,boolean,text) to authenticated;
