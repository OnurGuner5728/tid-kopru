import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as THREE from '../public/vendor/three/three.module.js';
import { createProceduralRig } from '../public/procedural-rig.mjs';

const poses = JSON.parse(await readFile(new URL('../public/assets/avatar/saved-poses.json', import.meta.url), 'utf8'));
const avatarSource = await readFile(new URL('../public/avatar.mjs', import.meta.url), 'utf8');

function poseBoneNames() {
  const names = new Set();
  for (const value of Object.values(poses)) {
    for (const frame of Array.isArray(value) ? value : [value]) {
      Object.keys(frame).forEach((name) => names.add(name));
    }
  }
  return names;
}

test('procedural rig exposes every SignBridge pose bone and resets rotations', () => {
  const rig = createProceduralRig(THREE);
  for (const name of poseBoneNames()) assert.ok(rig.bones[name], `missing bone ${name}`);
  assert.ok(rig.root.children.length > 0);

  const hand = rig.bones['FK-HandR'];
  hand.rotation.set(1, 2, 3);
  rig.reset();
  assert.ok(hand.quaternion.equals(rig.baseRotations['FK-HandR']));
});

test('avatar uses the procedural rig without GLTF or rain model dependencies', () => {
  assert.match(avatarSource, /createProceduralRig/u);
  assert.doesNotMatch(avatarSource, /GLTFLoader|rain\.glb/u);
});
