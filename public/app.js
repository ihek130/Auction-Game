'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels = { BAT:'🏏 Batters', AR:'🔥 All-rounders', FAST:'⚡ Fast bowlers', SPIN:'🌀 Spinners', WK:'🧤 Wicketkeepers' };
const stageNames = ['Batters','All-rounders','Bowlers','Keepers','Wildcard'];
const stageShort = ['Bat','AR','Bowl','WK','Wild'];

// Canned sledges. Typing on a phone during a 30-second turn is no fun, so the
// banter is one tap away.
const PRESETS = [
  'Take him, I have bigger plans 😌', 'That is a lot for a No. 11 💸', 'My nan bids harder 👵',
  'Bold. Wrong, but bold 🧐', 'I will allow it. Enjoy the bill 🧾', 'Are you bidding or donating? 🤲',
  'Cracking buy. For me 😎', 'Wallet check? 👀', 'You needed a keeper two lots ago 🧤',
  'Respectfully: terrible 🫡', 'Save some money for the bowlers 🎳', 'This one is mine, sorry 🙃',
  'Panic buy detected 🚨', 'Great pick. Shame about the rest 🌚'
];

let state = null, busy = false, pollingInFlight = false, pollTimer, room = new URLSearchParams(location.search).get('room') || '', token = '', clockOffset = 0, toastTimer;
let lastFocus = '', connected = false, lastRender = '', chatDraft = '', chatOpen = false, unread = 0;
let seenChat = 0, chatPrimed = false, presetSeed = 0, squadsOpen = false;
const CHAT_COOLDOWN_MS = 800;
let lastChatAt = 0, cooldownTimer;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
try { token = localStorage.getItem('cricket-seat:' + room) || ''; } catch {}

function message(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }

// AbortSignal.timeout() only arrived in 2022 browsers. Older phones still get
// a request timeout; the oldest simply get no timeout rather than no game.
function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  if (typeof AbortController === 'undefined') return undefined;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}
// The selected-card highlight uses the CSS :has() selector, which some older
// phone browsers lack. Mirror the checked state onto the label so the choice
// is always visible.
function mirrorChecked(root) {
  const inputs = root.querySelectorAll('.format input, .choice input');
  const apply = () => inputs.forEach(i => i.closest('label').classList.toggle('checked', i.checked));
  inputs.forEach(i => i.addEventListener('change', apply));
  apply();
}
function connection(text, ok) { connected = ok; $('connection').textContent = text; $('connection').classList.toggle('offline', !ok); updateControls(); }

/* ---------- reactions that float up the screen ---------- */
// Decorative only: capped, skipped under reduced motion, self-cleaning.
function spawnReaction(text, mine) {
  const layer = $('fx');
  if (!layer || reduceMotion || layer.childElementCount > 14) return;
  const node = document.createElement('span');
  node.className = 'pop' + (mine ? ' mine' : '');
  node.textContent = text;
  node.style.setProperty('--x', (mine ? 58 : 12) + Math.random() * 30 + '%');
  node.style.setProperty('--drift', (Math.random() * 60 - 30) + 'px');
  node.style.setProperty('--spin', (Math.random() * 24 - 12) + 'deg');
  layer.appendChild(node);
  setTimeout(() => node.remove(), 2400);
}
// Animate only the messages that arrived since the last update. The first
// state for a room is the baseline, so reconnecting to a busy room does not
// replay every reaction ever sent — but the first new one still pops.
function playNewReactions(next) {
  const chat = next.chat || [];
  if (!chatPrimed) { chatPrimed = true; seenChat = chat.length; return; }
  for (let i = seenChat; i < chat.length; i++) {
    const m = chat[i];
    if (m.emoji) spawnReaction(m.text, m.seat === next.you);
  }
  seenChat = chat.length;
}

/* ---------- history: Back returns to the menu, not off the site ---------- */
function seedHistory() {
  if (room) { history.replaceState({ view: 'home' }, '', '/'); history.pushState({ view: 'room', room }, '', '/?room=' + room); }
  else history.replaceState({ view: 'home' }, '', '/');
}
function enterRoom(id) {
  room = id;
  if (history.state && history.state.view === 'room' && history.state.room === id) return;
  history.pushState({ view: 'room', room: id }, '', '/?room=' + id);
}
function goHome(push) {
  clearTimeout(pollTimer); state = null; room = ''; token = ''; lastRender = ''; chatOpen = false; unread = 0; seenChat = 0; chatPrimed = false;
  if (push) history.pushState({ view: 'home' }, '', '/');
  setup();
}
window.addEventListener('popstate', () => {
  const next = new URLSearchParams(location.search).get('room') || '';
  if (!next) { if (state || room) goHome(false); return; }
  if (next !== room) { room = next; try { token = localStorage.getItem('cricket-seat:' + room) || ''; } catch {} state = null; lastRender = ''; seenChat = 0; chatPrimed = false; request(); }
});

