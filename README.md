# Forever · Beray

Forever, Google hesabıyla giriş yapılan; Supabase Auth, PostgreSQL, Realtime ve Storage üzerinde çalışan sosyal platformdur.

## Önemli: ilk kurulum

1. Supabase projesinde **SQL Editor** bölümünü aç.
2. `supabase/schema.sql` dosyasının tamamını çalıştır.
3. Supabase → Authentication → Providers bölümünden **Google** sağlayıcısını etkinleştir ve Google OAuth Client ID / Secret bilgilerini ekle.
4. Supabase → Authentication → URL Configuration bölümünde canlı Forever adresini Redirect URLs listesine ekle. Yerel geliştirme için kullandığın localhost adresini de ekleyebilirsin.
5. `supabase/schema.sql` içindeki yönetici ekleme örneğinde `admin@example.com` yerine yönetici Google hesabının e-posta adresini yazıp o SQL satırlarını ayrıca çalıştır.
6. Supabase → Storage alanında `forever-media` bucket'ının oluşturulduğunu doğrula. SQL dosyası bucket'ı ve erişim kurallarını oluşturur.
7. Supabase → Database → Replication / Realtime alanında `forever_documents` tablosunun Realtime yayınına eklendiğini doğrula.
8. Siteyi HTTPS üzerinden yayımla. Google OAuth ve PWA özellikleri için gerçek dağıtım adresini Supabase yönlendirme ayarlarında kullan.

## Yapı

- `index.html` — Forever ana arayüzü, Google ile giriş, kayıt ve sosyal akış.
- `supabase-compat.js` — Eski veri erişim çağrılarını Supabase'e yönlendiren uyumluluk katmanı.
- `rooms.js` — Supabase Realtime oda listesi, oda sohbeti, Plus çıkartmaları ve çizim.
- `admin.html` — Supabase oturumuyla korunan yönetim paneli.
- `supabase/schema.sql` — Tablolar, RLS kuralları, kayıt/Plus fonksiyonları, kota denetimleri ve Storage.
- `kvkk.html` — KVKK aydınlatma metni taslağı.
- `kullanim-kosullari.html` — Kullanım koşulları taslağı.

## Forever hesapları

Kullanıcılar Google hesabını seçtikten sonra ilk profillerini oluşturur. Kullanıcı adı, ad, soyad, doğum tarihi ve iki onay alanı zorunludur. Ad, soyad, doğum tarihi ve mümkün olan IP bilgisi `forever_private_user_data` tablosunda saklanır; genel profil kaydına kopyalanmaz.

IP adresi yalnızca Supabase/API katmanının ilgili istek başlıklarını sağlaması hâlinde yakalanabilir. Bu projedeki SQL şablonu IP için otomatik saklama süresi veya silme görevi kurmaz. Veri sorumlusu yayın öncesinde saklama süresini belirlemeli ve periyodik silme mekanizmasını kurmalıdır. `kvkk.html` içindeki tüm köşeli alanları gerçek veri sorumlusu ve iletişim bilgileriyle doldurup hukuki inceleme yaptırmadan metni nihai kabul etme.

## Gönderiler ve günlük kota

- Standart üyeler fotoğraf veya video içeren gönderi paylaşır; açıklama isteğe bağlıdır.
- Yalnızca metin gönderisi Plus üyelere açıktır.
- Günlük toplam fotoğraf/video yükleme sınırı standart üyelerde 5, Plus üyelerde 10'dur. Gönderiler ve hikâyeler aynı kotayı paylaşır.
- Medya `forever-media` Supabase Storage bucket'ına yüklenir. Varsayılan dosya boyutu üst sınırı 25 MB'dır.

## Forever Plus

Plus üyeliği uygulama içi satın alma değildir; yönetici `admin.html` içinden kullanıcı adını girerek Plus tanımlar veya kaldırır.

Plus özellikleri:
- Hazır ve özel animasyonlu çıkartmalar gönderme.
- Kullanıcı adının yanında mor zümrüt tasarımlı işaret ve mavi doğrulanmış rozet.
- Odalarda çizim yapma.
- Özel uygulama simgeleri.
- Üçten fazla odaya katılma; standart üyeler en fazla üç odaya katılır.
- Oda mesajlarını sabitleme.
- +10 takipçi bonus hakkı.
- Günlük toplam 10 fotoğraf/video yükleme.
- Yalnızca metin gönderisi paylaşma.

## Yönetim

Yönetim paneli Google OAuth ile giriş yapar ancak hesabın e-posta adresi `public.forever_admins` tablosunda kayıtlı değilse panel açılmaz. Bu kontrolü SQL Editor üzerinden yalnızca güvenilir yönetici hesabı için yap.

Panelden kullanıcıyı askıya alabilir/yasaklayabilir, şikâyetleri çözebilir, oda üyelerini çıkarabilir/odaya girişini engelleyebilir ve Plus üyeliği yönetebilirsin.

## Mevcut Firebase verileri

Bu kod değişikliği uygulamanın yeni kayıt/giriş ve veri erişim yolunu Supabase'e yönlendirir. **Eski Firebase verilerini otomatik olarak Supabase'e taşımaz.** Eski kullanıcı, gönderi, hikâye, yorum, oda veya medya kayıtları gerekiyorsa ayrı bir dışa aktarma ve kontrollü içe aktarma işi yapılmalıdır. Eski Firebase projesi silindiyse, daha önce alınmış yedek olmadan veriler geri getirilemeyebilir.

## Yerelde çalıştırma

Statik dosyalar için örneğin:

```bash
python3 -m http.server 8080
```

Ardından `http://localhost:8080` adresini aç. Supabase tarafında localhost için de uygun Redirect URL tanımlanmış olmalıdır.

## Yayına çıkmadan önce kontrol listesi

- [ ] `supabase/schema.sql` çalıştırıldı.
- [ ] Google Auth Provider ve Redirect URLs yapılandırıldı.
- [ ] Yönetici e-postası `forever_admins` tablosuna eklendi.
- [ ] KVKK ve Kullanım Koşulları sayfalarındaki tüm yer tutucular dolduruldu.
- [ ] IP verisi için amaç, hukuki sebep, saklama süresi ve silme görevi belirlendi.
- [ ] Supabase projesinin bölgesi ve yurt dışı veri aktarımı koşulları incelendi.
- [ ] Gerçek kullanıcılarla açmadan önce oda, şikâyet, engelleme, Plus ve kota kuralları test edildi.
- [ ] Eski Firebase verilerine ihtiyaç varsa yedek/import planı hazırlandı.
