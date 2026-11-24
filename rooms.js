import { supabaseClient } from './supabase-compat.js';

const $ = id => document.getElementById(id);
let session = null, userId = null, username = '', isPlus = false, activeRoom = null, roomChannel = null;
let plusUserIds = new Set(), plusUsersChannel = null;
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
function roomOwner(){return Boolean(activeRoom?.data?.ownerId===userId);}
function roomModerator(){return Boolean(roomOwner()||isAppAdmin||(activeRoom?.data?.adminIds||[]).includes(userId));}
function roomPlusBadge(active){return active?'<span class="forever-plus-badges" title="Forever Süper Plus · Doğrulanmış hesap" style="display:inline-flex;align-items:center;gap:3px;margin-left:4px;vertical-align:middle;"><i class="fa-solid fa-gem" style="color:#b99aff;font-size:.78em;"></i><span style="display:inline-grid;place-items:center;width:13px;height:13px;border-radius:50%;background:#2684ff;color:white;font-size:9px;font-weight:900;">✓</span></span>':'';}
async function refreshRoomPlusUsers(){
 const {data,error}=await supabaseClient.from('forever_plus_members').select('user_id');
 if(error)throw error;
 plusUserIds=new Set((data||[]).map(row=>String(row.user_id)));
 const mine=await supabaseClient.rpc('is_forever_plus');
 if(!mine.error){isPlus=Boolean(mine.data);window.foreverIsPlus=isPlus;syncRoomFeatureControls();}
 if(activeRoom)await loadRoomMessages();
}
function watchRoomPlusUsers(){
 if(plusUsersChannel)return;
 plusUsersChannel=supabaseClient.channel('forever-plus-room-badges')
  .on('postgres_changes',{event:'*',schema:'public',table:'forever_plus_members'},()=>refreshRoomPlusUsers().catch(error=>console.warn('Plus rozetleri yenilenemedi:',error)))
  .subscribe();
}
async function fetchDocs(collectionName) {
  const { data, error } = await supabaseClient.from('forever_documents')
    .select('id,data,owner_id,created_at').eq('collection_name', collectionName)
    .order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  return data || [];
}
function syncRoomFeatureControls(){
  const label=$('roomPlanLabel');if(label)label.textContent=isPlus?'💎 Süper Plus · 3 oda sınırı':'En fazla 3 oda';
  const features=activeRoom?.data?.features||{},stickersEnabled=features.stickers!==false,drawingEnabled=features.drawing!==false;
  if($('openStickersBtn'))$('openStickersBtn').disabled=!isPlus||!stickersEnabled;
  if($('toggleDrawingBtn'))$('toggleDrawingBtn').disabled=!drawingEnabled;
  if($('stickerLock'))$('stickerLock').textContent=isPlus?'Özel animasyonlar aktif':'🔒 Süper Plus';
  if(!drawingEnabled)$('drawingBox')?.classList.add('hidden');
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
    if($('roomPlanLabel'))$('roomPlanLabel').textContent='En fazla 3 oda';
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
  const meta='<div class="room-message-meta"><span class="room-message-author">'+escapeHtml(d.username||'kullanıcı')+'</span>'+roomPlusBadge(plusUserIds.has(String(d.userId)))+(d.pinned?'<span class="room-pinned-label">📌 Sabit</span>':'')+'<time>'+time+'</time><button type="button" class="room-message-menu-btn" data-message-menu="'+escapeHtml(row.id)+'">•••</button></div>';
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
  if(error)throw error;activeRoom.data=data||Object.assign({},activeRoom.data,patch);syncRoomControls();syncRoomFeatureControls();await loadRoomList();
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
  applyRoomTheme();renderRoomThemePanel();syncRoomFeatureControls();syncRoomControls();
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
      if(payload.new?.id===activeRoom?.id&&payload.new?.data){activeRoom.data=payload.new.data;syncRoomControls();syncRoomFeatureControls();}
    }).subscribe();
}
async function sendRoomMessage(payload){
  if(!activeRoom||!userId)return;
  if(['animated_sticker','custom_sticker','sticker','emoji_mix','emoji_flight'].includes(payload.kind)&&!isPlus)return toast('Bu animasyonlu özellik Süper Plus ayrıcalığıdır. 💎');
  if(activeRoom.data.messagesLocked&&!roomModerator())return toast('Bu odada mesaj gönderme geçici olarak kilitlendi.');
  if((activeRoom.data.mutedUserIds||[]).includes(userId))return toast('Bu odada mesaj gönderme iznin yok.');
  const data=Object.assign({roomId:activeRoom.id,userId,username,createdAt:{seconds:Math.floor(Date.now()/1000)}},payload);
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
    toast(action==='mute'?'Kullanıcının mesaj göndermesi engellendi.':action==='unmute'?'Susturma kaldırıldı.':action==='delete_message'?'Mesaj herkesten silindi.':action==='pin'?'Mesaj sabitlendi.':'Sabitleme kaldırıldı.');
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
    const source=currentMembersMode==='invite'
      ?users.filter(row=>row.id!==userId)
      :rows.map(row=>({id:row.data.userId,data:{username:names.get(row.data.userId)||row.data.username||'Kullanıcı'},memberData:row.data}));
    const canGrantRoomAdmin=roomOwner()||isAppAdmin;
    if(currentMembersMode==='invite'&&!roomModerator()){box.innerHTML='<div class="room-members-empty">Yalnızca oda yöneticisi davet gönderebilir.</div>';return;}
    box.innerHTML=source.length?source.map(row=>{
      const name=row.data?.username||row.data?.displayName||row.memberData?.username||'Kullanıcı';
      const joined=ids.has(row.id),isOwner=row.id===activeRoom.data.ownerId;
      const isRoomAdmin=(activeRoom.data.adminIds||[]).includes(row.id);
      const role=isOwner?'Oda sahibi':(isRoomAdmin?'Oda yöneticisi':(joined?'Üye':''));
      let action='';
      if(currentMembersMode==='invite'){
        action=joined?'<span class="room-member-state">Zaten üye</span>':'<button class="room-invite-action" type="button" data-invite-user="'+escapeHtml(row.id)+'" data-invite-name="'+escapeHtml(name)+'">Davet et</button>';
      }else if(canGrantRoomAdmin&&!isOwner){
        action='<button class="room-invite-action" type="button" data-room-admin-user="'+escapeHtml(row.id)+'" data-room-admin-make="'+(isRoomAdmin?'false':'true')+'">'+(isRoomAdmin?'Yöneticilikten çıkar':'Yönetici yap')+'</button>';
      }else{
        action='<span class="room-member-state">'+escapeHtml(role)+'</span>';
      }
      return '<div class="room-member-list-row"><div class="room-member-avatar">'+escapeHtml(name.slice(0,1).toUpperCase())+'</div><div class="room-member-list-copy"><strong>'+escapeHtml(name)+'</strong><small>'+escapeHtml(role||'Forever üyesi')+'</small></div>'+action+'</div>';
    }).join(''):'<div class="room-members-empty">Henüz üye görünmüyor.</div>';
    box.querySelectorAll('[data-invite-user]').forEach(button=>button.onclick=async()=>{
      try{
        const {error}=await supabaseClient.rpc('forever_invite_room_member',{p_room_id:activeRoom.id,p_target_user:button.dataset.inviteUser,p_username:button.dataset.inviteName});
        if(error)throw error;
        toast(button.dataset.inviteName+' odaya davet edildi.');await loadRoomMembers();await loadRoomMemberCount();
      }catch(e){toast(e.message||'Davet gönderilemedi.');}
    });
    box.querySelectorAll('[data-room-admin-user]').forEach(button=>button.onclick=async()=>{
      try{
        const {data,error}=await supabaseClient.rpc('forever_set_room_admin',{
          p_room_id:activeRoom.id,p_target_user:button.dataset.roomAdminUser,p_make_admin:button.dataset.roomAdminMake==='true'
        });
        if(error)throw error;
        if(data)activeRoom.data=data;
        toast(button.dataset.roomAdminMake==='true'?'Oda yöneticisi atandı.':'Oda yöneticiliği kaldırıldı.');
        syncRoomControls();await loadRoomMembers();
      }catch(e){toast(e.message||'Oda yöneticisi güncellenemedi.');}
    });
  }catch(e){box.innerHTML='<div class="empty">Üyeler yüklenemedi: '+escapeHtml(e.message)+'</div>';}
}
function setRoomTheme(){openRoomTheme();}
async function toggleRoomPrivacy() {
  if (!roomOwner() && !isAppAdmin) return toast('Bu ayarı yalnızca oda sahibi veya sistem yöneticisi değiştirebilir.');
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
function getRoomTheme(){try{const v=JSON.parse(localStorage.getItem(roomThemeKey())||'null');if(v&&typeof v==='object')return {space:isPlus?(v.space||'space-night'):'space-night',bubble:isPlus?(v.bubble||'#8b5cf6'):'#8b5cf6',transparent:isPlus&&v.transparent===true,shape:isPlus?(v.shape||'rounded'):'rounded'};}catch(_){}return {space:'space-night',bubble:'#8b5cf6',transparent:false,shape:'rounded'};}
function applyRoomTheme(){
  if(!$('roomChat'))return;
  const t=getRoomTheme(),space=ROOM_SPACE_THEMES.find(x=>x.id===t.space)||ROOM_SPACE_THEMES[0],c=$('roomChat');
  c.style.setProperty('--room-background',space.background);
  c.style.setProperty('--room-bubble',t.transparent?'rgba(139,92,246,.20)':t.bubble);
  c.style.setProperty('--room-bubble-border',t.transparent?'rgba(255,255,255,.24)':'transparent');
  c.style.setProperty('--room-bubble-radius',t.shape==='pill'?'28px':t.shape==='sharp'?'7px':'17px');
  let hex=String(t.bubble||'#8b5cf6').replace('#','');
  if(hex.length===3)hex=hex.split('').map(x=>x+x).join('');
  const rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));
  const luminance=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
  c.style.setProperty('--room-bubble-text',luminance>.56?'#17131c':'#ffffff');
  c.classList.toggle('room-bubbles-transparent',t.transparent);
  document.querySelectorAll('[data-space-theme]').forEach(b=>b.classList.toggle('active',b.dataset.spaceTheme===t.space));
  document.querySelectorAll('[data-bubble-shape]').forEach(b=>b.classList.toggle('active',b.dataset.bubbleShape===t.shape));
  document.querySelectorAll('[data-bubble-color]').forEach(b=>b.classList.toggle('active',b.dataset.bubbleColor===t.bubble));
  if($('roomThemeTransparent'))$('roomThemeTransparent').checked=t.transparent;
}
function renderRoomThemePanel(){
  const grid=$('roomThemeSpaceGrid'),colors=$('roomThemeBubbleColors');
  if(grid)grid.innerHTML=(isPlus?ROOM_SPACE_THEMES:ROOM_SPACE_THEMES.slice(0,1)).map(t=>'<button type="button" class="room-theme-choice" data-space-theme="'+t.id+'"><span style="background:'+t.background+'"></span><small>'+escapeHtml(t.name)+'</small></button>').join('');
  if(colors)colors.innerHTML=(isPlus?ROOM_BUBBLES:ROOM_BUBBLES.slice(0,6)).map(c=>'<button type="button" class="room-theme-swatch" data-bubble-color="'+c+'" style="background:'+c+'" title="'+c+'"></button>').join('');
  applyRoomTheme();
}
function saveRoomTheme(t){try{localStorage.setItem(roomThemeKey(),JSON.stringify(t));}catch(_){}applyRoomTheme();}
function openRoomTheme(){renderRoomThemePanel();$('roomThemeModal')?.classList.remove('hidden');}
window.closeRoomTheme=()=> $('roomThemeModal')?.classList.add('hidden');
function resetRoomTheme(){try{localStorage.removeItem(roomThemeKey());}catch(_){}renderRoomThemePanel();}
function setRoomThemeSpace(id){if(!isPlus&&id!=='space-night')return toast('Ek oda temaları Süper Plus ayrıcalığıdır.');if(!ROOM_SPACE_THEMES.some(theme=>theme.id===id))return;const t=getRoomTheme();t.space=id;saveRoomTheme(t);}
function setRoomBubbleColor(color){if(!isPlus&&!ROOM_BUBBLES.slice(0,6).includes(color))return toast('Ek baloncuk renkleri Süper Plus ayrıcalığıdır.');if(!ROOM_BUBBLES.includes(color))return;const t=getRoomTheme();t.bubble=color;t.transparent=false;saveRoomTheme(t);}
function setRoomBubbleShape(shape){if(!isPlus&&shape!=='rounded')return toast('Ek baloncuk şekilleri Süper Plus ayrıcalığıdır.');if(!['rounded','pill','sharp'].includes(shape))return;const t=getRoomTheme();t.shape=shape;saveRoomTheme(t);}
function setRoomBubbleTransparent(on){if(!isPlus&&on)return toast('Şeffaf baloncuk Süper Plus ayrıcalığıdır.');const t=getRoomTheme();t.transparent=Boolean(on)&&isPlus;saveRoomTheme(t);}

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
  $('roomModerationMuteBtn').innerHTML='<i class="fa-solid fa-volume-xmark"></i> '+(muted?'Mesaj engelini kaldır':'Mesaj göndermesini engelle');
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
  if(!isPlus)return toast('Animasyonlu emoji gönderme Süper Plus ayrıcalığıdır. 💎');
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
function openEmojiMixer(){if(!activeRoom)return toast('Önce bir odaya gir.');if(!isPlus)return toast('Emoji birleştirme Süper Plus ayrıcalığıdır. 💎');$('emojiMixerModal')?.classList.remove('hidden');drawEmojiMixPreview();}
async function sendEmojiMixToRoom(){
  if(!isPlus)return toast('Emoji birleştirme Süper Plus ayrıcalığıdır. 💎');
  const one=readOneEmoji('emojiMixerOne'),two=readOneEmoji('emojiMixerTwo');if(!one||!two)return toast('İki kutuya da birer emoji girmelisin.');
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
    if (activeRoom?.data?.features?.drawing === false) return;
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
    if(typeof window.openForeverBAI==='function')window.openForeverBAI();
    else toast('BAI arayüzü henüz yüklenmedi.');
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
    if(!isPlus)return toast('Animasyonlu çıkartmalar Süper Plus ayrıcalığıdır. 💎');
    if(activeRoom?.data?.features?.stickers===false)return toast('Bu odada çıkartmalar kapalı.');
    $('stickerTray').classList.toggle('hidden');
  };
  $('stickerTray').querySelectorAll('[data-animated-sticker]').forEach(button=>button.onclick=()=>{
    if(!isPlus)return toast('Animasyonlu çıkartmalar Süper Plus ayrıcalığıdır. 💎');
    sendRoomMessage({kind:'animated_sticker',stickerId:button.dataset.animatedSticker,emoji:button.dataset.emoji,text:button.dataset.emoji});
  });
  $('toggleDrawingBtn').onclick=()=>{
    $('roomComposerMenu').classList.add('hidden');
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
  const result=await supabaseClient.auth.getSession();
  session=result.data.session;
  if(!session?.user){
    isAppAdmin=false;
    window.foreverIsAdmin=false;
    document.querySelectorAll('.admin-nav').forEach(node=>node.classList.add('hidden'));
    return;
  }
  userId=session.user.id;
  const [profile,plus,admin]=await Promise.all([
    supabaseClient.from('forever_documents').select('data').eq('collection_name','users').eq('id',userId).maybeSingle(),
    supabaseClient.rpc('is_forever_plus'),
    supabaseClient.rpc('is_forever_admin')
  ]);
  if(profile.error)throw profile.error;
  username=profile.data?.data?.username||session.user.user_metadata?.name||'Kullanıcı';
  if(plus.error)throw plus.error;
  isPlus=Boolean(plus.data);window.foreverIsPlus=isPlus;
  isAppAdmin=!admin.error&&admin.data===true;
  window.foreverIsAdmin=isAppAdmin;
  document.querySelectorAll('.admin-nav').forEach(node=>node.classList.toggle('hidden',!isAppAdmin));
  await refreshRoomPlusUsers();watchRoomPlusUsers();
  syncRoomFeatureControls();
  bindRoomUi();
  await loadRoomList();
}

window.addEventListener('forever-user-ready',()=>{
  initForUser().catch(error=>console.error('Aura X oda başlangıcı başarısız:',error));
});
window.addEventListener('forever-user-signed-out',()=>{
  if(roomChannel){supabaseClient.removeChannel(roomChannel);roomChannel=null;}
  activeRoom=null;userId=null;username='';isPlus=false;isAppAdmin=false;plusUserIds=new Set();
  if(plusUsersChannel){supabaseClient.removeChannel(plusUsersChannel);plusUsersChannel=null;}
  window.foreverIsPlus=false;window.foreverIsAdmin=false;
  document.querySelectorAll('.admin-nav').forEach(node=>node.classList.add('hidden'));
});
initForUser().catch(error=>console.error('Aura X oda başlangıcı başarısız:',error));
