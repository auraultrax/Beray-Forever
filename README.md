# Forever · Beray

Forever, Google hesabıyla giriş yapılan; Supabase Auth, PostgreSQL, Realtime ve Storage üzerinde çalışan sosyal platformdur.

## İlk kurulum

1. Yeni Supabase projesinde SQL Editor bölümünü aç.
2. supabase/schema.sql dosyasının tamamını çalıştır. Mevcut kurulumlarda bu sürüm, yönetici kontrollü Süper Plus üyeliği, BAI sayaçları, Realtime rozetleri ve oda moderasyonu kurallarını da kurar.
3. Supabase → Authentication → Providers → Google alanında Google sağlayıcısını etkinleştir. Google Cloud Console'dan oluşturduğun Web application OAuth Client ID ve Client Secret değerlerini buraya ekle.
4. Google Cloud Console'daki OAuth istemcisinde Authorized JavaScript origins kısmına yerel geliştirme adresini (ör. http://localhost:8080) ve canlı site adresini ekle.
5. Aynı OAuth istemcisinde Authorized redirect URIs kısmına şu Supabase callback adresini ekle:
   https://gfuewsdkytfssumxwyxz.supabase.co/auth/v1/callback
6. Supabase → Authentication → URL Configuration alanında canlı site adresini Site URL olarak ayarla; Redirect URLs listesine yerel ve canlı adresleri ekle (ör. http://localhost:8080/** ve https://SENIN-DOMAININ/**).
7. Yönetici olacak Google hesabı için aşağıdaki SQL'i SQL Editor'de çalıştır. E-posta adresini kendi yönetici hesabınla değiştir:

    insert into public.forever_admins(email)
    values (lower('YONETICI_GOOGLE_EPOSTASI'))
    on conflict(email) do nothing;

8. SQL'in forever-media (herkese açık gönderi medyası) ve forever-stories (özel hikâye medyası) bucket'larını oluşturduğunu doğrula.
9. Database → Replication / Realtime alanında forever_documents tablosunun supabase_realtime yayınına eklendiğini doğrula.
10. Siteyi HTTPS üzerinden yayımla. Google OAuth ve PWA özellikleri için canlı dağıtım adresini kullan.

> Bu depo için canlı durum: FOREVER adlı Supabase projesinde ilk şema, güvenlik sertleştirmesi, RLS performans iyileştirmesi, yorum sahipliği, anket oy bütünlüğü ve Storage klasör kısıtlamaları olmak üzere altı migration uygulanmış durumda. Google OAuth sağlayıcısı ise proje panelinde henüz etkin değil; Google Client ID/Secret girilip kaydedilmeden Google girişinin çalışması beklenmez.

## Yapı

- index.html — Forever ana arayüzü, Google ile giriş, kayıt ve sosyal akış.
- supabase-compat.js — Eski veri erişim çağrılarını Supabase'e yönlendiren uyumluluk katmanı.
- rooms.js — Supabase Realtime oda listesi, oda sohbeti, Plus animasyonları, emoji birleştirme ve gelişmiş tema seçenekleri.
- aurai-widget.js — Plus kullanıcılarına açık BAI sohbet arayüzü.
- supabase/functions/aurai-chat ve aurai-search — BAI model ve arama proxy'leri; API anahtarları yalnızca Supabase Secrets içinde tutulur.
- BAI-KURULUM.md — BAI sağlayıcı Secret'ları, kota modeli ve Edge Function yayım adımları.
- admin.html — Supabase oturumuyla korunan yönetim paneli.
- supabase/schema.sql — Tablolar, RLS kuralları, Süper Plus yetkileri, BAI günlük sayaçları, kota denetimleri, oda moderasyonu ve Storage.
- kvkk.html — KVKK aydınlatma metni taslağı.
- kullanim-kosullari.html — Kullanım koşulları taslağı.

## Forever hesapları

Kullanıcılar Google hesabını seçtikten sonra ilk profillerini oluşturur. Kullanıcı adı, ad, soyad, doğum tarihi ve iki onay alanı zorunludur. Ad, soyad, doğum tarihi ve mümkün olan IP bilgisi forever_private_user_data tablosunda saklanır; genel profil kaydına kopyalanmaz.

IP adresi yalnızca Supabase/API katmanının ilgili istek başlıklarını sağlaması hâlinde yakalanabilir. Bu projedeki SQL şablonu IP için otomatik saklama süresi veya silme görevi kurmaz. Veri sorumlusu yayın öncesinde saklama süresini belirlemeli ve periyodik silme mekanizmasını kurmalıdır. kvkk.html içindeki tüm köşeli alanları gerçek veri sorumlusu ve iletişim bilgileriyle doldurup hukuki inceleme yaptırmadan metni nihai kabul etme.

## Gönderiler, hikâyeler ve günlük kota

- Tüm hesaplar fotoğraf/video içeren gönderi ve anket paylaşabilir; yalnızca metinden oluşan gönderiler Süper Plus ayrıcalığıdır.
- Günlük toplam fotoğraf/video yükleme sınırı hesap başına 5'tir. Gönderiler ve hikâyeler aynı kotayı paylaşır.
- Gönderi medyası forever-media bucket'ında saklanır ve herkese açık görüntülenebilir. Bu bucket'taki dosya URL'lerini bilen kişiler dosyayı doğrudan açabilir.
- forever-media yüklemeleri yalnızca posts, drawings ve stickers klasörlerine kabul edilir. Çizim ve çıkartma yüklemeleri tüm hesaplarda kullanılabilir.
- Hikâye medyası forever-stories adlı özel bucket'ta saklanır. Hikâyeler yalnızca sahibine ve onu takip eden oturum açmış kullanıcılara imzalı bağlantıyla gösterilir. Üretilen imzalı bağlantı 24 saat geçerlidir.
- Varsayılan dosya boyutu üst sınırı 25 MB'dır.

## Üyelik ve kullanım sınırları

Forever'da standart hesap ve yönetici tarafından tanımlanan **Süper Plus** üyeliği bulunur. Kullanıcı profilinin en üstündeki “Süper Plus Üyesi Ol” bağlantısı şu tanıtım sayfasına gider: https://sites.google.com/view/forever-super-plus/ana-sayfa. Üyelik verme veya kaldırma işlemini yalnızca sistem yöneticisi Yönetim Paneli → Süper Plus alanından kullanıcı adıyla yapabilir.

Süper Plus ayrıcalıkları:
1. Profilde ve kullanıcı bulma alanında elmas/ doğrulanmış rozeti.
2. Ek uygulama simgeleri (Mor, Zümrüt, Okyanus).
3. Yalnızca metin içeren gönderi paylaşma.
4. Özel animasyonlu çıkartmalar.
5. Emoji birleştirme.
6. BAI sohbeti ve aramasında kişi başı günlük kullanım kotası olmaması.
7. Kendi gönderisini 24 saate kadar akışın en üstüne çıkarma.
8. Ek oda temaları, renkler ve baloncuk şekilleri.
9. Animasyonlu emoji gönderme.

Standart hesaplar için oda ve medya sınırları korunur:
- Her hesap en fazla 3 odaya katılabilir.
- Her hesap günde toplam 5 fotoğraf/video yükleyebilir; gönderiler ve hikâyeler aynı kotayı paylaşır.
- Tek medya dosyasının varsayılan üst sınırı 25 MB'dır.

Standart hesaplarda BAI günlük 30 sohbet ve 10 arama isteğiyle sınırlıdır. Süper Plus, BAI'de kişi başı günlük limiti kaldırır; sağlayıcı kesintileri ve tüm siteyi koruyan ortak günlük sistem bütçesi (varsayılan 5.000 istek) devam eder. Model/arama hizmeti ayrıca yapılandırılmalıdır. Süper Plus oda veya medya kotasını artırmaz.
## Yönetim

Yönetim paneli Google OAuth ile giriş yapar ancak hesabın e-posta adresi public.forever_admins tablosunda kayıtlı değilse panel açılmaz. İlk yönetici hesabı için yukarıdaki SQL adımını uygula.

Panelden kullanıcıyı askıya alabilir/yasaklayabilir, şikâyetleri çözebilir, oda üyelerini çıkarabilir, odaya yeniden girişlerini engelleyebilir ve Süper Plus üyeliğini kullanıcı adıyla verebilir/kaldırabilirsin.

## Güvenlik

Yetki kontrolü ve kayıt fonksiyonlarının ayrıcalıklı uygulamaları API'ye açık olmayan private şemasında tutulur. public şemasındaki uygulama RPC'leri SECURITY INVOKER olarak çalışır. Supabase RLS ve Storage politikaları erişimi sınırlar. Yorum sahibi doğrulaması ve anket oy sayımlarının veritabanında hesaplanması istemci verisine güvenilmesini önler.

## Mevcut Firebase verileri

Bu kod değişikliği uygulamanın yeni kayıt/giriş ve veri erişim yolunu Supabase'e yönlendirir. Eski Firebase verilerini otomatik olarak Supabase'e taşımaz. Eski kullanıcı, gönderi, hikâye, yorum, oda veya medya kayıtları gerekiyorsa ayrı bir dışa aktarma ve kontrollü içe aktarma işi yapılmalıdır. Eski Firebase projesi silindiyse, daha önce alınmış yedek olmadan veriler geri getirilemeyebilir.

## Yerelde çalıştırma

Statik dosyalar için örneğin:

    python3 -m http.server 8080

Ardından http://localhost:8080 adresini aç. Bu adresi Supabase Redirect URLs listesine eklediğinden emin ol.

## Yayına çıkmadan önce kontrol listesi

- [ ] Google Auth Provider etkinleştirildi ve Client ID / Secret eklendi.
- [ ] `aurai-chat` ve `aurai-search` Edge Function'ları yayımlandı; AURAI/Tavily veya Google CSE Secret'ları eklendi.
- [ ] Google Cloud OAuth callback adresi doğru girildi.
- [ ] Canlı site ve localhost Supabase Redirect URLs listesine eklendi.
- [ ] Yönetici e-postası forever_admins tablosuna eklendi.
- [ ] KVKK ve Kullanım Koşulları sayfalarındaki tüm yer tutucular dolduruldu.
- [ ] IP verisi için amaç, hukuki sebep, saklama süresi ve silme görevi belirlendi.
- [ ] Supabase projesinin bölgesi ve yurt dışı veri aktarımı koşulları incelendi.
- [ ] Gerçek kullanıcılarla açmadan önce kayıt, hikâye erişimi, oda, şikâyet, engelleme, oda moderasyonu ve ortak kota kuralları test edildi.
- [ ] Eski Firebase verilerine ihtiyaç varsa yedek/import planı hazırlandı.
