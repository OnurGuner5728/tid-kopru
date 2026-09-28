const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];

function addMesh(THREE, parent, geometry, material, position, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function createBone(THREE, name, parent, position) {
  const bone = new THREE.Group();
  bone.name = name;
  bone.position.set(...position);
  parent.add(bone);
  return bone;
}

function createArm(THREE, root, side, materials, bones) {
  const suffix = side < 0 ? 'L' : 'R';
  const upper = createBone(THREE, `FK-Upperarm${suffix}`, root, [side * 0.34, 1.42, 0]);
  addMesh(THREE, upper, new THREE.CylinderGeometry(0.07, 0.085, 0.42, 12), materials.body, [0, -0.21, 0]);
  const forearm = createBone(THREE, `FK-Forearm${suffix}`, upper, [0, -0.42, 0]);
  addMesh(THREE, forearm, new THREE.CylinderGeometry(0.055, 0.07, 0.38, 12), materials.body, [0, -0.19, 0]);
  const hand = createBone(THREE, `FK-Hand${suffix}`, forearm, [0, -0.39, 0]);
  addMesh(THREE, hand, new THREE.BoxGeometry(0.15, 0.18, 0.07), materials.skin, [0, -0.07, 0]);
  bones[upper.name] = upper;
  bones[forearm.name] = forearm;
  bones[hand.name] = hand;

  const fingerOffsets = { Thumb: 0.075, Index: 0.052, Middle: 0.018, Ring: -0.018, Pinky: -0.052 };
  for (const finger of FINGERS) {
    let parent = hand;
    for (let joint = 1; joint <= 3; joint += 1) {
      const name = `FK-${finger}${joint}${suffix}`;
      const firstPosition = finger === 'Thumb'
        ? [side * 0.085, -0.035, 0]
        : [side * fingerOffsets[finger], joint === 1 ? -0.14 : -0.055, 0];
      const bone = createBone(THREE, name, parent, joint === 1 ? firstPosition : [0, -0.055, 0]);
      addMesh(
        THREE,
        bone,
        new THREE.CylinderGeometry(0.012, 0.014, finger === 'Thumb' ? 0.052 : 0.058, 8),
        materials.skin,
        [0, -0.026, 0],
      );
      bones[name] = bone;
      parent = bone;
    }
  }
}

export function createProceduralRig(THREE) {
  if (!THREE?.Group || !THREE?.Mesh || !THREE?.Quaternion) throw new TypeError('three_runtime_required');
  const root = new THREE.Group();
  root.name = 'TID-Procedural-Rig';
  const materials = {
    body: new THREE.MeshStandardMaterial({ color: 0x0b6b61, roughness: 0.75 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xc98262, roughness: 0.82 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xd8f06a, roughness: 0.7 }),
  };
  addMesh(THREE, root, new THREE.CapsuleGeometry(0.28, 0.7, 8, 16), materials.body, [0, 0.95, 0]);
  addMesh(THREE, root, new THREE.CylinderGeometry(0.22, 0.3, 0.32, 16), materials.accent, [0, 0.34, 0]);
  addMesh(THREE, root, new THREE.SphereGeometry(0.2, 24, 18), materials.skin, [0, 1.72, 0]);
  addMesh(THREE, root, new THREE.CylinderGeometry(0.085, 0.1, 0.15, 12), materials.skin, [0, 1.52, 0]);

  const bones = {};
  createArm(THREE, root, -1, materials, bones);
  createArm(THREE, root, 1, materials, bones);
  const baseRotations = Object.fromEntries(
    Object.entries(bones).map(([name, bone]) => [name, bone.quaternion.clone()]),
  );
  const reset = () => {
    for (const [name, rotation] of Object.entries(baseRotations)) bones[name].quaternion.copy(rotation);
  };
  return { root, bones, baseRotations, reset };
}
