import { WORLD, NAV_CELL } from './config.js';

/**
 * Per-kingdom fog of war.
 *  - `explored` remembers terrain you have seen (dimmed when unobserved).
 *  - `visible` is what a friendly unit or structure can see right now.
 * The AI only ever reads the same two arrays, so it cannot cheat.
 */
export class Fog {
  constructor() {
    this.cell = NAV_CELL;
    this.w = Math.ceil(WORLD.w / this.cell);
    this.h = Math.ceil(WORLD.h / this.cell);
    this.explored = new Uint8Array(this.w * this.h);
    this.visible = new Uint8Array(this.w * this.h);
    this.data = new Uint8Array(this.w * this.h * 4);
    this.dirty = true;
    this.version = 0;
    this._sources = [];
  }

  cellCoords(x, z) {
    return {
      cx: Math.floor((x + WORLD.w / 2) / this.cell),
      cz: Math.floor((z + WORLD.h / 2) / this.cell),
    };
  }

  inBounds(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.w && cz < this.h; }

  isVisible(x, z) {
    const { cx, cz } = this.cellCoords(x, z);
    if (!this.inBounds(cx, cz)) return false;
    return this.visible[cz * this.w + cx] === 1;
  }

  isExplored(x, z) {
    const { cx, cz } = this.cellCoords(x, z);
    if (!this.inBounds(cx, cz)) return false;
    return this.explored[cz * this.w + cx] === 1;
  }

  /** Recompute current visibility from a list of {x,z,r} sources. */
  update(sources) {
    this.visible.fill(0);
    const { w, h, cell } = this;
    for (const s of sources) {
      const r = s.r;
      const { cx, cz } = this.cellCoords(s.x, s.z);
      const rad = Math.ceil(r / cell);
      const r2 = (r / cell) * (r / cell);
      for (let dz = -rad; dz <= rad; dz++) {
        const zz = cz + dz;
        if (zz < 0 || zz >= h) continue;
        for (let dx = -rad; dx <= rad; dx++) {
          const xx = cx + dx;
          if (xx < 0 || xx >= w) continue;
          if (dx * dx + dz * dz > r2) continue;
          const i = zz * w + xx;
          this.visible[i] = 1;
          this.explored[i] = 1;
        }
      }
    }
    this.dirty = true;
    this.version++;
    this.rebuildTexture();
  }

  /** Repack the fog into RGBA for the terrain shader. */
  rebuildTexture() {
    const d = this.data;
    for (let i = 0, n = this.w * this.h; i < n; i++) {
      const vis = this.visible[i], exp = this.explored[i];
      // alpha carried in R: 0 = clear, 255 = black
      const a = vis ? 0 : exp ? 138 : 232;
      d[i * 4] = a;
      d[i * 4 + 1] = exp && !vis ? 1 : 0;
      d[i * 4 + 2] = 0;
      d[i * 4 + 3] = 255;
    }
  }

  /** Reveal a radius instantly (used for the starting settlement reveal). */
  reveal(x, z, r) { this.update([{ x, z, r }]); }
}
