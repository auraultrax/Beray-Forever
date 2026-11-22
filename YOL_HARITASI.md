# Forever Plus — Ürün yol haritası

Ana hedef: Forever'ın mevcut sosyal kullanımını koruyan, sade, hızlı ve güvenli bir zümrüt temalı topluluk platformu.

## Aşama 1 — Temel kimlik ve görsel dönüşüm
- [x] Forever Plus adı ve zümrüt renk sistemi.
- [x] Ad-soyad, doğum tarihi, bölge, kullanıcı adı ve şifre kayıt alanları.
- [x] Google hesabı seçerek kayıt olma akışı.
- [x] Google hesabına e-posta/şifre giriş sağlayıcısı ekleme.
- [x] Doğum tarihini özel profil belgesinde tutma.
- [ ] Firebase Console'da Google sağlayıcısını açma ve canlı kayıt testi.

## Aşama 2 — Sosyal özellikler
- [x] Profil düzenleme ve biyografi.
- [x] Bölge bilgisini profil düzenlemesine ekleme.
- [x] Fotoğraf/video gönderileri ve hikâyeleri koruma.
- [x] Oda oluşturma, keşfetme, katılma ve gerçek zamanlı sohbet.
- [ ] Oda güvenlik kurallarını Firebase Console'a uygulama ve iki farklı hesapla test.
- [ ] Oda sahibi araçları (oda kapatma, açıklama düzenleme, üye yönetimi).

## Aşama 3 — Optimizasyon
- [x] Akış sorgusunu 60 gönderiyle sınırlama.
- [x] Hikâyeleri son 30 öğeyle sınırlama.
- [x] Arama girişini debounce etme.
- [x] Trend etiketlerini snapshot başına hesaplama.
- [x] Görselleri lazy-load etme ve önizleme URL'lerini temizleme.
- [x] Video dosyası boyut sınırlarını varsayılan sunucuyla eşleştirme.
- [ ] Gerçek cihazlarda hız, bellek ve ağ tüketimi ölçümü.
- [ ] Eski ve yeni hesaplarla kayıt/giriş regresyon testi.

## Aşama 4 — Güven, topluluk ve yayın
- [x] Aura X eski giriş köprüsünü kaldırma.
- [x] Özel profil ve oda mesajları için Firestore kuralları.
- [ ] Kuralların canlı projede yayınlanması ve yetki testleri.
- [ ] Kullanım şartları / gizlilik metni.
- [ ] Hesap silme ve veri dışa aktarma.
- [ ] Bildirim izinleri ve hata durumlarının uçtan uca testi.

## Sabit kararlar
- Bottle Game devre dışı: window.FOREVER_FEATURE_FLAGS.bottleGame = false.
- Mevcut Firebase Forever veri altyapısı bu geliştirme dalında korunuyor.
- Doğum tarihi herkese açık profilde gösterilmiyor.
- Değişiklikler önce forever-plus-development dalında tutuluyor; yayın dalına alınmadan önce test gerekiyor.
