/**
 * KINGDOM ASSAULT — core game data.
 * Both kingdoms resolve every rule from this file, so the AI and the player
 * are always playing exactly the same game.
 */

export const TILE = 4;           // world units per build/logic tile
export const NAV_CELL = 2;       // world units per pathfinding cell
export const WORLD = { w: 256, h: 144 };
export const RIVER = { x0: -8, x1: 8 };
export const BRIDGE = { z0: -12, z1: 12, deck: 1.1 };
export const BASE_X = 86;        // distance of each kingdom centre from the middle
export const TICK = 0.05;        // 20 Hz authoritative simulation tick
export const MAX_UNITS_PER_KINGDOM = 140;

/**
 * Pre-laid road network. Both kingdoms get exactly the same mirrored layout:
 * a highway from the castle, through the settlement, out past the walls and
 * over the bridge, plus a 20x20 apron outside the walls where towers belong.
 */
export const ROAD = {
  width: 6,
  tile: 2,
  // road width in metres at each point: 40 m (20 tiles) of mustering ground by the bridge
  widths: [12, 12, 12, 16, 40, 40, 40, 32, 20, 10, 8],
  // castle gate -> settlement -> snaking run to the bridge (mirrored for the enemy)
  points: [[100, 0], [86, 0], [70, 0], [58, 0], [48, 0], [40, 8], [30, -8], [20, 8], [12, 0], [8, 0], [0, 0]],
  yard: { x: 54, z: 0, w: 20, h: 20 },
  cost: 0.6,
};

/** Gold paid to the tower owner for every kill it lands. */
export const TOWER_BOUNTY = { base: 8, perLevel: 4 };
export const towerBounty = (level = 1) => TOWER_BOUNTY.base + TOWER_BOUNTY.perLevel * (level - 1);
export const POP_HARD_CAP = 160;

export const FACTIONS = [
  { id: 0, name: 'HOUSE VALDRIS', short: 'VALDRIS', color: 0x5b8fd0, accent: 0x2c4f78, ui: '#6fa0d8', race: 'elf' },
  { id: 1, name: 'THE ASHEN HORDE', short: 'ASHEN', color: 0xc0442f, accent: 0x77241a, ui: '#d4694d', race: 'orc' },
];

/** Troop classes available to both kingdoms. */
export const TROOPS = {
  infantry: {
    name: 'Assault Infantry', short: 'INFANTRY', key: '1', hot: 1,
    hp: 190, atk: 13, def: 9, speed: 4.2, range: 1.9, atkSpeed: 1.15,
    vision: 20, radius: 0.55, pop: 1, cost: { gold: 40, food: 22, mats: 0 }, time: 4.5,
    upkeep: { gold: 0.10, food: 0.16 },
    role: 'frontline', desc: 'Shield-and-axe line troops. Holds ground and absorbs charges.',
    from: 'barracks', formation: [0, 0], weapon: 'axe', shield: true, scale: 1.0,
  },
  medic: {
    name: 'Field Medic', short: 'MEDIC', key: '2', hot: 2,
    hp: 110, atk: 3, def: 5, speed: 4.3, range: 3.0, atkSpeed: 1.0,
    vision: 22, radius: 0.5, pop: 1, cost: { gold: 60, food: 26, mats: 8 }, time: 5,
    upkeep: { gold: 0.14, food: 0.14 }, heal: 13, healRange: 9,
    role: 'support', desc: 'Heals wounded allies in range, prioritising the most injured.',
    from: 'medical', formation: [1, 1], weapon: 'staff', scale: 0.95,
  },
  ranged: {
    name: 'Ranged Archer', short: 'ARCHER', key: '3', hot: 3,
    hp: 96, atk: 16, def: 3, speed: 3.9, range: 24, atkSpeed: 0.95,
    vision: 26, radius: 0.5, pop: 1, cost: { gold: 55, food: 20, mats: 12 }, time: 5,
    upkeep: { gold: 0.13, food: 0.14 }, projectile: 'arrow', projSpeed: 44,
    role: 'ranged', desc: 'Long-range volleys. Fragile — keep them behind the line.',
    from: 'archery', formation: [2, 2], weapon: 'bow', scale: 0.98,
  },
  cavalry: {
    name: 'Barbarian Cavalry', short: 'CAVALRY', key: '4', hot: 4,
    hp: 250, atk: 21, def: 8, speed: 7.6, range: 2.2, atkSpeed: 1.05,
    vision: 28, radius: 0.85, pop: 2, cost: { gold: 95, food: 48, mats: 18 }, time: 8,
    upkeep: { gold: 0.22, food: 0.34 }, chargeBonus: 2.1, chargeSpeed: 5.5,
    role: 'cavalry', desc: 'Fast riders. A full-gallop charge doubles damage; flank and pursue.',
    from: 'stable', formation: [3, 2], weapon: 'spear', mount: true, scale: 1.06,
  },
  elite: {
    name: 'Elite Guard', short: 'ELITE', key: '5', hot: 5,
    hp: 340, atk: 28, def: 18, speed: 4.0, range: 2.1, atkSpeed: 0.9,
    vision: 20, radius: 0.6, pop: 3, cost: { gold: 150, food: 44, mats: 55 }, time: 12,
    upkeep: { gold: 0.34, food: 0.3 },
    role: 'elite', desc: 'Heavily armoured shock troops. Expensive, slow, devastating.',
    from: 'elitehall', formation: [0, 1], weapon: 'mace', shield: true, scale: 1.16,
  },
  garrison: {
    name: 'Garrison Watch', short: 'GARRISON', key: '6', hot: 6,
    hp: 175, atk: 11, def: 15, speed: 3.7, range: 2.0, atkSpeed: 1.05,
    vision: 20, radius: 0.55, pop: 1, cost: { gold: 42, food: 16, mats: 12 }, time: 4,
    upkeep: { gold: 0.08, food: 0.12 },
    role: 'garrison', desc: 'Cheap defenders that garrison towers, gates and walls.',
    from: 'guardpost', formation: [0, 0], weapon: 'spear', shield: true, scale: 1.0,
  },
};
export const TROOP_KEYS = Object.keys(TROOPS);

