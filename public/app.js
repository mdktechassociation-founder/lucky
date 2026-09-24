const $ = id => document.getElementById(id);
let history = [], pending = false;
const headers = () => ({'Content-Type':'application/json',...($('token').value ? {Authorization:`Bearer ${$('token').value}`} : {})});
async function api(path, options = {}) {
  const response = await fetch(path,{...options,headers:headers()});
  const data = await response.json().catch(() => ({}));
  if(!response.ok) { const e = new Error(data.error || 'Server unavailable'); e.status = response.status; throw e; }
  return data;
}
async function refresh() {
  try {
    const h = await api('/api/health'); $('status').textContent = 'Server ready · gateway checked when you send'; $('metrics').replaceChildren();
    $('tools-status').textContent = `Search: ${h.tools.search?'configured':'not configured'} · Browser: ${h.tools.browser?'enabled':'off'} · Android: ${h.tools.phone?'enabled':'off'}`;
    const metrics = {'Profile':h.mode,'Available RAM':`${h.availableMB} MB`,'Gateway route':h.privacy,'Model':h.model};
    if(h.stats) {
      metrics['Uptime'] = `${h.stats.uptimeSec}s`;
      metrics['Activity'] = `${h.stats.chats} chats · ${h.stats.searches} searches · ${h.stats.executed} actions`;
      metrics['Free-only guard'] = `active · ${h.stats.blockedPaid} paid blocked`;
    }
    for(const [key,value] of Object.entries(metrics)) {
      const dt=document.createElement('dt'),dd=document.createElement('dd'); dt.textContent=key;dd.textContent=value;$('metrics').append(dt,dd);
    }
    if(h.mode==='lite' || navigator.deviceMemory && navigator.deviceMemory <= 2) {$('lite').checked=true;document.body.classList.remove('motion');}
  } catch(e) {$('status').textContent=e.message;}
}
function bubble(role, content) {
  const a=document.createElement('article'),s=document.createElement('small'),p=document.createElement('p');a.className=role;s.textContent=role==='user'?'YOU':'JARVIS';p.textContent=content;a.append(s,p);$('messages').append(a);
  if(role==='assistant') addCopy(a,()=>p.textContent);
  while($('messages').children.length>32) $('messages').firstChild.remove(); $('messages').scrollTop=$('messages').scrollHeight;
  return a;
}
function addCopy(article, getText) {
  const b=document.createElement('button');b.type='button';b.className='copy';b.textContent='copy';
  b.onclick=async()=>{try{await navigator.clipboard.writeText(getText());b.textContent='copied ✓';}catch{b.textContent='unavailable';}setTimeout(()=>b.textContent='copy',1200);};
  article.prepend(b);
}
function speakIfChecked(answer) {
  if(!$('speak').checked || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(answer);const voices=speechSynthesis.getVoices().filter(v=>v.localService);
  if(voices.length){utterance.voice=voices[0];speechSynthesis.speak(utterance);}else $('error').textContent='No local device voice available. Cloud voice was not enabled.';
}
const HISTORY_KEY='lucky.history.v1';
function persist() { if(!$('persist').checked) return; try{sessionStorage.setItem(HISTORY_KEY,JSON.stringify(history));}catch{} }
function restore() {
  if(!$('persist').checked) return;
  try {
    const saved = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]');
    if(!Array.isArray(saved) || !saved.length) return;
    const valid = saved.filter(m => m && ['user','assistant'].includes(m.role) && typeof m.content === 'string' && m.content.trim() && m.content.length <= 12000);
    if(!valid.length) return;
    $('messages').replaceChildren();
    for(const m of valid) bubble(m.role === 'user' ? 'user' : 'assistant', m.content);
    history = valid.slice(-16);
  } catch {}
}
// SSE stream reader for /api/chat: meta → deltas → done/error events.
async function streamChat(payload, onDelta) {
  let response = await fetch('/api/chat',{method:'POST',headers:{...headers(),Accept:'text/event-stream'},body:JSON.stringify(payload)});
  if(response.status === 429) {
    $('error').textContent = 'Server is busy with another request — retrying in 2 seconds…';
    await new Promise(r=>setTimeout(r, 2300));
    response = await fetch('/api/chat',{method:'POST',headers:{...headers(),Accept:'text/event-stream'},body:JSON.stringify(payload)});
  }
  if(!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
    let data = {}; try { data = await response.json(); } catch {}
    const e = new Error(data.error || `Server error ${response.status}`); e.status = response.status; throw e;
  }
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buf = '', answer = '', sources = [], done = false;
  for(;;) {
    const {value, done: ended} = await reader.read(); if(ended) break;
    buf += decoder.decode(value, {stream:true});
    let i;
    while((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0,i); buf = buf.slice(i+2);
      let event = 'message', data = '';
      for(const line of block.split('\n')) {
        if(line.startsWith('event:')) event = line.slice(6).trim();
        else if(line.startsWith('data:')) data += line.slice(5).trim();
      }
      let obj = {}; try { obj = JSON.parse(data); } catch { continue; }
      if(event === 'delta') { onDelta(obj.t || ''); }
      else if(event === 'done') { answer = obj.answer; sources = obj.sources || []; done = true; onDelta(answer, true); }
      else if(event === 'error') { const e = new Error(obj.error); e.partial = answer; throw e; }
    }
  }
  if(!done) { const e = new Error('Stream ended without a final answer.'); e.partial = answer; throw e; }
  return {answer, sources};
}
$('form').addEventListener('submit',async e=>{
  e.preventDefault(); const content=$('prompt').value.trim();if(pending || !content)return;
  pending=true;$('send').disabled=true;$('clear').disabled=true;$('error').textContent='';bubble('user',content);$('prompt').value='';$('prompt').style.height='auto';
  const input=[...history,{role:'user',content}];
  const article=bubble('assistant','JARVIS is thinking…'); const para=article.querySelector('p'); let streamed='';
  try {
    const {answer, sources} = await streamChat({messages:input,search:$('search-chat').checked,stream:true}, (text,isFinal) => {
      if(isFinal) { streamed = text; } else { streamed += text; }
      para.textContent = streamed; $('messages').scrollTop = $('messages').scrollHeight;
    });
    history=[...input,{role:'assistant',content:answer}].slice(-16);persist();
    if(streamed !== answer) para.textContent = answer;
    if(sources?.length) {const section=document.createElement('div');section.className='sources';appendSources(section,sources);$('messages').lastChild.append(section);}
    speakIfChecked(answer);
  }catch(err){
    if(!streamed) article.remove(); else para.textContent = streamed;
    $('error').textContent=err.message;$('prompt').value=content;
  }finally{pending=false;$('send').disabled=false;$('clear').disabled=false;}
});
$('clear').onclick=()=>{history=[];$('messages').replaceChildren();$('error').textContent='';sessionStorage.removeItem(HISTORY_KEY);window.speechSynthesis?.cancel();};
$('prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('form').requestSubmit();}});
$('prompt').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(180,e.target.scrollHeight)+'px';});
$('refresh').onclick=refresh;$('token').onchange=refresh;$('lite').onchange=()=>document.body.classList.toggle('motion',!$('lite').checked);
$('persist').onchange=e=>{if(e.target.checked) persist(); else sessionStorage.removeItem(HISTORY_KEY);};
$('mic').onclick=()=>{
  const Recognition=window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!Recognition){$('error').textContent='Speech recognition is unavailable in this browser. Please type instead.';return;}
  if(!confirm('Browser speech recognition may send audio directly to your browser vendor, outside Tor. Continue?'))return;
  const r=new Recognition();r.lang=navigator.language || 'en-IN';r.interimResults=false;
  r.onresult=e=>{$('prompt').value=e.results[0][0].transcript;$('prompt').dispatchEvent(new Event('input'));};r.onerror=e=>{$('error').textContent=`Microphone: ${e.error}. Text input still works.`;};
  r.onend=()=>{$('mic').disabled=false;};try{r.start();$('mic').disabled=true;}catch{$('error').textContent='Could not start microphone.';}
};
refresh();restore();

