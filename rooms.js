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
  else body='<div class="room-message-text">'+renderTextWithClickableEmojis(d.text||'')+'</div>';
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
async function loadRoomMembers(){
  const box=$('roomMembersList');if(!box||!activeRoom)return;
  box.innerHTML='<div class="empty">Üyeler yükleniyor…</div>';
  try{
    const [members,users]=await Promise.all([fetchDocs('room_members'),fetchDocs('users')]);
    const rows=members.filter(row=>row.data?.roomId===activeRoom.id);
    const ids=new Set(rows.map(row=>row.data.userId));
    const names=new Map(users.map(row=>[row.id,row.data?.username||row.data?.displayName||'Kullanıcı']));
    const source=currentMembersMode==='invite'?users.filter(row=>row.id!==userId):rows.map(row=>({id:row.data.userId,data:{username:names.get(row.data.userId)||row.data.username||'Kullanıcı'},memberData:row.data}));
    if(currentMembersMode==='invite'&&!roomModerator()){box.innerHTML='<div class="room-members-empty">Yalnızca oda yöneticisi davet gönderebilir.</div>';return;}
    box.innerHTML=source.length?source.map(row=>{
      const name=row.data?.username||row.data?.displayName||row.memberData?.username||'Kullanıcı';
      const joined=ids.has(row.id),role=row.memberData?.role==='owner'||row.id===activeRoom.data.ownerId?'Oda sahibi':(joined?'Üye':'');
      const button=currentMembersMode==='invite'?(joined?'<span class="room-member-state">Zaten üye</span>':'<button class="room-invite-action" type="button" data-invite-user="'+escapeHtml(row.id)+'" data-invite-name="'+escapeHtml(name)+'">Davet et</button>'):'<span class="room-member-state">'+escapeHtml(role)+'</span>';
      return '<div class="room-member-list-row"><div class="room-member-avatar">'+escapeHtml(name.slice(0,1).toUpperCase())+'</div><div class="room-member-list-copy"><strong>'+escapeHtml(name)+'</strong><small>'+escapeHtml(role||'Forever üyesi')+'</small></div>'+button+'</div>';
    }).join(''):'<div class="room-members-empty">Henüz üye görünmüyor.</div>';
    box.querySelectorAll('[data-invite-user]').forEach(button=>button.onclick=async()=>{
      try{const {error}=await supabaseClient.rpc('forever_invite_room_member',{p_room_id:activeRoom.id,p_target_user:button.dataset.inviteUser,p_username:button.dataset.inviteName});if(error)throw error;toast(button.dataset.inviteName+' odaya davet edildi.');await loadRoomMembers();await loadRoomMemberCount();}
      catch(e){toast(e.message||'Davet gönderilemedi.');}
    });
  }catch(e){box.innerHTML='<div class="empty">Üyeler yüklenemedi: '+escapeHtml(e.message)+'</div>';}
}
function setRoomTheme(){openRoomTheme();}
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


