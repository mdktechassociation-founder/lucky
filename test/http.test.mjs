import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('HTTP: auth, same-origin, static assets and fail-closed Tor',async t=>{
 const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:'3199',ACCESS_TOKEN:'test-token',PRIVACY_MODE:'tor',TOR_PROXY:'socks5h://127.0.0.1:1'},stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());
 await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw new Error('Server exited');})]);
 const base='http://127.0.0.1:3199', headers={Authorization:'Bearer test-token','Content-Type':'application/json'};
 assert.equal((await fetch(base+'/')).status,200);
 assert.equal((await fetch(base+'/api/health')).status,401);
 const health=await fetch(base+'/api/health',{headers}); assert.equal(health.status,200);assert.equal((await health.json()).privacy,'tor');
 assert.equal((await fetch(base+'/api/health',{headers:{...headers,Origin:'https://evil.example'}})).status,403);
 assert.equal((await fetch(base+'/api/health',{headers:{...headers,Origin:base}})).status,200);
 assert.equal((await fetch(base+'/.env')).status,404);
 const res=await fetch(base+'/api/chat',{method:'POST',headers,body:JSON.stringify({messages:[{role:'user',content:'hello'}]})});
 assert.equal(res.status,502); assert.match((await res.json()).error,/No fallback/);
});
