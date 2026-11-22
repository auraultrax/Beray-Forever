import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

/* Forever authentication and data access, backed exclusively by Supabase. */
const SUPABASE_URL = window.FOREVER_SUPABASE_URL || "https://gfuewsdkytfssumxwyxz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = window.FOREVER_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_-CX6sFOEApna11EOem6oOg_39DkcaIq";

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

function mapUser(user) {
  if (!user) return null;
  const meta = user.user_metadata || {};
  return {
    uid: user.id,
    id: user.id,
    email: user.email || "",
    displayName: meta.full_name || meta.name || meta.display_name || "",
    photoURL: meta.avatar_url || meta.picture || null,
    emailVerified: Boolean(user.email_confirmed_at),
    isPlus: false,
    raw: user
  };
}
let activeUser = null;
const auth = {
  get currentUser() { return activeUser; },
  supabase: supabaseClient
};

export function initializeApp() { return { name: "forever-supabase", supabase: supabaseClient }; }
export function getForeverAuth() { return auth; }
export function getForeverStore() { return { type: "supabase-postgres-adapter" }; }
export async function signInWithGoogle() {
  const { data, error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.href, queryParams: { prompt: "select_account" } }
  });
  if (error) throw error;
  return data;
}
export async function signOutForever() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) throw error;
}
export function onForeverSessionChanged(callback) {
  const { data } = supabaseClient.auth.onAuthStateChange((_event, session) => {
    activeUser = mapUser(session?.user || null);
    Promise.resolve().then(() => callback(activeUser));
  });
  return () => data.subscription.unsubscribe();
}
export async function updateForeverProfile(user, updates) {
  const meta = { ...(user?.raw?.user_metadata || {}) };
  if (updates.displayName) {
    meta.full_name = updates.displayName;
    meta.name = updates.displayName;
  }
  const { data, error } = await supabaseClient.auth.updateUser({ data: meta });
  if (error) throw error;
  activeUser = mapUser(data.user);
  return activeUser;
}
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const isPlain = value => value && typeof value === "object" && !Array.isArray(value);
function cleanPublicData(collectionName, source) {
  const data = clone(source || {});
  if (collectionName === "users") {
    for (const key of ["email", "firstName", "lastName", "birthDate", "dateOfBirth", "ipAddress", "ip_address", "kvkkAcceptedAt", "termsAcceptedAt"]) delete data[key];
  }
  if (["posts", "stories", "room_messages", "comments"].includes(collectionName)) {
    delete data.email;
    delete data.authorEmail;
  }
  return data;
}
export function collection(_db, name) { return { _kind: "collection", name: String(name) }; }
export function doc(_db, name, id) { return { _kind: "document", collection: String(name), id: String(id) }; }
export function where(field, op, value) { return { _type: "where", field, op, value }; }
export function orderBy(field, direction = "asc") { return { _type: "orderBy", field, direction }; }
export function limit(count) { return { _type: "limit", count: Math.max(0, Number(count) || 0) }; }
export function query(ref, ...constraints) {
  return { _kind: "query", collection: ref.collection || ref.name, constraints };
}
export function serverTimestamp() {
  return { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 };
}
export function arrayUnion(...values) { return { __fieldOp: "arrayUnion", values: clone(values) }; }
export function arrayRemove(...values) { return { __fieldOp: "arrayRemove", values: clone(values) }; }
export function deleteField() { return { __fieldOp: "deleteField" }; }
export function increment(value) { return { __fieldOp: "increment", value: Number(value) || 0 }; }