const ROOM_SPACE_THEMES=[
{id:'space-night',name:'Yıldızlı Gece',background:'radial-gradient(circle at 15% 20%,#29204c 0,transparent 36%),radial-gradient(circle at 80% 75%,#191d3f 0,transparent 34%),#070812'},
{id:'space-nebula',name:'Nebula',background:'radial-gradient(circle at 70% 25%,#672d8c 0,transparent 38%),radial-gradient(circle at 25% 70%,#203b68 0,transparent 36%),#10091d'},
{id:'space-galaxy',name:'Galaksi',background:'radial-gradient(circle at 35% 25%,#4a236b 0,transparent 34%),radial-gradient(circle at 80% 80%,#153a54 0,transparent 38%),#080b18'},
{id:'space-mars',name:'Mars',background:'radial-gradient(circle at 20% 20%,#813d32 0,transparent 40%),#160c0d'},
{id:'space-deep',name:'Derin Uzay',background:'radial-gradient(circle at 65% 30%,#173f63 0,transparent 40%),#050911'},
{id:'space-aurora',name:'Kutup Işıkları',background:'radial-gradient(ellipse at 25% 20%,#0e695b 0,transparent 40%),radial-gradient(ellipse at 80% 72%,#26487b 0,transparent 38%),#071117'},
{id:'space-ocean',name:'Okyanus',background:'radial-gradient(circle at 50% 0%,#155e75 0,transparent 45%),#06131d'},
{id:'space-sunset',name:'Gün Batımı',background:'radial-gradient(circle at 70% 0%,#9a4b5d 0,transparent 42%),#1b0c1e'},
{id:'space-sakura',name:'Sakura',background:'radial-gradient(circle at 20% 15%,#9d557d 0,transparent 42%),#1b0e1a'},
{id:'space-emerald',name:'Zümrüt',background:'radial-gradient(circle at 25% 20%,#0b704b 0,transparent 42%),#04150f'},
{id:'space-cyber',name:'Cyber Neon',background:'radial-gradient(circle at 80% 20%,#513b99 0,transparent 38%),radial-gradient(circle at 20% 70%,#075e65 0,transparent 38%),#070811'},
{id:'space-candy',name:'Şeker Bulutu',background:'radial-gradient(circle at 22% 20%,#754f89 0,transparent 42%),#1c1020'},
{id:'space-volcano',name:'Volkan',background:'radial-gradient(circle at 60% 100%,#803421 0,transparent 48%),#150a09'},
{id:'space-cloud',name:'Bulutların Üstü',background:'radial-gradient(circle at 50% 0%,#526b98 0,transparent 44%),#111827'},
{id:'space-midnight',name:'Gece Mavisi',background:'radial-gradient(circle at 50% 15%,#1c3d73 0,transparent 48%),#050913'},
{id:'space-prism',name:'Prizma',background:'linear-gradient(135deg,#17102c,#0b3440 50%,#35142c)'}];
const ROOM_BUBBLES=['#1f2937','#312e81','#4c1d95','#7c2d12','#134e4a','#1e3a5f','#4a044e','#172554','#3f1d2e','#3f3f46','#064e3b','#3b0764','#7f1d1d','#164e63','#713f12','#111827','#365314','#701a75','#1d4ed8','#9d174d','#0f766e','#6b21a8','#9a3412','#374151','#f8fafc','#fde68a','#bfdbfe','#fbcfe8','#bbf7d0','#e9d5ff','#fecdd3','#bae6fd','#ddd6fe','#fed7aa','#a7f3d0','#c7d2fe','#fef3c7','#f5d0fe','#cffafe','#dcfce7','#fce7f3','#e0f2fe','#fae8ff','#ffedd5','#d1fae5','#e0e7ff','#f3f4f6','#fef9c3'];
function roomThemeKey(){return 'forever_room_theme_'+encodeURIComponent(String(userId||'guest'))+'_'+encodeURIComponent(String(activeRoom?.id||'room'));}
function getRoomTheme(){try{const v=JSON.parse(localStorage.getItem(roomThemeKey())||'null');if(v&&typeof v==='object')return {space:v.space||'space-night',bubble:v.bubble||'#8b5cf6',transparent:v.transparent===true,shape:v.shape||'rounded'};}catch(_){}return {space:'space-night',bubble:'#8b5cf6',transparent:false,shape:'rounded'};}
function applyRoomTheme(){
  if(!$('roomChat'))return;const t=getRoomTheme(),space=ROOM_SPACE_THEMES.find(x=>x.id===t.space)||ROOM_SPACE_THEMES[0],c=$('roomChat');
  c.style.setProperty('--room-background',space.background);c.style.setProperty('--room-bubble',t.transparent?'rgba(139,92,246,.20)':t.bubble);
  c.style.setProperty('--room-bubble-border',t.transparent?'rgba(255,255,255,.24)':'transparent');c.style.setProperty('--room-bubble-radius',t.shape==='pill'?'28px':t.shape==='sharp'?'7px':'17px');
  c.classList.toggle('room-bubbles-transparent',t.transparent);
  document.querySelectorAll('[data-space-theme]').forEach(b=>b.classList.toggle('active',b.dataset.spaceTheme===t.space));
  document.querySelectorAll('[data-bubble-shape]').forEach(b=>b.classList.toggle('active',b.dataset.bubbleShape===t.shape));
  document.querySelectorAll('[data-bubble-color]').forEach(b=>b.classList.toggle('active',b.dataset.bubbleColor===t.bubble));
  if($('roomThemeTransparent'))$('roomThemeTransparent').checked=t.transparent;
}
function renderRoomThemePanel(){
  const grid=$('roomThemeSpaceGrid'),colors=$('roomThemeBubbleColors');
  if(grid&&!grid.children.length)grid.innerHTML=ROOM_SPACE_THEMES.map(t=>'<button type="button" class="room-theme-choice" data-space-theme="'+t.id+'"><span style="background:'+t.background+'"></span><small>'+escapeHtml(t.name)+'</small></button>').join('');
  if(colors&&!colors.children.length)colors.innerHTML=ROOM_BUBBLES.map(c=>'<button type="button" class="room-theme-swatch" data-bubble-color="'+c+'" style="background:'+c+'" title="'+c+'"></button>').join('');
  applyRoomTheme();
}
function saveRoomTheme(t){try{localStorage.setItem(roomThemeKey(),JSON.stringify(t));}catch(_){}applyRoomTheme();}
function openRoomTheme(){renderRoomThemePanel();$('roomThemeModal')?.classList.remove('hidden');}
window.closeRoomTheme=()=> $('roomThemeModal')?.classList.add('hidden');
function resetRoomTheme(){try{localStorage.removeItem(roomThemeKey());}catch(_){}renderRoomThemePanel();}
function setRoomThemeSpace(id){const t=getRoomTheme();t.space=id;saveRoomTheme(t);}
function setRoomBubbleColor(color){const t=getRoomTheme();t.bubble=color;t.transparent=false;saveRoomTheme(t);}
function setRoomBubbleShape(shape){const t=getRoomTheme();t.shape=shape;saveRoomTheme(t);}
function setRoomBubbleTransparent(on){const t=getRoomTheme();t.transparent=Boolean(on);saveRoomTheme(t);}

