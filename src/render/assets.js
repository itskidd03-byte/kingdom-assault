import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const BASE = import.meta.env.BASE_URL || './';
const url = (p) => `${BASE}assets/models/${p}`;

/** Which mesh file + scale each structure uses. All models come from the uploaded art. */
export const BUILDING_MODEL = {
  castle: { file: 'buildings/castle', scale: 6.2, yaw: 0, shadow: true },
  townhall: { file: 'buildings/townhall', scale: 4.4, shadow: true },
  house: { file: 'buildings/house_a', scale: 4.2, shadow: true },
  farm: { file: 'buildings/windmill', scale: 4.8, shadow: true },
  market: { file: 'buildings/market', scale: 4.3, shadow: true },
  mine: { file: 'buildings/mine', scale: 4.3, shadow: true },
  barracks: { file: 'buildings/barracks', scale: 4.4, shadow: true },
  blacksmith: { file: 'buildings/blacksmith', scale: 3.4, shadow: true },
  archery: { file: 'buildings/archery', scale: 4.4, shadow: true },
  stable: { file: 'buildings/stable', scale: 4.3, shadow: true },
  elitehall: { file: 'buildings/church', scale: 4.9, shadow: true },
  medical: { file: 'props/tent', scale: 5.2, shadow: true },
  guardpost: { file: 'buildings/tower_base', scale: 3.6, shadow: true },
  tower_archer: { file: 'buildings/tower_a', scale: 3.8, shadow: true },
  tower_ballista: { file: 'buildings/tower_b', scale: 3.8, shadow: true },
  tower_heavy: { file: 'buildings/tower_base', scale: 5.4, shadow: true },
  watchtower: { file: 'buildings/tower_a', scale: 3.0, shadow: true },
  wall: { file: 'buildings/wall', scale: 1.85, shadow: true },
  gate: { file: 'buildings/gate', scale: 1.85, shadow: true },
  ruins: { file: 'buildings/ruins', scale: 4.2, shadow: true },
};

const UNIT_PROP = {
  infantry: { file: 'props/axe', bone: 'hand_r', scale: 0.32, offset: [0, -0.05, 0.12], rot: [0, 0, Math.PI / 2] },
  ranged: { file: 'props/bow', bone: 'hand_l', scale: 0.11, offset: [0, 0, 0], rot: [0, Math.PI / 2, Math.PI / 2] },
  elite: { file: 'props/mace', bone: 'hand_r', scale: 0.55, offset: [0, 0, 0], rot: [0, 0, 0] },
  garrison: { file: 'props/axe', bone: 'hand_r', scale: 0.28, offset: [0, -0.05, 0.12], rot: [0, 0, Math.PI / 2] },
  medic: { file: 'props/dagger', bone: 'hand_r', scale: 0.25, offset: [0, 0, 0], rot: [0, 0, 0] },
};

export class Assets {
  constructor() {
    this.loader = new GLTFLoader();
    this.models = new Map();
    this.clips = {};
    this.nature = {};
    this.ready = false;
  }

