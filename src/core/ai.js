import { BUILDINGS, TROOPS, DIFFICULTY, BASE_X, UPGRADE, TILE } from './config.js';
import { dist } from './rng.js';

/**
 * The rival kingdom's brain.
 *
 * It has no privileged information: every enemy position it reacts to comes
 * from its own fog of war (`k.fog.isVisible`), and it issues exactly the same
 * commands a human player does.
 */
export class AIController {
  constructor(game, kingdom, difficulty) {
    this.game = game;
    this.k = kingdom;
    this.d = difficulty || DIFFICULTY.normal;
    this.timer = 1.2;
    this.strategy = this.pickStrategy();
    this.phase = 'open';
    this.wave = 0;
    this.attackTimer = 26 / this.d.aggression;
    this.scouted = 0;
    this.committed = 0;
    this.lastThreat = 0;
    this.rally = { x: BASE_X - 30, z: 0 };
    this.thinkCount = 0;
    this.targetPoint = null;
  }

  pickStrategy() {
    const pool = ['economic', 'defensive', 'aggressive', 'balanced', 'adaptive'];
    const i = Math.floor(this.game.rng.next() * pool.length);
    return pool[i];
  }

  get home() { return { x: BASE_X, z: 0 }; }
  get enemyHome() { return { x: -BASE_X, z: 0 }; }

  /* ------------------------------------------------------------- main loop */

  update(dt) {
    this.timer -= dt;
    this.attackTimer -= dt;
    if (this.timer > 0) return;
    this.timer = this.d.think;
    this.thinkCount++;
    try {
      this.manageEconomy();
      this.manageArmy();
      this.manageDefense();
      this.manageResearch();
      this.manageAttacks();
    } catch (err) {
      console.warn('[AI]', err);
    }
  }

  buildingsOf(type, completed = true) {
    return this.k.buildings.filter((b) => b.type === type && (!completed || b.completed));
  }

  owned(type) { return this.buildingsOf(type).length; }

  afford(cost, buffer = 0) {
    return this.k.resources.gold >= (cost.gold || 0) + buffer
      && this.k.resources.food >= (cost.food || 0)
      && this.k.resources.mats >= (cost.mats || 0);
  }

  queueCount() {
    return this.k.buildings.reduce((s, b) => s + b.queue.length, 0);
  }

  /* --------------------------------------------------------------- economy */

  manageEconomy() {
    const k = this.k;
    const t = this.d;
    const housing = this.owned('house') + this.owned('townhall') * 2;
    const popRoom = k.popCap - k.popUsed;
    const netFood = k.income.food - k.upkeep.food;

    // 1. never let the settlement choke on population
    if (popRoom < 6 && housing < 16 && this.afford(BUILDINGS.house.cost, 30)) {
      return this.tryBuild('house');
    }
    // 2. economy balance
    if (netFood < 2.2 && this.owned('farm') < 9 && this.afford(BUILDINGS.farm.cost, 40)) return this.tryBuild('farm');
    if (k.resources.gold < 150 && this.owned('market') < 7 && this.afford(BUILDINGS.market.cost)) return this.tryBuild('market');
    if (k.resources.mats < 120 && this.owned('mine') < 7 && this.afford(BUILDINGS.mine.cost)) return this.tryBuild('mine');

    // 3. military infrastructure — order depends on strategy
    const wants = this.strategy === 'aggressive'
      ? ['barracks', 'archery', 'stable', 'blacksmith', 'barracks', 'guardpost', 'elitehall', 'watchtower']
      : this.strategy === 'defensive'
        ? ['barracks', 'blacksmith', 'guardpost', 'archery', 'watchtower', 'medical', 'stable']
        : ['barracks', 'blacksmith', 'archery', 'medical', 'stable', 'guardpost', 'elitehall'];

    for (const type of wants) {
      const def = BUILDINGS[type];
      const have = this.owned(type);
      const cap = type === 'barracks' ? 2 : type === 'blacksmith' ? 1 : type === 'elitehall' ? 1 : type === 'medical' ? 1 : 2;
      if (have < cap && this.afford(def.cost, 60)) {
        if (type === 'elitehall' && !this.k.hasBuilding('blacksmith')) continue;
        return this.tryBuild(type);
      }
    }

    // 4. spend surplus on more economy
    if (k.resources.gold > 420 && this.afford(BUILDINGS.farm.cost)) {
      if (this.owned('farm') < 8) return this.tryBuild('farm');
      if (this.owned('market') < 6) return this.tryBuild('market');
      if (this.owned('mine') < 6) return this.tryBuild('mine');
      if (this.owned('house') < 14) return this.tryBuild('house');
    }
  }

