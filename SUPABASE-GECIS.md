# Firebase -> Supabase geçişi

Bu dalda hedef backend Supabase'tir. SQL şeması; Auth kullanıcı profilleri, takip, gönderiler, hikâyeler, odalar, sohbet, çizimler, çıkartmalar, Plus başvuruları, admin rolleri, medya ve güvenlik kayıtları için hazırlanmıştır.

## Kurulum
1. Supabase Dashboard > SQL Editor > New query bölümünde `supabase-schema.sql` dosyasının tamamını çalıştır.
2. Uygulama ayarlarında Authentication > URL Configuration alanına sitenin gerçek adresini ve yönlendirme adreslerini ekle.
3. Authentication > Providers bölümünden ihtiyaç duyulan e-posta ve Google sağlayıcılarını etkinleştir.
4. Site istemcisi için `supabase-config.js` kullanılır. Publishable key tarayıcıda kullanılabilir; secret/service_role key asla HTML/JS içine eklenmez.
5. İlk yönetici normal kayıt ekranından kayıt olur. Authentication > Users bölümündeki UUID, SQL dosyasının sonundaki bootstrap komutuyla `user_roles` tablosuna eklenir. Admin paneli daha sonra aynı Supabase oturumunu ve bu rolü kontrol eder.

## Önemli geçiş notları
- Firebase Authentication kullanıcıları ve şifreleri SQL ile Supabase'e otomatik taşınamaz. Firebase kullanıcı dışa aktarımı ve desteklenen parola hash formatı ile ayrı bir kimlik aktarımı gerekir; uygun hash taşınamazsa kullanıcılar Supabase üzerinden parola sıfırlama / yeniden kayıt akışını kullanır.
- Firestore koleksiyonlarının verileri bu şemaya otomatik kopyalanmaz. Önce Firebase verisi JSON dışa aktarılır, UID -> Supabase UUID eşlemesi oluşturulur ve tablolar kontrollü biçimde doldurulur. Canlı siteyi yeni Auth ve RLS testleri tamamlanmadan Firebase projesinden ayırma.
- Hikâyeler takipçilere özel tutulur. Hikâye medyası `forever-private` bucket'ında saklanmalıdır; herkese açık gönderi ve avatar medyası `forever-public` bucket'ını kullanır.
- Normal üyeler günde en fazla 5 görsel yükleyebilir. Plus görselleri sınırsızdır. Tarayıcıdan doğrudan video yükleme bilerek kapalıdır; gerçek MP4 süresinin doğrulanması ve günlük toplam 180 saniye sınırı için Edge Function gerekir.
- IP adresi tarayıcıdan alınmaz. Güvenlik olayı kaydı, IP'yi sunucu tarafında şifreleyip `security_events` tablosuna yazan Edge Function ile yapılmalıdır. 30 günlük temizleme için `cleanup_security_events()` fonksiyonunu Supabase Cron ile günlük çalıştır.

## Aura X entegrasyonu
Aura X'in eski kaynak kodu bu depoda bulunmadı. Bu şemada Aura X'ten daha önce tarif edilen takip, hikâye, özel mesaj, oda, çizim, bildirim ve yönetim işlevleri aynı Forever hesabı altında birleşecek şekilde tasarlandı. Tam eski arayüz / kod aktarımı için Aura X kaynak deposu veya arşivi ayrıca gerekir.

## Şu anki durum
Bu SQL ve config geçiş altyapısını hazırlar; mevcut `index.html`, `admin.html` ve `plus-apply.html` henüz Firebase SDK çağrıları içeriyorsa, istemci kodu taşıması tamamlanmadan Firebase tamamen kaldırılmış sayılmaz. Bu dosyalar sonraki uygulama aşamasında Supabase Auth + Postgres + Realtime + Storage kullanacak şekilde güncellenmelidir.
