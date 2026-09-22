'use strict';
const { randomBytes, createHash } = require('node:crypto');
const { newRoom, act, expire, view, postChat, check } = require('./game.cjs');
const { stepBot, LEVELS, NAMES } = require('./bot.cjs');
const { buildId } = require('./build.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
function nameOf(value) {
  check(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 24, 'Enter a name of 1–24 characters.');
  return value.trim();
}
// Every reply carries the build that produced it, so a tab can reload itself
// when the code changes. A bare GET with no room is a tab outside any room
// asking for nothing but that.
function service(store) {
  const rooms = roomService(store);
  return async function handle(request) {
    if (request.method === 'GET' && !request.room) return { build: buildId() };
    return Object.assign(await rooms(request), { build: buildId() });
  };
}
function roomService(store) {
  return async function handle({ method, body = {}, room, token = '', ip = 'unknown' }) {
    const now = Date.now();
    if (method === 'POST' && body.type === 'create') {
      const name = nameOf(body.name);
      check(['t20','odi','test'].includes(body.format), 'Choose T20, ODI or Test.');
      let bot = null;
      if (body.opponent === 'computer') {
        const level = typeof body.level === 'string' && LEVELS[body.level] ? body.level : 'normal';
        bot = { level, name: NAMES[level] };
      }
      if (!await store.limit(ip)) { const e = new Error('Room creation limit reached. Try again in an hour.'); e.status = 429; throw e; }
      const id = randomBytes(12).toString('hex'); const seatToken = randomBytes(32).toString('hex');
      const s = newRoom(id, body.format, name, hash(seatToken), now, bot);
      check(await store.create(id, JSON.stringify(s)), 'Please try creating the room again.');
      return { token: seatToken, state: view(s, 0, now) };
    }
    check(typeof room === 'string' && /^[a-f0-9]{24}$/.test(room), 'That room code is invalid.');
    for (let retry = 0; retry < 5; retry++) {
      const raw = await store.get(room);
      if (!raw) { const e = new Error('Room not found or expired. Create a new room.'); e.status = 404; throw e; }
      const s = JSON.parse(raw); const clock = Date.now();
      check(clock < s.expiresAt, 'This room has expired. Create a new room.');
      const you = token ? s.seats.findIndex(p => p?.tokenHash && p.tokenHash === hash(token)) : -1;
      if (method === 'POST' && body.type === 'join') {
        if (you >= 0) return { state: view(s, you, clock) };
        check(!s.solo, 'This room is a solo game against the computer.');
        check(s.phase === 'lobby' && !s.seats[1], 'This room already has two players.');
        const seatToken = randomBytes(32).toString('hex');
        s.seats[1] = { name: nameOf(body.name), tokenHash: hash(seatToken), wallet: 100, squad: [] }; s.revision++;
        if (await store.cas(room, raw, JSON.stringify(s))) return { token: seatToken, state: view(s, 1, clock) };
        continue;
      }
      if (you < 0) { const e = new Error('Join this room from its invite link first.'); e.status = 401; throw e; }

      // Lazy clocks: deadline expiry first, then any computer moves that are
      // now due. Both can change the room on a plain GET, so everything is
      // written back under one compare-and-set.
      let dirty = false, note = null;
      if (expire(s, clock)) { dirty = true; note = 'Time ran out. The auction has moved on.'; }
      if (method === 'POST' && !note) {
        try {
          if (body.type === 'chat') postChat(s, you, body, clock);
          else act(s, you, body, clock);
          dirty = true;
        } catch (e) {
          if (e.status !== 400) throw e;
          // Discard any partial mutation by re-reading the stored room.
          return { error: e.message, state: view(JSON.parse(raw), you, clock) };
        }
      }
      if (stepBot(s, clock)) dirty = true;
      if (dirty && !await store.cas(room, raw, JSON.stringify(s))) continue;
      return note ? { state: view(s, you, clock), error: note } : { state: view(s, you, clock) };
    }
    const e = new Error('Another action just arrived. Please try again.'); e.status = 409; throw e;
  };
}
module.exports = { service };
