/* Beray Forever <-> Aura X giriş köprüsü (istemci tarafı).
 * Aura X kullanıcı adı/şifresi Aura X'in username-login endpoint'ine gönderilir.
 * Başarılı doğrulamadan sonra Forever tarafında Firebase oturumu açmak için
 * kullanıcıya bilgi verilir veya yerel oturum başlatılır.
 * Not: Tam entegrasyon için sunucu tarafı köprü (Firebase custom token) önerilir.
 */
const AURAX_URL = 'https://zblbsjmtituericpmazj.supabase.co';
const AURAX_PUBLISHABLE_KEY = 'sb_publishable_0XUjb6u_goYIjSB6m7vYsQ_hpyI0Az7';

function showAuthMessage(msg) {
  const box = document.getElementById('authAlert');
  if (box) {
    box.textContent = msg;
    box.classList.remove('hidden');
  } else {
    alert(msg);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const auraxBtn = document.getElementById('auraxLoginBtn');
  if (auraxBtn) {
    auraxBtn.addEventListener('click', () => {
      const form = document.getElementById('auraxForm');
      if (form) form.classList.toggle('hidden');
    });
  }

  const auraxForm = document.getElementById('auraxForm');
  if (auraxForm) {
    auraxForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('auraxUser')?.value?.trim();
      const password = document.getElementById('auraxPass')?.value;
      if (!username || !password) {
        showAuthMessage('Aura X kullanıcı adı ve şifresi gerekli.');
        return;
      }
      const btn = auraxForm.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Doğrulanıyor…'; }

      try {
        const res = await fetch(`${AURAX_URL}/functions/v1/username-login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: AURAX_PUBLISHABLE_KEY
          },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.session?.access_token) {
          throw new Error(data?.error || 'Aura X kullanıcı adı veya şifresi doğrulanamadı.');
        }

        // Başarılı Aura X oturumu. Forever için şimdilik yerel oturum başlat.
        localStorage.setItem('forever_aurax_user', JSON.stringify({
          username,
          auraxUid: data.user?.id || null,
          loggedInAt: Date.now()
        }));
        showAuthMessage('Aura X hesabı doğrulandı! Forever oturumu açılıyor…');
        // Modalı kapat ve sayfayı yenile veya ana görünüme geç
        document.getElementById('authModal')?.classList.add('hidden');
        location.reload();
      } catch (err) {
        showAuthMessage(err.message || 'Aura X ile giriş yapılamadı.');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Aura X hesabımı doğrula →'; }
      }
    });
  }
});
