'use strict';
const { createHash } = require('node:crypto');
const PREFIX = 'cricket:v1:';
const CAS = "if redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); return 1 else return 0 end";
async function command(args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) { const e = new Error('Add the two Upstash environment variables in Vercel, then redeploy.'); e.status = 503; throw e; }
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error('Room storage is temporarily unavailable.');
  const data = await response.json();
  if (data.error) throw new Error('Room storage rejected the request.');
  return data.result;
}
const redisStore = {
  get: id => command(['GET', PREFIX + id]),
  create: (id, value) => command(['SET', PREFIX + id, value, 'EX', 86400, 'NX']).then(x => x === 'OK'),
  cas: (id, before, after) => command(['EVAL', CAS, 1, PREFIX + id, before, after, Math.max(1, Math.ceil((JSON.parse(after).expiresAt - Date.now()) / 1000))]).then(x => x === 1),
  async limit(ip) {
    const hash = createHash('sha256').update(ip).digest('hex').slice(0,24);
    const count = await command(['EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],3600) end; return n", 1, PREFIX + 'create:' + hash]);
    return count <= 12;
  }
};
function memoryStore() {
  const rooms = new Map(); const limits = new Map();
  return {
    async get(id) { return rooms.get(id) || null; },
    async create(id, raw) { if (rooms.has(id)) return false; rooms.set(id, raw); return true; },
    async cas(id, before, after) { if (rooms.get(id) !== before) return false; rooms.set(id, after); return true; },
    async limit(ip) { const x = limits.get(ip) || { n: 0, expires: 0 }; if (Date.now() > x.expires) { x.n = 0; x.expires = Date.now() + 3600000; } x.n++; limits.set(ip, x); return x.n <= 12; }
  };
}
module.exports = { redisStore, memoryStore };