  tryBuild(type) {
    const def = BUILDINGS[type];
    const k = this.k;
    const rot = (type === 'wall' || type === 'gate') ? 1 : 0;
    // towers go toward the bridge; economy stays behind the town hall
    let near = { x: BASE_X, z: 0 };
    if (def.attack || type === 'watchtower' || type === 'guardpost') near = { x: BASE_X - 26, z: 0 };
    if (type === 'wall' || type === 'gate') near = { x: BASE_X - 40, z: 0 };

    for (let attempt = 0; attempt < 26; attempt++) {
      const spread = 26 + attempt * 2.4;
      const x = near.x - this.game.rng.next() * spread * 0.55;
      const z = near.z + (this.game.rng.next() - 0.5) * (34 + attempt * 2);
      const res = this.game.command({ type: 'build', owner: this.k.id, building: type, x, z, rot });
      if (res.ok) return true;
    }
    return false;
  }

  /* ----------------------------------------------------------------- combat */

  manageArmy() {
    const k = this.k;
    if (this.queueCount() >= 6) return;
    if (k.popCap - k.popUsed < 2) return;
    if (!this.k.hasBuilding('barracks')) return;

    // A hard AI keeps several recruit orders in flight at once; an easy one
    // dribbles its army out one unit at a time.
    const batches = this.d.name === 'HARD' ? 3 : this.d.name === 'EASY' ? 1 : 2;
    const weights = this.composition();
    for (let i = 0; i < batches; i++) {
      if (this.queueCount() >= 6) return;
      const pick = this.weightedPick(weights);
      const source = k.buildings.find((b) => b.completed && b.def.unlocks?.includes(pick));
      if (!source) return;
      const cost = TROOPS[pick].cost;
      const reserve = this.phase === 'attacking' ? 15 : 40;
      if (!this.afford(cost, reserve)) return;
      this.game.command({ type: 'recruit', owner: k.id, buildingId: source.id, cls: pick });
    }
  }

  composition() {
    const seen = this.seenEnemyComposition();
    const base = {
      aggressive: { infantry: 34, ranged: 22, cavalry: 24, elite: 12, medic: 8, garrison: 0 },
      defensive: { infantry: 28, ranged: 28, cavalry: 6, elite: 10, medic: 10, garrison: 18 },
      economic: { infantry: 30, ranged: 24, cavalry: 14, elite: 12, medic: 12, garrison: 8 },
      balanced: { infantry: 32, ranged: 24, cavalry: 18, elite: 12, medic: 10, garrison: 4 },
      adaptive: { infantry: 32, ranged: 24, cavalry: 16, elite: 14, medic: 10, garrison: 4 },
    }[this.strategy] || { infantry: 32, ranged: 24, cavalry: 18, elite: 12, medic: 10, garrison: 4 };

    const w = { ...base };
    if (this.strategy === 'adaptive' && seen.total > 4) {
      // counter the enemy's observed army
      if (seen.ranged > seen.infantry * 0.8) w.cavalry += 20;      // cavalry closes on archers
      if (seen.cavalry > seen.infantry * 0.6) w.garrison += 16;    // spears stop horses
      if (seen.elite > seen.infantry * 0.5) w.ranged += 14;
      if (seen.infantry > seen.ranged * 2) w.ranged += 12;
    }
    if (!this.k.hasBuilding('archery')) w.ranged = 0;
    if (!this.k.hasBuilding('stable')) w.cavalry = 0;
    if (!this.k.hasBuilding('elitehall')) w.elite = 0;
    if (!this.k.hasBuilding('medical')) w.medic = 0;
    if (!this.k.hasBuilding('guardpost')) w.garrison = 0;
    return w;
  }

