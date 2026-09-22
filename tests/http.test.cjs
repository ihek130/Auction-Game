'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
test('two independent HTTP clients create, invite, bid, pass and reconnect',async()=>{
  const server=require('../dev.cjs');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const req=async(body,room='',token='')=>{const r=await fetch(base+'/api/room?room='+room,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body?JSON.stringify(body):undefined});return {status:r.status,...await r.json()};};
  try {
    for(const url of ['/','/app.js','/styles.css','/favicon.svg','/audio/babar-azam.mp3'])assert.equal((await fetch(base+url)).status,200);
    const tune=await fetch(base+'/audio/babar-azam.mp3');assert.equal(tune.headers.get('content-type'),'audio/mpeg');assert.equal(tune.headers.get('cache-control'),'no-cache');
    // A tab outside any room can still ask which build is running, and every room reply names the same build.
    const ping=await req(null);assert.equal(ping.status,200);assert.ok(typeof ping.build==='string'&&ping.build.length>0);
    const a=await req({type:'create',name:'Hassan',format:'t20'});assert.equal(a.status,200);assert.equal(a.build,ping.build);
    const room=a.state.id;const b=await req({type:'join',name:'Jaffer'},room);
    const full=await req({type:'join',name:'Third'},room);assert.equal(full.status,400);
    const state=await req(null,room,a.token);assert.equal(state.state.seats[1].name,'Jaffer');assert.equal(state.build,ping.build);
    const start=await req({type:'start',revision:state.state.revision},room,a.token);
    const bid=await req({type:'bid',amount:6,revision:start.state.revision},room,a.token);assert.equal(bid.state.turn,1);
    const raise=await req({type:'bid',amount:9,revision:bid.state.revision},room,b.token);assert.equal(raise.state.turn,0);
    const pass=await req({type:'pass',revision:raise.state.revision},room,a.token);assert.equal(pass.state.seats[1].wallet,91);
    const reconnect=await req(null,room,b.token);assert.equal(reconnect.state.you,1);assert.equal(reconnect.state.seats[1].squad.length,1);
    const unauthorized=await req(null,room,'invalid');assert.equal(unauthorized.status,401);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
