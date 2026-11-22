# Forever Plus — Değişiklikler

## 2026-11-22 — Forever Plus / Zümrüt sürümü

### Görsel kimlik
- Forever Plus adı ve koyu zümrüt/orman yeşili renk sistemi.
- Mobil görünüm için oda penceresi ve zümrüt mesaj balonları.
- prefers-reduced-motion desteği.

### Hesap ve profil
- Kayıt formu: ad-soyad, doğum tarihi, bölge, kullanıcı adı ve şifre.
- Kayıt sırasında Google hesabı seçimi (prompt: select_account).
- Google hesabına e-posta/şifre sağlayıcısı bağlama.
- Doğum tarihi privateProfiles/{uid} özel belgesine taşındı; bölge profil alanı olarak eklendi.
- Profil düzenleme ve biyografi özelliği korundu.

### Topluluk ve medya
- Oda oluşturma, herkese açık odaları keşfetme, katılma ve üye sohbeti.
- Video/görsel gönderileri ve hikâye yüklemeleri korundu.
- Şişe oyunu özelliği kapalı bayrakta tutuldu.

### Performans
- Akış sorgusu son 60 gönderiyle, hikâye sorgusu son 30 öğeyle sınırlandı.
- Arama 140 ms geciktirildi; trend etiketler her render'da yeniden hesaplanmıyor.
- Gönderi ve hikâye görsellerinde lazy-loading; önizleme Object URL temizliği.
- Servis çalışanı önbellek sürümü yenilendi.

### Güvenlik / bakım
- Aura X eski istemci köprüsü ve sentetik oturum yedek yolu kaldırıldı.
- privateProfiles, odalar ve oda mesajları için Firestore güvenlik kuralları eklendi.

## 2026-10-31 (2) — Cam · Neon · Animasyon · Işık · Bildirim
- Eski Forever görsel sürümü: glassmorphism, bildirim paneli, Keşfet/Takip akışı ve güvenlik araçları.

## 2026-10-31 (1) — Güvenlik temeli
- Report, block, save, rate-limit, username uniqueness ve upload-server sertleştirmeleri.
