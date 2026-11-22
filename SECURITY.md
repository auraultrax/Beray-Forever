# Forever — Supabase Güvenlik Rehberi

Bu sürüm Firebase/Firestore kullanmaz. Uygulama Supabase Auth, PostgreSQL, Row Level Security (RLS), Realtime ve Storage kullanacak şekilde hazırlanmıştır.

## Canlıya almadan önce

1. Supabase SQL Editor içinde `supabase/schema.sql` dosyasını çalıştır.
2. Supabase Authentication bölümünde Google sağlayıcısını etkinleştir.
3. Canlı site adresini Authentication → URL Configuration → Redirect URLs listesine ekle.
4. Yalnızca güvenilir yönetici Google e-posta adreslerini `public.forever_admins` tablosuna ekle.
5. RLS'nin etkin olduğunu ve `forever_documents`, `forever_private_user_data`, `forever_plus_members`, `forever_admins` tablolarının politikalarını gözden geçir.
6. `forever-media` bucket'ı ve Storage politikalarını doğrula.
7. Realtime yayınında `public.forever_documents` tablosunun yer aldığını kontrol et.

## Güvenlik sınırları

- Tarayıcıda yalnızca Supabase publishable key bulunabilir. Secret/service-role key hiçbir zaman HTML, JavaScript, GitHub veya istemci tarafı ortam değişkenlerine eklenmemelidir.
- Gerçek yetkilendirme RLS ve SECURITY DEFINER veritabanı fonksiyonlarıyla uygulanır. İstemci tarafındaki kilit/Plus görünümü tek başına güvenlik değildir.
- Plus üyeliği yalnızca admin allowlist'indeki yönetici tarafından `grant_forever_plus` / `revoke_forever_plus` fonksiyonlarıyla değiştirilmelidir.
- Yönetim ve moderasyon alanları yalnızca admin fonksiyonuyla doğrulanan hesaplara açık olmalıdır.
- `forever_private_user_data` tablosundaki ad, soyad, doğum tarihi ve varsa IP adresine normal kullanıcıların erişimi kapalıdır.
- IP bilgisi yalnızca Supabase gateway'in istek başlıklarını sağlaması hâlinde alınabilir. IP için bir saklama süresi ve otomatik imha görevi ayrıca tanımlanmalıdır.
- Kullanıcı içeriği ekranda gösterilirken HTML escape uygulanmalıdır. Medya dosyaları için tür ve boyut sınırları korunmalıdır.

## KVKK ve kullanıcı güvenliği

`kvkk.html` ve `kullanim-kosullari.html` yayın öncesi hizmet sahibinin gerçek bilgileriyle doldurulmalı, saklama süreleri ve varsa yurt dışı veri aktarımı incelenmeli ve uygun hukuki inceleme yapılmalıdır. Özellikle genç kullanıcıların kullanımına yönelik yaş/veli bilgilendirme süreçleri ayrıca değerlendirilmelidir.

## Önemli

Bu depo kod ve örnek SQL sağlar; Supabase SQL'i kendiliğinden çalıştırmaz. SQL çalıştırılmadan RLS tabloları/fonksiyonları oluşmuş olmaz. Eski Firebase verileri otomatik olarak içe aktarılmaz.