/** Five upgrade levels per class — costs and requirements climb steeply. */
export const UPGRADE = {
  maxLevel: 5,
  costFor(level) {
    // level 2..5
    const n = level - 1;
    return { gold: Math.round(120 * Math.pow(1.85, n)), mats: Math.round(70 * Math.pow(1.9, n)), food: 0 };
  },
  time: [0, 18, 28, 40, 56, 76],
  mult(level) {
    const n = Math.max(0, level - 1);
    return {
      hp: 1 + 0.14 * n,
      atk: 1 + 0.17 * n,
      def: 1 + 0.16 * n,
      speed: 1 + 0.035 * n,
      atkSpeed: 1 + 0.06 * n,
      heal: 1 + 0.18 * n,
    };
  },
};

/** Buildings. `w`/`h` are in TILE units. */
export const BUILDINGS = {
  castle: {
    name: 'Castle', short: 'CASTLE', w: 4, h: 4, hp: 7000, buildTime: 0, model: 'castle',
    cost: {}, vision: 58, desc: 'Seat of the kingdom. Houses the king. If it falls, the king is exposed.',
    levelHp: 0.4, unique: true, armor: 6,
  },
  townhall: {
    name: 'Town Hall', short: 'TOWN HALL', w: 3, h: 3, hp: 1600, buildTime: 26, model: 'townhall',
    cost: { gold: 180, mats: 120 }, vision: 26, pop: 8, gold: 1.1,
    desc: 'Heart of the settlement: +8 population, +1.1 gold/s.',
  },
  house: {
    name: 'House', short: 'HOUSE', w: 1, h: 1, hp: 620, buildTime: 9, model: 'houseA',
    cost: { gold: 60, mats: 40 }, vision: 12, pop: 8,
    desc: '+8 population capacity. Build many to feed the war machine.',
  },
  farm: {
    name: 'Farm', short: 'FARM', w: 2, h: 2, hp: 700, buildTime: 12, model: 'farm',
    cost: { gold: 70, mats: 55 }, vision: 14, food: 1.9,
    desc: '+1.9 food/s. Armies eat; starvation kills morale and troops.',
  },
  market: {
    name: 'Market', short: 'MARKET', w: 2, h: 2, hp: 820, buildTime: 15, model: 'market',
    cost: { gold: 120, mats: 90 }, vision: 16, gold: 1.6,
    desc: '+1.6 gold/s. Pays wages and upgrades.',
  },
  mine: {
    name: 'Stone Quarry', short: 'QUARRY', w: 2, h: 2, hp: 900, buildTime: 16, model: 'mine',
    cost: { gold: 110, mats: 60 }, vision: 16, mats: 1.5,
    desc: '+1.5 materials/s. Everything martial is built from stone.',
  },
  barracks: {
    name: 'Barracks', short: 'BARRACKS', w: 3, h: 3, hp: 1250, buildTime: 22, model: 'barracks',
    cost: { gold: 160, mats: 130 }, vision: 22, unlocks: ['infantry'],
    desc: 'Recruits Assault Infantry. +1 recruit batch speed per level.',
  },
  medical: {
    name: 'Medical Tent', short: 'MEDICAL', w: 2, h: 2, hp: 700, buildTime: 17, model: 'medical',
    cost: { gold: 140, mats: 80 }, vision: 18, unlocks: ['medic'], healAura: 3.5,
    desc: 'Recruits Medics and slowly heals nearby friendly troops.',
  },
  archery: {
    name: 'Archery Range', short: 'ARCHERY', w: 2, h: 2, hp: 950, buildTime: 19, model: 'archery',
    cost: { gold: 150, mats: 110 }, vision: 24, unlocks: ['ranged'],
    desc: 'Recruits Ranged Archers.',
  },
  stable: {
    name: 'Cavalry Stable', short: 'STABLE', w: 2, h: 2, hp: 1050, buildTime: 24, model: 'stable',
    cost: { gold: 190, mats: 140 }, vision: 24, unlocks: ['cavalry'],
    desc: 'Recruits Barbarian Cavalry.',
  },
  elitehall: {
    name: 'Elite Training Hall', short: 'ELITE HALL', w: 2, h: 2, hp: 1400, buildTime: 30, model: 'elitehall',
    cost: { gold: 260, mats: 200 }, vision: 22, unlocks: ['elite'],
    desc: 'Recruits Elite Guards. Requires a Blacksmith.',
  },
  blacksmith: {
    name: 'Blacksmith', short: 'SMITHY', w: 1, h: 1, hp: 760, buildTime: 14, model: 'blacksmith',
    cost: { gold: 130, mats: 95 }, vision: 14, research: true,
    desc: 'Unlocks troop upgrades and adds +4% army damage per level.',
  },
  guardpost: {
    name: 'Guard Post', short: 'GUARD POST', w: 1, h: 1, hp: 700, buildTime: 12, model: 'guardpost',
    cost: { gold: 80, mats: 70 }, vision: 26, unlocks: ['garrison'], attack: { dmg: 8, range: 16, rate: 0.8, proj: 'arrow' },
    desc: 'Recruits Garrison Watch and shoots at nearby raiders.',
  },
  tower_archer: {
    name: 'Archer Tower', short: 'ARCHER TOWER', w: 1, h: 1, hp: 1100, buildTime: 16, model: 'towerA', tower: true,
    cost: { gold: 110, mats: 100 }, vision: 38, attack: { dmg: 15, range: 30, rate: 1.05, proj: 'arrow' },
    desc: 'Fast, long-ranged tower. Excellent against infantry and archers.',
  },
  tower_ballista: {
    name: 'Ballista Tower', short: 'BALLISTA', w: 1, h: 1, hp: 950, buildTime: 18, model: 'towerB', tower: true,
    cost: { gold: 140, mats: 120 }, vision: 40, attack: { dmg: 42, range: 34, rate: 0.42, proj: 'bolt' },
    desc: 'Slow heavy bolts. Shreds cavalry, elites and siege columns.',
  },
  tower_heavy: {
    name: 'Heavy Tower', short: 'HEAVY TOWER', w: 1, h: 1, hp: 2400, buildTime: 28, model: 'towerHeavy', tower: true,
    cost: { gold: 240, mats: 230 }, vision: 42, attack: { dmg: 24, range: 28, rate: 0.9, proj: 'bolt' }, armor: 10,
    desc: 'Fortified tower with high health and armour. The backbone of a wall line.',
  },
  wall: {
    name: 'Wall', short: 'WALL', w: 2, h: 1, hp: 1500, buildTime: 10, model: 'wall',
    cost: { gold: 45, mats: 70 }, vision: 10, blocks: true, armor: 8,
    desc: 'Blocks ground movement. Cannot be walked through until destroyed.',
  },
  gate: {
    name: 'Gatehouse', short: 'GATE', w: 2, h: 1, hp: 1300, buildTime: 14, model: 'gate',
    cost: { gold: 90, mats: 90 }, vision: 14, attack: { dmg: 12, range: 18, rate: 0.9, proj: 'arrow' },
    desc: 'Passable to your own troops, hostile to the enemy. Fires on raiders.',
  },
  watchtower: {
    name: 'Watchtower', short: 'WATCHTOWER', w: 1, h: 1, hp: 600, buildTime: 10, model: 'watchtower', tower: true,
    cost: { gold: 70, mats: 55 }, vision: 52,
    desc: 'Huge vision radius. Reveals enemy armies long before they arrive.',
  },
};

