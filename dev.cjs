'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { service } = require('./lib/service.cjs');
const { memoryStore, redisStore } = require('./lib/store.cjs');
// In-memory rooms are explicitly local only; the Vercel API always uses Redis.
const handle = service(process.env.UPSTASH_REDIS_REST_URL ? redisStore : memoryStore());
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
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
  const allowed = {'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};
  if(!allowed[url.pathname]) {res.statusCode=404;return res.end('Not found');}
  const file=path.join(__dirname,'public',allowed[url.pathname]);
  res.setHeader('Content-Type',types[path.extname(file)]);res.end(fs.readFileSync(file));
});
if(require.main===module) server.listen(Number(process.env.PORT)||3000,'127.0.0.1',()=>console.log('Cricket Auction: http://localhost:'+server.address().port+' (local rooms reset when this process stops)'));
module.exports=server;