function rules() {
  return '<details class="rules"><summary>How the auction works</summary><ol>'
    + '<li>Two sides start with <b>$100 each</b>. Take turns bidding any whole-dollar amount. There is no base price, and every raise must beat the visible bid.</li>'
    + '<li>You get <b>30 seconds</b> a turn. Pass, or let the clock run out, and the player goes to the highest bidder. Only the buyer pays.</li>'
    + '<li>Fill the squad in order: <b>5 batters, 2 all-rounders, 3 bowlers, 1 keeper</b>, then a <b>wildcard</b> from any category.</li>'
    + '<li>Keep <b>$1 for each empty slot</b> so you can always finish your twelve.</li>'
    + '<li>Squads are marked out of <b>1000</b> on quality, batting, bowling, fielding, balance and impact. A balanced side beats a lopsided one of similar quality.</li>'
    + '<li><b>Enter</b> bids, <b>P</b> passes, <b>Enter</b> again reveals the next player.</li></ol></details>';
}

/* ---------- home ---------- */
function setup(invited = false) {
  state = null; lastFocus = ''; lastRender = ''; clearTimeout(pollTimer);
  const opponentFields = `<fieldset class="choice-group wide"><legend>Who are you playing?</legend>`
    + `<label class="choice"><input type="radio" name="opponent" value="computer" checked><span>🤖 The computer<small>Start right now</small></span></label>`
    + `<label class="choice"><input type="radio" name="opponent" value="friend"><span>👥 A friend<small>Share an invite link</small></span></label></fieldset>`
    + `<fieldset class="choice-group levels wide" id="levelGroup"><legend>Difficulty</legend>`
    + `<label class="choice small"><input type="radio" name="level" value="easy"><span>Rookie<small>Bids shyly</small></span></label>`
    + `<label class="choice small"><input type="radio" name="level" value="normal" checked><span>Pro<small>Fair fight</small></span></label>`
    + `<label class="choice small"><input type="radio" name="level" value="hard"><span>Legend<small>Reads the room</small></span></label></fieldset>`
    + `<fieldset class="format-group wide"><legend>Format</legend>`
    + `<label class="format"><input type="radio" name="format" value="t20" checked>T20<small>Power &amp; finishers</small></label>`
    + `<label class="format"><input type="radio" name="format" value="odi">ODI<small>Depth &amp; control</small></label>`
    + `<label class="format"><input type="radio" name="format" value="test">Test<small>Patience &amp; technique</small></label></fieldset>`;
  const codeField = `<div class="wide"><label for="inviteCode">Room code</label><input id="inviteCode" value="${esc(room)}" readonly></div>`;
  const joinPanel = `<section class="setup panel join"><h2>Got an invite?</h2><form id="joinForm"><label class="muted" for="roomCode" hidden>Invite link or room code</label><input id="roomCode" aria-label="Invite link or room code" placeholder="Paste an invite link or room code" required><button>Open</button></form></section>`;

  $('app').innerHTML = `<section class="setup panel"><div class="eyebrow">${invited ? 'Your seat is waiting' : 'Live cricket auction'}</div>`
    + `<h1>${invited ? 'Join the room.' : 'Build a squad.<br>Outbid your rival.'}</h1>`
    + `<p class="intro">$100 each. Twelve players a side. Thirty seconds to make your move.</p>`
    + `<form id="setupForm" class="form-grid"><div class="wide"><label for="name">Your name</label>`
    + `<input id="name" maxlength="24" required autocomplete="nickname" placeholder="e.g. Hassan"></div>`
    + (invited ? codeField : opponentFields)
    + `<button class="primary wide big" type="submit">${invited ? 'Join room →' : 'Play now →'}</button></form>${rules()}</section>`
    + (invited ? '<p class="setup"><a href="/" id="ownRoom">Create your own room</a></p>' : joinPanel);

  document.querySelectorAll('input[name="opponent"]').forEach(r => r.addEventListener('change', () => {
    const solo = document.querySelector('input[name="opponent"]:checked').value === 'computer';
    $('levelGroup').hidden = !solo;
    $('setupForm').querySelector('button[type=submit]').textContent = solo ? 'Play now →' : 'Create room →';
  }));
  $('setupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('name').value.trim(); if (!name || busy) return;
    await request({ type: invited ? 'join' : 'create', name,
      format: (document.querySelector('input[name="format"]:checked') || {}).value,
      opponent: (document.querySelector('input[name="opponent"]:checked') || {}).value || 'computer',
      level: (document.querySelector('input[name="level"]:checked') || {}).value });
  });
  const joinForm = $('joinForm');
  if (joinForm) joinForm.addEventListener('submit', e => {
    e.preventDefault();
    let code = $('roomCode').value.trim();
    try { code = new URL(code).searchParams.get('room') || code; } catch {}
    if (!/^[a-f0-9]{24}$/.test(code)) return message('Paste the full invite link or room code.');
    location.href = '/?room=' + code;
  });
  const own = $('ownRoom');
  if (own) own.addEventListener('click', e => { e.preventDefault(); goHome(true); });
  mirrorChecked($('setupForm'));
  connection('Ready to play', true);
}

