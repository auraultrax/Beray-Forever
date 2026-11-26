# Forever Eğitim — Okul Doğrulama ve Öğretmen Davet Güvenliği

Bu belge, Forever Eğitim modülünün okul sahipliği, yönetici doğrulaması, öğretmen davetleri ve erişim denetimi için hedef güvenlik tasarımını tanımlar.

## 1. Temel karar

- Öğretmenlerden `@meb.k12.tr` adresi istenmez ve öğretmenin MEB e-postası varmış gibi doğrulama yapılmaz.
- Okul sahipliğini yalnızca okulun kurumsal posta kutusuna gönderilen tek kullanımlık kodla doğrulayan yönetici başlatabilir.
- MEB kurumsal posta adresi biçimi: `kurumkodu@meb.k12.tr`.
- Öğretmen, okul yöneticisinin oluşturduğu kişiye özel davet bağlantısı üzerinden katılım talebi oluşturur.
- Daveti kabul etmek tek başına aktif öğretmen yetkisi vermez. Yönetici başvuruyu kontrol edip onayladığında erişim etkinleşir.
- Öğrenci kayıtları ve sosyal hesaplar birbirinden ayrı yetki alanlarında tutulur.

## 2. Okul yöneticisinin doğrulanması

1. Forever kullanıcısı Eğitim > Yönetici yolunu seçer.
2. Kullanıcı kurum kodunu girer. Sunucu e-posta adresini kendisi `<kurum_kodu>@meb.k12.tr` biçiminde üretir; istemciden gelen serbest bir alan adı kabul edilmez.
3. Sunucu okul için 6-8 haneli kriptografik rastgele bir OTP üretir ve okul posta kutusuna gönderir.
4. Kod yalnızca sunucuda HMAC özeti olarak saklanır; düz metin kod veritabanına, loglara veya istemciye yazılmaz.
5. Kodun geçerlilik süresi 5 dakika; deneme sayısı en fazla 5; yeniden gönderim aralığı en az 60 saniyedir. E-posta, hesap, IP ve kurum kodu bazlı hız sınırı uygulanır.
6. Kod doğruysa ve kurum kodu daha önce başka bir okula bağlanmamışsa okul kaydı atomik olarak oluşturulur; doğrulayan Forever `auth.uid()` okulun ilk yöneticisi yapılır.
7. Kurum kodu ve normalleştirilmiş kurumsal e-posta için veritabanı UNIQUE kısıtları bulunur. Aynı okul ikinci kez sahiplenilemez.
8. Yönetici değişikliği, sahiplik devri ve hassas kurtarma işlemleri yeniden kurumsal e-posta doğrulaması ister.

## 3. Öğretmen daveti

Yönetici, okul panelindeki Öğretmenler > Davet Oluştur ekranından her öğretmen için ayrı bağlantı oluşturur.

Davet oluşturulurken:
- Davet edilecek sınıf veya sınıflar seçilir.
- Her sınıf için görev/rol alanı zorunludur.
- Sınıf öğretmeni görevi açıkça seçilir; aynı sınıfta aynı anda yalnızca bir aktif sınıf öğretmeni olabilir.
- Davet okul kimliğine, oluşturucu yöneticiye, sınıf atamalarına ve rol kapsamına bağlanır.

Davet güvenliği:
- En az 256 bit kriptografik rastgele token kullanılır.
- Ham token yalnızca oluşturma yanıtında bir kez gösterilir; veritabanında sadece SHA-256/HMAC özeti saklanır.
- Varsayılan son kullanma süresi 48 saattir.
- Her token tek kullanımlıdır; kullanıldıktan, iptal edildikten veya süresi dolduktan sonra yeniden kullanılamaz.
- İstemci URL'sindeki değer rol, okul kimliği veya sınıf yetkisi olarak güvenilmez. Sunucu token özetini bulur ve okulun/davetin durumunu doğrular.
- Davet bağlantısı alan kişi normal Forever hesabıyla giriş yapar veya hesap oluşturur.
- Davet kabul edildiğinde öğretmen üyeliği `pending` olur. Yönetici başvuruyu onaylayınca üyelik aktifleşir ve yalnızca davette tanımlı sınıf/roller atanır.
- Yönetici daveti iptal edebilir; öğretmen üyeliğini ve sınıf yetkilerini anında kaldırabilir.
- Tek bir genel, tekrar kullanılabilir öğretmen bağlantısı oluşturulmaz.

İleri seviye koruma: Yönetici daveti belirli bir Forever kullanıcı adına bağlayabilmelidir. Böylece bağlantı başka bir hesaba iletilirse kabul edilmez.

## 4. E-posta gönderim mimarisi

- E-posta gönderimi sadece Supabase Edge Function üzerinden yapılır.
- Ücretsiz başlangıç için Resend Free tercih edilir. Planın sınırları (3.000 e-posta/ay, günlük 100 e-posta) aşılmadan izlenir; kota aşımında kullanıcı onayı olmadan ücretli plana geçilmez.
- Resend API anahtarı GitHub'a veya HTML/JS istemci koduna konmaz; yalnızca Supabase Edge Function Secrets içinde saklanır.
- Gönderici adresi Forever'ın kontrol ettiği ve Resend'de doğrulanmış kendi alan adından olur. MEB alan adı taklit edilmez.
- Gönderici alan adı için SPF/DKIM ve mümkünse DMARC yapılandırılır.
- OTP doğrulaması ile e-posta gönderme birbirinden ayrı işlemlerdir; Resend yalnızca iletiyi teslim eder. Okul yetkisini veritabanındaki doğrulama işlemi verir.
- E-posta gövdesinde OTP dışında öğrenci/öğretmen kişisel verisi gönderilmez.

