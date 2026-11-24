-- ======================================================================
-- A_UR_A_XX YÖNETİCİ HESABINI BAĞLA
--
-- Güvenli kurulum:
-- 1) Yönetici hesabını Supabase Dashboard > Authentication > Users
--    bölümünden kendin oluştur ve e-postasını onayla.
-- 2) Aşağıdaki v_email değerini bu hesabın e-posta adresiyle değiştir.
-- 3) Bu dosyayı Supabase SQL Editor'de proje sahibi olarak çalıştır.
--
-- Bu dosya parola oluşturmaz/değiştirmez ve auth.users.encrypted_password
-- alanına dokunmaz. Yönetici rolünü yalnızca SQL Editor'den çalıştırılan
-- bu kurulum adımı atar; tarayıcı istemcisine ayrıcalık vermez.
-- ======================================================================

do $$
declare
  v_email    text := 'YOUR_ADMIN_EMAIL@example.com'; -- Supabase Auth'taki yönetici e-postası
  v_username text := 'A_UR_A_XX';
  v_uid      uuid;
  v_now_ms   bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if v_email = 'YOUR_ADMIN_EMAIL@example.com' or position('@' in v_email) < 2 then
    raise exception 'Önce v_email alanına Supabase Auth yönetici e-posta adresini yaz.';
  end if;

  select id into v_uid
    from auth.users
   where lower(email) = lower(btrim(v_email))
   limit 1;

  if v_uid is null then
    raise exception 'Bu e-posta Authentication > Users listesinde yok. Önce yönetici hesabını oluştur.';
  end if;

  if not exists (
    select 1 from auth.users
     where id = v_uid and email_confirmed_at is not null
  ) then
    raise exception 'Yönetici e-postası henüz doğrulanmamış. Önce Supabase Auth üzerinden doğrula.';
  end if;

  insert into public.users (id, data)
  values (v_username, jsonb_build_object(
    'username', v_username,
    'firstName', 'A_UR_A',
    'lastName', 'XX',
    'displayName', 'A_UR_A_XX',
    'authUid', v_uid::text,
    'authEmail', lower(btrim(v_email)),
    'authProvider', 'email',
    'role', 'admin',
    'restricted', false,
    'banned', false,
    'votes', 0,
    'followers', '[]'::jsonb,
    'following', '[]'::jsonb,
    'verified', true,
    'special', true,
    'createdAt', v_now_ms,
    'lastSeenAt', v_now_ms
  ))
  on conflict (id) do update
    set data = public.users.data || jsonb_build_object(
      'authUid', v_uid::text,
      'authEmail', lower(btrim(v_email)),
      'role', 'admin'
    );

  insert into public.account_links (id, data)
  values (v_uid::text, jsonb_build_object(
    'username', v_username,
    'authUid', v_uid::text,
    'createdAt', v_now_ms
  ))
  on conflict (id) do update
    set data = public.account_links.data || jsonb_build_object(
      'username', v_username,
      'authUid', v_uid::text
    );

  raise notice 'Tamam: % (%) yönetici olarak bağlandı. Forever girişinde kullanıcı adı A_UR_A_XX kullan.', v_username, v_uid;
end $$;
