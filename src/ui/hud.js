import { BUILDINGS, BUILD_ORDER, BUILDING_MAX_LEVEL, BUILDING_UPGRADE, TROOPS, TROOP_KEYS, UPGRADE, ORDERS, FORMATIONS, TILE, DIFFICULTY, WORLD, towerBounty } from '../core/config.js';
import { clamp } from '../core/rng.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const fmt = (n) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
const costHtml = (c) => {
  const bits = [];
  if (c.gold) bits.push(`<i class="g">${Math.round(c.gold)}g</i>`);
  if (c.food) bits.push(`<i class="f">${Math.round(c.food)}f</i>`);
  if (c.mats) bits.push(`<i class="m">${Math.round(c.mats)}m</i>`);
  return bits.join(' ');
};

export class HUD {
  constructor(game, view, opts) {
    this.game = game;
    this.view = view;
    this.owner = opts.owner ?? 0;
    this.dispatch = opts.dispatch;
    this.onPause = opts.onPause || (() => {});
    this.onQuit = opts.onQuit || (() => {});
    this.mode = opts.mode || 'solo';
    this.selection = new Set();
    this.tab = 'build';
    this.placement = null;
    this.drag = null;
    this.touches = new Map();
    this.pinch = null;
    this.lastClick = { t: 0, id: null };
    this.groups = new Map();
    this.uiTimer = 0;
    this.minimapTimer = 0;
    this.paused = false;
    this.lastLog = 0;
    this.keys = view.keys;

    this.bindEvents();
    this.buildMinimapBase();
    this.renderTabs();
    this.update(0.016);
  }

  show() {
    for (const id of ['#topbar', '#sidebar', '#commandbar', '#minimap-wrap']) $(id).classList.remove('hidden');
  }

  /* ------------------------------------------------------------- controls */

  bindEvents() {
    const canvas = this.view.canvas;
    this._onDown = (e) => this.onPointerDown(e);
    this._onMove = (e) => this.onPointerMove(e);
    this._onUp = (e) => this.onPointerUp(e);
    this._onCtx = (e) => e.preventDefault();
    this._onWheel = (e) => { e.preventDefault(); this.view.zoom(Math.sign(e.deltaY) * 0.12); };
    this._onKeyDown = (e) => this.onKeyDown(e);
    this._onKeyUp = (e) => this.onKeyUp(e);

    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerup', this._onUp);
    canvas.addEventListener('pointercancel', this._onUp);
    canvas.addEventListener('lostpointercapture', this._onUp);
    canvas.addEventListener('contextmenu', this._onCtx);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);

