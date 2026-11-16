import { TICK, DIFFICULTY } from './core/config.js';
import { Game } from './core/game.js';
import { Assets } from './render/assets.js';
import { View } from './render/view.js';
import { HUD } from './ui/hud.js';
import { Sound } from './ui/audio.js';
import { PeerLink, Lockstep } from './net/mp.js';

const $ = (s) => document.querySelector(s);
const assets = new Assets();
const sound = new Sound();

const state = {
  game: null, view: null, hud: null, mode: 'solo', owner: 0,
  paused: false, over: false, lockstep: null, link: null,
  tickAcc: 0, last: 0, running: false, difficulty: 'normal', seed: 0,
};

/* ------------------------------------------------------------------ menu */

function bindMenu() {
  const desc = $('#diff-desc');
  document.querySelectorAll('#diff-row button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#diff-row button').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      state.difficulty = b.dataset.diff;
      desc.textContent = DIFFICULTY[state.difficulty].desc;
    });
  });
  $('#btn-solo').addEventListener('click', () => {
    sound.init(); sound.resume(); sound.ambient();
    startMatch({ mode: 'solo', difficulty: state.difficulty, owner: 0, seed: (Math.random() * 1e9) | 0 });
  });
  $('#btn-host').addEventListener('click', hostMatch);
  $('#btn-join').addEventListener('click', joinMatch);
  $('#btn-pause').addEventListener('click', togglePause);
  $('#btn-menu').addEventListener('click', () => location.reload());
  $('#btn-sound').addEventListener('click', () => {
    sound.init(); sound.resume(); sound.ambient();
    const on = sound.toggle();
    $('#btn-sound').textContent = on ? '♪' : '×';
  });
}

function mpPanel(html) {
  const p = $('#mp-panel');
  p.classList.remove('hidden');
  p.innerHTML = html;
  return p;
}

async function hostMatch() {
  sound.init(); sound.resume();
  const p = mpPanel(`
    <label>1 · SEND THIS OFFER CODE TO YOUR OPPONENT</label>
    <textarea id="mp-offer" readonly>generating…</textarea>
    <div class="copy-row"><button id="mp-copy-offer">COPY CODE</button></div>
    <label>2 · PASTE THEIR ANSWER CODE HERE</label>
    <textarea id="mp-answer" placeholder="paste answer code"></textarea>
    <div class="copy-row"><button id="mp-connect">CONNECT</button></div>
    <div class="mp-status" id="mp-status">starting peer…</div>`);
  const link = new PeerLink({
    onStatus: (s) => { const n = $('#mp-status'); if (n) n.textContent = s; },
    onOpen: () => {
      $('#mp-status').textContent = 'connected — starting battle';
      const seed = (Math.random() * 1e9) | 0;
      link.send({ t: 'start', seed, difficulty: state.difficulty });
      startMatch({ mode: 'mp', owner: 0, seed, difficulty: state.difficulty, link });
    },
    onMessage: (msg) => { if (msg.t === 'start') { /* guest never sends */ } },
    onClose: () => { const n = $('#mp-status'); if (n) n.textContent = 'connection lost'; },
  });
  const offer = await link.host();
  $('#mp-offer').value = offer;
  $('#mp-copy-offer').onclick = () => copyText($('#mp-offer'));
  $('#mp-connect').onclick = async () => {
    try {
      await link.acceptAnswer($('#mp-answer').value);
      $('#mp-status').textContent = 'connecting…';
    } catch (e) { $('#mp-status').textContent = `bad answer code (${e.message})`; }
  };
}

async function joinMatch() {
  sound.init(); sound.resume();
  mpPanel(`
    <label>1 · PASTE THE HOST'S OFFER CODE</label>
    <textarea id="mp-offer-in" placeholder="paste offer code"></textarea>
    <div class="copy-row"><button id="mp-join-go">CREATE ANSWER</button></div>
    <label>2 · SEND THIS ANSWER CODE BACK TO THE HOST</label>
    <textarea id="mp-answer-out" readonly></textarea>
    <div class="copy-row"><button id="mp-copy-answer">COPY CODE</button></div>
    <div class="mp-status" id="mp-status">waiting for offer…</div>`);
  $('#mp-join-go').onclick = async () => {
    const code = $('#mp-offer-in').value;
    if (!code.trim()) { $('#mp-status').textContent = 'paste the offer code first'; return; }
    let link;
    link = new PeerLink({
      onStatus: (s) => { const n = $('#mp-status'); if (n) n.textContent = s; },
      onOpen: () => { $('#mp-status').textContent = 'connected — waiting for host to start'; },
      onMessage: (msg) => {
        if (msg.t === 'start') {
          startMatch({ mode: 'mp', owner: 1, seed: msg.seed, difficulty: msg.difficulty, link });
        }
      },
      onClose: () => { const n = $('#mp-status'); if (n) n.textContent = 'connection lost'; },
    });
    try {
      const answer = await link.join(code);
      $('#mp-answer-out').value = answer;
      $('#mp-copy-answer').onclick = () => copyText($('#mp-answer-out'));
      $('#mp-status').textContent = 'send the answer code to the host, then wait';
    } catch (e) {
      $('#mp-status').textContent = `could not read offer (${e.message})`;
    }
  };
}

function copyText(node) {
  node.select();
  node.setSelectionRange(0, 999999);
  try { navigator.clipboard?.writeText(node.value); } catch (e) { document.execCommand('copy'); }
  const status = $('#mp-status');
  if (status) status.textContent = 'copied to clipboard';
}

/* ------------------------------------------------------------- match start */

