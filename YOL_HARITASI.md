# Forever — ürün yol haritası

Forever, Google hesabıyla giriş yapılan ve Supabase altyapısını kullanan sosyal bir topluluk alanıdır. Ana arayüz, oda sistemi ve yönetim paneli temel akış olarak hazırlanmıştır.

## Mevcut ana yapı

- Google OAuth ile giriş ve kullanıcı adıyla profil oluşturma.
- Kayıt sırasında ad, soyad, doğum tarihi, KVKK aydınlatma metni ve kullanım koşulları onayı.
- Supabase Auth, PostgreSQL, RLS, Realtime ve Storage.
- Fotoğraf/video içeren gönderiler; açıklama isteğe bağlı.
- Tüm hesaplarda günlük toplam 5 medya yükleme.
- Odalar, mesajlar, şikâyet, engelleme, odadan çıkarma ve oda yasağı.
- Metin gönderileri, anketler, animasyonlu çıkartmalar, oda çizimi ve emoji birleştirme tüm hesaplarda açık; oda sabitleme oda yöneticisi yetkisiyle çalışır.
- Kullanıcı/şikâyet/oda yönetimi için admin paneli.

## Yayın öncesi zorunlu işler

1. supabase/schema.sql dosyasını Supabase SQL Editor içinde çalıştır.
2. Supabase Google sağlayıcısını ve Redirect URL'leri yapılandır.
3. Yönetici e-posta adreslerini public.forever_admins tablosuna ekle.
4. KVKK ve Kullanım Koşulları dosyalarındaki yer tutucuları gerçek veri sorumlusu bilgileriyle tamamla.
5. IP adresi için amaç, hukuki sebep, saklama süresi ve otomatik imha işini kesinleştir.
6. Supabase bölgesini ve yurt dışı veri aktarımı koşullarını kontrol et.
7. RLS, Storage, Realtime, oda moderasyonu ve kota kurallarını test et.
8. Eski Firebase verileri gerekiyorsa yedeklerden kontrollü aktarım planı hazırla.

## Sonraki geliştirmeler

- Gerçek zamanlı özel mesajlaşma ve okunmamış mesaj sayaçları.
- Push bildirimleri ve işletim sistemi bildirim izin akışı.
- Profil fotoğrafı, avatar ve hesap silme akışı.
- Hesap/veri dışa aktarma ve veri silme başvurusu.
- Medya silindiğinde Storage dosyalarını da temizleyen lifecycle işleri.
- Daha kapsamlı erişilebilirlik, güvenlik testleri ve moderasyon denetim kaydı.

## Güvenlik ilkesi

Arayüzde özellik kilidi göstermek tek başına yetmez. Yetki, kota ve moderasyon kararları PostgreSQL RLS ve sunucu tarafı fonksiyonlarla da denetlenmelidir. Kişisel veriler genel profil tablolarından ayrı tutulmalı ve gereğinden uzun saklanmamalıdır.