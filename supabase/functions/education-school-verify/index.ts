import { withSupabase } from "npm:@supabase/server@1";

const ALLOWED_ORIGINS = new Set([
  "https://auraultrax.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
]);

function response(body: unknown, status: number, origin: string): Response {
  const allowed = !!origin && ALLOWED_ORIGINS.has(origin);
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Vary": "Origin",
      ...(allowed ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      } : {}),
    },
  });
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomEightDigitCode(): string {
  // Rejection sampling avoids modulo bias when mapping 32 random bits to 8 digits.
  const ceiling = Math.floor(0x1_0000_0000 / 100_000_000) * 100_000_000;
  let value = 0;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (value >= ceiling);
  return String(value % 100_000_000).padStart(8, "0");
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] || char);
}

Deno.serve(withSupabase({ auth: "user" }, async (req, ctx) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) return response({ error: "origin_not_allowed" }, 403, "");
    return response({ ok: true }, 200, origin);
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) return response({ error: "origin_not_allowed" }, 403, "");
  if (req.method !== "POST") return response({ error: "method_not_allowed" }, 405, origin);

  const userId = ctx.userClaims?.sub;
  if (!userId) return response({ error: "authentication_required" }, 401, origin);

  const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
  const mailFrom = Deno.env.get("MAIL_FROM") || "";
  const otpHmacSecret = Deno.env.get("OTP_HMAC_SECRET") || "";
  if (!resendApiKey || !mailFrom || otpHmacSecret.length < 32) {
    return response({
      error: "mail_service_not_configured",
      message: "Okul doğrulama e-postası henüz yapılandırılmadı.",
    }, 503, origin);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return response({ error: "invalid_json" }, 400, origin);
  }

  const action = typeof body.action === "string" ? body.action : "";
  const admin = ctx.supabaseAdmin;

  if (action === "send") {
    const institutionCode = typeof body.institutionCode === "string"
      ? body.institutionCode.trim()
      : "";
    if (!/^[0-9]{4,12}$/.test(institutionCode)) {
      return response({ error: "invalid_institution_code" }, 400, origin);
    }

    const officialEmail = institutionCode + "@meb.k12.tr";
    const { data: existingSchool, error: schoolLookupError } = await admin
      .from("education_schools")
      .select("id")
      .eq("institution_code", institutionCode)
      .maybeSingle();

    if (schoolLookupError) return response({ error: "school_lookup_failed" }, 503, origin);
    if (existingSchool) return response({ error: "school_already_registered" }, 409, origin);

    const { data: rateResult, error: rateError } = await admin.rpc(
      "education_reserve_school_verification_send",
      { p_user_id: userId, p_institution_code: institutionCode },
    );
    if (rateError) return response({ error: "rate_limit_check_failed" }, 503, origin);
    if (!rateResult?.allowed) {
      return response({
        error: "rate_limited",
        reason: rateResult?.reason || "try_later",
        message: "Doğrulama kodu sınırına ulaşıldı. Bir dakika sonra tekrar deneyin.",
      }, 429, origin);
    }

    // Only the newest code for this user/school pair remains valid.
    const { error: revokeOldChallengesError } = await admin
      .from("education_email_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("institution_code", institutionCode)
      .is("consumed_at", null);
    if (revokeOldChallengesError) {
      return response({ error: "challenge_rotation_failed" }, 503, origin);
    }

    const code = randomEightDigitCode();
    const codeHmac = await hmacHex(
      otpHmacSecret,
      userId + ":" + institutionCode + ":" + code,
    );
    const challengeId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { error: insertError } = await admin
      .from("education_email_challenges")
      .insert({
        id: challengeId,
        user_id: userId,
        institution_code: institutionCode,
        official_email: officialEmail,
        code_hmac: codeHmac,
        attempts: 0,
        expires_at: expiresAt,
      });

    if (insertError) return response({ error: "challenge_create_failed" }, 503, origin);

    const safeCode = escapeHtml(code);
    const safeEmail = escapeHtml(officialEmail);
    const mailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + resendApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: mailFrom,
        to: [officialEmail],
        subject: "Forever okul doğrulama kodu",
        text: "Forever okul doğrulama kodunuz: " + code + "\n\nKod 5 dakika geçerlidir. Bu kodu kimseyle paylaşmayın.",
        html: "<!doctype html><html lang='tr'><body style='font-family:Arial,sans-serif;background:#080b0a;color:#e9f7ef;padding:24px'><main style='max-width:480px;margin:auto;background:#111a15;border:1px solid #244333;border-radius:16px;padding:24px'><h2>Forever okul doğrulaması</h2><p>" +
          safeEmail + " posta kutusu için doğrulama kodu:</p><p style='font-size:32px;font-weight:800;letter-spacing:8px;color:#7be3ad'>" +
          safeCode + "</p><p>Bu kod 5 dakika geçerlidir ve en fazla 5 kez yanlış denenebilir.</p><p>Bu isteği siz başlatmadıysanız kodu kullanmayın.</p></main></body></html>",
      }),
    });

    if (!mailResponse.ok) {
      await admin.from("education_email_challenges").delete().eq("id", challengeId);
      console.error("Resend delivery failed; status:", mailResponse.status);
      return response({
        error: "email_delivery_failed",
        message: "E-posta gönderilemedi. Gönderici alan adı ayarlarını kontrol edin.",
      }, 502, origin);
    }

    return response({
      success: true,
      challengeId,
      expiresInSeconds: 300,
      officialEmail,
      message: "Doğrulama kodu " + officialEmail + " adresine gönderildi.",
    }, 200, origin);
  }

  if (action === "verify") {
    const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const schoolName = typeof body.schoolName === "string" ? body.schoolName.trim() : "";
    const region = typeof body.region === "string" ? body.region.trim() : "";

    if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^[0-9]{8}$/.test(code)) {
      return response({ error: "invalid_verification_input" }, 400, origin);
    }
    if (schoolName.length < 2 || schoolName.length > 120 || region.length > 80) {
      return response({ error: "invalid_school_details" }, 400, origin);
    }

    const { data: challenge, error: challengeError } = await admin
      .from("education_email_challenges")
      .select("institution_code")
      .eq("id", challengeId)
      .eq("user_id", userId)
      .maybeSingle();

    if (challengeError || !challenge) {
      return response({ error: "challenge_not_found" }, 404, origin);
    }

    const codeHmac = await hmacHex(
      otpHmacSecret,
      userId + ":" + challenge.institution_code + ":" + code,
    );
    const { data, error } = await admin.rpc(
      "education_complete_school_verification",
      {
        p_challenge_id: challengeId,
        p_user_id: userId,
        p_code_hmac: codeHmac,
        p_school_name: schoolName,
        p_region: region || null,
      },
    );

    if (error) {
      console.error("School verification DB operation failed:", error.code || "unknown");
      return response({ error: "verification_failed" }, 503, origin);
    }
    if (!data?.success) {
      const status = data?.error === "invalid_code" ? 400 : 409;
      return response({
        error: data?.error || "verification_failed",
        attemptsLeft: data?.attempts_left,
      }, status, origin);
    }

    return response({ success: true, schoolId: data.school_id }, 200, origin);
  }

  return response({ error: "unsupported_action" }, 400, origin);
}));
