import { BUILDINGS, BUILDING_MAX_LEVEL, BUILDING_UPGRADE, TILE, TROOPS, unitStats } from './config.js';
import { dist } from './rng.js';

// Building ids live in a separate range so they can never collide with unit ids
// (both are looked up in the same entity map by the UI and combat code).
const BID_START = 1_000_000;
let BID = BID_START;
export const nextBuildingId = () => BID++;
export const resetBuildingIds = () => { BID = BID_START; };

export class Building {
  constructor(game, owner, type, x, z, rot = 0, opts = {}) {
    this.id = nextBuildingId();
    this.owner = owner;
    this.type = type;
    this.def = BUILDINGS[type];
    this.x = x; this.z = z;
    this.rot = rot;
    this.level = opts.level || 1;
    this.w = this.def.w; this.h = this.def.h;
    if (rot % 2 === 1) { this.w = this.def.h; this.h = this.def.w; }
    this.maxHp = Math.round(this.def.hp * BUILDING_UPGRADE.hpMult(this.level));
    this.hp = opts.completed ? this.maxHp : Math.round(this.maxHp * 0.06);
    this.completed = !!opts.completed;
    this.buildTime = (this.def.buildTime || 10) * (opts.speed ? 1 / opts.speed : 1);
    this.progress = this.completed ? 1 : 0;
    this.dead = false;
    this.queue = [];
    this.cooldown = 0;
    this.targetId = null;
    this.blocksNav = type !== 'gate';
    this.upgrading = null;
    this.repairing = false;
    this.garrison = new Set();
    this.fireFx = 0;
    this.buildFx = 0;
    this.rally = null;
    this.y = game.world.heightAt(x, z);
    this.shake = 0;
    this.lastDamage = 0;
    game.world.applyBuildingNav(this, true);
  }

  get isTower() { return !!this.def.attack; }
  get attackRange() { return (this.def.attack?.range || 0) * (1 + 0.06 * (this.level - 1)); }
  get attackDamage() { return (this.def.attack?.dmg || 0) * BUILDING_UPGRADE.outMult(this.level); }
  get attackInterval() { return 1 / (this.def.attack?.rate || 1); }

  update(game, dt) {
    if (this.dead) return;
    this.lastDamage = Math.max(0, this.lastDamage - dt);
    this.shake = Math.max(0, this.shake - dt);

    if (!this.completed) {
      this.progress += dt / Math.max(0.001, this.buildTime);
      this.hp = Math.max(this.hp, Math.round(this.maxHp * (0.06 + 0.94 * Math.min(1, this.progress))));
      this.buildFx += dt;
      if (this.progress >= 1) {
        this.progress = 1;
        this.completed = true;
        this.hp = this.maxHp;
        game.log(this.owner, `${this.def.name} completed`, 'good');
        game.onBuildingCompleted(this);
      }
      return;
    }

    if (this.upgrading) {
      this.upgrading.remaining -= dt;
      if (this.upgrading.remaining <= 0) {
        this.level = Math.min(BUILDING_MAX_LEVEL, this.level + 1);
        const frac = this.hp / this.maxHp;
        this.maxHp = Math.round(this.def.hp * BUILDING_UPGRADE.hpMult(this.level));
        this.hp = Math.round(this.maxHp * Math.max(frac, 0.8));
        this.upgrading = null;
        game.log(this.owner, `${this.def.name} upgraded to level ${this.level}`, 'good');
      }
    }

    if (this.repairing) {
      if (this.hp >= this.maxHp) this.repairing = false;
    }

    // recruitment queue
    if (this.queue.length) {
      const q = this.queue[0];
      q.remaining -= dt;
      if (q.remaining <= 0) {
        const spawned = game.spawnUnit(this.owner, q.cls, this);
        this.queue.shift();
        if (spawned) game.log(this.owner, `${TROOPS[q.cls].short} ready`, 'good');
      }
    }

    // defensive towers
    if (this.isTower) {
      if (this.cooldown > 0) this.cooldown -= dt;
      if (this.cooldown <= 0) {
        const target = game.acquireTowerTarget(this);
        if (target) {
          this.cooldown = this.attackInterval;
          game.fireTowerShot(this, target);
        }
      }
    }
  }

  canQueue(cls) {
    if (!this.queue.length && !this.def.unlocks?.includes(cls)) return false;
    if (!this.def.unlocks?.includes(cls)) return false;
    return this.queue.length < 10;
  }

  startBuild(game) {
    this.progress = 0;
  }

  damage(game, amount, source) {
    if (this.dead) return;
    const armor = (this.def.armor || 0) + (this.type === 'castle' ? 4 : 0);
    const mit = 1 - armor / (armor + 60);
    const dealt = Math.max(amount * 0.12, amount * mit);
    this.hp -= dealt;
    this.lastDamage = 0.4;
    this.shake = 0.18;
    if (this.hp <= 0) {
      this.hp = 0;
      this.destroy(game, source);
    }
  }

  destroy(game, source) {
    if (this.dead) return;
    this.dead = true;
    game.world.applyBuildingNav(this, false);
    game.onBuildingDestroyed(this, source);
  }

  upgradeCost() {
    return BUILDING_UPGRADE.cost(this.type, this.level + 1);
  }
}
