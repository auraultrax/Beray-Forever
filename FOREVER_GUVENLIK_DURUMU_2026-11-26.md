# FOREVER güvenlik ve Eğitim uygulama durumu — 26 Kasım 2026

Bu rapor, bu tarihte GitHub çalışma dalında ve canlı Supabase projesinde yapılan işleri, testleri ve devam eden engelleri ayırır. Bu belge bağımsız sızma testi, KVKK uygunluk raporu veya hukuki güvence değildir.

## Proje ve yayın durumu

- GitHub deposu: `auraultrax/Beray-Forever`
- Çalışma dalı: `feature/forever-mode-and-education`
- Canlı Supabase projesi: `FOREVER` (`gfuewsdkytfssumxwyxz`)
- Ana dal `main` değiştirilmedi; değişiklikler taslak PR #6 içinde. Birleştirme ve GitHub Pages yayını yapılmadı.
- Mevcut uygulama hâlâ `https://zblbsjmtituericpmazj.supabase.co` projesine bağlanıyor. Yeni Eğitim veritabanı `gfuewsdkytfssumxwyxz` projesinde. Mevcut `supabase-bridge.js` eski ayrı tabloları, gerçek FOREVER projesi ise `forever_documents` modelini kullanıyor.
- Bu yüzden giriş sonrası alan seçimi görünür; ancak Eğitim'e tıklanınca farklı Supabase kimliklerini birbirine karıştırmamak için güvenli bağlantı ekranı gösterilir. Sosyal'e dönmek mevcut sosyal arayüzü kapatmaz/değiştirmez. Eğitim ekranı henüz gerçek sosyal hesapla uçtan uca kullanıma açılmamıştır.

## Eğitim için canlı Supabase tarafında uygulananlar

`SUPABASE_FOREVER_EDUCATION_SETUP_V2.sql` ve ek güvenlik yamaları canlı projeye uygulandı.

Kurulan tablolar:
- Okul dizini ve okul üyeleri
- Sınıflar, öğretmen atamaları ve sınıf öğretmeni rolü
- Tek kullanımlık öğretmen davetleri ve onay talepleri
- Öğrenci sınıf başvuruları ve onaylı öğrenci üyelikleri
- Sınıf akışı, puan kayıtları ve başarı sıralaması
- Ortak tahta, sınıf oturumları ve öğrenci onaylı ses istekleri
- Yöneticiye açık denetim kayıtları
- Yalnızca sunucu erişimli e-posta doğrulama challenge/rate-limit tabloları

Güvenlik kuralları:
- Tüm Eğitim tablolarında RLS açıktır.
- Anonim istemciler okul üyelerini, sınıf akışını veya öğrenci kayıtlarını okuyamaz.
- Tarayıcı rolüne OTP tablosu, okul üyeliği ekleme veya öğrenci sınıfa doğrudan ekleme yetkisi verilmez.
- Öğrenci yalnızca kendi adına bekleyen başvuru oluşturabilir; onayı sınıf öğretmeni veya okul yöneticisi verir.
- Öğretmen MEB e-posta adresi istemeden yalnızca tek kullanımlık yönetici davetiyle başvuru yapabilir; başvuru yönetici onayına kadar bekler.
- Davet tokenı 256 bit rastgele üretilir; veritabanında ham token yerine SHA-256 özeti bulunur; 48 saat sonra geçersizdir ve bir kez kullanılır.
- Sınıf kimliği ile okul kimliğinin eşleşmesi, ilgili tablolarda tetikleyiciyle de zorlanır.
- Puan verme, öğretmen atama, öğrenci/öğretmen onayı ve tahta temizleme gibi ayrıcalıklı işlemler sunucu RPC'leri üzerinden ve rol kontrolüyle yapılır.
- Denetim tablosuna OTP, davet tokenı, parola veya servis anahtarı yazılmaz.
- Sınıf akışı, tahta, ders oturumu ve başvuru değişiklikleri için Realtime yayınları açılmıştır; RLS erişim kontrolü yürürlüktedir.

## Eğitim arayüzünde dalda bulunanlar

`forever-education.js` ve `index.html` güncellendi:
- Normal girişten sonra Forever Eğitim / Forever Sosyal alan seçimi
- Eğitim rol seçimi: öğrenci, öğretmen, yönetici
- Yönetici okul kodu/posta doğrulama formu
- Öğretmen davet bağlantısı kabul ekranı
- Öğrenci okul/sınıf başvuru formu
- Yönetici sınıf oluşturma, davet üretme, öğretmen ve öğrenci başvurularını onaylama, öğretmen/sınıf öğretmeni atama ekranları
- Öğretmen/öğrenci sınıf listesi
- Sınıf akışı, puan sıralaması, puan verme ve ortak tahta
- Öğrencilerin çizim iznini açma/kapatma
- Öğretmenin mikrofon kapatma/açma isteği; öğrenci kendi cihazında kabul veya reddeder
- Sınıf başvuruları, akış, tahta ve ders oturumları için gerçek zamanlı yenileme

Canlı ses aktarımı ve ekran paylaşımı bu sürümde uygulanmamıştır. Öğrenci mikrofonunu uzaktan veya gizlice açıp kapatma yapılmaz.

## Okul e-posta doğrulama fonksiyonu

