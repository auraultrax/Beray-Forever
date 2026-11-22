# Forever · Supabase geçiş yol haritası

Hedef: Forever'ın görsel kimliğini ve çalışan sosyal akışını koruyarak tek backend olarak Supabase kullanmak.

## Kod geçişi
- [x] Supabase proje yapılandırması ve ortak istemci.
- [x] Postgres tabloları ve RLS şeması.
- [x] Ana sayfa oturum ve veri adaptörünü Supabase'e taşıma.
- [x] Plus başvuru sayfası ve tek oturum kullanan admin paneli.
- [x] Plus onay RPC'si, 3/6 oda limiti ve 20/30 kişi kapasite kuralı.
- [x] IP kayıtları için şifreli Edge Function taslağı.
- [x] Admin IP kayıtlarını sunucu üzerinden çözme fonksiyonu.
- [x] MP4 süresini doğrulayan Plus video yükleme fonksiyonu.
- [ ] Temiz Supabase projesinde SQL'i çalıştırıp gerçek veritabanı hatalarını gidermek.
- [ ] Edge Functions deploy etmek ve Secrets tanımlamak.
- [ ] OAuth provider ve gerçek redirect domain ayarlarını tamamlamak.

## Aura X birleşimi
- [x] Takip, hikâye, özel mesaj, oda, çizim, çıkartma ve bildirimler için ortak veri modeli.
- [ ] Eski Aura X kaynak kodunu edinip arayüz modüllerini Forever'a taşımak.
- [ ] Özel mesaj, çizim ve çıkartma ekranlarını uçtan uca bağlamak.

## Yayın öncesi kontroller
- [ ] Firebase kullanıcıları ve veri için aktarım / parola sıfırlama planı.
- [ ] Normal ve yönetici hesaplarıyla RLS testleri.
- [ ] 5 görsel/gün, sınırsız Plus görseli ve 180 saniye Plus video testleri.
- [ ] Hikâye private bucket ve takipçi görünürlüğü testleri.
- [ ] İki ayrı hesapla takip, oda, Plus ve admin senaryoları.
- [ ] Gizlilik metnindeki veri sorumlusu ve iletişim bilgileri tamamlanmalı.
- [ ] Gerçek cihazlarda hız, bellek, ağ ve Realtime yükü ölçülmeli.

## Sabit kararlar
- Tek backend: Supabase.
- Tek oturum: Supabase Auth; admin rolü aynı kullanıcıya user_roles üzerinden verilir.
- Forever'ın var olan görsel dili korunur; Aura X'ten istenen sosyal özellikler aynı hesap altyapısına eklenir.
- Geliştirme forever-plus-development dalında kalır; canlı sürüm için test gerekir.