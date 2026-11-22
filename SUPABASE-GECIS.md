# Forever · Supabase kurulum ve geçiş notu

Bu geliştirme dalındaki ana uygulama kimlik doğrulaması, Plus başvuru sayfası ve admin paneli Supabase Auth kullanır. Veri modeli Postgres, RLS, Realtime, Storage ve Edge Functions üzerine kuruludur.

## Kurulum sırası
1. Supabase Dashboard → SQL Editor'da supabase-schema.sql dosyasının tamamını çalıştır.
2. Authentication → URL Configuration'a gerçek site URL'si ve OAuth redirect adresini ekle.
3. Authentication → Providers altında e-posta/parola ve kullanacağın OAuth sağlayıcısını yapılandır.
4. supabase-config.js içindeki URL ve publishable key bu Supabase projesine aittir. Publishable key istemcide kullanılabilir; secret key asla HTML/JS içine eklenmez.
5. Normal kayıt ekranından ilk kullanıcı hesabını oluştur. Authentication → Users bölümünden UUID'ni bulup SQL dosyasının sonundaki admin bootstrap komutunu ayrı çalıştır.
6. supabase/config.toml dosyasını ve supabase/functions altındaki üç Edge Function'ı Supabase CLI ile deploy et.
7. Dashboard → Edge Functions → Secrets bölümünde IP_LOG_ENCRYPTION_KEY, IP_HASH_SECRET ve CORS_ORIGINS tanımla. Gerçek secret değerlerini git'e ekleme.
8. Supabase Cron ile public.cleanup_security_events() fonksiyonunu günlük çalıştır.

## Taşınan bileşenler
- index.html: ana Forever istemcisi, Supabase Auth ve Supabase veri adaptörü.
- plus-apply.html: Supabase oturumuyla Plus başvurusu.
- admin.html: aynı normal oturumla admin rol kontrolü ve yönetim araçları.
- supabase-schema.sql: kullanıcı profili, özel profil, roller, takip, gönderi, hikâye, oda, mesaj, Plus, çizim/çıkartma, medya ve güvenlik tabloları.
- security-event: IP şifreleyerek güvenlik olayı kaydeder.
- security-logs: admin rolünü doğrulayıp IP kayıtlarını yalnızca yöneticiye çözer.
- upload-video: Plus üyeliğini, MP4 süresini ve günlük toplam 180 saniye video kotasını sunucu tarafında doğrular.

## Eski Firebase verileri
Bu repodan Firebase SDK ve Firestore kuralları kaldırılmaktadır; ancak Firebase'deki mevcut kullanıcılar, parolalar ve belgeler bu işlemlerle otomatik taşınmaz. Supabase SQL çalıştırmak Firebase Auth hesaplarını import etmez. Eski veri gerekiyorsa önce güvenli dışa aktarım ve Firebase UID → Supabase UUID eşleme planı hazırla; parola hash uyumluluğunu doğrula. Kullanıcılar aynı parola ile otomatik taşınamıyorsa parola sıfırlama/yeniden kayıt akışı gerekir. Eski Firebase projesini ve dışa aktarımları doğrulanmadan silme.

## Aura X
Bağlı GitHub hesabında eski Aura X kaynak deposu bulunamadı. SQL modeli, daha önce tarif ettiğin takip, hikâye, odalar, özel mesaj, çizim, çıkartma, bildirim ve yönetim özelliklerini Forever hesabıyla aynı backend'de birleştirecek biçimde tasarlanmıştır. Eski arayüzün birebir kod taşınması için Aura X kaynak kodu veya arşivi gerekir.

## Sınırlar
GitHub'a kod eklemek Supabase projesinde otomatik çalıştırmaz. SQL'i SQL Editor'da çalıştırmalı, Edge Function'ları deploy etmeli, Secrets tanımlamalı ve Auth URL/Provider ayarlarını tamamlamalısın. Canlı proje üzerinde bu kurulum adımlarını bu GitHub bağlantısından otomatik uygulayamam.