# Forever Plus · Beray

Forever Plus, Forever'ın sosyal özelliklerini koruyarak zümrüt/orman yeşili görsel kimlikle geliştirilen sürümüdür. Geliştirme dalı: forever-plus-development.

## Özellikler
- Google hesabı seçerek kayıt olma; ad-soyad, doğum tarihi, bölge, kullanıcı adı ve şifre ile profil oluşturma
- Mevcut e-posta/şifre ve Google girişleri
- Benzersiz kullanıcı adı
- Profil düzenleme, biyografi ve bölge
- Metin, görsel ve kısa video gönderileri
- Hikâyeler, beğeni, yorum, takip, anket, kaydetme, arama ve bildirim merkezi
- Herkese açık odalar, odaya katılım ve üyeler için gerçek zamanlı sohbet
- Şikâyet, engelleme, oran sınırlama ve moderasyon araçları
- PWA kabuğu ve hareket azaltma tercihi

## Veri ve gizlilik
- Bu dal mevcut Forever uygulamasının Firebase Authentication + Cloud Firestore altyapısını korur; Aura X'in eski istemci köprüsü kaldırılmıştır.
- Doğum tarihi privateProfiles/{uid} belgesinde saklanır. Güncel firestore.rules dosyasında bu belgeyi yalnızca hesap sahibi okuyabilir/değiştirebilir.
- Görünen ad, kullanıcı adı, biyografi ve seçilen genel bölge users/{uid} profiline yazılır. Bölge herkese açık profil bilgisidir.
- Şifre hiçbir zaman Firestore profiline yazılmaz; Google hesabına Firebase Authentication e-posta/şifre sağlayıcısı olarak bağlanır.
- Google sağlayıcısı Firebase Console → Authentication → Sign-in method altında etkin olmalıdır.

## Yerelde çalıştırma
```bash
python3 -m http.server 8080
# http://localhost:8080
```

file:// ile açma. Google giriş ve Firebase servisleri için HTTPS veya localhost kullan.

### İsteğe bağlı medya yükleme sunucusu
```bash
cd upload-server
UPLOAD_TOKEN="uzun-rastgele-bir-anahtar" node server.mjs
```
Forever ayarlarında yükleme sunucusu adresini tanımla. Sunucu varsayılan olarak 8 MB istek sınırı uygular. Üretimde UPLOAD_TOKEN, CORS_ORIGIN ve herkese açık HTTPS adresi güvenli şekilde ayarlanmalıdır. Yükleme sunucusunu token olmadan internete açma.

## Firebase kurulumu — canlı testten önce
1. Firebase Authentication içinde Google ve Email/Password sağlayıcılarını aç.
2. Uygulamanın yayınlandığı alan adını Authorized domains listesine ekle.
3. firestore.rules dosyasının tamamını Firebase Console → Firestore Database → Rules alanına yayınla.
4. Google kayıt, özel profil yazımı, oda oluşturma/katılma/mesaj gönderme ve eski kullanıcı girişi senaryolarını test et.
5. Uygulamayı gerçek kullanıcıya açmadan önce Firebase App Check, kota, gizlilik metni ve hesap silme akışını gözden geçir.

## Özellik notları
- Bottle Game bu Forever deposunda başlangıçta bulunmuyordu. Forever Plus için window.FOREVER_FEATURE_FLAGS.bottleGame değeri false olarak tanımlıdır.
- Aura X'in eski giriş köprüsü ve sentetik yerel oturum yolu kaldırılmıştır. Bağlı Aura X kaynak deposu bu GitHub bağlantısında bulunmadığından, Aura X kodundan birebir modül taşıma yapılmamış; istenen oda özelliği Forever içinde yeni geliştirilmiştir.
- Performans düzenlemeleri: akış 60 gönderiyle sınırlandırılır, hikâyeler 30 öğeyle alınır, arama geciktirilir, trend etiketler snapshot başına hesaplanır, görseller tembel yüklenir ve geçici önizleme URL'leri serbest bırakılır.

Geliştirme adımları ve açık kontroller: GELISTIRME-CIZELGESI.md
