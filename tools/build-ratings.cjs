'use strict';
// Derives each cricketer's 0-99 game rating per format from real career
// statistics and published ICC rating points, then writes lib/players.cjs.
//
//   node tools/build-ratings.cjs [--check]
//
// Inputs (committed under data/, so every rating can be audited):
//   data/career-stats.json  career international statistics per format
//   data/icc-ratings.json   ICC Player Rankings rating points
//
// Nothing here is hand-tuned per player. Each format applies the same
// published curve to the same real inputs, so the ratings can be regenerated
// and argued with.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

/* ---------------- interpolation ---------------- */
// Piecewise-linear curve through [input, output] control points. Inputs must
// ascend. Values outside the range clamp to the nearest end.
function curve(value, points) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (value <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    if (value <= x1) return y0 + (value - x0) / (x1 - x0) * (y1 - y0);
  }
  return points.at(-1)[1];
}
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
// Weighted mean that ignores missing components.
function blend(parts) {
  const live = parts.filter(p => p[0] !== null && p[0] !== undefined);
  if (!live.length) return null;
  const w = live.reduce((a, p) => a + p[1], 0);
  return live.reduce((a, p) => a + p[0] * p[1], 0) / w;
}

/* ---------------- batting and bowling curves ----------------
   Control points are anchored on what the numbers mean in each format:
   a Test average of 50 is a great player, 40 a good one, 30 a tail-ender's
   neighbour. A T20 strike rate of 150 is destructive, 120 is steady. */
const CURVES = {
  // Curve tops sit below the 99 ceiling on purpose. Longevity and the ICC
  // blend are added on top, and if the base already reached 99 every durable
  // player would tie at the maximum instead of being told apart.
  test: {
    batAvg:  [[20,34],[30,52],[35,61],[40,69],[45,77],[50,84],[55,90],[60,95],[100,98]],
    batVol:  [[0,0],[2000,2],[5000,4],[8000,6],[12000,8],[16000,10]],
    bowlAvg: [[18,95],[21,89],[24,82],[27,73],[30,63],[33,52],[38,39],[50,26]],
    bowlVol: [[0,0],[100,3],[200,6],[350,9],[500,11],[800,13]],
    bowlSr:  [[40,8],[50,5],[60,3],[75,0]]
  },
  odi: {
    batAvg:  [[18,34],[25,48],[30,58],[35,67],[40,75],[45,82],[50,88],[60,95]],
    batSr:   [[60,0],[72,3],[80,6],[88,9],[95,12],[105,15],[120,18]],
    batVol:  [[0,0],[2000,2],[5000,4],[9000,7],[13000,9],[18000,11]],
    bowlAvg: [[18,96],[22,89],[25,82],[28,74],[31,65],[35,53],[40,40],[50,27]],
    bowlEcon:[[3.2,16],[3.8,12],[4.3,9],[4.8,5],[5.3,2],[6.5,0]],
    bowlVol: [[0,0],[75,3],[150,6],[250,8],[400,11],[550,13]]
  },
  t20: {
    // In T20 the rate matters as much as the runs.
    batAvg:  [[12,30],[18,44],[24,56],[30,66],[36,75],[42,83],[50,90]],
    batSr:   [[95,0],[110,6],[122,12],[132,18],[142,24],[155,30],[175,36]],
    batVol:  [[0,0],[500,2],[1200,4],[2500,7],[4000,9],[6000,11]],
    bowlAvg: [[14,96],[17,90],[20,83],[23,75],[26,66],[30,53],[35,39],[45,26]],
    bowlEcon:[[5.5,28],[6.2,23],[6.8,17],[7.4,11],[8.0,6],[8.8,2],[10,0]],
    bowlVol: [[0,0],[30,3],[70,6],[120,9],[200,12],[300,14]]
  }
};

// Batting quality on a 0-100 scale from real career numbers.
function battingScore(format, s) {
  if (!s || s.runs === null || s.runs === undefined) return null;
  const c = CURVES[format];
  const base = curve(s.bat_avg, c.batAvg);
  if (base === null) return null;
  const volume = curve(s.runs, c.batVol) || 0;
  const rate = c.batSr ? curve(s.bat_sr, c.batSr) : null;
  if (format === 'test') return clamp(base + volume, 0, 100);
  // A missing strike rate must not silently score zero: fall back to average
  // alone, re-weighted, rather than inventing a rate.
  const weighted = rate === null ? base : blend([[base, format === 't20' ? 0.55 : 0.75], [base + rate, format === 't20' ? 0.45 : 0.25]]);
  return clamp(weighted + volume, 0, 100);
}

