'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { service } = require('./lib/service.cjs');
const { memoryStore, redisStore } = require('./lib/store.cjs');
// In-memory rooms are explicitly local only; the Vercel API always uses Redis.
const handle = service(process.env.UPSTASH_REDIS_REST_URL ? redisStore : memoryStore());
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.mp3':'audio/mpeg'};
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  if(url.pathname==='/api/room') {
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    try {
      if(!['GET','POST'].includes(req.method)) {res.statusCode=405;return res.end('{}');}
      let raw=''; for await (const chunk of req) {raw+=chunk;if(raw.length>4096) {res.statusCode=413;return res.end('{}');}}
      const result=await handle({method:req.method,body:raw?JSON.parse(raw):{},room:url.searchParams.get('room'),token:String(req.headers.authorization||'').replace(/^Bearer /,''),ip:req.socket.remoteAddress});
      res.end(JSON.stringify(result));
    }catch(e){res.statusCode=e.status||503;res.end(JSON.stringify({error:e.message}));}
    return;
  }
  const allowed = {'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg','/audio/babar-azam.mp3':'audio/babar-azam.mp3'};
  if(!allowed[url.pathname]) {res.statusCode=404;return res.end('Not found');}
  const file=path.join(__dirname,'public',allowed[url.pathname]);
  // Read from disk on every request and never kept by the browser, so a tab
  // that reloads itself after a commit gets the new code, not a cached copy.
  res.setHeader('Content-Type',types[path.extname(file)]);res.setHeader('Cache-Control','no-cache');res.end(fs.readFileSync(file));
});
// Listen on every interface so a phone on the same Wi-Fi can join a local
// game; set HOST=127.0.0.1 to keep it to this machine only.
if(require.main===module) server.listen(Number(process.env.PORT)||3000,process.env.HOST||'0.0.0.0',()=>{
  const port=server.address().port;
  const lan=Object.values(require('node:os').networkInterfaces()).flat().filter(n=>n&&n.family==='IPv4'&&!n.internal).map(n=>`http://${n.address}:${port}`);
  console.log('Cricket Auction: http://localhost:'+port+' (local rooms reset when this process stops)');
  if(lan.length&&(process.env.HOST||'0.0.0.0')==='0.0.0.0') console.log('On your phone (same Wi-Fi): '+lan.join('  or  '));
});
module.exports=server;
