# Forever BAI — kurulum

BAI, Forever içinde oturum açmış tüm hesaplara sunulan sohbet ve uygulama destek panelidir. Standart hesaplar için günlük 30 sohbet ve 10 arama sınırı vardır. Süper Plus üyeleri için sohbet ve arama sayaçlarında kişi başı günlük üst sınır uygulanmaz.

## 1. Edge Function'lar

Şu iki fonksiyon Supabase projesinde yayımlanır:

- `supabase/functions/aurai-chat/index.ts` → `aurai-chat`
- `supabase/functions/aurai-search/index.ts` → `aurai-search`

Yayımlama:
```bash
supabase functions deploy aurai-chat
supabase functions deploy aurai-search
```

Supabase'teki `aurai-chat` ve `aurai-search` fonksiyonları JWT doğrulamasını açık tutar ve kullanıcıyı Supabase Auth ile tekrar doğrular. Service-role anahtarı yalnızca sunucu fonksiyonlarında kullanılmalıdır.

## 2. Gerekli Edge Function Secrets

Supabase Dashboard → Edge Functions → Secrets bölümünde sağlayıcına uygun değerleri ekle.

| Secret | Amaç |
|---|---|
| `AURAI_API_URL` | OpenAI uyumlu API'nin temel adresi. Anthropic kullanıyorsan Anthropic API adresi. |
| `AURAI_MODEL` | Model sağlayıcısındaki model adı. |
| `AURAI_API_KEY` | Model sağlayıcısı anahtarı. |
| `AURAI_DAILY_LIMIT` | Standart hesap için günlük sohbet sınırı; varsayılan 30. |
| `AURAI_SEARCH_DAILY_LIMIT` | Standart hesap için günlük arama sınırı; varsayılan 10. |
| `AURAI_DAILY_BUDGET` | Tüm platform için günlük ortak istek bütçesi; varsayılan 5.000. |
| `TAVILY_API_KEY` | İnternet araması için Tavily anahtarı; alternatif olarak Google CSE kullanılabilir. |
| `GOOGLE_CSE_KEY` | Google Programmable Search API anahtarı. |
| `GOOGLE_CSE_CX` | Google Programmable Search Engine kimliği. |

Supabase tarafından sağlanan `SUPABASE_URL`, `SUPABASE_ANON_KEY` ve `SUPABASE_SERVICE_ROLE_KEY` Edge Function ortam değişkenlerinin mevcut olduğunu doğrula. `service_role` anahtarını HTML, JavaScript veya GitHub'a kesinlikle koyma.

## 3. Süper Plus kota modeli

- Standart hesap: günlük 30 sohbet ve 10 arama isteği.
- Süper Plus: kişi başı günlük sohbet/arama sınırı yoktur.
- Tüm hesaplar: ortak günlük toplam istek bütçesi varsayılan 5.000'dir. Bu sınır sağlayıcı maliyetini, hizmet kullanılabilirliğini ve ani trafik artışlarını korumak için kalır.
- Sayaç tablosu `forever_bai_usage_daily` yalnızca hesap kimliği, tarih, istek türü ve sayıyı tutar; sohbet metnini saklamaz.
- Plus statüsü `forever_plus_members` tablosundan sunucu tarafında okunur. Profil JSON'una güvenilmez.

## 4. Arama

BAI panelinde internet araması için mesajın başına `/ara ` ekle. Örneğin:

```text
/ara Türkiye'deki güncel teknoloji haberleri
```

Arama için `TAVILY_API_KEY` veya birlikte `GOOGLE_CSE_KEY` ve `GOOGLE_CSE_CX` gerekir. Bu değerler olmadan sohbet paneli açılabilir, yerel Forever yardımı yanıtlanabilir; ancak harici model ve arama özellikleri yapılandırma hatası verir.

## 5. Maliyet ve kullanılabilirlik

Bu depo bir model sağlayıcısı veya sınırsız ücretsiz API kotası sağlamaz. Model ve arama sağlayıcısının ücretsiz kotası, ücretleri, hız sınırları ve veri saklama politikaları farklı olabilir. `AURAI_DAILY_BUDGET` değerini sağlayıcı planına göre ayarla. BAI'de “sınırsız” ifadesi Plus kullanıcısı başına bir günlük kota olmaması anlamına gelir; ortak sistem bütçesi ve sağlayıcı sınırları yürürlükte kalır.

Supabase Edge Function'ları bulutta çalışır. Yalnızca bilgisayarındaki `localhost` üzerinde çalışan yerel bir model adresi buluttaki Edge Function tarafından doğrudan erişilebilir olmayabilir; yerel model kullanımı için ayrıca güvenli ve ağdan erişilebilir bir altyapı gerekir.