async function startMatch(opts) {
  try {
    await startMatchInner(opts);
  } catch (err) {
    console.error('[KA] failed to start match', err);
    $('#loading').classList.add('hidden');
    const overlay = $('#overlay');
    $('#overlay-title').textContent = 'COULD NOT START';
    $('#overlay-text').textContent = String(err && err.message ? err.message : err);
    $('#overlay-actions').innerHTML = '<button id="btn-reload" class="primary">RELOAD</button>';
    overlay.classList.remove('hidden');
    $('#btn-reload').onclick = () => location.reload();
  }
}

async function startMatchInner({ mode, difficulty, owner, seed, link }) {
  state.mode = mode; state.owner = owner; state.seed = seed; state.link = link || null;
  state.over = false; state.paused = false; state.tickAcc = 0;
  $('#menu').classList.add('hidden');
  $('#loading').classList.remove('hidden');
  $('#overlay').classList.add('hidden');

  await assets.load((p) => {
    $('#load-text').textContent = `MUSTERING THE REALM… ${Math.round(p * 100)}%`;
  });
  $('#loading').classList.add('hidden');

  const game = new Game({ mode, difficulty, seed });
  state.game = game;
  const view = new View($('#scene'), game, owner, assets);
  state.view = view;

  if (mode === 'mp' && link) {
    state.lockstep = new Lockstep({
      link,
      onCommands: () => {},
      onState: (s) => {
        if (s === 'waiting' && state.hud) state.hud.toast('Waiting for opponent…');
      },
    });
    link.onMessage = (msg) => { if (state.lockstep) state.lockstep.receive(msg); };
  }

  const hud = new HUD(game, view, {
    owner, mode,
    dispatch: (cmd) => dispatch(cmd),
    onPause: togglePause,
    onQuit: () => location.reload(),
  });
  state.hud = hud;
  hud.show();

  game.on('gameover', (e) => showEnd(e));
  game.on('log', () => {});
  game.on('buildingDestroyed', () => sound.build());

  state.last = performance.now();
  if (!state.running) { state.running = true; requestAnimationFrame(loop); }
  setTimeout(() => hud.toast(mode === 'solo' ? `${DIFFICULTY[difficulty].name} AI — build, expand, destroy their king` : 'Battle begins — destroy the enemy king'), 500);
}

function dispatch(cmd) {
  if (!state.game || state.over) return { ok: false, reason: 'The war is over' };
  if (state.mode === 'mp' && state.lockstep) {
    if (cmd.owner !== state.owner) return { ok: false, reason: 'Not your kingdom' };
    return state.lockstep.queue(cmd);
  }
  const res = state.game.command(cmd);
  if (res && !res.ok && res.reason) state.hud?.toast(res.reason, 'bad');
  return res;
}

/* -------------------------------------------------------------------- loop */

function loop(now) {
  const dt = Math.min(0.12, (now - state.last) / 1000 || 0.016);
  state.last = now;
  const game = state.game;
  const view = state.view;

  if (game && view && !state.paused && !state.over) {
    if (state.lockstep) {
      state.tickAcc += dt;
      const turnTicks = state.lockstep.ticksPerTurn;
      let guard = 0;
      while (state.tickAcc >= TICK * turnTicks && guard++ < 3) {
        const cmds = state.lockstep.beginTurn();
        if (!cmds) { state.tickAcc = TICK * turnTicks; break; }
        for (const c of cmds) game.command(c);
        for (let i = 0; i < turnTicks; i++) game.update(TICK);
        state.tickAcc -= TICK * turnTicks;
      }
    } else {
      state.tickAcc += dt;
      let steps = 0;
      while (state.tickAcc >= TICK && steps < 6) {
        game.update(TICK);
        state.tickAcc -= TICK;
        steps++;
      }
      if (steps >= 6) state.tickAcc = 0;
    }
    if (game.over) state.over = true;
  }

  if (view) {
    const alpha = state.lockstep ? 1 : Math.min(1, state.tickAcc / TICK);
    view.render(dt, alpha);
  }
  if (state.hud) state.hud.update(dt);
  requestAnimationFrame(loop);
}

/* ------------------------------------------------------------------ pause */

function togglePause() {
  if (!state.game || state.over) return;
  state.paused = !state.paused;
  const overlay = $('#overlay');
  if (state.paused) {
    $('#overlay-title').textContent = 'PAUSED';
    $('#overlay-text').textContent = 'The realm holds its breath.';
    $('#overlay-actions').innerHTML = '<button id="btn-resume" class="primary">RESUME</button><button id="btn-quit">QUIT TO MENU</button>';
    overlay.classList.remove('hidden');
    $('#btn-resume').onclick = togglePause;
    $('#btn-quit').onclick = () => location.reload();
  } else {
    overlay.classList.add('hidden');
    state.last = performance.now();
  }
  $('#btn-pause').textContent = state.paused ? '▶' : '❚❚';
}

function showEnd(e) {
  state.over = true;
  const won = e.winner === state.owner;
  const overlay = $('#overlay');
  $('#overlay-title').textContent = won ? 'VICTORY' : 'DEFEAT';
  $('#overlay-text').innerHTML = won
    ? `${e.reason}<br>The enemy kingdom is broken and your banner flies over their castle.`
    : `${e.reason}<br>Your king is dead. The kingdom passes to the enemy.`;
  $('#overlay-actions').innerHTML = '<button id="btn-again" class="primary">NEW BATTLE</button><button id="btn-menu2">MAIN MENU</button>';
  overlay.classList.remove('hidden');
  $('#btn-again').onclick = () => location.reload();
  $('#btn-menu2').onclick = () => location.reload();
  if (won) sound.victory(); else sound.defeat();
}

/* ------------------------------------------------------------------- boot */

bindMenu();
window.addEventListener('pointerdown', () => { sound.init(); sound.resume(); }, { once: true });

// expose for debugging in the console
window.__kingdomAssault = state;
