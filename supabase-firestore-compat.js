import { supabase } from './supabase-client.js';

export const db = supabase;
let currentMappedUser = null;
export const auth = {};
Object.defineProperty(auth, 'currentUser', { get: () => currentMappedUser });

function mapUser(user) {
  if (!user) return null;
  const providers = user.app_metadata?.providers || [];
  return {
    ...user,
    uid: user.id,
    displayName: user.user_metadata?.display_name || user.user_metadata?.full_name || user.user_metadata?.name || '',
    emailVerified: !!(user.email_confirmed_at || user.confirmed_at),
    providerData: providers.map(providerId => ({ providerId: providerId === 'email' ? 'password' : providerId }))
  };
}

function raise(error) {
  if (!error) return;
  const e = new Error(error.message || 'Supabase işlemi başarısız.');
  e.code = error.code || error.status || 'supabase/error';
  e.status = error.status;
  throw e;
}

export function onAuthStateChanged(_auth, callback) {
  let active = true;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    currentMappedUser = mapUser(session?.user || null);
    if (active) queueMicrotask(() => callback(currentMappedUser));
  });
  supabase.auth.getSession().then(({ data: sessionData }) => {
    if (!active) return;
    currentMappedUser = mapUser(sessionData.session?.user || null);
    callback(currentMappedUser);
  }).catch(() => {});
  return () => {
    active = false;
    data.subscription.unsubscribe();
  };
}

export async function signInWithEmailAndPassword(_auth, email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  raise(error);
  currentMappedUser = mapUser(data.user);
  return { user: currentMappedUser };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  raise(error);
  currentMappedUser = null;
}

export async function sendPasswordResetEmail(_auth, email) {
  const redirectTo = new URL('./index.html', window.location.href).href;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  raise(error);
}

export async function updateProfile(_user, profile) {
  const { data, error } = await supabase.auth.updateUser({
    data: { display_name: profile.displayName || '' }
  });
  raise(error);
  currentMappedUser = mapUser(data.user);
  return data.user;
}

export class GoogleAuthProvider {
  setCustomParameters() {}
}

export async function signInWithPopup(_auth, _provider) {
  const redirectTo = window.location.href.split('#')[0];
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: { prompt: 'select_account' }
    }
  });
  raise(error);
  if (data?.url) {
    window.location.assign(data.url);
    return new Promise(() => {});
  }
  throw new Error('Google giriş yönlendirmesi başlatılamadı.');
}

const OP = {
  timestamp: '__server_timestamp__',
  delete: '__delete_field__',
  union: '__array_union__',
  remove: '__array_remove__',
  increment: '__increment__'
};

export const serverTimestamp = () => ({ __op: OP.timestamp });
export const deleteField = () => ({ __op: OP.delete });
export const arrayUnion = (...values) => ({ __op: OP.union, values });
export const arrayRemove = (...values) => ({ __op: OP.remove, values });
export const increment = value => ({ __op: OP.increment, value });

export function collection(_db, ...parts) {
  return { __kind: 'collection', path: parts.join('/') };
}
export function doc(_db, ...parts) {
  if (parts.length < 2) throw new Error('Belge yolu eksik.');
  return { __kind: 'document', path: parts.slice(0, -1).join('/'), id: String(parts.at(-1)) };
}
export function where(field, op, value) { return { __constraint: 'where', field, op, value }; }
export function orderBy(field, direction = 'asc') { return { __constraint: 'orderBy', field, direction }; }
export function limit(value) { return { __constraint: 'limit', value: Math.max(1, Math.min(500, Number(value) || 1)) }; }
export function query(ref, ...constraints) {
  return { ...ref, constraints: constraints.filter(Boolean) };
}

