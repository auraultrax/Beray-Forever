# Forever Plus — Geliştirme çizelgesi
Çalışma dalı: forever-plus-development
Güncelleme: 22 Kasım 2026

## Uygulanan değişiklikler
- [x] Forever Plus markası ve zümrüt/orman yeşili tema.
- [x] Kayıt ekranına ad-soyad, doğum tarihi, bölge, kullanıcı adı ve şifre alanları.
- [x] Google hesabı seçimi ve Firebase hesabına e-posta/şifre sağlayıcısını bağlama.
- [x] Doğum tarihini privateProfiles/{uid} özel belgesine kaydetme.
- [x] Profil düzenleme ve biyografi alanlarını koruma; bölge düzenleme alanı.
- [x] Fotoğraf, kısa video ve hikâye yükleme akışlarını koruma.
- [x] Oda oluşturma, herkese açık oda keşfi, katılım ve üye sohbeti.
- [x] Bottle Game için devre dışı özellik bayrağı.
- [x] Aura X eski giriş köprüsünü ve yerel sentetik oturum yolunu kaldırma.
- [x] Akış/hikâye sorgularını sınırlama, arama geciktirme, trendleri önbellekleme ve görselleri lazy-load etme.
- [x] Doğum tarihi, odalar ve oda mesajları için Firestore güvenlik kuralları.
- [x] PWA manifesti, servis çalışanı önbelleği, README ve değişiklik notları.

## Yayın öncesi zorunlu kontroller
- [ ] Firebase Console'da Google ve Email/Password sağlayıcılarını etkinleştir.
- [ ] Güncel firestore.rules dosyasının tamamını Firestore Rules alanına yayınla.
- [ ] Eski Google hesabıyla giriş ve yeni hesapla kayıt akışını gerçek Firebase projesinde test et.
- [ ] Aynı kullanıcı adıyla ikinci hesap açılmasının engellendiğini doğrula.
- [ ] Doğum tarihi belgesinin başka kullanıcı tarafından okunamadığını doğrula.
- [ ] Odayı üye olmayan hesabın okuyamadığını ve mesaj yazamadığını doğrula.
- [ ] İki ayrı hesapla oda oluşturma, katılma, mesaj gönderme ve canlı güncellemeyi dene.
- [ ] Fotoğraf ve video yüklemelerini kullanılan gerçek yükleme sunucusuyla test et.
- [ ] Masaüstü ve mobil tarayıcılarda performans ve responsive kontrol yap.

## Bilinen sınırlar
- Bağlı GitHub depoları arasında Aura X kaynak deposu bulunmadığı için Aura X'ten birebir kod taşıma yapılmadı; eski giriş köprüsü kaldırıldı ve istenen oda özelliği Forever içinde geliştirildi.
- Bottle Game mevcut Forever kaynak ağacında bulunmuyordu; bu dalda özelliği kapalı tutan bayrak eklendi.
- Kod değişiklikleri geliştirme dalına commit edildi; gerçek Firebase üzerinde uçtan uca test ve kuralların yayınlanması henüz yapılmadı.
- Mevcut Forever Firebase Authentication + Firestore altyapısı korundu. Bu çalışma backend'i Supabase'e taşımıyor.
