'use strict';
const { randomInt } = require('node:crypto');
const { playerPool, CATEGORIES } = require('./data.cjs');
const { scoreSquad, shapeOf } = require('./rating.cjs');
const STAGES = [
  { name: 'Batters', categories: ['BAT'], quota: 5 },
  { name: 'All-rounders', categories: ['AR'], quota: 2 },
  { name: 'Bowlers · pace + spin', categories: ['FAST', 'SPIN'], quota: 3 },
  { name: 'Wicketkeepers', categories: ['WK'], quota: 1 },
  { name: 'Wildcard', categories: ['BAT', 'AR', 'FAST', 'SPIN', 'WK'], quota: 1 }
];
const TURN_MS = 30_000;
const CHAT_MAX = 60;          // messages kept per room
const CHAT_TEXT_MAX = 160;    // characters per message
const CHAT_MIN_GAP_MS = 700;  // per-seat flood guard
// Reactions both players can fire with one tap during the auction.
const EMOJIS = ['🔥', '😂', '😱', '🤑', '💪', '🏏', '🎯', '🧊', '🤝', '😭', '👏', '🐐', '🫡', '💸', '😎', '🤯'];
function check(condition, message) { if (!condition) { const e = new Error(message); e.status = 400; throw e; } }
function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = randomInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function stageCount(s, i) { return s.seats[i].squad.filter(p => p.stage === s.stage).length; }
function canBuy(s, i) { return !!s.seats[i] && s.seats[i].squad.length < 12 && stageCount(s, i) < STAGES[s.stage].quota; }
function maxBid(s, i) { return Math.max(0, s.seats[i].wallet - (11 - s.seats[i].squad.length)); }
function candidates(s, category) {
  const bought = new Set(s.seats.flatMap(p => p ? p.squad.map(x => x.id) : []));
  return playerPool.filter(p => p.ratings[s.format] > 0 && !bought.has(p.id) &&
    (category ? p.category === category : STAGES[s.stage].categories.includes(p.category))).map(p => p.id);
}
// `bot` is { level, name } when seat 1 is the computer.
function newRoom(id, format, name, tokenHash, now, bot = null) {
  check(['t20', 'odi', 'test'].includes(format), 'Choose T20, ODI or Test.');
  const opponent = bot ? { name: bot.name, tokenHash: null, wallet: 100, squad: [], bot: { level: bot.level } } : null;
  return { id, format, revision: 0, createdAt: now, expiresAt: now + 86400000,
    phase: 'lobby', stage: 0, deck: [], lot: 0, current: null, turn: null, deadline: null,
    high: 0, leader: null, passed: [false, false], history: [], outcome: null,
    chat: [], chatSeq: 0, solo: !!bot,
    seats: [{ name, tokenHash, wallet: 100, squad: [] }, opponent] };
}
function openLot(s, now, category) {
  if (!s.deck.length || category) s.deck = shuffled(candidates(s, category));
  check(s.deck.length, 'No remaining players in that category. Choose another.');
  s.current = s.deck.shift(); s.lot++; s.phase = 'auction'; s.high = 0; s.leader = null;
  s.outcome = null; s.history = []; s.passed = [!canBuy(s, 0), !canBuy(s, 1)];
  const preferred = (s.lot - 1) % 2;
  s.turn = canBuy(s, preferred) ? preferred : 1 - preferred;
  s.deadline = now + TURN_MS;
}
function next(s, now) {
  const oldStage = s.stage;
  while (s.stage < 5 && s.seats.every((p, i) => stageCount(s, i) >= STAGES[s.stage].quota)) s.stage++;
  if (s.stage === 5) { s.phase = 'finished'; s.turn = null; s.deadline = null; return; }
  if (oldStage !== s.stage) s.deck = [];
  if (s.stage === 4) {
    s.phase = 'choose'; s.current = null; s.deadline = null;
    const preferred = s.lot % 2;
    s.turn = canBuy(s, preferred) ? preferred : 1 - preferred;
    return;
  }
  openLot(s, now);
}
function settle(s) {
  s.deadline = null; s.turn = null; s.phase = 'sold';
  if (s.leader === null) { s.outcome = { type: 'unsold', text: 'Both passed. This player can return later.' }; return; }
  const i = s.leader;
  // Defensive: a leading bid is validated when it is made and nothing can
  // invalidate it before settlement. If that ever stopped holding, the lot is
  // voided rather than throwing, because settle() also runs from deadline
  // expiry where a throw would wedge the room for good.
  if (!canBuy(s, i) || s.high > maxBid(s, i)) {
    s.outcome = { type: 'unsold', text: 'That bid could no longer be completed. The player returns later.' };
    s.high = 0; s.leader = null; return;
  }
  s.seats[i].wallet -= s.high;
  s.seats[i].squad.push({ id: s.current, price: s.high, stage: s.stage });
  s.outcome = { type: 'sold', buyer: i, price: s.high };
  if (s.seats.every(p => p.squad.length === 12)) s.phase = 'finished';
}
function pass(s, i, now, timeout = false) {
  s.passed[i] = true;
  s.history.push({ seat: i, type: timeout ? 'timeout' : 'pass' });
  if (s.leader !== null || s.passed[1-i]) settle(s);
  else { s.turn = 1-i; s.deadline = now + TURN_MS; }
}
function expire(s, now) {
  let changed = false;
  while (s.phase === 'auction' && now >= s.deadline) {
    const deadline = s.deadline;
    pass(s, s.turn, deadline, true); changed = true;
  }
  if (changed) s.revision++;
  return changed;
}
// Chat is deliberately kept off the auction revision counter. A message must
// never invalidate an in-flight bid, so it bumps `chatSeq` instead and carries
// no revision of its own.
function postChat(s, i, body, now) {
  check(!!s.seats[i], 'You are not in this room.');
  const emoji = typeof body.emoji === 'string' ? body.emoji : null;
  check(!emoji || EMOJIS.includes(emoji), 'That reaction is not available.');
  let text = emoji;
  if (!text) {
    check(typeof body.text === 'string', 'Type a message first.');
    // Strip control characters, collapse runs of whitespace, then cap.
    const plain = [...body.text].map(ch => { const c = ch.codePointAt(0); return c > 31 && c !== 127 ? ch : ' '; }).join('');
    text = plain.split(' ').filter(Boolean).join(' ').slice(0, CHAT_TEXT_MAX);
    check(text.length > 0, 'Type a message first.');
  }
  const last = [...s.chat].reverse().find(m => m.seat === i);
  check(!last || now - last.at >= CHAT_MIN_GAP_MS, 'Slow down a moment before sending again.');
  s.chat.push({ seat: i, text, at: now, emoji: !!emoji });
  while (s.chat.length > CHAT_MAX) s.chat.shift();
  s.chatSeq = (s.chatSeq || 0) + 1;
}
function act(s, i, action, now) {
  check(action.revision === s.revision, 'The auction changed. Check the latest bid and try again.');
  check(!!s.seats[i], 'You are not in this room.');
  if (action.type === 'start') {
    check(i === 0 && s.phase === 'lobby' && s.seats[1], 'The host can start after both players join.'); next(s, now);
  } else if (action.type === 'next') {
    check(s.phase === 'sold', 'Finish the current auction first.'); next(s, now);
  } else if (action.type === 'choose') {
    check(s.phase === 'choose' && i === s.turn, 'Wait for your turn to choose a category.');
    check(STAGES[4].categories.includes(action.category), 'Choose a valid category.');
    openLot(s, now, action.category);
  } else {
    check(s.phase === 'auction' && i === s.turn && canBuy(s, i), 'Wait for your bidding turn.');
    check(now < s.deadline, 'Your 30 seconds have ended.');
    if (action.type === 'pass') pass(s, i, now);
    else if (action.type === 'bid') {
      check(Number.isSafeInteger(action.amount) && action.amount > 0, 'Enter a positive whole-dollar amount.');
      check(action.amount > s.high, 'Your bid must be higher than the current bid.');
      check(action.amount <= maxBid(s, i), 'Keep $1 for each remaining squad slot. Lower your bid.');
      s.high = action.amount; s.leader = i;
      s.history.push({ seat: i, type: 'bid', amount: s.high });
      // An opponent who passed or filled this category cannot bid again on this lot.
      if (s.passed[1-i] || !canBuy(s, 1-i) || maxBid(s, 1-i) <= s.high) settle(s);
      else { s.turn = 1-i; s.deadline = now + TURN_MS; }
    } else check(false, 'Unknown action.');
  }
  s.revision++;
}
function player(id, format) {
  const p = playerPool[id];
  return { id: p.id, name: p.name, flag: p.flag, country: p.country, category: p.category,
    role: CATEGORIES[p.category].singular, era: p.era, rating: p.ratings[format], stats: p.stats?.[format] || null };
}
function view(s, you, now) {
  const seats = s.seats.map((p, i) => p && ({ name: p.name, wallet: p.wallet, bot: !!p.bot,
    maxBid: p.squad.length < 12 ? maxBid(s, i) : 0,
    squad: p.squad.map(x => ({ ...player(x.id, s.format), price: x.price, stage: x.stage })),
    counts: STAGES.map((st, k) => p.squad.filter(x => x.stage === k).length),
    shape: shapeOf(p.squad.map(x => x.id), s.format) }));
  const cards = s.phase === 'finished' ? s.seats.map(p => scoreSquad(p.squad.map(x => x.id), s.format)) : null;
  const scores = cards ? cards.map(c => c.total) : null;
  let winner = null;
  if (scores) winner = scores[0] === scores[1] ? (seats[0].wallet === seats[1].wallet ? -1 : seats[0].wallet > seats[1].wallet ? 0 : 1) : scores[0] > scores[1] ? 0 : 1;
  return { id: s.id, format: s.format, revision: s.revision, expiresAt: s.expiresAt, serverTime: now, you,
    phase: s.phase, stage: s.stage, stages: STAGES, lot: s.lot, solo: !!s.solo,
    // Lets the results screen offer a rematch on the same settings.
    botLevel: s.seats.find(p => p?.bot)?.bot?.level || null,
    current: s.current === null ? null : player(s.current, s.format), turn: s.turn, deadline: s.deadline,
    high: s.high, leader: s.leader, history: s.history.slice(-12),
    // `reacted` is bookkeeping for the bot's one-shot reaction, not client data.
    outcome: s.outcome ? (({ reacted, ...rest }) => rest)(s.outcome) : null,
    chat: (s.chat || []).slice(-30), chatSeq: s.chatSeq || 0, emojis: EMOJIS,
    seats, scores, breakdown: cards, winner,
    categories: s.phase === 'choose' ? STAGES[4].categories.filter(c => candidates(s,c).length) : [] };
}
module.exports = { newRoom, act, expire, view, postChat, canBuy, maxBid, candidates, STAGES, TURN_MS, EMOJIS, check };