function tableFor(path) {
  if (path.startsWith('rooms/') && path.endsWith('/messages')) {
    return { table: 'room_messages', roomId: path.split('/')[1] };
  }
  const map = {
    users: 'profiles',
    usernames: 'profiles',
    privateProfiles: 'private_profiles',
    posts: 'posts',
    stories: 'stories',
    blocks: 'blocks',
    reports: 'reports',
    notifications: 'notifications',
    rooms: 'rooms',
    modlogs: 'admin_activity_logs',
    plusApplications: 'plus_applications',
    stickers: 'stickers',
    drawings: 'drawings',
    conversations: 'conversations'
  };
  const table = map[path];
  if (!table) throw new Error('Desteklenmeyen Supabase koleksiyonu: ' + path);
  return { table };
}

function ts(value) {
  if (!value) return null;
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(ms)) return null;
  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: Math.floor((ms % 1000) * 1000000),
    toMillis: () => ms
  };
}
function dateValue(value) {
  if (value && typeof value === 'object' && value.__op === OP.timestamp) return undefined;
  if (value && typeof value === 'object' && typeof value.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
  return value;
}
function docSnap(id, value) {
  const exists = value !== null && value !== undefined;
  return {
    id,
    exists: () => exists,
    data: () => exists ? value : undefined
  };
}
function querySnap(rows) {
  const docs = rows.map(row => docSnap(row.id, row));
  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
    forEach: callback => docs.forEach(callback)
  };
}
function columnFor(table, field) {
  const common = {
    userId: 'user_id', uid: 'user_id', createdAt: 'created_at', updatedAt: 'updated_at',
    authorName: 'author_name', mediaUrl: 'media_url', imageUrl: 'media_url',
    mediaType: 'media_type', ownerUid: 'owner_id', senderUid: 'sender_id',
    senderName: 'sender_name', toUid: 'user_id', fromUid: 'actor_id',
    reporterId: 'reporter_id', targetId: 'target_id', adminUid: 'admin_id',
    targetUid: 'target_user_id'
  };
  if (table === 'plus_applications' && field === 'uid') return 'user_id';
  if (table === 'rooms' && field === 'visibility') return 'visibility';
  if (table === 'room_messages' && field === 'senderUid') return 'sender_id';
  return common[field] || field.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
}
function isoFromTimestamp(value) {
  if (value && typeof value === 'object' && typeof value.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
  return value;
}

async function hydrateProfile(row) {
  if (!row) return null;
  const uid = row.id;
  const [following, followers, blocked, saved, restriction, roomCount] = await Promise.all([
    supabase.from('follows').select('following_id').eq('follower_id', uid),
    supabase.from('follows').select('follower_id').eq('following_id', uid),
    supabase.from('blocks').select('blocked_id').eq('blocker_id', uid),
    supabase.from('saved_posts').select('post_id').eq('user_id', uid),
    supabase.from('account_restrictions').select('*').eq('user_id', uid).maybeSingle(),
    supabase.from('rooms').select('id', { count: 'exact', head: true }).eq('owner_id', uid)
  ]);
  for (const r of [following, followers, blocked, saved, restriction, roomCount]) if (r?.error && r.error.code !== 'PGRST116') raise(r.error);
  const a = restriction.data || {};
  return {
    uid,
    username: row.onboarding_complete === false ? '' : row.username,
    displayName: row.display_name || '',
    avatarUrl: row.avatar_url || '',
    bio: row.bio || '',
    region: row.region || '',
    plusMember: row.plus_member === true,
    plusGrantedAt: ts(row.plus_granted_at),
    following: (following.data || []).map(x => x.following_id),
    followers: (followers.data || []).map(x => x.follower_id),
    blocked: (blocked.data || []).map(x => x.blocked_id),
    savedPosts: (saved.data || []).map(x => x.post_id),
    suspended: a.suspended === true,
    banned: a.banned === true,
    restrictedUntil: a.restricted_until ? new Date(a.restricted_until).getTime() : 0,
    suspendedReason: a.reason || '',
    suspendedMessage: a.message || '',
    roomCount: roomCount.count || 0,
    createdAt: ts(row.created_at)
  };
}

async function hydratePosts(rows) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [likes, comments] = await Promise.all([
    supabase.from('post_likes').select('post_id,user_id').in('post_id', ids),
    supabase.from('post_comments').select('*').in('post_id', ids).order('created_at', { ascending: true })
  ]);
  raise(likes.error); raise(comments.error);
  return rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    authorName: row.author_name || '',
    content: row.content || '',
    tags: row.tags || [],
    imageUrl: row.media_url || '',
    mediaType: row.media_type || null,
    likes: (likes.data || []).filter(x => x.post_id === row.id).map(x => x.user_id),
    comments: (comments.data || []).filter(x => x.post_id === row.id).map(x => ({
      id: x.id, userId: x.user_id, author: x.author_name, text: x.content, createdAt: isoFromTimestamp(x.created_at)
    })),
    poll: row.poll || null,
    sparks: row.sparks || 0,
    createdAt: ts(row.created_at)
  }));
}

