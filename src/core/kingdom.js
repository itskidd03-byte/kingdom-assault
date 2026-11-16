import { BUILDINGS, BUILDING_UPGRADE, TROOPS, UPGRADE, START_RESOURCES, POP_HARD_CAP, FACTIONS } from './config.js';
import { Fog } from './fog.js';
import { clamp } from './rng.js';

/**
 * One kingdom: economy, population, army, research and fog.
 * Everything here is identical for the player and the AI.
 */
export class Kingdom {
  constructor(game, id) {
    this.game = game;
    this.id = id;
    this.faction = FACTIONS[id];
    this.name = this.faction.name;
    this.resources = { ...START_RESOURCES };
    this.upgrades = { infantry: 1, medic: 1, ranged: 1, cavalry: 1, elite: 1, garrison: 1 };
    this.research = null;
    this.fog = new Fog();
    this.king = null;
    this.castle = null;
    this.defeated = false;
    this.starving = false;
    this.isAI = false;
    this.difficulty = null;

    // derived per tick
    this.income = { gold: 0, food: 0, mats: 0 };
    this.upkeep = { gold: 0, food: 0 };
    this.popUsed = 0;
    this.popCap = 0;
    this.armyCount = 0;
    this.armyPower = 0;
    this.smithBonus = 0;
    this._recalcTimer = 0;
    this.stats = { built: 0, killed: 0, lost: 0, trained: 0 };
  }

  get units() { return this.game.units.filter((u) => u.owner === this.id && u.alive); }
  get buildings() { return this.game.buildings.filter((b) => b.owner === this.id && !b.dead); }

  canAfford(cost) {
    return this.resources.gold >= (cost.gold || 0)
      && this.resources.food >= (cost.food || 0)
      && this.resources.mats >= (cost.mats || 0);
  }

  pay(cost) {
    this.resources.gold -= cost.gold || 0;
    this.resources.food -= cost.food || 0;
    this.resources.mats -= cost.mats || 0;
  }

  refund(cost) {
    this.resources.gold += cost.gold || 0;
    this.resources.food += cost.food || 0;
    this.resources.mats += cost.mats || 0;
  }

  hasBuilding(type, completedOnly = true) {
    return this.game.buildings.some((b) => b.owner === this.id && b.type === type && !b.dead && (!completedOnly || b.completed));
  }

  countBuildings(type, completedOnly = true) {
    let n = 0;
    for (const b of this.game.buildings) {
      if (b.owner === this.id && b.type === type && !b.dead && (!completedOnly || b.completed)) n++;
    }
    return n;
  }

  /** Recompute economy aggregates from structures and army. */
  recalc() {
    let gold = 0, food = 0, mats = 0, pop = 0, smith = 0;
    for (const b of this.game.buildings) {
      if (b.owner !== this.id || b.dead) continue;
      const def = BUILDINGS[b.type];
      const mult = b.completed ? BUILDING_UPGRADE.outMult(b.level) : 0;
      if (b.completed) {
        gold += (def.gold || 0) * mult;
        food += (def.food || 0) * mult;
        mats += (def.mats || 0) * mult;
        pop += (def.pop || 0) * (1 + 0.25 * (b.level - 1));
        if (def.research) smith += 0.04 * b.level;
      }
    }
    this.income.gold = gold;
    this.income.food = food;
    this.income.mats = mats;
    this.popCap = Math.min(POP_HARD_CAP, Math.round(pop));
    this.smithBonus = smith;

    let used = 0, ug = 0, uf = 0, power = 0, count = 0;
    for (const u of this.game.units) {
      if (u.owner !== this.id || !u.alive) continue;
      used += u.pop;
      ug += u.stats.upkeep.gold;
      uf += u.stats.upkeep.food;
      power += (u.atk * u.maxHp * (1 + u.def / 40)) / 100;
      count++;
    }
    for (const b of this.game.buildings) {
      if (b.owner !== this.id || b.dead) continue;
      for (const q of b.queue) { used += TROOPS[q.cls].pop; }
    }
    this.popUsed = used;
    this.upkeep.gold = ug;
    this.upkeep.food = uf;
    this.armyCount = count;
    this.armyPower = Math.round(power);
  }

  update(dt) {
    this._recalcTimer -= dt;
    if (this._recalcTimer <= 0) { this.recalc(); this._recalcTimer = 0.35; }

    const netG = this.income.gold - this.upkeep.gold;
    const netF = this.income.food - this.upkeep.food;
    const netM = this.income.mats;
    this.resources.gold = Math.max(0, this.resources.gold + netG * dt);
    this.resources.mats = Math.max(0, this.resources.mats + netM * dt);
    this.resources.food += netF * dt;

    if (this.resources.food < 0) {
      this.resources.food = 0;
      this.starving = true;
    } else {
      this.starving = netF < 0;
    }

    // research progress
    if (this.research) {
      this.research.remaining -= dt;
      this.research.progress = 1 - this.research.remaining / this.research.total;
      if (this.research.remaining <= 0) {
        const cls = this.research.cls;
        this.upgrades[cls] = Math.min(UPGRADE.maxLevel, this.upgrades[cls] + 1);
        this.refreshUnits(cls);
        this.research = null;
        this.game.log(this.id, `${TROOPS[cls].name} upgraded to level ${this.upgrades[cls]}`, 'good');
      }
    }
  }

  /** Upgrades apply to existing troops as well as future recruits. */
  refreshUnits(cls) {
    for (const u of this.game.units) {
      if (u.owner !== this.id || u.cls !== cls || !u.alive) continue;
      const frac = u.hp / u.maxHp;
      u.applyStats();
      u.hp = Math.max(1, Math.round(frac * u.maxHp));
    }
  }

  canResearch(cls) {
    if (!this.hasBuilding('blacksmith')) return { ok: false, reason: 'Requires a completed Blacksmith' };
    if (this.upgrades[cls] >= UPGRADE.maxLevel) return { ok: false, reason: 'Already at maximum level' };
    if (this.research) return { ok: false, reason: 'Another research is in progress' };
    const cost = UPGRADE.costFor(this.upgrades[cls] + 1);
    if (!this.canAfford(cost)) return { ok: false, reason: 'Not enough resources' };
    return { ok: true, cost };
  }

  startResearch(cls) {
    const check = this.canResearch(cls);
    if (!check.ok) return check;
    this.pay(check.cost);
    const total = UPGRADE.time[this.upgrades[cls] + 1] * (this.isAI ? 1 / this.difficulty.buildSpeed : 1);
    this.research = { cls, remaining: total, total, progress: 0 };
    return { ok: true };
  }

  /* ------------------ AI-visible information ------------------
   * The AI may only inspect enemies inside its own current visibility.
   */
  seesUnit(u) { return this.fog.isVisible(u.x, u.z); }
  seesPoint(x, z) { return this.fog.isVisible(x, z); }
  knowsArea(x, z) { return this.fog.isExplored(x, z); }
}

export { clamp };
