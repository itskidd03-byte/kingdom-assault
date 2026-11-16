import * as THREE from 'three';
import { BUILDINGS, TROOPS, TILE, WORLD, RIVER, BRIDGE, BASE_X } from '../core/config.js';
import { BUILDING_MODEL } from './assets.js';
import { clamp, lerp, hash2 } from '../core/rng.js';

const CAM = { minDist: 34, maxDist: 165, pitch: 0.92, fov: 42 };

const CLASS_TINT = {
  infantry: 0xcfd8e6, medic: 0xf2ead8, ranged: 0xa9bf85,
  cavalry: 0xd2a172, elite: 0xe8bf6a, garrison: 0x98a4b0, king: 0xffd978,
};
const FACTIONS_TINT = [0xa9c6ef, 0xf0a68f];

/** The whole 3D presentation: terrain, structures, troops, fog and camera. */
export class View {
  constructor(canvas, game, owner, assets) {
    this.canvas = canvas;
    this.game = game;
    this.owner = owner;
    this.assets = assets;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c0d);
    this.scene.fog = new THREE.FogExp2(0x0e1418, 0.0032);

    this.camera = new THREE.PerspectiveCamera(CAM.fov, 1, 1, 900);
    this.target = { x: owner === 0 ? -BASE_X : BASE_X, z: 0 };
    this.dist = 92;
    this.yaw = 0;
    this.keys = new Set();
    this.pointer = { x: 0, y: 0, worldX: 0, worldZ: 0 };

    this.unitViews = new Map();
    this.buildingViews = new Map();
    this.dying = [];
    this.selection = new Set();
    this.hover = null;
    this.ghost = null;
    this.markers = [];
    this.tmpV = new THREE.Vector3();
    this.tmpM = new THREE.Matrix4();
    this.tmpQ = new THREE.Quaternion();
    this.tmpS = new THREE.Vector3(1, 1, 1);
    this.time = 0;

