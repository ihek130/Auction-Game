'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels = { BAT:'🏏 Batters', AR:'🔥 All-rounders', FAST:'⚡ Fast bowlers', SPIN:'🌀 Spinners', WK:'🧤 Wicketkeepers' };
let state = null, busy = false, pollingInFlight = false, pollTimer, room = new URLSearchParams(location.search).get('room') || '', token = '', clockOffset = 0, toastTimer;
let lastFocus = '', connected = false;
try { token = localStorage.getItem('cricket-seat:' + room) || ''; } catch {}
function message(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
function connection(text, ok) { connected = ok; $('connection').textContent = text; $('connection').classList.toggle('offline', !ok); updateControls(); }
function rules() { return `<details class="rules"><summary>How the auction works</summary><ol><li>Two players start with <b>$100 each</b>. Take turns bidding any whole-dollar amount. There is no player base price. Every raise must beat the visible highest bid.</li><li>You have <b>30 seconds</b> each turn. Pass or let time run out to give the cricketer to the highest bidder. Only the buyer pays. If both pass without a bid, the player returns later.</li><li>Buy <b>5 batters → 2 all-rounders → 3 bowlers (pace or spin) → 1 keeper</b>. Both sides finish a category before the next one opens. Then choose a category for the <b>wildcard 12th player</b>; your opponent may compete if their wildcard slot is still empty.</li><li>Keep $1 for each unfilled squad slot so you can finish your team. A bid wins immediately if your opponent has passed, filled their category, or cannot afford a higher bid.</li><li>The highest total of the 12 players’ format ratings wins. Remaining wallet breaks a tied score; equal score and wallet is a draw. Ratings are game judgments, not official statistics. Results appear only after both teams have 12.</li><li><b>Enter</b> submits your bid and passes the turn to your friend’s device. Their input focuses automatically. <b>P</b> passes. After a sale, <b>Enter</b> reveals the next player.</li></ol><p>Future players stay hidden and are shuffled within categories. Reopen the room in the same browser to reconnect. Rooms expire after 24 hours. Timers keep running if someone disconnects.</p></details>`; }
function setup(invited = false) {
  state = null; lastFocus = ''; clearTimeout(pollTimer);
  $('app').innerHTML = `<section class="setup panel"><div class="eyebrow">${invited ? 'Your seat is waiting' : 'Live cricket auction'}</div><h1>${invited ? 'Join your friend’s room.' : 'Build a squad.<br>Outbid your friend.'}</h1><p class="intro">$100 each. Twelve players per side. Thirty seconds to make your move.</p><form id="setupForm" class="form-grid"><div class="wide"><label for="name">Your name</label><input id="name" maxlength="24" required autocomplete="nickname" placeholder="e.g. Hassan" value=""></div>${invited ? `<div class="wide"><label for="inviteCode">Room code</label><input id="inviteCode" value="${esc(room)}" readonly></div>` : `<fieldset class="format-group wide"><legend>Choose your format</legend><label class="format"><input type="radio" name="format" value="t20" checked>T20<small>Power & finishers</small></label><label class="format"><input type="radio" name="format" value="odi">ODI<small>Depth & control</small></label><label class="format"><input type="radio" name="format" value="test">Test<small>Patience & technique</small></label></fieldset>`}<button class="primary wide" type="submit">${invited ? 'Join room →' : 'Create a room →'}</button></form>${rules()}</section>${!invited ? `<section class="setup panel join"><h2>Already have an invite?</h2><form id="joinForm"><label class="muted" for="roomCode" hidden>Invite link or room code</label><input id="roomCode" aria-label="Invite link or room code" placeholder="Paste an invite link or room code" required><button>Open invite</button></form></section>` : '<p class="setup"><a href="/">Create your own room</a></p>'}`;
  $('setupForm').addEventListener('submit', async e => { e.preventDefault(); const name = $('name').value.trim(); if (!name || busy) return; await request({type: invited ? 'join' : 'create', name, format: document.querySelector('input[name="format"]:checked')?.value}); });
  $('joinForm')?.addEventListener('submit', e => { e.preventDefault(); let code = $('roomCode').value.trim(); try { code = new URL(code).searchParams.get('room') || code; } catch {} if (!/^[a-f0-9]{24}$/.test(code)) return message('Paste the full invite link or room code.'); location.href = '/?room=' + code; });
  connection('Ready to join', true);
}
function inviteLink() { return location.origin + '/?room=' + room; }
async function copyInvite() {
  try { await navigator.clipboard.writeText(inviteLink()); message('Invite link copied. Send it to your friend.'); }
  catch { const input = $('inviteLink'); if (input) { input.focus(); input.select(); message('Copy the selected invite link.'); } else { message('Copy this page’s address to invite your friend.'); } }
}
function roster(p, i) {
  return `<section class="roster"><div class="roster-head"><div class="roster-title"><h3>${esc(p.name)}${i === state.you ? ' · You' : ''}</h3><span class="pill">${p.squad.length}/12</span></div><div class="counts">Bat ${p.counts[0]}/5 · AR ${p.counts[1]}/2 · Bowl ${p.counts[2]}/3 · WK ${p.counts[3]}/1 · Wild ${p.counts[4]}/1</div></div>${p.squad.length ? `<ul>${p.squad.map(x => `<li><span>${esc(x.flag)} ${esc(x.name)}<small>${esc(x.country)} · ${esc(x.role)}${x.stage === 4 ? ' · Wildcard' : ''} · ${x.rating} pts</small></span><span class="price">$${x.price}</span></li>`).join('')}</ul>` : '<div class="empty">Your first signing is waiting.</div>'}<div class="roster-head"><small>Spent $${100-p.wallet} · $${p.wallet} remaining</small></div></section>`;
}
function render() {
  const s = state;
  const you = s.seats[s.you];
  if (s.phase === 'lobby') {
    $('app').innerHTML = `<section class="setup panel"><div class="eyebrow">${s.format.toUpperCase()} · Private room</div><h1>${s.seats[1] ? 'Both players are here.' : 'Bring your rival.'}</h1><p class="intro">Send your friend this link. The auction begins when the host starts.</p><div class="lobby-seats">${s.seats.map((p,i) => `<div class="lobby-seat"><small>PLAYER ${i+1}${i === 0 ? ' · HOST' : ''}</small><strong>${p ? esc(p.name) : 'Waiting…'}</strong><span class="muted">${p ? '$100 ready to bid' : 'Share the invite below'}</span></div>`).join('')}</div><label for="inviteLink">Invite link</label><div class="copy-field"><input id="inviteLink" readonly value="${esc(inviteLink())}"><button id="copyBtn">Copy link</button></div>${s.you === 0 ? `<div class="button-row"><button class="primary" data-action="start" ${!s.seats[1] ? 'disabled' : ''}>Start ${s.format.toUpperCase()} auction</button></div>` : '<p class="intro">Waiting for the host to start…</p>'}${rules()}</section>`;
  } else if (s.phase === 'finished') {
    $('app').innerHTML = `<section class="panel"><div class="result-hero"><div class="eyebrow">${s.format.toUpperCase()} · Both squads complete</div><h1>${s.winner === -1 ? 'It’s a draw!' : esc(s.seats[s.winner].name) + ' wins! 🏆'}</h1><p class="muted">Twelve players each. Format ratings decide the result.</p></div><div class="scores">${s.seats.map((p,i) => `<div class="score">${esc(p.name)}<strong>${s.scores[i]}</strong><small>rating points · $${p.wallet} left</small></div>`).join('')}</div><p class="note">Score = sum of all 12 players’ ${s.format.toUpperCase()} ratings. Equal scores are decided by money remaining; equal money is a draw. These are editorial game ratings.</p><div class="squad-grid">${s.seats.map(roster).join('')}</div><div class="button-row"><button id="newGame" class="primary">New game</button></div></section>`;
  } else {
    const turnName = s.turn === null ? '' : s.seats[s.turn].name;
    const current = s.current;
    const card = s.phase === 'choose' ? `<section class="lot"><div class="eyebrow">The 12th player · Wildcard</div><h2>${s.you === s.turn ? 'Choose your final category.' : esc(turnName) + ' is choosing a category.'}</h2><p class="intro">A hidden player from that category enters the auction. Both sides can bid if their wildcard slot is empty.</p><div class="choice-grid">${s.categories.map(c => `<button data-category="${c}" ${s.you !== s.turn ? 'disabled' : ''}>${labels[c]}</button>`).join('')}</div></section>` : `<section class="lot"><div class="lot-top"><span>Player reveal ${s.lot}</span><span id="timer" class="timer" aria-label="Seconds remaining">—</span></div><div class="flag">${esc(current.flag)}</div><h1 class="player-name">${esc(current.name)}</h1><p class="muted">${esc(current.country)} · ${esc(current.era)}</p><div class="tags"><span class="tag">${esc(current.role)}</span><span class="tag rating">${s.format.toUpperCase()} rating ${current.rating}</span>${s.stage === 4 ? '<span class="tag">Wildcard</span>' : ''}</div><div class="bid-display"><small>${s.high ? 'Highest bid' : 'No bids yet'}</small><span class="amount">${s.high ? '$'+s.high : 'You set the price'}</span><small>${s.leader !== null ? esc(s.seats[s.leader].name) + ' leads' : 'Open with any positive whole-dollar bid'}</small></div>${s.phase === 'auction' ? `<p class="turn-note">${s.turn === s.you ? 'Your turn — raise or pass.' : esc(turnName) + ' is thinking…'}</p><div class="bid-controls">${s.seats.map((p,i) => `<div class="bidder ${s.turn === i ? 'active' : ''}"><h3>${esc(p.name)}${i === s.you ? ' · You' : ''}</h3>${i === s.you ? `<form id="bidForm"><label for="bidInput" class="help">Your bid · up to $${p.maxBid}</label><input id="bidInput" type="text" inputmode="numeric" autocomplete="off" aria-describedby="bidHelp" placeholder="Type amount" ${s.turn !== i ? 'disabled' : ''}><button id="bidButton" class="primary" ${s.turn !== i ? 'disabled' : ''}>Bid · Enter ↵</button></form><button data-action="pass" ${s.turn !== i ? 'disabled' : ''}>Pass · P</button>` : `<p class="opponent">${s.history.filter(h=>h.seat===i && h.type==='bid').length ? '$'+s.history.filter(h=>h.seat===i && h.type==='bid').at(-1).amount : '—'}</p><small>${s.turn===i ? 'Their turn to bid' : 'Watching the auction'}</small>`}</div>`).join('')}</div><p class="help" id="bidHelp">Keep $1 per unfilled slot. Enter bids; P passes. Only the winner pays.</p>` : `<div class="outcome"><h3>${s.outcome.type === 'sold' ? 'Sold to '+esc(s.seats[s.outcome.buyer].name)+' for $'+s.outcome.price : 'Unsold — both passed'}</h3><button class="primary" data-action="next">Next player · Enter ↵</button></div>`}<div class="history" aria-label="Recent bids">${s.history.slice(-6).map(h=>`<span>${esc(s.seats[h.seat].name)} ${h.type === 'bid' ? '$'+h.amount : h.type === 'timeout' ? 'timed out' : 'passed'}</span>`).join('')}</div></section>`;
    $('app').innerHTML = `<section class="panel"><div class="toolbar"><div><div class="eyebrow">${s.format.toUpperCase()} · Auction room</div><p class="muted">${s.seats.reduce((n,p)=>n+p.squad.length,0)}/24 players signed</p></div><button id="copyBtn">Copy room link</button></div><nav class="stages" aria-label="Auction stages">${s.stages.map((st,i) => `<div class="stage ${s.stage===i ? 'active' : s.stage>i ? 'done' : ''}"><strong>${i+1}. ${['Batters','All-rounders','Bowlers','Keepers','Wildcard'][i]}</strong>${st.quota} each${i===2 ? ' · pace / spin' : ''}</div>`).join('')}</nav><div class="wallets">${s.seats.map((p,i)=>`<div class="wallet ${i===s.you?'you':''}"><div><span class="name">${esc(p.name)}${i===s.you?' · You':''}</span><small>${p.squad.length}/12 signed · $${100-p.wallet} spent</small></div><strong>$${p.wallet}</strong></div>`).join('')}</div><div class="game-grid"><div>${card}<div class="note" style="">30 seconds per turn. The timer continues through disconnects. Both squads must fill this category before the next opens.</div></div><aside>${s.seats.map(roster).join('')}</aside></div>${rules()}</section>`;
  }
  $('copyBtn')?.addEventListener('click', copyInvite);
  $('newGame')?.addEventListener('click', () => { history.replaceState(null,'','/'); room=''; token=''; setup(); });
  document.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', () => request({type:b.dataset.action, revision:state.revision})));
  document.querySelectorAll('[data-category]').forEach(b => b.addEventListener('click', () => request({type:'choose', category:b.dataset.category, revision:state.revision})));
  $('bidForm')?.addEventListener('submit', e => { e.preventDefault(); submitBid(); });
  updateControls(); tick();
  const focusKey = `${s.phase}:${s.lot}:${s.turn}:${s.high}`;
  if (focusKey !== lastFocus) { lastFocus = focusKey; if (s.phase === 'auction' && s.turn === s.you) setTimeout(focusBid, 0); }
}
function focusBid() { const input=$('bidInput'); if(input && !input.disabled) { input.focus({preventScroll:true}); input.select(); } }
function submitBid() {
  if (!state || state.phase !== 'auction' || state.turn !== state.you || busy) return;
  const raw = $('bidInput').value.trim();
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) <= state.high) return message('Type a whole-dollar bid higher than the current bid.');
  if (Number(raw) > state.seats[state.you].maxBid) return message(`Your maximum bid is $${state.seats[state.you].maxBid}; keep $1 for each remaining player.`);
  request({type:'bid', amount:Number(raw), revision:state.revision});
}
function updateControls() {
  if (!state) { $('setupForm')?.querySelector('button')?.toggleAttribute('disabled',busy); return; }
  const mine = state.phase === 'auction' && state.turn === state.you;
  for (const id of ['bidInput','bidButton']) if ($(id)) $(id).disabled = busy || !connected || !mine || Date.now()+clockOffset >= state.deadline;
  document.querySelectorAll('[data-action]').forEach(b => { b.disabled = busy || !connected || (b.dataset.action === 'start' && (!state.seats[1] || state.you!==0)) || (b.dataset.action==='pass' && (!mine || Date.now()+clockOffset>=state.deadline)); });
  document.querySelectorAll('[data-category]').forEach(b => b.disabled=busy || !connected || state.turn!==state.you);
}
function tick() {
  if (!$('timer')) return;
  const seconds = state?.phase === 'auction' ? Math.max(0,Math.ceil((state.deadline-Date.now()-clockOffset)/1000)) : null;
  $('timer').textContent = seconds === null ? 'Closed' : `${seconds}s`;
  $('timer').classList.toggle('urgent', seconds !== null && seconds <= 10);
  if (seconds === 0) updateControls();
}
function schedulePoll() { clearTimeout(pollTimer); if (state && state.phase !== 'finished') pollTimer = setTimeout(()=>request(null,true), document.hidden ? 5000 : 2000); }
async function request(action = null, polling = false) {
  if (busy || (polling && pollingInFlight)) { if(polling) schedulePoll(); return; }
  if (polling) pollingInFlight = true;
  else { busy = true; updateControls(); }
  try {
    const response = await fetch('/api/room'+(room?'?room='+encodeURIComponent(room):''), { method:action?'POST':'GET', headers:{...(action?{'Content-Type':'application/json'}:{}), ...(token?{Authorization:'Bearer '+token}:{})}, body:action?JSON.stringify(action):undefined, cache:'no-store', signal:AbortSignal.timeout(12000) });
    const data = await response.json();
    if(!response.ok) { const e=new Error(data.error || 'Unable to connect.'); e.status=response.status; throw e; }
    connection('Room connected',true);
    if (data.token) {
      token = data.token; room = data.state.id;
      try { localStorage.setItem('cricket-seat:'+room,token); } catch { message('Keep this tab open: browser storage is unavailable for reconnecting.'); }
      history.replaceState(null,'','/?room='+room);
    }
    if(data.state) {
      clockOffset = data.state.serverTime-Date.now();
      if (!state || data.state.revision >= state.revision) {
        const changed = !state || state.revision !== data.state.revision;
        state=data.state;
        if(changed) render();
      }
    }
    if(data.error) { message(data.error); lastFocus=''; focusBid(); }
  } catch(e) {
    connection('Connection interrupted',false);
    if(!polling) message(e.message || 'Could not connect. Please try again.');
    if(e.status===401 && !state) { token=''; setup(true); }
  } finally {
    if(polling) pollingInFlight=false; else busy=false;
    updateControls(); schedulePoll();
    if(state?.phase==='auction' && state.turn===state.you && document.activeElement===document.body) focusBid();
  }
}
document.addEventListener('keydown', e => {
  if(!state || busy || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const editing = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName);
  if(e.key.toLowerCase()==='p' && state.phase==='auction' && state.turn===state.you && (!editing || document.activeElement.id==='bidInput')) {e.preventDefault(); request({type:'pass',revision:state.revision});}
  else if(e.key==='Enter' && state.phase==='sold' && !editing) {e.preventDefault(); request({type:'next',revision:state.revision});}
  else if(e.key==='Enter' && state.phase==='auction' && state.turn===state.you && !editing && document.activeElement.tagName!=='BUTTON') {e.preventDefault();submitBid();}
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden && state) request(null,true);});
window.addEventListener('online',()=>{if(state) request(null,true);});
window.addEventListener('focus',()=>{if(state?.phase==='auction' && state.turn===state.you) focusBid();});
setInterval(tick,250);
if(room && token) { $('app').innerHTML='<section class="setup panel"><h2>Reconnecting to your room…</h2><p class="intro">Restoring your seat and the current auction.</p><div class="button-row"><button id="retry">Retry connection</button><button id="back">Back to menu</button></div></section>'; $('retry').onclick=()=>request(); $('back').onclick=()=>{room='';token='';history.replaceState(null,'','/');setup();}; request(); }
else setup(!!room);