async function hydrateRoom(row) {
  if (!row) return null;
  const [members, owner] = await Promise.all([
    supabase.from('room_members').select('user_id').eq('room_id', row.id),
    supabase.from('profiles').select('display_name').eq('id', row.owner_id).maybeSingle()
  ]);
  raise(members.error); raise(owner.error);
  return {
    id: row.id, ownerUid: row.owner_id, ownerName: owner.data?.display_name || '',
    name: row.name, description: row.description || '', visibility: row.visibility,
    memberUids: (members.data || []).map(x => x.user_id), createdAt: ts(row.created_at)
  };
}

function mapSimple(table, row) {
  if (table === 'stories') return {
    id: row.id, userId: row.user_id, imageUrl: row.media_url, mediaType: row.media_type,
    createdAt: ts(row.created_at), expiresAt: ts(row.expires_at)
  };
  if (table === 'room_messages') return {
    id: row.id, senderUid: row.sender_id, senderName: row.sender_name || '',
    text: row.content || '', mediaUrl: row.media_path || '', mediaType: row.media_type || null,
    createdAt: ts(row.created_at)
  };
  if (table === 'notifications') return {
    id: row.id, toUid: row.user_id, fromUid: row.actor_id, fromName: '',
    type: row.kind, text: row.body, read: !!row.read_at, createdAt: ts(row.created_at)
  };
  if (table === 'reports') return {
    id: row.id, reporterId: row.reporter_id, type: row.content_type, targetId: row.target_id,
    reason: row.reason, status: row.status, createdAt: ts(row.created_at)
  };
  if (table === 'plus_applications') return {
    id: row.id, uid: row.user_id, reason: row.reason, status: row.status,
    adminNote: row.admin_note, createdAt: ts(row.created_at)
  };
  if (table === 'admin_activity_logs') return {
    id: String(row.id), adminUid: row.admin_id, action: row.action,
    targetUid: row.target_user_id || '', detail: typeof row.detail === 'string' ? row.detail : JSON.stringify(row.detail || {}),
    createdAt: ts(row.created_at)
  };
  return { ...row, createdAt: ts(row.created_at) };
}

async function mapRow(path, row) {
  if (!row) return null;
  const { table } = tableFor(path);
  if (path === 'users') return hydrateProfile(row);
  if (path === 'usernames') return { uid: row.id, createdAt: ts(row.created_at) };
  if (path === 'privateProfiles') return {
    uid: row.user_id, dateOfBirth: row.date_of_birth || '', updatedAt: ts(row.updated_at)
  };
  if (path === 'posts') return (await hydratePosts([row]))[0];
  if (path === 'rooms') return hydrateRoom(row);
  return mapSimple(table, row);
}