export const BUILD_ORDER = [
  'townhall', 'house', 'farm', 'market', 'mine', 'barracks', 'blacksmith',
  'archery', 'medical', 'stable', 'guardpost', 'elitehall',
  'watchtower', 'tower_archer', 'tower_ballista', 'tower_heavy', 'wall', 'gate',
];

export const BUILDING_MAX_LEVEL = 3;
export const BUILDING_UPGRADE = {
  cost(type, level) {
    const b = BUILDINGS[type];
    const m = 0.75 * Math.pow(1.6, level - 1);
    return {
      gold: Math.round((b.cost.gold || 60) * m),
      mats: Math.round((b.cost.mats || 50) * m),
    };
  },
  time: (type, level) => Math.round((BUILDINGS[type].buildTime || 12) * 0.7 * Math.pow(1.35, level - 1)),
  hpMult: (level) => 1 + 0.35 * (level - 1),
  outMult: (level) => 1 + 0.45 * (level - 1),
};

/** Order types the player (or the AI) can issue. */
export const ORDERS = {
  assault: { name: 'Assault', key: 'A', desc: 'Advance and attack everything encountered.' },
  defense: { name: 'Defend', key: 'D', desc: 'Hold the area, engage anything that comes near.' },
  guard: { name: 'Guard', key: 'G', desc: 'Guard a building or unit; punish attackers.' },
  patrol: { name: 'Patrol', key: 'P', desc: 'Tirelessly walk a route between two points.' },
  escort: { name: 'Escort', key: 'E', desc: 'Follow a friendly unit or army.' },
  reinforce: { name: 'Reinforce', key: 'R', desc: 'Move to a position and hold it.' },
  retreat: { name: 'Retreat', key: 'X', desc: 'Fall back toward your castle.' },
  hold: { name: 'Hold Position', key: 'H', desc: 'Never move; only strike what comes into range.' },
};

