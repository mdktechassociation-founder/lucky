import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('HTTP: auth, same-origin, static assets and fail-closed Tor',async t=>{
 const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:'3199',ACCESS_TOKEN:'test-token',PRIVACY_MODE:'tor',TOR_PROXY:'socks5h://127.0.0.1:1'},stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());
 await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw new Error('Server exited');})]);
 const base='http://127.0.0.1:3199', headers={Authorization:'Bearer test-token','Content-Type':'application/json'};
 assert.equal((await fetch(base+'/')).status,200);
 assert.equal((await fetch(base+'/healthz')).status,200); // liveness probe needs no auth
 assert.equal((await fetch(base+'/api/health')).status,401);
 assert.equal((await fetch(base+'/api/tools/prepare',{method:'POST',headers,body:JSON.stringify({tool:'phone',action:'devices'})})).status,400);
 const noApproval=await fetch(base+'/api/tools/execute',{method:'POST',headers,body:JSON.stringify({confirmation:'0'.repeat(48)})});assert.equal(noApproval.status,400);
 const disabledSearch=await fetch(base+'/api/search',{method:'POST',headers,body:JSON.stringify({query:'test'})});assert.equal(disabledSearch.status,400);
 const health=await fetch(base+'/api/health',{headers}); assert.equal(health.status,200);assert.equal((await health.json()).privacy,'tor');
 assert.equal((await fetch(base+'/api/health',{headers:{...headers,Origin:'https://evil.example'}})).status,403);
 assert.equal((await fetch(base+'/api/health',{headers:{...headers,Origin:base}})).status,200);
 assert.equal((await fetch(base+'/.env')).status,404);
 assert.match((await fetch(base+'/api/health',{headers})).headers.get('permissions-policy'), /camera=\(\)/);
 const res=await fetch(base+'/api/chat',{method:'POST',headers,body:JSON.stringify({messages:[{role:'user',content:'hello'}]})});
 assert.equal(res.status,502); assert.match((await res.json()).error,/No fallback/);
});

test('HTTP: streaming chat, stats, backoff, pricing guard and gateway override', async t => {
 let paid = false;
 const mock = http.createServer((req,res) => {
  let body=''; req.on('data',c=>body+=c);
  req.on('end',()=>{
   if(req.url==='/models'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data:[{id:'kilo-auto/free',pricing:paid?{prompt:'1',completion:'1'}:{prompt:'0',completion:'0',request:'0'}}]}));}
   if(req.url==='/chat/completions'){
    const input = JSON.parse(body);
    if(input.stream){
     res.writeHead(200,{'Content-Type':'text/event-stream'});
     const parts=['Hel','lo',' world']; let i=0;
     const iv=setInterval(()=>{ if(i<parts.length){res.write(`data: ${JSON.stringify({choices:[{delta:{content:parts[i++]}}]})}\n\n`);} else {clearInterval(iv);res.write('data: [DONE]\n\n');res.end();} },35);
     return;
    }
    res.setHeader('Content-Type','application/json');
    return res.end(JSON.stringify({choices:[{message:{content:`json answer; system prompt: ${(input.messages[0]?.content||'').slice(0,17)}`}}]}));
   }
   res.statusCode=404; res.end('{}');
  });
 });
 mock.listen(0,'127.0.0.1'); await once(mock,'listening'); t.after(()=>{mock.closeAllConnections();mock.close();});
 const base='http://127.0.0.1:3198';
 const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:'3198',ACCESS_TOKEN:'tk',PRIVACY_MODE:'direct',KILO_BASE_URL:`http://127.0.0.1:${mock.address().port}/`,KILO_MODEL:'kilo-auto/free',TOR_PROXY:''},stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());
 await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw new Error('Server exited');})]);
 const headers={Authorization:'Bearer tk','Content-Type':'application/json'};
 const chat=body=>fetch(base+'/api/chat',{method:'POST',headers,body:JSON.stringify(body)});
 const cooldown=()=>new Promise(r=>setTimeout(r,2600)); // server sets a 2s gap between AI requests
 // Streaming relay: meta → deltas → done, accumulated server-side
 const res=await chat({messages:[{role:'user',content:'hi'}],stream:true});
 assert.equal(res.status,200); assert.match(res.headers.get('content-type'),/text\/event-stream/);
 const text=await res.text();
 assert.match(text,/event: meta\n/); assert.match(text,/event: delta\n/g);
 assert.match(text,/event: done\ndata: .*"answer":"Hello world"/);
 // Non-streaming path still works through the same override
 await cooldown();
 const plain=await (await chat({messages:[{role:'user',content:'hi'}]})).json();
 assert.equal(plain.answer,'json answer; system prompt: You are JARVIS, a');
 // Concurrent request hits the one-flight lock with Retry-After
 await cooldown();
 const a=chat({messages:[{role:'user',content:'slow'}],stream:true}); await new Promise(r=>setTimeout(r,30));
 const b=await chat({messages:[{role:'user',content:'now'}],stream:true});
 assert.equal(b.status,429); assert.equal(b.headers.get('retry-after'),'2'); await a;
 // Health exposes counters
 const h=await (await fetch(base+'/api/health',{headers})).json();
 assert.ok(h.stats.chats >= 2 && h.stats.blockedPaid === 0 && typeof h.stats.uptimeSec === 'number');
 // Paid catalog must fail closed before any generation
 await cooldown();
 paid=true;
 const blocked=await chat({messages:[{role:'user',content:'hi'}]});
 assert.equal(blocked.status,502); assert.match((await blocked.json()).error,/Free-only guard/);
 const h2=await (await fetch(base+'/api/health',{headers})).json();
 assert.equal(h2.stats.blockedPaid,1);
});
