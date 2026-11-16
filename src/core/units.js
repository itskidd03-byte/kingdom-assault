import { TROOPS, TILE, unitStats, ORDERS } from './config.js';
import { clamp, dist, angleTo } from './rng.js';

let UID = 1;
export const nextUnitId = () => UID++;
export const resetUnitIds = () => { UID = 1; };

/** Formation offsets (in world units) for a group of n units facing +x. */
export function formationOffsets(n, type = 'line', spacing = 2.1) {
  const out = [];
  if (n <= 0) return out;
  if (type === 'wedge') {
    let row = 0, placed = 0;
    while (placed < n) {
      const inRow = row + 1;
      for (let i = 0; i < inRow && placed < n; i++, placed++) {
        out.push({ dx: -row * spacing * 0.9, dz: (i - (inRow - 1) / 2) * spacing });
      }
      row++;
    }
    return out;
  }
  if (type === 'circle') {
    const r = Math.max(2.2, spacing * Math.sqrt(n / Math.PI));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push({ dx: Math.cos(a) * r, dz: Math.sin(a) * r });
    }
    return out;
  }
  if (type === 'shield') {
    const cols = Math.max(3, Math.ceil(n / 3));
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols), col = i % cols;
      out.push({ dx: -row * spacing * 0.85, dz: (col - (cols - 1) / 2) * spacing * 0.72 });
    }
    return out;
  }
  if (type === 'spread') {
    const cols = Math.max(2, Math.ceil(Math.sqrt(n * 2.4)));
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols), col = i % cols;
      const jitterX = ((i * 37) % 11) / 11 * spacing * 0.9 - spacing * 0.45;
      const jitterZ = ((i * 53) % 13) / 13 * spacing * 0.9 - spacing * 0.45;
      out.push({
        dx: -row * spacing * 1.5 + jitterX,
        dz: (col - (cols - 1) / 2) * spacing * 1.6 + jitterZ,
      });
    }
    return out;
  }
  // line
  const cols = Math.max(2, Math.ceil(Math.sqrt(n * 2.2)));
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols), col = i % cols;
    out.push({ dx: -row * spacing, dz: (col - (cols - 1) / 2) * spacing });
  }
  return out;
}

export class Unit {
  constructor(game, owner, cls, x, z, opts = {}) {
    this.id = nextUnitId();
    this.game = game;
    this.owner = owner;
    this.cls = cls;
    this.x = x; this.z = z;
    this.prevX = x; this.prevZ = z;
    this.y = game.world.groundAt(x, z);
    this.rot = owner === 0 ? Math.PI / 2 : -Math.PI / 2;
    this.dead = false;
    this.isKing = !!opts.isKing;
    this.hidden = !!opts.hidden;
    this.name = opts.name || TROOPS[cls].name;
    this.level = 1;
    this.order = { type: 'hold', x, z };
    this.targetId = null;
    this.cooldown = 0;
    this.healCooldown = 0;
    this.path = null; this.pathIdx = 0;
    this.repathTimer = 0;
    this.stuckTimer = 0;
    this.state = 'idle';
    this.attackFlash = 0;
    this.chargeDist = 0;
    this.currentSpeed = 0;
    this.facing = this.rot;
    this.groupId = 0;
    this.formation = 'line';
    this.dest = { x, z };
    this.patrolA = null; this.patrolB = null; this.patrolLeg = 0;
    this.garrisonOf = opts.garrisonOf ?? null;
    this.applyStats();
    this.hp = this.maxHp;
  }

  applyStats() {
    const s = unitStats(this.game.kingdoms[this.owner], this.cls);
    this.stats = s;
    this.maxHp = s.maxHp;
    this.atk = s.atk;
    this.def = s.def;
    this.speed = s.speed;
    this.range = s.range;
    this.atkInterval = 1 / s.atkSpeed;
    this.vision = s.vision;
    this.radius = s.radius;
    this.pop = s.pop;
    this.level = s.level;
  }

  get alive() { return !this.dead && this.hp > 0; }

  setOrder(type, x, z, extra = {}) {
    this.order = { type, x, z, ...extra };
    this.path = null; this.pathIdx = 0; this.repathTimer = 0;
    if (type === 'hold') { this.dest = { x: this.x, z: this.z }; return; }
    if (type === 'patrol') {
      this.patrolA = { x: this.x, z: this.z };
      this.patrolB = { x, z };
      this.patrolLeg = 1;
      this.moveTo(x, z);
      return;
    }
    if (type === 'retreat') {
      this.moveTo(x, z);
      return;
    }
    this.moveTo(extra.destX ?? x, extra.destZ ?? z);
  }

  moveTo(x, z) {
    this.dest = { x, z };
    this.path = null;
    this.pathIdx = 0;
    this.state = 'moving';
  }

