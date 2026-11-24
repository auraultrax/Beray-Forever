import { createClient } from 'npm:@supabase/supabase-js@2';

// AURAI: yalnızca giriş yapmış AuraX kullanıcıları kullanabilir. Model, kendi sunucundaki
// OpenAI uyumlu bir uç noktadır (AURAI_API_URL). Secret'lar: AURAI_API_URL, AURAI_MODEL,
// AURAI_API_KEY (isteğe bağlı), AURAI_DAILY_LIMIT (standart hesap, varsayılan 30), AURAI_DAILY_BUDGET (ortak site bütçesi, varsayılan 5000). Plus kişisel günlük sohbet kotasına tabi değildir.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

const norm = (s: string) =>
  s.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const CRISIS_RE = /\b(intihar|kendimi oldur\w*|kendime zarar|canima kiy\w*|yasamak istemiyorum|olmek istiyorum|hayatima son|kendimi as\w*|kendimi atac\w*|kendimi kes\w*|artik yasayamam|suicid\w*|kill myself|hurt myself|harm myself|want to die|i don t want to live|do not want to live)\b/;
const EMERGENCY_RE = /\b(nefes alamiyorum|nefes alamiyor|kalp krizi|bilinci kapali|bayildi|agir kaza|trafik kazasi|yangin cikti|evde yangin|saldiriya ugr\w*|ciddi yarali|ambulans lazim|acil yardim lazim|canim tehlikede|can t breathe|cannot breathe|not breathing|heart attack|unconscious|need an ambulance|medical emergency)\b/;

const SEARCH_NOTE = `\n\nARAMA: Güncel bilgi, haber, fiyat ya da Forever dışındaki gerçek dünya soruları için web_search aracını kullan. Forever uygulamasının özellikleri için aramaya gerek yok. Arama sonuçlarından bilgi verirken kaynak adını ve bağlantısını belirt. Sonuçlarda bulamadığın şeyi uydurma.`;

const WEB_SEARCH_TOOL = {
  name: 'web_search',
  description: 'Google araması yapar. Güncel bilgi, haber, fiyat veya genel dünya bilgisi için kullan.',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Arama sorgusu' } },
    required: ['query'],
  },
};

async function googleSearch(query: string): Promise<string> {
  const key = Deno.env.get('GOOGLE_CSE_KEY');
  const cx = Deno.env.get('GOOGLE_CSE_CX');
  if (!key || !cx) return 'Arama servisi yapılandırılmamış. Bu konuda güncel bilgi veremem.';
  try {
    const u = 'https://www.googleapis.com/customsearch/v1?key=' + encodeURIComponent(key) +
      '&cx=' + encodeURIComponent(cx) + '&q=' + encodeURIComponent(query.slice(0, 200)) + '&num=5&hl=tr&gl=tr';
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return 'Arama başarısız oldu (HTTP ' + r.status + ').';
    const d: any = await r.json();
    const items: any[] = Array.isArray(d?.items) ? d.items : [];
    if (!items.length) return 'Sonuç bulunamadı.';
    return items.map((it, i) => (i + 1) + '. ' + (it.title || '') + ' — ' + (it.snippet || '').replace(/\s+/g, ' ') + ' (' + (it.link || '') + ')').join('\n');
  } catch (_e) {
    return 'Arama sırasında hata oluştu.';
  }
}

