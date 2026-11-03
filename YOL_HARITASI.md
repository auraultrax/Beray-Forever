# Forever için ürün fikirleri ve önerilen sıra

Forever'ın vaadi bence şu olabilir: **yakın hissettiren, kolay kullanılan ve insanların kendi topluluğunu kurduğu bir sosyal alan**. İlk sürümde her sosyal ağdaki her şeyi eklemek yerine birkaç özelliği gerçekten iyi yapmak daha doğru olur.

## 1. İlk öncelik: güvenilir temel

1. **Profil ve kullanıcı adı:** benzersiz `@kullaniciadi`, profil fotoğrafı, biyografi, profili düzenleme ve gönderi sayfası.
2. **Takip sistemi:** takip et/takibi bırak, takipçi ve takip edilen sayıları; ana akışta takip edilenlerin gönderilerine öncelik.
3. **Gerçek fotoğraf yükleme:** sadece URL yapıştırmak yerine cihazdan fotoğraf seçme, yükleme ilerlemesi, boyut sınırı ve görsel sıkıştırma. Bunun için Firebase Storage etkinleştirilmeli ve erişim kuralları yazılmalı.
4. **Gerçek arama ve Keşfet:** kullanıcı, gönderi ve `#etiket` araması; popülerlik ile yeniliği dengeli sıralama.
5. **Kaydedilen gönderiler:** kullanıcıya özel kaydetme listesi.

## 2. İkinci aşama: insanları geri getiren özellikler

- **Canlı özel mesajlaşma:** konuşma listesi, mesaj durumu, okunmamış sayacı ve basit görsel paylaşımı.
- **Bildirim merkezi:** takip, beğeni, yorum ve yeni mesaj bildirimleri; kullanıcı tarafından kapatılabilen bildirim tercihleri.
- **Hikâyeler:** 24 saat sonunda otomatik gizleme, izleyenler listesi ve içerik şikâyet etme.
- **Anketler ve soru gönderileri:** yalnızca görsel paylaşmak yerine topluluk etkileşimi.
- **Kişiselleştirilebilir akış:** “Takip ettiklerim” ve “Keşfet” arasında kolay geçiş.

## 3. Güvenlik ve topluluk araçları (gerçek kullanımdan önce)

- Firestore Rules ile kullanıcıların sadece kendi profillerini düzenlemesi ve yalnızca kendi gönderilerini silmesi garanti edilmeli; arayüzde düğmeyi gizlemek tek başına güvenlik değildir.
- Şikâyet et, engelle, spam sınırı ve moderatör araçları eklenmeli.
- Profil adları, görsel URL'leri ve kullanıcı tarafından girilen tüm alanlar doğrulanmalı ve güvenli biçimde görüntülenmeli.
- Firebase App Check ve kullanım sınırları değerlendirilmeli; gerçek kullanıcı verileriyle test için ayrı test projesi kullanılmalı.
- Kullanım şartları, gizlilik açıklaması ve hesap silme akışı eklenmeli.

## 4. Görsel kimlik önerisi

- Ana renk: elektrik moru; ikincil vurgu: pembe-mor. Her alanı parlak renge boyamak yerine yalnızca ana eylem ve aktif menüde kullan.
- Akışta tek tip kartlar, okunaklı gönderi yazısı, daha geniş satır aralığı ve güçlü boşluk kullanımı.
- Mobilde alt gezinme, masaüstünde sol menü + ortada akış + sağda keşfet paneli.
- Yükleme, hata, boş akış ve çevrimdışı durumları için özel ekranlar tasarla.
- Hareket efektlerini kısa tut; cihazın “hareketi azalt” ayarına saygı göster.

## 5. Uygulanabilir yol haritası

**Önce:** PWA kurulumu, ikon, responsive tasarım, hata mesajları, Firebase kuralları ve hesap akışını test et.

**Sonra:** profil düzenleme + takip sistemi + cihazdan görsel yükleme.

**Daha sonra:** Keşfet/arama + kaydetme + bildirimler.

**Son aşama:** özel mesajlaşma, moderasyon paneli ve küçük bir test grubuyla performans/güvenlik kontrolü.

Önerim: kullanıcıların her gün kullanacağı 3 özelliği sağlamlaştır; sonra yeni özellik ekle. Bu yaklaşım, çok fazla yarım özellikten daha güçlü bir ürün çıkarır.
