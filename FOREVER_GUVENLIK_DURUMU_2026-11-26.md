# FOREVER güvenlik çalışması — 26 Kasım 2026

Bu dosya, bu tarihte gerçek Supabase projesinde yapılan değişiklikleri ve henüz tamamlanmayan işleri kaydeder. Bu bir bağımsız sızma testi veya hukuki uygunluk sertifikası değildir.

## Proje ve Git sınırı

- GitHub deposu: `auraultrax/Beray-Forever`
- Çalışma dalı: `feature/forever-mode-and-education`
- Canlı Supabase projesi: `FOREVER` (`gfuewsdkytfssumxwyxz`)
- `main` dalına birleştirme yapılmadı.
- GitHub'daki mevcut uygulama kodu farklı bir Supabase URL'sine ve eski tablo modeline bağlı. Bu nedenle uygulamanın bağlantı adresi bu çalışmada değiştirilmedi; URL'yi körlemesine değiştirmek oturum, profil, gönderi ve oda işlemlerini bozabilirdi.

## Gerçek Supabase üzerinde tamamlanan değişiklikler

1. `public.public_profiles` adlı, yalnızca izin verilen profil alanlarını taşıyan ayrı bir tablo eklendi. E-posta, doğum tarihi, IP ve özel alanlar bu tabloya kopyalanmaz.
2. Özel `users` belgelerinin tüm oturum açmış kullanıcılara okunmasını engelleyen RLS politikası kuruldu. Tam profil belgesi yalnızca sahibi veya sistem yöneticisi tarafından okunabilir.
3. Profildeki kullanıcı adı, UID, rol, doğrulama, ban/kısıtlama, Plus ve diğer güvenlik alanlarının normal istemci tarafından değiştirilmesini engelleyen sunucu tetikleyicisi eklendi.
4. Gönderi oluşturma/güncelleme ve oda mesajı ekleme kontrolleri sahiplik ve oda üyeliği ile sınırlandırıldı.
5. Doğrudan oda ve oda üyeliği oluşturma/silme yolları kapatıldı; parola kontrolü ve üyelik işlemleri sunucu RPC'lerine taşındı.
6. Oda RPC'leri kullanıcı adını istemciden kabul etmek yerine doğrulanmış profilden alıyor. Oda parolası bcrypt tabanlı hash olarak özel tabloda tutuluyor; oda JSON belgesinde düz metin parola bulunmuyor.
7. Oda yardımcı yöneticilerinin odayı silmesi engellendi; oda silme hakkı oda sahibi ve sistem yöneticisiyle sınırlandırıldı.
8. Oda çizim özelliği arayüzden ve yeni oda kayıtlarından kaldırıldı. Profil/emoji gibi ilgisiz canvas işlevleri kaldırılmadı.
9. Oda yöneticisi/owner rolü ile sistem yöneticisi rolü ayrıldı; yalnızca oda sahibi veya sistem yöneticisi odayı silebilir.

## Test edilenler

- SQL değişiklikleri önce işlem geri alınarak denendi; sonra iki migration gerçek projeye uygulandı.
- RLS testi bir deneme hesabı kimliğiyle transaction içinde çalıştırıldı ve `ROLLBACK` ile tüm test yazmaları geri alındı.
- Başka kullanıcının ham profil kaydına erişimin engellenmesi, hassas profil alanlarının yazılamaması, doğrudan oda/üyelik eklemenin reddedilmesi ve oda üyesi olmayan kullanıcının mesaj ekleyememesi kontrol edildi.
- Güvenli profil projeksiyonunda e-posta, doğum tarihi, IP ve kaydedilmiş gönderiler gibi özel alanların bulunmadığı doğrulandı.
- Doğrudan takipçi/takip edilen listesini değiştirme denemesi de reddedildi; takip listelerini yalnızca sunucu tarafı takip işlevi güncelleyebilir.
- Oda oluşturma/katılma RPC'leri istemcinin gönderdiği kullanıcı adını kullanmayacak şekilde güncellendi; yeni oda şifresi en az 8 karakter ve hash olarak özel tabloda tutulur.
- Güncel `index.html` içindeki 6 satır içi JavaScript bloğu sözdizimi açısından ayrıştırıldı; hata bulunmadı. Oda çizim işlevine ait eski işaretlerin kalmadığı doğrulandı.

## Henüz tamamlanmayan / yayına engel konular

- Supabase güvenlik taraması, sızdırılmış parolalara karşı korumanın kapalı olduğunu bildiriyor. Supabase Dashboard > Authentication > Settings > Password Security bölümünden "Leaked Password Protection" açılmalı. Bu ayar, mevcut araçlarla buradan değiştirilemedi.
- Tarayıcı uygulaması henüz bu Supabase projesinin veri modeline uyarlanmadı. `supabase-bridge.js` eski ayrı tabloları bekliyor; canlı proje ise `forever_documents` modelini kullanıyor.
- Bu nedenle güncel arayüz dalı henüz üretime alınmamalı ve GitHub Pages'e yayınlanmamalıdır.
- Oda oluşturma/katılma için UI tarafındaki eski RPC adları ve veri şekilleri henüz yeni `forever_*` RPC'lerine uyarlanmadı.
- Forever Eğitim tabloları, MEB e-posta OTP Edge Function'ı, öğretmen davet sistemi ve sınıf erişim ekranları henüz oluşturulmadı.
- Resend hesabı/alan adı doğrulaması ve API anahtarı henüz yapılandırılmadı; gerçek MEB posta kutusuna test e-postası gönderilmedi.
- Eğitim verisi için school/class-scope RLS, tekrar kullanılabilir davet, süresi geçmiş OTP, yatay yetki yükseltme ve okul dışı erişim testleri henüz yapılmadı.
- Canlı ses, ekran paylaşımı ve sınıf tahtası için açık kullanıcı kontrolleri, veli/kurum onayı, kötüye kullanım/raporlama ve kayıt saklama tasarımı tamamlanmadı.

## Maliyet ve gizlilik ilkeleri

- Öncelik ücretsiz katmanlar ve Supabase Edge Function Secrets kullanımıdır. Ücretsiz e-posta seçeneği olarak Resend Free araştırılmıştır; 3.000 e-posta/ay ve günlük 100 e-posta sınırı vardır. Bir gönderici alan adı doğrulaması gerekir; alan adı satın almak zorunluysa bu maliyet ücretsiz değildir.
- Ücretli hizmete otomatik geçiş veya beklenmedik harcama yapılmaz.
- Service-role anahtarı veya e-posta sağlayıcı API anahtarı tarayıcıya konmaz.
- Gerçek öğrenci/çocuk verisi; sorumlu okul/kurumun yazılı onayı, KVKK ve gerekli veli süreçleri, saklama/silme planı, yedekleme ve bağımsız güvenlik incelemesi olmadan alınmamalıdır.
- Hiçbir test, mutlak güvenlik veya hukuki sorumluluktan muafiyet garantisi vermez.
