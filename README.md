# Forever

Forever, Supabase tabanlı sosyal platform projesidir. Arayüzün ana giriş dosyası `index.html` dosyasıdır.

## Klasörler ve temel dosyalar

- `index.html` — uygulama arayüzü ve istemci davranışları
- `supabase-bridge.js` — mevcut veri katmanı uyumluluğu
- `aurai-widget.js` — BAI arayüzü ve yerel konuşma mantığı
- `sw.js`, `manifest*.json`, `icons/` — PWA ve uygulama simgeleri
- `SUPABASE_TUM_KURULUM.sql` — yeni Supabase projesi için tam veritabanı kurulumu
- `SUPABASE_FOREVER_PLUS_MIGRATION.sql` — mevcut Supabase projesine Plus/yetki güncellemesi
- `supabase/functions/` — Edge Functions
- `FOREVER_TANITIM.txt` — platform ve Plus özelliklerinin tanıtımı

## Kurulum

Supabase SQL, Edge Function Secrets ve Edge Function dağıtım sırası için `BAI-KURULUM.md` dosyasına bak. `service_role` ve model sağlayıcı anahtarlarını istemci dosyalarına ekleme.

Yayınlamadan önce:

```bash
node --check aurai-widget.js
node --test tests/aurai-logic.test.cjs
```

## Forever Plus özellik geçişi

Mevcut Supabase kurulumunda ek sunucu kurallarını etkinleştirmek için `SUPABASE_FOREVER_PLUS_FEATURES_MIGRATION.sql` dosyasını Supabase SQL Editor'da çalıştırın. Yeni kurulumda `SUPABASE_TUM_KURULUM.sql` bunları içerir. Daha sonra `supabase/functions/aurai-chat` Edge Function'ını yeniden dağıtın.

## Forever Plus

Plus paketinde 16 yerleşik uygulama simgesi ve 160 özgün animasyonlu SVG çıkartması bulunur. Keşfet metin-only gönderi, 12 saatlik otomatik Plus gönderi öne çıkarma, emoji animasyonları, Unicode emoji birleştirme, ek oda temaları ve özel baloncuk şekilleri Plus kontrolündedir.
