import {
  TROOPS, BUILDINGS, BUILDING_MAX_LEVEL, BUILDING_UPGRADE, UPGRADE, TILE,
  MAX_UNITS_PER_KINGDOM, DIFFICULTY, BASE_X, towerBounty,
} from './config.js';
import { World } from './world.js';
import { Kingdom } from './kingdom.js';
import { Building, resetBuildingIds } from './buildings.js';
import { Unit, formationOffsets, resetUnitIds } from './units.js';
import { SpatialHash } from './spatial.js';
import { RNG, dist, clamp } from './rng.js';
import { AIController } from './ai.js';

const KING_HP = 1500;

export class Game {
  constructor(opts = {}) {
    resetUnitIds();
    resetBuildingIds();
    this.mode = opts.mode || 'solo';
    this.difficultyKey = opts.difficulty || 'normal';
    this.difficulty = DIFFICULTY[this.difficultyKey];
    this.seed = opts.seed || 20261116;
    this.rng = new RNG(this.seed);
    this.world = new World(this.seed);
    this.buildings = [];
    this.units = [];
    this.projectiles = [];
    this.effects = [];
    this.kingdoms = [new Kingdom(this, 0), new Kingdom(this, 1)];
    this.kingdoms[0].isAI = false;
    this.kingdoms[1].isAI = this.mode === 'solo';
    this.kingdoms[1].difficulty = this.difficulty;
    this.time = 0;
    this.tick = 0;
    this.over = false;
    this.winner = null;
    this.endReason = '';
    this.logs = [[], []];
    this.unitHash = new SpatialHash(9);
    this.entById = new Map();
    this.world.attachBuildings(this.buildings);
    this.fogTimer = 0;
    this.ai = this.mode === 'solo' ? new AIController(this, this.kingdoms[1], this.difficulty) : null;
    this.listeners = [];
    this.setup();
  }

  /* ------------------------------------------------------------------ setup */

  setup() {
    for (const owner of [0, 1]) {
      const k = this.kingdoms[owner];
      const sx = owner === 0 ? -1 : 1;
      const castleX = sx * (BASE_X + 22);
      const castle = this.place(owner, 'castle', castleX, 0, 0, { completed: true });
      k.castle = castle;

      // preset settlement: everything sits in the two bands beside the highway
      const layout = [
        ['townhall', BASE_X, 16, 0, { completed: true }],
        ['house', BASE_X + 12, 10, 0, { completed: true }],
        ['house', BASE_X - 12, 12, 0, { completed: true }],
        ['farm', BASE_X + 6, -15, 0, { completed: true }],
        ['market', BASE_X - 18, -12, 0, { completed: true }],
        ['mine', BASE_X - 6, -17, 0, { completed: true }],
        ['barracks', BASE_X + 24, 14, 0, { completed: true }],
        ['blacksmith', BASE_X - 24, 14, 0, { completed: true }],
      ];
      for (const [type, dx, dz, rot, o] of layout) {
        const x = sx * dx, z = dz * (owner === 0 ? 1 : -1);
        let spot = { x, z };
        if (!this.world.canPlace(owner, type, x, z, rot).ok) {
          const alt = this.world.findSpot(owner, type, rot, this.rng, { x: sx * BASE_X, z: 0 });
          if (alt) spot = alt;
        }
        this.place(owner, type, spot.x, spot.z, rot, o);
      }

      // king, locked inside the castle
      const king = new Unit(this, owner, 'elite', castleX, 0, { isKing: true, hidden: true, name: 'The King' });
      king.maxHp = KING_HP; king.hp = KING_HP; king.atk = 34; king.def = 24; king.radius = 0.7;
      king.moveTo = () => {}; // the king never takes orders
      this.units.push(king);
      k.king = king;

      // small starting garrison
      // the garrison musters on the road outside the castle
      const startPos = { x: sx * (BASE_X - 8), z: 0 };
      const starters = ['infantry', 'infantry', 'infantry', 'infantry', 'ranged', 'ranged', 'garrison'];
      starters.forEach((cls, i) => {
        const offset = (i - (starters.length - 1) / 2) * 2.2;
        const u = new Unit(this, owner, cls, startPos.x + offset * sx, 0);
        u.setOrder('defense', startPos.x, 0);
        this.units.push(u);
      });

      this.refreshFog(owner);
      this.kingdoms[owner].recalc();
    }
    this.linkEntities();
    this.log(0, 'Your kingdom stands. Raise an army and take the bridge.', 'good');
    this.log(1, 'The rival kingdom stirs beyond the river.');
  }

