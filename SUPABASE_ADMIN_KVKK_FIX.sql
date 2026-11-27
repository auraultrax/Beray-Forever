-- Forever: A_UR_A_XX admin KVKK consent-gate compatibility fix
-- Apply to the Supabase project used by Forever.
--
-- Why this exists:
-- A_UR_A_XX is authenticated through the server-side forever_admins allow-list
-- and intentionally has no ordinary public.forever_documents users profile.
-- The versioned KVKK gate must still record the admin's explicit acceptance.
-- Normal users remain subject to the existing profile + Google/Apple checks.
--
-- No consent is backfilled by this migration. The admin must explicitly accept
-- the currently displayed consent text in the app before this audit row exists.

create or replace function private.aurax_record_consent(
  p_username text,
  p_consent_version text,
  p_consent_text_hash text,
  p_provider text,
  p_checked_at_client timestamp with time zone default null,
  p_ip_hash text default null,
  p_device_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_username text;
  v_provider text := coalesce(auth.jwt()->'app_metadata'->>'provider','');
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_is_allowlisted_admin boolean := false;
begin
  if v_uid is null then
    raise exception 'Oturum gerekli.' using errcode='42501';
  end if;

  -- Admin account is deliberately not required to have a normal users profile.
  -- Identify it only by the caller's signed JWT email plus the server-side allow-list.
  if lower(btrim(coalesce(p_username,'')))='a_ur_a_xx'
     and v_email <> ''
     and exists (
       select 1
       from public.forever_admins a
       where lower(a.email)=v_email
     )
  then
    v_username := 'A_UR_A_XX';
    v_is_allowlisted_admin := true;
  else
    select d.data->>'username'
      into v_username
    from public.forever_documents d
    where d.collection_name='users'
      and (d.id=v_uid::text or d.data->>'authUid'=v_uid::text)
    order by d.updated_at desc
    limit 1;
  end if;

  if v_username is null
     or lower(v_username) <> lower(btrim(coalesce(p_username,'')))
  then
    raise exception 'Hesap kimliği eşleşmiyor.' using errcode='42501';
  end if;

  if lower(v_username)='a_ur_a_xx' and not v_is_allowlisted_admin then
    raise exception 'Yönetici hesabı doğrulanamadı.' using errcode='42501';
  end if;

  if v_provider not in ('google','apple') or p_provider <> v_provider then
    raise exception 'Kimlik sağlayıcısı doğrulanamadı.' using errcode='42501';
  end if;

  if coalesce(p_consent_version,'')='' or p_consent_text_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'KVKK onayı geçersiz.' using errcode='22023';
  end if;

  insert into private.forever_consent_audit(
    user_id,username,provider,consent_version,consent_text_hash,ip_hash,device_hash
  )
  values(
    v_uid,v_username,v_provider,p_consent_version,p_consent_text_hash,
    nullif(p_ip_hash,''),nullif(p_device_hash,'')
  );

  update public.forever_private_user_data
  set consent_version=p_consent_version,
      consent_text_hash=p_consent_text_hash,
      ip_hash=nullif(p_ip_hash,''),
      device_hash=nullif(p_device_hash,''),
      auth_provider=v_provider
  where user_id=v_uid;

  return true;
end;
$function$;
