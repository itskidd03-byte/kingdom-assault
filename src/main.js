import { TICK, DIFFICULTY } from './core/config.js';
import { Game } from './core/game.js';
import { Assets } from './render/assets.js';
import { View } from './render/view.js';
import { HUD } from './ui/hud.js';
import { Sound } from './ui/audio.js';
import { PeerLink, Lockstep } from './net/mp.js';
import { Accounts, Saves } from './core/save.js';

const $ = (s) => document.querySelector(s);
const assets = new Assets();
const sound = new Sound();

const state = {
  game: null, view: null, hud: null, mode: 'solo', owner: 0,
  paused: false, over: false, lockstep: null, link: null,
  tickAcc: 0, last: 0, running: false, difficulty: 'normal', seed: 0,
  user: null,
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
  $('#btn-menu').addEventListener('click', () => openGameMenu());
  const assaultButton = $('#btn-assault');
  if (assaultButton) assaultButton.addEventListener('click', () => {
    if (!state.game || state.over) { state.hud?.toast('The war is over', 'bad'); return; }
    const res = state.hud?.dispatch({ type: 'assaultAll', owner: state.owner });
    if (res?.ok) state.hud.toast(`${res.count} troops march on the enemy kingdom`, 'good');
  });
  const exitButton = $('#btn-exit');
  if (exitButton) exitButton.addEventListener('click', () => exitGame());
  $('#btn-sound').addEventListener('click', () => {
    sound.init(); sound.resume(); sound.ambient();
    const on = sound.toggle();
    $('#btn-sound').textContent = on ? '♪' : '×';
  });
}

/* ------------------------------------------------------------- app shell */

function initApp() {
  const install = $('#btn-install');
  const hint = $('#app-hint');
  let prompt = null;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    prompt = event;
    if (install) install.classList.remove('hidden');
  });

  if (install) {
    install.addEventListener('click', async () => {
      if (!prompt) return;
      prompt.prompt();
      await prompt.userChoice.catch(() => null);
      prompt = null;
      install.classList.add('hidden');
    });
  }

  window.addEventListener('appinstalled', () => install && install.classList.add('hidden'));

  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (installed && hint) {
    hint.textContent = 'Installed — the game is stored on this device. Head-to-head still works from the app.';
  }

  const apk = $('#btn-apk');
  if (apk && installed) apk.textContent = 'GET UPDATES';

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.Capacitor) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}

initApp();

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