async function applyConstraints(builder, table, constraints, roomId) {
  let q = builder;
  if (roomId) q = q.eq('room_id', roomId);
  for (const c of constraints || []) {
    if (c.__constraint === 'where') {
      const field = c.field;
      if (table === 'rooms' && field === 'memberUids' && c.op === 'array-contains') {
        const memberships = await supabase.from('room_members').select('room_id').eq('user_id', c.value);
        raise(memberships.error);
        const roomIds = (memberships.data || []).map(x => x.room_id);
        q = roomIds.length ? q.in('id', roomIds) : q.eq('id', '00000000-0000-0000-0000-000000000000');
      } else {
        const col = columnFor(table, field);
        if (c.op === '==') q = q.eq(col, c.value);
        else if (c.op === '!=') q = q.neq(col, c.value);
        else if (c.op === 'array-contains' && table === 'posts' && field === 'tags') q = q.contains(col, [c.value]);
        else if (c.op === 'in') q = q.in(col, c.value);
      }
    } else if (c.__constraint === 'orderBy') {
      q = q.order(columnFor(table, c.field), { ascending: c.direction !== 'desc' });
    } else if (c.__constraint === 'limit') {
      q = q.limit(c.value);
    }
  }
  return q;
}

async function loadRows(ref) {
  const { table, roomId } = tableFor(ref.path);
  let builder = supabase.from(table).select('*');
  builder = await applyConstraints(builder, table, ref.constraints, roomId);
  if (!ref.constraints?.some(x => x.__constraint === 'limit')) builder = builder.limit(200);
  const { data, error } = await builder;
  raise(error);
  const result = [];
  for (const row of data || []) {
    const mapped = await mapRow(ref.path, row);
    if (mapped) result.push(mapped);
  }
  return result;
}

export async function getDoc(ref) {
  const { table } = tableFor(ref.path);
  if (ref.path === 'usernames') {
    const { data, error } = await supabase.from('profiles').select('*').eq('username', ref.id).maybeSingle();
    raise(error);
    return docSnap(ref.id, data ? { uid: data.id, createdAt: ts(data.created_at) } : null);
  }
  let builder = supabase.from(table).select('*');
  if (ref.path === 'blocks') {
    const [blockerId, blockedId] = ref.id.split('_');
    builder = builder.eq('blocker_id', blockerId).eq('blocked_id', blockedId);
  } else if (ref.path === 'privateProfiles') builder = builder.eq('user_id', ref.id);
  else if (ref.path === 'modlogs') builder = builder.eq('id', Number(ref.id));
  else if (ref.path === 'rooms/unused') builder = builder.eq('id', ref.id);
  else if (ref.path.startsWith('rooms/')) builder = builder.eq('room_id', ref.path.split('/')[1]).eq('id', ref.id);
  else builder = builder.eq(ref.path === 'users' ? 'id' : 'id', ref.id);
  const { data, error } = await builder.maybeSingle();
  raise(error);
  return docSnap(ref.id, await mapRow(ref.path, data));
}

export async function getDocs(ref) {
  return querySnap(await loadRows(ref));
}

async function saveProfile(uid, input, merge) {
  const payload = {};
  const mapping = {
    username: 'username', displayName: 'display_name', avatarUrl: 'avatar_url',
    bio: 'bio', region: 'region'
  };
  for (const [key, col] of Object.entries(mapping)) {
    if (Object.prototype.hasOwnProperty.call(input, key) && input[key]?.__op !== OP.delete) payload[col] = input[key];
  }
  if (Object.prototype.hasOwnProperty.call(input, 'username')) payload.onboarding_complete = true;
  if (!merge) payload.id = uid;
  if (Object.keys(payload).length) {
    const action = merge ? supabase.from('profiles').update(payload).eq('id', uid)
      : supabase.from('profiles').upsert({ id: uid, username: input.username || ('member_' + uid.replaceAll('-', '').slice(0,12)), ...payload });
    const { error } = await action;
    raise(error);
  }
  for (const field of ['following','followers','blocked','savedPosts']) {
    if (Array.isArray(input[field]) && input[field].length) {
      const op = { __op: OP.union, values: input[field] };
      await mutateUserRelation(uid, field, op);
    }
  }
}

