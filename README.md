# Forever — Güncellenmiş Web / PWA paketi

Bu paketteki `index.html`, mevcut Firebase Auth ve Firestore akışını korur; arayüz görsel olarak düzenlendi ve PWA kurulumu blob URL yerine gerçek dosyalara taşındı.

## Neler değişti?
- Koyu gece teması; mor/magenta vurgular, kart sınırları, odak stilleri ve daha tutarlı aralıklar.
- Forever uygulama ikonu ve farklı boyutlar (`icons/`).
- Standart `manifest.json` ve ayrı `service-worker.js`.
- Mobil alt gezinme çubuğu ve iOS/Android/masaüstü için kurulum rehberi.
- Uygulama kabuğu için temel cache; Firestore/Auth dinamikleri çevrimdışı çalışmaz.

## Yerelde açma (Pardus / Linux)
Terminali bu klasörde aç:

```bash
python3 -m http.server 8080
```

Ardından tarayıcıda `http://localhost:8080` adresini aç. PWA kurulum denemesi için dosyayı `file://` ile açma. `localhost` yerelde test içindir; internete yayınlarken HTTPS kullan.

## Yükleme
- **Android + Chrome:** Forever sitesini aç, “Uygulamayı yükle” düğmesini veya tarayıcı menüsündeki yükleme seçeneğini kullan.
- **iPhone/iPad + Safari:** Paylaş → Ana Ekrana Ekle → Ekle.
- **Masaüstü Chrome/Edge:** Adres çubuğundaki kurulum simgesini veya menüdeki “Uygulamayı yükle” seçeneğini kullan.

## Firebase notları
Firebase yapılandırması orijinal projeden korundu. Bu paket, Firebase projesinin Authentication sağlayıcılarının, Firestore veritabanının ve güvenlik kurallarının doğru kurulduğunu doğrulayamaz. Gerçek kullanıcılarla kullanmadan önce Firestore Rules ile yalnızca içerik sahibinin içerik silmesini ve kullanıcıların izin verilen alanları değiştirmesini sağla. `apiKey` tarayıcı uygulamalarında kimlik bilgisi gibi gizli tutulmaz; güvenlik Firebase Rules ve yetkilendirme ayarlarıyla sağlanmalıdır.

## Şu anki kapsam ve sonraki fikirler
Mevcut temel: e-posta/Google giriş arayüzü, gönderiler, beğeni, yorum ve hikâyeler (mevcut kodun izin verdiği ölçüde). Gerçek doğrudan mesajlaşma, cihazdan dosya yükleme, takip sistemi, bildirim merkezi, raporlama/moderasyon ve keşfet sıralaması ayrıca geliştirilmelidir.


### Uygulama ikonu
Yeni Forever ikonu `icons/` klasöründe farklı boyutlarda bulunur. Orijinal büyük görsel `icons/forever-icon-source.png` dosyasına eklenmiştir. İkon güncellendiğinde yüklü uygulamanın eski önbelleği kalırsa siteyi bir kez çevrimiçi açıp yenilemek gerekebilir.