function getPath(obj, path) { return String(path).split(".").reduce((v, k) => v == null ? undefined : v[k], obj); }
function setPath(obj, path, value) {
  const parts = String(path).split(".");
  let ref = obj;
  for (const key of parts.slice(0, -1)) {
    if (!isPlain(ref[key])) ref[key] = {};
    ref = ref[key];
  }
  ref[parts[parts.length - 1]] = value;
}
function applyPatch(base, patch) {
  const out = clone(base || {});
  for (const [key, value] of Object.entries(patch || {})) {
    const oldValue = getPath(out, key);
    if (value?.__fieldOp === "deleteField") {
      const parts = key.split(".");
      let ref = out;
      for (const part of parts.slice(0, -1)) ref = ref?.[part];
      if (ref) delete ref[parts.at(-1)];
    } else if (value?.__fieldOp === "arrayUnion") {
      const arr = Array.isArray(oldValue) ? oldValue.slice() : [];
      for (const item of value.values) if (!arr.some(x => JSON.stringify(x) === JSON.stringify(item))) arr.push(item);
      setPath(out, key, arr);
    } else if (value?.__fieldOp === "arrayRemove") {
      const arr = Array.isArray(oldValue) ? oldValue.slice() : [];
      setPath(out, key, arr.filter(x => !value.values.some(v => JSON.stringify(v) === JSON.stringify(x))));
    } else if (value?.__fieldOp === "increment") {
      setPath(out, key, (Number(oldValue) || 0) + value.value);
    } else {
      setPath(out, key, clone(value));
    }
  }
  return out;
}
function snap(row) {
  return {
    id: row?.id,
    exists: () => Boolean(row),
    data: () => row ? clone(row.data) : undefined
  };
}
function matches(value, op, expected) {
  if (op === "==") return JSON.stringify(value) === JSON.stringify(expected);
  if (op === "!=") return JSON.stringify(value) !== JSON.stringify(expected);
  if (op === ">") return value > expected;
  if (op === ">=") return value >= expected;
  if (op === "<") return value < expected;
  if (op === "<=") return value <= expected;
  if (op === "in") return Array.isArray(expected) && expected.includes(value);
  if (op === "array-contains") return Array.isArray(value) && value.some(x => JSON.stringify(x) === JSON.stringify(expected));
  return false;
}
async function readRows(ref) {
  const collectionName = ref.collection || ref.name;
  let request = supabaseClient.from("forever_documents").select("id,data,owner_id,created_at").eq("collection_name", collectionName);
  if (ref._kind === "document") request = request.eq("id", ref.id).limit(1).maybeSingle();
  else request = request.limit(1000);
  const { data, error } = await request;
  if (error) throw error;
  if (ref._kind === "document") return data ? [data] : [];
  let rows = data || [];
  for (const c of ref.constraints || []) {
    if (c._type === "where") rows = rows.filter(row => matches(getPath(row.data || {}, c.field), c.op, c.value));
  }
  const sort = (ref.constraints || []).find(c => c._type === "orderBy");
  if (sort) rows.sort((a,b) => {
    const av = getPath(a.data || {}, sort.field), bv = getPath(b.data || {}, sort.field);
    const result = av == null ? (bv == null ? 0 : -1) : bv == null ? 1 : av < bv ? -1 : av > bv ? 1 : 0;
    return sort.direction === "desc" ? -result : result;
  });
  const lim = (ref.constraints || []).find(c => c._type === "limit");
  if (lim) rows = rows.slice(0, lim.count);
  return rows;
}
export async function getDoc(ref) { return snap((await readRows(ref))[0] || null); }
export async function getDocs(ref) {
  const rows = await readRows(ref);
  return { docs: rows.map(snap), forEach: fn => rows.forEach(row => fn(snap(row))), size: rows.length, empty: rows.length === 0 };
}
async function upsertDocument(ref, data, merge) {
  const current = (await readRows(ref))[0] || null;
  const clean = cleanPublicData(ref.collection, merge && current ? applyPatch(current.data, data) : data);
  const userId = activeUser?.uid || (await supabaseClient.auth.getUser()).data.user?.id;
  const row = {
    collection_name: ref.collection,
    id: ref.id,
    owner_id: current?.owner_id || userId,
    data: clean,
    updated_at: new Date().toISOString()
  };
  if (!current) row.created_at = new Date().toISOString();
  const request = current
    ? supabaseClient.from("forever_documents").update({
        data: clean,
        updated_at: row.updated_at
      }).eq("collection_name", ref.collection).eq("id", ref.id)
    : supabaseClient.from("forever_documents").insert(row);
  const { data: saved, error } = await request.select("id,data,owner_id,created_at").single();
  if (error) throw error;
  return snap(saved);
}
export async function setDoc(ref, data, options = {}) { return upsertDocument(ref, data, Boolean(options.merge)); }
export async function updateDoc(ref, patch) {
  const current = (await readRows(ref))[0];
  if (!current) throw new Error("Güncellenecek kayıt bulunamadı.");
  const clean = cleanPublicData(ref.collection, applyPatch(current.data, patch));
  const { data: saved, error } = await supabaseClient.from("forever_documents")
    .update({ data: clean, updated_at: new Date().toISOString() })
    .eq("collection_name", ref.collection)
    .eq("id", ref.id)
    .select("id,data,owner_id,created_at")
    .single();
  if (error) throw error;
  return snap(saved);
}
export async function addDoc(ref, data) {
  const id = globalThis.crypto?.randomUUID?.() || ("d" + Date.now().toString(36) + Math.random().toString(36).slice(2));
  return upsertDocument({ _kind: "document", collection: ref.collection || ref.name, id }, data, false);
}
export async function deleteDoc(ref) {
  const { error } = await supabaseClient.from("forever_documents")
    .delete().eq("collection_name", ref.collection).eq("id", ref.id);
  if (error) throw error;
}
export function onSnapshot(ref, callback, onError) {
  let disposed = false;
  const collectionName = ref.collection || ref.name;
  const refresh = async () => {
    try {
      const result = ref._kind === "document" ? await getDoc(ref) : await getDocs(ref);
      if (!disposed) callback(result);
    } catch (error) {
      if (!disposed && onError) onError(error);
      else if (!disposed) console.error("Supabase realtime read error:", error);
    }
  };
  refresh();
  const channel = supabaseClient.channel("forever-" + collectionName + "-" + Math.random().toString(36).slice(2))
    .on("postgres_changes", { event: "*", schema: "public", table: "forever_documents", filter: "collection_name=eq." + collectionName }, refresh)
    .subscribe();
  return () => {
    disposed = true;
    supabaseClient.removeChannel(channel);
  };
}
