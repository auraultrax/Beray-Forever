/* Forever BAI — in-app assistant widget. API secrets stay in Supabase Edge Functions. */
(() => {
  'use strict';
  const STYLE = `
    #foreverBaiFab{position:fixed;right:22px;bottom:94px;z-index:9500;border:1px solid rgba(196,181,253,.45);border-radius:999px;padding:12px 17px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:white;font:800 14px system-ui;box-shadow:0 12px 34px #0006;cursor:pointer}
    #foreverBaiPanel{position:fixed;right:18px;bottom:154px;width:min(390px,calc(100vw - 28px));height:min(570px,calc(100dvh - 190px));z-index:9501;display:none;grid-template-rows:auto 1fr auto auto;overflow:hidden;border:1px solid rgba(196,181,253,.28);border-radius:20px;background:#100d1c;color:#f6f1ff;box-shadow:0 24px 80px #0009;font:14px/1.45 system-ui}
    #foreverBaiPanel.open{display:grid}
    #foreverBaiHead{display:flex;align-items:center;gap:10px;padding:14px 15px;background:linear-gradient(110deg,#21143b,#17112a);border-bottom:1px solid #3b2b57}
    #foreverBaiHead strong{font-size:15px}#foreverBaiHead small{display:block;color:#b9accd;font-size:11px}
    #foreverBaiClose{margin-left:auto;background:transparent;border:0;color:#eee6ff;font-size:23px;cursor:pointer}
    #foreverBaiMessages{padding:14px;overflow:auto;display:flex;flex-direction:column;gap:10px}
    .forever-bai-msg{max-width:91%;padding:10px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere}
    .forever-bai-msg.user{align-self:flex-end;background:#6d45b6;color:white;border-bottom-right-radius:5px}
    .forever-bai-msg.assistant{align-self:flex-start;background:#211a32;border:1px solid #403151;color:#f4edff;border-bottom-left-radius:5px}
    .forever-bai-msg.error{border-color:#8b354b;color:#ffdbe5}
    .forever-bai-result{display:block;margin-top:7px;color:#c4b5fd;text-decoration:underline;font-size:12px}
    #foreverBaiQuick{padding:0 12px 9px;display:flex;gap:6px;flex-wrap:wrap}
    #foreverBaiQuick button{background:#211a32;border:1px solid #493762;color:#ddceff;border-radius:999px;padding:6px 9px;font-size:11px;cursor:pointer}
    #foreverBaiForm{display:flex;gap:8px;padding:11px;border-top:1px solid #3b2b57}
    #foreverBaiInput{flex:1;min-width:0;max-height:100px;resize:vertical;border:1px solid #4b3b65;border-radius:12px;padding:10px;background:#0b0912;color:white;font:inherit}
    #foreverBaiSend{border:0;border-radius:12px;background:#8b5cf6;color:white;font-weight:800;padding:0 14px;cursor:pointer}
    #foreverBaiSend:disabled{opacity:.5;cursor:wait}
    #foreverBaiFoot{padding:0 12px 8px;color:#9c90ae;font-size:10px}
    @media(max-width:520px){#foreverBaiFab{right:14px;bottom:85px}#foreverBaiPanel{right:8px;bottom:142px;width:calc(100vw - 16px);height:min(570px,calc(100dvh - 170px))}}
  `;
  const style = document.createElement('style'); style.textContent = STYLE; document.head.appendChild(style);
  const make = (tag, id, cls, value) => {
    const node = document.createElement(tag);
    if (id) node.id = id;
    if (cls) node.className = cls;
    if (value !== undefined) node.textContent = value;
    return node;
  };
  const fab = make('button','foreverBaiFab','', '✨ BAI');
  fab.type = 'button'; fab.setAttribute('aria-haspopup','dialog'); fab.setAttribute('aria-controls','foreverBaiPanel');
  const panel = make('section','foreverBaiPanel');
  panel.setAttribute('role','dialog'); panel.setAttribute('aria-label','Forever BAI sohbeti');
  const head = make('div','foreverBaiHead');
  const badge = make('div','','','💎');
  const heading = make('div'); heading.append(make('strong','','','BAI · Forever')); heading.append(make('small','','','Sohbet ve uygulama desteği'));
  const close = make('button','foreverBaiClose','','×'); close.type='button'; close.setAttribute('aria-label','Kapat');
  head.append(badge,heading,close);
  const messages = make('div','foreverBaiMessages');
  const quick = make('div','foreverBaiQuick');
  [['Forever nedir?','Forever nedir?'],['Bir sorunu çözelim','Forever’da bir konuda yardıma ihtiyacım var.'],['Plus ayrıcalıkları','Süper Plus ayrıcalıkları neler?']].forEach(([label,value])=>{
    const b=make('button','','',label);b.type='button';b.addEventListener('click',()=>send(value));quick.append(b);
  });
  const form = make('form','foreverBaiForm');
  const input = make('textarea','foreverBaiInput'); input.rows=1;input.maxLength=2000;input.placeholder='BAI’ye yaz… (arama için /ara konu)';
  const sendButton = make('button','foreverBaiSend','','Gönder');sendButton.type='submit';
  form.append(input,sendButton);
  const foot = make('div','foreverBaiFoot','','BAI hata yapabilir. Parolanı veya özel bilgilerini paylaşma.');
  panel.append(head,messages,quick,form,foot);
  document.body.append(fab,panel);
  let client=null, isPlus=false, busy=false;
  const history=[];
  function addMessage(text,who='assistant',isError=false,links=[]){
    const bubble=make('div','','forever-bai-msg '+who+(isError?' error':''),text);
    for(const item of links||[]){
      if(!item?.link)continue;
      const a=make('a','','forever-bai-result',item.title||item.link);a.href=item.link;a.target='_blank';a.rel='noopener noreferrer';bubble.append(a);
    }
    messages.append(bubble);messages.scrollTop=messages.scrollHeight;return bubble;
  }
  function localReply(text){
    const t=String(text||'').toLocaleLowerCase('tr-TR');
    if(/^(merhaba|selam|sa|naber|nasılsın|iyi misin)[!.? ]*$/.test(t))return 'Merhaba! 💜 Ben BAI. Forever kullanımı hakkında yardımcı olabilir veya başka bir konu üzerine konuşabiliriz.';
    if(t.includes('forever nedir'))return 'Forever; gönderiler, profiller, takip, yorumlar, hikâyeler ve odalar gibi özellikleri bulunan bir sosyal platformdur.';
    if(t.includes('süper plus')&&t.includes('ayrıcal'))return 'Süper Plus; doğrulanmış rozet, uygulama simgesi seçenekleri, metin gönderileri, animasyonlu çıkartmalar, emoji birleştirme, BAI için kişisel günlük kota olmaması, gönderi öne çıkarma ve gelişmiş oda temaları sunar.';
    return '';
  }
  async function send(raw){
    const text=String(raw||'').trim();if(!text||busy)return;
    input.value='';addMessage(text,'user');
    const normalized=text.toLocaleLowerCase('tr-TR');
    if(/kendime zarar|intihar|yaşamak istemiyorum|kendimi öldür|canıma kıymak/.test(normalized)){
      addMessage('Bunu paylaştığın için teşekkür ederim. Şu anda yakın bir tehlikedeysen Türkiye’de 112’yi ara ve hemen yanında güvendiğin bir yetişkine veya kişiye haber ver. Bu konuda yalnız kalma.');
      return;
    }
    const local=localReply(text);
    if(local){addMessage(local);return;}
    if(!client){addMessage('BAI bağlantısı henüz hazır değil. Sayfayı yenileyip tekrar deneyebilirsin.', 'assistant', true);return;}
    busy=true;sendButton.disabled=true;sendButton.textContent='…';
    try{
      if(text.startsWith('/ara ')){
        const query=text.slice(5).trim();
        const {data,error}=await client.functions.invoke('aurai-search',{body:{query}});
        if(error)throw error;
        const results=Array.isArray(data?.results)?data.results:[];
        if(!results.length)addMessage('Arama sonucu bulunamadı.');
        else addMessage(results.map((x,i)=>(i+1)+'. '+(x.title||'Sonuç')+'\n'+(x.snippet||'')).join('\n\n'),'assistant',false,results);
      } else {
        history.push({role:'user',content:text});
        const {data,error}=await client.functions.invoke('aurai-chat',{body:{messages:history.slice(-12),mode:'assistant'}});
        if(error)throw error;
        const answer=String(data?.answer||'').trim();
        if(!answer)throw new Error(data?.error||'BAI şu anda yanıt üretemedi.');
        history.push({role:'assistant',content:answer});addMessage(answer);
      }
    }catch(error){
      const message=error?.message||'BAI bağlantısında bir sorun oluştu.';
      addMessage(message,'assistant',true);
    }finally{busy=false;sendButton.disabled=false;sendButton.textContent='Gönder';input.focus();}
  }
  form.addEventListener('submit',event=>{event.preventDefault();send(input.value);});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();form.requestSubmit();}});
  function open(){panel.classList.add('open');fab.style.display='none';input.focus();}
  function closePanel(){panel.classList.remove('open');fab.style.display='block';}
  fab.addEventListener('click',open);close.addEventListener('click',closePanel);
  window.openForeverBAI=open;
  async function syncAccess(){
    if(!client)return;
    const {data}=await client.auth.getSession();const user=data?.session?.user;
    if(!user){isPlus=false;fab.style.display='none';closePanel();return;}
    const result=await client.rpc('is_forever_plus');isPlus=!result.error&&Boolean(result.data);
    fab.style.display='block';
    const status=head.querySelector('small');
    if(status)status.textContent=isPlus?'Süper Plus · kişisel günlük kota yok':'Standart · 30 sohbet / 10 arama';
    foot.textContent=isPlus
      ? 'Süper Plus: kişi başı günlük kota yok. Ortak sistem bütçesi ve sağlayıcı sınırları geçerlidir.'
      : 'Standart hesap: günlük 30 sohbet ve 10 arama. Parolanı veya özel bilgilerini paylaşma.';
  }
  async function boot(){
    for(let i=0;i<80&&!window.supabaseClient;i++)await new Promise(resolve=>setTimeout(resolve,150));
    client=window.supabaseClient||null;
    if(!client){fab.style.display='none';return;}
    await syncAccess().catch(()=>{fab.style.display='none';});
    client.auth.onAuthStateChange(()=>syncAccess().catch(()=>{}));
    window.addEventListener('forever-user-ready',()=>syncAccess().catch(()=>{}));
    window.addEventListener('forever-plus-updated',()=>syncAccess().catch(()=>{}));
    window.addEventListener('forever-user-signed-out',()=>{isPlus=false;fab.style.display='none';closePanel();});
    addMessage('Merhaba! Ben BAI 💜 Forever kullanımı ve genel sorular konusunda yardımcı olabilirim. İnternet araması için mesajına /ara ile başla.');
  }
  boot().catch(error=>console.warn('Forever BAI yüklenemedi:',error));
})();