    this.overlay = document.createElement('canvas');
    this.overlay.id = 'hud-overlay';
    Object.assign(this.overlay.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '3',
    });
    canvas.parentElement.appendChild(this.overlay);
    this.octx = this.overlay.getContext('2d');

    this.buildScene();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /* ------------------------------------------------------------- scene build */

  buildScene() {
    const { scene } = this;

    const hemi = new THREE.HemisphereLight(0x8ea4b8, 0x3a3222, 1.45);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffd9a8, 2.15);
    sun.position.set(-70, 110, 55);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = 320;
    const s = 110;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0012;
    scene.add(sun);
    this.sun = sun;

    const rim = new THREE.DirectionalLight(0x4d6f9e, 0.55);
    rim.position.set(80, 50, -70);
    scene.add(rim);

    this.buildTerrain();
    this.buildWater();
    this.buildBridge();
    this.buildDecor();
    this.buildFogPlane();

    // selection / order markers
    const ringGeo = new THREE.RingGeometry(0.7, 0.95, 24);
    ringGeo.rotateX(-Math.PI / 2);
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xd9b25b, transparent: true, opacity: 0.85, depthWrite: false });
    this.markerGeo = ringGeo;

    this.hpGroup = new THREE.Group();
    scene.add(this.hpGroup);
  }

  buildTerrain() {
    const W = WORLD.w, H = WORLD.h;
    const segX = 160, segZ = 92;
    const geo = new THREE.BufferGeometry();
    const pos = [], col = [], idx = [], uv = [];
    const c = new THREE.Color();
    for (let iz = 0; iz <= segZ; iz++) {
      for (let ix = 0; ix <= segX; ix++) {
        const x = -W / 2 + (ix / segX) * W;
        const z = -H / 2 + (iz / segZ) * H;
        const y = this.game.world.heightAt(x, z);
        pos.push(x, y, z);
        uv.push((x + W / 2) / W, (z + H / 2) / H);

        // colour: dark grass, mud banks, rocky slopes, dirt roads
        const n = hash2(Math.round(x * 0.7), Math.round(z * 0.7), 11);
        const slope = Math.abs(this.game.world.heightAt(x + 1.5, z) - y) + Math.abs(this.game.world.heightAt(x, z + 1.5) - y);
        const nearRiver = Math.max(0, 1 - Math.abs(Math.abs(x) - 9) / 9);
        const road = this.game.world.isOnRoad(x, z) ? 1 : 0;
        // packed earth everywhere: this valley has no grass, only road and dirt
        let r = 0.29 + n * 0.05, g = 0.24 + n * 0.045, b = 0.17 + n * 0.03;
        if (y < -1.2) { r = 0.14; g = 0.16; b = 0.13; }
        if (nearRiver > 0.1 && y > -1.2) {
          const m = nearRiver * 0.55;
          r = lerp(r, 0.24, m); g = lerp(g, 0.21, m); b = lerp(b, 0.15, m);
        }
        if (slope > 1.1) { const m = clamp((slope - 1.1) / 2, 0, 0.7); r = lerp(r, 0.28, m); g = lerp(g, 0.27, m); b = lerp(b, 0.25, m); }
        if (road > 0.05) { const m = road * 0.55; r = lerp(r, 0.41, m); g = lerp(g, 0.34, m); b = lerp(b, 0.22, m); }
        col.push(r, g, b);
      }
    }
    for (let iz = 0; iz < segZ; iz++) {
      for (let ix = 0; ix < segX; ix++) {
        const a = iz * (segX + 1) + ix;
        const b = a + 1, cIdx = a + segX + 1, d = cIdx + 1;
        idx.push(a, cIdx, b, b, cIdx, d);
      }
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.02 });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
    this.terrainGeo = geo;
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(30, WORLD.h - 4, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x14262e, roughness: 0.18, metalness: 0.55, transparent: true, opacity: 0.92,
    });
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = -1.05;
    this.scene.add(this.water);
  }

  buildBridge() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2e2419, roughness: 0.95 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 0.95 });

    const deckW = RIVER.x1 * 2 + 3;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(deckW, 0.45, BRIDGE.z1 * 2), wood);
    deck.position.set(0, BRIDGE.deck - 0.2, 0);
    deck.castShadow = true; deck.receiveShadow = true;
    g.add(deck);

    // planks
    for (let i = 0; i < 22; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, BRIDGE.z1 * 2 - 0.4), dark);
      p.position.set(-deckW / 2 + 0.6 + i * (deckW - 1.2) / 21, BRIDGE.deck + 0.06, 0);
      g.add(p);
    }
    // rails and posts
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(deckW, 0.16, 0.16), dark);
      rail.position.set(0, BRIDGE.deck + 1.15, side * (BRIDGE.z1 - 0.4));
      g.add(rail);
      for (let i = 0; i < 7; i++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.25, 0.22), dark);
        post.position.set(-deckW / 2 + 0.7 + i * (deckW - 1.4) / 6, BRIDGE.deck + 0.6, side * (BRIDGE.z1 - 0.4));
        post.castShadow = true;
        g.add(post);
      }
    }
    // stone abutments
    for (const side of [-1, 1]) {
      const ab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4.6, BRIDGE.z1 * 2 + 1.6), stone);
      ab.position.set(side * (deckW / 2 - 0.6), BRIDGE.deck - 2.6, 0);
      ab.castShadow = true; ab.receiveShadow = true;
      g.add(ab);
    }
    // torches at both ends
    for (const side of [-1, 1]) {
      const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.2, 6), dark);
      torch.position.set(side * (deckW / 2 - 0.5), BRIDGE.deck + 1.1, BRIDGE.z1 - 0.5);
      g.add(torch);
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffb45a }));
      flame.position.copy(torch.position).add(new THREE.Vector3(0, 1.2, 0));
      g.add(flame);
      const light = new THREE.PointLight(0xff9a45, 26, 34, 2);
      light.position.copy(flame.position);
      g.add(light);
      this.torchLights = this.torchLights || [];
      this.torchLights.push(flame);
    }
    this.bridge = g;
    this.scene.add(g);
  }

  buildDecor() {
    const a = this.assets;
    const treeModels = [
      { parts: a.nature.Pine_1, scale: [1.05, 1.75] },
      { parts: a.nature.Pine_3, scale: [1.05, 1.65] },
      { parts: a.nature.CommonTree_2, scale: [1.15, 1.85] },
      { parts: a.nature.DeadTree_1, scale: [0.85, 1.25] },
      { parts: a.nature.TwistedTree_2, scale: [0.42, 0.75] },
    ].filter((g) => g.parts && g.parts.length);
    const rockModels = [
      { parts: a.nature.Bush_Common, scale: [0.75, 1.35] },
      { parts: a.nature.Rock_Medium_1, scale: [0.85, 1.5] },
      { parts: a.nature.Rock_Medium_2, scale: [0.85, 1.45] },
      { parts: a.nature.Fern_1, scale: [0.45, 0.8] },
    ].filter((g) => g.parts && g.parts.length);
    if (!treeModels.length && !rockModels.length) return;

    const trees = this.game.world.decor.trees;
    const rocks = this.game.world.decor.rocks;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    const instancing = (model, placements, yOff) => {
      if (!model || !model.parts || !model.parts.length || !placements.length) return;
      for (const part of model.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, placements.length);
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        placements.forEach((t, i) => {
          const sc = model.scale[0] + (t.v ?? 0.5) * (model.scale[1] - model.scale[0]);
          p.set(t.x, this.game.world.heightAt(t.x, t.z) + yOff, t.z);
          q.setFromAxisAngle(up, t.r || 0);
          s.set(sc, sc, sc);
          m.compose(p, q, s);
          mesh.setMatrixAt(i, m);
        });
        mesh.instanceMatrix.needsUpdate = true;
        this.scene.add(mesh);
      }
    };

    // split tree placements evenly across the tree models
    treeModels.forEach((model, gi) => {
      const list = trees.filter((_, i) => i % treeModels.length === gi);
      instancing(model, list, -0.15);
    });
    rockModels.forEach((model, gi) => {
      const list = rocks.filter((_, i) => i % rockModels.length === gi);
      instancing(model, list, -0.2);
    });

  }

  buildFogPlane() {
    const fog = this.game.kingdoms[this.owner].fog;
    const tex = new THREE.DataTexture(fog.data, fog.w, fog.h, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.flipY = false;
    tex.needsUpdate = true;
    this.fogTex = tex;

    const geo = this.terrainGeo.clone();
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + 0.35);
    pos.needsUpdate = true;

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { fogTex: { value: tex } },
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform sampler2D fogTex;
        varying vec2 vUv;
        void main(){
          float a = texture2D(fogTex, vUv).r;
          float edge = smoothstep(0.02, 0.95, a);
          vec3 col = mix(vec3(0.02,0.025,0.028), vec3(0.008,0.010,0.012), edge);
          gl_FragColor = vec4(col, a * 0.9);
        }
      `,
    });
    this.fogMesh = new THREE.Mesh(geo, mat);
    this.fogMesh.renderOrder = 2;
    this.scene.add(this.fogMesh);
    this.fogData = fog.data;
  }

  /* ---------------------------------------------------------------- camera */

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.overlay.width = Math.floor(w * dpr);
    this.overlay.height = Math.floor(h * dpr);
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.vw = w; this.vh = h;
  }

  pan(dx, dz) {
    this.target.x = clamp(this.target.x + dx, -WORLD.w / 2 + 16, WORLD.w / 2 - 16);
    this.target.z = clamp(this.target.z + dz, -WORLD.h / 2 + 12, WORLD.h / 2 - 12);
  }

  zoom(delta) {
    this.dist = clamp(this.dist * (1 + delta), CAM.minDist, CAM.maxDist);
  }

  updateCamera(dt) {
    const speed = this.dist * 0.9 * dt;
    let mx = 0, mz = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) mz -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) mz += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) mx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) mx += 1;
    if (mx || mz) this.pan(mx * speed, mz * speed);

    const h = Math.sin(CAM.pitch) * this.dist;
    const back = Math.cos(CAM.pitch) * this.dist;
    this.camera.position.set(this.target.x, h, this.target.z + back);
    this.camera.lookAt(this.target.x, 0, this.target.z);
    this.sun.position.set(this.target.x - 70, 120, this.target.z + 55);
    this.sun.target.position.set(this.target.x, 0, this.target.z);
    this.sun.target.updateMatrixWorld();
  }

  /* --------------------------------------------------------------- picking */

  screenToGround(clientX, clientY) {
    const ndc = new THREE.Vector2(
      (clientX / this.vw) * 2 - 1,
      -(clientY / this.vh) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return { x: this.target.x, z: this.target.z };
    return { x: hit.x, z: hit.z };
  }

  worldToScreen(x, y, z) {
    this.tmpV.set(x, y, z).project(this.camera);
    return {
      x: (this.tmpV.x * 0.5 + 0.5) * this.vw,
      y: (-this.tmpV.y * 0.5 + 0.5) * this.vh,
      behind: this.tmpV.z > 1,
    };
  }

  /** Nearest selectable entity under the cursor (or null). */
  pick(clientX, clientY) {
    let best = null, bestD = 1e9;
    const fog = this.game.kingdoms[this.owner].fog;
    for (const u of this.game.units) {
      if (u.dead || u.hidden || u.isKing) continue;
      if (u.owner !== this.owner && !fog.isVisible(u.x, u.z)) continue;
      const s = this.worldToScreen(u.x, (u.groundY || 0) + 1.0, u.z);
      const d = Math.hypot(s.x - clientX, s.y - clientY);
      const r = clamp(900 / this.dist, 12, 32);
      if (d < r && d < bestD) { bestD = d; best = u; }
    }
    for (const b of this.game.buildings) {
      if (b.dead) continue;
      if (b.owner !== this.owner && !fog.isVisible(b.x, b.z)) continue;
      const s = this.worldToScreen(b.x, (b.y || 0) + 2, b.z);
      const r = clamp((Math.max(b.w, b.h) * TILE * 0.5 * 900) / this.dist / 6, 14, 70);
      const d = Math.hypot(s.x - clientX, s.y - clientY);
      if (d < r && d - 6 < bestD) { bestD = d - 6; best = b; }
    }
    return best;
  }

  unitsInBox(x0, y0, x1, y1) {
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    const out = [];
    for (const u of this.game.units) {
      if (u.owner !== this.owner || u.dead || u.hidden || u.isKing) continue;
      const s = this.worldToScreen(u.x, (u.groundY || 0) + 1, u.z);
      if (s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY) out.push(u);
    }
    return out;
  }

  /* -------------------------------------------------------------- entities */

  ensureUnitView(u) {
    if (this.unitViews.has(u.id)) return this.unitViews.get(u.id);
    const race = u.owner === 0 ? 'elf_male' : 'orc_male';
    const root = this.assets.characterRoot(race);
    const tint = CLASS_TINT[u.isKing ? 'king' : u.cls] || 0xffffff;
    const fac = FACTIONS_TINT[u.owner];
    const c = new THREE.Color(tint).lerp(new THREE.Color(fac), 0.35);
    root.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.color.multiply(c);
        o.material.roughness = 0.78;
      }
    });
    const scale = (TROOPS[u.cls]?.scale || 1) * (u.isKing ? 1.25 : 1);
    root.scale.multiplyScalar(scale);

    // mount for cavalry
    if (u.cls === 'cavalry') {
      const mount = this.assets.propRoot('props/bull');
      if (mount) {
        mount.scale.setScalar(48);
        mount.position.y = 0.3;
        mount.traverse((o) => {
          if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(fac)); }
        });
        root.position.y = 1.45;
        const group = new THREE.Group();
        group.add(mount);
        group.add(root);
        this.scene.add(group);
        const view = { root: group, rider: root, mount, mixer: new THREE.AnimationMixer(root), actions: {}, current: '', unit: u, isGroup: true };
        this.setupActions(view);
        this.unitViews.set(u.id, view);
        return view;
      }
    }

    // hand weapon
    const prop = {
      infantry: 'props/axe', garrison: 'props/axe', elite: 'props/mace',
      ranged: 'props/bow', medic: 'props/dagger',
    }[u.cls];
    if (prop) {
      const weapon = this.assets.propRoot(prop);
      if (weapon) {
        const boneName = u.cls === 'ranged' ? 'hand_l' : 'hand_r';
        let bone = null;
        root.traverse((o) => { if (o.isBone && o.name === boneName) bone = o; });
        if (bone) {
          const scaleW = { 'props/axe': 0.3, 'props/mace': 0.5, 'props/bow': 0.1, 'props/dagger': 0.22 }[prop];
          weapon.scale.setScalar(scaleW);
          weapon.rotation.set(0, 0, Math.PI / 2);
          weapon.position.set(0, 0, 0.1);
          bone.add(weapon);
        }
      }
    }

    this.scene.add(root);
    const view = { root, mixer: new THREE.AnimationMixer(root), actions: {}, current: '', unit: u };
    this.setupActions(view);
    this.unitViews.set(u.id, view);
    return view;
  }

  setupActions(view) {
    const clips = this.assets.clips;
    const map = {
      idle: clips.Idle_Loop,
      walk: clips.Walk_Loop,
      run: clips.Jog_Fwd_Loop,
      attack: clips.Sword_Attack,
      heal: clips.Spell_Simple_Shoot,
      die: clips.Death01,
    };
    for (const [k, clip] of Object.entries(map)) {
      if (!clip) continue;
      const act = view.mixer.clipAction(clip);
      if (k === 'attack' || k === 'heal') {
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = true;
      }
      if (k === 'die') { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; }
      view.actions[k] = act;
    }
  }

  playAction(view, name, fade = 0.16) {
    if (!view.actions[name] || view.current === name) return;
    const next = view.actions[name];
    const prev = view.actions[view.current];
    next.reset();
    next.setEffectiveWeight(1);
    next.enabled = true;
    if (prev) next.crossFadeFrom(prev, fade, false);
    next.play();
    view.current = name;
  }

  ensureBuildingView(b) {
    if (this.buildingViews.has(b.id)) return this.buildingViews.get(b.id);
    const root = this.assets.buildingRoot(b.type);
    const tint = b.owner === 0 ? 0xd7e6ff : 0xffd6c8;
    this.assets.tint(root, tint);
    const yawBase = b.owner === 0 ? 0 : 0;
    const rotY = (b.rot || 0) * Math.PI / 2 + yawBase;
    root.rotation.y = rotY;
    root.position.set(b.x, this.game.world.heightAt(b.x, b.z) - 0.1, b.z);
    this.scene.add(root);
    const view = { root, type: b.type, ruined: false };
    this.buildingViews.set(b.id, view);
    return view;
  }

  addOrderMarker(x, z, color = 0xd9b25b) {
    const mesh = new THREE.Mesh(this.markerGeo, this.markerMat.clone());
    mesh.material.color.set(color);
    mesh.position.set(x, this.game.world.heightAt(x, z) + 0.4, z);
    mesh.scale.setScalar(2.2);
    this.scene.add(mesh);
    this.markers.push({ mesh, life: 0.9 });
  }

  setGhost(type, x, z, rot, valid) {
    if (this.ghost && this.ghostType === type) {
      this.ghost.root.position.set(x, this.game.world.heightAt(x, z), z);
      this.ghost.root.rotation.y = rot * Math.PI / 2;
      const color = valid ? 0x7dff9a : 0xff6b5a;
      this.ghost.root.traverse((o) => { if (o.isMesh) o.material.color.set(color); });
      return;
    }
    this.clearGhost();
    const root = this.assets.buildingRoot(type);
    root.traverse((o) => {
      if (o.isMesh) {
        o.material = new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0.45, depthWrite: false });
      }
    });
    root.position.set(x, this.game.world.heightAt(x, z), z);
    root.rotation.y = rot * Math.PI / 2;
    this.scene.add(root);
    this.ghost = { root };
    this.ghostType = type;
  }

  clearGhost() {
    if (this.ghost) { this.scene.remove(this.ghost.root); this.ghost = null; this.ghostType = null; }
  }

  /* --------------------------------------------------------------- syncing */

  sync(dt, alpha) {
    const fog = this.game.kingdoms[this.owner].fog;
    const seen = new Set();

    for (const u of this.game.units) {
      if (u.hidden) continue;
      const visible = u.owner === this.owner || fog.isVisible(u.x, u.z);
      if (!visible) continue;
      seen.add(u.id);

      let view = this.unitViews.get(u.id);
      if (!view) {
        if (u.dead) continue;
        view = this.ensureUnitView(u);
      }
      const ix = lerp(u.prevX ?? u.x, u.x, alpha);
      const iz = lerp(u.prevZ ?? u.z, u.z, alpha);
      const y = this.game.world.groundAt(ix, iz);
      view.root.position.x = ix;
      view.root.position.z = iz;
      if (!view.isGroup) view.root.position.y = y;
      else view.root.position.y = y;
      view.root.rotation.y = u.rot;

      // animation state
      const near = Math.abs(ix - this.target.x) + Math.abs(iz - this.target.z) < 150;
      if (near && view.mixer) {
        if (u.dead) this.playAction(view, 'die', 0.1);
        else if (u.attackFlash > 0) this.playAction(view, u.cls === 'medic' ? 'heal' : 'attack', 0.06);
        else if (u.currentSpeed > 5.0) this.playAction(view, 'run', 0.2);
        else if (u.currentSpeed > 0.35) this.playAction(view, 'walk', 0.2);
        else this.playAction(view, 'idle', 0.24);
        const ts = u.dead ? 1 : u.currentSpeed > 5 ? 1.35 : u.currentSpeed > 0.35 ? 1.05 : 1;
        view.mixer.update(dt * ts);
      }
      if (u.dead) {
        if (u.deadAt === undefined) u.deadAt = this.game.time;
        if (this.game.time - u.deadAt > 1.6) {
          this.scene.remove(view.root);
          this.unitViews.delete(u.id);
        }
      }
    }

    // units that vanished from view (died or left sight)
    for (const [id, view] of this.unitViews) {
      const u = this.game.units.find((x) => x.id === id);
      if (!u) {
        this.scene.remove(view.root);
        this.unitViews.delete(id);
        continue;
      }
      if (!seen.has(id) && !u.dead) {
        view.root.visible = false;
      } else {
        view.root.visible = true;
      }
      if (u.dead && this.game.time - (u.deadAt || 0) > 1.6) {
        this.scene.remove(view.root);
        this.unitViews.delete(id);
      }
    }

    for (const b of this.game.buildings) {
      const visible = b.owner === this.owner || fog.isVisible(b.x, b.z);
      for (const u of b.queue) { /* queue ids only matter for UI */ }
      if (!visible) {
        const v = this.buildingViews.get(b.id);
        if (v) v.root.visible = false;
        continue;
      }
      let view = this.buildingViews.get(b.id);
      if (!view) view = this.ensureBuildingView(b);
      view.root.visible = true;

      if (b.dead && !view.ruined) {
        view.ruined = true;
        this.scene.remove(view.root);
        this.buildingViews.delete(b.id);
        if (b.type !== 'castle' && b.type !== 'wall' && b.type !== 'gate') {
          const ruin = this.assets.buildingRoot('ruins');
          this.assets.tint(ruin, 0x6a6259);
          ruin.scale.multiplyScalar(Math.max(1, (Math.max(b.w, b.h) * TILE) / 4));
          ruin.position.set(b.x, this.game.world.heightAt(b.x, b.z) - 0.2, b.z);
          ruin.rotation.y = b.rot * Math.PI / 2;
          this.scene.add(ruin);
        } else if (b.type === 'castle') {
          const ruin = this.assets.buildingRoot('ruins');
          ruin.scale.multiplyScalar(2.4);
          ruin.position.set(b.x, this.game.world.heightAt(b.x, b.z) - 0.2, b.z);
          this.scene.add(ruin);
        }
        continue;
      }
      if (b.dead) continue;

      if (!b.completed) {
        const p = clamp(b.progress, 0.05, 1);
        view.root.scale.y = (BUILDING_MODEL[b.type]?.scale || 4) * (0.25 + 0.75 * p);
        view.root.position.y = this.game.world.heightAt(b.x, b.z) - 0.1;
      } else {
        view.root.scale.y = BUILDING_MODEL[b.type]?.scale || 4;
      }
      // battle damage tint
      const hpFrac = b.hp / b.maxHp;
      if (hpFrac < 0.55 && !view.damaged) {
        view.damaged = true;
        this.assets.tint(view.root, 0x8a8078);
      }
      view.root.rotation.z = b.shake > 0 ? Math.sin(this.time * 60) * 0.012 * (b.shake / 0.18) : 0;
    }
  }

  /* --------------------------------------------------------------- effects */

  updateEffects(dt) {
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.life -= dt;
      const t = Math.max(0, m.life / 0.9);
      m.mesh.material.opacity = t * 0.9;
      m.mesh.scale.setScalar(2.2 + (1 - t) * 4);
      if (m.life <= 0) { this.scene.remove(m.mesh); m.mesh.material.dispose(); this.markers.splice(i, 1); }
    }
    for (const e of this.game.effects) {
      if (e.type === 'impact' && !e._spawned) {
        e._spawned = true;
      }
    }
  }

  /* --------------------------------------------------------------- overlay */

  drawOverlay() {
    const ctx = this.octx;
    ctx.clearRect(0, 0, this.vw, this.vh);
    const fog = this.game.kingdoms[this.owner].fog;

    // health bars
    for (const u of this.game.units) {
      if (u.dead || u.hidden) continue;
      if (u.owner !== this.owner && !fog.isVisible(u.x, u.z)) continue;
      const selected = this.selection.has(u.id);
      if (!selected && u.hp >= u.maxHp && u.owner !== this.owner) continue;
      const s = this.worldToScreen(u.x, (u.groundY || 0) + 2.9, u.z);
      if (s.behind) continue;
      const w = u.isKing ? 40 : 22, h = 3;
      const frac = clamp(u.hp / u.maxHp, 0, 1);
      const isAlly = u.owner === this.owner;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(s.x - w / 2, s.y, w, h);
      ctx.fillStyle = isAlly ? (u.isKing ? '#e8c46a' : frac > 0.5 ? '#86ab63' : frac > 0.25 ? '#d9b25b' : '#b5574a')
        : isAlly ? '#b5574a' : '#c9564a';
      ctx.fillRect(s.x - w / 2, s.y, w * frac, h);

      if (selected) {
        ctx.beginPath();
        ctx.ellipse(s.x, s.y + 10, 13, 7, 0, 0, Math.PI * 2);
        ctx.strokeStyle = isAlly ? 'rgba(217,178,91,0.95)' : 'rgba(200,80,70,0.95)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (u.isKing) {
        ctx.fillStyle = '#e8c46a';
        ctx.font = '600 10px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText('THE KING', s.x, s.y - 8);
      }
    }

    // building labels + health
    for (const b of this.game.buildings) {
      if (b.dead) continue;
      if (b.owner !== this.owner && !fog.isVisible(b.x, b.z)) continue;
      const s = this.worldToScreen(b.x, (b.y || 0) + 9, b.z);
      if (s.behind) continue;
      const selected = this.selection.has(b.id);
      if (b.hp < b.maxHp || b.queue.length || selected) {
        const w = 46;
        const frac = clamp(b.hp / b.maxHp, 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(s.x - w / 2, s.y, w, 3);
        ctx.fillStyle = b.owner === this.owner ? '#7e9f5f' : '#b5574a';
        ctx.fillRect(s.x - w / 2, s.y, w * frac, 3);
        if (b.completed && b.upgrading) {
          ctx.fillStyle = 'rgba(217,178,91,0.85)';
          ctx.fillRect(s.x - w / 2, s.y + 5, w * (1 - b.upgrading.remaining / b.upgrading.total), 2);
        }
      }
      if (selected) {
        ctx.strokeStyle = 'rgba(217,178,91,0.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(s.x - 26, s.y - 4, 52, 22);
      }
    }
  }

  render(dt, alpha) {
    this.time += dt;
    this.updateCamera(dt);
    this.sync(dt, alpha);
    this.updateEffects(dt);

    if (this.fogTex) {
      this.fogTex.needsUpdate = true;
      if (this.torchLights) {
        const t = this.time * 6;
        for (let i = 0; i < this.torchLights.length; i++) {
          this.torchLights[i].scale.setScalar(1 + Math.sin(t + i) * 0.12);
        }
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.drawOverlay();
  }
}