function appendSources(parent, sources) {
  sources.forEach((s,i)=>{
    const item=document.createElement('p'),link=document.createElement('a');
    try {const url=new URL(s.url);if(!['https:','http:'].includes(url.protocol))return;link.href=url.href;}catch{return;}
    link.textContent=`[${i+1}] ${s.title || s.url}`;link.target='_blank';link.rel='noopener noreferrer';item.append(link);
    if(s.snippet){const snippet=document.createElement('span');snippet.textContent=' — '+s.snippet;item.append(snippet);}parent.append(item);
  });
}
let proposal=null, toolPending=false;
const post=(path,data)=>api(path,{method:'POST',body:JSON.stringify(data)});
function output(result) {
  $('tool-output').replaceChildren();
  if(result.results) {appendSources($('tool-output'),result.results);if(!result.results.length)$('tool-output').textContent='No results found.';}
  else if(result.image) {const img=document.createElement('img');img.src=result.image;img.alt='Connected Android screen';$('tool-output').append(img);}
  else {const pre=document.createElement('pre');pre.textContent=[result.title,result.url,result.text,result.controls ? 'CONTROLS (verify selector before use):\n'+JSON.stringify(result.controls,null,2) : ''].filter(Boolean).join('\n\n');$('tool-output').append(pre);}
  if(result.note || result.route){const p=document.createElement('p');p.className='small';p.textContent=result.note || `Route: ${result.route}. Opening a result link uses your own browser connection, not the server Tor route.`;$('tool-output').append(p);}
}
async function toolWork(fn) {
  if(toolPending)return;toolPending=true;$('tool-error').textContent='';
  const buttons=[...document.querySelectorAll('.toolbox button')];buttons.forEach(b=>b.disabled=true);
  try{await fn();}catch(e){$('tool-error').textContent=e.message;}finally{toolPending=false;buttons.forEach(b=>b.disabled=false);}
}
async function showProposal(p) {
  if(proposal) await post('/api/tools/cancel',{confirmation:proposal.confirmation}).catch(()=>{});
  proposal=p;$('action-preview').textContent=JSON.stringify(p.action,null,2);$('confirmation').hidden=false;$('confirmation').scrollIntoView({block:'nearest'});
}
$('search-run').onclick=()=>toolWork(async()=>output(await post('/api/search',{query:$('search-query').value})));
$('browser-run').onclick=()=>toolWork(async()=>showProposal(await post('/api/tools/prepare',{tool:'browser',action:$('browser-action').value,url:$('browser-url').value,selector:$('browser-selector').value,text:$('browser-text').value})));
$('phone-run').onclick=()=>toolWork(async()=>showProposal(await post('/api/tools/prepare',{tool:'phone',action:$('phone-action').value,serial:$('phone-serial').value,x:Number($('phone-x').value),y:Number($('phone-y').value),x2:Number($('phone-x2').value),y2:Number($('phone-y2').value),duration:400,text:$('phone-text').value})));
$('plan-run').onclick=()=>toolWork(async()=>showProposal(await post('/api/plan',{task:$('plan-task').value})));
$('action-confirm').onclick=()=>toolWork(async()=>{
  if(!proposal)throw new Error('Prepare an action first.');const id=proposal.confirmation;proposal=null;$('confirmation').hidden=true;
  output(await post('/api/tools/execute',{confirmation:id}));await refresh();
});
$('action-cancel').onclick=()=>toolWork(async()=>{
  if(proposal)await post('/api/tools/cancel',{confirmation:proposal.confirmation});proposal=null;$('confirmation').hidden=true;
});