- Edge Function: `education-school-verify`
- Canlı durum: ACTIVE, version 2, `verify_jwt=true`
- Kod 8 haneli; 5 dakika geçerli; en fazla 5 yanlış deneme.
- E-posta, kurum kodundan sunucu tarafında `kurumkodu@meb.k12.tr` olarak oluşturulur.
- Kodun HMAC-SHA-256 özeti saklanır; düz kod veritabanına yazılmaz.
- Kurum ve kullanıcı bazlı hız sınırı ve 60 saniye tekrar gönderme aralığı vardır.
- Fonksiyon Resend API üzerinden e-posta gönderilecek biçimde hazırdır; ancak gerçek e-posta gönderimi henüz yapılandırılmış değildir.

**Eksik operatör ayarları:** `RESEND_API_KEY`, `MAIL_FROM`, `OTP_HMAC_SECRET` değerleri Supabase Dashboard > Edge Functions > Secrets kısmına eklenmelidir. Anahtarlar GitHub'a, sohbete veya tarayıcı koduna yazılmamalıdır. HMAC secret en az 32 rastgele byte olmalı ve kullanıcı tarafından kendi makinesinde üretilmelidir. Resend'de gönderici alan adı doğrulanmalı ve SPF/DKIM DNS kayıtları yapılmalıdır. Bu değerler olmadığı sürece fonksiyon güvenli şekilde `mail_service_not_configured` hatası verir; gerçek MEB posta kutusuna e-posta gönderildiği iddia edilmemelidir.

## Testler

Test yazmaları transaction içinde çalıştırılıp `ROLLBACK` edildi:
- Okul yöneticisi kendi okulunda sınıf oluşturabiliyor.
- Bir okul yöneticisi başka okulun sınıfına içerik veya tahta olayı yazamıyor.
- Kullanıcı doğrudan öğrenci üyeliği veya okul rolü ekleyemiyor.
- Anonim kullanıcı okul üyeliği/sınıf akışı okuyamıyor.
- Oturum açmış kullanıcı OTP challenge tablosunu okuyamıyor.
- Sınıf oluşturulunca boş tahta durumu otomatik açılıyor.
- Denetim tetikleyicisi sınıf ve tahta oluşturma olaylarını yazıyor.
- `forever-education.js` JavaScript sözdizimi kontrolünden geçti; güncel `index.html` içindeki altı inline script de ayrıştırıldı.

Bu testler sınırlı RLS/SQL kontrolleridir; tüm uygulamayı kapsayan bağımsız saldırı testi değildir. Gerçek MEB e-posta kutusuna OTP gönderimi, gerçek kullanıcılı öğretmen/öğrenci kabul akışı ve tarayıcı uçtan uca testi yapılmadı; çünkü sosyal giriş projesi farklı ve Resend secrets/alan adı henüz ayarlı değil.

## Okul yetkisi ve hukuki veri işleme sınırı

MEB kurumsal posta kutusuna gelen kodun doğrulanması **yalnızca o posta kutusuna erişimi** gösterir; kodu giren kişinin okul adına hukuken temsil yetkisini tek başına kanıtlamaz. Okul adına yönetici yetkisi açılmadan önce kurumun yetkili temsilcisinin ayrıca onayı/kurum prosedürü gerekir.

Gerçek öğrenci/çocuk verisi ancak sorumlu okul/kurumun yazılı onayı, gerekli aydınlatma ve veli süreçleri, KVKK değerlendirmesi, saklama/silme politikası, yedekleme, erişim gözden geçirme ve olay müdahale planı tamamlandıktan sonra kullanılmalıdır. Bu yazılım hukuki uygunluk garantisi vermez.

## Hâlâ yapılması gerekenler

1. Mevcut Sosyal auth ve `supabase-bridge.js` katmanını veri kaybetmeden gerçek FOREVER projesindeki kimlik ve `forever_documents` modeline taşımak; bu yapılmadan Eğitim'e gerçek kullanıcı erişimi verilmez.
2. Supabase Auth içinde Leaked Password Protection özelliğini açmak. Güvenlik taraması bu özelliğin kapalı olduğunu bildiriyor; panelden açılması gerekiyor.
3. Resend hesabı, doğrulanmış gönderici alan adı ve üç Edge Function secret değerini yapılandırmak; gerçek posta kutusuyla uçtan uca test yapmak.
4. Okul yöneticisinin temsil yetkisini e-posta kutusu erişiminden bağımsız şekilde doğrulayacak okul prosedürünü belirlemek.
5. KVKK/veli/yayın onaylarını, yedeklemeyi ve bağımsız güvenlik testini tamamlamak.

## Maliyet ilkesi

Resend'in ücretsiz planı 3.000 e-posta/ay ve günde 100 e-posta sınırı bildirir. Ücretsiz planın limitleri aşılırsa ücretli plana otomatik geçiş yapılmamalıdır; doğrulanmış gönderici alan adı gerekir. Mevcut bir alan adı yoksa alan adı satın alma ücretsiz olmayabilir. Kaynak: https://resend.com/pricing/

Service-role/secret anahtarı tarayıcıya konmaz. Mevcut Supabase güvenlik taramasında, bazı kontrollü SECURITY DEFINER RPC'leri için uyarılar ve kapalı leaked-password protection uyarısı sürmektedir. Bu uyarılar göz ardı edilmemelidir.

## Sonuç

Eğitim veritabanı, RLS, sınıf-okul bütünlük kontrolleri, audit triggers, Realtime ve rol arayüzü çalışma dalında/live Supabase üzerinde hazırlanmıştır. Ancak mevcut Forever giriş sistemi farklı Supabase projesine bağlı olduğundan Eğitim gerçek kullanıma açılmamıştır. Ana dala birleştirme yapılmamıştır. Mutlak güvenlik veya hukuki sorumluluktan muafiyet iddiası yoktur.
