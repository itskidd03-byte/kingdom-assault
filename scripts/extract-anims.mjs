/**
 * Pulls the handful of animation clips the troops need out of the (large)
 * Universal Animation Library GLB, strips root motion and writes a small file
 * the browser can load quickly.
 */
import { NodeIO } from '@gltf-transform/core';

const SRC = process.argv[2] || 'tmp/ual1.glb';
const DEST = process.argv[3] || 'public/assets/models/characters/anims.glb';
const KEEP = new Set([
  'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop',
  'Sword_Attack', 'Death01', 'Spell_Simple_Shoot', 'Hit_Chest', 'Sword_Idle',
]);

const io = new NodeIO();
const doc = await io.read(SRC);
const root = doc.getRoot();

for (const anim of root.listAnimations()) {
  if (!KEEP.has(anim.getName())) anim.dispose();
}
for (const anim of root.listAnimations()) {
  for (const channel of anim.listChannels()) {
    const node = channel.getTargetNode();
    const name = node ? node.getName() : '';
    if (channel.getTargetPath() === 'translation' && /pelvis|root|armature/i.test(name)) {
      channel.dispose();
    }
  }
}
for (const mesh of root.listMeshes()) mesh.dispose();
for (const material of root.listMaterials()) material.dispose();
for (const texture of root.listTextures()) texture.dispose();

await io.write(DEST, doc);
console.log(`[anims] wrote ${DEST} with ${root.listAnimations().length} clips`);
