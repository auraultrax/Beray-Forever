import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return json({ error: 'Arama kimlik doğrulama veya sayaç yapılandırması eksik.' }, 503);
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt || jwt === anon) return json({ error: 'Yetkisiz.' }, 401);
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await auth.auth.getUser(jwt);
  if (authError || !authData?.user) return json({ error: 'Oturum doğrulanamadı.' }, 401);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'İstek okunamadı.' }, 400); }
  const query = String(body?.query || '').replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, 200);
  if (!query) return json({ error: 'Aranacak bir konu yazmalısın.' }, 400);

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const uid = authData.user.id;
  const plus = await admin.from('forever_plus_members').select('user_id').eq('user_id', uid).maybeSingle();
  if (plus.error) return json({ error: 'Süper Plus üyeliği doğrulanamadı.' }, 503);

  const usage = await admin.rpc('forever_bai_bump', { p_user: uid, p_feature: 'search' });
  if (usage.error || !usage.data) return json({ error: 'BAI kullanım sayacı hazır değil.' }, 503);
  const globalCount = Number(usage.data.global_count);
  const userCount = Number(usage.data.user_count);
  const budget = Math.max(1, Number(Deno.env.get('AURAI_DAILY_BUDGET')) || 5000);
  const limit = Math.max(1, Number(Deno.env.get('AURAI_SEARCH_DAILY_LIMIT')) || 10);
  if (!Number.isFinite(globalCount) || !Number.isFinite(userCount)) return json({ error: 'BAI sayaç yanıtı geçersiz.' }, 503);
  if (globalCount > budget) return json({ error: 'BAI ortak günlük sistem bütçesine ulaştı. Daha sonra tekrar dene.' }, 429);
  if (!plus.data && userCount > limit) return json({ error: 'Günlük arama hakkın doldu. Süper Plus üyeleri için kişi başı günlük arama kotası uygulanmaz.' }, 429);

  const tavily = Deno.env.get('TAVILY_API_KEY');
  const key = Deno.env.get('GOOGLE_CSE_KEY');
  const cx = Deno.env.get('GOOGLE_CSE_CX');
  if (!tavily && (!key || !cx)) return json({ error: 'İnternet araması yapılandırılmamış. TAVILY_API_KEY veya GOOGLE_CSE_KEY ve GOOGLE_CSE_CX eklenmeli.' }, 503);
  try {
    const response = tavily
      ? await fetch('https://api.tavily.com/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tavily },
          body: JSON.stringify({ query, max_results: 5, search_depth: 'basic' }), signal: AbortSignal.timeout(15000),
        })
      : await fetch('https://www.googleapis.com/customsearch/v1?key=' + encodeURIComponent(key!) + '&cx=' + encodeURIComponent(cx!) + '&q=' + encodeURIComponent(query) + '&num=5&hl=tr&gl=tr', { signal: AbortSignal.timeout(15000) });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) return json({ error: 'Arama sağlayıcısı HTTP ' + response.status + ' yanıtı verdi.' }, 502);
    const items: any[] = tavily
      ? (Array.isArray(data?.results) ? data.results.map((r: any) => ({ title: r?.title, link: r?.url, snippet: r?.content })) : [])
      : (Array.isArray(data?.items) ? data.items : []);
    const results = items.slice(0, 5).map((item) => {
      let link = '';
      try { const target = new URL(String(item?.link || '')); if (target.protocol === 'https:' || target.protocol === 'http:') link = target.href; } catch (_) {}
      return { title: String(item?.title || '').slice(0, 200), snippet: String(item?.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 700), link };
    }).filter(item => item.title || item.snippet || item.link);
    return json({ results });
  } catch (error) {
    console.error('BAI search error:', error);
    return json({ error: error instanceof Error && error.name === 'TimeoutError' ? 'Arama zaman aşımına uğradı.' : 'Arama bağlantısı kurulamadı.' }, 502);
  }
});
