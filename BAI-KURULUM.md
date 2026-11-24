# Forever — BAI ve Supabase kurulum notları

Bu belge, Forever uygulamasındaki BAI, Plus üyelik denetimi ve Supabase dağıtım adımlarını açıklar. Uygulamanın ana arayüzü `index.html` ve Supabase bağlantı katmanı `supabase-bridge.js` dosyalarındadır.

## Supabase SQL

**Yeni Supabase projesi:** `SUPABASE_TUM_KURULUM.sql` dosyasını SQL Editor'de baştan sona bir kez çalıştır. Bu dosya temel şemayı, güvenlik politikalarını, BAI sayaçlarını, oda kısıtlama fonksiyonlarını ve Forever Plus migration'ını içerir.

**Daha önce temel SQL'i kurulmuş proje:** `SUPABASE_FOREVER_PLUS_MIGRATION.sql` dosyasını bir kez çalıştır. Projende oda katılım/kısıtlama yamaları henüz yoksa önce `SUPABASE_BAI_ODA_KISITLAMA_MIGRATION.sql`, ardından Forever Plus migration'ını çalıştır.

Plus migration; yalnızca `A_UR_A_XX` hesabına kullanıcı adıyla Plus verme/kaldırma RPC'si, kullanıcının kendi hesabına Plus/yönetici/doğrulama yetkisi yazmasını engelleyen koruma, Plus gönderi sabitleme kontrolü ve animasyonlu çıkartma Storage politikası kurar.

## Plus özelliklerinin kapsamı

- Standart hesap: en fazla 40 kişisel çıkartma.
- Plus hesap: en fazla 200 kişisel çıkartma.
- Animasyonlu GIF/APNG/WebP çıkartma yükleme Plus üyeliği gerektirir; dosya boyutu 8 MB ile sınırlıdır.
- Bu ZIP'te hazır 150 çıkartmalık resim paketi bulunmuyor. Kullanıcılar kendi çıkartmalarını yükleyebilir ve uygulamada saklayabilir.
- Plus üyeleri için BAI sohbeti ve internet aramasındaki kişisel günlük kota kaldırılır. Ortak site bütçesi ve sağlayıcı limitleri devam eder; bu nedenle mutlak/teknik olarak sınırsız hizmet garantisi verilmez.

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

`ADMIN-HESABI-BAGLA.sql` yalnızca yönetici hesabını bağlamak için isteğe bağlı kurulum aracıdır. Önce Supabase Authentication içinde yönetici kullanıcısını oluştur; sonra dosyadaki örnek e-posta ve parola yer tutucularını kendin belirlediğin değerlerle değiştir. Bu dosyada gerçek bir parola veya özel anahtar saklama.

## Ön yüzü yayımla

GitHub Pages veya başka bir statik barındırmaya `index.html`, `supabase-bridge.js`, `aurai-widget.js`, `sw.js`, `manifest*.json` ve `icons/` klasörünü birlikte yükle. PWA önbellek adı `forever-v22` olarak güncellendi.

## Kontrol

```bash
node --check aurai-widget.js
node --test tests/aurai-logic.test.cjs
```

Edge Function'ları yayımladıktan ve SQL'i uyguladıktan sonra normal kullanıcıyla Plus dışı davranışları; `A_UR_A_XX` hesabıyla kullanıcı adı üzerinden Plus verme/kaldırmayı ve Plus test hesabıyla her özelliği ayrı ayrı dene.