    document.querySelectorAll('#cmd-tabs .tab').forEach((b) => {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab;
        this.renderTabs();
        this.renderCommandBar(true);
      });
    });
    $('#minimap').addEventListener('mousedown', (e) => this.minimapClick(e));
    $('#btn-pause').addEventListener('click', () => this.onPause());
    $('#btn-menu').addEventListener('click', () => this.onQuit());
  }

  onKeyDown(e) {
    const k = e.key.toLowerCase();
    this.keys.add(k);
    if (k === 'escape') {
      if (this.placement) { this.cancelPlacement(); return; }
      this.clearSelection();
    }
    if (e.code === 'Space') { e.preventDefault(); this.onPause(); return; }
    if (e.key === 'Tab') { e.preventDefault(); return; }
    if (k === 'b') { this.tab = 'build'; this.renderTabs(); this.renderCommandBar(true); }
    if (k === 'r') this.rotatePlacement();
    if (k === 'a' && !this.placement) this.issueStance('assault');
    if (k === 's' && !this.placement) this.issueStance('stop');
    if (k === 'h' && !this.placement) this.issueStance('hold');
    if (k === 'x' && !this.placement) this.issueStance('retreat');
    if (k === 'g' && !this.placement) this.issueStance('guard');
    if (k >= '1' && k <= '9') {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.groups.set(k, new Set(this.selection));
        this.toast(`Group ${k} assigned`);
        return;
      }
      if (e.shiftKey) return;
      const g = this.groups.get(k);
      if (g && g.size) {
        this.setSelection([...g].map((id) => this.game.entById.get(id)).filter(Boolean));
      } else if (this.tab === 'army') {
        this.recruitHotkey(parseInt(k, 10));
      }
    }
  }

  onKeyUp(e) { this.keys.delete(e.key.toLowerCase()); }

  minimapClick(e) {
    const r = $('#minimap').getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fz = (e.clientY - r.top) / r.height;
    this.view.target.x = clamp((fx - 0.5) * WORLD.w, -WORLD.w / 2 + 16, WORLD.w / 2 - 16);
    this.view.target.z = clamp((fz - 0.5) * WORLD.h, -WORLD.h / 2 + 12, WORLD.h / 2 - 12);
  }

  /* ------------------------------------------------------------- pointer */

  onPointerDown(e) {
    if (e.pointerType === 'touch') { this.onTouchStart(e); return; }
    try { this.view.canvas.setPointerCapture?.(e.pointerId); } catch (err) { /* pointer already released */ }
    if (e.button === 1) {
      this.drag = { mode: 'pan', x: e.clientX, y: e.clientY };
      e.preventDefault();
      return;
    }
    if (e.button === 2) { this.rightClick(e); return; }
    if (e.button !== 0) return;
    if (this.placement) { this.placeBuilding(e); return; }
    this.drag = { mode: 'select', x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, additive: e.shiftKey };
    const box = $('#selection-box');
    box.classList.remove('hidden');
    box.style.left = `${e.clientX}px`;
    box.style.top = `${e.clientY}px`;
    box.style.width = '0px';
    box.style.height = '0px';
  }

  onPointerMove(e) {
    if (e.pointerType === 'touch') { this.onTouchMove(e); return; }
    const rect = this.view.canvas.getBoundingClientRect();
    this.view.pointer.x = e.clientX;
    this.view.pointer.y = e.clientY;
    if (this.placement) this.updateGhostAt(e.clientX, e.clientY);
    if (this.drag && this.drag.mode === 'pan') {
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      const scale = this.view.dist * 0.0018;
      this.view.pan(-dx * scale, -dy * scale);
      this.drag.x = e.clientX; this.drag.y = e.clientY;
    }
    if (this.drag && this.drag.mode === 'select') {
      this.drag.x1 = e.clientX; this.drag.y1 = e.clientY;
      const box = $('#selection-box');
      box.style.left = `${Math.min(this.drag.x0, this.drag.x1)}px`;
      box.style.top = `${Math.min(this.drag.y0, this.drag.y1)}px`;
      box.style.width = `${Math.abs(this.drag.x1 - this.drag.x0)}px`;
      box.style.height = `${Math.abs(this.drag.y1 - this.drag.y0)}px`;
    }
  }

  onPointerUp(e) {
    if (e.pointerType === 'touch') { this.onTouchEnd(e); return; }
    if (!this.drag) return;
    if (this.drag.mode === 'select') {
      $('#selection-box').classList.add('hidden');
      const { x0, y0, x1, y1, additive } = this.drag;
      const dragged = Math.abs(x1 - x0) > 6 || Math.abs(y1 - y0) > 6;
      if (dragged) {
        const units = this.view.unitsInBox(x0, y0, x1, y1);
        this.setSelection(units, additive);
      } else {
        this.clickSelect(e.clientX, e.clientY, additive);
      }
    }
    this.drag = null;
  }

  /* ---------------------------------------------------------------- touch */

  onTouchStart(e) {
    try { this.view.canvas.setPointerCapture?.(e.pointerId); } catch (err) { /* pointer already released */ }
    this.touches.set(e.pointerId, {
      x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY,
      t: performance.now(), moved: false,
    });
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      this.drag = null;
      $('#selection-box').classList.add('hidden');
    }
  }

  onTouchMove(e) {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    e.preventDefault();
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    t.x = e.clientX; t.y = e.clientY;
    if (Math.hypot(e.clientX - t.x0, e.clientY - t.y0) > 9) t.moved = true;

    // two fingers: pinch to zoom, drag the midpoint to pan
    if (this.touches.size >= 2 && this.pinch) {
      const [a, b] = [...this.touches.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      this.view.zoom((this.pinch.dist - dist) * 0.006);
      const scale = this.view.dist * 0.0018;
      this.view.pan(-(cx - this.pinch.cx) * scale, -(cy - this.pinch.cy) * scale);
      this.pinch = { dist, cx, cy };
      return;
    }

    // one finger: drag the camera, or slide the building ghost around
    if (t.moved) {
      const scale = this.view.dist * 0.0018;
      this.view.pan(-dx * scale, -dy * scale);
      if (this.placement) this.updateGhostAt(e.clientX, e.clientY);
    }
  }

  onTouchEnd(e) {
    const t = this.touches.get(e.pointerId);
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
    if (!t) return;
    if (!t.moved && performance.now() - t.t < 700) this.handleTap(t.x0, t.y0);
  }

  /** One tap does what left+right click do on desktop. */
  handleTap(cx, cy) {
    if (this.placement) {
      this.updateGhostAt(cx, cy);
      this.placeBuilding();
      return;
    }
    const ent = this.view.pick(cx, cy);
    const troops = this.selectedEntities().filter((x) => x.cls && !x.isKing);

    if (ent && ent.owner === this.owner) { this.clickSelect(cx, cy, false); return; }
    if (troops.length) { this.advanceTo(cx, cy, ent); return; }
    if (ent) { this.clickSelect(cx, cy, false); return; }
    this.clearSelection();
  }

  advanceTo(cx, cy, ent) {
    const ground = this.view.screenToGround(cx, cy);
    const ids = this.selectedEntities().filter((u) => u.cls && !u.isKing);
    if (!ids.length) return;
    const target = ent && ent.owner !== this.owner ? ent : null;
    const x = target ? target.x : ground.x;
    const z = target ? target.z : ground.z;
    const res = this.dispatch({
      type: 'order', owner: this.owner, order: 'assault',
      ids: ids.map((u) => u.id), x, z, formation: ids[0].formation || 'line',
    });
    if (res?.ok) this.view.addOrderMarker(x, z, target ? 0xc9564a : 0xd9b25b);
  }

  clickSelect(cx, cy, additive) {
    const ent = this.view.pick(cx, cy);
    const now = performance.now();
    if (ent && this.lastClick.id === ent.id && now - this.lastClick.t < 320) {
      // double click: select all of that class on screen
      const units = this.game.units.filter((u) => u.owner === this.owner && !u.dead
        && (ent.cls ? u.cls === ent.cls : u.id === ent.id));
      this.setSelection(units, additive);
    } else if (ent) {
      this.setSelection([ent], additive);
    } else if (!additive) {
      this.clearSelection();
    }
    this.lastClick = { t: now, id: ent ? ent.id : null };
  }

  rightClick(e) {
    const ent = this.view.pick(e.clientX, e.clientY);
    const ground = this.view.screenToGround(e.clientX, e.clientY);
    const ids = [...this.selection].map((id) => this.game.entById.get(id)).filter((x) => x && !x.isKing);
    if (!ids.length) return;

    const ownUnits = ids.filter((x) => x.cls);
    const buildings = ids.filter((x) => !x.cls);
    if (buildings.length) {
      const b = buildings[0];
      this.dispatch({ type: 'rally', owner: this.owner, buildingId: b.id, x: ground.x, z: ground.z });
      this.view.addOrderMarker(ground.x, ground.z, 0x9fd6a6);
      return;
    }
    let target = null;
    if (ent && ent.owner !== this.owner) target = ent;
    const x = target ? target.x : ground.x;
    const z = target ? target.z : ground.z;
    const order = target ? 'assault' : 'assault';
    const res = this.dispatch({
      type: 'order', owner: this.owner, order,
      ids: ownUnits.map((u) => u.id), x, z, formation: ownUnits[0]?.formation || 'line',
    });
    if (res?.ok) this.view.addOrderMarker(x, z, target ? 0xc9564a : 0xd9b25b);
  }

  issueStance(stance) {
    const ids = [...this.selection].map((id) => this.game.entById.get(id)).filter((x) => x && x.cls && !x.isKing);
    if (!ids.length) { this.toast('Select troops first'); return; }
    if (stance === 'stop') {
      this.dispatch({ type: 'order', owner: this.owner, order: 'stop', ids: ids.map((u) => u.id) });
      return;
    }
    if (stance === 'hold') {
      this.dispatch({ type: 'order', owner: this.owner, order: 'hold', ids: ids.map((u) => u.id) });
      return;
    }
    if (stance === 'retreat') {
      this.dispatch({ type: 'order', owner: this.owner, order: 'retreat', ids: ids.map((u) => u.id) });
      return;
    }
    // attack-move: use the last pointer ground position
    const p = this.view.screenToGround(this.view.pointer.x, this.view.pointer.y);
    this.dispatch({ type: 'order', owner: this.owner, order: stance, ids: ids.map((u) => u.id), x: p.x, z: p.z });
    this.view.addOrderMarker(p.x, p.z, 0xd9b25b);
  }

  /* -------------------------------------------------------------- terrain */

  snap(x, z, type, rot) {
    const def = BUILDINGS[type];
    let w = def.w, h = def.h;
    if (rot % 2 === 1) [w, h] = [h, w];
    const halfW = (w * TILE) / 2, halfH = (h * TILE) / 2;
    // towers snap onto the nearest grid tile that borders the road
    if (def.tower) {
      const tile = this.game.world.nearestTowerTile(this.owner, x, z, 10);
      if (tile) return tile;
    }
    return {
      x: clamp(Math.round(x / (TILE / 2)) * (TILE / 2), -WORLD.w / 2 + halfW, WORLD.w / 2 - halfW),
      z: clamp(Math.round(z / (TILE / 2)) * (TILE / 2), -WORLD.h / 2 + halfH, WORLD.h / 2 - halfH),
    };
  }

  enterPlacement(type) {
    this.placement = { type, rot: 0, point: { x: 0, z: 0 } };
    const hint = $('#placement-hint');
    hint.classList.remove('hidden');
    hint.innerHTML = `<span class="ph-name">${BUILDINGS[type].name.toUpperCase()}</span>
      <button id="place-rotate" type="button">⟳ ROTATE</button>
      <button id="place-cancel" type="button">✕ CANCEL</button>`;
    hint.querySelector('#place-rotate').onclick = () => this.rotatePlacement();
    hint.querySelector('#place-cancel').onclick = () => this.cancelPlacement();
    this.renderCommandBar(true);
  }

  /** Re-snap the ghost at a screen position (used by mouse move and taps). */
  updateGhostAt(cx, cy) {
    if (!this.placement) return null;
    const p = this.view.screenToGround(cx, cy);
    this.placement.point = p;
    const snapped = this.snap(p.x, p.z, this.placement.type, this.placement.rot);
    const check = this.game.world.canPlace(this.owner, this.placement.type, snapped.x, snapped.z, this.placement.rot);
    this.view.setGhost(this.placement.type, snapped.x, snapped.z, this.placement.rot, check.ok);
    this.placement.valid = check.ok;
    this.placement.snapped = snapped;
    return snapped;
  }

  rotatePlacement() {
    if (!this.placement) return;
    this.placement.rot = (this.placement.rot + 1) % 2;
    const p = this.placement.point;
    if (p) {
      const snapped = this.snap(p.x, p.z, this.placement.type, this.placement.rot);
      const check = this.game.world.canPlace(this.owner, this.placement.type, snapped.x, snapped.z, this.placement.rot);
      this.view.setGhost(this.placement.type, snapped.x, snapped.z, this.placement.rot, check.ok);
      this.placement.valid = check.ok;
      this.placement.snapped = snapped;
    }
    this.toast(`${BUILDINGS[this.placement.type].name} rotated`);
  }

  cancelPlacement() {
    this.placement = null;
    this.view.clearGhost();
    $('#placement-hint').classList.add('hidden');
    this.renderCommandBar(true);
  }

  placeBuilding() {
    if (!this.placement?.snapped) return;
    const { type, rot, snapped } = this.placement;
    const res = this.dispatch({ type: 'build', owner: this.owner, building: type, x: snapped.x, z: snapped.z, rot });
    if (res?.ok) {
      this.toast(`${BUILDINGS[type].name} ordered`);
      if (!this.keys.has('shift')) this.cancelPlacement();
    } else {
      this.toast(res?.reason || 'Cannot build there', 'bad');
    }
  }

  /* -------------------------------------------------------------- selection */

  setSelection(entities, additive = false) {
    if (!additive) this.selection.clear();
    for (const e of entities) if (e && e.id != null) this.selection.add(e.id);
    this.view.selection = this.selection;
    this.renderInspector(true);
    this.renderCommandBar(true);
  }

  clearSelection() {
    this.selection.clear();
    this.view.selection = this.selection;
    this.renderInspector(true);
    this.renderCommandBar(true);
  }

  selectedEntities() {
    const out = [];
    for (const id of this.selection) {
      const e = this.game.entById.get(id);
      if (e && !e.dead) out.push(e);
    }
    return out;
  }

  /* ----------------------------------------------------------------- panels */

  renderTabs() {
    document.querySelectorAll('#cmd-tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === this.tab));
  }

  renderCommandBar(force = false) {
    if (!force && this._barTime > performance.now() - 400) return;
    this._barTime = performance.now();
    const k = this.game.kingdoms[this.owner];
    const c = $('#cmd-content');
    c.innerHTML = '';

    if (this.tab === 'build') {
      for (const type of BUILD_ORDER) {
        const def = BUILDINGS[type];
        const card = el('div', 'card');
        const locked = def.unique && k.hasBuilding(type, false);
        const afford = k.canAfford(def.cost);
        if (locked || !afford) card.classList.add('locked');
        if (this.placement?.type === type) card.classList.add('active');
        const unlockNote = type === 'elitehall' && !k.hasBuilding('blacksmith') ? 'needs smithy' : '';
        const gain = [
          def.gold ? `+${fmt(def.gold)}g/s` : '',
          def.food ? `+${fmt(def.food)}f/s` : '',
          def.mats ? `+${fmt(def.mats)}m/s` : '',
          def.pop ? `+${def.pop} pop` : '',
          def.attack ? `${def.attack.dmg} dmg · ${def.attack.range}m · +${towerBounty(1)}g/kill` : '',
          def.healAura ? `heals ${def.healAura}/s` : '',
          def.unlocks?.length ? `trains ${def.unlocks.map((c) => TROOPS[c].short.toLowerCase()).join(', ')}` : '',
        ].filter(Boolean).join(' · ');
        card.innerHTML = `<div class="ct">${def.short}</div>
          <div class="cc">${costHtml(def.cost) || (def.unique ? 'existing' : '')}${unlockNote ? `<i style="color:#c98b5a">${unlockNote}</i>` : ''}</div>
          ${gain ? `<div class="ce">${gain}</div>` : ''}
          <div class="cd">${def.desc || ''}</div>`;
        card.title = `${def.name} — ${def.desc}\n${def.hp} HP${def.attack ? ` · ${def.attack.dmg} dmg / ${def.attack.range}m` : ''}${def.vision ? ` · ${def.vision}m vision` : ''}`;
        card.onclick = () => {
          if (locked) { this.toast('Already built', 'bad'); return; }
          if (!afford) { this.toast('Not enough resources', 'bad'); return; }
          if (type === 'elitehall' && !k.hasBuilding('blacksmith')) { this.toast('Build a Blacksmith first', 'bad'); return; }
          this.enterPlacement(type);
        };
        c.appendChild(card);
      }
    }

    if (this.tab === 'army') {
      for (const cls of TROOP_KEYS) {
        const t = TROOPS[cls];
        const src = k.buildings.find((b) => b.completed && b.def.unlocks?.includes(cls));
        const card = el('div', 'card');
        const locked = !src;
        if (locked || !k.canAfford(t.cost)) card.classList.add('locked');
        const queued = k.buildings.reduce((s, b) => s + b.queue.filter((q) => q.cls === cls).length, 0);
        card.innerHTML = `<span class="key">${t.key}</span><div class="ct">${t.short}${queued ? ` ×${queued}` : ''}</div>
          <div class="cc">${costHtml(t.cost)} <i class="p">${t.pop} pop</i></div>
          <div class="ce">${t.time}s · ${Math.round(t.hp)} HP · ${Math.round(t.atk)} ATK · ${t.range > 3 ? `${t.range}m` : 'melee'}</div>
          <div class="cd">${t.desc || ''}</div>`;
        card.title = `${t.name} — ${t.desc}\n${Math.round(t.hp)} HP · ${Math.round(t.atk)} atk · ${Math.round(t.def)} def · ${t.range > 3 ? t.range + 'm range' : 'melee'}${t.heal ? ` · heals ${t.heal}/s` : ''}\nUpkeep ${t.upkeep.gold.toFixed(2)}g ${t.upkeep.food.toFixed(2)}f / s`;
        card.onclick = () => {
          if (locked) { this.toast(`Requires ${BUILDINGS[t.from].name}`, 'bad'); return; }
          const res = this.dispatch({ type: 'recruit', owner: this.owner, buildingId: src.id, cls });
          if (!res?.ok) this.toast(res?.reason || 'Cannot recruit', 'bad');
        };
        c.appendChild(card);
      }
      const note = el('div', 'note', `Population ${Math.round(k.popUsed)} / ${Math.round(k.popCap)} · Upkeep ${k.upkeep.gold.toFixed(1)}g ${k.upkeep.food.toFixed(1)}f per second.<br>Recruits gather at their building's rally point.`);
      c.appendChild(note);
    }

    if (this.tab === 'upgrades') {
      for (const cls of TROOP_KEYS) {
        const t = TROOPS[cls];
        const lvl = k.upgrades[cls];
        const cost = UPGRADE.costFor(lvl + 1);
        const card = el('div', 'card');
        const maxed = lvl >= UPGRADE.maxLevel;
        const research = k.research?.cls === cls;
        if (maxed || !k.canAfford(cost)) card.classList.add('locked');
        if (research) card.classList.add('active');
        card.innerHTML = `<div class="ct">${t.short} <span style="color:#d9b25b">L${lvl}</span></div>
          <div class="cc">${maxed ? '<i>max level</i>' : costHtml(cost)}</div>
          ${research ? `<div class="bar" style="width:${Math.round((k.research.progress || 0) * 100)}%"></div>` : ''}`;
        card.title = maxed ? 'Maximum level reached' : `${t.name} level ${lvl} → ${lvl + 1}\n+health, damage, defence, speed and attack rate for every ${t.short}, including future recruits.`;
        card.onclick = () => {
          if (maxed) { this.toast('Already at maximum level', 'bad'); return; }
          const res = this.dispatch({ type: 'research', owner: this.owner, cls });
          if (!res?.ok) this.toast(res?.reason || 'Cannot research', 'bad');
          else this.toast(`Researching ${t.short} L${lvl + 1}`);
        };
        c.appendChild(card);
      }
      const note = el('div', 'note', k.research
        ? `Researching ${TROOPS[k.research.cls].short} — ${Math.max(0, Math.ceil(k.research.remaining))}s remaining.`
        : 'Upgrades require a completed Blacksmith and apply to the whole troop class.');
      c.appendChild(note);
    }

    if (this.tab === 'orders') {
      const wrap = el('div', 'mini-grid');
      wrap.style.gridTemplateColumns = 'repeat(4, 1fr)';
      for (const [key, o] of Object.entries(ORDERS)) {
        if (key === 'escort' || key === 'reinforce') continue;
        const b = el('button', '', `<b>${o.key}</b> ${o.name}`);
        b.title = o.desc;
        b.onclick = () => this.issueStance(key);
        wrap.appendChild(b);
      }
      c.appendChild(wrap);
      const fwrap = el('div', 'mini-grid');
      fwrap.style.gridTemplateColumns = 'repeat(5, 1fr)';
      const cur = this.selectedEntities().find((e) => e.formation)?.formation || 'line';
      for (const [key, f] of Object.entries(FORMATIONS)) {
        const b = el('button', cur === key ? 'sel' : '', f.name);
        b.title = f.desc;
        b.onclick = () => {
          const ids = this.selectedEntities().filter((e) => e.cls && !e.isKing).map((e) => e.id);
          if (!ids.length) { this.toast('Select troops first', 'bad'); return; }
          this.dispatch({ type: 'formation', owner: this.owner, formation: key, ids });
        };
        fwrap.appendChild(b);
      }
      c.appendChild(fwrap);
      const note = el('div', 'note', 'Right-click the battlefield to advance. A attacks on the way, H holds, X retreats, G guards the clicked point.');
      c.appendChild(note);
    }
  }

  recruitHotkey(n) {
    const cls = TROOP_KEYS[n - 1];
    if (!cls) return;
    const k = this.game.kingdoms[this.owner];
    const src = k.buildings.find((b) => b.completed && b.def.unlocks?.includes(cls));
    if (!src) { this.toast(`Requires ${BUILDINGS[TROOPS[cls].from].name}`, 'bad'); return; }
    const res = this.dispatch({ type: 'recruit', owner: this.owner, buildingId: src.id, cls });
    if (!res?.ok) this.toast(res?.reason || 'Cannot recruit', 'bad');
  }

  /* ------------------------------------------------------------- inspector */

  renderInspector(force = false) {
    if (!force && this._inspTime > performance.now() - 250) return;
    this._inspTime = performance.now();
    const body = $('#inspector-body');
    const sel = this.selectedEntities();
    if (!sel.length) { body.innerHTML = ''; return; }
    const k = this.game.kingdoms[this.owner];

    const buildings = sel.filter((e) => !e.cls);
    if (buildings.length) {
      const b = buildings[0];
      const def = BUILDINGS[b.type];
      const hpPct = Math.round((b.hp / b.maxHp) * 100);
      const upCost = b.level < BUILDING_MAX_LEVEL ? BUILDING_UPGRADE.cost(b.type, b.level + 1) : null;
      const repair = this.game.repairCost(b);
      const recruit = (b.def.unlocks || []).map((cls) => {
        const t = TROOPS[cls];
        return `<button data-recruit="${cls}" class="primary">${t.short} ${Math.round(t.cost.gold)}g</button>`;
      }).join('');
      const queue = b.queue.map((q, i) => `<div class="stat"><span>${TROOPS[q.cls].short}</span><b>${Math.ceil(q.remaining)}s</b></div>`).join('');
      body.innerHTML = `
        <div class="insp-title">${def.name}${b.level > 1 ? ` · L${b.level}` : ''}</div>
        <div class="insp-sub">${b.completed ? (b.owner === this.owner ? 'YOUR STRUCTURE' : 'ENEMY') : `BUILDING ${Math.round(b.progress * 100)}%`}</div>
        <div class="hpbar ${hpPct > 50 ? 'good' : ''}"><i style="width:${hpPct}%"></i></div>
        <div class="stat"><span>Health</span><b>${Math.round(b.hp)} / ${b.maxHp}</b></div>
        ${def.gold ? `<div class="stat"><span>Gold</span><b>+${(def.gold * BUILDING_UPGRADE.outMult(b.level)).toFixed(1)}/s</b></div>` : ''}
        ${def.food ? `<div class="stat"><span>Food</span><b>+${(def.food * BUILDING_UPGRADE.outMult(b.level)).toFixed(1)}/s</b></div>` : ''}
        ${def.mats ? `<div class="stat"><span>Materials</span><b>+${(def.mats * BUILDING_UPGRADE.outMult(b.level)).toFixed(1)}/s</b></div>` : ''}
        ${def.pop ? `<div class="stat"><span>Population</span><b>+${Math.round(def.pop * (1 + 0.25 * (b.level - 1)))}</b></div>` : ''}
        ${def.attack ? `<div class="stat"><span>Tower damage</span><b>${Math.round(b.attackDamage)} · ${Math.round(b.attackRange)}m</b></div>` : ''}
        ${def.attack ? `<div class="stat"><span>Bounty per kill</span><b>+${towerBounty(b.level)}g</b></div>` : ''}
        ${queue}
        ${b.upgrading ? `<div class="stat"><span>Upgrading</span><b>${Math.ceil(b.upgrading.remaining)}s</b></div>` : ''}
        <div class="insp-actions">
          ${recruit}
          ${upCost && b.completed ? `<button data-upgrade="1">Upgrade ${Math.round(upCost.gold)}g ${Math.round(upCost.mats)}m</button>` : ''}
          ${b.completed && b.hp < b.maxHp ? `<button data-repair="1">Repair ${Math.round(repair.gold)}g ${Math.round(repair.mats)}m</button>` : ''}
          ${b.queue.length ? `<button data-cancel="1">Cancel recruit</button>` : ''}
          ${b.type !== 'castle' ? `<button data-demolish="1">Demolish</button>` : ''}
        </div>`;
      body.querySelectorAll('[data-recruit]').forEach((btn) => {
        btn.onclick = () => {
          const res = this.dispatch({ type: 'recruit', owner: this.owner, buildingId: b.id, cls: btn.dataset.recruit });
          if (!res?.ok) this.toast(res?.reason || 'Cannot recruit', 'bad');
        };
      });
      const up = body.querySelector('[data-upgrade]');
      if (up) up.onclick = () => {
        const res = this.dispatch({ type: 'upgradeBuilding', owner: this.owner, buildingId: b.id });
        if (!res?.ok) this.toast(res?.reason || 'Cannot upgrade', 'bad');
      };
      const rep = body.querySelector('[data-repair]');
      if (rep) rep.onclick = () => {
        const res = this.dispatch({ type: 'repair', owner: this.owner, buildingId: b.id });
        if (!res?.ok) this.toast(res?.reason || 'Cannot repair', 'bad');
      };
      const canc = body.querySelector('[data-cancel]');
      if (canc) canc.onclick = () => this.dispatch({ type: 'cancelRecruit', owner: this.owner, buildingId: b.id });
      const dem = body.querySelector('[data-demolish]');
      if (dem) dem.onclick = () => {
        const res = this.dispatch({ type: 'demolish', owner: this.owner, buildingId: b.id });
        if (res?.ok) { this.clearSelection(); this.toast('Structure demolished'); }
      };
      return;
    }

    // units
    const groups = {};
    for (const u of sel) groups[u.cls] = (groups[u.cls] || 0) + 1;
    const lead = sel[0];
    body.innerHTML = `
      <div class="insp-title">${sel.length} TROOP${sel.length > 1 ? 'S' : ''}</div>
      <div class="insp-sub">${Object.entries(groups).map(([c, n]) => `${n}× ${TROOPS[c].short}`).join(' · ')}</div>
      <div class="hpbar good"><i style="width:${Math.round((sel.reduce((s, u) => s + u.hp / u.maxHp, 0) / sel.length) * 100)}%"></i></div>
      <div class="stat"><span>Health</span><b>${Math.round(sel.reduce((s, u) => s + u.hp, 0))} / ${Math.round(sel.reduce((s, u) => s + u.maxHp, 0))}</b></div>
      <div class="stat"><span>Order</span><b>${ORDERS[lead.order.type]?.name || lead.order.type}</b></div>
      <div class="stat"><span>Formation</span><b>${FORMATIONS[lead.formation]?.name || 'Line'}</b></div>
      <div class="stat"><span>Upgrade</span><b>Level ${lead.level}</b></div>
      <div class="insp-actions">
        ${['assault', 'defense', 'hold', 'patrol', 'retreat'].map((o) => `<button data-order="${o}">${ORDERS[o].name}</button>`).join('')}
      </div>`;
    body.querySelectorAll('[data-order]').forEach((btn) => {
      btn.onclick = () => this.issueStance(btn.dataset.order);
    });
  }

  /* --------------------------------------------------------------- minimap */

  buildMinimapBase() {
    const cv = document.createElement('canvas');
    cv.width = 240; cv.height = 135;
    const g = cv.getContext('2d');
    const w = this.game.world;
    for (let y = 0; y < 135; y++) {
      for (let x = 0; x < 240; x++) {
        const wx = (x / 240 - 0.5) * WORLD.w;
        const wz = (y / 135 - 0.5) * WORLD.h;
        const h = w.heightAt(wx, wz);
        const water = w.isWater(wx, wz);
        let r = 32, gg = 40, b = 26;
        if (water) { r = 20; gg = 44; b = 58; }
        else if (h < -0.5) { r = 42; gg = 38; b = 28; }
        else {
          const n = ((Math.sin(wx * 0.3) + Math.cos(wz * 0.4) + 2) / 4) * 10;
          r = 30 + n; gg = 40 + n; b = 24 + n;
        }
        g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
        g.fillRect(x, y, 1, 1);
      }
    }
    // bridge
    g.fillStyle = '#6b5233';
    g.fillRect(115, 67, 12, 8);
    this.minimapBase = cv;
  }

  drawMinimap() {
    const cv = $('#minimap');
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 240, 135);
    g.drawImage(this.minimapBase, 0, 0);
    const k = this.game.kingdoms[this.owner];
    const fog = k.fog;

    // fog
    const fw = 240 / fog.w, fh = 135 / fog.h;
    for (let cz = 0; cz < fog.h; cz++) {
      for (let cx = 0; cx < fog.w; cx++) {
        const i = cz * fog.w + cx;
        if (fog.visible[i]) continue;
        g.fillStyle = fog.explored[i] ? 'rgba(4,6,7,0.55)' : 'rgba(3,4,5,0.94)';
        g.fillRect(cx * fw, cz * fh, fw + 0.6, fh + 0.6);
      }
    }

    const toMap = (x, z) => [clamp(((x / WORLD.w) + 0.5) * 240, 0, 240), clamp(((z / WORLD.h) + 0.5) * 135, 0, 135)];
    for (const b of this.game.buildings) {
      if (b.dead) continue;
      if (b.owner !== this.owner && !fog.isVisible(b.x, b.z)) continue;
      const [mx, my] = toMap(b.x, b.z);
      g.fillStyle = b.owner === this.owner ? '#7fa9d8' : '#d1654d';
      const s = b.type === 'castle' ? 6 : 3;
      g.fillRect(mx - s / 2, my - s / 2, s, s);
    }
    for (const u of this.game.units) {
      if (u.dead || u.hidden) continue;
      if (u.owner !== this.owner && !fog.isVisible(u.x, u.z)) continue;
      const [mx, my] = toMap(u.x, u.z);
      g.fillStyle = u.owner === this.owner ? '#cfe2ff' : '#ff8a70';
      g.fillRect(mx - 1, my - 1, 2, 2);
    }

    // camera rectangle
    const corners = [
      this.view.worldToScreen(0, 0, 0),
    ];
    const tl = this.view.screenToGround(0, 0);
    const tr = this.view.screenToGround(this.view.vw, 0);
    const bl = this.view.screenToGround(0, this.view.vh);
    const br = this.view.screenToGround(this.view.vw, this.view.vh);
    g.strokeStyle = 'rgba(217,178,91,0.85)';
    g.lineWidth = 1;
    g.beginPath();
    [[tl, tr], [tr, br], [br, bl], [bl, tl]].forEach(([a, b]) => {
      const [ax, ay] = toMap(a.x, a.z);
      const [bx, by] = toMap(b.x, b.z);
      g.moveTo(ax, ay); g.lineTo(bx, by);
    });
    g.stroke();
  }

  /* ----------------------------------------------------------------- misc */

  toast(text, kind = '') {
    const wrap = $('#toast-wrap');
    const t = el('div', `toast ${kind}`, text);
    wrap.appendChild(t);
    setTimeout(() => t.remove(), 2600);
    while (wrap.children.length > 4) wrap.firstChild.remove();
  }

  renderLog() {
    const ul = $('#log');
    const logs = this.game.logs[this.owner];
    if (logs.length === this.lastLog) return;
    this.lastLog = logs.length;
    ul.innerHTML = logs.slice(-14).map((l) => `<li class="${l.kind}">${l.text}</li>`).join('');
    ul.scrollTop = ul.scrollHeight;
  }

  update(dt) {
    this.uiTimer += dt;
    this.minimapTimer += dt;
    if (this.uiTimer > 0.2) {
      this.uiTimer = 0;
      this.updateTopBar();
      this.renderLog();
      this.renderInspector();
      this.renderCommandBar();
      this.updateKingdomStatus();
    }
    if (this.minimapTimer > 0.25) {
      this.minimapTimer = 0;
      this.drawMinimap();
    }
  }

  updateTopBar() {
    const k = this.game.kingdoms[this.owner];
    const set = (sel, v) => { const n = document.querySelector(`${sel} b`); if (n) n.textContent = v; };
    set('#res-gold', Math.floor(k.resources.gold));
    set('#res-food', Math.floor(k.resources.food));
    set('#res-mats', Math.floor(k.resources.mats));
    set('#res-pop', `${Math.round(k.popUsed)}/${Math.round(k.popCap)}`);
    set('#res-army', `${k.armyCount}`);
    $('#res-food').classList.toggle('low', k.resources.food < 40 || k.starving);
    const t = Math.floor(this.game.time);
    $('#clock').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    if (this.mode === 'solo') $('#ai-label').textContent = `ENEMY: ${this.game.difficulty.name}`;
    else $('#ai-label').textContent = 'HEAD-TO-HEAD';
    $('#faction-name').textContent = k.faction.name;
  }

  updateKingdomStatus() {
    const k = this.game.kingdoms[this.owner];
    const g = this.game.snapshotEconomy(this.owner);
    const res = k.research ? `${TROOPS[k.research.cls].short} L${k.upgrades[k.research.cls] + 1} (${Math.ceil(k.research.remaining)}s)` : '—';
    $('#kingdom-status').innerHTML = `
      <div class="row"><span>Gold</span><b>${g.goldRate >= 0 ? '+' : ''}${g.goldRate.toFixed(1)}/s</b></div>
      <div class="row"><span>Food</span><b>${g.foodRate >= 0 ? '+' : ''}${g.foodRate.toFixed(1)}/s</b></div>
      <div class="row"><span>Materials</span><b>+${g.matRate.toFixed(1)}/s</b></div>
      <div class="row"><span>Army</span><b>${g.army} troops</b></div>
      <div class="row"><span>Research</span><b>${res}</b></div>
      ${g.starving ? '<div class="row" style="color:#d98a5a"><span>STARVATION</span><b>troops weakening</b></div>' : ''}`;
  }
}