  place(owner, type, x, z, rot = 0, opts = {}) {
    const b = new Building(this, owner, type, x, z, rot, opts);
    this.buildings.push(b);
    return b;
  }

  /* ------------------------------------------------------------- entities */

  linkEntities() {
    this.entById.clear();
    for (const u of this.units) if (!u.dead) this.entById.set(u.id, u);
    for (const b of this.buildings) if (!b.dead) this.entById.set(b.id, b);
  }

  getTarget(id) { return id == null ? null : this.entById.get(id); }

  queryUnits(x, z, r) {
    return this.unitHash.query(x, z, r, this._qbuf || (this._qbuf = []));
  }

  /** Closest hostile entity a unit can legitimately engage, within `radius`. */
  acquireTarget(unit, radius) {
    const enemies = this.units;
    let best = null, bestD = radius * radius;
    const leash = unit.order.type === 'guard' ? 17 : unit.order.type === 'defense' ? 34 : Infinity;
    const px = unit.x, pz = unit.z;
    const near = this.queryUnits(unit.x, unit.z, radius + 4);
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      if (o === unit || o.dead || o.hidden || o.owner === unit.owner) continue;
      if (leash !== Infinity && dist(o.x, o.z, unit.order.x, unit.order.z) > leash + 10) continue;
      const d = (o.x - px) ** 2 + (o.z - pz) ** 2;
      if (d < bestD) { bestD = d; best = o; }
    }
    // structures are valid targets too (walls, towers, castle)
    if (!best) {
      for (const b of this.buildings) {
        if (b.dead || b.owner === unit.owner) continue;
        const d = (b.x - px) ** 2 + (b.z - pz) ** 2;
        const rad = (Math.max(b.w, b.h) * TILE) / 2;
        if (d < (radius + rad) ** 2) {
          const dd = d - rad * rad;
          if (dd < bestD) { bestD = dd; best = b; }
        }
      }
    }
    // an exposed king is a prize target
    const king = this.kingdoms[1 - unit.owner].king;
    if (king && king.alive && !king.hidden) {
      const d = (king.x - px) ** 2 + (king.z - pz) ** 2;
      if (d < (radius + 4) ** 2 && d < bestD) { bestD = d; best = king; }
    }
    return best;
  }

  acquireTowerTarget(b) {
    const range = b.attackRange;
    let best = null, bestD = range * range;
    const near = this.queryUnits(b.x, b.z, range + 3);
    for (const o of near) {
      if (o.dead || o.hidden || o.owner === b.owner) continue;
      const d = (o.x - b.x) ** 2 + (o.z - b.z) ** 2;
      if (d < bestD) { bestD = d; best = o; }
    }
    if (!best) {
      const king = this.kingdoms[1 - b.owner].king;
      if (king && king.alive && !king.hidden) {
        const d = (king.x - b.x) ** 2 + (king.z - b.z) ** 2;
        if (d < bestD) { bestD = d; best = king; }
      }
    }
    return best;
  }

  /* ------------------------------------------------------------------ tick */

  update(dt) {
    if (this.over) return;
    this.time += dt;
    this.tick++;

    // spatial hash
    this.unitHash.clear();
    for (const u of this.units) if (u.alive) this.unitHash.insert(u);
    this.linkEntities();

    for (const b of this.buildings) b.update(this, dt);

    for (const u of this.units) {
      if (!u.alive) continue;
      const k = this.kingdoms[u.owner];
      if (k.defeated) continue;
      u.prevX = u.x; u.prevZ = u.z;

      if (u.isKing) { this.stepKing(u, dt); continue; }

      // patrol legs
      if (u.order.type === 'patrol') {
        const goal = u.patrolLeg === 1 ? u.patrolB : u.patrolA;
        if (goal && dist(u.x, u.z, goal.x, goal.z) < 2.2) {
          u.patrolLeg = u.patrolLeg === 1 ? 0 : 1;
          const next = u.patrolLeg === 1 ? u.patrolB : u.patrolA;
          if (next) u.moveTo(next.x, next.z);
        }
      }

      u.stepCombat(this, dt);
      if (u.state !== 'attacking' && u.state !== 'chasing') u.stepMovement(this, dt);

      // starvation attrition
      if (k.starving && this.tick % 20 === 0) {
        u.hp -= 1.4;
        if (u.hp <= 0) this.killUnit(u, null);
      }
    }

    this.updateProjectiles(dt);

    for (const k of this.kingdoms) k.update(dt);

    // medical tents heal nearby troops (both sides, identical rules)
    for (const b of this.buildings) {
      if (b.dead || !b.completed || !b.def.healAura) continue;
      if (this.tick % 10 !== 0) continue;
      const near = this.queryUnits(b.x, b.z, 13);
      for (const o of near) {
        if (o.owner !== b.owner || !o.alive) continue;
        o.hp = Math.min(o.maxHp, o.hp + b.def.healAura * (1 + 0.3 * (b.level - 1)));
      }
    }

    // fog of war refresh (identical for AI and player)
    this.fogTimer += dt;
    if (this.fogTimer >= 0.22) {
      this.fogTimer = 0;
      this.refreshFog(0);
      this.refreshFog(1);
    }

    if (this.ai) this.ai.update(dt);

    this.projectiles = this.projectiles.filter((p) => p.alive);
    this.effects = this.effects.filter((e) => e.life > 0);
    for (const e of this.effects) e.life -= dt;

    this.checkVictory();
  }

  stepKing(u, dt) {
    if (u.hidden) return;
    if (u.cooldown > 0) u.cooldown -= dt;
    if (u.attackFlash > 0) u.attackFlash -= dt;
    const target = this.acquireTarget(u, u.vision);
    if (!target) return;
    const d = dist(u.x, u.z, target.x, target.z) - (target.radius || 1.2);
    if (d <= u.range + 0.4) {
      u.faceTowards(target.x, target.z);
      if (u.cooldown <= 0) {
        u.cooldown = u.atkInterval;
        u.attackFlash = 0.3;
        this.performAttack(u, target);
      }
    }
  }

  /* ---------------------------------------------------------------- combat */

  performAttack(attacker, target) {
    const stats = attacker.stats || {};
    let dmg = attacker.atk;
    let charge = false;
    if (stats.chargeBonus && attacker.currentSpeed > stats.chargeSpeed) {
      dmg *= stats.chargeBonus;
      charge = true;
    }
    if (this.kingdoms[attacker.owner].starving) dmg *= 0.75;
    dmg *= 0.9 + this.rng.next() * 0.2;

    if (stats.projectile) {
      this.projectiles.push({
        x: attacker.x, z: attacker.z, y: (attacker.groundY || 0) + 1.4,
        tx: target.x, tz: target.z, targetId: target.id,
        owner: attacker.owner, dmg, kind: stats.projectile, speed: stats.projSpeed || 40,
        alive: true, life: 3.2, arc: 0.55,
      });
      return;
    }
    this.applyDamage(target, dmg, attacker, charge ? 'charge' : 'melee');
  }

  fireTowerShot(b, target) {
    const kind = b.def.attack.proj || 'arrow';
    this.projectiles.push({
      x: b.x, z: b.z, y: b.y + 7 * (b.level * 0.25 + 0.75),
      tx: target.x, tz: target.z, targetId: target.id,
      owner: b.owner, dmg: b.attackDamage, kind, speed: kind === 'bolt' ? 34 : 46,
      alive: true, life: 4, arc: kind === 'bolt' ? 1.4 : 0.4, fromTower: true,
      towerId: b.id, towerLevel: b.level,
    });
    this.effects.push({ type: 'towerfire', x: b.x, z: b.z, y: b.y, life: 0.25 });
  }

  applyDamage(target, dmg, source, kind) {
    if (!target || target.dead) return;
    if (target instanceof Building) {
      target.damage(this, dmg, source);
      this.effects.push({ type: 'hitBuilding', x: target.x, z: target.z, life: 0.3 });
      return;
    }
    const def = target.def || 0;
    const mit = 1 - def / (def + 55);
    const dealt = Math.max(dmg * 0.15, dmg * mit);
    target.hp -= dealt;
    target.lastHit = this.time;
    this.effects.push({ type: 'hit', x: target.x, z: target.z, y: (target.groundY || 0) + 1.2, life: 0.3, kind });
    if (target.hp <= 0) {
      if (target.isKing) this.killKing(target);
      else this.killUnit(target, source);
    }
  }

  killUnit(u, source) {
    if (u.dead) return;
    u.dead = true;
    u.hp = 0;
    this.effects.push({ type: 'death', x: u.x, z: u.z, y: u.groundY || 0, life: 1.1, owner: u.owner, cls: u.cls });
    if (source && this.kingdoms[source.owner]) this.kingdoms[source.owner].stats.killed++;
    // towers pay a bounty for every kill they land
    if (source?.towerId) {
      const k = this.kingdoms[source.owner];
      if (k) {
        const gold = towerBounty(source.towerLevel || 1);
        k.resources.gold += gold;
        k.stats.bounty = (k.stats.bounty || 0) + gold;
        this.effects.push({ type: 'bounty', x: u.x, z: u.z, y: (u.groundY || 0) + 1.6, life: 1.3, owner: source.owner, gold });
        if (this.emit) this.emit('bounty', { owner: source.owner, gold, level: source.towerLevel || 1 });
      }
    }
    if (this.kingdoms[u.owner]) this.kingdoms[u.owner].stats.lost++;
    if (u.isKing) this.killKing(u);
  }

  killKing(king) {
    if (!king.alive && king.dead) return;
    king.dead = true;
    king.hp = 0;
    const loser = this.kingdoms[king.owner];
    const winner = this.kingdoms[1 - king.owner];
    loser.defeated = true;
    this.over = true;
    this.winner = winner.id;
    this.endReason = `${loser.name} has fallen — the king is dead.`;
    this.log(winner.id, 'THE ENEMY KING IS SLAIN. THE KINGDOM IS YOURS.', 'good');
    this.log(king.owner, 'Your king has fallen. The kingdom is lost.', 'bad');
    this.effects.push({ type: 'kingdeath', x: king.x, z: king.z, y: king.groundY || 0, life: 3 });
    this.emit('gameover', { winner: winner.id, reason: this.endReason });
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      const t = this.getTarget(p.targetId);
      if (t && !t.dead) { p.tx = t.x; p.tz = t.z; }
      const dx = p.tx - p.x, dz = p.tz - p.z;
      const d = Math.hypot(dx, dz);
      const step = p.speed * dt;
      if (d <= step + 0.6) {
        p.alive = false;
        const tt = this.getTarget(p.targetId);
        if (tt && !tt.dead) {
          const shooter = { owner: p.owner, atk: 0, towerId: p.towerId, towerLevel: p.towerLevel };
          this.applyDamage(tt, p.dmg, shooter, p.kind);
        }
        this.effects.push({ type: 'impact', x: p.tx, z: p.tz, y: p.y, life: 0.25, kind: p.kind });
        continue;
      }
      p.x += (dx / d) * step;
      p.z += (dz / d) * step;
      const tRemain = d / p.speed;
      p.y = (p.y || 2) * 0.98 + (p.fromTower ? 0 : 0.02);
      p.arcT = 1 - tRemain / 3.2;
      p.life -= dt;
      if (p.life <= 0) p.alive = false;
    }
  }

  addHealFx(unit) {
    this.effects.push({ type: 'heal', x: unit.x, z: unit.z, y: (unit.groundY || 0) + 1.4, life: 0.5 });
  }

  /* ------------------------------------------------------------- buildings */

  onBuildingCompleted(b) {
    this.kingdoms[b.owner].recalc();
    this.refreshFog(b.owner);
    if (b.type === 'castle') this.log(b.owner, 'Your castle stands ready.', 'good');
  }

  onBuildingDestroyed(b, source) {
    this.kingdoms[b.owner].recalc();
    const label = b.def.short;
    if (b.type === 'castle') {
      this.log(b.owner, 'THE CASTLE HAS FALLEN! The king is exposed!', 'bad');
      this.log(1 - b.owner, 'The enemy castle is breached. Kill their king!', 'good');
      this.exposeKing(b.owner);
      this.effects.push({ type: 'castleFall', x: b.x, z: b.z, y: b.y, life: 4 });
    } else if (b.def.pop || b.def.gold || b.def.food || b.def.mats) {
      this.log(b.owner, `${label} destroyed`, 'warn');
    }
    this.emit('buildingDestroyed', { id: b.id, owner: b.owner, type: b.type });
  }

  exposeKing(owner) {
    const k = this.kingdoms[owner];
    const king = k.king;
    if (!king || !king.alive) return;
    king.hidden = false;
    king.x += owner === 0 ? 6 : -6;
    king.groundY = this.world.groundAt(king.x, king.z);
    king.maxHp = Math.max(king.hp, KING_HP * 0.4);
    // loyal guards rush out
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const u = new Unit(this, owner, 'elite', king.x + Math.cos(a) * 3.5, king.z + Math.sin(a) * 3.5);
      u.setOrder('defense', king.x, king.z);
      this.units.push(u);
    }
    this.emit('kingExposed', { owner });
  }

  repairCost(b) {
    const missing = 1 - b.hp / b.maxHp;
    const base = b.def.cost || { gold: 80, mats: 60 };
    return {
      gold: Math.ceil(((base.gold || 60) * 0.6 + 25) * missing),
      mats: Math.ceil(((base.mats || 40) * 0.7 + 20) * missing),
      food: 0,
    };
  }

  /* ---------------------------------------------------------------- units */

  spawnUnit(owner, cls, building) {
    const k = this.kingdoms[owner];
    if (this.units.filter((u) => u.owner === owner && u.alive && !u.isKing).length >= MAX_UNITS_PER_KINGDOM) return null;
    const a = this.rng.next() * Math.PI * 2;
    const r = 3 + this.rng.next() * 2.5;
    let x = building.x + Math.cos(a) * r;
    let z = building.z + Math.sin(a) * r + (building.owner === 0 ? 2 : -2);
    if (!this.world.isNavigable(x, z)) { x = building.x; z = building.z; }
    const u = new Unit(this, owner, cls, x, z);
    const rally = building.rally || this.world.nearestRoadPoint(building.x, building.z);
    const spawn = this.world.nearestRoadPoint(rally.x, rally.z);
    u.x = spawn.x; u.z = spawn.z;
    u.groundY = this.world.heightAt(spawn.x, spawn.z);
    u.setOrder('defense', rally.x, rally.z);
    this.units.push(u);
    k.stats.trained++;
    this.emit('unitSpawned', { id: u.id, cls, owner });
    return u;
  }

  /* ------------------------------------------------------------- commands */

  /** Every player/AI action funnels through here so rules are identical. */
  command(cmd) {
    if (this.over && cmd.type !== 'none') return { ok: false, reason: 'The war is over' };
    const k = this.kingdoms[cmd.owner];
    if (!k || k.defeated) return { ok: false, reason: 'Kingdom defeated' };
    switch (cmd.type) {
      case 'build': return this.cmdBuild(cmd);
      case 'cancelPlacement': return { ok: true };
      case 'recruit': return this.cmdRecruit(cmd);
      case 'cancelRecruit': return this.cmdCancelRecruit(cmd);
      case 'upgradeBuilding': return this.cmdUpgradeBuilding(cmd);
      case 'repair': return this.cmdRepair(cmd);
      case 'demolish': return this.cmdDemolish(cmd);
      case 'research': return this.cmdResearch(cmd);
      case 'order': return this.cmdOrder(cmd);
      case 'formation': return this.cmdFormation(cmd);
      case 'rally': return this.cmdRally(cmd);
      default: return { ok: false, reason: 'Unknown command' };
    }
  }

  cmdBuild(cmd) {
    const k = this.kingdoms[cmd.owner];
    const def = BUILDINGS[cmd.building];
    if (!def) return { ok: false, reason: 'Unknown structure' };
    if (def.unique && k.hasBuilding(cmd.building, false)) return { ok: false, reason: 'Already built' };
    if (cmd.building === 'elitehall' && !k.hasBuilding('blacksmith')) {
      return { ok: false, reason: 'Requires a Blacksmith' };
    }
    const check = this.world.canPlace(cmd.owner, cmd.building, cmd.x, cmd.z, cmd.rot || 0);
    if (!check.ok) return check;
    if (!k.canAfford(def.cost)) return { ok: false, reason: 'Not enough resources' };

    k.pay(def.cost);
    const b = this.place(cmd.owner, cmd.building, cmd.x, cmd.z, cmd.rot || 0, {
      completed: false, speed: k.isAI ? k.difficulty.buildSpeed : 1,
    });
    this.log(cmd.owner, `Building ${def.name}…`);
    this.emit('buildStarted', { id: b.id, type: b.type, owner: b.owner });
    return { ok: true, id: b.id };
  }

  cmdRecruit(cmd) {
    const k = this.kingdoms[cmd.owner];
    const t = TROOPS[cmd.cls];
    if (!t) return { ok: false, reason: 'Unknown troop' };
    const source = k.buildings.find((b) => b.id === cmd.buildingId && !b.dead && b.completed);
    if (!source || !source.def.unlocks?.includes(cmd.cls)) return { ok: false, reason: 'No suitable building' };
    if (source.queue.length >= 8) return { ok: false, reason: 'Recruitment queue is full' };
    const pendingPop = source.queue.reduce((s, q) => s + TROOPS[q.cls].pop, 0);
    if (k.popUsed + pendingPop + t.pop > k.popCap) return { ok: false, reason: 'Population cap reached — build Houses' };
    if (!k.canAfford(t.cost)) return { ok: false, reason: 'Not enough resources' };
    if (k.units.filter((u) => !u.isKing).length + pendingPop >= MAX_UNITS_PER_KINGDOM) {
      return { ok: false, reason: 'Army at maximum size' };
    }
    k.pay(t.cost);
    const speed = 1 + 0.12 * (source.level - 1);
    source.queue.push({ cls: cmd.cls, remaining: t.time / speed, total: t.time / speed });
    return { ok: true };
  }

  cmdCancelRecruit(cmd) {
    const k = this.kingdoms[cmd.owner];
    const b = k.buildings.find((x) => x.id === cmd.buildingId);
    if (!b || !b.queue.length) return { ok: false, reason: 'Nothing queued' };
    const q = b.queue.pop();
    const t = TROOPS[q.cls];
    k.refund({ gold: (t.cost.gold || 0) * 0.8, food: (t.cost.food || 0) * 0.8, mats: (t.cost.mats || 0) * 0.8 });
    return { ok: true };
  }

  cmdUpgradeBuilding(cmd) {
    const k = this.kingdoms[cmd.owner];
    const b = k.buildings.find((x) => x.id === cmd.buildingId);
    if (!b || !b.completed) return { ok: false, reason: 'Structure not finished' };
    if (b.level >= BUILDING_MAX_LEVEL) return { ok: false, reason: 'Already at maximum level' };
    if (b.upgrading) return { ok: false, reason: 'Upgrade already in progress' };
    const cost = BUILDING_UPGRADE.cost(b.type, b.level + 1);
    if (!k.canAfford(cost)) return { ok: false, reason: 'Not enough resources' };
    k.pay(cost);
    b.upgrading = { remaining: BUILDING_UPGRADE.time(b.type, b.level + 1), total: BUILDING_UPGRADE.time(b.type, b.level + 1) };
    return { ok: true };
  }

  cmdRepair(cmd) {
    const k = this.kingdoms[cmd.owner];
    const b = k.buildings.find((x) => x.id === cmd.buildingId && !x.dead);
    if (!b) return { ok: false, reason: 'No structure' };
    if (b.hp >= b.maxHp) return { ok: false, reason: 'Already at full health' };
    const cost = this.repairCost(b);
    if (!k.canAfford(cost)) return { ok: false, reason: 'Not enough resources' };
    k.pay(cost);
    b.hp = b.maxHp;
    b.repairing = false;
    return { ok: true };
  }

  cmdDemolish(cmd) {
    const k = this.kingdoms[cmd.owner];
    const b = k.buildings.find((x) => x.id === cmd.buildingId && !x.dead);
    if (!b) return { ok: false, reason: 'No structure' };
    if (b.type === 'castle') return { ok: false, reason: 'You cannot demolish your own castle' };
    const def = BUILDINGS[b.type];
    k.refund({ gold: (def.cost.gold || 0) * 0.3, food: 0, mats: (def.cost.mats || 0) * 0.3 });
    b.dead = true;
    this.world.applyBuildingNav(b, false);
    this.kingdoms[b.owner].recalc();
    return { ok: true };
  }

  cmdResearch(cmd) {
    const k = this.kingdoms[cmd.owner];
    if (!TROOPS[cmd.cls]) return { ok: false, reason: 'Unknown troop' };
    return k.startResearch(cmd.cls);
  }

  cmdOrder(cmd) {
    const k = this.kingdoms[cmd.owner];
    const ids = new Set(cmd.ids || []);
    const list = this.units.filter((u) => ids.has(u.id) && u.owner === cmd.owner && u.alive && !u.isKing);
    if (!list.length) return { ok: false, reason: 'No units selected' };
    const type = cmd.order;
    const formation = cmd.formation || list[0].formation || 'line';
    const cx = cmd.x ?? list[0].x, cz = cmd.z ?? list[0].z;

    if (type === 'retreat') {
      const home = this.kingdoms[cmd.owner].castle;
      for (const u of list) {
        u.setOrder('retreat', home.x + (cmd.owner === 0 ? 14 : -14), u.z * 0.3);
      }
      return { ok: true };
    }
    if (type === 'hold') {
      for (const u of list) u.setOrder('hold', u.x, u.z);
      return { ok: true };
    }
    if (type === 'stop') {
      for (const u of list) { u.order = { type: 'hold', x: u.x, z: u.z }; u.path = null; u.targetId = null; u.state = 'idle'; }
      return { ok: true };
    }

    // formation slots around the destination, facing the way the group travels
    const facing = Math.atan2(cx - list[0].x, cz - list[0].z);
    const offsets = formationOffsets(list.length, formation);
    const cos = Math.cos(facing), sin = Math.sin(facing);
    list.sort((a, b) => a.id - b.id);
    list.forEach((u, i) => {
      const o = offsets[i] || { dx: 0, dz: 0 };
      const rx = o.dx * cos + o.dz * sin;
      const rz = -o.dx * sin + o.dz * cos;
      u.formation = formation;
      const destX = clamp(cx + rx, -this.world.halfW + 3, this.world.halfW - 3);
      const destZ = clamp(cz + rz, -this.world.halfH + 3, this.world.halfH - 3);
      u.setOrder(type, destX, destZ, { destX, destZ });
    });
    this.emit('orderIssued', { owner: cmd.owner, order: type, x: cx, z: cz, count: list.length });
    return { ok: true, count: list.length };
  }

  cmdFormation(cmd) {
    const ids = new Set(cmd.ids || []);
    const list = this.units.filter((u) => ids.has(u.id) && u.owner === cmd.owner && u.alive);
    const anchor = list.length ? { x: list[0].x, z: list[0].z } : { x: 0, z: 0 };
    const offsets = formationOffsets(list.length, cmd.formation);
    list.forEach((u, i) => {
      u.formation = cmd.formation;
      const o = offsets[i];
      if (!o) return;
      u.setOrder('reinforce', anchor.x + o.dx, anchor.z + o.dz);
    });
    return { ok: true };
  }

  cmdRally(cmd) {
    const k = this.kingdoms[cmd.owner];
    const b = k.buildings.find((x) => x.id === cmd.buildingId);
    if (!b) return { ok: false, reason: 'No structure' };
    b.rally = this.world.nearestRoadPoint(cmd.x, cmd.z);
    return { ok: true };
  }

  /* ------------------------------------------------------------------ fog */

  fogSources(owner) {
    const out = [];
    for (const u of this.units) {
      if (u.owner !== owner || !u.alive || u.hidden) continue;
      out.push({ x: u.x, z: u.z, r: u.vision });
    }
    for (const b of this.buildings) {
      if (b.owner !== owner || b.dead) continue;
      out.push({ x: b.x, z: b.z, r: b.def.vision * (b.completed ? 1 : 0.6) });
    }
    return out;
  }

  refreshFog(owner) {
    this.kingdoms[owner].fog.update(this.fogSources(owner));
  }

  isVisibleTo(owner, x, z) { return this.kingdoms[owner].fog.isVisible(x, z); }

  /* ----------------------------------------------------------------- misc */

  log(owner, text, kind = '') {
    const entry = { t: this.time, text, kind };
    this.logs[owner].push(entry);
    if (this.logs[owner].length > 90) this.logs[owner].shift();
    this.emit('log', { owner, text, kind });
  }

  on(evt, fn) { this.listeners.push({ evt, fn }); }
  emit(evt, payload) {
    for (const l of this.listeners) if (l.evt === evt) l.fn(payload);
  }

  checkVictory() {
    if (this.over) return;
    for (const k of this.kingdoms) {
      if (k.king && k.king.dead) {
        const winner = 1 - k.id;
        this.over = true;
        this.winner = winner;
        this.endReason = `${k.name} has fallen — the king is dead.`;
        this.emit('gameover', { winner, reason: this.endReason });
        return;
      }
    }
  }

  /* -------------------------------------------------------------- save/load */

  /** Everything needed to resume this exact battle later. */
  serialize() {
    return {
      v: 1,
      seed: this.seed,
      mode: this.mode,
      difficulty: this.difficultyKey,
      time: this.time,
      over: this.over,
      winner: this.winner,
      kingdoms: this.kingdoms.map((k) => ({
        resources: { ...k.resources },
        upgrades: { ...k.upgrades },
        research: k.research ? { ...k.research } : null,
        defeated: k.defeated,
        stats: { ...k.stats },
      })),
      buildings: this.buildings.filter((b) => !b.dead).map((b) => ({
        owner: b.owner, type: b.type, x: b.x, z: b.z, rot: b.rot, level: b.level,
        hp: Math.round(b.hp), completed: b.completed, progress: b.progress,
        queue: b.queue.map((q) => ({ cls: q.cls, remaining: q.remaining, total: q.total })),
        upgrading: b.upgrading ? { ...b.upgrading } : null,
        rally: b.rally ? { ...b.rally } : null,
      })),
      units: this.units.filter((u) => !u.dead).map((u) => ({
        owner: u.owner, cls: u.cls, x: u.x, z: u.z, hp: Math.round(u.hp),
        isKing: u.isKing, hidden: u.hidden, formation: u.formation,
        order: { type: u.order.type, x: u.order.x, z: u.order.z },
      })),
      logs: this.logs.map((list) => list.slice(-30)),
    };
  }

  /** Rebuild a battle from a snapshot produced by serialize(). */
  static fromSave(data) {
    const game = new Game({ mode: 'solo', difficulty: data.difficulty, seed: data.seed });

    // clear the freshly generated skirmish so the save replaces it wholesale
    makeWay:
    for (const b of game.buildings) game.world.applyBuildingNav(b, false);
    game.buildings.length = 0;
    game.units.length = 0;
    game.projectiles.length = 0;
    game.effects.length = 0;
    game.world.initNav();
    game.world.buildOccupancy.clear();

    for (const s of data.buildings || []) {
      if (!BUILDINGS[s.type]) continue;
      const b = new Building(game, s.owner, s.type, s.x, s.z, s.rot || 0, {
        completed: !!s.completed, level: s.level || 1,
      });
      b.maxHp = Math.round(b.def.hp * BUILDING_UPGRADE.hpMult(b.level));
      b.hp = clamp(s.hp ?? b.maxHp, 1, b.maxHp);
      b.progress = s.completed ? 1 : clamp(s.progress ?? 0, 0, 1);
      b.queue = (s.queue || []).map((q) => ({ cls: q.cls, remaining: q.remaining, total: q.total }));
      b.upgrading = s.upgrading ? { ...s.upgrading } : null;
      b.rally = s.rally ? { ...s.rally } : null;
      game.buildings.push(b);
    }

    for (const s of data.units || []) {
      if (!TROOPS[s.cls]) continue;
      const u = new Unit(game, s.owner, s.cls, s.x, s.z, { isKing: !!s.isKing, hidden: !!s.hidden });
      u.hp = clamp(s.hp ?? u.maxHp, 1, u.maxHp);
      if (u.isKing) {
        u.maxHp = KING_HP; u.hp = clamp(s.hp ?? KING_HP, 1, KING_HP);
        u.atk = 34; u.def = 24; u.radius = 0.7;
        u.moveTo = () => {};
      }
      if (s.order) u.setOrder(s.order.type || 'hold', s.order.x ?? s.x, s.order.z ?? s.z);
      if (s.formation) u.formation = s.formation;
      game.units.push(u);
    }

    for (const owner of [0, 1]) {
      const k = game.kingdoms[owner];
      const saved = data.kingdoms?.[owner];
      if (saved) {
        k.resources = { ...k.resources, ...saved.resources };
        k.upgrades = { ...k.upgrades, ...saved.upgrades };
        k.research = saved.research ? { ...saved.research } : null;
        k.defeated = !!saved.defeated;
        k.stats = { ...k.stats, ...saved.stats };
      }
      k.castle = game.buildings.find((b) => b.owner === owner && b.type === 'castle' && !b.dead) || null;
      k.king = game.units.find((u) => u.owner === owner && u.isKing && !u.dead) || null;
    }

    game.time = data.time || 0;
    game.logs = Array.isArray(data.logs) && data.logs.length === 2 ? data.logs : [[], []];
    game.over = false;
    game.ai = null;
    game.ai = new AIController(game, game.kingdoms[1], game.difficulty);
    game.world.attachBuildings(game.buildings);
    game.kingdoms.forEach((k) => k.recalc());
    game.refreshFog(0);
    game.refreshFog(1);
    game.linkEntities();
    return game;
  }

  snapshotEconomy(owner) {
    const k = this.kingdoms[owner];
    return {
      gold: Math.floor(k.resources.gold), food: Math.floor(k.resources.food), mats: Math.floor(k.resources.mats),
      pop: Math.round(k.popUsed), popCap: Math.round(k.popCap),
      goldRate: k.income.gold - k.upkeep.gold, foodRate: k.income.food - k.upkeep.food,
      matRate: k.income.mats, army: k.armyCount, starving: k.starving,
    };
  }
}
