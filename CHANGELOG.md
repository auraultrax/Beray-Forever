# Forever Enhanced — Değişiklikler

## 2026-11-24 — Süper Plus ve BAI
- Süper Plus üyeliği ayrı, RLS korumalı tabloda tutulur; admin kullanıcı adıyla üyelik verebilir veya kaldırabilir.
- Profilde Forever Süper Plus sayfasına yönlendiren elmaslı bağlantı, doğrulanmış rozet ve dokuz ayrıcalığın tanıtımı eklendi.
- Özel uygulama simgeleri ve gelişmiş oda temaları geri eklendi; animasyonlu çıkartma, emoji birleştirme ve animasyonlu emoji Plus ile sınırlandı.
- Plus kullanıcılarına gönderiyi 24 saate kadar öne çıkarma ve BAI'de kişi başı günlük kota muafiyeti eklendi.
- BAI sohbet ve arama Edge Function'ları yayımlandı; ortak sistem kullanım bütçesi tüm hesaplar için korunur.
- BAI model ve arama sağlayıcılarının API anahtarları Supabase Edge Function Secrets alanında ayrıca yapılandırılmalıdır.


## 2026-11-23 — Tek üyelik modeli
- Forever Plus üyelik katmanı, ayrı rozetler, yönetici tanımlama/kaldırma ekranı ve özel uygulama simgeleri kaldırıldı.
- Metin gönderileri, anketler, çıkartmalar, oda çizimi ve emoji birleştirme tüm kullanıcılara açıldı.
- Oda sabitleme oda sahibi/yöneticisi denetimine bağlandı.
- Tüm hesaplar için oda katılım sınırı 3, günlük medya yükleme sınırı 5 olarak birleştirildi.
- Eski Plus profil bayrakları ve veritabanı fonksiyonları için şema temizliği eklendi.

## 2026-10-31 (2) — Cam · Neon · Animasyon · Işık · Bildirim

### Görsel kimlik (özgün, klon değil)
- Glassmorphism: yarı saydam kartlar, blur
- Neon vurgular (mor / magenta / cyan)
- Aurora arka plan animasyonu
- Logo pulse-glow, kart fadeSlideUp, story shimmer ring
- Buton hover lift + glow
- prefers-reduced-motion saygısı

### Özellikler
- Işık Yak (Spark): Forever'a özgü minik destek — gerçek para yok, samimi "3-5 kuruş" hissi
- Bildirim paneli
- Akış modu: Keşfet / Takip
- Karakter sayacı
- Güvenlik paketi korundu (report, block, save, rate-limit, username)

## 2026-10-31 (1) — Güvenlik temeli
- Report, block, save, rate-limit, username uniqueness, hardened upload server
