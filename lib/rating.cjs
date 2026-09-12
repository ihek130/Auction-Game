'use strict';
// Squad scoring model.
//
// A squad is judged on six components that add up to a 1000-point scale.
// Squad quality is still the largest single component, so a strong buy is
// never wasted, but a lopsided squad loses to a balanced one of similar raw
// quality.
//
// The per-player skills below split a cricketer's format rating across
// batting, bowling and fielding according to their role. The rating itself is
// derived from real career statistics (see tools/build-ratings.cjs); this
// split is a game heuristic for scoring the auction.
const { playerPool, FORMATS, BALANCE } = require('./data.cjs');

// How much of a player's format rating counts towards batting and bowling.
const BAT_SHARE = { BAT: 1, WK: 0.94, AR: 0.78, SPIN: 0.26, FAST: 0.22 };
const BOWL_SHARE = { FAST: 1, SPIN: 1, AR: 0.8, BAT: 0.14, WK: 0.05 };
// Fielding baseline by role: keepers take catches all day, quicks and
// all-rounders patrol the boundary, specialist batters vary the most.
const FIELD_BASE = { WK: 94, AR: 88, FAST: 85, SPIN: 82, BAT: 83 };

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
// Map a value from [lo,hi] onto [0,max], flattening anything outside the band.
const band = (value, lo, hi, max) => clamp((value - lo) / (hi - lo), 0, 1) * max;
const mean = list => list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
const top = (list, n) => [...list].sort((a, b) => b - a).slice(0, n);

// Per-player skills for one format. `rating` is the 0-99 game rating built
// from that player's real record in this format.
function skills(player, format) {
  const rating = player.ratings[format];
  const bat = rating * BAT_SHARE[player.category];
  const bowl = rating * BOWL_SHARE[player.category];
  const field = clamp(FIELD_BASE[player.category] + (rating - 85) * 0.25, 60, 99);
  // Impact rewards match-winners: only the genuinely elite score here, and
  // all-rounders count more because they can win a game with bat or ball.
  const elite = Math.max(0, rating - 86);
  const impact = elite * (player.category === 'AR' ? 1.6 : 1) * (player.category === 'WK' ? 1.1 : 1);
  return { rating, bat, bowl, field, impact };
}

// Does this player count towards the given balance requirement?
function fills(player, key) {
  if (key === 'keeper') return player.category === 'WK';
  if (key === 'allround') return player.category === 'AR';
  if (key === 'batting') return ['BAT', 'WK', 'AR'].includes(player.category);
  if (key === 'bowling') return ['FAST', 'SPIN', 'AR'].includes(player.category);
  if (key === 'pace') return player.style === 'pace' || player.style === 'mixed';
  if (key === 'spin') return player.style === 'spin' || player.style === 'mixed';
  return false;
}

// Balance and combination: how close the squad comes to the shape this format
// asks for. Shortfalls cost proportionally; surplus earns nothing extra.
function balanceOf(players, format) {
  const targets = FORMATS[format].targets;
  const total = BALANCE.reduce((a, b) => a + b.weight, 0);
  const rows = BALANCE.map(item => {
    const target = targets[item.key];
    const have = players.filter(p => fills(p, item.key)).length;
    const filled = Math.pow(clamp(have / target, 0, 1), 2.2);
    return { key: item.key, name: item.name, have, target, earned: item.weight * filled, weight: item.weight };
  });
  return { rows, points: rows.reduce((a, b) => a + b.earned, 0) / total * 100 };
}

const COMPONENTS = [
  { key: 'quality', name: 'Squad quality', max: 420, hint: 'Sum of the twelve format ratings' },
  { key: 'batting', name: 'Batting strength', max: 160, hint: 'Best seven batting contributions' },
  { key: 'bowling', name: 'Bowling strength', max: 160, hint: 'Best five bowling contributions' },
  { key: 'fielding', name: 'Fielding & keeping', max: 80, hint: 'Ground fielding and glovework' },
  { key: 'balance', name: 'Balance & combination', max: 100, hint: 'Squad shape against the format plan' },
  { key: 'impact', name: 'Impact players', max: 80, hint: 'Match-winners who change a game alone' }
];

// Score a squad of player ids. Returns the total plus a breakdown the results
// screen renders, so a losing player can see exactly where the game was lost.
function scoreSquad(ids, format) {
  const players = ids.map(id => playerPool[id]);
  const all = players.map(p => skills(p, format));
  const balance = balanceOf(players, format);
  const values = {
    quality: band(mean(all.map(s => s.rating)), 62, 92, 420),
    batting: band(mean(top(all.map(s => s.bat), 7)), 56, 93, 160),
    bowling: band(mean(top(all.map(s => s.bowl), 5)), 42, 85, 160),
    fielding: band(mean(all.map(s => s.field)), 81, 89, 80),
    balance: balance.points,
    impact: Math.min(80, all.reduce((a, s) => a + s.impact, 0) * 1.9)
  };
  const parts = COMPONENTS.map(c => ({ ...c, value: Math.round(values[c.key]) }));
  return { total: parts.reduce((a, b) => a + b.value, 0), parts, balance: balance.rows };
}

// A live, cheap read of squad shape used by the bot and the in-game balance
// meter. Works on a partial squad.
function shapeOf(ids, format) {
  const players = ids.map(id => playerPool[id]);
  const targets = FORMATS[format].targets;
  return BALANCE.map(item => ({ key: item.key, name: item.name,
    have: players.filter(p => fills(p, item.key)).length, target: targets[item.key] }));
}

module.exports = { scoreSquad, shapeOf, skills, fills, balanceOf, COMPONENTS, BAT_SHARE, BOWL_SHARE };
