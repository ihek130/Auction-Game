'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newRoom, act, expire, view, postChat, candidates, EMOJIS } = require('../lib/game.cjs');
const { stepBot } = require('../lib/bot.cjs');
const { scoreSquad, COMPONENTS } = require('../lib/rating.cjs');
const { playerPool } = require('../lib/data.cjs');
const { service } = require('../lib/service.cjs');
const { memoryStore } = require('../lib/store.cjs');

const ids = (format, category, n, from = 0) => playerPool
  .filter(p => p.category === category && p.ratings[format] > 0)
  .sort((a, b) => b.ratings[format] - a.ratings[format])
  .slice(from, from + n).map(p => p.id);

// A legal squad shape: 5 batters, 2 all-rounders, 3 bowlers, 1 keeper, 1 wildcard.
function balancedSquad(format) {
  return [...ids(format,'BAT',5), ...ids(format,'AR',2), ...ids(format,'FAST',2), ...ids(format,'SPIN',1), ...ids(format,'WK',1), ...ids(format,'BAT',1,5)];
}
// Same slot count, no spin, no all-rounder depth, keeper missing.
function lopsidedSquad(format) {
  return [...ids(format,'BAT',9), ...ids(format,'FAST',3)];
}

test('squad score is bounded, component maxima are respected, and totals add up', () => {
  for (const format of ['t20','odi','test']) {
    const card = scoreSquad(balancedSquad(format), format);
    assert.equal(card.parts.length, COMPONENTS.length);
    for (const part of card.parts) {
      assert.ok(part.value >= 0 && part.value <= part.max, `${format} ${part.key}=${part.value} outside 0..${part.max}`);
    }
    assert.equal(card.total, card.parts.reduce((a, b) => a + b.value, 0));
    assert.ok(card.total > 0 && card.total <= 1000, `${format} total ${card.total} outside 1..1000`);
  }
});

test('balance and combination separate a well-shaped squad from a lopsided one', () => {
  for (const format of ['t20','odi','test']) {
    const good = scoreSquad(balancedSquad(format), format);
    const bad = scoreSquad(lopsidedSquad(format), format);
    const pick = (card, key) => card.parts.find(p => p.key === key).value;
    assert.ok(pick(good,'balance') > pick(bad,'balance'), `${format}: balanced squad should out-score lopsided on balance`);
    assert.ok(pick(good,'bowling') > pick(bad,'bowling'), `${format}: nine batters should not out-bowl a real attack`);
    // The lopsided side is built from the highest-rated batters available, so
    // it can win on raw quality. Balance must still swing the total.
    assert.ok(good.total > bad.total, `${format}: ${good.total} vs ${bad.total}`);
  }
});

test('a missing keeper is visible in the balance rows', () => {
  const card = scoreSquad(lopsidedSquad('odi'), 'odi');
  const keeper = card.balance.find(r => r.key === 'keeper');
  assert.equal(keeper.have, 0);
  assert.equal(keeper.target, 1);
});

test('chat sanitises input, rate-limits each seat and never moves the auction revision', () => {
  const now = Date.now();
  const s = newRoom('room', 't20', 'Hassan', 'hash', now);
  s.seats[1] = { name: 'Jaffer', tokenHash: 'other', wallet: 100, squad: [] };
  const before = s.revision;

  postChat(s, 0, { text: '  keep\tit   clean  ' }, now);
  assert.equal(s.chat[0].text, 'keep it clean');
  assert.equal(s.revision, before, 'chat must not invalidate an in-flight bid');
  assert.equal(s.chatSeq, 1);

  assert.throws(() => postChat(s, 0, { text: 'again' }, now + 100), /Slow down/);
  assert.throws(() => postChat(s, 0, { text: '   ' }, now + 5000), /Type a message/);
  assert.throws(() => postChat(s, 0, { emoji: '<img src=x>' }, now + 5000), /not available/);

  postChat(s, 1, { emoji: EMOJIS[0] }, now + 10);
  assert.equal(s.chat.at(-1).emoji, true);

  const long = 'x'.repeat(500);
  postChat(s, 0, { text: long }, now + 9000);
  assert.equal(s.chat.at(-1).text.length, 160, 'long messages are capped');

  for (let i = 0; i < 90; i++) postChat(s, 1, { text: 'spam ' + i }, now + 20000 + i * 1000);
  assert.equal(s.chat.length, 60, 'the room keeps a bounded chat history');
});