function inviteLink() { return location.origin + '/?room=' + room; }
async function copyText(text, ok) {
  try { await navigator.clipboard.writeText(text); message(ok); }
  catch {
    const input = $('inviteLink');
    if (input) { input.focus(); input.select(); message('Copy the selected link.'); }
    else message('Copy this page address to share it.');
  }
}

/* ---------- squads ---------- */
function shapeBar(p) {
  return '<div class="shape">' + p.shape.map(x =>
    `<span class="chip ${x.have >= x.target ? 'ok' : 'short'}">${esc(x.name.replace(' options','').replace('Wicketkeeper','Keeper'))} <b>${x.have}/${x.target}</b></span>`
  ).join('') + '</div>';
}
function roster(p, i) {
  const mine = i === state.you;
  const counts = p.counts.map((c, k) => `<span class="${c >= state.stages[k].quota ? 'done' : ''}">${stageShort[k]} ${c}/${state.stages[k].quota}</span>`).join('');
  const list = p.squad.length
    ? '<ul>' + p.squad.map(x => `<li><span class="who">${esc(x.flag)} ${esc(x.name)}<small>${esc(x.role)}${x.stage === 4 ? ' · Wildcard' : ''} · ${x.rating} pts</small></span><span class="price">$${x.price}</span></li>`).join('') + '</ul>'
    : '<div class="empty">No signings yet.</div>';
  return `<section class="roster ${mine ? 'mine' : ''}"><div class="roster-head"><div class="roster-title"><h3>${esc(p.name)}${mine ? ' · You' : ''}</h3>`
    + `<span class="pill">${p.squad.length}/12</span></div><div class="counts">${counts}</div>${shapeBar(p)}</div>${list}`
    + `<div class="roster-foot"><small>Spent $${100 - p.wallet}</small><small>$${p.wallet} left</small></div></section>`;
}

