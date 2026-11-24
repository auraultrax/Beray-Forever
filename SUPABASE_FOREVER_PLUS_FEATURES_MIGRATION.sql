-- ============================================================================
-- FOREVER PLUS FEATURE ENFORCEMENT
-- Apply after SUPABASE_TUM_KURULUM.sql on an existing installation.
-- Included by the consolidated setup for new installations.
-- ============================================================================

-- Enforce Discover text-only posting and stamp every new Plus post with a
-- server-generated 12-hour boost. Client JSON cannot forge or extend the boost.
create or replace function public.aurax_guard_plus_post_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text;
  v_is_admin boolean := false;
  v_is_plus boolean := false;
  v_has_media boolean := false;
  v_text text := '';
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_content_changed boolean := false;
begin
  -- Trusted SQL Editor / service_role maintenance writes are not user posts.
  if auth.uid() is null then
    return new;
  end if;

  v_is_admin := public.aurax_base_is_admin(auth.uid());
  v_actor := public.aurax_base_current_username(auth.uid());
  v_is_plus := public.aurax_base_is_plus_user(auth.uid());

  v_text := btrim(coalesce(new.data ->> 'text', ''));
  v_has_media :=
       nullif(btrim(coalesce(new.data ->> 'image', '')), '') is not null
    or nullif(btrim(coalesce(new.data ->> 'video', '')), '') is not null
    or (
      coalesce(jsonb_typeof(new.data -> 'images'), '') = 'array'
      and exists (
        select 1
        from jsonb_array_elements_text(new.data -> 'images') as image_values(image_value)
        where btrim(image_value) <> ''
      )
    );

  if tg_op = 'INSERT' then
    if not v_is_admin and (v_actor is null or new.data ->> 'author' is distinct from v_actor) then
      raise exception 'Gönderi yalnızca oturum açmış kullanıcının kendi adıyla yayınlanabilir.' using errcode = '42501';
    end if;

    if not v_is_admin and v_text <> '' and not v_has_media and not v_is_plus then
      raise exception 'Keşfet''te yalnızca metin içeren gönderiler Forever Plus üyelerine özeldir. Fotoğraf veya video ekleyin.' using errcode = '42501';
    end if;
    if not v_is_admin and v_text = '' and not v_has_media then
      raise exception 'Gönderi metin, fotoğraf veya video içermelidir.' using errcode = '22023';
    end if;

    -- Ignore any boost fields supplied by the browser and calculate them here.
    new.data := coalesce(new.data, '{}'::jsonb) - 'plusBoostedAt' - 'plusBoostUntil';
    if not v_is_admin and v_is_plus then
      new.data := new.data || jsonb_build_object(
        'plusBoostedAt', v_now_ms,
        'plusBoostUntil', v_now_ms + 43200000
      );
    end if;
    return new;
  end if;

  -- The author cannot be reassigned through a client-side JSON document update.
  if not v_is_admin and new.data ->> 'author' is distinct from old.data ->> 'author' then
    raise exception 'Gönderi sahibi değiştirilemez.' using errcode = '42501';
  end if;

  v_content_changed :=
       new.data -> 'text' is distinct from old.data -> 'text'
    or new.data -> 'image' is distinct from old.data -> 'image'
    or new.data -> 'images' is distinct from old.data -> 'images'
    or new.data -> 'video' is distinct from old.data -> 'video';

  if v_content_changed and not v_is_admin then
    if v_actor is null or new.data ->> 'author' is distinct from v_actor then
      raise exception 'Başka bir kullanıcının gönderi içeriği değiştirilemez.' using errcode = '42501';
    end if;
    if v_text <> '' and not v_has_media and not v_is_plus then
      raise exception 'Yalnızca metin içeren gönderiyi düzenlemek Forever Plus üyelerine özeldir.' using errcode = '42501';
    end if;
    if v_text = '' and not v_has_media then
      raise exception 'Gönderi metin, fotoğraf veya video içermelidir.' using errcode = '22023';
    end if;
  end if;

  -- Preserve the original server stamp. Likes/comments/edits cannot reset the timer.
  new.data := coalesce(new.data, '{}'::jsonb) - 'plusBoostedAt' - 'plusBoostUntil';
  if old.data ? 'plusBoostedAt' then
    new.data := jsonb_set(new.data, '{plusBoostedAt}', old.data -> 'plusBoostedAt', true);
  end if;
  if old.data ? 'plusBoostUntil' then
    new.data := jsonb_set(new.data, '{plusBoostUntil}', old.data -> 'plusBoostUntil', true);
  end if;

  return new;
end;
$$;
revoke all on function public.aurax_guard_plus_post_rules() from public, anon, authenticated;
drop trigger if exists aurax_guard_plus_post_rules on public.posts;
create trigger aurax_guard_plus_post_rules
before insert or update on public.posts
for each row execute function public.aurax_guard_plus_post_rules();

-- Normal accounts cannot add the built-in Forever animated sticker pack to a
-- room by bypassing the UI and editing rooms.data.messages directly.
create or replace function public.aurax_guard_room_plus_stickers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean := false;
  v_is_plus boolean := false;
  v_new_messages jsonb := '[]'::jsonb;
  v_old_messages jsonb := '[]'::jsonb;
  v_message jsonb;
  v_message_id text;
  v_image text;
begin
  if auth.uid() is null then
    return new;
  end if;

  v_is_admin := public.aurax_base_is_admin(auth.uid());
  if v_is_admin then
    return new;
  end if;
  v_is_plus := public.aurax_base_is_plus_user(auth.uid());
  if v_is_plus then
    return new;
  end if;

  if jsonb_typeof(new.data -> 'messages') = 'array' then
    v_new_messages := new.data -> 'messages';
  end if;
  if tg_op = 'UPDATE' and jsonb_typeof(old.data -> 'messages') = 'array' then
    v_old_messages := old.data -> 'messages';
  end if;

  for v_message in
    select value
    from jsonb_array_elements(v_new_messages)
    where coalesce(value ->> 'img', '') like '%/stickers/forever-pack/%'
  loop
    v_message_id := coalesce(v_message ->> 'id', '');
    v_image := coalesce(v_message ->> 'img', '');
    if not exists (
      select 1
      from jsonb_array_elements(v_old_messages) as prior(value)
      where coalesce(prior.value ->> 'id', '') = v_message_id
        and coalesce(prior.value ->> 'img', '') = v_image
    ) then
      raise exception 'Forever özgün animasyonlu çıkartma paketi yalnızca Plus üyelerine açıktır.' using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;
revoke all on function public.aurax_guard_room_plus_stickers() from public, anon, authenticated;
drop trigger if exists aurax_guard_room_plus_stickers on public.rooms;
create trigger aurax_guard_room_plus_stickers
before insert or update on public.rooms
for each row execute function public.aurax_guard_room_plus_stickers();

notify pgrst, 'reload schema';
