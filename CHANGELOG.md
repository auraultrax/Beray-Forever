# Değişiklikler

## Forever PWA UI refresh
- Blob URL üzerinden oluşturulan manifest ve service worker kaldırıldı; gerçek `manifest.json` ve `service-worker.js` eklendi.
- Forever marka ikonu 32–512 piksel boyutlarıyla üretildi; maskable 512px ikon ve iOS ana ekran ikonu eklendi.
- Koyu mor/magenta tema, kart ve form stilleri, responsive mobil alt menü eklendi.
- Android, iOS Safari, Chrome/Edge için kurulum rehberi eklendi.
- Uygulama kabuğu için temel cache ve proje kurulum talimatları eklendi.
- `YOL_HARITASI.md` içine yeni özellik fikirleri ve güvenlik öncelikleri eklendi.

## Bilinen sınırlar
- Firebase Auth/Firestore kodu orijinal projeden korundu; gerçek Firebase hesabıyla uçtan uca oturum ve veri işlemleri burada test edilmedi.
- Çevrimdışıyken yalnızca önbelleğe alınmış uygulama kabuğu sunulabilir. Kimlik doğrulama, canlı akış ve veri yazma için ağ gerekir.
- PWA, HTTPS üzerinde yayınlandığında veya yerelde `localhost` ile test edildiğinde kurulabilir; `file://` üzerinden yükleme çalışmaz.

## İkon güncellemesi
- Forever ikonu siyah arka planlı, mavi-mor-magenta neon sonsuzluk sembolüyle yenilendi.
- 32, 48, 72, 96, 144, 180, 192 ve 512 piksel ikonlar yeniden üretildi.
- Maskable ikon, kırpılma riskini azaltmak için güvenli alan boşluğuyla hazırlandı.

## Yeni ikon paketi
- Forever için siyah arka plan üzerinde mavi-mor neon sonsuzluk simgesi eklendi.
- 32, 48, 72, 96, 144, 180, 192 ve 512 px ikon varyantları yenilendi.
- Manifest maskable ikonu güncellendi; favicon bağlantısı 32 px ikona eklendi.
- Service worker önbellek sürümü v3 olarak artırıldı; eski simgenin önbellekte kalması azaltıldı.
