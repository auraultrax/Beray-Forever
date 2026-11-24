# Forever — BAI ve Supabase kurulum notları

Bu belge, Forever uygulamasındaki BAI, Plus üyelik denetimi ve Supabase dağıtım adımlarını açıklar. Uygulamanın ana arayüzü `index.html` ve Supabase bağlantı katmanı `supabase-bridge.js` dosyalarındadır.

## Supabase SQL

**Yeni Supabase projesi:** `SUPABASE_TUM_KURULUM.sql` dosyasını SQL Editor'de baştan sona bir kez çalıştır. Bu dosya temel şemayı, güvenlik politikalarını, BAI sayaçlarını, oda kısıtlama fonksiyonlarını ve Forever Plus migration'ını içerir.

**Daha önce temel SQL'i kurulmuş proje:** `SUPABASE_FOREVER_PLUS_MIGRATION.sql` dosyasını bir kez çalıştır. Projende oda katılım/kısıtlama yamaları henüz yoksa önce `SUPABASE_BAI_ODA_KISITLAMA_MIGRATION.sql`, ardından Forever Plus migration'ını çalıştır.

Plus migration; yalnızca `A_UR_A_XX` hesabına kullanıcı adıyla Plus verme/kaldırma RPC'si, kullanıcının kendi hesabına Plus/yönetici/doğrulama yetkisi yazmasını engelleyen koruma, gönderi sabitleme kontrolü ve animasyonlu çıkartma Storage politikası kurar. Yeni eklenen Plus özellik migration'ı ayrıca Keşfet gönderi kuralını, 12 saatlik sunucu üretimli gönderi öne çıkarmayı ve oda mesajlarında Plus çıkartma paketinin sunucu tarafında korunmasını sağlar.

## Plus özelliklerinin kapsamı

- Standart hesap: en fazla 40 kişisel çıkartma; hazır Forever animasyon paketini görüntüleyebilir ancak gönderemez.
- Plus hesap: en fazla 200 kişisel çıkartma ve 160 özgün, kategorilere ayrılmış, SVG tabanlı hazır animasyonlu Forever çıkartması.
- GIF/APNG/animasyonlu WebP kişisel çıkartma yükleme Plus üyeliği gerektirir; dosya boyutu 8 MB ile sınırlıdır.
- 16 yerleşik uygulama simgesi paketle gelir. Plus üyesi listeden seçer; yeni görsel yüklemesi gerekmez. Favicon/manifest değişimi uygulamada otomatik uygulanır; işletim sistemine önceden yüklenmiş PWA simgesinin yenilenme süresi tarayıcıya bağlıdır.
- Emoji Laboratuvarı Unicode emoji kabul eder ve bir bileşimde 64 emojiye kadar yerel çıkartma üretir. Bu işlem üçüncü taraf Emoji Kitchen servisine bağlı değildir.
- Plus hesaplarda BAI sohbeti ve internet aramasının kişisel günlük kullanım sayacı uygulanmaz; Plus BAI daha kapsamlı sistem yönergesi ve daha yüksek yanıt token bütçesi kullanır.
- Plus gönderileri veritabanı tarafından 12 saat otomatik öne çıkarılır. Normal kullanıcılar Keşfet'te fotoğraf veya video eklemeden metin-only gönderi yayınlayamaz; medya açıklaması yazabilir.
- Plus sohbet mesajlarındaki emoji efektleri diğer katılımcılara da görünür. Kalp, kalp-göz, kahkaha-gözyaşı ve benzeri türler farklı mikro animasyonlara sahiptir.
- Ortak `AURAI_DAILY_BUDGET`, model/arama sağlayıcısının kendi kotası, hız sınırı, ücretlendirmesi ve kapasitesi devam eder. BAI'nin kişisel Plus kotasının kaldırılması sağlayıcı tarafında sonsuz kapasite anlamına gelmez.

**SQL geçiş sırası:**
- Yeni Supabase projesinde `SUPABASE_TUM_KURULUM.sql` dosyasını çalıştırın; Plus kuralları ve yeni özellik tetikleyicileri bu dosyaya dahildir.
- Eski kurulumda daha önce Plus migration'ı çalıştırılmadıysa `SUPABASE_FOREVER_PLUS_MIGRATION.sql` dosyasını çalıştırın. Bu sürüm yeni Plus feature trigger'larını da içerir.
- Eski kurulumda Plus migration'ı zaten çalıştırılmışsa yalnızca `SUPABASE_FOREVER_PLUS_FEATURES_MIGRATION.sql` dosyasını çalıştırın.

## Edge Function'ları yayımla

Aşağıdaki altı fonksiyonu son sürümleriyle deploy et:

```bash
supabase functions deploy username-login --no-verify-jwt
supabase functions deploy username-available --no-verify-jwt
supabase functions deploy aurai-chat
supabase functions deploy aurai-search
supabase functions deploy delete-account
supabase functions deploy push-notify
```

`supabase/config.toml` içinde yalnızca `username-login` ve `username-available` için `verify_jwt = false` ayarı bulunur; bu iki uç kendi isteğini ve doğrulama adımlarını kontrol eder. Diğer fonksiyonlarda JWT doğrulaması açık kalmalıdır.

## Edge Function Secrets

Secret değerlerini yalnızca Supabase Dashboard → Edge Functions → Secrets bölümüne ekle. `.env`, `service_role` veya sağlayıcı anahtarlarını ZIP'e ya da tarayıcıya koyma.

