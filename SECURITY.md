# Forever · Güvenlik notları

Bu dalda uygulama backend'i Supabase Auth, Postgres RLS, Realtime, Storage ve Edge Functions üzerine kuruludur.

## Anahtar yönetimi

- supabase-config.js içindeki URL ve publishable key tarayıcıda kullanılmak üzere tasarlanmıştır. Güvenlik sınırı RLS politikalarıdır.
- Secret API key, legacy service_role, veritabanı parolası ve IP şifreleme anahtarları HTML, JavaScript, GitHub deposu veya kullanıcıya açık loglara konmaz.
- Edge Functions Supabase'in sağladığı secret key ortam değişkenini kullanır. IP_LOG_ENCRYPTION_KEY ve IP_HASH_SECRET yalnızca Edge Function Secrets içinde saklanır.

## Veri erişimi

- Kullanıcı e-postası Supabase Auth içinde kalır; herkese açık profiles tablosuna yazılmaz.
- Doğum tarihi private_profiles tablosunda yalnızca hesap sahibine açıktır.
- Plus rolü veritabanı RPC'si ile verilir. Tarayıcı kendi plus_member alanını değiştiremez.
- Oda oluşturma ve katılım sınırları veritabanı fonksiyonlarında doğrulanır.
- Hikâye tabloları ve private Storage bucket RLS ile takipçi görünürlüğü sağlar.
- Video süresi Edge Function içinde MP4 dosyasından okunur; Plus üyeliği ve günlük 180 saniye kota sunucuda denetlenir.

## IP kayıtları

- IP adresi istemciden JSON alanı olarak kabul edilmez; Edge Function'ın aldığı ağ başlıklarından belirlenir.
- IP AES-256-GCM ile şifrelenir. Ayrı HMAC özeti olayları ilişkilendirmek için saklanır.
- Şifrelenmiş IP alanı doğrudan istemcilere açılmaz. Yönetici rolü doğrulanmadan IP çözülemez.
- security_events kayıtları 30 gün sonra temizlenmelidir. Supabase Cron ile public.cleanup_security_events() fonksiyonunu günlük çalıştır.
- IP kaydı ve saklama süresi gizlilik metninde gerçek uygulamayla uyumlu şekilde açıklanmalıdır.

## Yayın öncesi güvenlik kontrolü

1. SQL dosyasını temiz bir test Supabase projesinde çalıştır ve migration hatalarını gider.
2. RLS etkin her tablo için anonim, normal kullanıcı ve admin erişimini ayrı test et.
3. Normal kullanıcının Plus yetkisi, admin rolü, başka kullanıcının özel profili veya IP kayıtlarını değiştiremediğini doğrula.
4. Hikâyelerin takipçi olmayan hesaplardan ve private bucket içeriğinin herkese açık URL ile açılamadığını test et.
5. Video için sahte süre metadata'sı, 50 MB üstü dosya, Normal kullanıcı ve günlük kota aşımı senaryolarını dene.
6. Edge Function Secrets içine rastgele anahtarlar gir; bu değerleri repoya commit etme.
7. privacy.html içindeki işletme ve iletişim bilgilerini doldur ve gerçek veri işleme uygulamasıyla karşılaştır.

## Önemli geçiş uyarısı

Firebase Auth kullanıcıları/parolaları ve Firestore verileri otomatik taşınmaz. Firebase verilerini veya projeyi, Supabase Auth kullanıcı eşlemesi, veri aktarımı ve geri dönüş planı doğrulanmadan silme.