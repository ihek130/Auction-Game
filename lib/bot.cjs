'use strict';
// Computer opponent.
//
// The bot has no privileged information: it reads the same room state a human
// seat can see and never looks at the shuffled deck or unrevealed players.
//
// It is driven lazily. Nothing runs on a timer server-side, so `stepBot` is
// called on every request (exactly like deadline expiry) and applies whatever
// moves the bot is due. Its thinking time is derived from the room state
// rather than stored, so two racing requests compute the same move.
const { randomInt, createHash } = require('node:crypto');
const { playerPool, FORMATS } = require('./data.cjs');
const { canBuy, maxBid, candidates, STAGES, TURN_MS, act } = require('./game.cjs');
const { skills, fills } = require('./rating.cjs');

// A higher level values better; it does not simply bid higher.
// `grade` scales overall spending. `focus` curves spending towards the best
// player available rather than spreading the purse evenly. `open` and `step`
// are bidding discipline: paying more than you had to is how a purse is
// wasted, so a stronger level opens lower and raises in smaller increments.
const LEVELS = {
  easy: { name: 'Rookie', grade: 0.76, focus: 0.8, noise: 0.34, open: 0.42, step: 3, think: [1500, 3200], emoji: 0.25 },
  normal: { name: 'Pro', grade: 1.02, focus: 1.5, noise: 0.14, open: 0.16, step: 1, think: [1200, 2600], emoji: 0.35 },
  hard: { name: 'Legend', grade: 1.08, focus: 1.65, noise: 0.07, open: 0.12, step: 1, think: [900, 2000], emoji: 0.45 }
};
const NAMES = { easy: 'Rookie Raj 🤖', normal: 'Pro Priya 🤖', hard: 'Legend Lara 🤖' };
const WON = ['🔥', '💪', '😎', '🤑', '🏏', '🎯'];
const LOST = ['😤', '😮‍💨', '🫡', '😅', '👏'];
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

// Stable pseudo-random in [0,1) for a given room moment. Two concurrent
// requests reading the same state derive the same value, so a lost CAS race
// never produces a different bot move.
function stable(s, salt) {
  const h = createHash('sha256').update(`${s.id}:${s.lot}:${s.revision}:${salt}`).digest();
  return h.readUInt32BE(0) / 0x100000000;
}

function level(s, i) { return LEVELS[s.seats[i]?.bot?.level] || LEVELS.normal; }

// How badly the bot still needs this kind of cricketer, as a multiplier.
// Shortfalls against the format plan make a player more valuable; a box
// already ticked makes them worth a little less.
function needFor(s, i, player) {
  const targets = FORMATS[s.format].targets;
  const squad = s.seats[i].squad.map(x => playerPool[x.id]);
  const slotsLeft = 12 - squad.length;
  let need = 1;
  for (const key of Object.keys(targets)) {
    if (!fills(player, key)) continue;
    const short = targets[key] - squad.filter(p => fills(p, key)).length;
    if (short > 0) need += Math.min(0.45, (short / targets[key]) * 0.45);
    else need -= 0.12;
  }
  // Late in the auction, filling the squad at all matters more than shopping.
  if (slotsLeft <= 3) need += 0.15;
  return clamp(need, 0.55, 1.9);
}

// The most the bot is prepared to pay for the player on the block.
function valuation(s, i, now) {
  const seat = s.seats[i];
  const player = playerPool[s.current];
  const cfg = level(s, i);
  const slotsLeft = 12 - seat.squad.length;
  const perSlot = seat.wallet / Math.max(1, slotsLeft);
  // Where this player sits against the others still available in the stage.
  const pool = candidates(s).map(id => playerPool[id].ratings[s.format]);
  const rating = player.ratings[s.format];
  const best = Math.max(rating, ...pool, 1);
  const floor = Math.min(rating, ...pool, best - 1);
  const standing = clamp((rating - floor) / Math.max(1, best - floor), 0, 1);
  // A scarce category the bot must still fill is worth stretching for.
  const scarcity = clamp(1 + (STAGES[s.stage].quota - pool.length / 6) * 0.04, 0.9, 1.35);
  const noise = 1 + (stable(s, 'value') * 2 - 1) * cfg.noise;
  // Spending curve: filler is bought cheaply so the purse survives for the
  // players who actually move the score.
  const appetite = 0.35 + 1.95 * Math.pow(standing, cfg.focus);
  const raw = perSlot * appetite * needFor(s, i, player) * scarcity * cfg.grade * noise;
  return clamp(Math.round(raw), 1, maxBid(s, i));
}