// Bowling quality on a 0-100 scale from real career numbers.
function bowlingScore(format, s) {
  if (!s || !s.wickets) return null;
  const c = CURVES[format];
  const base = curve(s.bowl_avg, c.bowlAvg);
  if (base === null) return null;
  const volume = curve(s.wickets, c.bowlVol) || 0;
  const thrift = c.bowlEcon ? curve(s.econ, c.bowlEcon) : null;
  const strike = c.bowlSr ? curve(s.bowl_sr, c.bowlSr) : null;
  let score = base;
  if (thrift !== null) score = base * 0.72 + (base + thrift) * 0.28;
  if (strike !== null) score += strike * 0.4;
  return clamp(score + volume, 0, 100);
}

/* ---------------- ICC rating points ----------------
   ICC ratings run 0-1000; 900+ is an all-time peak, 750 is a fine
   international, 500 is a squad player. */
const ICC_CURVE = [[300,55],[450,64],[550,71],[650,78],[750,85],[820,90],[880,95],[930,98],[1000,99]];
function iccLookup(tables, name) {
  const key = String(name).toLowerCase().replace(/[^a-z]/g, '');
  for (const table of tables) {
    if (!Array.isArray(table)) continue;
    const hit = table.find(r => String(r.name).toLowerCase().replace(/[^a-z]/g, '') === key);
    if (hit) return hit.rating;
  }
  return null;
}

/* ---------------- how much international cricket counts ---------------- */
// A short career should not read as an all-time great on a small sample.
const SAMPLE = {
  test: [[0,0],[5,.45],[15,.7],[30,.88],[50,1],[200,1]],
  odi:  [[0,0],[10,.5],[25,.72],[60,.9],[100,1],[500,1]],
  t20:  [[0,0],[8,.5],[20,.72],[45,.9],[80,1],[300,1]]
};
// Minimum international exposure before a player enters a format's pool.
const MIN_MATCHES = { test: 10, odi: 15, t20: 12 };

function ratingFor(format, player, icc) {
  const key = format === 't20' ? 't20i' : format;
  const intl = player[key];
  const league = format === 't20' ? player.t20_league : null;
  // T20 reputations are built as much in franchise leagues as in
  // internationals, and the all-Twenty20 line is both the larger sample and
  // the fairer picture of a player's T20 ability. Prefer it when there is a
  // substantial one; otherwise fall back to the international record.
  const big = league && (league.matches || 0) >= 60;
  // Choose the source per discipline. The all-T20 line is the better sample
  // but does not always carry a bowling average, and falling back to the
  // whole block would then rate a specialist bowler on their batting.
  const batSource = format === 't20' && big && league.bat_avg !== null ? league : intl;
  const bowlSource = format === 't20' && big && league.bowl_avg !== null && league.wickets ? league : intl;
  const stats = format === 't20' ? (batSource || bowlSource || league) : intl;
  if (!stats) return { rating: 0, stats: null };
  const matches = stats.matches || 0;
  const leagueOnly = format === 't20' && stats === league;
  // The all-T20 sample is big, so do not let it also waive the small-sample
  // guard that protects against thin international records.
  if (matches < (leagueOnly ? 40 : MIN_MATCHES[format])) return { rating: 0, stats: null };

  const bat = battingScore(format, batSource || stats);
  let bowl = bowlingScore(format, bowlSource || stats);
  // An all-T20 line that reports wickets and economy but no average still
  // says something about a bowler; use the international average with it.
  if (bowl === null && format === 't20' && big && league.wickets && intl && intl.bowl_avg)
    bowl = bowlingScore(format, { ...league, bowl_avg: intl.bowl_avg });
  const cat = player.category;
  let core;
  if (cat === 'AR' && bat !== null && bowl !== null) {
    // An all-rounder is not the average of two disciplines. Someone who bats
    // and bowls at the same level is worth more than a specialist at that
    // level, because they occupy one slot and fill two needs. Lead on the
    // stronger suit and add a real premium for the weaker one.
    core = clamp(Math.max(bat, bowl) * 0.78 + Math.min(bat, bowl) * 0.3, 0, 100);
  } else {
    // Weight the two disciplines by what the player is picked to do.
    const mix = { BAT: [1, 0], WK: [1, 0], AR: [0.5, 0.5], FAST: [0.12, 0.88], SPIN: [0.12, 0.88] }[cat];
    core = blend([[bat, mix[0]], [bowl, mix[1]]]);
  }
  if (core === null) core = bat ?? bowl;
  if (core === null) return { rating: 0, stats: null };

  // Blend in the published ICC rating where the player appears in a table.
  // Wikipedia infoboxes carry no batting strike rate, so limited-overs
  // batting is judged on average alone unless ICC points are available. When
  // that signal is missing the ICC rating — which does account for scoring
  // rate and match context — is given more of the say.
  const iccPoints = iccLookup(icc[format] || [], player.name);
  const iccScore = iccPoints === null ? null : curve(iccPoints, ICC_CURVE);
  const thinBatting = format !== 'test' && ['BAT','WK','AR'].includes(cat) && (stats.bat_sr === null || stats.bat_sr === undefined);
  const iccWeight = thinBatting ? 0.62 : 0.45;
  let score = iccScore === null ? core : core * (1 - iccWeight) + iccScore * iccWeight;

  // Pull short careers back towards a solid-but-not-great baseline.
  const weight = curve(matches, SAMPLE[format]);
  score = 62 + (score - 62) * weight;
  // League-only T20 records are real but a weaker signal than internationals.
  if (leagueOnly) score = 62 + (score - 62) * 0.92;

  return { rating: Math.round(clamp(score, 55, 99)), stats: statLine(format, player, stats), icc: iccPoints };
}

