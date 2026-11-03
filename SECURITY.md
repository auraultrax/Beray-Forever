# Forever — Güvenlik Politikası ve Zorunlu Kurallar

**Öncelik: Kullanıcı güvenliği forever.**

Bu belge, uygulamayı gerçek kullanıcılarla açmadan önce **mutlaka** uygulanması gereken güvenlik önlemlerini listeler. İstemci tarafı (tarayıcı) asla tek başına güvenlik sağlamaz.

---

## 1. Firebase Firestore Security Rules (ZORUNLU)

Firebase Console → Firestore → Rules kısmına aşağıdaki kuralları (veya daha sıkı versiyonunu) koy:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Yardımcı fonksiyonlar
    function isSignedIn() {
      return request.auth != null;
    }
    function isOwner(uid) {
      return isSignedIn() && request.auth.uid == uid;
    }
    function isValidUsername(name) {
      return name is string
        && name.size() >= 3
        && name.size() <= 24
        && name.matches('^[a-z0-9_]+$');
    }
    function isValidPostContent(c) {
      return c is string && c.size() <= 2000;
    }
    function isValidComment(c) {
      return c is string && c.size() >= 1 && c.size() <= 500;
    }

    // Kullanıcı profilleri
    match /users/{userId} {
      allow read: if true;                       // herkese açık profil
      allow create: if isOwner(userId)
                    && isValidUsername(request.resource.data.username)
                    && request.resource.data.uid == userId;
      allow update: if isOwner(userId)
                    && (!('username' in request.resource.data)
                        || isValidUsername(request.resource.data.username));
      allow delete: if isOwner(userId);
    }

    // Kullanıcı adı benzersizliği için ayrı koleksiyon (önerilir)
    match /usernames/{username} {
      allow read: if true;
      allow create: if isSignedIn()
                    && isValidUsername(username)
                    && request.resource.data.uid == request.auth.uid;
      allow delete: if isSignedIn()
                    && resource.data.uid == request.auth.uid;
    }

    // Gönderiler
    match /posts/{postId} {
      allow read: if true;
      allow create: if isSignedIn()
                    && request.resource.data.userId == request.auth.uid
                    && isValidPostContent(request.resource.data.content)
                    && request.resource.data.keys().hasAll(['userId', 'authorName', 'content', 'createdAt']);
      allow update: if isSignedIn() && (
                      // Sadece sahibi içerik/medya güncelleyebilir
                      (resource.data.userId == request.auth.uid)
                      ||
                      // Beğeni / yorum ekleme-çıkarma (arrayUnion / arrayRemove)
                      (request.resource.data.diff(resource.data).affectedKeys()
                        .hasOnly(['likes', 'comments', 'likeCount']))
                    );
      allow delete: if isOwner(resource.data.userId);
    }

    // Hikâyeler (24 saatlik)
    match /stories/{storyId} {
      allow read: if true;
      allow create: if isSignedIn()
                    && request.resource.data.userId == request.auth.uid;
      allow update: if isOwner(resource.data.userId);
      allow delete: if isOwner(resource.data.userId);
    }

    // Engellenen kullanıcılar
    match /blocks/{blockId} {
      allow read: if isSignedIn() && resource.data.blockerId == request.auth.uid;
      allow create: if isSignedIn()
                    && request.resource.data.blockerId == request.auth.uid
                    && request.resource.data.blockedId != request.auth.uid;
      allow delete: if isSignedIn() && resource.data.blockerId == request.auth.uid;
    }

    // Şikayetler (sadece yazma, okuma sadece moderatör — şimdilik kapalı)
    match /reports/{reportId} {
      allow create: if isSignedIn()
                    && request.resource.data.reporterId == request.auth.uid
                    && request.resource.data.reason is string
                    && request.resource.data.reason.size() <= 500;
      allow read, update, delete: if false; // sadece Firebase Console / Admin SDK
    }

    // Kaydedilen gönderiler
    match /saves/{saveId} {
      allow read, write: if isSignedIn()
                         && resource == null
                            ? request.resource.data.userId == request.auth.uid
                            : resource.data.userId == request.auth.uid;
    }
  }
}
```

**Önemli:** Yukarıdaki kurallar olmadan istemci tarafındaki tüm kontroller kolayca atlanır.

---

## 2. Firebase Authentication

- E-posta/şifre + Google sağlayıcılarını açık tut.
- Şifre sıfırlama e-postası zaten destekleniyor.
- **App Check** (reCAPTCHA / Play Integrity) mümkünse etkinleştir.
- Yetkisiz domain’leri Authentication → Settings → Authorized domains listesinden kaldır.

---

## 3. Yükleme Sunucusu (upload-server)

- `UPLOAD_TOKEN` ortam değişkeni ile koru (üretimde zorunlu).
- `MAX_UPLOAD_BYTES` ile boyut sınırı koy.
- `CORS_ORIGIN` ile sadece kendi domain’ini izin ver.
- Sunucuyu asla açık internete (0.0.0.0 + token’sız) bırakma.
- Mümkünse Cloudflare R2 / Backblaze / Firebase Storage’a geç (ücretsiz kotayı aşınca).

Örnek güvenli başlatma:

```bash
UPLOAD_TOKEN="çok-güçlü-rastgele-anahtar" \
MAX_UPLOAD_BYTES=5242880 \
CORS_ORIGIN="https://senin-domain.com" \
node server.mjs
```

Forever arayüzünde yükleme URL’sinin yanına token girme alanı eklenebilir (localStorage’da saklanır, asla koda gömülmez).

---

## 4. İstemci Tarafı (index.html) Güvenlik Katmanları

Zaten mevcut olanlar:
- `escapeHTML` ile XSS koruması
- Medya sıkıştırma + boyut sınırı
- Auth state kontrolü

Eklenen / güçlendirilenler:
- Kullanıcı adı format + benzersizlik kontrolü
- Gönderi / yorum karakter limiti
- İstemci tarafı rate-limit (spam engeli)
- Şikayet (report) ve engelleme (block) akışı
- Kaydedilen gönderiler (sadece kendi kullanıcısına)
- Tüm kullanıcı girdilerinde uzunluk + tip doğrulama

---

## 5. Genel Tavsiyeler

1. Gerçek kullanıcı verisiyle test etmeden önce **ayrı bir Firebase test projesi** kullan.
2. Production’da `apiKey` gizli değildir; güvenlik **Rules + App Check + Auth** ile sağlanır.
3. Kullanım şartları + gizlilik politikası + hesap silme akışı ekle.
4. Moderasyon paneli olmadan topluluk büyütme.
5. Log’larda hassas veri (şifre, token) tutma.

---

**Güvenlik bizim için forever.**
Bu kurallar uygulanmadan uygulamayı canlıya alma.