async function startMatchInner({ mode, difficulty, owner, seed, link, restore }) {
  state.mode = mode; state.owner = owner; state.seed = seed; state.link = link || null;
  state.over = false; state.paused = false; state.tickAcc = 0;
  $('#menu').classList.add('hidden');
  $('#loading').classList.remove('hidden');
  $('#overlay').classList.add('hidden');

  await assets.load((p) => {
    $('#load-text').textContent = `MUSTERING THE REALM… ${Math.round(p * 100)}%`;
  });
  $('#loading').classList.add('hidden');

  const game = restore ? Game.fromSave(restore) : new Game({ mode, difficulty, seed });
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
    onQuit: () => openGameMenu(),
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

function clockText(t) {
  const m = String(Math.floor(t / 60)).padStart(2, '0');
  const s = String(Math.floor(t % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

function openGameMenu() {
  if (!state.game) { location.reload(); return; }
  state.paused = true;
  autosave(true);
  const overlay = $('#overlay');
  $('#overlay-title').textContent = 'COMMAND MENU';
  $('#overlay-text').innerHTML = `Battle at ${clockText(state.game.time)} · ${state.user ? `signed in as <b>${state.user}</b>` : 'not signed in — progress only saves with an account'}`;
  $('#overlay-actions').innerHTML = `
    <button id="m-resume" class="primary">RESUME</button>
    <button id="m-save">SAVE NOW</button>
    <button id="m-menu">MAIN MENU</button>
    <button id="m-exit">EXIT GAME</button>`;
  overlay.classList.remove('hidden');
  $('#m-resume').onclick = () => {
    overlay.classList.add('hidden');
    state.paused = false;
    state.last = performance.now();
    $('#btn-pause').textContent = '❚❚';
  };
  $('#m-save').onclick = () => {
    const ok = autosave(true);
    $('#m-save').textContent = ok ? 'SAVED' : 'SIGN IN TO SAVE';
  };
  $('#m-menu').onclick = () => { autosave(true); location.reload(); };
  $('#m-exit').onclick = () => exitGame();
  $('#btn-pause').textContent = '▶';
}

function exitGame() {
  autosave(true);
  state.paused = true;
  const overlay = $('#overlay');
  $('#overlay-title').textContent = 'THE REALM SLEEPS';
  $('#overlay-text').innerHTML = state.user
    ? 'Your campaign is saved. You can close this window now.'
    : 'You can close this window now.';
  $('#overlay-actions').innerHTML = '<button id="x-back" class="primary">BACK TO MENU</button>';
  overlay.classList.remove('hidden');
  $('#x-back').onclick = () => location.reload();
  try { window.close(); } catch (err) { /* browsers may refuse; the overlay explains */ }
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
  if (state.mode === 'solo') Saves.clear(state.user);
  const chip = $('#save-state');
  if (chip) chip.textContent = 'CAMPAIGN OVER';
  $('#btn-again').onclick = () => location.reload();
  $('#btn-menu2').onclick = () => location.reload();
  if (won) sound.victory(); else sound.defeat();
}

/* ---------------------------------------------------------------- accounts */

function setAccountMessage(text, kind = '') {
  const el = $('#acc-msg');
  if (!el) return;
  el.dataset.kind = kind;
  el.textContent = text;
}

function refreshAccountUI() {
  const user = state.user = Accounts.current();
  const signedOut = $('#account-signed-out');
  const signedIn = $('#account-signed-in');
  if (!signedOut || !signedIn) return;

  if (user) {
    signedOut.classList.add('hidden');
    signedIn.classList.remove('hidden');
    $('#acc-current').textContent = user;
    const save = Saves.read(user);
    const cont = $('#btn-continue');
    if (save) {
      cont.classList.remove('hidden');
      cont.textContent = `CONTINUE — ${Saves.stamp(save)}`;
      $('#acc-save-info').textContent = `${Saves.describe(save)} · autosaved ${Saves.stamp(save)}`;
    } else {
      cont.classList.add('hidden');
      $('#acc-save-info').textContent = 'No campaign yet — start one and it saves itself.';
    }
    $('#save-state').textContent = 'AUTOSAVE ON';
  } else {
    signedOut.classList.remove('hidden');
    signedIn.classList.add('hidden');
    $('#save-state').textContent = 'NOT SIGNED IN';
  }
}

async function submitAccount(create) {
  const name = $('#acc-name').value;
  const pass = $('#acc-pass').value;
  const result = create ? await Accounts.create(name, pass) : await Accounts.login(name, pass);
  if (!result.ok) { setAccountMessage(result.reason, 'bad'); return; }
  setAccountMessage(create
    ? `Welcome, ${result.name}. Every match is saved automatically.`
    : `Signed in as ${result.name}.`, 'good');
  $('#acc-pass').value = '';
  refreshAccountUI();
}

function autosave(force = false) {
  if (!state.user) return false;
  const game = state.game;
  if (!game || state.over || state.mode !== 'solo') return false;
  if (!force && game.time < 5) return false;
  const ok = Saves.write(state.user, game.serialize());
  const chip = $('#save-state');
  if (chip && ok) {
    const now = new Date();
    chip.textContent = `SAVED ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }
  return ok;
}

function bindAccount() {
  const login = $('#btn-login');
  if (!login) return;
  login.addEventListener('click', () => submitAccount(false));
  $('#btn-register').addEventListener('click', () => submitAccount(true));
  $('#acc-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAccount(Accounts.current() ? true : false); });
  $('#acc-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#acc-pass').focus(); });

  $('#btn-logout').addEventListener('click', () => {
    autosave(true);
    Accounts.logout();
    setAccountMessage('Signed out. Your save stays on this device.', '');
    refreshAccountUI();
  });
  $('#btn-forget').addEventListener('click', () => {
    if (!state.user) return;
    Saves.clear(state.user);
    setAccountMessage('Campaign save deleted.', '');
    refreshAccountUI();
  });
  $('#btn-continue').addEventListener('click', () => {
    const save = Saves.read(state.user);
    if (!save) { refreshAccountUI(); return; }
    sound.init(); sound.resume(); sound.ambient();
    startMatch({ mode: 'solo', difficulty: save.difficulty, owner: 0, seed: save.seed, restore: save });
  });

  setInterval(() => autosave(), 12000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autosave(true); });
  window.addEventListener('pagehide', () => autosave(true));
  refreshAccountUI();
}

/* ------------------------------------------------------------------- boot */

bindMenu();
bindAccount();
window.addEventListener('pointerdown', () => { sound.init(); sound.resume(); }, { once: true });

// expose for debugging in the console
window.__kingdomAssault = state;
