import { TILE, NAV_CELL, WORLD, RIVER, BRIDGE, BASE_X, BUILDINGS } from './config.js';
import { PathFinder } from './pathfinding.js';
import { fbm, hash2, clamp, lerp } from './rng.js';

/**
 * The battlefield: a 256x144m valley with a river through the middle and one
 * bridge. Both kingdoms get an identical mirror-image plateau to build on.
 */
export class World {
  constructor(seed = 1234) {
    this.seed = seed;
    this.w = WORLD.w;
    this.h = WORLD.h;
    this.halfW = this.w / 2;
    this.halfH = this.h / 2;
    this.pf = new PathFinder(Math.floor(this.w / NAV_CELL), Math.floor(this.h / NAV_CELL), NAV_CELL);
    this.decor = this.generateDecor();
    this.buildOccupancy = new Map(); // key tile -> building id
    this.initNav();
  }

  /* ---------------- terrain ---------------- */

  /** Riverbed depth, banks, plateau flattener and the bridge deck. */
  heightAt(x, z) {
    const ax = Math.abs(x);
    // rolling hills
    let h = (fbm(x * 0.012 + 11, z * 0.012 + 7, this.seed, 4) - 0.5) * 5.2;
    h += (fbm(x * 0.045, z * 0.045, this.seed + 3, 2) - 0.5) * 1.1;

    // flat plateaus for the two settlements
    const plateau = 1 - clamp((ax - 34) / 26, 0, 1); // 1 in settlement, 0 far
    const settle = clamp((ax - 26) / 30, 0, 1);
    if (settle > 0) h *= 1 - settle * 0.94;

    // river valley: cut a channel around x=0
    const bank = clamp(1 - (ax - RIVER.x1) / 12, 0, 1); // 1 inside river, fades to 0 at 20m
    if (bank > 0) {
      const channel = Math.pow(bank, 1.4);
      h = lerp(h, -3.6, channel);
    }
    // bridge deck
    if (ax <= RIVER.x1 + 2.2 && Math.abs(z) <= BRIDGE.z1) {
      const t = clamp((RIVER.x1 + 2.2 - ax) / 3, 0, 1);
      h = lerp(h, BRIDGE.deck, Math.min(1, t * 1.6));
    }
    // approach ramps onto the bridge
    if (ax > RIVER.x1 && ax < RIVER.x1 + 10 && Math.abs(z) <= BRIDGE.z1) {
      const t = 1 - (ax - RIVER.x1) / 10;
      h = Math.max(h, lerp(h, BRIDGE.deck, t * 0.9));
    }
    return h;
  }

  isWater(x, z) {
    const ax = Math.abs(x);
    if (ax < RIVER.x0) return true;
    if (ax <= RIVER.x1 + 1.2) return Math.abs(z) > BRIDGE.z1 - 1.5;
    if (ax < RIVER.x1 + 4) {
      // sloped bank — still water where the terrain dips below the waterline
      return this.heightAt(x, z) < -1.4 && Math.abs(z) > BRIDGE.z1 - 1.5;
    }
    return false;
  }

  isBridge(x, z) {
    return Math.abs(x) <= RIVER.x1 + 2.2 && Math.abs(z) <= BRIDGE.z1;
  }

  /** Ground height a unit should stand on (bridge deck included). */
  groundAt(x, z) {
    const h = this.heightAt(x, z);
    if (this.isBridge(x, z)) return Math.max(h, BRIDGE.deck);
    return h;
  }

  isNavigable(x, z) {
    if (x < -this.halfW + 2 || x > this.halfW - 2 || z < -this.halfH + 2 || z > this.halfH - 2) return false;
    return !this.isWater(x, z);
  }

  /* ---------------- nav grid ---------------- */

  initNav() {
    const { pf } = this;
    for (let cz = 0; cz < pf.h; cz++) {
      for (let cx = 0; cx < pf.w; cx++) {
        const { x, z } = pf.cellToWorld(cx, cz);
        pf.setBlocked(cx, cz, !this.isNavigable(x, z));
      }
    }
  }

  /** Block/unblock the nav cells under a building footprint. */
  applyBuildingNav(b, block) {
    const { pf } = this;
    if (!b.blocksNav) return;
    const cols = Math.max(1, Math.round(b.w));
    const rows = Math.max(1, Math.round(b.h));
    const x0 = b.x - (b.w * TILE) / 2, z0 = b.z - (b.h * TILE) / 2;
    for (let i = 0; i < cols * 2; i++) {
      for (let j = 0; j < rows * 2; j++) {
        const cx = Math.floor((x0 + i * (TILE / 2) + 0.5) / pf.cell);
        const cz = Math.floor((z0 + j * (TILE / 2) + 0.5) / pf.cell);
        pf.setBlocked(cx, cz, block);
      }
    }
  }

  /* ---------------- building placement ---------------- */

  zoneOf(x) { return x < 0 ? 0 : 1; }

