import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const SYSTEM = [
  'Sen BAI’sin; Forever sosyal platformunun Türkçe sohbet ve destek asistanısın.',
  'Forever özellikleri: profiller, gönderiler, takip, yorumlar, hikâyeler, odalar ve Süper Plus.',
  'Kullanıcının diline nazikçe uyum sağla. Emin olmadığın ürün özelliğini varmış gibi anlatma.',
  'Kullanıcıya parolasını, kimlik bilgilerini veya özel anahtarlarını sorma.',
  'Kendine zarar veya intihar sinyali varsa ayrıntı, yöntem veya talimat verme; yakın tehlikede Türkiye 112 ve yanında güvenilir bir yetişkine/kişiye ulaşmasını söyle.',
  'Sosyal ağ içinde yapılmamış işlemi yapılmış gibi iddia etme. Kısa, anlaşılır ve yardımcı ol.'
].join(' ');
const CRISIS_REPLY = 'Bunu tek başına taşımak zorunda değilsin. Şu anda yakın bir tehlikedeysen Türkiye’de 112’yi ara ve hemen yanında güvendiğin bir yetişkine veya kişiye haber ver. Şu an yalnız kalmamaya çalış; güvenli birinin yanına geç.';
const CRISIS_RE = /kendime\s+zarar|intihar|yaşamak\s+istemiyorum|kendimi\s+öldür|canıma\s+kıymak|kendimi\s+incit/i;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'BAI kimlik doğrulama veya kullanım sayacı yapılandırması eksik.', code: 'CONFIG_MISSING' }, 503);
  }
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt || jwt === anonKey) return json({ error: 'Yetkisiz.' }, 401);

  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(jwt);
  if (authError || !authData?.user) return json({ error: 'Oturum doğrulanamadı.' }, 401);
  const userId = authData.user.id;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'İstek okunamadı.' }, 400); }
  const raw = Array.isArray(body?.messages) ? body.messages.slice(-12) : [];
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  let totalChars = 0;
  for (const item of raw) {
    if (!item || typeof item.content !== 'string') continue;
    const content = item.content.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, Math.min(3000, 16000 - totalChars));
    if (!content) continue;
    totalChars += content.length;
    const role = item.role === 'assistant' ? 'assistant' : 'user';
    messages.push({ role, content });
  }
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== 'user') return json({ error: 'Bir mesaj yazmalısın.' }, 400);

  const latest = messages[messages.length - 1].content;
  if (CRISIS_RE.test(latest)) return json({ answer: CRISIS_REPLY, crisis: true });

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const plusQuery = await admin.from('forever_plus_members').select('user_id').eq('user_id', userId).maybeSingle();
  if (plusQuery.error) return json({ error: 'Süper Plus durumu doğrulanamadı.', code: 'PLUS_LOOKUP_FAILED' }, 503);
  const isPlus = Boolean(plusQuery.data);

  const usage = await admin.rpc('forever_bai_bump', { p_user: userId, p_feature: 'chat' });
  if (usage.error || !usage.data) {
    console.error('BAI usage counter failed:', usage.error?.message || 'empty response');
    return json({ error: 'BAI kullanım sayacı hazır değil.', code: 'USAGE_COUNTER_FAILED' }, 503);
  }
  const globalCount = Number(usage.data.global_count);
  const userCount = Number(usage.data.user_count);
  const globalBudget = Math.max(1, Number(Deno.env.get('AURAI_DAILY_BUDGET')) || 5000);
  const userLimit = Math.max(1, Number(Deno.env.get('AURAI_DAILY_LIMIT')) || 30);
  if (!Number.isFinite(globalCount) || !Number.isFinite(userCount)) return json({ error: 'BAI sayaç yanıtı geçersiz.' }, 503);
  if (globalCount > globalBudget) return json({ error: 'BAI bugün için ortak sistem kullanım bütçesine ulaştı. Daha sonra tekrar dene.', code: 'GLOBAL_BUDGET' }, 429);
  if (!isPlus && userCount > userLimit) return json({ error: 'Bugünkü BAI sohbet hakkın doldu. Süper Plus üyeleri için kişi başı günlük kota uygulanmaz.', code: 'USER_DAILY_LIMIT' }, 429);

  const apiUrl = Deno.env.get('AURAI_API_URL');
  const model = Deno.env.get('AURAI_MODEL');
  const apiKey = Deno.env.get('AURAI_API_KEY') || '';
  const provider = (Deno.env.get('AURAI_PROVIDER') || '').toLowerCase();
  if (!apiUrl || !model) return json({ error: 'BAI model bağlantısı henüz yapılandırılmadı. Supabase Edge Function Secrets alanına AURAI_API_URL ve AURAI_MODEL eklenmeli.', code: 'MODEL_NOT_CONFIGURED' }, 503);

  try {
    const isAnthropic = apiUrl.includes('anthropic.com');
    if (isAnthropic) {
      if (!apiKey) return json({ error: 'Anthropic kullanımı için AURAI_API_KEY eksik.', code: 'MODEL_KEY_MISSING' }, 503);
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model, max_tokens: 1200, temperature: 0.6, system: SYSTEM,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
        }),
        signal: AbortSignal.timeout(45000),
      });
      const result: any = await response.json().catch(() => ({}));
      if (!response.ok) return json({ error: 'BAI model sağlayıcısı HTTP ' + response.status + ' yanıtı verdi.', code: 'MODEL_UPSTREAM' }, 502);
      const answer = Array.isArray(result.content) ? result.content.filter((x: any) => x.type === 'text').map((x: any) => x.text).join('\n').trim() : '';
      return answer ? json({ answer, plus: isPlus }) : json({ error: 'Model boş yanıt döndürdü.' }, 502);
    }

    if (!apiKey && provider !== 'ollama') return json({ error: 'AURAI_API_KEY yapılandırılmamış.', code: 'MODEL_KEY_MISSING' }, 503);
    const base = apiUrl.replace(/\/+$/, '');
    const endpoint = base.endsWith('/chat/completions') ? base : base + '/chat/completions';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    const response = await fetch(endpoint, {
      method: 'POST', headers,
      body: JSON.stringify({
        model, messages: [{ role: 'system', content: SYSTEM }, ...messages],
        temperature: 0.65, max_tokens: 1400,
      }),
      signal: AbortSignal.timeout(45000),
    });
    const result: any = await response.json().catch(() => ({}));
    if (!response.ok) return json({ error: 'BAI model sağlayıcısı HTTP ' + response.status + ' yanıtı verdi.', code: 'MODEL_UPSTREAM' }, 502);
    const answer = String(result?.choices?.[0]?.message?.content || '').trim();
    return answer ? json({ answer, plus: isPlus }) : json({ error: 'Model boş yanıt döndürdü.' }, 502);
  } catch (error) {
    console.error('BAI upstream error:', error);
    return json({ error: error instanceof Error && error.name === 'TimeoutError' ? 'BAI yanıtı zaman aşımına uğradı.' : 'BAI model bağlantısı kurulamadı.' }, 502);
  }
});
