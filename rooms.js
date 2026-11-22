import { supabaseClient } from './supabase-compat.js';

const $ = id => document.getElementById(id);
let session = null, userId = null, username = '', isPlus = false, activeRoom = null, roomChannel = null;
let knownPlusUserIds = new Set(), plusUsersChannel = null;
let drawingDirty = false, roomUiBound = false, currentMembersMode = 'members';
let isAppAdmin = false, selectedMessage = null, pendingReply = null, longPressTimer = null;
let lastRoomMessages = new Map(), lastRoomReactions = [];

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
  return plus ? '<span class="forever-badges"><span class="forever-emerald" title="Zümrüt Plus rozeti"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7 8 3h8l4 4-8 14L4 7Z" fill="#087f45" stroke="#34d399" stroke-width="1.1"/><path d="M4 7h16L12 21 4 7Z" fill="#10b981"/><path d="M8 3 9.5 7 12 21 4 7 8 3Z" fill="#064e3b"/><path d="M16 3 14.5 7 12 21 20 7 16 3Z" fill="#6ee7b7"/><path d="M8 3h8l-1.5 4h-5L8 3Z" fill="#a7f3d0"/></svg></span><span class="forever-verified">✓</span></span>' : '';
}
function roomOwner(){return Boolean(activeRoom?.data?.ownerId===userId);}
function roomModerator(){return Boolean(roomOwner()||isAppAdmin||(activeRoom?.data?.adminIds||[]).includes(userId));}
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
function syncPlusControls(){
  const label=$('roomPlanLabel');if(label)label.textContent=isPlus?'✦ Plus: oda sınırı yok':'Ücretsiz: en fazla 3 oda';
  const features=activeRoom?.data?.features||{},stickersEnabled=features.stickers!==false,drawingEnabled=features.drawing!==false;
  if($('openStickersBtn'))$('openStickersBtn').disabled=!isPlus||!stickersEnabled;
  if($('toggleDrawingBtn'))$('toggleDrawingBtn').disabled=!isPlus||!drawingEnabled;
  if($('stickerLock'))$('stickerLock').textContent=isPlus?'':'🔒 Plus';
  if($('drawingLock'))$('drawingLock').textContent=isPlus?'':'🔒 Plus';
  if(!isPlus||!drawingEnabled)$('drawingBox')?.classList.add('hidden');
  if(!isPlus||!stickersEnabled)$('stickerTray')?.classList.add('hidden');
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

async function loadRoomList(){
  if(!userId)return;const list=$('roomList');if(!list)return;
  list.innerHTML='<div class="empty">Kayıtlı odaların yükleniyor…</div>';
  try{
    const [rooms,memberships]=await Promise.all([fetchDocs('rooms'),currentMemberships()]);
    const savedIds=new Set(memberships.map(row=>row.data?.roomId).filter(Boolean));
    const saved=rooms.filter(room=>savedIds.has(room.id)).sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
    if($('roomPlanLabel'))$('roomPlanLabel').textContent=isPlus?'✦ Plus: oda sınırı yok':'Ücretsiz: en fazla 3 oda';
    list.innerHTML=saved.length?saved.map(room=>{
      const d=room.data||{};
      return '<article class="room-list-item"><div class="room-list-icon"><i class="fa-solid fa-hashtag"></i></div><div class="room-list-copy"><strong>'+escapeHtml(d.name||'Adsız oda')+'</strong><small>'+(d.ownerId===userId?'Oda sahibi sensin':'Kayıtlı odan')+'</small></div><button type="button" class="room-list-open" data-room-open="'+escapeHtml(room.id)+'">Odaya Gir</button></article>';
    }).join(''):'<div class="room-empty-state"><i class="fa-regular fa-comments"></i><strong>Henüz kayıtlı odan yok</strong><span>Oda adı ve şifresini girerek katılabilirsin.</span></div>';
    list.querySelectorAll('[data-room-open]').forEach(btn=>btn.onclick=async()=>{const room=saved.find(x=>x.id===btn.dataset.roomOpen);if(room)await openRoom(room.id,room.data?.name||'Oda',room.data||{});});
  }catch(e){list.innerHTML='<div class="empty">Kayıtlı odalar yüklenemedi: '+escapeHtml(e.message)+'</div>';}
}
function isSingleEmoji(value){
  const text=String(value||'').trim();if(!text||!/\p{Extended_Pictographic}/u.test(text))return false;
  return typeof Intl.Segmenter==='function'?Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)).length===1:Array.from(text).length<=4;
}
function renderMessage(row){
  const d=row.data||{},mine=d.userId===userId;let body='';
  if(d.kind==='animated_sticker')body='<div class="room-animated-sticker sticker-'+escapeHtml(d.stickerId||'sparkle')+'">'+escapeHtml(d.emoji||'✨')+'</div>';
  else if((d.kind==='emoji_mix'||d.kind==='custom_sticker'||d.kind==='sticker')&&d.stickerUrl){const url=safeMediaUrl(d.stickerUrl);body=url?'<img class="room-message-media '+(d.kind==='emoji_mix'?'room-emoji-mix':'')+'" src="'+url+'" alt="Görsel">':'<div>Görsel</div>';}
  else if(d.kind==='drawing'&&d.drawingUrl){const url=safeMediaUrl(d.drawingUrl);body=url?'<img class="room-message-media room-drawing-media" src="'+url+'" alt="Oda çizimi">':'<div>Çizim</div>';}
  else if(isSingleEmoji(d.text))body='<button type="button" class="room-single-emoji" data-fly-emoji="'+escapeHtml(d.text.trim())+'">'+escapeHtml(d.text.trim())+'</button>';
  else body='<div class="room-message-text">'+escapeHtml(d.text||'')+'</div>';
  const time=row.created_at?new Date(row.created_at).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'}):'';
  const meta='<div class="room-message-meta"><span class="room-message-author">'+escapeHtml(d.username||'kullanıcı')+'</span>'+plusBadge(knownPlusUserIds.has(d.userId))+(d.pinned?'<span class="room-pinned-label">📌 Sabit</span>':'')+'<time>'+time+'</time><button type="button" class="room-message-menu-btn" data-message-menu="'+escapeHtml(row.id)+'">•••</button></div>';
  const reply=d.replyTo?'<div class="room-reply-quote"><strong>'+escapeHtml(d.replyTo.username||'Yanıtlanan mesaj')+'</strong><span>'+escapeHtml(d.replyTo.text||'Mesaj')+'</span></div>':'';
  const groups=new Map();lastRoomReactions.filter(x=>x.data?.messageId===row.id).forEach(x=>{const e=x.data?.emoji;if(e)groups.set(e,(groups.get(e)||0)+1);});
  const reactions=groups.size?'<div class="room-reaction-list">'+[...groups].map(([emoji,count])=>'<button type="button" data-react="'+escapeHtml(emoji)+'" data-react-message="'+escapeHtml(row.id)+'">'+escapeHtml(emoji)+' <span>'+count+'</span></button>').join('')+'</div>':'';
  return '<article class="room-message-row '+(mine?'mine':'others')+(d.pinned?' is-pinned':'')+'" data-message-card="'+escapeHtml(row.id)+'"><div class="room-message-card">'+meta+'<div class="room-message-bubble">'+reply+body+'</div><div class="room-message-footer">'+reactions+'<button type="button" class="room-add-reaction" data-message-menu="'+escapeHtml(row.id)+'"><i class="fa-regular fa-face-smile"></i></button></div></div></article>';
}
async function loadRoomMessages(){
  if(!activeRoom)return;const box=$('roomMessages');if(!box)return;
  const [messageResult,blocks,reactions]=await Promise.all([
    supabaseClient.from('forever_documents').select('id,data,created_at').eq('collection_name','room_messages').contains('data',{roomId:activeRoom.id}).order('created_at',{ascending:true}).limit(180),
    fetchDocs('blocks'),fetchDocs('room_reactions')
  ]);
  if(messageResult.error){box.innerHTML='<div class="empty">Mesajlar yüklenemedi: '+escapeHtml(messageResult.error.message)+'</div>';return;}
  const blocked=new Set((blocks||[]).filter(x=>x.data?.blockerId===userId).map(x=>x.data?.blockedId));
  const rows=(messageResult.data||[]).filter(row=>!blocked.has(row.data?.userId)&&row.data?.kind!=='emoji_flight');
  lastRoomMessages=new Map(rows.map(row=>[row.id,row]));lastRoomReactions=(reactions||[]).filter(row=>row.data?.roomId===activeRoom.id);
  if(!rows.length)box.innerHTML='<div class="room-chat-empty"><i class="fa-regular fa-comments"></i><strong>Henüz mesaj yok</strong><span>İlk mesajı sen gönder!</span></div>';
  else{let lastDate='';box.innerHTML=rows.map(row=>{const date=row.created_at?new Date(row.created_at):null,key=date?date.toLocaleDateString('tr-TR'):'';const sep=key&&key!==lastDate?'<div class="room-date-separator"><span>'+escapeHtml(date.toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric',weekday:'long'}))+'</span></div>':'';lastDate=key||lastDate;return sep+renderMessage(row);}).join('');}
  box.scrollTop=box.scrollHeight;
  box.querySelectorAll('[data-message-menu]').forEach(btn=>btn.onclick=()=>openRoomMessageActions(btn.dataset.messageMenu));
  box.querySelectorAll('[data-react]').forEach(btn=>btn.onclick=()=>toggleRoomReaction(btn.dataset.reactMessage,btn.dataset.react));
  box.querySelectorAll('[data-fly-emoji]').forEach(btn=>btn.onclick=()=>emojiChallenge(btn.dataset.flyEmoji));
  box.querySelectorAll('[data-message-card]').forEach(card=>{
    card.addEventListener('pointerdown',()=>{clearTimeout(longPressTimer);if(roomModerator())longPressTimer=setTimeout(()=>openRoomModeration(card.dataset.messageCard),520);});
    ['pointerup','pointerleave','pointercancel'].forEach(ev=>card.addEventListener(ev,()=>clearTimeout(longPressTimer)));
    card.addEventListener('contextmenu',ev=>{if(roomModerator()){ev.preventDefault();openRoomModeration(card.dataset.messageCard);}});
  });
  const pinId=activeRoom.data?.pinnedMessageId,pinned=pinId?lastRoomMessages.get(pinId):null;
  $('roomPinnedBar')?.classList.toggle('hidden',!pinned);if(pinned)$('roomPinnedText').textContent=(pinned.data?.username||'Üye')+': '+(pinned.data?.text||'Mesaj');
  if($('roomUnpinBtn'))$('roomUnpinBtn').onclick=()=>moderateRoom('unpin');
}
async function updateActiveRoomSettings(patch){
  if(!activeRoom||!roomModerator())throw new Error('Bu ayarı yalnızca oda yöneticisi değiştirebilir.');
  const {data,error}=await supabaseClient.rpc('forever_update_room_settings',{
    p_room_id:activeRoom.id,
    p_is_private:Object.prototype.hasOwnProperty.call(patch,'isPrivate')?Boolean(patch.isPrivate):null,
    p_messages_locked:Object.prototype.hasOwnProperty.call(patch,'messagesLocked')?Boolean(patch.messagesLocked):null,
    p_theme:Object.prototype.hasOwnProperty.call(patch,'theme')?String(patch.theme):null
  });
  if(error)throw error;activeRoom.data=data||Object.assign({},activeRoom.data,patch);syncRoomControls();syncPlusControls();await loadRoomList();
}
function syncRoomControls(){
  if(!activeRoom)return;const owner=roomModerator(),muted=(activeRoom.data.mutedUserIds||[]).includes(userId);
  const p=$('roomPrivateBtn'),l=$('roomSendLockBtn');
  if(p){p.innerHTML=activeRoom.data.isPrivate?'<i class="fa-solid fa-lock"></i>':'<i class="fa-solid fa-lock-open"></i>';p.title=activeRoom.data.isPrivate?'Şifreli oda':'Açık oda';p.disabled=!owner;}
  if(l){l.innerHTML=activeRoom.data.messagesLocked?'<i class="fa-solid fa-lock"></i>':'<i class="fa-solid fa-lock-open"></i>';l.title=activeRoom.data.messagesLocked?'Mesaj gönderme kilitli':'Mesaj gönderme açık';l.disabled=!owner;}
  if($('roomDeleteBtn'))$('roomDeleteBtn').hidden=!roomOwner()&&!isAppAdmin;
  const locked=Boolean((activeRoom.data.messagesLocked&&!owner)||muted);
  if($('roomMessageText')){$('roomMessageText').disabled=locked;$('roomMessageText').placeholder=muted?'Bu odada mesaj gönderme iznin yok.':locked?'Oda sahibi mesaj göndermeyi kilitledi.':'Mesaj yazın...';}
  if($('sendRoomMessageBtn'))$('sendRoomMessageBtn').disabled=locked;
  if($('roomStatusLine'))$('roomStatusLine').textContent=(activeRoom.data.isPrivate?'🔒 Şifreli oda':'Açık oda')+(activeRoom.data.messagesLocked?' · Mesaj gönderme kilitli':' · Sohbet açık')+(muted?' · Susturuldun':'');
}
async function loadRoomMemberCount() {
  if (!activeRoom) return;
  try {
    const rows = await fetchDocs('room_members');
    const count = rows.filter(row => row.data?.roomId === activeRoom.id).length;
    if ($('roomChatMemberCount')) $('roomChatMemberCount').textContent = count ? '· ' + count + ' üye' : '';
  } catch (_) {}
}
async function openRoom(id,name,data){
  activeRoom={id,name,data:Object.assign({},data||{})};$('roomSelectionArea')?.classList.add('hidden');$('roomChat')?.classList.remove('hidden');
  $('roomChatTitle').textContent=name;document.body.classList.add('room-chat-open');
  applyRoomTheme();renderRoomThemePanel();syncPlusControls();syncRoomControls();
  await Promise.all([loadRoomMessages(),loadRoomMemberCount()]);
  if(roomChannel)await supabaseClient.removeChannel(roomChannel);
  roomChannel=supabaseClient.channel('forever-room-'+id)
    .on('postgres_changes',{event:'*',schema:'public',table:'forever_documents',filter:'collection_name=eq.room_messages'},payload=>{
      const row=payload.new;
      if(row?.data?.roomId===activeRoom?.id){if(row.data.kind==='emoji_flight'&&row.data.userId!==userId)animateFlyingEmoji(row.data.emoji);else if(row.data.kind!=='emoji_flight')loadRoomMessages();}
      else if(payload.old?.data?.roomId===activeRoom?.id)loadRoomMessages();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'forever_documents',filter:'collection_name=eq.room_members'},()=>loadRoomMemberCount())
    .on('postgres_changes',{event:'*',schema:'public',table:'forever_documents',filter:'collection_name=eq.rooms'},payload=>{
      if(payload.new?.id===activeRoom?.id&&payload.new?.data){activeRoom.data=payload.new.data;syncRoomControls();syncPlusControls();}
    }).subscribe();
}
async function sendRoomMessage(payload){
  if(!activeRoom||!userId)return;
  if(activeRoom.data.messagesLocked&&!roomModerator())return toast('Bu odada mesaj gönderme geçici olarak kilitlendi.');
  if((activeRoom.data.mutedUserIds||[]).includes(userId))return toast('Bu odada mesaj gönderme iznin yok.');
  if(['animated_sticker','emoji_mix'].includes(payload.kind)&&!isPlus)return toast('Bu özellik yalnızca Plus üyelerine açık. 🔒');
  const data=Object.assign({roomId:activeRoom.id,userId,username,isPlus,createdAt:{seconds:Math.floor(Date.now()/1000)}},payload);
  if(pendingReply)data.replyTo={id:pendingReply.id,username:pendingReply.username,text:pendingReply.text.slice(0,160)};
  try{await insertDoc('room_messages',crypto.randomUUID(),data);if(payload.kind==='text'){$('roomMessageText').value='';$('roomMessageText').style.height='auto';}pendingReply=null;renderReplyPreview();await loadRoomMessages();}
  catch(e){toast(e.message||'Mesaj gönderilemedi.');}
}
async function pinMessage(id){if(!roomModerator())return toast('Mesaj sabitlemek için oda yöneticisi olmalısın.');await moderateRoom(activeRoom?.data?.pinnedMessageId===id?'unpin':'pin',id);}
async function moderateRoom(action,messageId=null,targetUser=null){
  if(!activeRoom||!roomModerator())return toast('Bu işlem oda yönetimi yetkisi gerektirir.');
  try{
    const {error}=await supabaseClient.rpc('forever_moderate_room',{p_room_id:activeRoom.id,p_action:action,p_message_id:messageId,p_target_user:targetUser});
    if(error)throw error;if(action==='delete_room'){await closeActiveRoom();toast('Oda silindi.');return;}
    const room=await supabaseClient.from('forever_documents').select('data').eq('collection_name','rooms').eq('id',activeRoom.id).single();
    if(room.data?.data)activeRoom.data=room.data.data;await loadRoomMessages();syncRoomControls();
    toast(action==='mute'?'Kullanıcı susturuldu.':action==='unmute'?'Susturma kaldırıldı.':action==='delete_message'?'Mesaj herkesten silindi.':action==='pin'?'Mesaj sabitlendi.':'Sabitleme kaldırıldı.');
  }catch(e){toast(e.message||'Yönetim işlemi tamamlanamadı.');}
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
async function deleteActiveRoom(){
  if(!activeRoom||(!roomOwner()&&!isAppAdmin))return toast('Odayı yalnızca oda sahibi silebilir.');
  if(!confirm('Bu odayı ve içindeki mesajları silmek istediğine emin misin?'))return;await moderateRoom('delete_room');
}
async function leaveActiveRoom(){
  if(!activeRoom)return;
  try{const {error}=await supabaseClient.rpc('forever_leave_room',{p_room_id:activeRoom.id});if(error)throw error;await closeActiveRoom();toast('Kayıtlı oda listesine döndün.');}
  catch(e){toast(e.message||'Odadan ayrılamadın.');}
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
  $('leaveRoomBtn').onclick = leaveActiveRoom;
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