  weightedPick(weights) {
    let total = 0;
    for (const k in weights) total += weights[k];
    if (total <= 0) return 'infantry';
    let r = this.game.rng.next() * total;
    for (const k in weights) { r -= weights[k]; if (r <= 0) return k; }
    return 'infantry';
  }

  seenEnemyComposition() {
    // only what the kingdom's own units can currently see
    const out = { infantry: 0, ranged: 0, cavalry: 0, elite: 0, medic: 0, garrison: 0, total: 0 };
    for (const u of this.game.units) {
      if (u.owner === this.k.id || !u.alive || u.hidden) continue;
      if (!this.k.fog.isVisible(u.x, u.z)) continue;
      out[u.cls] = (out[u.cls] || 0) + 1;
      out.total++;
    }
    return out;
  }

  /* --------------------------------------------------------------- defense */

  manageDefense() {
    const k = this.k;
    const threats = this.visibleEnemyUnits(true);
    if (!threats.length) return;
    this.lastThreat = this.game.time;
    const nearest = threats[0];
    const defenders = k.units.filter((u) => !u.isKing && u.alive
      && ['defense', 'guard', 'hold', 'reinforce'].includes(u.order.type) === false
      && u.order.type !== 'assault');
    // idle troops always respond to a raid near home
    const raiders = threats.filter((e) => Math.abs(e.x) > BASE_X - 55);
    if (!raiders.length) return;
    const point = {
      x: raiders.reduce((s, e) => s + e.x, 0) / raiders.length,
      z: raiders.reduce((s, e) => s + e.z, 0) / raiders.length,
    };
    if (dist(point.x, point.z, this.home.x, this.home.z) > 90) return;

    const responders = defenders.filter((u) => dist(u.x, u.z, point.x, point.z) < 80);
    if (!responders.length) return;
    this.game.command({
      type: 'order', owner: k.id, order: 'defense',
      ids: responders.slice(0, 26).map((u) => u.id),
      x: point.x, z: point.z, formation: 'line',
    });
  }

  visibleEnemyUnits() {
    const out = [];
    for (const u of this.game.units) {
      if (u.owner === this.k.id || !u.alive || u.hidden) continue;
      if (this.k.fog.isVisible(u.x, u.z)) out.push(u);
    }
    return out;
  }

  /* -------------------------------------------------------------- research */

  manageResearch() {
    if (!this.k.hasBuilding('blacksmith') || this.k.research) return;
    if (this.game.rng.next() > this.d.upgradeSkill) return;
    const order = this.strategy === 'aggressive'
      ? ['cavalry', 'infantry', 'elite', 'ranged', 'medic', 'garrison']
      : ['infantry', 'ranged', 'cavalry', 'elite', 'medic', 'garrison'];
    const affordable = order.find((cls) => {
      if (this.k.upgrades[cls] >= UPGRADE.maxLevel) return false;
      const cost = UPGRADE.costFor(this.k.upgrades[cls] + 1);
      return this.afford(cost, 60);
    });
    if (affordable) this.game.command({ type: 'research', owner: this.k.id, cls: affordable });
  }

  /* --------------------------------------------------------------- attacks */

