const $ = id => document.getElementById(id);
let history = [], pending = false;
const headers = () => ({'Content-Type':'application/json',...($('token').value ? {Authorization:`Bearer ${$('token').value}`} : {})});
async function api(path, options = {}) {
  const response = await fetch(path,{...options,headers:headers()});
  const data = await response.json(); if(!response.ok) throw new Error(data.error || 'Server unavailable'); return data;
}
async function refresh() {
  try {
    const h = await api('/api/health'); $('status').textContent = 'Server ready · gateway checked when you send'; $('metrics').replaceChildren();
    for(const [key,value] of Object.entries({'Profile':h.mode,'Available RAM':`${h.availableMB} MB`,'Gateway route':h.privacy,'Model':h.model})) {
      const dt=document.createElement('dt'),dd=document.createElement('dd'); dt.textContent=key;dd.textContent=value;$('metrics').append(dt,dd);
    }
    $('tools-status').textContent = `Search: ${h.tools.search?'configured':'not configured'} · Browser: ${h.tools.browser?'enabled':'off'} · Android: ${h.tools.phone?'enabled':'off'}`;
    if(h.mode==='lite' || navigator.deviceMemory && navigator.deviceMemory <= 2) {$('lite').checked=true;document.body.classList.remove('motion');}
  } catch(e) {$('status').textContent=e.message;}
}
function bubble(role, content) {
  const a=document.createElement('article'),s=document.createElement('small'),p=document.createElement('p');a.className=role;s.textContent=role==='user'?'YOU':'JARVIS';p.textContent=content;a.append(s,p);$('messages').append(a);
  while($('messages').children.length>32) $('messages').firstChild.remove(); $('messages').scrollTop=$('messages').scrollHeight;
}
$('form').addEventListener('submit',async e=>{
  e.preventDefault(); const content=$('prompt').value.trim();if(pending || !content)return;
  pending=true;$('send').disabled=true;$('clear').disabled=true;$('error').textContent='';bubble('user',content);$('prompt').value='';
  try {
    const input=[...history,{role:'user',content}]; const data=await api('/api/chat',{method:'POST',body:JSON.stringify({messages:input,search:$('search-chat').checked})});
    history=[...input,{role:'assistant',content:data.answer}].slice(-16);bubble('assistant',data.answer);
    if(data.sources?.length) {const section=document.createElement('div');section.className='sources';appendSources(section,data.sources);$('messages').lastChild.append(section);}
    if($('speak').checked && 'speechSynthesis' in window) {
      speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(data.answer);const voices=speechSynthesis.getVoices().filter(v=>v.localService); if(voices.length){utterance.voice=voices[0];speechSynthesis.speak(utterance);}else $('error').textContent='No local device voice available. Cloud voice was not enabled.';
    }
  }catch(e){$('error').textContent=e.message;$('prompt').value=content;}finally{pending=false;$('send').disabled=false;$('clear').disabled=false;}
});
$('clear').onclick=()=>{history=[];$('messages').replaceChildren();$('error').textContent='';window.speechSynthesis?.cancel();};
$('refresh').onclick=refresh;$('token').onchange=refresh;$('lite').onchange=()=>document.body.classList.toggle('motion',!$('lite').checked);
$('mic').onclick=()=>{
  const Recognition=window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!Recognition){$('error').textContent='Speech recognition is unavailable in this browser. Please type instead.';return;}
  if(!confirm('Browser speech recognition may send audio directly to your browser vendor, outside Tor. Continue?'))return;
  const r=new Recognition();r.lang=navigator.language || 'en-IN';r.interimResults=false;
  r.onresult=e=>{$('prompt').value=e.results[0][0].transcript;};r.onerror=e=>{$('error').textContent=`Microphone: ${e.error}. Text input still works.`;};
  r.onend=()=>{$('mic').disabled=false;};try{r.start();$('mic').disabled=true;}catch{$('error').textContent='Could not start microphone.';}
};
refresh();

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
