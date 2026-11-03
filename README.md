# Forever · Beray — Güvenlik Öncelikli Gelişmiş Sürüm

Yakın hissettiren, kolay kullanılan sosyal alan. Bu paket orijinal Forever tabanını alır, **güvenliği en üste** koyar ve eksik özelliklerle güçlendirir.

## Bu sürümde neler var?

### Güvenlik (öncelik)
- Firestore Security Rules şablonu (`SECURITY.md`) — **canlıya almadan önce uygula**
- Kullanıcı adı format + **benzersizlik** kontrolü (`usernames` koleksiyonu)
- Gönderi / yorum karakter limitleri + sanitization
- İstemci tarafı rate-limit (spam engeli)
- Şikayet (report) sistemi
- Kullanıcı engelleme (block) — engellenenlerin gönderileri akışta görünmez
- Yükleme sunucusu: boyut/MIME sınırı, rate-limit, opsiyonel token, path traversal koruması
- XSS koruması (`escapeHTML`) tüm kullanıcı içeriklerinde

### Özellikler
- E-posta + Google ile giriş / kayıt / şifre sıfırlama
- Benzersiz `@kullaniciadi`
- Gönderi (metin + fotoğraf + kısa video)
- Hikâyeler
- Beğeni, yorum
- Takip sistemi
- Profil düzenleme
- Kaydedilen gönderiler (bookmark)
- Arama (içerik, isim, #etiket)
- PWA (ikon, manifest, service worker)
- Yerel / kendi sunucuna fotoğraf yükleme (Firebase Storage zorunlu değil)

## Yerelde çalıştırma

```bash
# Ana uygulama
python3 -m http.server 8080
# → http://localhost:8080

# İsteğe bağlı güvenli yükleme sunucusu
cd upload-server
UPLOAD_TOKEN="gizli-anahtar" node server.mjs
# Forever sağ panelde: http://localhost:8787/upload
# Token kullanıyorsan tarayıcı konsolunda:
# localStorage.setItem('FOREVER_UPLOAD_TOKEN', 'gizli-anahtar')
```

**Önemli:** `file://` ile açma. PWA ve bazı API’ler için `http://localhost` veya HTTPS gerekir.

## Canlıya almadan önce

1. `SECURITY.md` içindeki **Firestore Rules**’ı Firebase Console’a yapıştır.
2. Authentication → Authorized domains ayarla.
3. Mümkünse App Check etkinleştir.
4. Yükleme sunucusunu token + CORS_ORIGIN ile koru veya Firebase Storage’a geç.
5. Küçük bir test grubuyla dene.

## Yol haritası (devamı)

- Bildirim merkezi
- Gerçek zamanlı DM
- Moderasyon paneli
- Daha gelişmiş Keşfet sıralaması
- Hesap silme + gizlilik politikası sayfası

Güvenlik bizim için **forever**.
