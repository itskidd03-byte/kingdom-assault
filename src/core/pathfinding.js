import { MinHeap } from './rng.js';

/**
 * Grid A* with diagonal movement and corner cutting prevention.
 * The grid is a flat Uint8Array of costs: 0 = blocked, >0 = movement cost.
 */
export class PathFinder {
  constructor(w, h, cell, originX, originZ) {
    this.w = w; this.h = h; this.cell = cell;
    // cell (0,0) covers [-w/2, -w/2 + cell) unless an origin is given
    this.originX = originX === undefined ? -(w * cell) / 2 : originX;
    this.originZ = originZ === undefined ? -(h * cell) / 2 : originZ;
    this.blocked = new Uint8Array(w * h);
    this.cost = new Float32Array(w * h).fill(1);
    this.g = new Float32Array(w * h);
    this.f = new Float32Array(w * h);
    this.from = new Int32Array(w * h);
    this.stamp = new Int32Array(w * h);
    this.closed = new Uint8Array(w * h);
    this.gen = 0;
    this.maxExpansions = 4200;
  }

  idx(cx, cz) { return cz * this.w + cx; }
  inBounds(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.w && cz < this.h; }
  isBlockedCell(cx, cz) { return !this.inBounds(cx, cz) || this.blocked[cz * this.w + cx] === 1; }

  setBlocked(cx, cz, v) {
    if (!this.inBounds(cx, cz)) return;
    this.blocked[cz * this.w + cx] = v ? 1 : 0;
  }

  /** Movement multiplier: < 1 makes a cell cheaper, so units prefer roads. */
  setCost(cx, cz, v) {
    if (!this.inBounds(cx, cz)) return;
    this.cost[cz * this.w + cx] = v;
  }

  costAt(cx, cz) {
    if (!this.inBounds(cx, cz)) return 1;
    return this.cost[cz * this.w + cx];
  }

  worldToCell(x, z) {
    return {
      cx: Math.floor((x - this.originX) / this.cell),
      cz: Math.floor((z - this.originZ) / this.cell),
    };
  }
  cellToWorld(cx, cz) {
    return { x: this.originX + (cx + 0.5) * this.cell, z: this.originZ + (cz + 0.5) * this.cell };
  }
  cellCenterX(cx) { return this.originX + (cx + 0.5) * this.cell; }
  cellCenterZ(cz) { return this.originZ + (cz + 0.5) * this.cell; }

  /** Nearest walkable cell (BFS ring) — used when a target lands inside a structure. */
  nearestOpen(cx, cz, maxR = 14) {
    if (!this.isBlockedCell(cx, cz)) return { cx, cz };
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!this.isBlockedCell(nx, nz)) return { cx: nx, cz: nz };
        }
      }
    }
    return null;
  }

  /** A* from world position to world position. Returns array of {x,z} waypoints. */
  findPath(sx, sz, tx, tz, maxNodes) {
    const sc = this.worldToCell(sx, sz), tc = this.worldToCell(tx, tz);
    const s = this.nearestOpen(sc.cx, sc.cz);
    const t = this.nearestOpen(tc.cx, tc.cz);
    if (!s || !t) return null;
    if (s.cx === t.cx && s.cz === t.cz) return [{ x: tx, z: tz }];

    const { w } = this;
    this.gen++;
    const gen = this.gen;
    const start = this.idx(s.cx, s.cz), goal = this.idx(t.cx, t.cz);
    const heap = new MinHeap();
    this.g[start] = 0;
    this.from[start] = -1;
    this.stamp[start] = gen;
    this.closed[start] = 0;
    this.f[start] = this.heuristic(s.cx, s.cz, t.cx, t.cz);
    heap.push({ i: start, f: this.f[start] });

    const budget = maxNodes || this.maxExpansions;
    let expanded = 0;
    const DIRS = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142],
    ];

    while (heap.size) {
      const cur = heap.pop();
      const ci = cur.i;
      if (this.closed[ci] === 1 && this.stamp[ci] === gen) continue;
      this.closed[ci] = 1;
      if (ci === goal) return this.rebuild(ci, tx, tz);
      if (++expanded > budget) break;
      const cx = ci % w, cz = (ci / w) | 0;
      for (const [dx, dz, cost] of DIRS) {
        const nx = cx + dx, nz = cz + dz;
        if (this.isBlockedCell(nx, nz)) continue;
        if (dx && dz) {
          // no cutting corners between two walls
          if (this.isBlockedCell(cx + dx, cz) || this.isBlockedCell(cx, cz + dz)) continue;
        }
        const ni = this.idx(nx, nz);
        const ng = this.g[ci] + cost * this.cost[ni];
        if (this.stamp[ni] !== gen) {
          this.stamp[ni] = gen; this.g[ni] = Infinity; this.closed[ni] = 0;
        }
        if (ng < this.g[ni]) {
          this.g[ni] = ng;
          this.f[ni] = ng + this.heuristic(nx, nz, t.cx, t.cz);
          this.from[ni] = ci;
          heap.push({ i: ni, f: this.f[ni] });
        }
      }
    }
    // unreachable: walk straight at the target as far as possible
    return [{ x: tx, z: tz }];
  }

  heuristic(ax, az, bx, bz) {
    const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
    return (dx + dz) + (1.4142 - 2) * Math.min(dx, dz);
  }

  rebuild(goalIdx, tx, tz) {
    const { w } = this;
    const out = [];
    let cur = goalIdx;
    while (cur !== -1) {
      const cx = cur % w, cz = (cur / w) | 0;
      out.push({ x: this.cellCenterX(cx), z: this.cellCenterZ(cz) });
      cur = this.from[cur];
    }
    out.reverse();
    out.shift(); // drop the cell we're standing on
    if (out.length) { out[out.length - 1] = { x: tx, z: tz }; }
    return out;
  }

  /** Coarse line-of-sight test used by towers and the AI. */
  lineBlocked(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const steps = Math.ceil(Math.hypot(dx, dz) / this.cell);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const cc = this.worldToCell(x0 + dx * t, z0 + dz * t);
      if (this.isBlockedCell(cc.cx, cc.cz)) return true;
    }
    return false;
  }
}