Gerekli sunucu sırları:
- `RESEND_API_KEY`
- `MAIL_FROM`
- `OTP_HMAC_SECRET`
- `APP_BASE_URL`

Sırlar yalnızca Supabase Edge Function Secrets içinde tanımlanır. Resend API anahtarına erişim sınırlandırılır; GitHub Actions, HTML, JavaScript ve tarayıcı loglarına yazılmaz.
## 5. Veritabanı ve erişim sınırları

Eğitim için ayrı ilişkisel tablolar:
- `education_schools`
- `education_school_members`
- `education_school_verifications`
- `education_classes`
- `education_teacher_invites`
- `education_teacher_requests`
- `education_teacher_assignments`
- `education_student_requests`
- `education_class_feed`
- `education_class_points`
- `education_audit_log`

Her eğitim tablosunda RLS etkin olur. İstemciye `service_role` anahtarı verilmez. Kullanıcı tarafından düzenlenebilir `user_metadata` rol/yetki kararında kullanılmaz. Öğretmen yalnızca aktif üyeliği bulunan okul ve atanmış sınıfları görebilir. Öğrenci yalnızca kabul edilmiş olduğu sınıfın içeriğine erişebilir. Puan ve öğretmen atama değişiklikleri sunucu tarafında yetkilendirilir.

Yönetici, öğretmen, öğrenci ve sınıf öğretmeni yetkileri ayrı ayrı kontrol edilir. İstemci arayüzünde düğmeyi gizlemek yetkilendirme sayılmaz.

## 6. Denetim ve kötüye kullanım önlemleri

- Okul sahipliği doğrulaması, OTP gönderimleri, başarısız denemeler, davet oluşturma/kabul/iptal, öğretmen onayı, sınıf ataması, öğrenci kabulü, puan değişikliği ve yetki iptali denetim kaydına yazılır.
- Denetim kaydı normal kullanıcılardan değiştirilemez/silinemez.
- OTP ve davet tokenları hiçbir logda tutulmaz.
- Tekrarlanan kod denemelerinde geçici kilit uygulanır.
- Okul yöneticisi hesabında hassas işlemler için yeniden kimlik doğrulama ve tercihen MFA istenir.
- Öğrenci ses/ekran paylaşımı açık rıza ve görünür kullanıcı kontrolü ile çalışır; yönetici/öğretmen öğrencinin mikrofonunu veya ekranını gizlice açamaz.
- Öğrenci verisi için veri minimizasyonu, okulun aydınlatma/saklama politikaları ve KVKK değerlendirmesi yayından önce tamamlanır.

## 7. Uygulama sırası

1. GitHub uygulamasını gerçek FOREVER Supabase projesinin `forever_documents` veri modeline uyumlu hale getirmek; eski ve yeni şema karışıklığını çözmek.
2. Ayrı eğitim tablolarını, RLS politikalarını ve yetki yardımcılarını eklemek.
3. SES gönderim Edge Function'ını ve okul OTP iş akışını geliştirmek.
4. Tek kullanımlık öğretmen davetleri ve yönetici onayını eklemek.
5. Sınıf, öğrenci başvurusu, akış, tahta, ses/ekran ve puanlama modüllerini geliştirmek.
6. RLS, token tekrar kullanımı, süre aşımı, okul dışı erişim ve yetki yükseltme testlerini çalıştırmak.

## 8. Yayına çıkmadan önce gerekli operatör ayarları

- Resend hesabı ve Forever'ın kontrol ettiği bir gönderici alan adı gerekir. Domain satın alma maliyeti ücretsiz değildir; zaten sahip olunan alan adı kullanılabiliyorsa ayrıca domain maliyeti oluşmaz.
- Resend panelinin istediği SPF/DKIM DNS kayıtları eklenir; alan adı sahibi DMARC politikasını da yapılandırır.
- Resend Free gönderim limitleri izlenir. Ücretli plana otomatik geçiş yapılmaz.
- `RESEND_API_KEY`, `MAIL_FROM`, `OTP_HMAC_SECRET` ve `APP_BASE_URL` yalnızca Supabase Edge Function Secrets içinde tanımlanır.
- Gerçek MEB kurumsal posta kutusuyla uçtan uca test yapılmadan okul doğrulaması yayına alınmaz.
- Gerçek öğrenci verisi ancak sorumlu okul/kurumun onayı, KVKK değerlendirmesi, aydınlatma ve gerekli veli süreçleri, saklama/silme politikası, yedekleme ve olay müdahale planı tamamlandıktan sonra işlenir.

## Resmî teknik kaynaklar

- MEB kurumsal e-posta hizmeti: https://www.meb.gov.tr/eposta/
- Resend ücretsiz planı ve limitleri: https://resend.com/pricing
- Resend alan adı doğrulama: https://resend.com/docs/dashboard/domains/introduction
- Supabase Edge Function Secrets: https://supabase.com/docs/guides/functions/secrets
