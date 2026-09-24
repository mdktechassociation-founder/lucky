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
    const input=[...history,{role:'user',content}]; const data=await api('/api/chat',{method:'POST',body:JSON.stringify({messages:input})});
    history=[...input,{role:'assistant',content:data.answer}].slice(-16);bubble('assistant',data.answer);
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