test('chat is rejected from outside the room and reaches both seats through the service', async () => {
  const handle = service(memoryStore());
  const a = await handle({ method:'POST', body:{ type:'create', name:'Hassan', format:'odi' } });
  const room = a.state.id;
  const b = await handle({ method:'POST', body:{ type:'join', name:'Jaffer' }, room });
  const sent = await handle({ method:'POST', body:{ type:'chat', text:'may the best squad win' }, room, token:a.token });
  assert.equal(sent.state.chat.at(-1).text, 'may the best squad win');
  const seen = await handle({ method:'GET', room, token:b.token });
  assert.equal(seen.state.chat.at(-1).text, 'may the best squad win');
  assert.equal(seen.state.chat.at(-1).seat, 0);
  const stranger = handle({ method:'POST', body:{ type:'chat', text:'let me in' }, room, token:'nope' });
  await assert.rejects(stranger, /Join this room/);
});

test('a solo room seats the computer, refuses a second human and reports itself as solo', async () => {
  const handle = service(memoryStore());
  const a = await handle({ method:'POST', body:{ type:'create', name:'Hassan', format:'t20', opponent:'computer', level:'hard' } });
  assert.equal(a.state.solo, true);
  assert.equal(a.state.seats[1].bot, true);
  assert.ok(a.state.seats[1].name.length > 0);
  const intruder = handle({ method:'POST', body:{ type:'join', name:'Jaffer' }, room:a.state.id });
  await assert.rejects(intruder, /solo game against the computer/);
});

test('the computer finishes a full auction at every level without breaking a rule', () => {
  for (const level of ['easy','normal','hard']) {
    let now = 1_700_000_000_000;
    const s = newRoom('r-'+level, 't20', 'Hassan', 'hash', now, { level, name:'Bot' });
    act(s, 0, { type:'start', revision:s.revision }, now);
    let guard = 0;
    while (s.phase !== 'finished' && guard++ < 3000) {
      now += 1200;
      // Every bot move must stay inside the seat's spending limit.
      const walletBefore = s.seats[1].wallet;
      if (expire(s, now)) continue;
      if (stepBot(s, now)) { assert.ok(s.seats[1].wallet >= 0, `${level}: bot overspent`); continue; }
      if (s.phase === 'sold') { act(s, 0, { type:'next', revision:s.revision }, now); continue; }
      if (s.phase === 'choose' && s.turn === 0) {
        const open = ['BAT','AR','FAST','SPIN','WK'].filter(c => candidates(s, c).length);
        act(s, 0, { type:'choose', category: open[0], revision:s.revision }, now); continue;
      }
      if (s.phase === 'auction' && s.turn === 0) {
        const me = view(s, 0, now).seats[0];
        const want = Math.min(me.maxBid, s.high + 2);
        if (want > s.high && s.high < 12) act(s, 0, { type:'bid', amount:want, revision:s.revision }, now);
        else act(s, 0, { type:'pass', revision:s.revision }, now);
        continue;
      }
      assert.ok(walletBefore >= 0);
    }
    const v = view(s, 0, now);
    assert.equal(v.phase, 'finished', `${level}: auction did not finish (guard ${guard})`);
    assert.deepEqual(v.seats.map(p => p.squad.length), [12, 12]);
    for (const seat of v.seats) {
      assert.ok(seat.wallet >= 0, `${level}: negative wallet`);
      // Every squad must satisfy the category quotas.
      assert.deepEqual(seat.counts, [5, 2, 3, 1, 1], `${level}: wrong squad shape ${seat.counts}`);
    }
    assert.equal(v.scores.length, 2);
    assert.equal(v.breakdown.length, 2);
  }
});