/* ---------- chat ---------- */
function presets() {
  const list = [];
  for (let i = 0; i < 6; i++) list.push(PRESETS[(presetSeed + i * 5) % PRESETS.length]);
  return list;
}
function chatPanel() {
  const s = state;
  const msgs = s.chat.map(m =>
    `<li class="msg ${m.seat === s.you ? 'mine' : 'theirs'} ${m.emoji ? 'is-emoji' : ''}"><small>${esc((s.seats[m.seat] || {}).name || 'Player')}</small><span>${esc(m.text)}</span></li>`
  ).join('');
  return `<section class="chat ${chatOpen ? 'open' : ''}" id="chatPanel" aria-label="Room chat">`
    + `<div class="chat-head"><h3>Room chat</h3><button type="button" id="chatClose" class="icon" aria-label="Close chat">✕</button></div>`
    + `<ul class="chat-log" id="chatLog" aria-live="polite" aria-relevant="additions">${msgs || '<li class="chat-empty">Say hello. Sledging is permitted.</li>'}</ul>`
    + `<div class="emoji-bar" role="group" aria-label="Quick reactions">`
    + s.emojis.map(e => `<button type="button" class="emoji" data-emoji="${esc(e)}" aria-label="Send ${esc(e)}">${esc(e)}</button>`).join('')
    + `</div><div class="presets" role="group" aria-label="Quick messages">`
    + presets().map(t => `<button type="button" class="preset" data-preset="${esc(t)}">${esc(t)}</button>`).join('')
    + `<button type="button" class="preset shuffle" id="shufflePresets" aria-label="More lines">🔁</button></div>`
    + `<form id="chatForm"><label for="chatInput" hidden>Message</label><input id="chatInput" maxlength="160" autocomplete="off" placeholder="Say something…"><button type="submit" class="primary">Send</button></form></section>`
    + (chatOpen ? '<div class="sheet-backdrop" id="chatBackdrop"></div>' : '');
}
function chatReady() { return Date.now() - lastChatAt >= CHAT_COOLDOWN_MS; }
function chatCooldown() { lastChatAt = Date.now(); applyChatCooldown(); clearTimeout(cooldownTimer); cooldownTimer = setTimeout(applyChatCooldown, CHAT_COOLDOWN_MS + 30); }
function applyChatCooldown() {
  const cooling = !chatReady();
  document.querySelectorAll('[data-emoji],[data-preset]').forEach(b => { b.disabled = cooling; });
  const form = $('chatForm');
  const send = form ? form.querySelector('button') : null;
  if (send) send.disabled = cooling;
}
function sendChat(body) { if (!chatReady()) return; chatCooldown(); request(Object.assign({ type: 'chat' }, body)); }
function toggleChat(open) {
  chatOpen = open;
  if (open) unread = 0;
  lastRender = ''; render();
  if (open) setTimeout(() => { const i = $('chatInput'); if (i) i.focus({ preventScroll: true }); }, 60);
}
function wireChat() {
  const log = $('chatLog'); if (log) log.scrollTop = log.scrollHeight;
  const input = $('chatInput');
  if (input) { input.value = chatDraft; input.addEventListener('input', () => { chatDraft = input.value; }); }
  const form = $('chatForm');
  if (form) form.addEventListener('submit', e => {
    e.preventDefault();
    const text = $('chatInput').value.trim();
    if (!text || !chatReady()) return;
    chatDraft = ''; $('chatInput').value = '';
    sendChat({ text });
  });
  document.querySelectorAll('[data-emoji]').forEach(b => b.addEventListener('click', () => sendChat({ emoji: b.dataset.emoji })));
  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => sendChat({ text: b.dataset.preset })));
  const shuffle = $('shufflePresets');
  if (shuffle) shuffle.addEventListener('click', () => { presetSeed = (presetSeed + 1) % PRESETS.length; lastRender = ''; render(); });
  const close = $('chatClose'); if (close) close.addEventListener('click', () => toggleChat(false));
  const backdrop = $('chatBackdrop'); if (backdrop) backdrop.addEventListener('click', () => toggleChat(false));
  const toggle = $('chatToggle'); if (toggle) toggle.addEventListener('click', () => toggleChat(!chatOpen));
  applyChatCooldown();
}