  /** Follow the assigned path, or replan if needed. */
  stepMovement(game, dt) {
    const w = game.world;
    if (this.order.type === 'hold') { this.currentSpeed = 0; return; }
    const d = dist(this.x, this.z, this.dest.x, this.dest.z);
    if (d < 0.9) { this.currentSpeed = 0; this.path = null; return; }

    if (!this.path) {
      this.path = w.path(this.x, this.z, this.dest.x, this.dest.z);
      this.pathIdx = 0;
      this.repathTimer = 1.4 + ((this.id * 37) % 10) / 50;
    }
    this.repathTimer -= dt;
    if (this.repathTimer <= 0 && this.stuckTimer > 0.9) {
      this.path = w.path(this.x, this.z, this.dest.x, this.dest.z);
      this.pathIdx = 0;
      this.repathTimer = 1.8;
      this.stuckTimer = 0;
    }

    let tx = this.dest.x, tz = this.dest.z;
    if (this.path && this.path.length) {
      while (this.pathIdx < this.path.length) {
        const wp = this.path[this.pathIdx];
        if (dist(this.x, this.z, wp.x, wp.z) < 1.6) this.pathIdx++;
        else break;
      }
      if (this.pathIdx < this.path.length) {
        tx = this.path[this.pathIdx].x;
        tz = this.path[this.pathIdx].z;
      }
    }

    const ang = Math.atan2(tx - this.x, tz - this.z);
    const sp = this.speed;
    let vx = Math.sin(ang) * sp;
    let vz = Math.cos(ang) * sp;

    // separation from nearby friendly units
    const nb = game.queryUnits(this.x, this.z, 2.6);
    for (let i = 0; i < nb.length; i++) {
      const o = nb[i];
      if (o === this || o.owner !== this.owner) continue;
      const dx = this.x - o.x, dz = this.z - o.z;
      const dd = dx * dx + dz * dz;
      const minD = (this.radius + o.radius) * 1.5;
      if (dd > 0.0001 && dd < minD * minD) {
        const dl = Math.sqrt(dd);
        const push = (minD - dl) / minD;
        vx += (dx / dl) * sp * push * 0.85;
        vz += (dz / dl) * sp * push * 0.85;
      }
    }

    const nx = this.x + vx * dt;
    const nz = this.z + vz * dt;
    if (w.isNavigable(nx, this.z)) this.x = nx;
    if (w.isNavigable(this.x, nz)) this.z = nz;
    this.x = clamp(this.x, -w.halfW + 2, w.halfW - 2);
    this.z = clamp(this.z, -w.halfH + 2, w.halfH - 2);

    const moved = dist(this.x, this.z, this.prevX, this.prevZ);
    this.currentSpeed = moved / Math.max(dt, 0.0001);
    if (moved < sp * dt * 0.25) this.stuckTimer += dt; else this.stuckTimer = 0;

    if (Math.abs(vx) + Math.abs(vz) > 0.01) {
      this.rot = Math.atan2(vx, vz);
    }
    this.groundY = game.world.groundAt(this.x, this.z);
  }

  faceTowards(x, z) { this.rot = Math.atan2(x - this.x, z - this.z); }

  /** Combat + support behaviour for this tick. */
  stepCombat(game, dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.attackFlash > 0) this.attackFlash -= dt;
    if (this.cls === 'medic') { this.stepHealing(game, dt); return; }

    const inRange = this.range + 0.4;
    const mayChase = this.order.type !== 'hold' && this.order.type !== 'retreat';
    let target = game.getTarget(this.targetId);
    if (target && (!target.alive || target.hidden || target.owner === this.owner)) { target = null; this.targetId = null; }
    if (target) {
      const d = dist(this.x, this.z, target.x, target.z) - (target.radius || 1.2);
      if (d > this.vision + 6) { this.targetId = null; target = null; }
    }
    if (!target) {
      target = game.acquireTarget(this, this.state === 'moving' ? inRange + 1.5 : this.vision);
      if (target) this.targetId = target.id;
    }
    if (!target) return;

    const d = dist(this.x, this.z, target.x, target.z) - (target.radius || 1.2);
    const canHit = d <= inRange;
    if (canHit) {
      this.currentSpeed = 0;
      this.path = null;
      this.faceTowards(target.x, target.z);
      if (this.cooldown <= 0) {
        this.cooldown = this.atkInterval;
        this.attackFlash = 0.32;
        game.performAttack(this, target);
      }
      this.state = 'attacking';
    } else if (mayChase) {
      // chase
      this.state = 'chasing';
      if (this.repathTimer <= 0 || !this.path || dist(this.dest.x, this.dest.z, target.x, target.z) > 3.5) {
        this.dest = { x: target.x, z: target.z };
        this.path = game.world.path(this.x, this.z, target.x, target.z);
        this.pathIdx = 0;
        this.repathTimer = 0.55;
      }
      this.stepMovement(game, dt);
    }
  }

  stepHealing(game, dt) {
    this.healCooldown -= dt;
    if (this.healCooldown > 0) return;
    this.healCooldown = 0.85;
    const range = this.stats.healRange || 9;
    const nb = game.queryUnits(this.x, this.z, range);
    let best = null, bestFrac = 0.94;
    for (const o of nb) {
      if (o.owner !== this.owner || !o.alive || o.cls === 'medic' || o.isKing) continue;
      const frac = o.hp / o.maxHp;
      if (frac < bestFrac) { bestFrac = frac; best = o; }
    }
    if (best) {
      const amount = this.stats.heal || 10;
      best.hp = Math.min(best.maxHp, best.hp + amount);
      this.faceTowards(best.x, best.z);
      this.attackFlash = 0.3;
      game.addHealFx(best);
    }
  }
}