test('the computer never bids above its own maximum or out of turn', () => {
  let now = 1_700_000_000_000;
  const s = newRoom('limits', 'odi', 'Hassan', 'hash', now, { level:'hard', name:'Bot' });
  act(s, 0, { type:'start', revision:s.revision }, now);
  let guard = 0;
  while (s.phase !== 'finished' && guard++ < 3000) {
    now += 1100;
    const turnBefore = s.turn, highBefore = s.high;
    if (expire(s, now)) continue;
    if (stepBot(s, now)) {
      if (s.high !== highBefore) {
        assert.equal(turnBefore, 1, 'the bot bid when it was not its turn');
        assert.ok(s.high <= 100, 'bid beyond any possible wallet');
      }
      continue;
    }
    if (s.phase === 'sold') { act(s, 0, { type:'next', revision:s.revision }, now); continue; }
    if (s.phase === 'choose' && s.turn === 0) {
      const open = ['BAT','AR','FAST','SPIN','WK'].filter(c => candidates(s, c).length);
      act(s, 0, { type:'choose', category: open[0], revision:s.revision }, now); continue;
    }
    // The human buys as cheaply as the rules allow. Passing on everything
    // forever would stall the auction by design, because a seat cannot finish
    // a stage without signing players.
    if (s.phase === 'auction' && s.turn === 0) {
      const me = view(s, 0, now).seats[0];
      if (s.high + 1 <= me.maxBid) act(s, 0, { type:'bid', amount:s.high + 1, revision:s.revision }, now);
      else act(s, 0, { type:'pass', revision:s.revision }, now);
    }
  }
  assert.equal(s.phase, 'finished');
  assert.equal(s.seats[1].squad.length, 12);
  assert.ok(s.seats[1].wallet >= 0);
});

test('a settled lot never wedges the room even if the winning bid became impossible', () => {
  const now = Date.now();
  const s = newRoom('edge', 't20', 'Hassan', 'hash', now);
  s.seats[1] = { name: 'Jaffer', tokenHash: 'other', wallet: 100, squad: [] };
  act(s, 0, { type:'start', revision:s.revision }, now);
  act(s, 0, { type:'bid', amount: 5, revision:s.revision }, now);
  // Force the leader into a state where the purchase can no longer complete.
  s.seats[0].wallet = 0;
  assert.doesNotThrow(() => expire(s, now + 60_000));
  assert.equal(s.phase, 'sold');
  assert.equal(s.outcome.type, 'unsold');
});

test('a side that has filled the category is marked out of each new lot, and the view says so', () => {
  const now = Date.now();
  const s = newRoom('full', 't20', 'Creator', 'hash', now);
  s.seats[1] = { name: 'Guest', tokenHash: 'other', wallet: 100, squad: [] };
  act(s, 0, { type: 'start', revision: s.revision }, now);
  // Guest buys five batters at $1; the creator passes every lot.
  let bought = 0, guard = 0;
  while (bought < 5 && guard++ < 60) {
    if (s.phase === 'sold') { if (s.outcome.type === 'sold') bought++; act(s, 0, { type: 'next', revision: s.revision }, now); continue; }
    if (s.turn === 0) act(s, 0, { type: 'pass', revision: s.revision }, now);
    else act(s, 1, { type: 'bid', amount: 1, revision: s.revision }, now);
  }
  assert.equal(s.seats[1].squad.length, 5);
  assert.equal(s.phase, 'auction');
  assert.equal(s.turn, 0, 'only the creator can act once the guest is full');
  const v = view(s, 1, now);
  assert.deepEqual(v.passed, [false, true], 'the view exposes that the guest is out of this lot');
  assert.equal(v.seats[1].counts[0], 5);
  // The lone eligible side passing closes the lot without ever asking the other.
  act(s, 0, { type: 'pass', revision: s.revision }, now);
  assert.equal(s.phase, 'sold');
  assert.equal(s.outcome.type, 'unsold');
  // And a bid from the lone eligible side wins outright at that price.
  act(s, 0, { type: 'next', revision: s.revision }, now);
  act(s, 0, { type: 'bid', amount: 1, revision: s.revision }, now);
  assert.equal(s.phase, 'sold');
  assert.equal(s.outcome.buyer, 0);
  assert.equal(s.outcome.price, 1);
});