  inBuildZone(owner, x, z) {
    const ax = Math.abs(x);
    if (ax < 26) return false;                     // keep the bridge approaches clear
    if (z < -66 || z > 66) return false;
    const side = owner === 0 ? x < 0 : x > 0;
    return side && ax <= 122;
  }

  /** Footprint of a building in world units, honouring wall rotation. */
  footprint(type, rot) {
    const def = BUILDINGS[type];
    let w = def.w, h = def.h;
    if (rot % 2 === 1) [w, h] = [h, w];
    return { w: w * TILE, h: h * TILE };
  }

  canPlace(owner, type, x, z, rot = 0) {
    const def = BUILDINGS[type];
    if (!def) return { ok: false, reason: 'Unknown structure' };
    if (!this.inBuildZone(owner, x, z)) return { ok: false, reason: 'Outside your construction zone' };

    const fp = this.footprint(type, rot);
    const x0 = x - fp.w / 2, x1 = x + fp.w / 2, z0 = z - fp.h / 2, z1 = z + fp.h / 2;
    // terrain check on the footprint corners + centre
    const samples = [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [x, z]];
    for (const [sx, sz] of samples) {
      if (!this.isNavigable(sx, sz)) return { ok: false, reason: 'Cannot build on water or the map edge' };
    }
    let hmin = Infinity, hmax = -Infinity;
    for (const [sx, sz] of samples) {
      const hh = this.heightAt(sx, sz);
      hmin = Math.min(hmin, hh); hmax = Math.max(hmax, hh);
    }
    if (hmax - hmin > 1.6) return { ok: false, reason: 'Ground is too steep here' };

    // overlap with existing structures
    for (const b of this._buildings || []) {
      if (b.dead) continue;
      const bfp = this.footprint(b.type, b.rot || 0);
      const gapX = Math.abs(b.x - x) < (fp.w + bfp.w) / 2 + 0.6;
      const gapZ = Math.abs(b.z - z) < (fp.h + bfp.h) / 2 + 0.6;
      if (gapX && gapZ) return { ok: false, reason: 'Another structure is in the way' };
    }
    return { ok: true };
  }

  attachBuildings(list) { this._buildings = list; }

  /* ---------------- decoration ---------------- */

  generateDecor() {
    const trees = [], rocks = [], grass = [];
    const rng = (n) => hash2(n * 7 + 3, n * 13 + 5, this.seed);
    let i = 0;
    while (trees.length < 300 && i < 6000) {
      i++;
      const x = (rng(i) - 0.5) * (this.w - 12);
      const z = (rng(i + 991) - 0.5) * (this.h - 10);
      if (Math.abs(x) < 22) continue;                     // keep the crossing clear
      if (this.isWater(x, z)) continue;
      const inSettle = Math.abs(x) > 30 && Math.abs(x) < 120 && Math.abs(z) < 60;
      if (inSettle && rng(i + 17) > 0.05) continue;
      trees.push({ x, z, s: 0.7 + rng(i + 33) * 0.9, r: rng(i + 51) * Math.PI * 2, v: rng(i + 71) });
    }
    i = 0;
    while (rocks.length < 150 && i < 4000) {
      i++;
      const x = (rng(i + 200) - 0.5) * (this.w - 16);
      const z = (rng(i + 700) - 0.5) * (this.h - 12);
      if (this.isWater(x, z)) continue;
      if (Math.abs(x) > 24 && Math.abs(x) < 118 && Math.abs(z) < 58) continue;
      rocks.push({ x, z, s: 0.6 + rng(i + 41) * 1.9, r: rng(i + 91) * 6.28 });
    }
    i = 0;
    while (grass.length < 700 && i < 4000) {
      i++;
      const x = (rng(i + 1300) - 0.5) * (this.w - 8);
      const z = (rng(i + 1700) - 0.5) * (this.h - 6);
      if (this.isWater(x, z)) continue;
      grass.push({ x, z, s: 0.5 + rng(i + 77) });
    }
    return { trees, rocks, grass };
  }

  /* ---------------- pathing helpers ---------------- */

  path(fromX, fromZ, toX, toZ) {
    return this.pf.findPath(fromX, fromZ, toX, toZ);
  }

  /** A random legal building spot in a kingdom's zone near its centre. */
  findSpot(owner, type, rot, rng, near = { x: 0, z: 0 }) {
    for (let attempt = 0; attempt < 90; attempt++) {
      const spreadX = 60 + attempt * 0.9, spreadZ = 46 + attempt * 0.7;
      const x = near.x + (rng.next() - 0.5) * spreadX;
      const z = near.z + (rng.next() - 0.5) * spreadZ;
      const res = this.canPlace(owner, type, x, z, rot);
      if (res.ok) return { x, z, rot };
    }
    return null;
  }
}

export const baseCenter = (owner) => ({ x: owner === 0 ? -BASE_X : BASE_X, z: 0 });