// The three facts shown on the auction card, chosen per format and role.
function statLine(format, player, s) {
  const n = v => (v === null || v === undefined) ? null : v;
  const bowlerish = ['FAST','SPIN'].includes(player.category);
  const line = [];
  const push = (value, label) => { if (value !== null && value !== undefined) line.push({ value: String(value), label }); };
  if (bowlerish) {
    push(n(s.wickets), 'wkts');
    push(n(s.bowl_avg), 'avg');
    push(format === 'test' ? n(s.matches) : n(s.econ), format === 'test' ? 'mat' : 'econ');
  } else if (player.category === 'AR') {
    push(n(s.runs), 'runs');
    push(n(s.wickets), 'wkts');
    push(format === 'test' ? n(s.bat_avg) : n(s.bat_sr) ?? n(s.bat_avg), format === 'test' ? 'avg' : (s.bat_sr ? 'sr' : 'avg'));
  } else {
    push(n(s.runs), 'runs');
    push(n(s.bat_avg), 'avg');
    if (format === 'test') push(n(s.hundreds), '100s');
    else push(n(s.bat_sr) ?? n(s.matches), s.bat_sr ? 'sr' : 'mat');
  }
  return { line: line.slice(0, 3) };
}

/* ---------------- build ---------------- */
function build() {
  const roster = read('roster.json');          // name/country/category/style/era, the curated pool
  const stats = read('career-stats.json');     // real career numbers per player
  const iccRaw = read('icc-ratings.json');
  // Group the ICC tables by the format they belong to.
  const icc = {
    test: [iccRaw.test_bat_best, iccRaw.test_bowl_best, iccRaw.test_ar_best],
    odi: [iccRaw.odi_bat_best, iccRaw.odi_bowl_best, iccRaw.odi_ar_best],
    t20: [iccRaw.t20i_bat_best, iccRaw.t20i_bowl_best, iccRaw.t20i_bat_current, iccRaw.t20i_bowl_current, iccRaw.t20i_ar_current]
  };
  const byName = new Map(stats.map(p => [p.name, p]));

  const out = [], missing = [];
  for (const entry of roster) {
    const found = byName.get(entry.name);
    if (!found) { missing.push(entry.name); continue; }
    const player = { ...entry, ...found };
    const ratings = {}, statLines = {};
    for (const format of ['t20','odi','test']) {
      const r = ratingFor(format, player, icc);
      ratings[format] = r.rating;
      if (r.stats) statLines[format] = r.stats;
    }
    out.push({ name: entry.name, code: entry.code, category: entry.category, style: entry.style,
      era: found.era_peak || entry.era, ratings, stats: statLines });
  }
  return { players: out, missing };
}

function emit({ players }) {
  const body = players.map(p => '  ' + JSON.stringify(p)).join(',\n');
  return `'use strict';
// GENERATED FILE — do not edit by hand.
// Rebuild with:  node tools/build-ratings.cjs
//
// Every rating below is derived from the real career statistics in
// data/career-stats.json and the ICC rating points in data/icc-ratings.json,
// using the published curves in tools/build-ratings.cjs. A rating of 0 means
// the cricketer did not play enough of that format to enter its pool.
module.exports = [
${body}
];
`;
}

if (require.main === module) {
  const result = build();
  if (result.missing.length) {
    console.error('No career statistics for: ' + result.missing.join(', '));
    process.exitCode = 1;
  }
  const target = path.join(ROOT, 'lib', 'players.cjs');
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    const fresh = emit(result);
    if (current !== fresh) { console.error('lib/players.cjs is stale — run node tools/build-ratings.cjs'); process.exitCode = 1; }
    else console.log('lib/players.cjs is up to date (' + result.players.length + ' players)');
  } else {
    fs.writeFileSync(target, emit(result));
    console.log('Wrote lib/players.cjs with ' + result.players.length + ' players.');
  }
}
module.exports = { build, emit, curve, battingScore, bowlingScore, CURVES };