// Decide the bot's move on the current lot: a bid amount, or null to pass.
function bidAmount(s, i) {
  const cfg = level(s, i);
  const ceiling = valuation(s, i);
  if (s.high >= ceiling) return null;
  if (s.high === 0) {
    // Open well under the ceiling rather than showing the whole hand.
    const opening = Math.max(1, Math.round(ceiling * cfg.open * (0.7 + stable(s, 'open') * 0.6)));
    return Math.min(opening, ceiling, maxBid(s, i));
  }
  // Raise by the smallest step the level is disciplined enough to use. A
  // little irregularity keeps it from reading as a machine.
  const step = 1 + randomInt(0, cfg.step);
  return Math.min(s.high + step, ceiling, maxBid(s, i));
}

// Wildcard stage: pick the category that best repairs the squad's shape and
// still has players left in the pool.
function chooseCategory(s, i) {
  const open = STAGES[4].categories.filter(c => candidates(s, c).length);
  if (!open.length) return null;
  const scored = open.map(category => {
    const pool = candidates(s, category).map(id => playerPool[id]);
    const bestRating = Math.max(...pool.map(p => p.ratings[s.format]));
    const sample = pool.find(p => p.ratings[s.format] === bestRating);
    return { category, value: bestRating * needFor(s, i, sample) };
  });
  scored.sort((a, b) => b.value - a.value);
  return scored[0].category;
}

// Always stamp with the request clock the rest of the room uses, never a
// second clock of our own.
function say(s, i, text, now) {
  s.chat.push({ seat: i, text, at: now, emoji: true, bot: true });
  if (s.chat.length > 60) s.chat.shift();
  s.chatSeq = (s.chatSeq || 0) + 1;
}

// Occasional reaction after a lot settles, so the bot feels present.
function react(s, i, now) {
  const cfg = level(s, i);
  if (!s.outcome || s.outcome.reacted) return;
  s.outcome.reacted = true;
  if (stable(s, 'react') > cfg.emoji) return;
  const list = s.outcome.type === 'sold' && s.outcome.buyer === i ? WON : LOST;
  say(s, i, list[randomInt(list.length)], now);
}

// A light reply when the human says something, so chatting with the computer
// is not talking to a wall. Emoji only, and never more than one per message.
const REPLIES = ['👀', '😏', '🤝', '🫡', '🔥', '😂'];
function banter(s, i, now) {
  const last = s.chat.at(-1);
  if (!last || last.seat === i) return false;
  if (s.repliedTo === last.at) return false;
  s.repliedTo = last.at;
  if (stable(s, 'banter:' + last.at) > level(s, i).emoji) return false;
  say(s, i, REPLIES[randomInt(REPLIES.length)], now);
  return true;
}

function botSeat(s) { return s.seats.findIndex(p => p?.bot); }

// Apply every bot move that is due. Returns true when the state changed and
// must be written back.
function stepBot(s, now) {
  const i = botSeat(s);
  if (i < 0) return false;
  let changed = banter(s, i, now);
  // Bounded: each iteration either advances the lot or returns.
  for (let guard = 0; guard < 40; guard++) {
    if (s.phase === 'sold') { const before = s.chatSeq; react(s, i, now); if (s.chatSeq !== before) changed = true; break; }
    if (s.turn !== i) break;
    if (s.phase === 'choose') {
      const category = chooseCategory(s, i);
      if (!category) break;
      act(s, i, { type: 'choose', category, revision: s.revision }, now);
      changed = true;
      continue;
    }
    if (s.phase !== 'auction') break;
    const cfg = level(s, i);
    // Turn started TURN_MS before the deadline; act once the think time is up.
    const think = cfg.think[0] + stable(s, 'think') * (cfg.think[1] - cfg.think[0]);
    if (now < s.deadline - TURN_MS + think) break;
    if (now >= s.deadline) break; // the expiry pass will handle this turn
    const amount = canBuy(s, i) ? bidAmount(s, i) : null;
    if (amount && amount > s.high) act(s, i, { type: 'bid', amount, revision: s.revision }, now);
    else act(s, i, { type: 'pass', revision: s.revision }, now);
    changed = true;
  }
  return changed;
}

module.exports = { stepBot, botSeat, LEVELS, NAMES, valuation, chooseCategory };