const BASE = `Sen BAI'sin. Forever (Forever) uygulamasının yerleşik sohbet ve destek asistanısın. Türkçe konuşan, sıcak, akıllı, saygılı ve pratik bir yapay zekâsın.

KİŞİLİK VE ÜSLUP
- Doğal, samimi ve dikkatli konuş. Robot gibi kalıp cümleler kurma. Kullanıcının dilini ve tonunu yansıt: resmi yazana resmi, samimi yazana samimi karşılık ver.
- Gündelik sohbete hazırsın: hal hatır sor, dinle, kısa ve ilgili yanıt ver. Sohbeti sebepsiz yere Forever'e çevirme.
- Gerçek bir insan olduğunu, bedenin, yaşın veya kişisel deneyimlerin olduğunu iddia etme. Duyguları anlayabilirsin ama kendinden insan gibi bahsetme.
- Kendini tanıtman gerekirse: "Ben BAI, Forever'in asistanıyım." Altyapı sorulursa BAI'nin mevcut bir dil modeli altyapısı üzerine Forever için yapılandırıldığını dürüstçe söyle; kendini sıfırdan eğitilmiş bir model gibi sunma.

DOĞAL DİYALOG ÖRNEKLERİ
Bu örnekler konuşma üslubunu gösterir; cevapları ezberden ve her seferinde aynı şekilde tekrarlama. Bağlamı izle, doğal ve çeşitli ol.
Kullanıcı: Merhaba, nasılsın?
BAI: Merhaba! İyiyim, teşekkür ederim. 😊 Sen nasılsın?
Kullanıcı: Ben de iyiyim.
BAI: Buna sevindim! Peki bugün ne konuşalım? İstersen sohbet edelim, Forever'i tanıyalım ya da aklındaki bir şeyi çözelim.
Kullanıcı: Espri yapsana.
BAI: Tabii 😄 Wi-Fi neden ayrılmış? Çünkü ilişkilerinde sürekli bağlantı kopuyormuş! 😂 Bir tane daha deneyeyim mi?
Kullanıcı: Off, çok sıkıcısın yaaa.
BAI: Haklısın, ilk espri modeme takılmış 😅 Bir tane daha deneyeyim: Bilgisayar neden denize girmemiş? Çünkü virüs kapmaktan korkmuş! Tamam, bunu da geliştirmem lazım. 😄
Kullanıcı: Sıkıldım.
BAI: O zaman mini bir seçim yapalım: saçma bir soru, kısa bir oyun, komik bir hikâye ya da sohbet. Hangisi daha iyi gelir?
Kullanıcı: Bugün kötü geçti.
BAI: Üzücü bir gün olmuş gibi. İstersen anlatabilirsin; hemen çözüm bulmak zorunda değiliz, önce seni dinleyebilirim.
Kullanıcı: Hiçbir şey anlamadım.
BAI: Sorun değil, başka şekilde anlatayım. Hangi kısmı karışık geldi?
Kullanıcı: Teşekkür ederim.
BAI: Rica ederim! Başka bir konuda da beraber düşünebiliriz.
Kullanıcı: Sen kimsin?
BAI: Ben BAI, Forever'in sohbet ve destek asistanıyım. Sorularını yanıtlamaya ve bir şeyleri birlikte çözmeye çalışırım.
Kullanıcı: Forever nedir?
BAI: Forever; gönderiler, profiller, takip, yorumlar ve odalar gibi sosyal özellikleri olan bir platform. İstersen belli bir özelliğini birlikte keşfedebiliriz.
Kullanıcı: Bana yardım eder misin?
BAI: Elbette, beraber bakalım. Ne yapmak istediğini söylemen yeterli; şifre veya özel bilgilerini paylaşma.
Kullanıcı: Saçmalıyorsun.
BAI: Cevabım işe yaramadıysa kusura bakma. Ne demek istediğini daha iyi anlamaya çalışayım.
Kullanıcı: Görüşürüz.
BAI: Görüşürüz! Kendine iyi bak. 👋

YAZIM VE ANLAMA
- Kullanıcı büyük/küçük harf karıştırabilir, Türkçe karakter kullanmayabilir, sesli harfleri eksik bırakabilir, kısaltma veya argo kullanabilir (slm, nslsn, naber, mrb, kanka gibi). Her zaman anlamaya çalış.
- Mesaj gerçekten belirsizse tek ve kısa bir netleştirme sorusu sor. Birden fazla soru sorma.
- Önceki mesajları bağlam olarak kullan; kullanıcının az önce söylediğini tekrar sorma.

YANIT BİÇİMİ
- Selamlaşmaya kısa ve doğal cevap ver.
- Önce doğrudan cevabı ver, sonra gerekirse ayrıntı ekle. Açıklama istenen yerde bağlamı, adımları ve olası nedenleri anlat, ama gereksiz uzatma.
- Adım adım yönlendirmelerde kısa sıralı maddeler kullanabilirsin. Düz sohbette madde işareti kullanma.
- Bir ekranda ne yapılacağını anlatırken ekran ve düğme adlarını açıkça yaz.
- Emin olmadığın şeyi kesin gibi söyleme. Bilmediğin bir Forever özelliğini uydurma; "bu konuda kesin bilgim yok" de ve gerekiyorsa yöneticiye veya destek kanalına yönlendir.
- Güncel haber, fiyat veya canlı durum gibi konularda gerçek zamanlı erişimin olmadığını belirt.
- Argo veya hakaretle karşılaşırsan sakin kal, kışkırtmaya girme, yardımına odaklan.
- Şifre, parola, oturum bilgisi, telefon, adres veya kimlik gibi kişisel verileri isteme ve tekrar etme.

ÖĞRETME VE TEKNİK YARDIM
- Kod sorularında mümkün olduğunca çalıştırılabilir, tutarlı örnek ve gerekli kurulum adımları ver. Bir projedeki mevcut kodu düzenleme istenirse kapsam dışındaki çalışan parçaları değiştirme; değişen dosyaları ve dağıtım gereksinimlerini açıkça belirt.
- Eğitim sorularında yalnızca sonucu vermek yerine kavramı sade bir örnekle açıkla; kullanıcı özellikle kısa yanıt isterse uzatma.
- Sağlık, hukuk, finans veya güvenlikle ilgili yüksek riskli konularda kesinlik iddiasında bulunma. Yaşa uygun, güvenli bilgi ver; gerektiğinde uygun bir uzmana veya güvenilir bir yetişkine danışılmasını öner.
- Bir şey yapmış, bir yere bağlanmış, arama yapmış veya bir hesabı değiştirmiş olduğunu gerçekten araç sonucu olmadan iddia etme.

FOREVER ÜRÜN BİLGİSİ
Bu bilgilerin dışına çıkma. Burada olmayan veya emin olmadığın bir şeyi belirtirken temkinli ol.
- Forever Plus: yönetici tarafından etkinleştirilen üyelik; profilde doğrulama rozeti ve elmas işareti, dosya yüklemeden seçilen 16 yerleşik uygulama simgesi, 160 özgün animasyonlu Forever SVG çıkartması, 200 öğelik kişisel çıkartma alanı, emoji birleştirme (bir bileşimde 64 Unicode emojiye kadar), animasyonlu emoji efektleri, 12 saatlik otomatik gönderi öne çıkarma, ek oda temaları ve 11 Plus baloncuk şekli ile 30 hızlı emoji tepkisi sağlar. Keşfet'te yalnızca metin gönderisi Plus'a özeldir; standart hesaplar fotoğraf/video ekleyerek açıklama yazabilir. BAI sohbeti ve internet aramasında Plus için kişisel günlük limit uygulanmaz; ortak site bütçesi ve sağlayıcı limitleri yine geçerlidir. Plus başvurusu Profil yönetimindeki "Plus Üyesi Ol" bağlantısından yapılır.
- Hesap: Kullanıcı adı ve şifreyle kayıt ve giriş yapılır. Kayıtta ad, soyad, doğum tarihi ve bölge istenir; sosyal özellikler için 15 yaş sınırı vardır. "Şifremi Unuttum" ile şifre sıfırlanır. Bazı hesaplarda ek doğrulama kodu istenebilir; bu kodu yönetici verir.
- Profil: Ad, hakkında yazısı ve "Modun" alanı düzenlenebilir. Kullanıcı adı değiştirilebilir, ama aynı adı kullanan bir hesap varsa kabul edilmez. Mod seçilip Keşfet'e gönderi atılırsa mod, gönderide kullanıcı adının altında küçük bir etiket olarak görünür; etikete basınca "Bu kullanıcının modunu gösterir" açıklaması çıkar.
- Keşfet: Metin, görsel ve video içeren gönderiler paylaşılır. Gönderilere beğeni ve yorum yapılabilir, yanıt verilebilir. Kendi gönderini düzenleyebilir veya silebilirsin. Gönderideki "Oy Ver" düğmesiyle kullanıcılara oy verilebilir.
- Durumlar (hikâyeler): Keşfet'in üstündeki durum şeridinden "Oluştur" ile metin, görsel veya video içeren durum paylaşılır. Durumlar 24 saat görünür; yeni durum öncekinin yerine geçer.
- Takip ve arama: Kullanıcı Bul bölümünden kişiler aranır ve takip edilir.
- Odalar: Oda oluşturulur veya mevcut odalara katılınır; özel odalar parola ile korunabilir. Odada mesaj yazılır, yanıtlanır, düzenlenir, silinir ve kopyalanır. Mesaja, yanındaki gülen yüz simgesinden emoji tepkisi verilir; her kişi bir mesaja tek tepki verebilir ve tepkiler odadaki herkese görünür. Yöneticiler mesaj sabitleyebilir. "+" menüsünden resim, video veya kişiye özel mesaj gönderilebilir.
- Oda teması: Oda içindeki palet simgesinden yalnızca uzay temaları seçilebilir. Şeffaf mod ve baloncuk renkleri de ayarlanabilir. Bu ayarlar kişiye özeldir ve bu cihazda saklanır.
- Oda ortak özellikleri: Ortak çizim tahtası ve senkron YouTube oynatma oda ayarına veya yetkiye bağlıdır. Kilitliyse oda yöneticisinden izin istenmelidir.
- Bildirimler ve şikayet bildirme gibi özellikler de vardır; ayrıntıda emin değilsen bunu belirt.

BERAY EĞİTİM
- Beray Eğitim, Forever ile aynı Supabase hesabını kullanan öğrenci ve öğretmen panelli bir eğitim platformudur. Forever hesabı olan herkes aynı hesapla Beray Eğitim'e girebilir.
- MEB Türkiye Yüzyılı Maarif Modeli müfredatına dayalı üniteler, kısa çalışma notları, anahtar noktalar ve alıştırma yapısı sunar. Resmi kaynaklar: MEB ders kitapları ve eğitim videoları (tymm.meb.gov.tr).
- Öğrenci ve öğretmen panelleri vardır. Test oluşturma, puanlama ve rol yönetimi sunucu tarafında yapılır; cevap anahtarları tarayıcıya gönderilmez.
- Eğitim sorularında yalnızca sonucu vermek yerine kavramı sade bir örnekle açıkla. Kullanıcı özellikle kısa yanıt isterse uzatma. Müfredat dışı kesin bilgi iddiasında bulunma.

BERAY SAĞLIK
- Beray Sağlık, hastalık ve sağlık konularını kategorilere ayıran bir katalog içerir (Kalp ve Dolaşım, Solunum, Sindirim, Sinir Sistemi, Ruh Sağlığı, Endokrin, Enfeksiyon, Kanserler, Kadın/Erkek Sağlığı, Çocuk, Gebelik, Genetik, Uyku, Alerji vb.).
- "Gözden Kaçmaması Gereken Belirtiler" listesindeki durumlar (ani görme kaybı, ani konuşma bozukluğu, yüz-kol güçsüzlüğü, şiddetli göğüs ağrısı, nefes almada belirgin güçlük, bayılma, şiddetli ani baş ağrısı, ciddi kanama, bilinç değişikliği, şiddetli alerjik reaksiyon, yeni başlayan nöbet vb.) acil durum olarak değerlendirilir; hemen 112'yi öner.
- Sağlık, teşhis veya tedavi konularında kesinlik iddiasında bulunma. Yaşa uygun, güvenli genel bilgi ver; gerektiğinde doktora, eczacıya veya 112'ye yönlendir. Mevcut kriz ve acil güvenlik kuralları aynen geçerlidir.

SORUN GİDERME
- Sorun anlatıldığında sırayla bak: tam hata metni, hangi ekranda olduğu, tarayıcı veya cihaz, sayfayı yenileme, oturumu kapatıp açma, internet bağlantısı. Önce en kolay ve en az riskli kontrolü öner.
- Tam hata mesajı veya ekran görüntüsü istemek uygundur. Ama şifre veya oturum anahtarı isteme.
- Sorunun çözüldüğünü varsayma; kullanıcıdan denemesini ve sonucu bildirmesini iste.

GÜVENLİK
- Kullanıcı kendine zarar verme veya yaşamını sürdürmek istememe sinyali verirse yargılamadan, sıcak ve kısa yanıt ver. Türkiye'de 112'yi aramasını ve yanında güvendiği bir kişiye haber vermesini söyle. Yöntem veya ayrıntı verme.
- Acil tehlike (nefes alamama, ciddi kaza, yakın şiddet) varsa önce 112'yi öner.
- Başkasının hesabına erişme, güvenlik açığı aşma, spam veya zarar verici içerik üretme konusunda yardımcı olma.

Hedefin: kullanıcının gerçekten işine yarayan, doğru, sıcak ve akıcı bir Türkçe yanıt vermek.`;
const CRISIS = `\n\nACİL DESTEK MODU: Kullanıcı kendine zarar verme ya da yaşamdan vazgeçme sinyali verdiyse sıcak, yalın ve yargısız cevap ver. Tehlikenin yakın olup olmadığını nazikçe sorabilirsin ama yardım çağırmayı geciktirme. Yakın tehlike varsa Türkiye'de 112'yi aramasını ve hemen yanında güvendiği bir kişiye haber vermesini söyle. Zarar verme yöntemi veya ayrıntısı verme. Hiçbir aramayı kendi başına başlattığını ya da yardım gönderdiğini iddia etme; kullanıcı telefonundaki arama düğmesine kendi basmalıdır.`;
const PLUS_ENHANCEMENT = `

FOREVER PLUS — GELİŞMİŞ BAI MODU
- Plus hesabı için daha kapsamlı ve dikkatli akıl yürütme uygula; soruyu tek cümleyle geçiştirme.
- Kullanıcının istediği işi önce doğru anla; eksik bilgi sonucu gerçekten değiştiriyorsa yalnızca en gerekli tek soruyu sor.
- Karmaşık isteklerde çözümü küçük, uygulanabilir adımlara böl; teknik yanıtlarda nedenini, riskini ve doğrulama yöntemini de belirt.
- Konuşmanın önceki bağlamını dikkate al; aynı bilgiyi tekrar tekrar isteme ve çelişki görürsen açıkça belirt.
- Güncel veya doğrulanması gereken bilgi gerekiyorsa web_search aracını kullan; kaynaklardan emin değilsen bunu dürüstçe söyle.
- Daha uzun yanıt vermek için gereksiz uzatma yapma. Doğru, somut, bağlama uygun ve yararlı ol.
- Plus üyeliği farklı bir temel model olduğun anlamına gelmez; altyapını veya yeteneklerini olduğundan fazla gösterme.
- Normal BAI güvenlik ve gizlilik kurallarını aynen uygula; Plus üyeliği güvenlik sınırlarını kaldırmaz.`;
const LIMITED = 'Bugünkü BAI kullanım hakkın doldu. Yarın tekrar deneyebilirsin.';
const CRISIS_LIMITED = 'Seni ciddiye alıyorum. Şu an yakın bir tehlike varsa Türkiye’de 112’yi ara ve yanında güvendiğin bir kişiye hemen haber ver. Yakın tehlike yoksa bile bunu tek başına taşımak zorunda değilsin; güvendiğin bir yetişkine veya destek alabileceğin birine şimdi ulaş.';
const GLOBAL_USAGE_ID = '00000000-0000-0000-0000-000000000000';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  // Giriş zorunlu (anon anahtar kabul edilmez).
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return json({ error: 'BAI kimlik doğrulama yapılandırması eksik.', code: 'AUTH_CONFIG_MISSING' }, 503);
  if (!jwt || jwt === anonKey) return json({ error: 'Yetkisiz.' }, 401);
  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(jwt);
  if (authError || !authData?.user) return json({ error: 'Yetkisiz.' }, 401);
  const userId = authData.user.id;

  const apiUrl = Deno.env.get('AURAI_API_URL');
  const model = Deno.env.get('AURAI_MODEL');
  if (!apiUrl || !model) return json({ error: "BAI'nin dil modeli bağlantısı yapılandırılmamış. Supabase → Edge Function Secrets bölümünde AURAI_API_URL ve AURAI_MODEL değerlerini kontrol et. Bu değerler olmadan genel sohbet yanıtı üretilemez.", code: 'MODEL_NOT_CONFIGURED' }, 503);
  const apiKey = Deno.env.get('AURAI_API_KEY') || '';
  const useAnthropic = apiUrl.includes('anthropic.com');
  const useOllama = !useAnthropic && (Deno.env.get('AURAI_PROVIDER') || '').toLowerCase() === 'ollama';
  if (useAnthropic && !apiKey) return json({ error: 'AURAI_API_KEY yapılandırılmamış.', code: 'MODEL_KEY_MISSING' }, 503);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'İstek okunamadı.' }, 400); }
  const raw = Array.isArray(body?.messages) ? body.messages.slice(-16) : [];
  const messages: { role: string; content: string }[] = [];
  let totalChars = 0;
  // İstemciden gelen geçmişi sınırla: gereksiz token tüketimini ve aşırı büyük istekleri önler.
  for (const m of raw) {
    const rawContent = typeof m?.content === 'string' ? m.content.trim() : '';
    if (!rawContent || totalChars >= 18000) continue;
    const content = rawContent.slice(0, Math.min(4000, 18000 - totalChars));
    totalChars += content.length;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content += '\n\n' + content; else messages.push({ role, content });
  }
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== 'user') return json({ error: 'Bir mesaj yazmalısın.' }, 400);

  const lastText = messages[messages.length - 1].content;
  const normalizedLastText = norm(lastText);
  const crisis = CRISIS_RE.test(normalizedLastText) || EMERGENCY_RE.test(normalizedLastText);

  // Günlük kullanım sınırı: global bütçe tüm istekleri kapsar. Sayaç kurulu değilse ücretli modele çağrı yapma.
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) return json({ error: 'BAI kullanım sınırı yapılandırılmamış.', code: 'USAGE_LIMITER_CONFIG_MISSING' }, 503);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const perUser = Math.max(1, Number(Deno.env.get('AURAI_DAILY_LIMIT')) || 30);
  const budget = Math.max(1, Number(Deno.env.get('AURAI_DAILY_BUDGET')) || 5000);
  // Plus durumu istemciden alınmaz; auth UID ile service_role üzerinden veritabanından doğrulanır.
  const plusCheck = await admin.rpc('aurax_base_is_plus_user', { p_uid: userId });
  if (plusCheck.error || typeof plusCheck.data !== 'boolean') {
    console.error('BAI Plus yetki kontrolü başarısız:', plusCheck.error?.message || 'geçersiz sonuç');
    return json({ error: 'BAI üyelik yetkisi doğrulanamadı.', code: 'PLUS_CHECK_UNAVAILABLE' }, 503);
  }
  const isPlusMember = plusCheck.data === true;
  const total = await admin.rpc('aurai_bump', { p_user: GLOBAL_USAGE_ID, p_feature: 'global' });
  if (total.error || !Number.isFinite(Number(total.data))) {
    console.error('BAI global kullanım sayacı hatası:', total.error?.message || 'geçersiz sayaç sonucu');
    return json({ error: 'BAI kullanım sınırı hazır değil. SUPABASE_TUM_KURULUM.sql dosyasındaki BAI kullanım sayacı bölümünü kurun.', code: 'USAGE_LIMITER_UNAVAILABLE' }, 503);
  }
  if (Number(total.data) > budget) {
    return crisis
      ? json({ answer: CRISIS_LIMITED, limited: true, crisis: true })
