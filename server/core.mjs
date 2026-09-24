import os from 'node:os';
import fs from 'node:fs';

export function zeroPricing(model) {
  const p = model?.pricing;
  const zero = x => (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '')) && Number.isFinite(Number(x)) && Number(x) === 0;
  return Boolean(p && zero(p.prompt) && zero(p.completion) && Object.values(p).every(zero));
}
export function validateModel(catalog, id) {
  const model = catalog?.data?.find(m => m.id === id);
  if (!model || !zeroPricing(model)) throw new Error('Free-only guard: selected model has missing, unknown, or nonzero pricing. No request sent.');
  return model;
}
export function profile(total, free) {
  const low = total < 2 * 1024 ** 3 || free < 384 * 1024 ** 2;
  return {mode: low ? 'lite' : 'standard', totalMB: Math.round(total / 1024 ** 2), availableMB: Math.round(free / 1024 ** 2), maxMessages: low ? 6 : 16, maxTokens: low ? 384 : 1024, maxChars: low ? 4000 : 12000};
}
export function health() {
  let total = os.totalmem(), free = os.freemem();
  // Linux containers: respect cgroup limits instead of just host memory.
  for (const [limit, usage] of [['/sys/fs/cgroup/memory.max','/sys/fs/cgroup/memory.current'], ['/sys/fs/cgroup/memory/memory.limit_in_bytes','/sys/fs/cgroup/memory/memory.usage_in_bytes']]) {
    try { const l = Number(fs.readFileSync(limit,'utf8')), u = Number(fs.readFileSync(usage,'utf8')); if (Number.isFinite(l) && l > 0 && l < total) { total = l; free = Math.min(free, Math.max(0,l-u)); } } catch {}
  }
  return profile(total, free);
}
export function messages(input, p) {
  if (!Array.isArray(input) || !input.length || input.length > 32) throw new Error('Provide 1–32 messages.');
  if (input.some(m => !m || !['user','assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 12000)) throw new Error('Invalid message.');
  if (input.at(-1).role !== 'user') throw new Error('Last message must be from user.');
  let budget = p.maxChars; const result = [];
  for (const m of input.slice(-p.maxMessages).reverse()) {
    if (!budget) break;
    const content = m.content.slice(-budget); budget -= content.length; result.unshift({role:m.role,content});
  }
  return [{role:'system',content:'You are JARVIS, a helpful concise assistant. Reply in the user’s language. You have no direct file or device access. Live search may be supplied separately. Automation is performed only through the user-confirmed controls, not by your chat responses. Never claim you performed an action without an actual tool result. Do not ask for credentials.'}, ...result];
}