/* ---------- results ---------- */
function breakdownTable(s) {
  const rows = s.breakdown[0].parts.map((part, k) => {
    const a = s.breakdown[0].parts[k].value, b = s.breakdown[1].parts[k].value;
    const wide = Math.max(a, b, 1);
    return `<tr><th scope="row">${esc(part.name)}<small>${esc(part.hint)}</small></th>`
      + `<td class="${a >= b ? 'lead' : ''}"><span class="bar" style="--w:${a / wide * 100}%"></span>${a}</td>`
      + `<td class="${b >= a ? 'lead' : ''}"><span class="bar" style="--w:${b / wide * 100}%"></span>${b}</td>`
      + `<td class="cap">/${part.max}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="breakdown"><caption>Where the game was won</caption><thead><tr>`
    + `<th scope="col">Component</th><th scope="col">${esc(s.seats[0].name)}</th><th scope="col">${esc(s.seats[1].name)}</th><th scope="col" class="cap">Max</th>`
    + `</tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row">Total</th>`
    + `<td class="${s.scores[0] >= s.scores[1] ? 'lead' : ''}">${s.scores[0]}</td>`
    + `<td class="${s.scores[1] >= s.scores[0] ? 'lead' : ''}">${s.scores[1]}</td><td class="cap">/1000</td></tr></tfoot></table></div>`;
}
function bestBuy() {
  const mine = state.seats[state.you].squad;
  if (!mine.length) return '—';
  const best = mine.reduce((a, b) => (b.rating / Math.max(1, b.price) > a.rating / Math.max(1, a.price) ? b : a));
  return `${best.name} for $${best.price} (${best.rating} pts)`;
}
function resultText() {
  const s = state;
  const verdict = s.winner === -1 ? 'A draw' : `${s.seats[s.winner].name} won`;
  return `🏏 Cricket Auction · ${s.format.toUpperCase()}\n${verdict}: ${s.seats[0].name} ${s.scores[0]} – ${s.scores[1]} ${s.seats[1].name}\nBest value: ${bestBuy()}\nPlay: ${location.origin}`;
}
function rematch() {
  const s = state;
  const body = { type: 'create', name: s.seats[s.you].name, format: s.format };
  if (s.solo) { body.opponent = 'computer'; body.level = s.botLevel || 'normal'; }
  else body.opponent = 'friend';
  clearTimeout(pollTimer); state = null; room = ''; token = ''; lastRender = ''; seenChat = 0; chatPrimed = false; chatOpen = false;
  request(body);
}

/* ---------- the room ---------- */
function hud(s) {
  const seconds = s.phase === 'auction' ? Math.max(0, Math.ceil((s.deadline - Date.now() - clockOffset) / 1000)) : null;
  const seat = (p, i) => `<div class="hud-seat ${i === s.you ? 'you' : ''} ${s.turn === i ? 'turn' : ''}">`
    + `<span class="hud-name">${esc(p.name)}${i === s.you ? ' · You' : ''}</span>`
    + `<strong>$${p.wallet}</strong><small>${p.squad.length}/12 · max $${p.maxBid}</small></div>`;
  return `<div class="hud">${seat(s.seats[0], 0)}`
    + `<div class="hud-clock"><div class="ring" id="timerRing" style="--p:1"><span id="timer" aria-label="Seconds remaining">${seconds === null ? '—' : seconds}</span></div>`
    + `<small>${s.phase === 'auction' ? 'seconds' : 'closed'}</small></div>${seat(s.seats[1], 1)}</div>`;
}
function lotCard(s) {
  if (s.phase === 'choose') {
    return `<section class="lot choose"><div class="eyebrow">The 12th player · Wildcard</div>`
      + `<h2>${s.you === s.turn ? 'Pick your final category.' : esc(s.seats[s.turn].name) + ' is choosing…'}</h2>`
      + `<p class="intro">A hidden player from that category comes up. Both sides can bid if their wildcard slot is empty.</p>`
      + `<div class="choice-grid">${s.categories.map(c => `<button data-category="${c}" ${s.you !== s.turn ? 'disabled' : ''}>${labels[c]}</button>`).join('')}</div></section>`;
  }
  if (s.phase === 'sold') {
    const sold = s.outcome.type === 'sold';
    const won = sold && s.outcome.buyer === s.you;
    const headline = sold ? `${esc(s.seats[s.outcome.buyer].name)} buys ${esc(s.current.name)}` : 'Nobody bid';
    const detail = sold ? `$${s.outcome.price} · ${s.current.rating} rating points` : esc(s.outcome.text || 'This player can return later.');
    return `<section class="lot outcome-card ${sold ? (won ? 'won' : 'lost') : 'unsold'}">`
      + `<div class="stamp">${sold ? 'SOLD' : 'UNSOLD'}</div><h2>${headline}</h2><p class="muted">${detail}</p>`
      + `<button class="primary big" data-action="next">Next player · Enter ↵</button></section>`;
  }
  const c = s.current, stat = c.stats;
  const statline = stat ? '<div class="statline">' + stat.line.map(x => `<span><b>${esc(x.value)}</b>${esc(x.label)}</span>`).join('') + '</div>' : '';
  const amount = s.high ? '$' + s.high : 'Open';
  const under = s.leader !== null ? esc(s.seats[s.leader].name) + ' leads' : 'Any whole-dollar bid starts it';
  const history = s.history.slice(-5).map(h =>
    `<span>${esc(s.seats[h.seat].name.split(' ')[0])} ${h.type === 'bid' ? '$' + h.amount : h.type === 'timeout' ? 'timed out' : 'passed'}</span>`
  ).join('') || '<span class="ghosty">Bidding is open</span>';
  return `<section class="lot"><div class="lot-top"><span>Lot ${s.lot}</span><span>${esc(stageNames[s.stage])}</span></div>`
    + `<div class="flag">${esc(c.flag)}</div><h1 class="player-name">${esc(c.name)}</h1>`
    + `<p class="muted">${esc(c.country)} · ${esc(c.era)}</p>`
    + `<div class="tags"><span class="tag">${esc(c.role)}</span><span class="tag rating">${s.format.toUpperCase()} ${c.rating}</span>`
    + `${s.stage === 4 ? '<span class="tag wild">Wildcard</span>' : ''}</div>${statline}`
    + `<div class="bid-display" aria-live="polite"><small>${s.high ? 'Highest bid' : 'No bids yet'}</small>`
    + `<span class="amount${s.high ? '' : ' open'}">${amount}</span><small>${under}</small></div>`
    + `<div class="history">${history}</div></section>`;
}
function bidBar(s) {
  if (s.phase !== 'auction') return '';
  const me = s.seats[s.you];
  if (s.turn !== s.you) {
    return `<div class="bidbar waiting"><span class="pulse"></span>${esc(s.seats[s.turn].name)} is ${s.seats[s.turn].bot ? 'thinking' : 'deciding'}…</div>`;
  }
  const chips = [1, 2, 5].map(n => `<button type="button" class="chip-btn" data-raise="${n}">+$${n}</button>`).join('')
    + '<button type="button" class="chip-btn" data-raise="max">Max</button>';
  return `<div class="bidbar active"><div class="bidbar-top"><strong>Your turn</strong><small>up to $${me.maxBid}</small></div>`
    + `<div class="quick" role="group" aria-label="Quick bids">${chips}</div>`
    + `<div class="bidder"><form id="bidForm"><label for="bidInput" hidden>Your bid</label>`
    + `<input id="bidInput" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="Amount" aria-describedby="bidHelp">`
    + `<button id="bidButton" class="primary">Bid ↵</button></form>`
    + `<button data-action="pass" class="pass">Pass · P</button></div>`
    + `<p class="help" id="bidHelp">Keep $1 for each empty slot. Only the winner pays.</p></div>`;
}

function render() {
  const s = state;
  const key = `${s.phase}:${s.revision}:${s.chatSeq}:${chatOpen}:${squadsOpen}:${presetSeed}`;
  if (key === lastRender) return;
  lastRender = key;
  const draft = $('chatInput'); if (draft) chatDraft = draft.value;

  if (s.phase === 'lobby') {
    const waiting = !s.seats[1];
    const seats = s.seats.map((p, i) => `<div class="lobby-seat ${p ? 'ready' : ''}"><small>PLAYER ${i + 1}${i === 0 ? ' · HOST' : ''}</small>`
      + `<strong>${p ? esc(p.name) : 'Waiting…'}</strong><span class="muted">${p ? '$100 ready' : 'Share the link below'}</span></div>`).join('');
    const invite = s.solo ? '' : `<label for="inviteLink">Invite link</label><div class="copy-field"><input id="inviteLink" readonly value="${esc(inviteLink())}"><button id="copyBtn" class="primary">Copy</button></div>`;
    const controls = s.you === 0
      ? `<div class="button-row"><button class="primary big" data-action="start" ${!s.seats[1] ? 'disabled' : ''}>Start ${s.format.toUpperCase()} auction</button><button id="leaveBtn" class="ghost">Menu</button></div>`
      : '<p class="intro">Waiting for the host to start…</p>';
    $('app').innerHTML = `<section class="setup panel"><div class="eyebrow">${s.format.toUpperCase()} · ${s.solo ? 'Solo game' : 'Private room'}</div>`
      + `<h1>${s.solo ? 'Your opponent is ready.' : waiting ? 'Bring your rival.' : 'Both players are here.'}</h1>`
      + `<p class="intro">${s.solo ? 'The computer is seated. Start whenever you like.' : 'Send this link. The auction begins when the host starts.'}</p>`
      + `<div class="lobby-seats">${seats}</div>${invite}${controls}${s.solo ? '' : chatPanel()}${rules()}</section>`;
  } else if (s.phase === 'finished') {
    const me = s.scores[s.you], them = s.scores[1 - s.you];
    const verdict = s.winner === -1 ? 'Dead heat.' : s.winner === s.you ? 'You win! 🏆' : `${esc(s.seats[s.winner].name)} wins.`;
    const margin = me > them ? `You came out ${me - them} points ahead.` : me < them ? `You finished ${them - me} points short.` : 'Level on points.';
    const scores = s.seats.map((p, i) => `<div class="score ${s.winner === i ? 'won' : ''}">${esc(p.name)}<strong>${s.scores[i]}</strong><small>of 1000 · $${p.wallet} left</small></div>`).join('');
    $('app').innerHTML = `<section class="panel"><div class="result-hero ${s.winner === s.you ? 'win' : s.winner === -1 ? 'draw' : 'loss'}">`
      + `<div class="eyebrow">${s.format.toUpperCase()} · Full time</div><h1>${verdict}</h1><p class="muted">${margin}</p></div>`
      + `<div class="scores">${scores}</div>`
      + `<div class="best-buy"><span>💎 Your best value</span><strong>${esc(bestBuy())}</strong></div>`
      + breakdownTable(s)
      + `<div class="button-row"><button id="rematch" class="primary big">${s.solo ? 'Play again' : 'New room'}</button>`
      + `<button id="shareBtn">Share result</button><button id="newGame" class="ghost">Menu</button></div>`
      + `<div class="squad-grid">${s.seats.map(roster).join('')}</div>${chatPanel()}</section>`;
  } else {
    const signed = s.seats.reduce((n, p) => n + p.squad.length, 0);
    const stages = s.stages.map((st, i) => `<div class="stage ${s.stage === i ? 'active' : s.stage > i ? 'done' : ''}"><strong>${stageNames[i]}</strong>${st.quota} each</div>`).join('');
    $('app').innerHTML = `<section class="panel room"><div class="toolbar"><div><div class="eyebrow">${s.format.toUpperCase()} · ${s.solo ? 'Solo' : 'Room'}</div>`
      + `<p class="muted">${signed}/24 signed</p></div><div class="toolbar-actions">${s.solo ? '' : '<button id="copyBtn">Invite</button>'}`
      + `<button id="chatToggle" class="${unread ? 'has-unread' : ''}">💬${unread ? ` <span class="badge">${unread}</span>` : ''}</button>`
      + `<button id="leaveBtn" class="ghost">Menu</button></div></div>`
      + `<nav class="stages" aria-label="Auction stages">${stages}</nav>${hud(s)}`
      + `<div class="game-grid"><div class="main-col">${lotCard(s)}${bidBar(s)}</div>`
      + `<aside class="side-col"><details class="squads" ${squadsOpen ? 'open' : ''} id="squadsBox"><summary>Squads<span class="muted">${signed}/24</span></summary>`
      + `<div class="squad-grid">${s.seats.map(roster).join('')}</div></details></aside></div>${chatPanel()}</section>`;
  }

  const copyBtn = $('copyBtn'); if (copyBtn) copyBtn.addEventListener('click', () => copyText(inviteLink(), 'Invite link copied. Send it over.'));
  const shareBtn = $('shareBtn'); if (shareBtn) shareBtn.addEventListener('click', () => copyText(resultText(), 'Result copied. Paste it anywhere.'));
  const again = $('rematch'); if (again) again.addEventListener('click', rematch);
  const leave = $('leaveBtn'); if (leave) leave.addEventListener('click', () => { if (confirm('Leave this room? Your seat is kept if you return in this browser.')) goHome(true); });
  const fresh = $('newGame'); if (fresh) fresh.addEventListener('click', () => goHome(true));
  const box = $('squadsBox'); if (box) box.addEventListener('toggle', e => { squadsOpen = e.target.open; lastRender = ''; });
  document.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', () => request({ type: b.dataset.action, revision: state.revision })));
  document.querySelectorAll('[data-category]').forEach(b => b.addEventListener('click', () => request({ type: 'choose', category: b.dataset.category, revision: state.revision })));
  document.querySelectorAll('[data-raise]').forEach(b => b.addEventListener('click', () => {
    const me = state.seats[state.you];
    const amount = b.dataset.raise === 'max' ? me.maxBid : Math.min(me.maxBid, state.high + Number(b.dataset.raise));
    const input = $('bidInput'); if (input) { input.value = String(amount); input.focus(); }
  }));
  const bidForm = $('bidForm'); if (bidForm) bidForm.addEventListener('submit', e => { e.preventDefault(); submitBid(); });
  wireChat();
  updateControls(); tick();
  const focusKey = `${s.phase}:${s.lot}:${s.turn}:${s.high}`;
  if (focusKey !== lastFocus) { lastFocus = focusKey; if (s.phase === 'auction' && s.turn === s.you && !chatOpen) setTimeout(focusBid, 0); }
}
function focusBid() { const input = $('bidInput'); if (input && !input.disabled) { input.focus({ preventScroll: true }); input.select(); } }
function submitBid() {
  if (!state || state.phase !== 'auction' || state.turn !== state.you || busy) return;
  const raw = $('bidInput').value.trim().replace(/^\$/, '');
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) <= state.high) return message('Type a whole-dollar bid above the current bid.');
  if (Number(raw) > state.seats[state.you].maxBid) return message(`Your maximum is $${state.seats[state.you].maxBid} — keep $1 for each empty slot.`);
  request({ type: 'bid', amount: Number(raw), revision: state.revision });
}
function updateControls() {
  if (!state) { const f = $('setupForm'); if (f) { const b = f.querySelector('button'); if (b) b.toggleAttribute('disabled', busy); } return; }
  const mine = state.phase === 'auction' && state.turn === state.you;
  const late = Date.now() + clockOffset >= state.deadline;
  for (const id of ['bidInput', 'bidButton']) { const el = $(id); if (el) el.disabled = busy || !connected || !mine || late; }
  document.querySelectorAll('[data-raise]').forEach(b => { b.disabled = busy || !connected || !mine || late; });
  document.querySelectorAll('[data-action]').forEach(b => {
    b.disabled = busy || !connected
      || (b.dataset.action === 'start' && (!state.seats[1] || state.you !== 0))
      || (b.dataset.action === 'pass' && (!mine || late));
  });
  document.querySelectorAll('[data-category]').forEach(b => { b.disabled = busy || !connected || state.turn !== state.you; });
}
function tick() {
  const el = $('timer'); if (!el) return;
  const left = state && state.phase === 'auction' ? Math.max(0, (state.deadline - Date.now() - clockOffset) / 1000) : null;
  el.textContent = left === null ? '—' : String(Math.ceil(left));
  const ring = $('timerRing');
  if (ring) {
    ring.style.setProperty('--p', left === null ? 0 : Math.max(0, Math.min(1, left / 30)));
    ring.classList.toggle('urgent', left !== null && left <= 10);
  }
  if (left === 0) updateControls();
}
function schedulePoll() {
  clearTimeout(pollTimer);
  if (state && state.phase !== 'finished') pollTimer = setTimeout(() => request(null, true), document.hidden ? 5000 : 2000);
}
async function request(action = null, polling = false) {
  if (busy || (polling && pollingInFlight)) { if (polling) schedulePoll(); return; }
  if (polling) pollingInFlight = true;
  else { busy = true; updateControls(); }
  try {
    const headers = {};
    if (action) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await fetch('/api/room' + (room ? '?room=' + encodeURIComponent(room) : ''), {
      method: action ? 'POST' : 'GET', headers,
      body: action ? JSON.stringify(action) : undefined,
      cache: 'no-store', signal: timeoutSignal(12000)
    });
    const data = await response.json();
    if (!response.ok) { const e = new Error(data.error || 'Unable to connect.'); e.status = response.status; throw e; }
    connection('Connected', true);
    if (data.token) {
      token = data.token;
      try { localStorage.setItem('cricket-seat:' + data.state.id, token); }
      catch { message('Keep this tab open: browser storage is unavailable.'); }
      enterRoom(data.state.id);
    }
    if (data.state) {
      clockOffset = data.state.serverTime - Date.now();
      if (!state || data.state.revision >= state.revision) {
        if (state && data.state.chatSeq > (state.chatSeq || 0) && !chatOpen) unread += data.state.chatSeq - state.chatSeq;
        playNewReactions(data.state);
        state = data.state;
        render();
      }
    }
    if (data.error) { message(data.error); lastFocus = ''; focusBid(); }
  } catch (e) {
    connection('Reconnecting…', false);
    // Say why, so a report from a phone can be acted on. A status means the
    // server answered; anything else is the network or the browser.
    if (!polling) message(e.status ? e.message : `Could not reach the server (${e.message || 'no response'}). Check your connection and try again.`);
    if (e.status === 401 && !state) { token = ''; setup(true); }
    if (e.status === 404 && !state) { message('That room is gone. Start a new one.'); goHome(false); }
  } finally {
    if (polling) pollingInFlight = false; else busy = false;
    updateControls(); schedulePoll();
    if (state && state.phase === 'auction' && state.turn === state.you && !chatOpen && document.activeElement === document.body) focusBid();
  }
}
document.addEventListener('keydown', e => {
  if (!state || busy || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const active = document.activeElement;
  if (active && active.id === 'chatInput') { if (e.key === 'Escape') toggleChat(false); return; }
  const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);
  if (e.key === 'Escape' && chatOpen) { e.preventDefault(); toggleChat(false); return; }
  if (e.key.toLowerCase() === 'p' && state.phase === 'auction' && state.turn === state.you && (!editing || active.id === 'bidInput')) {
    e.preventDefault(); request({ type: 'pass', revision: state.revision });
  } else if (e.key === 'Enter' && state.phase === 'sold' && !editing) {
    e.preventDefault(); request({ type: 'next', revision: state.revision });
  } else if (e.key === 'Enter' && state.phase === 'auction' && state.turn === state.you && !editing && active.tagName !== 'BUTTON') {
    e.preventDefault(); submitBid();
  }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && state) request(null, true); });
window.addEventListener('online', () => { if (state) request(null, true); });
window.addEventListener('focus', () => { if (state && state.phase === 'auction' && state.turn === state.you && !chatOpen) focusBid(); });
setInterval(tick, 200);
presetSeed = Math.floor(Math.random() * PRESETS.length);
seedHistory();
if (room && token) {
  $('app').innerHTML = '<section class="setup panel"><h2>Reconnecting…</h2><p class="intro">Restoring your seat and the current auction.</p>'
    + '<div class="button-row"><button id="retry" class="primary">Retry</button><button id="back" class="ghost">Menu</button></div></section>';
  $('retry').onclick = () => request();
  $('back').onclick = () => goHome(true);
  request();
} else setup(!!room);
