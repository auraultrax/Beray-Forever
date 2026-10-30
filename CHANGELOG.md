# Forever Enhanced — Değişiklikler

## 2026-10-31 — Güvenlik + Özellik Paketi

### Güvenlik
- `SECURITY.md` eklendi (zorunlu Firestore Rules şablonu)
- Kullanıcı adı: format doğrulama + `usernames` koleksiyonu ile benzersizlik
- `sanitizeText` + karakter limitleri (gönderi 2000, yorum 500, bio 160)
- Rate-limit (gönderi, yorum, rapor, engelle, kaydet)
- Şikayet (report) akışı → `reports` koleksiyonu
- Engelleme (block) → engellenen kullanıcıların gönderileri gizlenir
- Upload sunucusu tamamen yeniden yazıldı:
  - Max boyut, MIME/uzantı whitelist
  - IP rate-limit
  - Opsiyonel `UPLOAD_TOKEN` (X-Upload-Token header)
  - Path traversal koruması
  - `X-Content-Type-Options: nosniff`

### Özellikler
- Kaydedilen gönderiler (bookmark)
- Gönderi kartında şikayet + engelle butonları
- Yorum input’una `maxlength`
- Auth sonrası blocked + saves yükleme

### Notlar
- Firebase Storage hâlâ zorunlu değil (sıkıştırılmış data URL veya kendi sunucun)
- Asıl güvenlik Firestore Rules + Auth + (mümkünse) App Check ile sağlanır