function renderReplyPreview(){
  let box=$('roomReplyPreview');
  if(!box){const form=$('roomMessageForm');box=document.createElement('div');box.id='roomReplyPreview';box.className='room-reply-preview hidden';form?.parentElement?.insertBefore(box,form);}
  if(!pendingReply){box.classList.add('hidden');box.innerHTML='';return;}
  box.classList.remove('hidden');box.innerHTML='<div><small>Yanıtlanan mesaj</small><strong>'+escapeHtml(pendingReply.username)+'</strong><span>'+escapeHtml(pendingReply.text)+'</span></div><button type="button" id="cancelRoomReply">×</button>';
  $('cancelRoomReply').onclick=()=>{pendingReply=null;renderReplyPreview();};
}
function openRoomMessageActions(messageId){
  selectedMessage=lastRoomMessages.get(messageId)||null;if(!selectedMessage)return;
  const d=selectedMessage.data||{};$('roomActionMessageOwner').textContent='@'+(d.username||'kullanıcı');
  $('roomActionPinBtn').classList.toggle('hidden',!roomModerator());
  $('roomActionPinBtn').textContent=activeRoom?.data?.pinnedMessageId===messageId?'Sabitlemeyi kaldır':'Mesajı sabitle';
  $('roomActionModerateBtn').classList.toggle('hidden',!roomModerator()||d.userId===userId);
  $('roomMessageActionModal').classList.remove('hidden');
}
window.closeRoomMessageActions=()=> $('roomMessageActionModal')?.classList.add('hidden');
function openRoomModeration(messageId){
  const row=lastRoomMessages.get(messageId);if(!row||!roomModerator()||row.data?.userId===userId)return;
  selectedMessage=row;$('roomModerationTarget').textContent='@'+(row.data?.username||'kullanıcı');
  const muted=(activeRoom.data?.mutedUserIds||[]).includes(row.data?.userId);
  $('roomModerationMuteBtn').innerHTML='<i class="fa-solid fa-volume-xmark"></i> '+(muted?'Susturmayı kaldır':'Kullanıcıyı sustur');
  $('roomModerationModal').classList.remove('hidden');
}
window.closeRoomModeration=()=> $('roomModerationModal')?.classList.add('hidden');
async function toggleRoomReaction(messageId,emoji){
  const old=lastRoomReactions.find(x=>x.data?.messageId===messageId&&x.data?.userId===userId&&x.data?.emoji===emoji);
  try{if(old){const {error}=await supabaseClient.from('forever_documents').delete().eq('collection_name','room_reactions').eq('id',old.id);if(error)throw error;}
  else await insertDoc('room_reactions',messageId+'_'+userId+'_'+encodeURIComponent(emoji),{roomId:activeRoom.id,messageId,userId,username,emoji,createdAt:{seconds:Math.floor(Date.now()/1000)}});
  await loadRoomMessages();}catch(e){toast(e.message||'Emoji tepkisi kaydedilemedi.');}
}
function animateFlyingEmoji(glyph){
  if(!glyph||!activeRoom)return;let layer=$('emojiChallengeLayer');
  if(!layer){layer=document.createElement('div');layer.id='emojiChallengeLayer';layer.setAttribute('aria-hidden','true');document.body.appendChild(layer);}
  const count=Math.min(42,Math.max(24,Math.floor((window.innerWidth||800)/18)));
  for(let i=0;i<count;i++){const item=document.createElement('span');item.className='emoji-challenge-float';item.textContent=glyph;item.style.left=(Math.random()*96)+'%';item.style.fontSize=(26+Math.random()*42)+'px';item.style.setProperty('--fly-duration',(2+Math.random()*1.8)+'s');item.style.setProperty('--fly-x',Math.round((Math.random()-.5)*170)+'px');item.style.setProperty('--fly-rotate',Math.round((Math.random()-.5)*90)+'deg');item.addEventListener('animationend',()=>item.remove(),{once:true});layer.appendChild(item);}
  while(layer.children.length>160)layer.firstElementChild?.remove();
}
async function emojiChallenge(glyph){
  if(!activeRoom||!isSingleEmoji(glyph))return;animateFlyingEmoji(glyph);const id=crypto.randomUUID();
  try{await insertDoc('room_messages',id,{roomId:activeRoom.id,userId,username,kind:'emoji_flight',emoji:glyph,createdAt:{seconds:Math.floor(Date.now()/1000)}});
    window.setTimeout(()=>supabaseClient.from('forever_documents').delete().eq('collection_name','room_messages').eq('id',id).then(()=>{}).catch(()=>{}),3500);
  }catch(e){toast(e.message||'Emoji animasyonu gönderilemedi.');}
}
function renderTextWithClickableEmojis(text){
  const raw=String(text||''),re=/(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*)|(?:\p{Regional_Indicator}{2})/gu;
  let html='',last=0,m;while((m=re.exec(raw))!==null){html+=escapeHtml(raw.slice(last,m.index));html+='<button type="button" class="room-inline-emoji" data-fly-emoji="'+escapeHtml(m[0])+'">'+escapeHtml(m[0])+'</button>';last=m.index+m[0].length;}return html+escapeHtml(raw.slice(last));
}
function emojiCodepointVariants(v){const full=Array.from(v).map(c=>c.codePointAt(0).toString(16)).join('-');const norm=Array.from(v.replace(/[\uFE0E\uFE0F]/gu,'')).map(c=>c.codePointAt(0).toString(16)).join('-');return [...new Set([full,norm].filter(Boolean))];}
function emojiKitchenCandidateUrls(one,two){const a=emojiCodepointVariants(one),b=emojiCodepointVariants(two),pairs=[];for(const x of a)for(const y of b)pairs.push(x+'_'+y,y+'_'+x);return [...new Set(pairs)].map(p=>'https://emojik.vercel.app/s/'+p+'?size=512');}
let emojiKitchenState={key:'',url:'',pending:Promise.resolve(null),version:0};
function findEmojiKitchenImage(urls){
  if(!urls.length)return Promise.resolve(null);
  return new Promise(resolve=>{let n=urls.length,done=false;const end=v=>{if(done)return;done=true;resolve(v);};urls.forEach(url=>{const img=new Image();img.onload=()=>end({url});img.onerror=()=>{n--;if(!n)end(null);};img.referrerPolicy='no-referrer';img.src=url;});});
}
function readOneEmoji(id){const v=($(id)?.value||'').trim();if(!v||!/\p{Extended_Pictographic}/u.test(v))return '';const n=typeof Intl.Segmenter==='function'?Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(v)).length:Array.from(v).length;return n===1?v:'';}
function drawEmojiMixPreview(){
  const box=$('emojiMixerPreview');if(!box)return;const one=readOneEmoji('emojiMixerOne')||'❔',two=readOneEmoji('emojiMixerTwo')||'❔',key=one+'\u0000'+two;
  const version=emojiKitchenState.version+1;emojiKitchenState={key,url:'',pending:Promise.resolve(null),version};box.innerHTML='';
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;canvas.className='emoji-mix-canvas';const ctx=canvas.getContext('2d');
  const bg=ctx.createRadialGradient(256,220,30,256,256,300);bg.addColorStop(0,'#6337a8');bg.addColorStop(.6,'#331b51');bg.addColorStop(1,'#140f20');ctx.fillStyle=bg;ctx.beginPath();ctx.arc(256,256,238,0,Math.PI*2);ctx.fill();
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowColor='#f0abfc';ctx.shadowBlur=24;ctx.font='250px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';ctx.fillText(one,235,244);
  ctx.beginPath();ctx.arc(356,348,88,0,Math.PI*2);ctx.fillStyle='rgba(25,12,38,.86)';ctx.fill();ctx.lineWidth=8;ctx.strokeStyle='#f0abfc';ctx.stroke();ctx.shadowBlur=18;ctx.font='128px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';ctx.fillText(two,356,348);box.appendChild(canvas);
  if(one!=='❔'&&two!=='❔'){const pending=findEmojiKitchenImage(emojiKitchenCandidateUrls(one,two));emojiKitchenState.pending=pending;pending.then(result=>{if(!result||emojiKitchenState.version!==version||emojiKitchenState.key!==key)return;emojiKitchenState.url=result.url;box.innerHTML='';const img=document.createElement('img');img.src=result.url;img.alt='Birleştirilmiş emoji';img.className='emoji-mix-result';box.appendChild(img);}).catch(()=>{});}
}
window.closeEmojiMixer=()=> $('emojiMixerModal')?.classList.add('hidden');
function openEmojiMixer(){if(!activeRoom)return toast('Önce bir odaya gir.');if(!isPlus)return toast('İki emojiyi birleştirme yalnızca Plus üyelerine açıktır. 🔒');$('emojiMixerModal')?.classList.remove('hidden');drawEmojiMixPreview();}
async function sendEmojiMixToRoom(){
  if(!isPlus)return toast('Emoji birleştirme Plus özelliğidir. 🔒');const one=readOneEmoji('emojiMixerOne'),two=readOneEmoji('emojiMixerTwo');if(!one||!two)return toast('İki kutuya da birer emoji girmelisin.');
  try{const key=one+'\u0000'+two;let result=emojiKitchenState.key===key?await emojiKitchenState.pending:null;
    if(result?.url&&emojiKitchenState.key===key)await sendRoomMessage({kind:'emoji_mix',stickerUrl:result.url,emojiOne:one,emojiTwo:two,text:one+' + '+two});
    else{let canvas=$('emojiMixerPreview')?.querySelector('canvas');if(!canvas){drawEmojiMixPreview();canvas=$('emojiMixerPreview')?.querySelector('canvas');}if(!canvas)throw new Error('Emoji önizlemesi hazırlanamadı.');const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Emoji görseli üretilemedi.');const file=new File([blob],'emoji-mix.png',{type:'image/png'});const url=await uploadRoomAsset(file,'emoji-mixes');await sendRoomMessage({kind:'emoji_mix',stickerUrl:url,emojiOne:one,emojiTwo:two,text:one+' + '+two});}
    window.closeEmojiMixer();toast('Emoji birleşimi odada paylaşıldı ✨');
  }catch(e){toast(e.message||'Emoji birleştirilemedi.');}
}
async function submitRoomReport(type){
  if(!selectedMessage||!activeRoom)return;const d=selectedMessage.data||{};
  try{await insertDoc('reports',crypto.randomUUID(),{reporterId:userId,targetUserId:d.userId,targetId:selectedMessage.id,type:'room_message',roomId:activeRoom.id,roomName:activeRoom.name,reason:(d.text||d.emoji||'Oda mesajı').slice(0,400),reportType:type,status:'open',createdAt:{seconds:Math.floor(Date.now()/1000)}});
    $('roomReportTypeModal')?.classList.add('hidden');window.closeRoomModeration?.();window.closeRoomMessageActions?.();toast('Şikâyet yönetim ekibine iletildi.');
  }catch(e){toast(e.message||'Şikâyet iletilemedi.');}
}
async function loadAuraAdminReports(){
  const box=$('adminReportsList');if(!box)return;if(!isAppAdmin){box.innerHTML='<div class="empty">Bu alan yalnızca sistem yöneticilerine açıktır.</div>';return;}
  box.innerHTML='<div class="empty">Şikâyetler yükleniyor…</div>';
  try{const rows=(await fetchDocs('reports')).sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
    box.innerHTML=rows.length?rows.map(row=>{const d=row.data||{};return '<article class="admin-report-card"><div class="admin-report-head"><strong>'+escapeHtml(d.reportType==='minor_under_15'?'15 yaşından küçük bildirimi':'Üye şikâyeti')+'</strong><span>'+escapeHtml(d.status||'open')+'</span></div><p><b>Oda:</b> '+escapeHtml(d.roomName||d.roomId||'—')+'</p><p><b>Şikâyet edilen:</b> '+escapeHtml(d.targetUserId||'—')+'</p><p><b>Mesaj:</b> '+escapeHtml(d.reason||'—')+'</p><p><b>Bildiren:</b> '+escapeHtml(d.reporterId||'—')+'</p><button type="button" class="btn btn-ghost" data-report-reviewed="'+escapeHtml(row.id)+'">İncelendi olarak işaretle</button></article>';}).join(''):'<div class="empty">Bekleyen şikâyet yok.</div>';
    box.querySelectorAll('[data-report-reviewed]').forEach(btn=>btn.onclick=async()=>{const row=rows.find(x=>x.id===btn.dataset.reportReviewed);if(!row)return;const data=Object.assign({},row.data,{status:'reviewed',reviewedAt:new Date().toISOString()});const {error}=await supabaseClient.from('forever_documents').update({data,updated_at:new Date().toISOString()}).eq('collection_name','reports').eq('id',row.id);if(error)toast(error.message);else{toast('Şikâyet incelendi.');loadAuraAdminReports();}});
  }catch(e){box.innerHTML='<div class="empty">Şikâyetler yüklenemedi: '+escapeHtml(e.message)+'</div>';}
}
window.loadAuraAdminReports=loadAuraAdminReports;

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
function bindRoomUi(){
  if(roomUiBound)return;
  roomUiBound=true;
  document.querySelectorAll('[data-room-tab]').forEach(button=>button.addEventListener('click',()=>switchRoomTab(button.dataset.roomTab)));
  $('refreshRoomListBtn').onclick=loadRoomList;
  document.querySelectorAll('[data-password-toggle]').forEach(button=>button.onclick=()=>{
    const input=$(button.dataset.passwordToggle);if(!input)return;
    input.type=input.type==='password'?'text':'password';
    button.innerHTML=input.type==='password'?'<i class="fa-regular fa-eye"></i>':'<i class="fa-regular fa-eye-slash"></i>';
  });

  $('joinRoomForm').onsubmit=async event=>{
    event.preventDefault();
    const name=$('joinRoomName').value.trim(),password=$('joinRoomPass').value;
    if(!name||!password)return toast('Oda adı ve şifre zorunludur.');
    try{
      const {data,error}=await supabaseClient.rpc('forever_join_room',{p_room_name:name,p_password:password,p_username:username});
      if(error)throw error;
      const room=await supabaseClient.from('forever_documents').select('data').eq('collection_name','rooms').eq('id',data).single();
      if(room.error)throw room.error;
      $('joinRoomName').value='';$('joinRoomPass').value='';
      await loadRoomList();
      await openRoom(data,room.data.data?.name||name,room.data.data||{});
    }catch(e){toast(e.message||'Odaya girilemedi. Oda adı veya şifre hatalı olabilir.');}
  };

  $('createRoomForm').onsubmit=async event=>{
    event.preventDefault();
    const name=$('newRoomName').value.trim(),password=$('newRoomPass').value;
    if(!name||!password)return toast('Oda adı ve şifre zorunludur.');
    try{
      const id=crypto.randomUUID();
      const {data,error}=await supabaseClient.rpc('forever_create_room',{
        p_room_id:id,p_room_name:name,p_password:password,p_username:username,
        p_features:{drawing:$('newRoomDrawingEnabled').checked,stickers:$('newRoomStickersEnabled').checked}
      });
      if(error)throw error;
      $('newRoomName').value='';$('newRoomPass').value='';
      switchRoomTab('join');
      const room=await supabaseClient.from('forever_documents').select('data').eq('collection_name','rooms').eq('id',data).single();
      if(room.error)throw room.error;
      await loadRoomList();await openRoom(data,room.data.data?.name||name,room.data.data||{});
      toast('Odan oluşturuldu. Oda adı ve şifresini yalnızca güvendiğin kişilerle paylaş.');
    }catch(e){toast(e.message||'Oda oluşturulamadı.');}
  };

  $('leaveRoomBtn').onclick=leaveActiveRoom;
  $('roomDeleteBtn').onclick=deleteActiveRoom;
  $('roomPrivateBtn').onclick=toggleRoomPrivacy;
  $('roomSendLockBtn').onclick=toggleRoomMessageLock;
  $('roomThemeBtn').onclick=openRoomTheme;
  $('roomInviteBtn').onclick=()=>openRoomMembers('invite');
  $('roomMembersBtn').onclick=()=>openRoomMembers('members');
  $('roomComposerPlusBtn').onclick=()=>$('roomComposerMenu').classList.toggle('hidden');
  $('roomMixerBtn').onclick=()=>{$('roomComposerMenu').classList.add('hidden');openEmojiMixer();};
  $('roomBaiBtn').onclick=()=>{
    $('roomComposerMenu').classList.add('hidden');
    if(!isPlus)return toast('BAI yalnızca Plus üyelerine açıktır. 🔒');
    toast('BAI servisi bu Forever projesine henüz bağlanmadı. Bağlantı kurulmadan çalışıyor gösterilmeyecek.');
  };

  $('roomMessageForm').onsubmit=event=>{
    event.preventDefault();const value=$('roomMessageText').value.trim();
    if(value)sendRoomMessage({kind:'text',text:value});
  };
  $('roomMessageText').addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('roomMessageForm').requestSubmit();}
  });
  $('roomMessageText').addEventListener('input',event=>{
    const input=event.target;input.style.height='auto';input.style.height=Math.min(input.scrollHeight,120)+'px';
  });

  $('openStickersBtn').onclick=()=>{
    if(!isPlus)return toast('Yeni animasyonlu çıkartmalar Plus üyelerine özel. 🔒');
    if(activeRoom?.data?.features?.stickers===false)return toast('Bu odada çıkartmalar kapalı.');
    $('stickerTray').classList.toggle('hidden');
  };
  $('stickerTray').querySelectorAll('[data-animated-sticker]').forEach(button=>button.onclick=()=>{
    if(!isPlus)return toast('Animasyonlu çıkartmalar Plus üyelerine özel. 🔒');
    sendRoomMessage({kind:'animated_sticker',stickerId:button.dataset.animatedSticker,emoji:button.dataset.emoji,text:button.dataset.emoji});
  });
  $('toggleDrawingBtn').onclick=()=>{
    $('roomComposerMenu').classList.add('hidden');
    if(!isPlus)return toast('Oda çizimi Plus özelliğidir. 🔒');
    if(activeRoom?.data?.features?.drawing===false)return toast('Bu odada çizim kapalı.');
    $('drawingBox').classList.toggle('hidden');
  };

  $('emojiMixerOne').addEventListener('input',drawEmojiMixPreview);
  $('emojiMixerTwo').addEventListener('input',drawEmojiMixPreview);
  $('emojiMixerSendBtn').onclick=sendEmojiMixToRoom;
  $('roomThemeResetBtn').onclick=resetRoomTheme;
  $('roomThemeTransparent').onchange=event=>setRoomBubbleTransparent(event.target.checked);
  $('roomThemeSpaceGrid').addEventListener('click',event=>{
    const button=event.target.closest('[data-space-theme]');if(button)setRoomThemeSpace(button.dataset.spaceTheme);
  });
  $('roomThemeBubbleColors').addEventListener('click',event=>{
    const button=event.target.closest('[data-bubble-color]');if(button)setRoomBubbleColor(button.dataset.bubbleColor);
  });
  document.querySelectorAll('[data-bubble-shape]').forEach(button=>button.onclick=()=>setRoomBubbleShape(button.dataset.bubbleShape));

  $('roomActionCopyBtn').onclick=async()=>{
    if(!selectedMessage)return;
    const d=selectedMessage.data||{},value=d.text||d.emoji||d.emojiOne+' + '+d.emojiTwo||d.sticker||'';
    try{await navigator.clipboard.writeText(value);toast('Mesaj kopyalandı.');}
    catch(_){const area=document.createElement('textarea');area.value=value;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();toast('Mesaj kopyalandı.');}
    window.closeRoomMessageActions();
  };
  $('roomActionReplyBtn').onclick=()=>{
    if(!selectedMessage)return;
    const d=selectedMessage.data||{};
    pendingReply={id:selectedMessage.id,username:d.username||'Kullanıcı',text:d.text||d.emoji||'Emoji birleşimi'};
    renderReplyPreview();window.closeRoomMessageActions();$('roomMessageText').focus();
  };
  $('roomActionPinBtn').onclick=async()=>{if(selectedMessage)await pinMessage(selectedMessage.id);window.closeRoomMessageActions();};
  $('roomActionModerateBtn').onclick=()=>{if(!selectedMessage)return;const id=selectedMessage.id;window.closeRoomMessageActions();openRoomModeration(id);};
  $('roomQuickReactions').querySelectorAll('[data-quick-reaction]').forEach(button=>button.onclick=()=>{
    if(!selectedMessage)return;toggleRoomReaction(selectedMessage.id,button.dataset.quickReaction);window.closeRoomMessageActions();
  });
  $('roomModerationMuteBtn').onclick=async()=>{
    if(!selectedMessage)return;const target=selectedMessage.data?.userId;
    const muted=(activeRoom.data?.mutedUserIds||[]).includes(target);
    await moderateRoom(muted?'unmute':'mute',null,target);window.closeRoomModeration();
  };
  $('roomModerationDeleteBtn').onclick=async()=>{
    if(!selectedMessage)return;await moderateRoom('delete_message',selectedMessage.id);window.closeRoomModeration();
  };
  $('roomModerationReportBtn').onclick=()=>{
    $('roomModerationModal').classList.add('hidden');$('roomReportTypeModal').classList.remove('hidden');
  };
  $('roomReportMinorBtn').onclick=()=>submitRoomReport('minor_under_15');
  $('roomReportGeneralBtn').onclick=()=>submitRoomReport('general');
  window.closeRoomReportTypes=()=>{$('roomReportTypeModal')?.classList.add('hidden');selectedMessage=null;};
  $('adminRefreshReports').onclick=loadAuraAdminReports;
  setupCanvas();
}
async function initForUser(){
  const result=await supabaseClient.auth.getSession();session=result.data.session;
  if(!session?.user){isAppAdmin=false;return;}
  userId=session.user.id;
  const [profile,plus,admin]=await Promise.all([
    supabaseClient.from('forever_documents').select('data').eq('collection_name','users').eq('id',userId).maybeSingle(),
    supabaseClient.rpc('is_forever_plus'),
    supabaseClient.rpc('is_forever_admin')
  ]);
  if(profile.error)return;
  username=profile.data?.data?.username||session.user.user_metadata?.name||'Kullanıcı';
  isPlus=Boolean(plus.data);
  isAppAdmin=!admin.error&&admin.data===true;
  window.foreverIsAdmin=isAppAdmin;
  document.querySelectorAll('.admin-nav').forEach(node=>node.classList.toggle('hidden',!isAppAdmin));
  await refreshKnownPlusUsers();watchRoomPlusUsers();syncPlusControls();bindRoomUi();await loadRoomList();
}
window.addEventListener('forever-user-ready',event=>{
  userId=event.detail.uid;username=event.detail.username||'Kullanıcı';isPlus=Boolean(event.detail.isPlus);
  initForUser().catch(error=>console.error('Rooms init',error));
});
initForUser().catch(error=>console.error('Rooms init',error));
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
