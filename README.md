# KINGDOM ASSAULT

A real-time kingdom-building and tactical warfare game for the browser.

Two kingdoms face each other across a river with a single bridge. Both build,
farm, mine, recruit, research, fortify and attack by exactly the same rules.
You play one kingdom; the other is an independent AI kingdom (or a second
player over a peer-to-peer link). The match ends only when one king is dead and
his castle is in ruins.

## Play

```bash
npm install
npm run dev      # http://localhost:3000
```

Production build: `npm run build` → static files in `dist/` (works from any
static host, including GitHub Pages, because `base` is relative).

## Modes

* **Solo vs AI** — Easy / Normal / Hard. The AI runs its own economy,
  construction, recruitment, research, towers, scouting and attack waves. It
  reacts only to what its own units and structures can see (real fog of war).
* **Head-to-head** — two human players, peer to peer over WebRTC with manual
  signalling codes (no server). Both peers run the same deterministic
  simulation and exchange command batches in a fixed lockstep, so neither side
  can rewrite the other's state or peek past its own fog.

## Controls

| Input | Action |
| --- | --- |
| Left click / drag | Select a unit, structure, or box-select troops |
| Right click | Advance (attack-move) to the point or at the target |
| `A` / `H` / `S` / `X` / `G` | Assault · Hold · Stop · Retreat · Guard |
| `B`, `1`–`6` | Build menu, recruit hotkeys |
| `Ctrl`+`1`–`9` | Assign control group (`1`–`9` recalls) |
| `WASD` / arrows, middle-drag | Pan the camera |
| Mouse wheel | Zoom |
| `R` | Rotate the structure being placed |
| `Esc` | Cancel placement / clear selection |
| `Space` | Pause |

Buildings are placed on the battlefield after choosing a card in **BUILD**;
right-clicking with a building selected sets its rally point.

## Systems

* **Economy** — gold, food, materials, population, income and army upkeep.
  Farms feed the army, markets pay it, quarries build it, houses grow it.
  Starvation weakens every soldier and blocks recruitment.
* **Buildings** — castle, town hall, houses, farms, markets, quarries,
  barracks, medical tent, archery range, cavalry stable, elite hall,
  blacksmith, watchtower, three tower types, walls, gates and guard posts.
  All have health, cost, build time, three upgrade levels and a real effect.
* **Troops** — assault infantry, medics, ranged archers, barbarian cavalry,
  elite guards and defensive garrisons. Individual health, damage, defence,
  speed, attack rate, range and vision; cavalry gains a charge bonus.
* **Army command** — assault, defence, guard, patrol, escort, reinforce,
  retreat and hold orders, plus line, wedge, shield wall, circle and spread
  formations, group selection and formations per selection.
* **Defences** — towers acquire and fire at hostiles in range, walls block
  movement, gates let your own troops through, everything is repairable and
  destructible.
* **Fog of war** — separate per kingdom. Enemy territory starts black; only
  what a unit or structure can see right now is visible, and explored ground
  darkens again when nothing is watching it.
* **Upgrades** — five levels per troop class; each level raises health,
  damage, defence, speed and attack rate for existing and future recruits.
* **Victory** — the castle must be breached first; only then is the king
  exposed. Killing the king ends the match.

## Architecture

```
src/core/    config (all rules/data), world + terrain, pathfinding (A*),
             kingdom economy, buildings, units + orders, combat, fog, AI,
             game orchestration and victory
src/render/  asset loading, three.js scene, terrain/water/bridge, instanced
             nature, building and troop rendering, fog shader, effects
src/ui/      HUD, command panels, inspector, minimap, input, audio
src/net/     WebRTC peer link + deterministic lockstep clock
```

Simulation runs at a fixed 20 Hz tick with render interpolation; the AI and
fog of war refresh on their own cadence, and spatial hashing keeps neighbour
queries cheap as armies grow.

## Art

The visuals come from the asset packs supplied for this project:

* KayKit **Medieval Builder Pack** — castles, houses, markets, towers, walls
* Quaternius **Fantasy Races Kit** — Elf and Orc character meshes
* Quaternius **Universal Animation Library** — idle, walk, run, attack, death
* **Stylized Nature MegaKit** — pines, twisted trees, rocks, ferns
* assorted medieval props (tent, weapons, bull mount)

Models are merged per material, textures resized/compressed and nature props
instanced so a full battlefield stays cheap to draw.

`scripts/fetch-assets.py` rebuilds `public/assets/models` from the original
asset upload (see `ASSETS.md`). Run it once after cloning if the models are not
already present:

```bash
pip install pillow
python3 scripts/fetch-assets.py
```

## Licence

Game code: MIT. Art: see `ASSETS.md` — the packs keep their own licences.
