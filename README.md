# Forever · Forever Plus

Forever'ın mevcut arayüzünü ve sosyal akışını koruyan geliştirme sürümü. Cam kartlar, hareketli aurora arka planı ve Forever tipografisi korunur. Backend hedefi yalnızca Supabase: Auth, Postgres, Realtime, Storage ve Edge Functions.

## Proje yapısı

- index.html: ana Forever uygulaması ve ortak Supabase oturumu.
- admin.html: aynı normal hesapla giriş yapılan yönetim paneli.
- plus-apply.html: Supabase hesabına bağlı Plus başvuru sayfası.
- supabase-schema.sql: tablolar, RLS, oda/Plus işlemleri, bucket'lar ve politikalar.
- supabase-config.js: tarayıcıya açık proje URL'si ve publishable key.
- supabase-client.js: ortak Supabase istemcisi.
- supabase-firestore-compat.js: mevcut Forever ekranlarını Supabase tablolarına bağlayan geçiş katmanı.
- supabase/functions: güvenlik kaydı, admin IP kayıtları ve video yükleme fonksiyonları.

## Supabase kurulumu

1. Supabase Dashboard içindeki SQL Editor'da supabase-schema.sql dosyasının tamamını çalıştır.
2. Authentication → URL Configuration bölümünde canlı site adresini Site URL ve Redirect URLs alanlarına ekle.
3. Authentication → Providers bölümünde kullanacağın Google sağlayıcısını yapılandır.
4. Normal Forever kayıt akışıyla ilk kullanıcı hesabını oluştur. Authentication → Users bölümünden kendi kullanıcı UUID'ni bul.
5. SQL Editor'da aşağıdaki komutu kendi UUID'nle ayrı olarak çalıştır:

    insert into public.user_roles(user_id, role)
    values ('SUPABASE_AUTH_USER_UUID', 'admin')
    on conflict do nothing;

6. Supabase CLI ile projeyi bağla ve Edge Functions dosyalarını deploy et:

    supabase link --project-ref gfuewsdkytfssumxwyxz
    supabase functions deploy security-event
    supabase functions deploy security-logs
    supabase functions deploy upload-video

7. Supabase Dashboard → Edge Functions → Secrets bölümünde IP_LOG_ENCRYPTION_KEY, IP_HASH_SECRET ve CORS_ORIGINS tanımla. İlk iki değer için yerel bilgisayarında openssl rand -hex 32 komutunu ayrı ayrı çalıştırabilirsin. Gerçek değerleri GitHub'a veya HTML/JS dosyalarına koyma.

## Plus üyelik kuralları

- Normal kullanıcı en fazla 3 oda açar; sahibi Normal olan oda en fazla 20 kişidir.
- Plus kullanıcı en fazla 6 oda açar; sahibi Plus olan oda en fazla 30 kişidir.
- Normal kullanıcı günde en fazla 5 görsel yükler; Plus görsel sınırına tabi değildir.
- Video yükleme Plus üyelerine açıktır. Sunucu MP4 süresini dosyanın içinden doğrular; günlük toplam 180 saniye sınırı veritabanında tutulur.
- Özel mesaj başlatmak Plus üyeliği ve karşılıklı takip gerektirir. Başlatılmış konuşmanın diğer üyesi Plus olmasa da yanıt verebilir.
- Hikâyeler yalnızca hesap sahibine ve takipçilerine açıktır.
- Plus çizim sahibinin her çizime en fazla 3 misafir eklemesine izin veren veritabanı yapısı bulunur.
- Plus başvuruları admin panelinden onaylanır; kullanıcı kendi Plus yetkisini değiştiremez.

## Güvenlik

- Uygulama tablolarında Row Level Security (RLS) etkinleştirilir.
- E-posta ve doğum tarihi herkese açık profil tablosunda tutulmaz.
- Admin rolü user_roles tablosunda verilir; kullanıcı kendi rolünü yükseltemez.
- Secret/service_role anahtarları yalnızca sunucu ortamında kalır. Publishable key tarayıcıda kullanılabilir, ancak RLS zorunludur.
- IP adresi Edge Function tarafında alınır ve AES-GCM ile şifrelenmiş biçimde kaydedilir. Admin kayıtları yalnızca security-logs fonksiyonundan görebilir.
- Güvenlik olayları 30 gün sonra temizlenmelidir. cleanup_security_events() fonksiyonunu Supabase Cron ile günlük çalıştır.

## Firebase'den hesap/veri geçişi

Firebase Auth kullanıcıları, parolaları ve Firestore belgeleri bu SQL ile otomatik taşınmaz. Mevcut Firebase kullanıcıları aynı parola ile otomatik olarak Supabase'e giriş yapamaz. Eski kullanıcıların UID eşlemesi, veri dışa aktarımı ve parola sıfırlama/yeniden kayıt akışı ayrıca planlanmalıdır. Firebase projesini veya yedeklerini bu geçiş doğrulanmadan silme.

## Aura X birleşimi

Bağlı GitHub deposunda eski Aura X kaynak kodu yok. Daha önce tarif ettiğin takip, hikâye, oda, özel mesaj, çizim, çıkartma, bildirim ve yönetim kavramları aynı Supabase hesabı ve veri modeli altında birleştirilecek şekilde hazırlandı. Eski Aura X arayüzünü birebir taşımak için onun kaynak deposu/arşivi gerekir.

## Yerelde çalıştırma

    python3 -m http.server 8080
    # http://localhost:8080

Google OAuth yönlendirmesi ve Supabase Auth için HTTPS veya localhost kullan. privacy.html içindeki veri sorumlusu adı ve iletişim alanlarını gerçek bilgilerle tamamlamadan yayınlama.

## Test edilmesi gerekenler

Canlı yayına geçmeden önce normal kayıt/giriş, Google OAuth dönüşü, profil tamamlama, Plus başvurusu/onayı, 3/6 oda limiti, 20/30 kişi oda kapasitesi, takip/özel mesaj, hikâye görünürlüğü, görsel kotası, video süresi ve admin IP kayıtlarını iki ayrı test hesabıyla dene.