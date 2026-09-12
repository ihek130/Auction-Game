const { service } = require('../lib/service.cjs');
const { redisStore } = require('../lib/store.cjs');
const handle = service(redisStore);
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  if (!['GET','POST'].includes(req.method)) { res.statusCode = 405; return res.end(JSON.stringify({error:'Method not allowed.'})); }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (JSON.stringify(body).length > 4096) { res.statusCode = 413; return res.end(JSON.stringify({error:'Request too large.'})); }
    const room = req.query?.room || new URL(req.url, 'http://localhost').searchParams.get('room');
    const result = await handle({ method: req.method, body, room, token: String(req.headers.authorization || '').replace(/^Bearer /, ''), ip: String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0] });
    res.statusCode = 200; res.end(JSON.stringify(result));
  } catch (e) {
    res.statusCode = e.status || 503;
    res.end(JSON.stringify({ error: e.status ? e.message : 'Cannot connect to the room. Check your connection and the server configuration.' }));
  }
};
