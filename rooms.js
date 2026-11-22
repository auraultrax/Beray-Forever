import { supabaseClient } from './supabase-compat.js';

const $ = id => document.getElementById(id);
let session = null, userId = null, username = '', isPlus = false, activeRoom = null, roomChannel = null;
let knownPlusUserIds = new Set(), plusUsersChannel = null;
let drawingDirty = false, roomUiBound = false, currentMembersMode = 'members';
let themeIndex = 0;
const roomThemes = [
  { name: 'Mor', accent: '#8b5cf6', bubble: '#8b5cf6' },
  { name: 'Pembe', accent: '#ec4899', bubble: '#db4b9b' },
  { name: 'Mavi', accent: '#3b82f6', bubble: '#326bd1' },
  { name: 'Yeşil', accent: '#10b981', bubble: '#0c9270' }
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function safeMediaUrl(value) {
  try {
    const url = new URL(String(value || ''), window.location.href);
    return url.protocol === 'https:' ? escapeHtml(url.href) : '';
  } catch (_) { return ''; }
}
function toast(message) {
  if (window.fxToast) window.fxToast(message);
  else alert(message);
}
function plusBadge(plus) {
  return plus ? '<span class="forever-badges"><span class="forever-emerald">◆</span><span class="forever-verified">✓</span></span>' : '';
}
function roomOwner() {
  return Boolean(activeRoom && activeRoom.data && activeRoom.data.ownerId === userId);
}
async function fetchDocs(collectionName) {
  const { data, error } = await supabaseClient.from('forever_documents')
    .select('id,data,owner_id,created_at').eq('collection_name', collectionName)
    .order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  return data || [];
}
async function refreshKnownPlusUsers() {
  try {
    const users = await fetchDocs('users');
    knownPlusUserIds = new Set(users.filter(row => row.data?.isPlus).map(row => row.id));
  } catch (error) { console.warn('Plus kullanıcı rozetleri yüklenemedi:', error); }
}
function watchRoomPlusUsers() {
  if (plusUsersChannel) return;
  plusUsersChannel = supabaseClient.channel('forever-room-plus-user-profiles')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'forever_documents', filter: 'collection_name=eq.users' }, async () => {
      await refreshKnownPlusUsers();
      if (activeRoom) await loadRoomMessages();
    }).subscribe();
}
function applyRoomTheme(themeName) {
  const chat = $('roomChat');
  const theme = roomThemes.find(item => item.name === themeName) || roomThemes[0];
  if (!chat) return;
  chat.style.setProperty('--room-accent', theme.accent);
  chat.style.setProperty('--room-bubble', theme.bubble);
  themeIndex = Math.max(0, roomThemes.findIndex(item => item.name === theme.name));
}
function syncPlusControls() {
  const label = $('roomPlanLabel');
  if (label) label.textContent = isPlus ? '✦ Plus: oda sınırı yok' : 'Ücretsiz: en fazla 3 oda';
  const features = activeRoom?.data?.features || {};
  const stickersEnabled = features.stickers !== false;
  const drawingEnabled = features.drawing !== false;
  const stickerButton = $('openStickersBtn');
  const drawingButton = $('toggleDrawingBtn');
  const stickerFile = $('customStickerFile');
  if (stickerButton) stickerButton.disabled = !isPlus || !stickersEnabled;
  if (drawingButton) drawingButton.disabled = !isPlus || !drawingEnabled;
  if (stickerFile) stickerFile.disabled = !isPlus || !stickersEnabled;
  if ($('stickerLock')) $('stickerLock').textContent = isPlus ? '' : '🔒 Plus';
  if ($('drawingLock')) $('drawingLock').textContent = isPlus ? '' : '🔒 Plus';
  if (!isPlus || !drawingEnabled) $('drawingBox')?.classList.add('hidden');
  if (!isPlus || !stickersEnabled) $('stickerTray')?.classList.add('hidden');
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
function switchRoomTab(tabName) {
  const create = tabName === 'create';
  $('tab-join')?.classList.toggle('active', !create);
  $('tab-create')?.classList.toggle('active', create);
  document.querySelectorAll('[data-room-tab]').forEach(button => {
    const selected = button.dataset.roomTab === (create ? 'create' : 'join');
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
}
window.switchRoomTab = switchRoomTab;

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
      const isPrivate = Boolean(d.isPrivate);
      const unavailable = isPrivate && !isJoined;
      const info = isPrivate ? '🔒 Özel oda' : (isJoined ? 'Üyesisin' : 'Topluluk odası');
      const action = unavailable ? 'Özel' : (isJoined ? 'Odaya Gir' : 'Odaya Katıl');
      return '<article class="room-list-item">' +
        '<div class="room-list-icon"><i class="fa-solid fa-hashtag"></i></div>' +
        '<div class="room-list-copy"><strong>' + escapeHtml(d.name || 'Adsız oda') + '</strong><small>' + escapeHtml(info) + '</small></div>' +
        '<button type="button" class="room-list-open" data-room-open="' + escapeHtml(room.id) + '" data-room-name="' + escapeHtml(d.name || 'Oda') + '" ' + (unavailable ? 'disabled' : '') + '>' + action + '</button>' +
      '</article>';
    }).join('') : '<div class="room-empty-state"><i class="fa-regular fa-comments"></i><strong>Henüz oda yok</strong><span>İlk odayı oluşturup arkadaşlarını davet edebilirsin.</span><button type="button" class="btn" data-open-create-room>Oda Ekle</button></div>';
    list.querySelectorAll('[data-open-create-room]').forEach(button => button.onclick = () => switchRoomTab('create'));
    list.querySelectorAll('[data-room-open]').forEach(button => button.onclick = async () => {
      const id = button.dataset.roomOpen;
      const name = button.dataset.roomName;
      const room = rooms.find(item => item.id === id);
      const data = room?.data || {};
      if (!joined.has(id)) {
        if (data.isPrivate) return toast('Bu oda özel. Oda sahibinden davet istemelisin.');
        try {
          await insertDoc('room_members', userId + '_' + id, {
            roomId: id, userId, username, role: 'member',
            joinedAt: { seconds: Math.floor(Date.now() / 1000) }
          });
          toast('Odaya katıldın! 🎉');
        } catch (e) { toast(e.message || 'Odaya katılamadın.'); return; }
      }
      await openRoom(id, name, data);
    });
  } catch (e) {
    list.innerHTML = '<div class="empty">Odalar yüklenemedi: ' + escapeHtml(e.message) + '</div>';
  }
}
function renderMessage(row) {
  const d = row.data || {};
  const mine = d.userId === userId;
  let body = '';
  if (d.kind === 'sticker') {
    body = '<div class="room-sticker-message">' + escapeHtml(d.sticker || '✨') + '</div>';
  } else if (d.kind === 'custom_sticker' && d.stickerUrl) {
    const url = safeMediaUrl(d.stickerUrl);
    body = url ? '<img class="room-message-media" src="' + url + '" alt="Çıkartma">' : '<div>Çıkartma</div>';
  } else if (d.kind === 'drawing' && d.drawingUrl) {
    const url = safeMediaUrl(d.drawingUrl);
    body = url ? '<img class="room-message-media room-drawing-media" src="' + url + '" alt="Oda çizimi">' : '<div>Çizim</div>';
  } else {
    body = '<div class="room-message-text">' + escapeHtml(d.text || '') + '</div>';
  }
  const time = row.created_at ? new Date(row.created_at).toLocaleTimeString('tr-TR', {hour:'2-digit',minute:'2-digit'}) : '';
  const badges = plusBadge(knownPlusUserIds.has(d.userId));
  const meta = '<div class="room-message-meta"><span class="room-message-author">' + escapeHtml(d.username || 'kullanıcı') + '</span>' + badges + (d.pinned ? '<span class="room-pinned-label">📌 Sabit</span>' : '') + '<time>' + time + '</time></div>';
  const actions = '<div class="room-message-actions">' +
    (isPlus ? '<button type="button" data-pin="' + escapeHtml(row.id) + '">' + (d.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle') + '</button>' : '') +
    (!mine ? '<button type="button" data-report="' + escapeHtml(row.id) + '" data-owner="' + escapeHtml(d.userId || '') + '">Şikâyet</button><button type="button" data-block="' + escapeHtml(d.userId || '') + '">Engelle</button>' : '') +
    '</div>';
  return '<article class="room-message-row ' + (mine ? 'mine' : 'others') + (d.pinned ? ' is-pinned' : '') + '">' +
    '<div class="room-message-card">' + meta + '<div class="room-message-bubble">' + body + '</div>' + actions + '</div></article>';
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
  if (messageResult.error) {
    box.innerHTML = '<div class="empty">Mesajlar yüklenemedi: ' + escapeHtml(messageResult.error.message) + '</div>';
    return;
  }
  const blockedUsers = new Set((blockResult || [])
    .filter(row => row.data?.blockerId === userId)
    .map(row => row.data?.blockedId));
  const rows = (messageResult.data || []).filter(row => !blockedUsers.has(row.data?.userId));
  if (!rows.length) {
    box.innerHTML = '<div class="room-chat-empty"><i class="fa-regular fa-comments"></i><strong>Henüz mesaj yok</strong><span>İlk mesajı sen gönder!</span></div>';
  } else {
    let lastDate = '';
    box.innerHTML = rows.map(row => {
      const date = row.created_at ? new Date(row.created_at) : null;
      const dateKey = date ? date.toLocaleDateString('tr-TR') : '';
      const separator = dateKey && dateKey !== lastDate
        ? '<div class="room-date-separator"><span>' + escapeHtml(date.toLocaleDateString('tr-TR', {day:'2-digit',month:'2-digit',year:'numeric',weekday:'long'})) + '</span></div>'
        : '';
      lastDate = dateKey || lastDate;
      return separator + renderMessage(row);
    }).join('');
  }
  box.scrollTop = box.scrollHeight;
  box.querySelectorAll('[data-pin]').forEach(button => button.onclick = () => pinMessage(button.dataset.pin));
  box.querySelectorAll('[data-report]').forEach(button => button.onclick = () => reportMessage(button.dataset.report, button.dataset.owner));
  box.querySelectorAll('[data-block]').forEach(button => button.onclick = () => blockRoomUser(button.dataset.block));
}
async function updateActiveRoomSettings(patch) {
  if (!activeRoom || !roomOwner()) throw new Error('Bu ayarı yalnızca oda sahibi değiştirebilir.');
  const result = await supabaseClient.from('forever_documents').select('data')
    .eq('collection_name','rooms').eq('id',activeRoom.id).single();
  if (result.error) throw result.error;
  const updatedData = Object.assign({}, result.data?.data || {}, patch);
  const update = await supabaseClient.from('forever_documents')
    .update({ data: updatedData, updated_at: new Date().toISOString() })
    .eq('collection_name','rooms').eq('id',activeRoom.id);
  if (update.error) throw update.error;
  activeRoom.data = updatedData;
  syncRoomControls();
  await loadRoomList();
}
function syncRoomControls() {
  if (!activeRoom) return;
  const owner = roomOwner();
  const privateButton = $('roomPrivateBtn');
  const lockButton = $('roomSendLockBtn');
  if (privateButton) {
    privateButton.innerHTML = activeRoom.data.isPrivate ? '<i class="fa-solid fa-lock"></i>' : '<i class="fa-solid fa-lock-open"></i>';
    privateButton.title = activeRoom.data.isPrivate ? 'Oda özel: yeni katılıma kapalı' : 'Oda herkese açık';
    privateButton.classList.toggle('is-active', Boolean(activeRoom.data.isPrivate));
    privateButton.disabled = !owner;
  }
  if (lockButton) {
    lockButton.innerHTML = activeRoom.data.messagesLocked ? '<i class="fa-solid fa-lock"></i>' : '<i class="fa-solid fa-lock-open"></i>';
    lockButton.title = activeRoom.data.messagesLocked ? 'Mesaj gönderme kilitli' : 'Mesaj gönderme açık';
    lockButton.classList.toggle('is-active', Boolean(activeRoom.data.messagesLocked));
    lockButton.disabled = !owner;
  }
  const deleteButton = $('roomDeleteBtn');
  if (deleteButton) deleteButton.hidden = !owner;
  const lockedForUser = Boolean(activeRoom.data.messagesLocked && !owner);
  const textInput = $('roomMessageText');
  const sendButton = $('sendRoomMessageBtn');
  if (textInput) {
    textInput.disabled = lockedForUser;
    textInput.placeholder = lockedForUser ? 'Oda sahibi mesaj göndermeyi kilitledi.' : 'Mesaj yazın...';
  }
  if (sendButton) sendButton.disabled = lockedForUser;
  const status = $('roomStatusLine');
  if (status) status.textContent = (activeRoom.data.isPrivate ? '🔒 Özel oda' : 'Açık oda') + (activeRoom.data.messagesLocked ? ' · Mesaj gönderme kilitli' : ' · Sohbet açık');
}
async function loadRoomMemberCount() {
  if (!activeRoom) return;
  try {
    const rows = await fetchDocs('room_members');
    const count = rows.filter(row => row.data?.roomId === activeRoom.id).length;
    if ($('roomChatMemberCount')) $('roomChatMemberCount').textContent = count ? '· ' + count + ' üye' : '';
  } catch (_) {}
}
async function openRoom(id, name, data) {
  activeRoom = { id, name, data: Object.assign({}, data || {}) };
  $('roomSelectionArea')?.classList.add('hidden');
  $('roomChat')?.classList.remove('hidden');
  $('roomChatTitle').textContent = name;
  document.body.classList.add('room-chat-open');
  const savedTheme = activeRoom.data.theme || 'Mor';
  applyRoomTheme(savedTheme);
  syncPlusControls();
  syncRoomControls();
  await Promise.all([loadRoomMessages(), loadRoomMemberCount()]);
  if (roomChannel) await supabaseClient.removeChannel(roomChannel);
  roomChannel = supabaseClient.channel('forever-room-' + id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'forever_documents', filter: 'collection_name=eq.room_messages' }, payload => {
      if (payload.new?.data?.roomId === activeRoom?.id || payload.old?.data?.roomId === activeRoom?.id) loadRoomMessages();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'forever_documents', filter: 'collection_name=eq.room_members' }, () => loadRoomMemberCount())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'forever_documents', filter: 'collection_name=eq.rooms' }, async payload => {
      if (payload.new?.id === activeRoom?.id && payload.new?.data) {
        activeRoom.data = payload.new.data;
        syncRoomControls();
        syncPlusControls();
      }
    }).subscribe();
}
async function sendRoomMessage(payload) {
  if (!activeRoom || !userId) return;
  if (activeRoom.data.messagesLocked && !roomOwner()) return toast('Bu odada mesaj gönderme geçici olarak kilitlendi.');
  const data = Object.assign({
    roomId: activeRoom.id, userId, username, isPlus,
    createdAt: { seconds: Math.floor(Date.now() / 1000) }
  }, payload);
  try {
    await insertDoc('room_messages', crypto.randomUUID(), data);
    if (payload.kind === 'text') {
      $('roomMessageText').value = '';
      $('roomMessageText').style.height = 'auto';
    }
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
function openRoomMembers(mode) {
  if (!activeRoom) return;
  currentMembersMode = mode || 'members';
  $('roomMembersTitle').textContent = currentMembersMode === 'invite' ? 'Odaya üye davet et' : 'Oda üyeleri';
  $('roomMembersSubtitle').textContent = currentMembersMode === 'invite' ? 'Davet etmek istediğin kişiyi seç.' : 'Bu odada bulunan kişiler.';
  $('roomMembersModal').classList.remove('hidden');
  loadRoomMembers();
}
window.closeRoomMembersModal = function() {
  $('roomMembersModal')?.classList.add('hidden');
};
async function loadRoomMembers() {
  const box = $('roomMembersList');
  if (!box || !activeRoom) return;
  box.innerHTML = '<div class="empty">Üyeler yükleniyor…</div>';
  try {
    const [members, users] = await Promise.all([fetchDocs('room_members'), fetchDocs('users')]);
    const memberRows = members.filter(row => row.data?.roomId === activeRoom.id);
    const memberIds = new Set(memberRows.map(row => row.data.userId));
    const memberNames = new Map(users.map(row => [row.id, row.data?.username || row.data?.displayName || 'Kullanıcı']));
    const canInvite = roomOwner();
    const source = currentMembersMode === 'invite'
      ? users.filter(row => row.id !== userId)
      : memberRows.map(row => ({ id: row.data.userId, data: { username: memberNames.get(row.data.userId) || row.data.username || 'Kullanıcı' }, memberData: row.data }));
    if (currentMembersMode === 'invite' && !canInvite) {
      box.innerHTML = '<div class="room-members-empty">Yalnızca oda sahibi yeni üye davet edebilir.</div>';
      return;
    }
    box.innerHTML = source.length ? source.map(row => {
      const name = row.data?.username || row.data?.displayName || row.memberData?.username || 'Kullanıcı';
      const isMember = memberIds.has(row.id);
      const role = row.memberData?.role === 'owner' || row.id === activeRoom.data.ownerId ? 'Oda sahibi' : (isMember ? 'Üye' : '');
      const action = currentMembersMode === 'invite'
        ? (isMember ? '<span class="room-member-state">Zaten üye</span>' : '<button type="button" class="room-invite-action" data-invite-user="' + escapeHtml(row.id) + '" data-invite-name="' + escapeHtml(name) + '">Davet et</button>')
        : '<span class="room-member-state">' + escapeHtml(role) + '</span>';
      return '<div class="room-member-list-row"><div class="room-member-avatar">' + escapeHtml(name.slice(0,1).toUpperCase()) + '</div><div class="room-member-list-copy"><strong>' + escapeHtml(name) + '</strong><small>' + escapeHtml(role || 'Forever üyesi') + '</small></div>' + action + '</div>';
    }).join('') : '<div class="room-members-empty">Henüz üye görünmüyor.</div>';
    box.querySelectorAll('[data-invite-user]').forEach(button => button.onclick = async () => {
      const targetId = button.dataset.inviteUser;
      const targetName = button.dataset.inviteName;
      try {
        await insertDoc('room_members', targetId + '_' + activeRoom.id, {
          roomId: activeRoom.id, userId: targetId, username: targetName, role: 'member',
          invitedBy: userId, joinedAt: { seconds: Math.floor(Date.now() / 1000) }
        });
        toast(targetName + ' odaya davet edildi.');
        await loadRoomMembers();
        await loadRoomMemberCount();
      } catch (error) { toast(error.message || 'Davet gönderilemedi.'); }
    });
  } catch (error) {
    box.innerHTML = '<div class="empty">Üyeler yüklenemedi: ' + escapeHtml(error.message) + '</div>';
  }
}
async function setRoomTheme() {
  if (!activeRoom) return;
  themeIndex = (themeIndex + 1) % roomThemes.length;
  const theme = roomThemes[themeIndex];
  applyRoomTheme(theme.name);
  if (roomOwner()) {
    try { await updateActiveRoomSettings({ theme: theme.name }); }
    catch (error) { toast(error.message || 'Oda rengi kaydedilemedi.'); }
  }
  toast('Oda rengi: ' + theme.name);
}
async function toggleRoomPrivacy() {
  if (!roomOwner()) return toast('Bu ayarı yalnızca oda sahibi değiştirebilir.');
  try {
    const isPrivate = !Boolean(activeRoom.data.isPrivate);
    await updateActiveRoomSettings({ isPrivate });
    toast(isPrivate ? 'Oda özel hale getirildi.' : 'Oda yeniden herkese açıldı.');
  } catch (error) { toast(error.message || 'Oda gizliliği değiştirilemedi.'); }
}
async function toggleRoomMessageLock() {
  if (!roomOwner()) return toast('Bu ayarı yalnızca oda sahibi değiştirebilir.');
  try {
    const messagesLocked = !Boolean(activeRoom.data.messagesLocked);
    await updateActiveRoomSettings({ messagesLocked });
    toast(messagesLocked ? 'Mesaj gönderme kilitlendi.' : 'Mesaj gönderme açıldı.');
  } catch (error) { toast(error.message || 'Mesaj kilidi değiştirilemedi.'); }
}
async function deleteActiveRoom() {
  if (!activeRoom || !roomOwner()) return toast('Odayı yalnızca sahibi silebilir.');
  if (!confirm('Bu odayı ve oda mesajlarını silmek istediğine emin misin?')) return;
  const roomId = activeRoom.id;
  try {
    const [messages, members, room] = await Promise.all([
      supabaseClient.from('forever_documents').delete().eq('collection_name','room_messages').contains('data', { roomId }),
      supabaseClient.from('forever_documents').delete().eq('collection_name','room_members').contains('data', { roomId }),
      supabaseClient.from('forever_documents').delete().eq('collection_name','rooms').eq('id', roomId)
    ]);
    if (messages.error) throw messages.error;
    if (members.error) throw members.error;
    if (room.error) throw room.error;
    await closeActiveRoom();
    toast('Oda silindi.');
  } catch (error) { toast(error.message || 'Oda silinemedi.'); }
}
async function closeActiveRoom() {
  if (roomChannel) {
    await supabaseClient.removeChannel(roomChannel);
    roomChannel = null;
  }
  activeRoom = null;
  drawingDirty = false;
  $('roomChat')?.classList.add('hidden');
  $('roomSelectionArea')?.classList.remove('hidden');
  $('roomMembersModal')?.classList.add('hidden');
  $('roomComposerMenu')?.classList.add('hidden');
  document.body.classList.remove('room-chat-open');
  await loadRoomList();
}
window.closeAuraRoomView = closeActiveRoom;

function setupCanvas() {
  const canvas = $('roomDrawingCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.strokeStyle = '#8b5cf6';
  let drawing = false;
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * canvas.width / rect.width;
    const y = (event.clientY - rect.top) * canvas.height / rect.height;
    return {x,y};
  }
  canvas.addEventListener('pointerdown', event => {
    if (!isPlus || activeRoom?.data?.features?.drawing === false) return;
    drawing = true; canvas.setPointerCapture(event.pointerId);
    const p = point(event); ctx.beginPath(); ctx.moveTo(p.x,p.y);
  });
  canvas.addEventListener('pointermove', event => {
    if (!drawing) return;
    const p = point(event); ctx.lineTo(p.x,p.y); ctx.stroke(); drawingDirty = true;
  });
  const stop = () => { drawing = false; };
  canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
  $('clearDrawingBtn').onclick = () => {
    ctx.clearRect(0,0,canvas.width,canvas.height); drawingDirty = false;
  };
  $('sendDrawingBtn').onclick = async () => {
    if (!isPlus) return toast('Oda çizimi Plus üyeliği gerektirir. 🔒');
    if (!drawingDirty) return toast('Önce tuvale bir şey çiz.');
    try {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Çizim görseli hazırlanamadı.');
      const file = new File([blob], 'room-drawing.png', {type:'image/png'});
      const url = await uploadRoomAsset(file, 'drawings');
      await sendRoomMessage({kind:'drawing',drawingUrl:url,text:'Oda çizimi'});
      ctx.clearRect(0,0,canvas.width,canvas.height);
      drawingDirty = false;
      $('drawingBox').classList.add('hidden');
    } catch (e) { toast(e.message || 'Çizim gönderilemedi.'); }
  };
}
function bindRoomUi() {
  if (roomUiBound) return;
  roomUiBound = true;
  document.querySelectorAll('[data-room-tab]').forEach(button => button.addEventListener('click', () => switchRoomTab(button.dataset.roomTab)));
  $('refreshRoomListBtn').onclick = loadRoomList;
  $('createRoomForm').onsubmit = async event => {
    event.preventDefault();
    const name = $('newRoomName').value.trim();
    if (!name) return;
    try {
      const allRooms = await fetchDocs('rooms');
      const ownedRooms = allRooms.filter(row => row.data?.ownerId === userId).length;
      if (!isPlus && ownedRooms >= 3) return toast('Ücretsiz hesap en fazla 3 oda oluşturabilir. Plus ile sınır kalkar.');
      const id = crypto.randomUUID();
      const data = {
        name, ownerId: userId, createdByUsername: username,
        isPrivate: false, messagesLocked: false, theme: 'Mor',
        features: {
          drawing: $('newRoomDrawingEnabled').checked,
          stickers: $('newRoomStickersEnabled').checked
        },
        createdAt: { seconds: Math.floor(Date.now() / 1000) }
      };
      await insertDoc('rooms', id, data);
      await insertDoc('room_members', userId + '_' + id, {
        roomId: id, userId, username, role: 'owner',
        joinedAt: { seconds: Math.floor(Date.now() / 1000) }
      });
      $('newRoomName').value = '';
      switchRoomTab('join');
      await openRoom(id, name, data);
      toast('Odan oluşturuldu! 🎉');
    } catch (e) { toast(e.message || 'Oda oluşturulamadı.'); }
  };
  $('leaveRoomBtn').onclick = closeActiveRoom;
  $('roomDeleteBtn').onclick = deleteActiveRoom;
  $('roomPrivateBtn').onclick = toggleRoomPrivacy;
  $('roomSendLockBtn').onclick = toggleRoomMessageLock;
  $('roomThemeBtn').onclick = setRoomTheme;
  $('roomInviteBtn').onclick = () => openRoomMembers('invite');
  $('roomMembersBtn').onclick = () => openRoomMembers('members');
  $('roomComposerPlusBtn').onclick = () => $('roomComposerMenu').classList.toggle('hidden');
  $('roomUploadStickerBtn').onclick = () => {
    $('roomComposerMenu').classList.add('hidden');
    if (!isPlus) return toast('Özel çıkartmalar Plus üyelerine özeldir. 🔒');
    $('customStickerFile').click();
  };
  $('roomMessageForm').onsubmit = event => {
    event.preventDefault();
    const text = $('roomMessageText').value.trim();
    if (text) sendRoomMessage({kind:'text',text});
  };
  $('roomMessageText').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('roomMessageForm').requestSubmit();
    }
  });
  $('roomMessageText').addEventListener('input', event => {
    const el = event.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  });
  $('openStickersBtn').onclick = () => {
    if (!isPlus) return toast('Animasyonlu çıkartmalar Plus üyeliği gerektirir. 🔒');
    $('stickerTray').classList.toggle('hidden');
  };
  $('stickerTray').querySelectorAll('[data-sticker]').forEach(button => button.onclick = () => {
    if (!isPlus) return toast('Çıkartmalar Plus üyelerine özeldir. 🔒');
    sendRoomMessage({kind:'sticker',sticker:button.dataset.sticker});
  });
  $('toggleDrawingBtn').onclick = () => {
    $('roomComposerMenu').classList.add('hidden');
    if (!isPlus) return toast('Oda çizimi Plus üyeliği gerektirir. 🔒');
    $('drawingBox').classList.toggle('hidden');
  };
  $('customStickerFile').onchange = async event => {
    if (!isPlus) return toast('Özel çıkartmalar Plus üyelerine özeldir. 🔒');
    const file = event.target.files?.[0];
    if (!file) return;
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
  await refreshKnownPlusUsers();
  watchRoomPlusUsers();
  syncPlusControls();
  bindRoomUi();
  await loadRoomList();
}
window.addEventListener('forever-user-ready', event => {
  userId = event.detail.uid;
  username = event.detail.username || 'Kullanıcı';
  isPlus = Boolean(event.detail.isPlus);
  initForUser().catch(e => console.error('Rooms init',e));
});
initForUser().catch(e => console.error('Rooms init',e));
