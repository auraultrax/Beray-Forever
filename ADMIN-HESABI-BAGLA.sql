-- ======================================================================
-- A_UR_A_XX YÖNETİCİ HESABINI BAĞLA (GÜNCEL SUPABASE ŞEMASI)
--
-- Yönetici kimliği public.forever_admins allow-list tablosuyla doğrulanır.
-- A_UR_A_XX için public.users veya public.account_links tablosu gerekmez.
-- Normal kullanıcı profillerine dokunulmaz; Auth şifresi değiştirilmez.
--
-- 1) v_email alanını Supabase Authentication > Users içindeki admin
--    hesabının doğrulanmış e-posta adresiyle değiştirin.
-- 2) Bu SQL'i Supabase SQL Editor'de proje sahibi olarak çalıştırın.
-- ======================================================================

do $$
declare
  v_email text := 'YOUR_ADMIN_EMAIL@example.com';
  v_uid uuid;
begin
  v_email := lower(btrim(v_email));

  if v_email = 'your_admin_email@example.com'
     or position('@' in v_email) < 2
  then
    raise exception 'Önce v_email alanına admin e-posta adresini yazın.';
  end if;

  select u.id
    into v_uid
  from auth.users u
  where lower(u.email) = v_email
    and u.email_confirmed_at is not null
  limit 1;

  if v_uid is null then
    raise exception 'Doğrulanmış admin hesabı auth.users içinde bulunamadı.';
  end if;

  insert into public.forever_admins(email)
  values (v_email)
  on conflict (email) do nothing;

  raise notice 'A_UR_A_XX admin yetkisi etkin. Auth UID: %', v_uid;
end
$$;

notify pgrst, 'reload schema';