export const FORMATIONS = {
  line: { name: 'Line', desc: 'Wide battle line' },
  wedge: { name: 'Wedge', desc: 'Armoured spearhead' },
  shield: { name: 'Shield Wall', desc: 'Tight defensive block' },
  circle: { name: 'Circle', desc: 'All-round defence' },
  spread: { name: 'Spread', desc: 'Loose skirmish order' },
};

export const DIFFICULTY = {
  easy: {
    name: 'EASY', think: 3.4, buildSpeed: 0.78, ecoSkill: 0.72, aggression: 0.62,
    armyTarget: 9, waveSize: 7, upgradeSkill: 0.25, reaction: 2.4, bonus: 0.85,
    desc: 'A cautious rival kingdom. Slow to expand, forgiving in battle.',
  },
  normal: {
    name: 'NORMAL', think: 2.1, buildSpeed: 0.95, ecoSkill: 0.9, aggression: 0.88,
    armyTarget: 15, waveSize: 12, upgradeSkill: 0.6, reaction: 1.4, bonus: 1.0,
    desc: 'A balanced rival kingdom. It builds, recruits and attacks on its own.',
  },
  hard: {
    name: 'HARD', think: 1.35, buildSpeed: 1.12, ecoSkill: 1.06, aggression: 1.12,
    armyTarget: 20, waveSize: 18, upgradeSkill: 0.92, reaction: 0.75, bonus: 1.14,
    desc: 'A ruthless rival kingdom. Efficient economy, upgraded troops, coordinated waves.',
  },
};

/** Unit stat resolution with upgrades applied identically for every kingdom. */
export function unitStats(owner, cls) {
  const base = TROOPS[cls];
  const level = owner.upgrades[cls] || 1;
  const m = UPGRADE.mult(level);
  const smith = owner.smithBonus || 0;
  return {
    ...base,
    level,
    maxHp: Math.round(base.hp * m.hp),
    atk: base.atk * m.atk * (1 + smith),
    def: base.def * m.def,
    speed: base.speed * m.speed,
    atkSpeed: base.atkSpeed * m.atkSpeed,
    heal: (base.heal || 0) * m.heal,
  };
}

export const START_RESOURCES = { gold: 560, food: 420, mats: 420 };
