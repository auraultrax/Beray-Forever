# Forever — Ücretsiz fotoğraf (Storage yok)

Firebase Storage **kullanılmaz**.

## Fotoğraf nereye gider?
1. **Sağ panelde sunucu adresi varsa** → senin `upload-server` klasörüne
2. **Boşsa** → sıkıştırılmış JPEG, Firestore gönderi/hikâye belgesine gömülür (ücretsiz kotan yeter)

## Kendi sunucun
```bash
cd upload-server
node server.mjs
```
Forever’da: `http://localhost:8787/upload`

GitHub Pages (https) → localhost engellenebilir. O zaman Forever’ı da `npx serve` ile localhost’ta aç.
