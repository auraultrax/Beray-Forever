import { supabaseClient } from './supabase-compat.js';

const $ = id => document.getElementById(id);
let session = null, userId = null, username = '', isPlus = false, activeRoom = null, roomChannel = null;
let drawingDirty = false, roomUiBound = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function toast(message) {
  if (window.fxToast) window.fxToast(message);
  else alert(message);
}
function plusBadge(plus) {
  return plus ? '<span class="forever-badges"><span class="forever-emerald">◆</span><span class="forever-verified">✓</span></span>' : '';
}
async function fetchDocs(collectionName) {
  const { data, error } = await supabaseClient.from('forever_documents')
    .select('id,data,owner_id,created_at').eq('collection_name', collectionName)
    .order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  return data || [];
}
async function insertDoc(collectionName, id, data) {
  const { error } = await supabaseClient.from('forever_documents').insert({
    collection_name: collectionName, id, owner_id: userId, data
  });
  if (error) throw error;
}
async function uploadRoomAsset(file, folder) {
  if (!file || file.size > 25 * 1024 * 1024) throw new Error('Dosya en fazla 25 MB olabilir.');
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = userId + '/' + folder + '/' + Date.now() + '-' + crypto.randomUUID() + '.' + ext;
  const { error } = await supabaseClient.storage.from('forever-media').upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  return supabaseClient.storage.from('forever-media').getPublicUrl(path).data.publicUrl;
}
async function currentMemberships() {
  const rows = await fetchDocs('room_members');
  return rows.filter(r => r.data?.userId === userId);
}
async function loadRoomList() {
  if (!userId) return;
  const list = $('roomList');
  if (!list) return;
  list.innerHTML = '<div class="empty">Odalar yükleniyor…</div>';
  try {
    const [rooms, memberships] = await Promise.all([fetchDocs('rooms'), currentMemberships()]);
    const joined = new Set(memberships.map(m => m.data.roomId));
    const plan = $('roomPlanLabel');
    if (plan) plan.textContent = isPlus ? '✦ Plus: oda sınırı yok' : 'Ücretsiz: en fazla 3 oda';
    list.innerHTML = rooms.length ? rooms.map(room => {
      const d = room.data || {};
      const isJoined = joined.has(room.id);
      return '<div class="room-message" style="display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--line);border-radius:12px;">' +
        '<div><strong>' + escapeHtml(d.name || 'Adsız oda') + '</strong><div><small>' + (isJoined ? 'Üyesisin' : 'Topluluk odası') + '</small></div></div>' +
        '<button type="button" class="btn ' + (isJoined ? 'btn-ghost' : '') + '" data-room-open="' + escapeHtml(room.id) + '" data-room-name="' + escapeHtml(d.name || 'Oda') + '">' + (isJoined ? 'Odayı aç' : 'Katıl') + '</button></div>';
    }).join('') : '<div class="empty">Henüz oda yok. İlk odayı sen oluştur!</div>';
    list.querySelectorAll('[data-room-open]').forEach(button => button.onclick = async () => {
      const id = button.dataset.roomOpen;
      const name = button.dataset.roomName;
      if (!joined.has(id)) {
        try {
          await insertDoc('room_members', userId + '_' + id, {
            roomId: id, userId, username, joinedAt: { seconds: Math.floor(Date.now() / 1000) }
          });
          toast('Odaya katıldın! 🎉');
        } catch (e) { toast(e.message || 'Odaya katılamadın.'); return; }
      }
      await loadRoomList();
      await openRoom(id, name);
    });
  } catch (e) {
    list.innerHTML = '<div class="empty">Odalar yüklenemedi: ' + escapeHtml(e.message) + '</div>';
  }
}
async function loadRoomMessages() {
  if (!activeRoom) return;
  const box = $('roomMessages');
  if (!box) return;
  const [messageResult, blockResult] = await Promise.all([
    supabaseClient.from('forever_documents')
      .select('id,data,created_at').eq('collection_name', 'room_messages')
      .contains('data', { roomId: activeRoom.id }).order('created_at', { ascending: true }).limit(150),
    fetchDocs('blocks')
  ]);
  if (messageResult.error) { box.innerHTML = '<div class="empty">Mesajlar yüklenemedi: ' + escapeHtml(messageResult.error.message) + '</div>'; return; }
  const blockedUsers = new Set((blockResult || [])
    .filter(row => row.data?.blockerId === userId)
    .map(row => row.data?.blockedId));
  const rows = (messageResult.data || []).filter(row => !blockedUsers.has(row.data?.userId));
  box.innerHTML = rows.length ? rows.map(row => renderMessage(row)).join('') : '<div class="empty">Bu odada henüz mesaj yok. İlk mesajı sen gönder!</div>';
  box.scrollTop = box.scrollHeight;
  box.querySelectorAll('[data-pin]').forEach(button => button.onclick = () => pinMessage(button.dataset.pin));
  box.querySelectorAll('[data-report]').forEach(button => button.onclick = () => reportMessage(button.dataset.report, button.dataset-owner));
  box.querySelectorAll('[data-block]').forEach(button => button.onclick = () => blockRoomUser(button.dataset.block));
}
function renderMessage(row) {
  const d = row.data || {};
  const mine = d.userId === userId;
  let body = '';
  if (d.kind === 'sticker') body = '<div class="sticker-choice sticker-motion-1" style="display:inline-block;font-size:2.6rem;border:0;">' + escapeHtml(d.sticker || '✨') + '</div>';
  else if (d.kind === 'custom_sticker' && d.stickerUrl) body = '<img src="' + escapeHtml(d.stickerUrl) + '" alt="Çıkartma" style="max-width:150px;max-height:150px;border-radius:12px;">';
  else if (d.kind === 'drawing' && d.drawingUrl) body = '<img src="' + escapeHtml(d.drawingUrl) + '" alt="Oda çizimi" style="width:min(100%,360px);border-radius:12px;background:white;">';
  else body = '<div>' + escapeHtml(d.text || '') + '</div>';
  const time = row.created_at ? new Date(row.created_at).toLocaleTimeString('tr-TR', {hour:'2-digit',minute:'2-digit'}) : '';
  const badges = plusBadge(Boolean(d.isPlus));
  const tools = '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:5px;">' +
    (isPlus ? '<button type="button" class="btn btn-ghost" style="padding:4px 7px;font-size:11px;" data-pin="' + escapeHtml(row.id) + '">' + (d.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle') + '</button>' : '<small>🔒 Sabitleme Plus</small>') +
    (!mine ? '<button type="button" class="btn btn-ghost" style="padding:4px 7px;font-size:11px;" data-report="' + escapeHtml(row.id) + '" data-owner="' + escapeHtml(d.userId || '') + '">Şikâyet</button><button type="button" class="btn btn-ghost" style="padding:4px 7px;font-size:11px;" data-block="' + escapeHtml(d.userId || '') + '">Engelle</button>' : '') +
    '</div>';
  return '<div class="room-message" style="' + (d.pinned ? 'background:rgba(139,92,246,.13);' : '') + '">' +
    '<div><strong>@' + escapeHtml(d.username || 'kullanıcı') + '</strong>' + badges +
    (d.pinned ? ' <span class="tag">📌 Sabit</span>' : '') +
    '<small style="float:right;">' + time + '</small></div>' + body + tools + '</div>';
}
async function openRoom(id, name) {
  activeRoom = { id, name };
  $('roomChat').classList.remove('hidden');
  $('roomChatTitle').textContent = name;
  $('stickerLock').textContent = isPlus ? '' : '🔒 Plus';
  $('drawingLock').textContent = isPlus ? '' : '🔒 Plus';
  $('openStickersBtn').disabled = !isPlus;
  $('toggleDrawingBtn').disabled = !isPlus;
  $('customStickerFile').disabled = !isPlus;
  await loadRoomMessages();
  if (roomChannel) await supabaseClient.removeChannel(roomChannel);
  roomChannel = supabaseClient.channel('forever-room-' + id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'forever_documents', filter: 'collection_name=eq.room_messages' }, payload => {
      if (payload.new?.data?.roomId === activeRoom?.id || payload.old?.data?.roomId === activeRoom?.id) loadRoomMessages();
    }).subscribe();
  $('roomChat').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function sendRoomMessage(payload) {
  if (!activeRoom || !userId) return;
  const data = Object.assign({
    roomId: activeRoom.id, userId, username, isPlus,
    createdAt: { seconds: Math.floor(Date.now() / 1000) }
  }, payload);
  try {
    await insertDoc('room_messages', crypto.randomUUID(), data);
    if (payload.kind === 'text') $('roomMessageText').value = '';
    await loadRoomMessages();
  } catch (e) { toast(e.message || 'Mesaj gönderilemedi.'); }
}
async function pinMessage(id) {
  if (!isPlus) return toast('Mesaj sabitleme Plus üyeliği gerektirir. 🔒');
  try {
    const r = await supabaseClient.from('forever_documents').select('data').eq('collection_name','room_messages').eq('id',id).single();
    if (r.error) throw r.error;
    const data = Object.assign({}, r.data.data, { pinned: !r.data.data.pinned });
    const update = await supabaseClient.from('forever_documents').update({ data, updated_at: new Date().toISOString() }).eq('collection_name','room_messages').eq('id',id);
    if (update.error) throw update.error;
    await loadRoomMessages();
  } catch (e) { toast(e.message || 'Mesaj sabitlenemedi.'); }
}
async function reportMessage(messageId, ownerId) {
  const reason = prompt('Şikâyet sebebi nedir?');
  if (!reason) return;
  try {
    await insertDoc('reports', crypto.randomUUID(), {
      reporterId: userId, type: 'room_message', targetId: messageId, targetUserId: ownerId,
      reason: reason.slice(0, 400), status: 'open', createdAt: { seconds: Math.floor(Date.now() / 1000) }
    });
    toast('Şikâyetin yönetim ekibine iletildi.');
  } catch (e) { toast(e.message || 'Şikâyet gönderilemedi.'); }
}
async function blockRoomUser(targetId) {
  if (!targetId || targetId === userId) return;
  if (!confirm('Bu kullanıcıyı engellemek istiyor musun?')) return;
  try {
    await insertDoc('blocks', userId + '_' + targetId, { blockerId: userId, blockedId: targetId, createdAt: { seconds: Math.floor(Date.now() / 1000) } });
    const profile = await supabaseClient.from('forever_documents').select('data')
      .eq('collection_name','users').eq('id',userId).single();
    if (!profile.error) {
      const blocked = new Set(profile.data?.data?.blocked || []);
      blocked.add(targetId);
      const update = await supabaseClient.from('forever_documents')
        .update({ data: Object.assign({}, profile.data.data || {}, { blocked: [...blocked] }), updated_at: new Date().toISOString() })
        .eq('collection_name','users').eq('id',userId);
      if (update.error) throw update.error;
    }
    toast('Kullanıcı engellendi.');
  } catch (e) { toast(e.message || 'Kullanıcı engellenemedi.'); }
}
function setupCanvas() {
  const canvas = $('roomDrawingCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.strokeStyle = '#6d28d9';
  let drawing = false;
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * canvas.width / rect.width;
    const y = (event.clientY - rect.top) * canvas.height / rect.height;
    return {x,y};
  }
  canvas.addEventListener('pointerdown', event => { drawing = true; canvas.setPointerCapture(event.pointerId); const p = point(event); ctx.beginPath(); ctx.moveTo(p.x,p.y); });
  canvas.addEventListener('pointermove', event => { if (!drawing) return; const p = point(event); ctx.lineTo(p.x,p.y); ctx.stroke(); drawingDirty = true; });
  const stop = () => { drawing = false; };
  canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
  $('clearDrawingBtn').onclick = () => { ctx.clearRect(0,0,canvas.width,canvas.height); drawingDirty = false; };
  $('sendDrawingBtn').onclick = async () => {
    if (!isPlus) return toast('Oda çizimi Plus üyeliği gerektirir. 🔒');
    if (!drawingDirty) return toast('Önce tuvale bir şey çiz.');
    try {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob], 'room-drawing.png', {type:'image/png'});
      const url = await uploadRoomAsset(file, 'drawings');
      await sendRoomMessage({kind:'drawing',drawingUrl:url,text:'Oda çizimi'});
      ctx.clearRect(0,0,canvas.width,canvas.height); drawingDirty = false; $('drawingBox').classList.add('hidden');
    } catch (e) { toast(e.message || 'Çizim gönderilemedi.'); }
  };
}
function bindRoomUi() {
  if (roomUiBound) return;
  roomUiBound = true;
  $('createRoomForm').onsubmit = async event => {
    event.preventDefault();
    const name = $('newRoomName').value.trim();
    if (!name) return;
    try {
      const id = crypto.randomUUID();
      await insertDoc('rooms', id, { name, ownerId: userId, createdByUsername: username, createdAt: { seconds: Math.floor(Date.now() / 1000) } });
      await insertDoc('room_members', userId + '_' + id, { roomId: id, userId, username, role: 'owner', joinedAt: { seconds: Math.floor(Date.now() / 1000) } });
      $('newRoomName').value = '';
      await loadRoomList(); await openRoom(id, name); toast('Odan oluşturuldu! 🎉');
    } catch (e) { toast(e.message || 'Oda oluşturulamadı.'); }
  };
  $('leaveRoomBtn').onclick = async () => {
    if (!activeRoom) return;
    try {
      const r = await supabaseClient.from('forever_documents').delete().eq('collection_name','room_members').eq('id',userId + '_' + activeRoom.id);
      if (r.error) throw r.error;
      if (roomChannel) await supabaseClient.removeChannel(roomChannel);
      activeRoom = null; $('roomChat').classList.add('hidden'); await loadRoomList();
    } catch (e) { toast(e.message || 'Odadan ayrılamadın.'); }
  };
  $('roomMessageForm').onsubmit = event => { event.preventDefault(); const text = $('roomMessageText').value.trim(); if (text) sendRoomMessage({kind:'text',text}); };
  $('openStickersBtn').onclick = () => { if (!isPlus) return toast('Animasyonlu çıkartmalar Plus üyeliği gerektirir. 🔒'); $('stickerTray').classList.toggle('hidden'); };
  $('stickerTray').querySelectorAll('[data-sticker]').forEach(button => button.onclick = () => {
    if (!isPlus) return toast('Çıkartmalar Plus üyelerine özeldir. 🔒');
    sendRoomMessage({kind:'sticker',sticker:button.dataset.sticker});
  });
  $('toggleDrawingBtn').onclick = () => {
    if (!isPlus) return toast('Oda çizimi Plus üyeliği gerektirir. 🔒');
    $('drawingBox').classList.toggle('hidden');
  };
  $('customStickerFile').onchange = async event => {
    if (!isPlus) return toast('Özel çıkartmalar Plus üyelerine özeldir. 🔒');
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.type !== 'image/gif') throw new Error('Lütfen GIF dosyası seç.');
      const url = await uploadRoomAsset(file, 'stickers');
      await sendRoomMessage({kind:'custom_sticker',stickerUrl:url,text:'Özel çıkartma'});
    } catch (e) { toast(e.message || 'Çıkartma gönderilemedi.'); }
    finally { event.target.value = ''; }
  };
  setupCanvas();
}
async function initForUser() {
  const r = await supabaseClient.auth.getSession();
  session = r.data.session;
  if (!session?.user) return;
  userId = session.user.id;
  const [profile, plus] = await Promise.all([
    supabaseClient.from('forever_documents').select('data').eq('collection_name','users').eq('id',userId).maybeSingle(),
    supabaseClient.rpc('is_forever_plus')
  ]);
  if (profile.error) return;
  username = profile.data?.data?.username || session.user.user_metadata?.name || 'Kullanıcı';
  isPlus = Boolean(plus.data);
  bindRoomUi();
  await loadRoomList();
}
window.addEventListener('forever-user-ready', event => {
  userId = event.detail.uid; username = event.detail.username || 'Kullanıcı'; isPlus = Boolean(event.detail.isPlus);
  initForUser().catch(e => console.error('Rooms init',e));
});
initForUser().catch(e => console.error('Rooms init',e));
