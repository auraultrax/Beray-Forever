-- Enable Realtime notifications for role-scoped Education approvals.
-- Supabase Realtime still applies each table's RLS policies to subscribed users.
do $function$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    foreach t in array array[
      'education_student_requests',
      'education_teacher_requests'
    ] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname='supabase_realtime'
          and schemaname='public'
          and tablename=t
      ) then
        execute format('alter publication supabase_realtime add table public.%I',t);
      end if;
    end loop;
  end if;
end;
$function$;
