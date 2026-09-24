import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {Confirmations,allowedURL,validateAction,phoneArgs,ToolRunner,search} from '../server/tools.mjs';

const env={ACCESS_TOKEN:'test-token',ENABLE_PHONE:'1',ENABLE_BROWSER:'1',ADB_ALLOWED_SERIALS:'device-1',BROWSER_ALLOWED_HOSTS:'example.com',PRIVACY_MODE:'tor',TOR_PROXY:'socks5h://127.0.0.1:9050'};
test('URL allowlist blocks schemes, credentials, wildcard lookalikes, IPs and ports',()=>{
 assert.equal(allowedURL('https://example.com/a',['example.com']),'https://example.com/a');
 for(const url of ['http://example.com','https://evil.example.com','https://example.com.evil.test','https://u:p@example.com','https://example.com:9999','file:///etc/passwd','javascript:alert(1)','https://127.0.0.1','https://[::1]'])assert.throws(()=>allowedURL(url,['example.com','127.0.0.1','[::1]']));
});
test('input normalization blocks shell injection and unsupported actions',()=>{
 for(const s of ['hello;rm -rf /','$(whoami)','a\nb','hi%sworld','`id`','abc&xyz','"quote"',"'quote'"]) assert.throws(()=>validateAction({tool:'phone',action:'type',serial:'device-1',text:s}));
 assert.throws(()=>validateAction({tool:'phone',action:'tap',serial:'device-1',x:-1,y:2}));
 assert.throws(()=>validateAction({tool:'phone',action:'tap',serial:'device-1',x:1.5,y:2}));
 assert.throws(()=>validateAction({tool:'phone',action:'shell',serial:'device-1',text:'id'}));
 assert.throws(()=>validateAction({tool:'browser',action:'evaluate',text:'process.exit()'}));
 assert.throws(()=>validateAction({tool:'phone',action:'home',serial:'-e'}));
 assert.deepEqual(phoneArgs(validateAction({tool:'phone',action:'type',serial:'device-1',text:'hello world'})),['-s','device-1','shell','input','text','hello%sworld']);
});
test('confirmation has TTL, single use, cancellation, immutability and bounded capacity',()=>{
 let now=100;const c=new Confirmations(()=>now), action={tool:'phone',action:'home'};
 const p=c.prepare(action);action.action='shell';assert.equal(c.take(p.confirmation).action,'home');assert.throws(()=>c.take(p.confirmation));
 const old=c.prepare(action);now+=120001;assert.throws(()=>c.take(old.confirmation));
 const cancelled=c.prepare(action);c.cancel(cancelled.confirmation);assert.throws(()=>c.take(cancelled.confirmation));
 for(let i=0;i<20;i++)c.prepare(action);assert.throws(()=>c.prepare(action));
});
test('automation requires opt-in, token and exact device authorization',()=>{
 const a={tool:'phone',action:'home',serial:'device-1'};
 assert.throws(()=>new ToolRunner({env:{}}).prepare(a),/ACCESS_TOKEN/);
 assert.throws(()=>new ToolRunner({env:{ACCESS_TOKEN:'t'}}).prepare(a),/disabled/);
 assert.throws(()=>new ToolRunner({env}).prepare({...a,serial:'other'}),/not in/);
});
test('phone preparation does not execute; only confirmed immutable command runs',async()=>{
 const calls=[];const r=new ToolRunner({env,execFile:async(...args)=>{calls.push(args);return {stdout:''};}});
 const proposal=r.prepare({tool:'phone',action:'tap',serial:'device-1',x:10,y:20});assert.equal(calls.length,0);
 proposal.action.x=999;
 await r.execute(proposal.confirmation);assert.deepEqual(calls[0][1],['-s','device-1','shell','input','tap','10','20']);
 await assert.rejects(r.execute(proposal.confirmation),/expired|used/);assert.equal(calls.length,1);
});
test('phone screenshot validates PNG and is not sent to AI',async()=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
 const r=new ToolRunner({env,execFile:async()=>({stdout:png})});
 const p=r.prepare({tool:'phone',action:'screenshot',serial:'device-1'});
 assert.match((await r.execute(p.confirmation)).image,/^data:image\/png;base64,/);
});
test('low-memory and direct-mode browser launches are blocked before loading browser',async()=>{
 let loaded=0;
 const r=new ToolRunner({env,memory:()=>({availableMB:200}),loadBrowser:async()=>{loaded++;}});
 await assert.rejects(r.execute(r.prepare({tool:'browser',action:'open',url:'https://example.com'}).confirmation),/512 MB/);assert.equal(loaded,0);
 const direct=new ToolRunner({env:{...env,PRIVACY_MODE:'direct'},memory:()=>({availableMB:1000}),loadBrowser:async()=>{loaded++;}});
 await assert.rejects(direct.execute(direct.prepare({tool:'browser',action:'open',url:'https://example.com'}).confirmation),/requires PRIVACY_MODE=tor/);assert.equal(loaded,0);
});
test('mock browser flow enforces Tor, sandbox, allowlist, confirmation and cleanup',async t=>{
 const events={};let current='about:blank',launched=0,closed=0,clicked=0,filled='',routeHandler,wsHandler;
 const locator={innerText:async()=> 'Example page',evaluateAll:async()=>[{selector:'#name',label:'Name'}],count:async()=>1,click:async()=>{clicked++;},fill:async text=>{filled=text;}};
 const page={isClosed:()=>false,url:()=>current,title:async()=> 'Example',locator:()=>locator,goto:async url=>{current=url;},setDefaultTimeout:()=>{},setDefaultNavigationTimeout:()=>{},on:()=>{}};
 const context={route:async(_,cb)=>{routeHandler=cb;},routeWebSocket:async(_,cb)=>{wsHandler=cb;},newPage:async()=>page,on:()=>{}};
 const browser={newContext:async options=>{assert.equal(options.serviceWorkers,'block');return context;},on:(ev,cb)=>{events[ev]=cb;},close:async()=>{closed++;events.disconnected?.();}};
 const r=new ToolRunner({env,memory:()=>({availableMB:1000}),loadBrowser:async()=>({chromium:{launch:async options=>{launched++;assert.equal(options.chromiumSandbox,true);assert.equal(options.proxy.server,'socks5://127.0.0.1:9050');return browser;}}})});
 t.after(()=>r.close());
 assert.throws(()=>r.prepare({tool:'browser',action:'read'}),/Open an allowed/);
 const p=r.prepare({tool:'browser',action:'open',url:'https://example.com'});assert.equal(launched,0);
 const result=await r.execute(p.confirmation);assert.equal(result.title,'Example');assert.equal(launched,1);
 let aborted=0,continued=0;
 const route=(url,type='document')=>({request:()=>({url:()=>url,resourceType:()=>type}),abort:async()=>{aborted++;},continue:async()=>{continued++;}});
 await routeHandler(route('https://evil.test'));await routeHandler(route('https://example.com/a.png','image'));await routeHandler(route('https://example.com'));assert.equal(aborted,2);assert.equal(continued,1);
 let wsClosed=false;wsHandler({close:()=>{wsClosed=true;}});assert.equal(wsClosed,true);
 await r.execute(r.prepare({tool:'browser',action:'click',selector:'#go'}).confirmation);assert.equal(clicked,1);
 await r.execute(r.prepare({tool:'browser',action:'type',selector:'#name',text:'Lucky'}).confirmation);assert.equal(filled,'Lucky');
 const stale=r.prepare({tool:'browser',action:'click',selector:'#go'});current='https://example.com/new';await assert.rejects(r.execute(stale.confirmation),/Page changed/);
 await r.execute(r.prepare({tool:'browser',action:'close'}).confirmation);assert.equal(closed,1);assert.equal(r.browser,null);
});
async function mockSearch(t,handler) {
 const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 return {SEARXNG_URL:`http://127.0.0.1:${server.address().port}`,SEARCH_LOCAL:'1',PRIVACY_MODE:'tor'};
}
test('search encodes query, normalizes and caps real HTTP results without AI calls',async t=>{
 const config=await mockSearch(t,(req,res)=>{
  const u=new URL(req.url,'http://local');assert.equal(u.pathname,'/search');assert.equal(u.searchParams.get('q'),'Telugu & news');assert.equal(u.searchParams.get('format'),'json');
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({results:[{title:'bad',url:'javascript:alert(1)'},...Array.from({length:8},(_,i)=>({title:'Result '+i,url:`https://example.com/${i}`,content:'snippet'}))]}));
 });
 const result=await search('Telugu & news',{env:config});assert.equal(result.results.length,5);assert.equal(result.results[0].title,'Result 0');assert.match(result.route,/local SearXNG/);
});
test('search fails closed on redirects and malformed responses',async t=>{
 const config=await mockSearch(t,(req,res)=>{res.writeHead(302,{Location:'https://example.com'});res.end();});
 await assert.rejects(search('test',{env:config}),/HTTP 302/);
 await assert.rejects(search('test',{env:{}}),/SEARXNG_URL/);
 await assert.rejects(search('test',{env:{...config,SEARXNG_URL:'http://evil.test'}}),/SEARCH_LOCAL/);
});
