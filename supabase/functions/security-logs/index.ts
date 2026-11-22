import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SERVICE_KEY = SECRET_KEYS.default || Object.values(SECRET_KEYS)[0] || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const IP_KEY_HEX = Deno.env.get("IP_LOG_ENCRYPTION_KEY") || "";
const ALLOWED_ORIGINS = (Deno.env.get("CORS_ORIGINS") || "").split(",").map(x => x.trim()).filter(Boolean);
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
function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function decryptIp(value: string) {
  const parsed = JSON.parse(value);
  if (!parsed.iv || !parsed.ciphertext) return "[invalid encrypted record]";
  if (!/^[a-f0-9]{64}$/i.test(IP_KEY_HEX)) throw new Error("IP encryption key is not configured.");
  const keyBytes = new Uint8Array(IP_KEY_HEX.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(parsed.iv) }, key, fromBase64(parsed.ciphertext));
  return new TextDecoder().decode(plain);
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
  const { data: role, error: roleError } = await supabaseAdmin.from("user_roles")
    .select("role").eq("user_id", authData.user.id).eq("role", "admin").maybeSingle();
  if (roleError || !role) return reply(req, 403, { error: "Admin access is required." });
  if (!IP_KEY_HEX) return reply(req, 503, { error: "IP encryption key is not configured." });

  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch {}
  const requested = Number(payload.limit || 100);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(200, Math.floor(requested))) : 100;
  const { data: rows, error } = await supabaseAdmin.from("security_events")
    .select("id,user_id,event_type,encrypted_ip,user_agent,created_at")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) return reply(req, 500, { error: "Security logs could not be loaded." });

  const logs = [];
  for (const row of rows || []) {
    let ip = "[şifreli kayıt çözülemedi]";
    try { if (row.encrypted_ip) ip = await decryptIp(row.encrypted_ip); } catch {}
    logs.push({
      id: row.id,
      user_id: row.user_id,
      event_type: row.event_type,
      ip,
      user_agent: row.user_agent,
      created_at: row.created_at
    });
  }
  return reply(req, 200, { logs });
});
