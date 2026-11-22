import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SERVICE_KEY = SECRET_KEYS.default || Object.values(SECRET_KEYS)[0] || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const IP_KEY_HEX = Deno.env.get("IP_LOG_ENCRYPTION_KEY") || "";
const IP_HASH_SECRET = Deno.env.get("IP_HASH_SECRET") || "";
const ALLOWED_ORIGINS = (Deno.env.get("CORS_ORIGINS") || "").split(",").map(x => x.trim()).filter(Boolean);
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const encoder = new TextEncoder();

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = origin && ALLOWED_ORIGINS.includes(origin);
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
function base64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function hexBytes(hex: string) {
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error("IP_LOG_ENCRYPTION_KEY must be 64 hex characters.");
  return new Uint8Array(hex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
}
async function encryptIp(ip: string) {
  const encryptionKey = await crypto.subtle.importKey("raw", hexBytes(IP_KEY_HEX), { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, encryptionKey, encoder.encode(ip)));
  return JSON.stringify({ iv: base64(iv), ciphertext: base64(ciphertext) });
}
async function hashIp(ip: string) {
  if (IP_HASH_SECRET.length < 32) throw new Error("IP_HASH_SECRET must be at least 32 characters.");
  const key = await crypto.subtle.importKey("raw", encoder.encode(IP_HASH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(ip)));
  return base64(digest);
}
function clientIp(req: Request) {
  // These headers are supplied by the Supabase edge proxy; never accept an IP from the JSON body.
  return req.headers.get("cf-connecting-ip")
    || req.headers.get("x-real-ip")
    || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || "unknown";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return reply(req, 405, { error: "Method not allowed." });
  if (!SUPABASE_URL || !SERVICE_KEY) return reply(req, 503, { error: "Server keys are not configured." });
  if (!IP_KEY_HEX || !IP_HASH_SECRET) return reply(req, 503, { error: "IP encryption secrets are not configured." });

  const origin = req.headers.get("origin") || "";
  if (origin && ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) return reply(req, 403, { error: "Origin not allowed." });

  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "");
  if (!bearer) return reply(req, 401, { error: "Sign-in is required." });
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(bearer[1]);
  if (authError || !authData.user) return reply(req, 401, { error: "Session is invalid or expired." });

  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { return reply(req, 400, { error: "Invalid JSON body." }); }
  const allowedEvents = new Set(["session", "login", "signup", "media_upload"]);
  const eventType = typeof payload.event === "string" && allowedEvents.has(payload.event) ? payload.event : "session";
  const ip = clientIp(req);

  try {
    const [encryptedIp, ipHash] = await Promise.all([encryptIp(ip), hashIp(ip)]);
    const { error } = await supabaseAdmin.from("security_events").insert({
      user_id: authData.user.id,
      event_type: eventType,
      ip_hash: ipHash,
      encrypted_ip: encryptedIp,
      user_agent: (req.headers.get("user-agent") || "").slice(0, 500)
    });
    if (error) throw error;
    return reply(req, 200, { ok: true });
  } catch (error) {
    console.error("security-event:", error instanceof Error ? error.message : "unknown error");
    return reply(req, 500, { error: "Security event could not be saved." });
  }
});
