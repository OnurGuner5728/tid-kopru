import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const IDLE_POSE = {
  'FK-UpperarmR': { x: 0.15, y: 0.2, z: 0.8 },
  'FK-UpperarmL': { x: 0.15, y: -0.2, z: -0.8 }
};

export class SignAvatar {
  constructor(container, onStatus = () => {}) {
    this.container = container;
    this.onStatus = onStatus;
    this.bones = {};
    this.baseRotations = {};
    this.poses = {};
    this.ready = false;
    this.playing = false;
    this.stopRequested = false;
  }

  async initialize() {
    if (!this.renderer) this.setupScene();
    try {
      const [poseResponse, model] = await Promise.all([
        fetch('./assets/avatar/saved-poses.json'),
        new GLTFLoader().loadAsync('./assets/avatar/rain.glb', (event) => {
          if (event.total) this.onStatus(`Avatar yükleniyor · %${Math.round(event.loaded / event.total * 100)}`);
        })
      ]);
      if (!poseResponse.ok) throw new Error('Poz sözlüğü yüklenemedi.');
      this.poses = await poseResponse.json();
      this.attachAvatar(model.scene);
      this.ready = true;
      this.applyIdlePose();
      this.onStatus(`${Object.keys(this.poses).length} kayıtlı işaret hazır`);
      return this.poses;
    } catch (error) {
      this.onStatus('Avatar yüklenemedi');
      throw error;
    }
  }

  setupScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    this.camera.position.set(0, 1.35, 4.2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 6;
    this.controls.target.set(0, 1.2, 0);

    this.scene.add(new THREE.HemisphereLight(0xf3fff7, 0x17322d, 2.4));
    const key = new THREE.DirectionalLight(0xfff0df, 3);
    key.position.set(2.5, 4, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xcff66f, 1.7);
    rim.position.set(-3, 2, -2);
    this.scene.add(rim);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();

    const render = () => {
      this.animationFrame = requestAnimationFrame(render);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    render();
  }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  attachAvatar(avatar) {
    this.avatar = avatar;
    avatar.traverse((object) => {
      if (object.isBone) this.bones[object.name] = object;
      if (object.isMesh || object.isSkinnedMesh) {
        object.castShadow = true;
        object.frustumCulled = false;
      }
    });
    this.scene.add(avatar);
    avatar.updateMatrixWorld(true);

    const initialBox = new THREE.Box3().setFromObject(avatar);
    const initialHeight = initialBox.max.y - initialBox.min.y;
    const scale = initialHeight > 0.01 ? 1.78 / initialHeight : 1;
    avatar.scale.setScalar(scale);
    avatar.position.y = -initialBox.min.y * scale;
    avatar.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(avatar);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    this.camera.position.set(0, center.y + 0.03, Math.max(3, size.y * 1.65));
    this.controls.target.set(0, center.y, 0);
    this.controls.update();

    avatar.traverse((object) => {
      if (object.isBone) this.baseRotations[object.name] = object.quaternion.clone();
    });
  }

  resetPose() {
    for (const [name, rotation] of Object.entries(this.baseRotations)) {
      this.bones[name]?.quaternion.copy(rotation);
    }
  }

  applyPose(pose, amount = 1) {
    this.resetPose();
    if (!pose || amount <= 0) return;
    for (const [boneName, rotation] of Object.entries(pose)) {
      const bone = this.bones[boneName];
      const base = this.baseRotations[boneName];
      if (!bone || !base) continue;
      const euler = new THREE.Euler(rotation.x * amount, rotation.y * amount, rotation.z * amount, 'XYZ');
      bone.quaternion.copy(base.clone().multiply(new THREE.Quaternion().setFromEuler(euler)));
    }
  }

  applyIdlePose() {
    this.applyPose(IDLE_POSE);
  }

  interpolatePoses(fromPose, toPose, amount) {
    const mixed = {};
    const names = new Set([...Object.keys(fromPose ?? {}), ...Object.keys(toPose ?? {})]);
    for (const name of names) {
      const from = fromPose?.[name] ?? { x: 0, y: 0, z: 0 };
      const to = toPose?.[name] ?? { x: 0, y: 0, z: 0 };
      mixed[name] = {
        x: from.x + (to.x - from.x) * amount,
        y: from.y + (to.y - from.y) * amount,
        z: from.z + (to.z - from.z) * amount
      };
    }
    this.applyPose(mixed);
  }

  async playWord(word) {
    const poseData = this.poses[word];
    if (!poseData) return false;
    const frames = Array.isArray(poseData) ? poseData : [poseData];
    const steps = 18;

    for (let step = 0; step <= steps && !this.stopRequested; step += 1) {
      this.applyPose(frames[0], step / steps);
      await wait(20);
    }
    for (let frame = 0; frame < frames.length - 1 && !this.stopRequested; frame += 1) {
      await wait(140);
      for (let step = 0; step <= steps && !this.stopRequested; step += 1) {
        this.interpolatePoses(frames[frame], frames[frame + 1], step / steps);
        await wait(20);
      }
    }
    if (!this.stopRequested) await wait(520);
    const lastFrame = frames.at(-1);
    for (let step = steps; step >= 0 && !this.stopRequested; step -= 1) {
      this.applyPose(lastFrame, step / steps);
      await wait(20);
    }
    this.applyIdlePose();
    return true;
  }

  async playSequence(words, onProgress = () => {}) {
    if (!this.ready || this.playing) return false;
    this.playing = true;
    this.stopRequested = false;
    try {
      for (let index = 0; index < words.length && !this.stopRequested; index += 1) {
        onProgress({ index, word: words[index], total: words.length, done: false });
        await this.playWord(words[index]);
        onProgress({ index, word: words[index], total: words.length, done: true });
        if (index < words.length - 1) await wait(220);
      }
      return !this.stopRequested;
    } finally {
      this.playing = false;
      this.applyIdlePose();
    }
  }

  stop() {
    this.stopRequested = true;
  }
}

