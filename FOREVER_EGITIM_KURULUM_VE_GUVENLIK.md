# Forever Eğitim — kurulum ve yayına hazırlık

Bu belge, Eğitim modülünün neden henüz gerçek okul/öğrenci kullanımına açılmadığını ve güvenli açılış için gereken adımları kaydeder.

## Şu anda kurulu olanlar

- Eğitim tabloları ve RLS, FOREVER Supabase projesine uygulanmıştır.
- Okul/sınıf eşleşmesi veritabanı tetikleyicileriyle korunur.
- Öğretmen daveti ve öğrenci başvuruları ayrı onay adımları kullanır.
- Denetim kayıtları, başvuru kararları, sınıf/tahta işlemleri ve ders oturumları için eklenmiştir.
- `education-school-verify` Edge Function sürüm 4 olarak dağıtılmıştır; JWT doğrulaması açıktır.
- Eğitim arayüzü kodu çalışma dalındadır ve normal girişe bir alan seçimi ekler.

## Kritik bağlantı engeli

Mevcut `index.html` hâlâ `zblbsjmtituericpmazj` Supabase projesine bağlanır. Eğitim tabloları ise `gfuewsdkytfssumxwyxz` projesindedir. Ayrıca mevcut `supabase-bridge.js` eski ayrı tablo yapısını bekler; yeni FOREVER projesi `forever_documents` JSONB modelini kullanır.

Bu sebeple Eğitim arayüzü farklı iki Supabase kimliğini otomatik eşleştirmez. Sosyal giriş ve köprü, kullanıcı hesaplarını/verileri bozmadan aynı FOREVER projesine taşınmadan gerçek okul veya öğrenci kaydı alınmamalıdır. Bu dosyadaki ayarları yapmak tek başına bu kimlik bağlantısı problemini çözmez.

## Gmail API e-posta ayarı

Okul doğrulama kodları, HTTPS üzerinden Gmail API kullanılarak **xauraultra@gmail.com** hesabından gönderilecek şekilde hazırlanmıştır. Supabase Edge Functions SMTP'nin 25 ve 587 numaralı portlarına giden bağlantıları engellediği için SMTP yerine Gmail API kullanılır.

Gmail API için tek seferlik OAuth 2.0 izni gerekir. Uygulama yalnızca `https://www.googleapis.com/auth/gmail.send` kapsamını ister; posta kutusunu okumak için bir yetki kullanılmaz. Function, her gönderimden önce Gmail profilindeki hesabın tam olarak `xauraultra@gmail.com` olduğunu kontrol eder.

### Google Cloud tarafı

1. Google Cloud Console'da bir proje oluştur ve **Gmail API**'yi etkinleştir.
2. OAuth consent screen / Google Auth Platform kısmında uygulama bilgilerini ayarla. Geliştirme sırasında `xauraultra@gmail.com` hesabını test user olarak ekle.
3. Bir OAuth Client ID oluştur. OAuth Playground ile yetki vereceksen redirect URI listesine `https://developers.google.com/oauthplayground` ekle.
4. OAuth 2.0 Playground ayarlarında **Use your own OAuth credentials** seçeneğini etkinleştir ve kendi Client ID / Client Secret değerlerini gir.
5. Yalnızca `https://www.googleapis.com/auth/gmail.send` kapsamı için yetki ver; authorization code'u access token ile değiştirirken **refresh token** al. Google, refresh token'ı `access_type=offline` talep edildiğinde verir.
6. Yetki verilen Google hesabının `xauraultra@gmail.com` olduğundan emin ol.

Google OAuth uygulaması **Testing** durumunda ve External kullanıcı türündeyse Gmail kapsamı nedeniyle refresh token 7 gün sonra sona erebilir. Kalıcı kullanıma geçmeden önce OAuth uygulamasının yayın/verification gereksinimleri tamamlanmalıdır. Google, refresh token'ın güvenli uzun süreli saklanmasını ve iptal/sona erme ihtimallerinin ele alınmasını ister.

### Supabase Edge Function Secrets

Supabase Dashboard > Edge Functions > Secrets bölümüne şu değerleri gir:

- `GMAIL_CLIENT_ID`: Google OAuth Client ID.
- `GMAIL_CLIENT_SECRET`: Google OAuth Client Secret.
- `GMAIL_REFRESH_TOKEN`: `xauraultra@gmail.com` hesabına ait Gmail API refresh token.
- `OTP_HMAC_SECRET`: en az 32 rastgele byte uzunluğunda gizli HMAC anahtarı.

HMAC secret'ı kendi cihazında üret:

```bash
openssl rand -hex 32
```

Bu sırları yalnızca Supabase'in **Edge Function Secrets** alanına gir. Sohbete, GitHub'a, HTML/JavaScript'e veya ekran görüntüsüne koyma. Google hesabının parolasını veya OAuth sırlarını bana gönderme.

Kod 8 haneli, 5 dakika geçerli ve en fazla 5 yanlış denemelidir. Veritabanında kodun kendisi değil HMAC özeti saklanır. E-postanın gönderim zamanı, gönderici hesabı, Gmail sağlayıcısı ve sağlayıcı mesaj kimliği de challenge satırına kaydedilir. Böylece doğrulama için gereken kayıt kalır; veritabanı okunursa kod düz metin olarak açığa çıkmaz.

## Okul adına yetki ve çocuk verileri

MEB kurumsal posta kutusuna kodun gönderilip girilmesi yalnızca o posta kutusuna erişimi kanıtlar; hesabın sahibi kişinin okul adına hukuken yönetici/temsilci olduğunu tek başına kanıtlamaz. Gerçek okul hesabı açılmadan önce kurumun yetkili temsilcisi tarafından ayrıca onaylanmalı.

Gerçek öğrencilerin verileri kullanılmadan önce okulun yazılı onayı, KVKK değerlendirmesi, gerekli veli süreçleri, aydınlatma, saklama/silme, yedekleme ve olay müdahale planı tamamlanmalıdır. Bu uygulama tek başına hukuki uygunluk veya mutlak güvenlik garantisi değildir.

## Bilerek henüz etkinleştirilmeyenler

- Mikrofonu uzaktan/gizlice kontrol etme yok. Öğretmen yalnızca ses açma/kapama isteği gönderebilir; öğrenci kendi cihazında onaylar.
- Canlı ses aktarımı ve ekran paylaşımı bu sürümde yok.
- Eğitim, mevcut uygulama auth ve veri köprüsü hedef FOREVER projesine taşınana kadar giriş sonrası güvenlik ekranında kalır.
- Bu dal taslak PR olarak kalır; test edilmemiş kod ana dala birleştirilmez.