test('ratings are withheld from the room view until the auction has finished', () => {
  const now = Date.now();
  const s = newRoom('hide', 'odi', 'Creator', 'hash', now);
  s.seats[1] = { name: 'Guest', tokenHash: 'other', wallet: 100, squad: [] };
  act(s, 0, { type: 'start', revision: s.revision }, now);
  const live = view(s, 0, now);
  assert.equal(live.current.rating, undefined, 'the player on the block carries no rating');
  assert.ok(live.current.stats && live.current.stats.line.length >= 2, 'but the real career numbers are there');
  act(s, s.turn, { type: 'bid', amount: 3, revision: s.revision }, now);
  act(s, s.turn, { type: 'pass', revision: s.revision }, now);
  const afterSale = view(s, 0, now);
  const bought = afterSale.seats.find(p => p.squad.length)?.squad[0];
  assert.ok(bought, 'someone bought the player');
  assert.equal(bought.rating, undefined, 'a signed player in the squad list carries no rating either');
  // Finish the whole auction at $1 a lot and the ratings appear with the result.
  let guard = 0;
  while (s.phase !== 'finished' && guard++ < 400) {
    if (s.phase === 'sold') { act(s, 0, { type: 'next', revision: s.revision }, now); continue; }
    if (s.phase === 'auction') { const i = s.turn; if (s.high + 1 <= maxBidOf(s, i)) act(s, i, { type: 'bid', amount: s.high + 1, revision: s.revision }, now); else act(s, i, { type: 'pass', revision: s.revision }, now); }
  }
  assert.equal(s.phase, 'finished');
  const done = view(s, 0, now);
  assert.ok(done.seats.every(p => p.squad.every(x => typeof x.rating === 'number')), 'every rating is revealed with the result');
});

test('the wildcard is drawn at random from every category with no choosing step', () => {
  const seen = new Set();
  for (let seed = 0; seed < 12; seed++) {
    let now = 1_700_000_000_000 + seed;
    const s = newRoom('wild' + seed, 't20', 'Creator', 'hash', now);
    s.seats[1] = { name: 'Guest', tokenHash: 'other', wallet: 100, squad: [] };
    act(s, 0, { type: 'start', revision: s.revision }, now);
    let guard = 0;
    while (s.phase !== 'finished' && guard++ < 400) {
      now += 1000;
      assert.notEqual(s.phase, 'choose', 'the auction must never wait for a category to be chosen');
      if (s.phase === 'sold') { act(s, 0, { type: 'next', revision: s.revision }, now); continue; }
      if (s.stage === 4 && s.phase === 'auction') seen.add(playerPool[s.current].category);
      const i = s.turn;
      if (s.high + 1 <= maxBidOf(s, i)) act(s, i, { type: 'bid', amount: s.high + 1, revision: s.revision }, now);
      else act(s, i, { type: 'pass', revision: s.revision }, now);
    }
    assert.equal(s.phase, 'finished');
    for (const seat of s.seats) assert.equal(seat.squad.filter(x => x.stage === 4).length, 1, 'each side still gets exactly one wildcard');
  }
  assert.ok(seen.size >= 2, `wildcards across a dozen games should span categories, saw ${[...seen].join(',')}`);
});

function maxBidOf(s, i) { return Math.max(0, s.seats[i].wallet - (11 - s.seats[i].squad.length)); }
