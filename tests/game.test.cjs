'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newRoom, act, expire, view, STAGES, maxBid } = require('../lib/game.cjs');
const { playerPool } = require('../lib/data.cjs');
const { service } = require('../lib/service.cjs');
const { memoryStore } = require('../lib/store.cjs');
function game(format='t20') {
  const s = newRoom('a'.repeat(24),format,'Hassan','host',1000);
  s.seats[1]={name:'Jaffer',tokenHash:'guest',wallet:100,squad:[]};
  act(s,0,{type:'start',revision:s.revision},1000);return s;
}
function action(s,i,type,extra={},now=1001) {act(s,i,{type,revision:s.revision,...extra},now);}
test('pool has 148 unique players and enough specialists for every format',()=>{
  assert.equal(playerPool.length,148);assert.equal(new Set(playerPool.map(p=>p.name)).size,148);
  for(const f of ['t20','odi','test']) for(const st of STAGES.slice(0,4)) assert.ok(playerPool.filter(p=>p.ratings[f]>0 && st.categories.includes(p.category)).length>=st.quota*2);
});
test('open ascending bids change turns, pass charges only the winner once',()=>{
  const s=game(); action(s,0,'bid',{amount:5});assert.equal(s.turn,1);assert.deepEqual(s.seats.map(p=>p.wallet),[100,100]);
  assert.throws(()=>action(s,1,'bid',{amount:5}),/higher/);
  action(s,1,'bid',{amount:10});assert.equal(s.turn,0);
  action(s,0,'pass');assert.equal(s.phase,'sold');assert.deepEqual(s.seats.map(p=>p.wallet),[100,90]);
  assert.equal(s.seats[1].squad.length,1);assert.throws(()=>action(s,0,'pass'),/turn/);assert.equal(s.seats[1].wallet,90);
});
test('rejects zero, decimals, oversized bids, wrong turns and stale revisions',()=>{
  const s=game();for(const amount of [0,-1,1.5,NaN,Infinity,'5']) assert.throws(()=>action(s,0,'bid',{amount}));
  assert.equal(maxBid(s,0),89);assert.throws(()=>action(s,0,'bid',{amount:90}),/remaining/);
  assert.throws(()=>action(s,1,'bid',{amount:2}),/turn/);
  assert.throws(()=>act(s,0,{type:'bid',amount:3,revision:-1},1001),/changed/);
  action(s,0,'bid',{amount:89});assert.equal(s.phase,'sold');assert.equal(s.seats[0].wallet,11);
});
test('30-second deadline resets on raises; expiry passes and cannot double-charge',()=>{
  const s=game();assert.equal(s.deadline,31000);
  action(s,0,'bid',{amount:5},11000);assert.equal(s.deadline,41000);
  assert.equal(expire(s,40999),false);assert.equal(expire(s,41000),true);
  assert.equal(s.phase,'sold');assert.equal(s.seats[0].wallet,95);assert.equal(expire(s,90000),false);
  const t=game();expire(t,61000);assert.equal(t.phase,'sold');assert.equal(t.outcome.type,'unsold');assert.deepEqual(t.seats.map(p=>p.wallet),[100,100]);
});
test('unbid pass transfers turn and remaining bidder buys at their own price',()=>{
  const s=game();action(s,0,'pass');assert.equal(s.turn,1);action(s,1,'bid',{amount:1});assert.equal(s.phase,'sold');assert.equal(s.seats[1].wallet,99);
});
test('complete simulations enforce all category quotas and finish only at 12 each',()=>{
  for(const f of ['t20','odi','test']) for(let run=0;run<12;run++) {
    const s=game(f);let safety=0, lastStage=0;const ids=new Set();
    while(s.phase!=='finished') {
      assert.ok(++safety<300);assert.ok(s.stage>=lastStage);lastStage=s.stage;
      assert.equal(view(s,0,1001).winner,null);
      if(s.phase==='choose') {action(s,s.turn,'choose',{category:['BAT','AR','FAST','SPIN','WK'][run%5]});continue;}
      if(s.phase==='sold') {action(s,0,'next');continue;}
      assert.ok(STAGES[s.stage].categories.includes(playerPool[s.current].category));
      assert.ok(playerPool[s.current].ratings[f]>0);
      const active=s.turn;
      if(s.high) action(s,active,'pass');
      else action(s,active,'bid',{amount:1+(run%3)});
      for(const p of s.seats) {
        assert.ok(p.wallet>=12-p.squad.length);
        STAGES.forEach((st,k)=>assert.ok(p.squad.filter(x=>x.stage===k).length<=st.quota));
        if(s.stage>0) STAGES.slice(0,s.stage).forEach((st,k)=>assert.equal(p.squad.filter(x=>x.stage===k).length,st.quota));
      }
    }
    for(const p of s.seats) {
      assert.equal(p.squad.length,12);assert.equal(100-p.wallet,p.squad.reduce((n,x)=>n+x.price,0));
      assert.deepEqual(STAGES.map((_,k)=>p.squad.filter(x=>x.stage===k).length),[5,2,3,1,1]);
      for(const x of p.squad){assert.ok(!ids.has(x.id));ids.add(x.id);}
    }
    assert.ok([0,1,-1].includes(view(s,0,1001).winner));
  }
});
test('public room snapshots hide tokens, the shuffled deck and unrevealed names',()=>{
  const s=game();const v=view(s,0,1001);assert.equal(v.deck,undefined);assert.equal(v.seats[0].tokenHash,undefined);
  assert.ok(!JSON.stringify(v).includes('tokenHash'));assert.equal(v.scores,null);assert.equal(v.current.id,s.current);
});
test('room service allows exactly two seats and atomic bids under races',async()=>{
  const store=memoryStore(), handle=service(store);
  const host=await handle({method:'POST',body:{type:'create',name:'Hassan',format:'odi'}});const room=host.state.id;
  const guests=await Promise.allSettled(['Jaffer','Third player'].map(name=>handle({method:'POST',room,body:{type:'join',name}})));
  assert.equal(guests.filter(x=>x.status==='fulfilled').length,1);const guest=guests.find(x=>x.status==='fulfilled').value;
  await assert.rejects(()=>handle({method:'GET',room,token:'forged'}),/Join/);
  const hs=await handle({method:'GET',room,token:host.token});
  const started=await handle({method:'POST',room,token:host.token,body:{type:'start',revision:hs.state.revision}});
  const bid={type:'bid',amount:5,revision:started.state.revision};
  const raced=await Promise.all([1,2].map(()=>handle({method:'POST',room,token:host.token,body:bid})));
  assert.equal(raced.filter(x=>x.error).length,1);
  const gs=await handle({method:'GET',room,token:guest.token});assert.equal(gs.state.high,5);assert.equal(gs.state.turn,1);
  const wrong=await handle({method:'POST',room,token:host.token,body:{type:'pass',revision:gs.state.revision,seat:1}});assert.match(wrong.error,/turn/);
  const sold=await handle({method:'POST',room,token:guest.token,body:{type:'pass',revision:gs.state.revision}});assert.equal(sold.state.seats[0].wallet,95);
  assert.equal(sold.state.seats[0].squad.length,1);
});
test('expired requests settle the timer before accepting any late bid',async()=>{
  const store=memoryStore(),handle=service(store);
  const host=await handle({method:'POST',body:{type:'create',name:'A',format:'test'}});const room=host.state.id;
  await handle({method:'POST',room,body:{type:'join',name:'B'}});
  let raw=await store.get(room),s=JSON.parse(raw);action(s,0,'start',{},Date.now()-70000);await store.cas(room,raw,JSON.stringify(s));
  const result=await handle({method:'POST',room,token:host.token,body:{type:'bid',amount:5,revision:s.revision}});
  assert.match(result.error,/Time ran out/);assert.equal(result.state.phase,'sold');assert.equal(result.state.outcome.type,'unsold');assert.equal(result.state.high,0);
});
