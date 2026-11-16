/** Uniform spatial hash for cheap neighbour queries. */
export class SpatialHash {
  constructor(cell = 10) {
    this.cell = cell;
    this.buckets = new Map();
  }
  clear() { this.buckets.clear(); }
  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  insert(obj) {
    const cx = Math.floor(obj.x / this.cell), cz = Math.floor(obj.z / this.cell);
    const k = this.key(cx, cz);
    let arr = this.buckets.get(k);
    if (!arr) { arr = []; this.buckets.set(k, arr); }
    arr.push(obj);
  }
  query(x, z, r, out = []) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.buckets.get(this.key(cx, cz));
        if (arr) for (let i = 0; i < arr.length; i++) out.push(arr[i]);
      }
    }
    return out;
  }
}
