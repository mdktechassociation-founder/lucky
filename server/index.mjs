import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import {SocksProxyAgent} from 'socks-proxy-agent';
import {health, messages, validateModel} from './core.mjs';

const mode = process.env.PRIVACY_MODE || 'tor';
if (!['tor','direct'].includes(mode)) throw new Error('PRIVACY_MODE must be tor or direct');
const proxy = process.env.TOR_PROXY || 'socks5h://127.0.0.1:9050';
if (mode === 'tor' && !proxy.startsWith('socks5h://')) throw new Error('Use socks5h:// for proxy-side DNS');
const agent = mode === 'tor' ? new SocksProxyAgent(proxy) : undefined;
const model = process.env.KILO_MODEL || 'kilo-auto/free';
const token = process.env.ACCESS_TOKEN || '';
const base = 'https://api.kilo.ai/api/gateway';
let busy = false, nextRequest = 0;

// No redirects, retries, fallback hosts or direct fallback. Credentials remain server-side.
function gateway(path, body) {
  return new Promise((resolve,reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers = {'Content-Type':'application/json', 'Accept':'application/json'};
    if (process.env.KILO_API_KEY) headers.Authorization = `Bearer ${process.env.KILO_API_KEY}`;
    const req = https.request(base + path, {method:data ? 'POST':'GET',agent,headers}, res => {
      let text = '', bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; if(bytes > 4*1024*1024) {req.destroy(new Error('Gateway response too large')); return;} text += chunk; });
      res.on('error',reject);
      res.on('end', () => {
        if(res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Gateway HTTP ${res.statusCode}. Check availability, free quota or Tor restrictions; no paid fallback attempted.`));
        try { resolve(JSON.parse(text)); } catch {reject(new Error('Gateway returned invalid JSON'));}
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('Gateway timed out')), 60000);
    req.on('close',()=>clearTimeout(timer));
    req.on('error',()=>reject(new Error(`Gateway unavailable (${mode}). Check network${mode === 'tor' ? ' and Tor SOCKS service' : ''}. No fallback attempted.`)));
    req.end(data);
  });
}
function authorized(req) {
  if (!token) return true;
  const supplied = req.headers.authorization || '', expected = `Bearer ${token}`;
  return Buffer.byteLength(supplied) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(supplied),Buffer.from(expected));
}
async function body(req) {
  let text = '', size = 0;
  for await(const chunk of req) { size += chunk.length; if(size > 65536) throw new Error('Request too large (64 KB max)'); text += chunk; }
  return JSON.parse(text);
}
const assets = {'/':['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/style.css':['style.css','text/css']};
const server = http.createServer(async (req,res) => {
  res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors *; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('Cache-Control','no-store');
  const send = (status,data) => {res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  const path = new URL(req.url,'http://local').pathname;
  if (path.startsWith('/api/')) {
    if (!authorized(req)) return send(401,{error:'Enter the server access token.'});
    // Reject cross-origin browser calls; preview origin is accepted when it matches request host.
    if (req.headers.origin) { try {if(new URL(req.headers.origin).host !== req.headers.host) return send(403,{error:'Cross-origin request denied'});}catch{return send(403,{error:'Invalid origin'});} }
    if (path === '/api/health' && req.method === 'GET') return send(200,{...health(),provider:'Kilo',model,privacy:mode,freeOnly:true,authenticated:Boolean(token),note:'Server memory only; browser memory may differ.'});
    if (path === '/api/chat' && req.method === 'POST') {
      if (busy || Date.now() < nextRequest) return send(429,{error:'One request at a time; wait a moment.'});
      if (!req.headers['content-type']?.startsWith('application/json')) return send(415,{error:'JSON required'});
      busy = true;
      try {
        const input = await body(req); const p = health(); const chat = messages(input.messages,p);
        // Recheck current pricing before EVERY generation; never auto-select paid models.
        validateModel(await gateway('/models'),model);
        const result = await gateway('/chat/completions',{model,messages:chat,max_tokens:p.maxTokens,stream:false});
        const answer = result.choices?.[0]?.message?.content;
        if(typeof answer !== 'string' || !answer.trim()) throw new Error('No text response from gateway');
        send(200,{answer,model,mode:p.mode});
      } catch(e) {send(502,{error:e.message});} finally {busy = false; nextRequest = Date.now()+2000;}
      return;
    }
    return send(404,{error:'Not found'});
  }
  if(req.method !== 'GET' || !assets[path]) return send(404,{error:'Not found'});
  const [file,type] = assets[path];
  try {const data = await fs.readFile(new URL('../public/'+file,import.meta.url)); res.writeHead(200,{'Content-Type':type});res.end(data);}catch {send(500,{error:'Asset unavailable'});}
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>{
  console.log(`JARVIS listening on 0.0.0.0:${process.env.PORT || 3000} · ${mode} · free-only`);
  if (!token) console.warn('ACCESS_TOKEN is unset. Do not expose this server publicly without authentication.');
});
