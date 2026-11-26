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

## Resend Free e-posta ayarı

Okul kodu doğrulama fonksiyonu Resend ile gönderim yapacak şekilde hazırlanmıştır. Gönderim, şu üç Edge Function secret değeri girilene kadar 503 `mail_service_not_configured` döndürür:

- `RESEND_API_KEY`: Resend hesabından oluşturulan API anahtarı.
- `MAIL_FROM`: Resend'de doğrulanmış kendi alan adındaki gönderici, ör. `Forever <no-reply@mailer.senin-alanin.example>`.
- `OTP_HMAC_SECRET`: En az 32 rastgele byte uzunluğunda gizli HMAC anahtarı.

HMAC secret'ı kendi makinenin terminalinde üret:

```bash
openssl rand -hex 32
```

Üretilen değeri yalnızca Supabase Dashboard > Edge Functions > Secrets bölümüne gir. Sohbete, GitHub'a, HTML/JavaScript'e veya ekran görüntüsüne koyma. Resend API anahtarını da aynı şekilde sadece Edge Function Secret olarak gir.

Resend'de:
1. Kendi kontrol ettiğin gönderici alan adını ekle.
2. Resend'in verdiği SPF/DKIM DNS kayıtlarını alan adı DNS panelinde aynen tanımla.
3. Alan adı Resend'de doğrulanmadan gerçek okul posta kutularına gönderim testi yapma.
4. Ücretli kullanıma otomatik geçiş veya otomatik kullanım aşımı ayarlarını etkinleştirme. Ücretsiz plan limitine ulaşınca okul doğrulama gönderimi durmalı.

Resend Free plan sınırları değişebilir; açılış tarihinde fiyat/limit sayfasını tekrar kontrol et: https://resend.com/pricing/

## Okul adına yetki ve çocuk verileri

MEB kurumsal posta kutusuna kodun gönderilip girilmesi yalnızca o posta kutusuna erişimi kanıtlar; hesabın sahibi kişinin okul adına hukuken yönetici/temsilci olduğunu tek başına kanıtlamaz. Gerçek okul hesabı açılmadan önce kurumun yetkili temsilcisi tarafından ayrıca onaylanmalı.

Gerçek öğrencilerin verileri kullanılmadan önce okulun yazılı onayı, KVKK değerlendirmesi, gerekli veli süreçleri, aydınlatma, saklama/silme, yedekleme ve olay müdahale planı tamamlanmalıdır. Bu uygulama tek başına hukuki uygunluk veya mutlak güvenlik garantisi değildir.

## Bilerek henüz etkinleştirilmeyenler

- Mikrofonu uzaktan/gizlice kontrol etme yok. Öğretmen yalnızca ses açma/kapama isteği gönderebilir; öğrenci kendi cihazında onaylar.
- Canlı ses aktarımı ve ekran paylaşımı bu sürümde yok.
- Eğitim, mevcut uygulama auth ve veri köprüsü hedef FOREVER projesine taşınana kadar giriş sonrası güvenlik ekranında kalır.
- Bu dal taslak PR olarak kalır; test edilmemiş kod ana dala birleştirilmez.