async function mutateUserRelation(uid, field, op) {
  const values = op.values || [];
  const removing = op.__op === OP.remove;
  for (const value of values) {
    if (field === 'following' || field === 'followers') {
      const follower_id = field === 'following' ? uid : value;
      const following_id = field === 'following' ? value : uid;
      const request = removing
        ? supabase.from('follows').delete().eq('follower_id', follower_id).eq('following_id', following_id)
        : supabase.from('follows').upsert({ follower_id, following_id }, { onConflict: 'follower_id,following_id', ignoreDuplicates: true });
      const { error } = await request; raise(error);
    } else if (field === 'blocked') {
      const request = removing
        ? supabase.from('blocks').delete().eq('blocker_id', uid).eq('blocked_id', value)
        : supabase.from('blocks').upsert({ blocker_id: uid, blocked_id: value }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true });
      const { error } = await request; raise(error);
    } else if (field === 'savedPosts') {
      const request = removing
        ? supabase.from('saved_posts').delete().eq('user_id', uid).eq('post_id', value)
        : supabase.from('saved_posts').upsert({ user_id: uid, post_id: value }, { onConflict: 'user_id,post_id', ignoreDuplicates: true });
      const { error } = await request; raise(error);
    }
  }
}

async function patchPost(id, input) {
  const relations = [];
  const patch = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'likes' && value?.__op) { relations.push(['likes', value]); continue; }
    if (key === 'comments' && value?.__op) { relations.push(['comments', value]); continue; }
    if (key.startsWith('poll.')) { continue; }
    const col = columnFor('posts', key);
    if (value?.__op === OP.increment) {
      const current = await supabase.from('posts').select(col).eq('id', id).single();
      raise(current.error);
      patch[col] = Number(current.data[col] || 0) + Number(value.value || 0);
    } else if (value?.__op === OP.delete) {
      patch[col] = null;
    } else if (value?.__op !== OP.timestamp) {
      patch[col] = value;
    }
  }
  const pollKeys = Object.entries(input).filter(([k]) => k.startsWith('poll.'));
  if (pollKeys.length) {
    const current = await supabase.from('posts').select('poll').eq('id', id).single();
    raise(current.error);
    const poll = { ...(current.data.poll || {}) };
    for (const [key, value] of pollKeys) poll[key.slice(5)] = value;
    patch.poll = poll;
  }
  if (relations.length) {
    for (const [field, op] of relations) {
      const values = op.values || [];
      for (const value of values) {
        if (field === 'likes') {
          const request = op.__op === OP.remove
            ? supabase.from('post_likes').delete().eq('post_id', id).eq('user_id', value)
            : supabase.from('post_likes').upsert({ post_id: id, user_id: value }, { onConflict: 'post_id,user_id', ignoreDuplicates: true });
          const { error } = await request; raise(error);
        } else {
          if (op.__op === OP.remove) {
            if (value.id) {
              const { error } = await supabase.from('post_comments').delete().eq('id', value.id).eq('post_id', id);
              raise(error);
            }
          } else {
            const { error } = await supabase.from('post_comments').insert({
              post_id: id, user_id: value.userId, author_name: value.author || '',
              content: value.text || '', created_at: isoFromTimestamp(value.createdAt) || new Date().toISOString()
            });
            raise(error);
          }
        }
      }
    }
  }
  if (Object.keys(patch).length) {
    const { error } = await supabase.from('posts').update(patch).eq('id', id);
    raise(error);
  }
}