  manageAttacks() {
    const k = this.k;
    const army = k.units.filter((u) => !u.isKing && u.alive && u.cls !== 'garrison');
    const attackers = army.filter((u) => u.order.type === 'assault');
    const massing = army.filter((u) => u.order.type !== 'assault' && u.order.type !== 'attack-retreat');

    // early scouting — a human player would do the same
    if (this.scouted < 2 && this.game.time > 22) {
      const scouts = army.filter((u) => u.order.type !== 'patrol').slice(0, 2);
      if (scouts.length) {
        this.scouted += 2;
        for (const s of scouts) {
          this.game.command({
            type: 'order', owner: k.id, order: 'patrol',
            ids: [s.id], x: -BASE_X + 10, z: (this.game.rng.next() - 0.5) * 30,
          });
        }
      }
    }

    // raid warning: pull attackers home if the castle is threatened
    const threats = this.visibleEnemyUnits().filter((e) => Math.abs(e.x) > BASE_X - 60);
    if (attackers.length && threats.length > attackers.length * 0.8) {
      const ids = attackers.map((u) => u.id);
      this.game.command({ type: 'order', owner: k.id, order: 'defense', ids, x: this.home.x - 20, z: 0 });
      this.phase = 'defending';
      return;
    }

    if (attackers.length) {
      // committed wave still alive? keep pushing.
      if (attackers.length >= Math.max(3, this.committed * 0.35)) {
        const target = this.pickAttackTarget(attackers);
        if (target) {
          const far = attackers.some((u) => dist(u.x, u.z, target.x, target.z) > 34);
          if (far && this.thinkCount % 2 === 0) {
            this.game.command({
              type: 'order', owner: k.id, order: 'assault',
              ids: attackers.map((u) => u.id), x: target.x, z: target.z, formation: this.attackFormation(),
            });
          }
        }
        return;
      }
      // mauled: fall back and rebuild the wave
      this.game.command({ type: 'order', owner: k.id, order: 'retreat', ids: attackers.map((u) => u.id) });
      this.phase = 'massing';
      this.attackTimer = 20 / this.d.aggression;
      return;
    }

    const unitTarget = this.d.armyTarget * (this.strategy === 'aggressive' ? 0.82 : 1);
    const enough = massing.length >= Math.min(unitTarget, k.popCap - 4);
    // an impatient commander eventually marches with whatever it has
    const impatient = this.game.time > 120 && massing.length >= 7;
    if (!enough && !impatient) return;
    if (this.attackTimer > 0) return;
    if (this.phase === 'open' && this.game.time < 40) return;

    const strike = massing.slice(0, Math.min(massing.length, this.d.waveSize + 6));
    if (strike.length < 5) return;
    const target = this.pickAttackTarget(strike);
    this.committed = strike.length;
    this.wave++;
    this.phase = 'attacking';
    this.attackTimer = 48 / this.d.aggression;
    this.game.command({
      type: 'order', owner: k.id, order: 'assault',
      ids: strike.map((u) => u.id), x: target.x, z: target.z, formation: this.attackFormation(),
    });
    this.game.log(k.id, `War host ${this.wave} marches on the enemy.`, 'good');
  }

  attackFormation() {
    const f = this.strategy === 'aggressive' ? 'wedge' : this.strategy === 'defensive' ? 'shield' : 'line';
    return f;
  }

  pickAttackTarget(units) {
    const k = this.k;
    const avg = {
      x: units.reduce((s, u) => s + u.x, 0) / units.length,
      z: units.reduce((s, u) => s + u.z, 0) / units.length,
    };
    // known enemy structures (from own exploration) are preferred
    let best = null, bestScore = Infinity;
    for (const b of this.game.buildings) {
      if (b.dead || b.owner === k.id) continue;
      if (!k.fog.isExplored(b.x, b.z)) continue;
      const d = dist(avg.x, avg.z, b.x, b.z);
      const priority = b.type === 'castle' ? 0.45 : b.def.attack ? 0.75 : b.type === 'barracks' ? 0.7 : 1;
      const score = d * priority;
      if (score < bestScore) { bestScore = score; best = b; }
    }
    const enemyCastle = this.game.kingdoms[1 - k.id].castle;
    if (!best && enemyCastle && !enemyCastle.dead) best = enemyCastle;
    if (!best) {
      // nothing scouted yet: march toward where a rival kingdom must be
      best = { x: this.enemyHome.x + 26, z: 0 };
    }
    return best;
  }
}