| Secret | Amaç |
|---|---|
| `AURAI_API_URL` | Model sağlayıcısının API adresi |
| `AURAI_MODEL` | Sağlayıcının model adı |
| `AURAI_API_KEY` | Gerekliyse model sağlayıcı anahtarı |
| `AURAI_DAILY_LIMIT` | Standart hesapların günlük BAI sohbet kotası (varsayılan 30) |
| `AURAI_SEARCH_DAILY_LIMIT` | Standart hesapların günlük internet arama kotası (varsayılan 10) |
| `AURAI_DAILY_BUDGET` | Tüm kullanıcılar için ortak günlük toplam limit (varsayılan 5000) |
| `GOOGLE_CSE_KEY` | Google Programmable Search anahtarı |
| `GOOGLE_CSE_CX` | Google Programmable Search motoru kimliği |
| `TAVILY_API_KEY` | Alternatif internet arama sağlayıcısı; tanımlanırsa Tavily kullanılır |

Supabase'in `SUPABASE_URL`, `SUPABASE_ANON_KEY` ve `SUPABASE_SERVICE_ROLE_KEY` ortam değişkenlerinin Edge Function ortamında tanımlı olduğundan emin ol. `service_role` anahtarını istemciye asla ekleme.

Bu proje tek başına ücretsiz model/arama servisi sağlamaz. Seçilen sağlayıcı ve arama API'sinin kendi kullanım koşulları, kotası ve ücretleri vardır. Beklenmedik kullanımı önlemek için ortak günlük bütçeyi uygun bir düzeyde tut.

## Yönetici hesabı

`ADMIN-HESABI-BAGLA.sql` yalnızca yönetici hesabını bağlamak için isteğe bağlı kurulum aracıdır. Önce Supabase Authentication içinde yönetici kullanıcısını oluştur; sonra dosyadaki `v_email` yer tutucusunu bu hesabın e-posta adresiyle değiştir. SQL dosyası parola oluşturmaz veya değiştirmez. Bu dosyada gerçek bir parola veya özel anahtar saklama.

## Ön yüzü yayımla

GitHub Pages veya başka bir statik barındırmaya `index.html`, `supabase-bridge.js`, `aurai-widget.js`, `sw.js`, `manifest*.json` ve `icons/` klasörünü birlikte yükle. PWA önbellek adı `forever-v23` olarak güncellendi.

## Kontrol

```bash
node --check aurai-widget.js
node --test tests/*.cjs
```

Edge Function'ları yayımladıktan ve SQL'i uyguladıktan sonra normal kullanıcıyla Plus dışı davranışları; `A_UR_A_XX` hesabıyla kullanıcı adı üzerinden Plus verme/kaldırmayı ve Plus test hesabıyla her özelliği ayrı ayrı dene.

## Forever Plus BAI davranışı

Plus yetkisi, Edge Function içinde oturumun Supabase Auth UID değeriyle `aurax_base_is_plus_user` RPC üzerinden doğrulanır; istemcinin gönderdiği `plusMember` alanına güvenilmez. Plus hesapların kişisel günlük BAI sohbet sayacı uygulanmaz. Ayrıca Plus isteklerinde gelişmiş BAI sistem yönergesi ve daha yüksek yanıt token bütçesi kullanılır; Ollama sağlayıcısında da Plus için tam yönerge otomatik etkinleştirilir.

**Sınırın dürüst açıklaması:** kişisel günlük limit kaldırılmıştır; ancak sağlayıcı kotası, model sunucusu kapasitesi ve `AURAI_DAILY_BUDGET` ortak site bütçesi geçerlidir. Bu nedenle dış model sağlayıcısının veya ortak site bütçesinin sınırları aşılamaz.

## Plus gönderi ve oda kuralları

- Normal hesaplar Keşfet'e yalnızca fotoğraf veya video içeren gönderi ekleyebilir; medya açıklaması yazabilir. Yalnızca metin gönderisi Plus özelliğidir.
- Plus tarafından oluşturulan her yeni gönderiye veritabanı tetikleyicisi sunucu saatinden itibaren 12 saatlik `plusBoostUntil` damgası verir. İstemci bu süreyi uzatamaz veya sahte damga ekleyemez.
- 160 özgün animasyonlu Forever SVG çıkartması uygulama dosyalarıyla birlikte gelir; normal hesaplar sadece paketi görüntüleyebilir, gönderemez.
- Plus kullanıcısının mesajındaki emoji, diğer kullanıcıların ekranında da otomatik mikro animasyonla görünür. Büyük ekran animasyonu ayrıca Plus kullanıcısının emojiye basmasıyla oda geneline yayınlanır.
- Emoji Laboratuvarı her Unicode emojiyi kabul eder ve bir seferde 64 emojiye kadar yerel bir bileşik çıkartma üretir.
- 16 yerleşik uygulama simgesi pakette bulunur; kullanıcı görsel yüklemez. Plus simge seçimi kendi hesabına kaydedilir. Ana ekrana önceden eklenmiş PWA ikonunun tarayıcı/işletim sistemi tarafından yenilenmesi gecikebilir.

Mevcut bir Supabase projesinde yeni kuralları etkinleştirmek için `SUPABASE_FOREVER_PLUS_FEATURES_MIGRATION.sql` dosyasını SQL Editor'da bir kez çalıştırın. Yeni proje kuruluyorsa `SUPABASE_TUM_KURULUM.sql` dosyası bu kuralları zaten içerir. Ardından `supabase/functions/aurai-chat` Edge Function'ını yeniden dağıtın. SQL'in canlı veritabanında çalıştırıldığı veya Edge Function'ın yayımlandığı, bu kaynak paketin hazırlanmasıyla otomatik gerçekleşmez.