export async function setDoc(ref, input, options = {}) {
  const merge = options?.merge === true;
  if (ref.path === 'users') return saveProfile(ref.id, input, merge);
  if (ref.path === 'privateProfiles') {
    const row = {
      user_id: ref.id,
      date_of_birth: input.dateOfBirth || null,
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase.from('private_profiles').upsert(row, { onConflict: 'user_id' });
    raise(error); return;
  }
  if (ref.path === 'usernames') return;
  if (ref.path === 'blocks') {
    const [blocker_id, blocked_id] = ref.id.split('_');
    const { error } = await supabase.from('blocks').upsert({ blocker_id, blocked_id }, { onConflict: 'blocker_id,blocked_id' });
    raise(error); return;
  }
  if (ref.path === 'posts') {
    const row = {
      id: ref.id, user_id: input.userId, author_name: input.authorName || '',
      content: input.content || '', tags: input.tags || [], media_url: input.imageUrl || null,
      media_type: input.mediaType || null, poll: input.poll || null
    };
    const { error } = await supabase.from('posts').upsert(row);
    raise(error); return;
  }
  throw new Error('Bu koleksiyon için setDoc eşlemesi yok: ' + ref.path);
}

export async function updateDoc(ref, input) {
  if (ref.path === 'users') {
    const relationships = ['following','followers','blocked','savedPosts'];
    const relations = {};
    const profilePatch = {};
    for (const [key,value] of Object.entries(input)) {
      if (relationships.includes(key) && value?.__op) relations[key] = value;
      else if (['email','uid','createdAt','plusMember','roomCount','role'].includes(key)) continue;
      else profilePatch[key] = value;
    }
    if (Object.keys(profilePatch).length) await saveProfile(ref.id, profilePatch, true);
    for (const [key,op] of Object.entries(relations)) await mutateUserRelation(ref.id,key,op);
    return;
  }
  if (ref.path === 'posts') return patchPost(ref.id,input);
  if (ref.path === 'stories') {
    const patch = {};
    for (const [key,value] of Object.entries(input)) {
      const col = columnFor('stories',key);
      if (value?.__op !== OP.timestamp && value?.__op !== OP.delete) patch[col] = value;
    }
    const { error } = await supabase.from('stories').update(patch).eq('id',ref.id);
    raise(error); return;
  }
  if (ref.path === 'rooms') {
    if (input.memberUids?.__op === OP.union) {
      const { error } = await supabase.rpc('join_room',{p_room_id:ref.id});
      raise(error); return;
    }
  }
  throw new Error('Bu belge için updateDoc eşlemesi yok: ' + ref.path);
}

export async function deleteDoc(ref) {
  if (ref.path === 'usernames') return;
  if (ref.path === 'posts') {
    const { error } = await supabase.from('posts').delete().eq('id',ref.id);
    raise(error); return;
  }
  if (ref.path === 'stories') {
    const { error } = await supabase.from('stories').delete().eq('id',ref.id);
    raise(error); return;
  }
  if (ref.path === 'blocks') {
    const [blocker_id,blocked_id] = ref.id.split('_');
    const { error } = await supabase.from('blocks').delete().eq('blocker_id',blocker_id).eq('blocked_id',blocked_id);
    raise(error); return;
  }
  throw new Error('Bu belge için deleteDoc eşlemesi yok: ' + ref.path);
}

export async function addDoc(ref, input) {
  const path = ref.path;
  if (path === 'rooms') {
    const { data, error } = await supabase.rpc('create_room',{
      p_name: input.name, p_description: input.description || ''
    });
    raise(error); return { id: data };
  }
  let table, row;
  if (path === 'posts') {
    table = 'posts';
    row = {
      user_id: input.userId, author_name: input.authorName || '', content: input.content || '',
      tags: input.tags || [], media_url: input.imageUrl || null, media_type: input.mediaType || null,
      poll: input.poll || null
    };
  } else if (path === 'stories') {
    table = 'stories';
    row = { user_id: input.userId, media_path: input.mediaPath || input.imageUrl,
      media_url: input.imageUrl || null, media_type: input.mediaType || 'image',
      expires_at: new Date(Date.now() + 86400000).toISOString() };
  } else if (path === 'reports') {
    table = 'reports';
    row = { reporter_id: input.reporterId, content_type: input.type, target_id: String(input.targetId),
      reason: input.reason, status: 'open' };
  } else if (path === 'notifications') {
    table = 'notifications';
    row = { user_id: input.toUid, actor_id: input.fromUid || null, kind: input.type || 'system',
      body: input.text || '', target_type: input.targetType || null, target_id: input.targetId || null };
  } else if (path === 'plusApplications') {
    table = 'plus_applications';
    row = { user_id: input.uid, reason: input.reason || '', status: 'pending' };
  } else if (path === 'modlogs') {
    table = 'admin_activity_logs';
    row = { admin_id: input.adminUid, target_user_id: input.targetUid || null,
      action: input.action || 'admin_action', detail: { message: input.detail || '' } };
  } else if (path.startsWith('rooms/') && path.endsWith('/messages')) {
    table = 'room_messages';
    row = { room_id: path.split('/')[1], sender_id: input.senderUid,
      sender_name: input.senderName || '', content: input.text || '', media_path: input.mediaUrl || null,
      media_type: input.mediaType || null };
  } else {
    throw new Error('Bu koleksiyon için addDoc eşlemesi yok: ' + path);
  }
  const { data, error } = await supabase.from(table).insert(row).select('id').single();
  raise(error);
  return { id: data.id };
}

export async function getCountFromServer(ref) {
  const { table } = tableFor(ref.path);
  let builder = supabase.from(table).select('*',{count:'exact',head:true});
  builder = await applyConstraints(builder,table,ref.constraints,tableFor(ref.path).roomId);
  const { count,error } = await builder;
  raise(error);
  return { data: () => ({ count: count || 0 }) };
}

export function writeBatch() {
  const tasks = [];
  return {
    set: (ref,data,options) => tasks.push(() => setDoc(ref,data,options)),
    update: (ref,data) => tasks.push(() => updateDoc(ref,data)),
    delete: ref => tasks.push(() => deleteDoc(ref)),
    commit: async () => { for (const task of tasks) await task(); }
  };
}

export function onSnapshot(ref, callback, onError = () => {}) {
  const path = ref.path;
  const { table, roomId } = tableFor(path);
  const filters = [];
  if (roomId) filters.push(['room_id','eq',roomId]);
  if (ref.__kind === 'document') {
    if (path === 'users') filters.push(['id','eq',ref.id]);
    else if (path === 'privateProfiles') filters.push(['user_id','eq',ref.id]);
    else filters.push(['id','eq',ref.id]);
  } else {
    for (const c of ref.constraints || []) {
      if (c.__constraint === 'where' && !(table === 'rooms' && c.field === 'memberUids')) {
        filters.push([columnFor(table,c.field),c.op === '==' ? 'eq' : c.op,c.value]);
      }
    }
  }
  const channel = supabase.channel('forever:' + table + ':' + Math.random().toString(36).slice(2));
  const refresh = async () => {
    try {
      if (ref.__kind === 'document') callback(await getDoc(ref));
      else callback(await getDocs(ref));
    } catch (error) { onError(error); }
  };
  const attach = (t, f = []) => {
    let config = { event: '*', schema: 'public', table: t };
    if (f.length === 1) config.filter = f[0][0] + '=' + f[0][1] + '.' + f[0][2];
    channel.on('postgres_changes',config,refresh);
  };
  attach(table,filters);
  if (table === 'posts') {
    attach('post_likes',[]); attach('post_comments',[]);
  }
  if (table === 'profiles') {
    attach('follows',[]); attach('blocks',[]); attach('saved_posts',[]); attach('account_restrictions',[]);
  }
  channel.subscribe(status => {
    if (status === 'SUBSCRIBED') refresh();
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onError(new Error('Supabase Realtime bağlantısı kurulamadı.'));
  });
  return () => { supabase.removeChannel(channel); };
}
