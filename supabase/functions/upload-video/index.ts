import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SERVICE_KEY = SECRET_KEYS.default || Object.values(SECRET_KEYS)[0] || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ALLOWED_ORIGINS = (Deno.env.get("CORS_ORIGINS") || "").split(",").map(x => x.trim()).filter(Boolean);
const MAX_BYTES = 50 * 1024 * 1024;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = origin && (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin));
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };
}
function reply(req: Request, status: number, data: unknown) {
  const headers = corsHeaders(req);
  if (!req.headers.get("origin") || headers["Access-Control-Allow-Origin"]) {
    return new Response(JSON.stringify(data), { status, headers });
  }
  return new Response(JSON.stringify({ error: "Origin not allowed." }), { status: 403, headers });
}
function read32(view: DataView, offset: number) { return view.getUint32(offset, false); }
function read64(view: DataView, offset: number) {
  const value = view.getBigUint64(offset, false);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}
function readMp4Duration(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const marker = [109, 118, 104, 100]; // mvhd
  for (let i = 4; i < bytes.length - 32; i++) {
    if (bytes[i] !== marker[0] || bytes[i+1] !== marker[1] || bytes[i+2] !== marker[2] || bytes[i+3] !== marker[3]) continue;
    const atomStart = i - 4;
    if (atomStart < 0 || atomStart + 8 > bytes.length) continue;
    const atomSize = read32(view, atomStart);
    if (atomSize < 24 || atomStart + atomSize > bytes.length) continue;
    const version = bytes[i+4];
    const timescaleOffset = i + (version === 1 ? 20 : 16);
    const durationOffset = i + (version === 1 ? 28 : 20);
    if (timescaleOffset + 4 > bytes.length) continue;
    const timescale = read32(view, timescaleOffset);
    const duration = version === 1 ? read64(view, durationOffset) : (durationOffset + 4 <= bytes.length ? read32(view, durationOffset) : null);
    if (!timescale || duration === null || duration === undefined) continue;
    const seconds = duration / timescale;
    if (Number.isFinite(seconds) && seconds > 0 && seconds <= 86400) return seconds;
  }
  return null;
}
function looksLikeMp4(bytes: Uint8Array) {
  return bytes.length > 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return reply(req, 405, { error: "Method not allowed." });
  if (!SUPABASE_URL || !SERVICE_KEY) return reply(req, 503, { error: "Server keys are not configured." });
  const origin = req.headers.get("origin") || "";
  if (origin && ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) return reply(req, 403, { error: "Origin not allowed." });

  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "");
  if (!bearer) return reply(req, 401, { error: "Sign-in is required." });
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(bearer[1]);
  if (authError || !authData.user) return reply(req, 401, { error: "Session is invalid or expired." });

  let form: FormData;
  try { form = await req.formData(); } catch { return reply(req, 400, { error: "Multipart form data is required." }); }
  const file = form.get("file");
  const folderValue = String(form.get("folder") || "posts");
  const folder = ["posts", "stories", "rooms"].includes(folderValue) ? folderValue : "";
  if (!folder) return reply(req, 400, { error: "Invalid media folder." });
  if (!(file instanceof File)) return reply(req, 400, { error: "Video file is required." });
  if (file.size < 16 || file.size > MAX_BYTES) return reply(req, 413, { error: "Video size must be between 16 bytes and 50 MB." });
  if (file.type && file.type !== "video/mp4") return reply(req, 415, { error: "Only MP4 videos are accepted." });

  const { data: profile, error: profileError } = await supabaseAdmin.from("profiles")
    .select("plus_member").eq("id", authData.user.id).maybeSingle();
  if (profileError || profile?.plus_member !== true) return reply(req, 403, { error: "Video uploads are available to Plus members only." });

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeMp4(bytes)) return reply(req, 415, { error: "File is not a valid MP4 container." });
  const duration = readMp4Duration(bytes);
  if (!duration || duration > 180) return reply(req, 400, { error: "Video duration must be verified and cannot exceed 180 seconds." });
  const reservedSeconds = Math.ceil(duration);
  const { error: reserveError } = await supabaseAdmin.rpc("reserve_video_upload", {
    p_user_id: authData.user.id, p_seconds: reservedSeconds
  });
  if (reserveError) return reply(req, 429, { error: reserveError.message || "Daily video limit reached." });

  const bucket = folder === "stories" ? "forever-private" : "forever-public";
  const date = new Date().toISOString().slice(0, 10);
  const path = authData.user.id + "/" + date + "/" + folder + "/" + crypto.randomUUID() + ".mp4";
  let stored = false;
  try {
    const { error: uploadError } = await supabaseAdmin.storage.from(bucket).upload(path, bytes, {
      contentType: "video/mp4", cacheControl: "31536000", upsert: false
    });
    if (uploadError) throw uploadError;
    stored = true;

    let url = "";
    if (bucket === "forever-private") {
      const { data: signed, error: signedError } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 86400);
      if (signedError) throw signedError;
      url = signed.signedUrl;
    } else {
      url = supabaseAdmin.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    }
    const { error: assetError } = await supabaseAdmin.from("media_assets").insert({
      owner_id: authData.user.id, bucket_id: bucket, object_path: path,
      media_type: "video", bytes: file.size, duration_seconds: reservedSeconds,
      visibility: folder === "stories" ? "followers" : "public"
    });
    if (assetError) throw assetError;
    return reply(req, 200, { ok: true, url, path, durationSeconds: duration, storedOn: "supabase" });
  } catch (error) {
    if (stored) await supabaseAdmin.storage.from(bucket).remove([path]);
    await supabaseAdmin.rpc("rollback_video_upload", {
      p_user_id: authData.user.id, p_seconds: reservedSeconds
    });
    console.error("upload-video:", error instanceof Error ? error.message : "unknown error");
    return reply(req, 500, { error: "Video could not be saved." });
  }
});
