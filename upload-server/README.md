# Forever yerel fotoğraf sunucusu

```bash
cd upload-server
node server.mjs
```

Forever sağ panelde **Fotoğraf sunucusu** alanına yaz:

`http://localhost:8787/upload`

Fotoğraflar `upload-server/uploads/` klasörüne kaydolur.

> Not: Site `https://auraultrax.github.io` üzerindeyken tarayıcı localhost’a istek atmayı (mixed content / private network) kısıtlayabilir. O zaman ya Forever’ı da localhost’ta aç, ya sunucuyu HTTPS’li bir domaine koy, ya da alanı boş bırakıp Firebase Storage kullan.
