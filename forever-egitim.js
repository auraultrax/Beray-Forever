/* Forever - Giriş sonrası mod seçimi (Forever Eğitim / Forever Sosyal).
 * Bu dosya yüklenmezse veya hata verirse uygulama eskisi gibi doğrudan Sosyal olarak açılır.
 */
(function () {
  'use strict';

  const MODE_KEY = 'forever_mode';
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function injectStyle() {
    if (document.getElementById('foreverModeStyle')) return;
    const st = document.createElement('style');
    st.id = 'foreverModeStyle';
    st.textContent = `
      #foreverModeOverlay, #foreverEduRoot { position: fixed; inset: 0; background: #000; color: #fff; z-index: 100001; display: none; }
      #foreverModeOverlay.show { display: flex; align-items: center; justify-content: center; padding: 20px; }
      #foreverModeOverlay .fm-wrap { width: 100%; max-width: 760px; text-align: center; }
      #foreverModeOverlay .fm-logo { font-size: 1.6rem; font-weight: 800; letter-spacing: .02em; margin-bottom: 8px; }
      #foreverModeOverlay .fm-sub { color: rgba(255,255,255,.6); font-size: .95rem; margin-bottom: 28px; }
      #foreverModeOverlay .fm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      #foreverModeOverlay .fm-btn { background: #0b0b0e; border: 1px solid rgba(255,255,255,.18); color: #fff; border-radius: 22px; padding: 34px 18px; font: inherit; font-size: 1.15rem; font-weight: 700; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 14px; transition: transform .18s ease, border-color .18s ease, background .18s ease; }
      #foreverModeOverlay .fm-btn i { font-size: 2.2rem; }
      #foreverModeOverlay .fm-btn small { font-weight: 400; font-size: .8rem; color: rgba(255,255,255,.55); }
      #foreverModeOverlay .fm-btn:hover, #foreverModeOverlay .fm-btn:focus-visible { transform: translateY(-3px); border-color: #8b5cf6; background: #101016; outline: none; }
      @media (max-width: 560px) { #foreverModeOverlay .fm-grid { grid-template-columns: 1fr; } #foreverModeOverlay .fm-btn { padding: 26px 16px; } }
      #foreverEduRoot.show { display: block; overflow-y: auto; }
      @media (prefers-reduced-motion: reduce) { #foreverModeOverlay .fm-btn { transition: none; } }
    `;
    document.head.appendChild(st);
  }

  function ensureOverlay() {
    let el = document.getElementById('foreverModeOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'foreverModeOverlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Forever modu seç');
    el.innerHTML = `
      <div class="fm-wrap">
        <div class="fm-logo"><i class="fa-solid fa-bolt-lightning"></i> Forever</div>
        <div class="fm-sub">Nereye gitmek istersin?</div>
        <div class="fm-grid">
          <button type="button" class="fm-btn" id="foreverModeEdu"><i class="fa-solid fa-graduation-cap"></i>Forever Eğitim<small>Okul, sınıf ve ders akışı</small></button>
          <button type="button" class="fm-btn" id="foreverModeSocial"><i class="fa-solid fa-users"></i>Forever Sosyal<small>Gönderiler, odalar, arkadaşlar</small></button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#foreverModeEdu').addEventListener('click', () => choose('edu'));
    el.querySelector('#foreverModeSocial').addEventListener('click', () => choose('social'));
    return el;
  }

  function currentUserName() {
    try { return (typeof currentUser !== 'undefined' && currentUser) ? String(currentUser) : ''; } catch (_) { return ''; }
  }

  function savedMode(user) {
    try {
      const raw = sessionStorage.getItem(MODE_KEY) || '';
      const i = raw.indexOf('|');
      if (i < 1) return '';
      return raw.slice(0, i) === user ? raw.slice(i + 1) : '';
    } catch (_) { return ''; }
  }

  function saveMode(user, mode) {
    try { sessionStorage.setItem(MODE_KEY, `${user}|${mode}`); } catch (_) {}
  }

  function hideChooser() {
    const el = document.getElementById('foreverModeOverlay');
    if (el) el.classList.remove('show');
  }

  function showSocial() {
    hideChooser();
    const edu = document.getElementById('foreverEduRoot');
    if (edu) edu.classList.remove('show');
  }

  function showEdu() {
    hideChooser();
    let root = document.getElementById('foreverEduRoot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'foreverEduRoot';
      document.body.appendChild(root);
    }
    root.classList.add('show');
    if (window.ForeverEdu && typeof window.ForeverEdu.open === 'function') {
      try { window.ForeverEdu.open(root, { user: currentUserName(), back: showChooser }); return; }
      catch (e) { console.error('Forever Eğitim açılamadı:', e); }
    }
    root.innerHTML = `
      <div style="min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;">
        <div style="max-width:420px;">
          <div style="font-size:1.4rem;font-weight:800;margin-bottom:10px;"><i class="fa-solid fa-graduation-cap"></i> Forever Eğitim</div>
          <p style="color:rgba(255,255,255,.65);margin-bottom:20px;">Bu bölüm yakında açılacak.</p>
          <button type="button" class="btn" id="foreverEduBackBtn">Forever Sosyal'e dön</button>
        </div>
      </div>`;
    const back = root.querySelector('#foreverEduBackBtn');
    if (back) back.addEventListener('click', () => choose('social'));
  }

  function choose(mode) {
    const user = currentUserName();
    if (user) saveMode(user, mode);
    if (mode === 'edu') showEdu(); else showSocial();
  }

  function showChooser() {
    injectStyle();
    const edu = document.getElementById('foreverEduRoot');
    if (edu) edu.classList.remove('show');
    const el = ensureOverlay();
    el.classList.add('show');
    const first = el.querySelector('#foreverModeEdu');
    if (first) first.focus();
  }

  // Giriş tamamlanınca çağrılır. Bu oturumda zaten seçim yapıldıysa tekrar sormaz.
  function onLogin() {
    try {
      injectStyle();
      const user = currentUserName();
      const mode = user ? savedMode(user) : '';
      if (mode === 'edu') showEdu();
      else if (mode === 'social') showSocial();
      else showChooser();
    } catch (e) {
      console.error('Mod seçimi gösterilemedi, Sosyal açılıyor:', e);
      showSocial();
    }
  }

  function clear() {
    try { sessionStorage.removeItem(MODE_KEY); } catch (_) {}
  }

  window.ForeverModes = { onLogin, showChooser, choose, clear, esc };
})();