  async load(onStep = () => {}) {
    const jobs = [];
    const deltas = [];

    for (const [type, def] of Object.entries(BUILDING_MODEL)) {
      jobs.push(this.loader.loadAsync(url(`${def.file}.glb`)).then((g) => {
        // KayKit structures ship as dozens of small meshes; bake them down to
        // one mesh per material so a settlement stays cheap to draw.
        this.models.set(def.file, this.mergeByMaterial(g.scene));
      }));
    }
    for (const [cls, p] of Object.entries(UNIT_PROP)) {
      jobs.push(this.loader.loadAsync(url(`${p.file}.glb`)).then((g) => this.models.set(p.file, g.scene)));
    }
    jobs.push(this.loader.loadAsync(url('props/bull.glb')).then((g) => this.models.set('props/bull', g.scene)));

    // characters
    for (const race of ['elf_male', 'orc_male']) {
      jobs.push(this.loader.loadAsync(url(`characters/${race}.glb`)).then((g) => {
        const root = g.scene;
        // keep the body mesh only: 60-bone skinned meshes are expensive to duplicate
        let body = null, best = 0;
        root.traverse((o) => {
          if (o.isMesh && o.geometry?.attributes?.position) {
            const n = o.geometry.attributes.position.count;
            if (n > best) { best = n; body = o; }
          }
        });
        root.traverse((o) => { if (o.isMesh && o !== body) o.visible = false; });
        root.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = false;
          o.frustumCulled = false;
          if (o.material) { o.material.metalness = Math.min(o.material.metalness ?? 0, 0.15); o.material.roughness = Math.max(o.material.roughness ?? 1, 0.55); }
        });
        this.models.set(`characters/${race}`, root);
      }));
    }
    jobs.push(this.loader.loadAsync(url('characters/anims.glb')).then((g) => {
      for (const clip of g.animations) this.clips[clip.name] = clip;
    }));

    // nature props (separate gltf + bin + shared textures)
    const natureFiles = ['Pine_1', 'Pine_3', 'CommonTree_2', 'DeadTree_1', 'TwistedTree_2', 'Bush_Common', 'Rock_Medium_1', 'Rock_Medium_2', 'Pebble_Round_1', 'Fern_1'];
    for (const f of natureFiles) {
      jobs.push(this.loader.loadAsync(url(`nature/${f}.gltf`)).then((g) => {
        this.nature[f] = this.prepareNature(g.scene);
      }));
    }

    const total = jobs.length;
    let done = 0;
    await Promise.all(jobs.map((j) => j.then(() => onStep(++done / total))));
    this.ready = true;
  }

  mergeByMaterial(root) {
    root.updateMatrixWorld(true);
    const groups = new Map();
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      for (const key of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'uv', 'color'].includes(key)) g.deleteAttribute(key);
      }
      const count = g.attributes.position.count;
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      if (o.material.vertexColors && !g.attributes.color) {
        const cols = new Float32Array(count * 3).fill(1);
        g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      }
      g.morphAttributes = {};
      const mat = o.material;
      if (!groups.has(mat)) groups.set(mat, []);
      groups.get(mat).push(g);
    });
    const out = new THREE.Group();
    for (const [mat, geos] of groups) {
      const merged = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mat.side = THREE.FrontSide;
      mat.metalness = 0;
      if (!mat.roughness || mat.roughness < 0.45) mat.roughness = 0.85;
      out.add(mesh);
    }
    return out.children.length ? out : root;
  }

  /** Merge a nature prop into one geometry per material so it can be instanced. */
  prepareNature(root) {
    root.updateMatrixWorld(true);
    const groups = new Map();
    root.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      for (const key of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'uv', 'color'].includes(key)) g.deleteAttribute(key);
      }
      const n = g.attributes.position.count;
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      if (o.material.vertexColors && !g.attributes.color) {
        g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      }
      g.morphAttributes = {};
      if (!groups.has(o.material)) groups.set(o.material, []);
      groups.get(o.material).push(g);
    });
    const parts = [];
    for (const [mat, geos] of groups) {
      const merged = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
      if (!merged) continue;
      merged.computeBoundingBox();
      const m = mat.clone();
      m.side = THREE.DoubleSide;
      m.alphaTest = 0.4;
      m.transparent = false;
      m.roughness = 1;
      m.metalness = 0;
      // the kit ships an autumn-red leaf material; pull it toward the dark
      // northern palette so the battlefield reads green-brown
      if (/leaves/i.test(m.name || '')) m.color.setRGB(0.62, 0.82, 0.55);
      parts.push({ geometry: merged, material: m });
    }
    return parts;
  }

  /* -------------------------------------------------------------- factories */

  characterRoot(race) {
    const src = this.models.get(`characters/${race}`);
    const root = skeletonClone(src);
    root.scale.setScalar(1.32);
    return root;
  }

  buildingRoot(type) {
    const def = BUILDING_MODEL[type];
    if (!def) return new THREE.Group();
    const src = this.models.get(def.file);
    if (!src) return new THREE.Group();
    const root = src.clone(true);
    root.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.castShadow = !!def.shadow;
        o.receiveShadow = true;
      }
    });
    root.scale.setScalar(def.scale);
    return root;
  }

  propRoot(file) {
    const src = this.models.get(file);
    if (!src) return null;
    return src.clone(true);
  }

  tint(root, color) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || !m.color) continue;
        m.color.multiply(new THREE.Color(color));
      }
    });
  }
}
