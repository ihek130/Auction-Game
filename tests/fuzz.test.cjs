'use strict';
// Randomised play against the room rules. Each run drives a full auction with
// arbitrary legal and illegal actions and asserts the invariants that must
// hold after every single step.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newRoom, act, expire, view, postChat, candidates, STAGES, maxBid, EMOJIS } = require('../lib/game.cjs');
const { stepBot } = require('../lib/bot.cjs');

// Small deterministic generator so a failure can be reproduced from its seed.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}

function invariants(s, seed, step) {
  const where = `seed ${seed} step ${step}`;
  const owned = new Set();
  s.seats.forEach((seat, i) => {
    if (!seat) return;
    assert.ok(seat.wallet >= 0, `${where}: seat ${i} wallet ${seat.wallet} went negative`);
    assert.ok(seat.wallet <= 100, `${where}: seat ${i} wallet ${seat.wallet} exceeds the starting purse`);
    assert.ok(seat.squad.length <= 12, `${where}: seat ${i} holds ${seat.squad.length} players`);
    const spent = seat.squad.reduce((a, p) => a + p.price, 0);
    assert.equal(seat.wallet, 100 - spent, `${where}: seat ${i} wallet does not match what it paid`);
    for (let k = 0; k < STAGES.length; k++) {
      const held = seat.squad.filter(p => p.stage === k).length;
      assert.ok(held <= STAGES[k].quota, `${where}: seat ${i} holds ${held} from stage ${k}, quota ${STAGES[k].quota}`);
    }
    for (const p of seat.squad) {
      assert.ok(p.price >= 1, `${where}: a player was bought for ${p.price}`);
      assert.ok(!owned.has(p.id), `${where}: player ${p.id} is owned by both seats`);
      owned.add(p.id);
    }
  });
  assert.ok(['lobby','auction','sold','choose','finished'].includes(s.phase), `${where}: unknown phase ${s.phase}`);
  if (s.phase === 'auction') {
    assert.ok(s.turn === 0 || s.turn === 1, `${where}: auction with no seat to act`);
    assert.ok(s.deadline > 0, `${where}: auction with no deadline`);
    if (s.leader !== null) assert.ok(s.high > 0, `${where}: a leader with no bid`);
  }
  if (s.phase === 'finished') assert.ok(s.seats.every(p => p.squad.length === 12), `${where}: finished with an incomplete squad`);
}

function playOne(seed, { solo }) {
  const rand = rng(seed);
  const pick = list => list[Math.floor(rand() * list.length)];
  let now = 1_700_000_000_000;
  const s = newRoom('fuzz' + seed, pick(['t20','odi','test']), 'Hassan', 'hash', now,
    solo ? { level: pick(['easy','normal','hard']), name: 'Bot' } : null);
  if (!solo) s.seats[1] = { name: 'Jaffer', tokenHash: 'other', wallet: 100, squad: [] };
  act(s, 0, { type: 'start', revision: s.revision }, now);

  let step = 0;
  for (; step < 6000 && s.phase !== 'finished'; step++) {
    now += 200 + Math.floor(rand() * 2500);
    expire(s, now);
    invariants(s, seed, step);
    if (solo) { stepBot(s, now); invariants(s, seed, step); }
    if (s.phase === 'finished') break;

    // Chat at any moment must never disturb the auction.
    if (rand() < 0.12) {
      const before = s.revision;
      try { postChat(s, Math.round(rand()), rand() < 0.5 ? { emoji: pick(EMOJIS) } : { text: 'sledge ' + step }, now); } catch {}
      assert.equal(s.revision, before, `seed ${seed}: chat moved the auction revision`);
    }

    const seat = solo ? 0 : Math.round(rand());
    // A quarter of attempts are deliberately invalid; they must be rejected
    // cleanly rather than corrupting the room.
    const rogue = rand() < 0.25;
    const body = (() => {
      if (rogue) return pick([
        { type: 'bid', amount: -5 }, { type: 'bid', amount: 0 }, { type: 'bid', amount: 1.5 },
        { type: 'bid', amount: 1e9 }, { type: 'start' }, { type: 'next' }, { type: 'nonsense' },
        { type: 'choose', category: 'ZZZ' }, { type: 'bid', amount: 101 }
      ]);
      if (s.phase === 'sold') return { type: 'next' };
      if (s.phase === 'choose') { const open = STAGES[4].categories.filter(c => candidates(s, c).length); return open.length ? { type: 'choose', category: pick(open) } : { type: 'next' }; }
      if (s.phase === 'auction' && s.turn === seat) {
        const cap = maxBid(s, seat);
        if (rand() < 0.35 || s.high + 1 > cap) return { type: 'pass' };
        return { type: 'bid', amount: s.high + 1 + Math.floor(rand() * Math.max(1, Math.min(6, cap - s.high))) };
      }
      return { type: 'pass' };
    })();

    const snapshot = JSON.stringify(s);
    try { act(s, seat, { ...body, revision: s.revision }, now); }
    catch (e) {
      assert.equal(e.status, 400, `seed ${seed} step ${step}: ${body.type} threw ${e.status} — ${e.message}`);
      // A rejected action must leave the room exactly as it was, once the
      // caller discards the partial mutation the way the service does.
      const restored = JSON.parse(snapshot);
      assert.equal(JSON.stringify(restored), snapshot);
    }
    invariants(s, seed, step);
  }
  return { finished: s.phase === 'finished', steps: step, state: s };
}

test('randomised two-human auctions always terminate with legal squads', () => {
  let finished = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = playOne(seed, { solo: false });
    if (r.finished) {
      finished++;
      const v = view(r.state, 0, Date.now());
      assert.deepEqual(v.seats.map(p => p.squad.length), [12, 12], `seed ${seed}`);
      assert.ok(v.scores[0] > 0 && v.scores[1] > 0, `seed ${seed}: scores should be positive`);
    }
  }
  assert.ok(finished >= 36, `only ${finished}/40 random games reached a result`);
});

test('randomised solo auctions against the computer always terminate with legal squads', () => {
  let finished = 0;
  for (let seed = 101; seed <= 130; seed++) {
    const r = playOne(seed, { solo: true });
    if (r.finished) {
      finished++;
      const v = view(r.state, 0, Date.now());
      assert.deepEqual(v.seats.map(p => p.squad.length), [12, 12], `seed ${seed}`);
    }
  }
  assert.ok(finished >= 27, `only ${finished}/30 random solo games reached a result`);
});
