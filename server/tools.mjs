import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {SocksProxyAgent} from 'socks-proxy-agent';
import {health} from './core.mjs';

const exec = promisify(execFile);
const clip = (s, n = 12000) => String(s ?? '').slice(0,n);
function text(value, name, max=2000) {
  if(typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name} (1–${max} characters).`);
  return value.trim();
}
function number(value, name, max=10000) {
  if(!Number.isInteger(value) || value < 0 || value > max) throw new Error(`Invalid ${name} (integer 0–${max}).`);
  return value;
}
export function allowedURL(value, domains) {
  const url = new URL(text(value,'URL'));
  const host = url.hostname.toLowerCase();
  if(url.protocol !== 'https:' || url.port && url.port !== '443' || url.username || url.password || net.isIP(host) || host.startsWith('[') || !host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') || !domains.includes(host)) throw new Error('Browser URL blocked. Use HTTPS and an exact BROWSER_ALLOWED_HOSTS hostname, no IPs, credentials or custom ports.');
  return url.href;
}
export function validateAction(input, domains=[]) {
  if(!input || typeof input !== 'object') throw new Error('Action required.');
  const {tool,action} = input;
  if(tool === 'browser') {
    if(['read','close'].includes(action)) return {tool,action};
    if(action === 'open') return {tool,action,url:allowedURL(input.url,domains)};
    if(action === 'click') return {tool,action,selector:text(input.selector,'selector',300)};
    if(action === 'type') return {tool,action,selector:text(input.selector,'selector',300),text:text(input.text,'text',2000)};
  }
  if(tool === 'phone') {
    if(action === 'devices') return {tool,action};
    const serial = text(input.serial,'device serial',100);
    if(!/^[a-zA-Z0-9._:-]+$/.test(serial) || serial.startsWith('-')) throw new Error('Invalid device serial.');
    if(['screenshot','back','home'].includes(action)) return {tool,action,serial};
    if(action === 'tap') return {tool,action,serial,x:number(input.x,'x'),y:number(input.y,'y')};
    if(action === 'swipe') return {tool,action,serial,x:number(input.x,'x'),y:number(input.y,'y'),x2:number(input.x2,'x2'),y2:number(input.y2,'y2'),duration:number(input.duration ?? 400,'duration',2000)};
    if(action === 'type') {
      const value=text(input.text,'phone text',200);
      // adb shell joins arguments: strictly forbid shell metacharacters and adb %-escapes.
      if(!/^[A-Za-z0-9 .,_@-]+$/.test(value)) throw new Error('ADB text supports only English letters, digits, spaces and . , _ @ -; use your phone keyboard for other text.');
      return {tool,action,serial,text:value};
    }
  }
  throw new Error('Unsupported tool/action. No arbitrary shell, scripts, keycodes or file access.');
}
export function phoneArgs(a) {
  if(a.action === 'devices') return ['devices','-l'];
  const prefix=['-s',a.serial];
  if(a.action === 'screenshot') return [...prefix,'exec-out','screencap','-p'];
  const commands={back:['keyevent','4'],home:['keyevent','3'],tap:['tap',a.x,a.y],swipe:['swipe',a.x,a.y,a.x2,a.y2,a.duration],type:['text',a.text?.replaceAll(' ','%s')]};
  if(!commands[a.action]) throw new Error('Unsupported phone action');
  return [...prefix,'shell','input',...commands[a.action].map(String)];
}
export class Confirmations {
  constructor(now=Date.now) {this.entries=new Map();this.now=now;}
  prepare(action) {
    for(const [key,value] of this.entries) if(value.expires <= this.now()) this.entries.delete(key);
    if(this.entries.size >= 20) throw new Error('Too many pending confirmations. Wait two minutes.');
    const id=randomBytes(24).toString('hex'), expires=this.now()+120000;
    this.entries.set(id,{action:structuredClone(action),expires});return {confirmation:id,expires,action};
  }
  take(id) {
    const entry=this.entries.get(id);this.entries.delete(id);
    if(!entry || entry.expires <= this.now()) throw new Error('Confirmation expired or already used. Prepare the action again.');
    return entry.action;
  }
  cancel(id) {this.entries.delete(id);}
}
export async function search(query,{env=process.env}={}) {
  query=text(query,'search query',500);
  if(!env.SEARXNG_URL) throw new Error('Live search needs SEARXNG_URL. Start the optional SearXNG service or configure a trusted JSON-enabled instance.');
  const url=new URL(env.SEARXNG_URL);
  if(url.username || url.password || !['https:','http:'].includes(url.protocol)) throw new Error('Invalid SEARXNG_URL.');
  // Only operator-configured local SearXNG may bypass app Tor. Configure its own egress proxy.
  const local=env.SEARCH_LOCAL === '1';
  if(local && !['searxng','localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('SEARCH_LOCAL only permits loopback or the searxng service hostname.');
  if(!local && url.protocol !== 'https:') throw new Error('Remote search requires HTTPS.');
  url.pathname=url.pathname.replace(/\/$/,'')+'/search';url.search='';url.hash='';url.searchParams.set('q',query);url.searchParams.set('format','json');
  const tor=(env.PRIVACY_MODE || 'tor') === 'tor';
  const agent=tor && !local ? new SocksProxyAgent(env.TOR_PROXY || 'socks5h://127.0.0.1:9050') : undefined;
  return new Promise((resolve,reject)=>{
    const req=(url.protocol==='https:'?https:http).get(url,{agent,headers:{Accept:'application/json'}},res=>{
      let chunks=[],size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){req.destroy(new Error('Search response too large'));return;}chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>{
        if(res.statusCode!==200) return reject(new Error(`Search HTTP ${res.statusCode}. Enable JSON format in SearXNG; no alternate provider was contacted.`));
        try {
          const data=JSON.parse(Buffer.concat(chunks).toString());
          if(!Array.isArray(data.results)) throw new Error('Invalid search results');
          const results=data.results.filter(r=>{try{return ['https:','http:'].includes(new URL(r.url).protocol);}catch{return false;}}).slice(0,5).map(r=>({title:clip(r.title,200),url:clip(r.url,2000),snippet:clip(r.content,800)}));
          resolve({query,results,route:local?'local SearXNG (its egress must be configured separately)':tor?'tor':'direct'});
        }catch{reject(new Error('Invalid SearXNG JSON response'));}
      });
    });
    const timer=setTimeout(()=>req.destroy(new Error('Search timed out')),25000);
    req.on('close',()=>clearTimeout(timer));req.on('error',()=>reject(new Error('Search unavailable. Check SearXNG and the configured privacy route; no direct fallback.')));
  });
}

export class ToolRunner {
  constructor({env=process.env, execFile=exec, memory=health, loadBrowser=()=>import('playwright-core')}={}) {
    this.env=env;this.exec=execFile;this.memory=memory;this.loadBrowser=loadBrowser;
    this.domains=(env.BROWSER_ALLOWED_HOSTS || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
    this.confirmations=new Confirmations();this.context=null;this.browser=null;this.page=null;this.lock=false;this.idle=null;
  }
  capabilities() {
    return {search:Boolean(this.env.SEARXNG_URL), browser:this.env.ENABLE_BROWSER==='1',phone:this.env.ENABLE_PHONE==='1',browserRunning:Boolean(this.browser),browserHosts:this.domains,confirmationRequired:true};
  }
  enabled(a) {
    if(!this.env.ACCESS_TOKEN) throw new Error('Automation requires ACCESS_TOKEN on the server.');
    if(this.env[a.tool==='browser'?'ENABLE_BROWSER':'ENABLE_PHONE']!=='1') throw new Error(`${a.tool} automation is disabled. Enable it explicitly in server configuration.`);
    if(a.tool==='phone' && a.action!=='devices') {
      const devices=(this.env.ADB_ALLOWED_SERIALS || '').split(',').map(x=>x.trim());
      if(!devices.includes(a.serial)) throw new Error('Device not in ADB_ALLOWED_SERIALS. Choose an explicitly authorized device.');
    }
  }
  prepare(input) {
    const action=validateAction(input,this.domains);this.enabled(action);
    if(action.tool==='browser' && ['read','click','type'].includes(action.action)) {
      if(!this.page || this.page.isClosed()) throw new Error('Open an allowed page before preparing this action.');
      action.expectedURL=this.page.url();
    }
    return this.confirmations.prepare(action);
  }
  async execute(id) {
    if(this.lock) throw new Error('Another automation action is running.');
    const a=this.confirmations.take(id);this.enabled(a);
    if(a.expectedURL && (!this.page || this.page.isClosed() || this.page.url()!==a.expectedURL)) throw new Error('Page changed since preparation. Review a fresh action.');
    this.confirmations.entries.clear(); // Other proposals can be stale after this action.
    this.lock=true;clearTimeout(this.idle);
    try {return a.tool==='phone'?await this.phone(a):await this.browse(a);}finally {
      this.lock=false;
      if(this.browser) {this.idle=setTimeout(()=>{if(!this.lock)void this.close();},120000);this.idle.unref();}
    }
  }
  async phone(a) {
    try {
      const {stdout}=await this.exec(this.env.ADB_PATH || 'adb',phoneArgs(a),{timeout:15000,maxBuffer:5*1024*1024,encoding:a.action==='screenshot'?'buffer':'utf8',windowsHide:true});
      if(a.action==='screenshot') {
        if(!Buffer.isBuffer(stdout) || !stdout.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Device did not return a PNG');
        return {image:`data:image/png;base64,${stdout.toString('base64')}`,note:'Screenshot stays in this tab; it is not sent to the AI.'};
      }
      return {text:a.action==='devices'?clip(stdout):'ADB command completed. Inspect the phone to verify the result.'};
    } catch {throw new Error('ADB command failed. Check platform-tools, USB debugging authorization, device serial and connection.');}
  }
  async close() {
    clearTimeout(this.idle);const browser=this.browser;this.page=null;this.context=null;this.browser=null;
    if(browser) await browser.close().catch(()=>{});
    return {text:'Automation browser closed; temporary session discarded.'};
  }
  async startBrowser() {
    const h=this.memory();
    if(h.availableMB<512) throw new Error('Browser needs at least 512 MB available server RAM. Search/phone controls still work; use another host for the browser.');
    if(!this.domains.length) throw new Error('Set BROWSER_ALLOWED_HOSTS to trusted exact hostnames first.');
    const tor=(this.env.PRIVACY_MODE || 'tor')==='tor';
    // Tor is mandatory for browser automation in this version. No insecure direct browser egress.
    if(!tor) throw new Error('Browser automation requires PRIVACY_MODE=tor in this version.');
    const proxy=new URL(this.env.TOR_PROXY || 'socks5h://127.0.0.1:9050');
    if(proxy.protocol!=='socks5h:' || proxy.username || proxy.password) throw new Error('Browser requires a trusted Tor SOCKS5 proxy without credentials.');
    try {
      const {chromium}=await this.loadBrowser();
      this.browser=await chromium.launch({headless:true,chromiumSandbox:true,proxy:{server:`socks5://${proxy.host}`},args:['--disable-quic','--disable-background-networking','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE '+proxy.hostname],timeout:30000});
      this.context=await this.browser.newContext({acceptDownloads:false,serviceWorkers:'block',permissions:[],viewport:{width:1024,height:768}});
      await this.context.route('**/*',async route=>{
        try {allowedURL(route.request().url(),this.domains);if(['image','media','font'].includes(route.request().resourceType())) return await route.abort();await route.continue();}catch{await route.abort().catch(()=>{});}
      });
      await this.context.routeWebSocket('**/*',socket=>socket.close());
      this.page=await this.context.newPage();this.page.setDefaultTimeout(10000);this.page.setDefaultNavigationTimeout(20000);
      this.page.on('dialog',d=>void d.dismiss());
      this.context.on('page',page=>{if(page!==this.page)void page.close();});
      this.browser.on('disconnected',()=>{this.browser=null;this.context=null;this.page=null;});
    }catch {
      await this.close();throw new Error('Could not launch sandboxed Chromium. Run npm run browser:install on a supported host and check Tor/OS sandbox support. No unsandboxed fallback.');
    }
  }
  async snapshot() {
    if(!this.page || this.page.isClosed()) throw new Error('No open automation page. Open an allowed URL first.');
    allowedURL(this.page.url(),this.domains);
    const controls=await this.page.locator('a[href],button,input,textarea,select,[role=button]').evaluateAll(elements=>elements.slice(0,60).map(el=>{
      const parts=[];let node=el;
      for(let i=0;node && node.nodeType===1 && i<10;i++,node=node.parentElement) {
        if(node.id){parts.unshift('#'+CSS.escape(node.id));break;}
        let index=1;for(let sibling=node.previousElementSibling;sibling;sibling=sibling.previousElementSibling)if(sibling.tagName===node.tagName)index++;
        parts.unshift(node.tagName.toLowerCase()+':nth-of-type('+index+')');
      }
      return {selector:parts.join(' > '),tag:el.tagName.toLowerCase(),type:el.getAttribute('type'),label:(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || '').trim().slice(0,120)};
    }));
    return {url:this.page.url(),title:await this.page.title(),text:clip(await this.page.locator('body').innerText({timeout:5000})),controls};
  }
  async browse(a) {
    if(a.action==='close') return this.close();
    if(a.action==='open') {
      if(!this.browser) await this.startBrowser();
      try {await this.page.goto(a.url,{waitUntil:'domcontentloaded'});return await this.snapshot();}
      catch {await this.close();throw new Error('Page could not be opened. Check Tor, allowed hosts and site restrictions. Browser closed; no direct fallback.');}
    }
    if(!this.page || this.page.isClosed()) throw new Error('Open an allowed page first.');
    allowedURL(this.page.url(),this.domains);
    if(a.action==='read') return this.snapshot();
    const target=this.page.locator(a.selector);
    if(await target.count()!==1) throw new Error('Selector must match exactly one element.');
    try {
      if(a.action==='click') await target.click();
      if(a.action==='type') await target.fill(a.text);
      return {text:'Browser action dispatched. Use Read page to inspect the result.',url:this.page.url()};
    }catch {throw new Error('Browser action failed or timed out; it may have partially completed. Read the page before retrying.');}
  }
}
