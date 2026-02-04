import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { gsap } from "gsap";

/**
 * BG3-ish D20 roll:
 * - Cinematic camera
 * - Rim light + warm key
 * - Bloom + vignette
 * - Fake "physics": spin -> ease into a target quaternion result
 *
 * BONUS:
 * - Calibration mode: set poses for faces 1..20
 *   Press C to toggle calibration mode
 *   In calibration: Arrow keys rotate the die, number keys 1..0 then QWERTY... map faces
 *   Press S to dump the JSON poses in console (copy to D20_POSES).
 */

// ---------- UI ----------
const elResult = document.getElementById("result");
const elMode = document.getElementById("mode");

// ---------- Renderer ----------
const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

// ---------- Scene ----------
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05060a, 0.06);

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0.0, 1.15, 5.2);

const camRig = new THREE.Group();
camRig.add(camera);
scene.add(camRig);

// ---------- Lights (cinematic) ----------
const ambient = new THREE.AmbientLight(0x2b2f3d, 0.35);
scene.add(ambient);

// Warm key
const key = new THREE.DirectionalLight(0xffd7a8, 2.2);
key.position.set(2.0, 3.0, 2.2);
scene.add(key);

// Cool fill
const fill = new THREE.DirectionalLight(0xa8c8ff, 0.7);
fill.position.set(-2.5, 1.2, 2.0);
scene.add(fill);

// Golden rim
const rim = new THREE.DirectionalLight(0xffcc6a, 1.8);
rim.position.set(0.0, 2.2, -3.5);
scene.add(rim);

// Subtle ground bounce
const bounce = new THREE.PointLight(0x5e83ff, 0.35, 12);
bounce.position.set(0, -1.2, 1.5);
scene.add(bounce);

// ---------- Ground (invisible, but catches a faint shadow vibe via fog + light) ----------
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 50),
  new THREE.MeshStandardMaterial({ color: 0x070914, roughness: 1, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1.15;
ground.receiveShadow = false;
ground.visible = false;
scene.add(ground);

// ---------- Postprocessing (Bloom + Vignette) ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.75, // strength
  0.55, // radius
  0.18  // threshold
);
composer.addPass(bloom);

// Tiny vignette shader
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset: { value: 1.05 },
    darkness: { value: 1.25 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - 0.5) * offset;
      float vig = smoothstep(0.8, 0.15, dot(uv, uv));
      color.rgb *= mix(1.0, vig, darkness);
      gl_FragColor = color;
    }
  `
};
const vignette = new ShaderPass(VignetteShader);
composer.addPass(vignette);

// ---------- Dice ----------
let dice = null;
const dicePivot = new THREE.Group();
scene.add(dicePivot);

// Slight “altar” position
dicePivot.position.set(0, -0.1, 0);

// Replace this with your calibrated poses.
// Format: array index 1..20 => { x,y,z,w } quaternion
let D20_POSES = defaultD20Poses();

/**
 * If your GLB orientation differs (likely), use calibration mode:
 * - Press C
 * - Use arrow keys + A/D to rotate die to make a face "up"
 * - Press a mapped key for that face number
 * - Press S to dump poses JSON
 * - Paste JSON into D20_POSES and you're done forever
 */
let calibrationMode = false;
let currentFace = 20;

const loader = new GLTFLoader();
await loadDice();

async function loadDice() {
  const gltf = await loader.loadAsync("/models/d20.glb"); // public/...
  dice = gltf.scene;

  // Make sure materials look “premium”
  dice.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;

      // If the model has its own materials, keep them.
      // But if it looks dull, you can force a standard material:
      // o.material = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.85, roughness: 0.28 });
      if (o.material) {
        o.material.metalness = clamp(o.material.metalness ?? 0.6, 0.0, 1.0);
        o.material.roughness = clamp(o.material.roughness ?? 0.35, 0.0, 1.0);
        o.material.needsUpdate = true;
      }
    }
  });

  // Normalize scale
  const box = new THREE.Box3().setFromObject(dice);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const target = 1.35; // visual size
  const s = target / maxDim;
  dice.scale.setScalar(s);

  // Center
  const center = new THREE.Vector3();
  box.getCenter(center);
  dice.position.sub(center.multiplyScalar(s));

  dicePivot.add(dice);

  // Start pose (offscreen-ish)
  dicePivot.position.set(0.0, -0.25, 0.0);
  dice.rotation.set(0.6, -0.8, 0.2);

  introBeat();
}

function introBeat() {
  const tl = gsap.timeline();
  tl.to(camRig.position, { x: 0.08, y: 0.02, z: 0.0, duration: 1.4, ease: "power2.out" }, 0);
  tl.to(camera.position, { z: 4.6, y: 1.05, duration: 1.4, ease: "power2.out" }, 0);
  tl.to(bloom, { strength: 0.85, duration: 0.9, ease: "power2.out" }, 0);
  tl.to(dicePivot.position, { y: -0.05, duration: 1.2, ease: "power3.out" }, 0.1);
}

// ---------- Roll Animation ----------
let rolling = false;

function rollD20(forcedFace = null) {
  if (!dice || rolling) return;
  rolling = true;

  const face = forcedFace ?? (1 + Math.floor(Math.random() * 20));
  currentFace = face;
  elResult.textContent = "—";

  // Camera: slight swoop + tighten
  const tl = gsap.timeline({
    defaults: { ease: "power2.out" },
    onComplete: () => (rolling = false)
  });

  // Reset bloom to make the impact “pop”
  tl.to(bloom, { strength: 1.05, duration: 0.15, ease: "power1.out" }, 0);

  // Bring die in (like “summoned”)
  tl.fromTo(
    dicePivot.position,
    { y: -0.2 },
    { y: 0.02, duration: 0.35, ease: "power3.out" },
    0
  );

  // Big spin phase (fake physics)
  const spin = { t: 0 };
  const startQuat = dice.quaternion.clone();
  const spinAxis = new THREE.Vector3(0.25, 1.0, 0.35).normalize();

  tl.to(camera.position, { z: 4.1, y: 1.0, x: 0.08, duration: 0.55 }, 0);
  tl.to(camRig.rotation, { y: -0.06, duration: 0.55 }, 0);

  tl.to(spin, {
    t: 1,
    duration: 0.85,
    ease: "power1.in",
    onUpdate: () => {
      // Spin aggressively
      const angle = spin.t * Math.PI * 10.0;
      const q = new THREE.Quaternion().setFromAxisAngle(spinAxis, angle);
      dice.quaternion.copy(startQuat).multiply(q);
    }
  }, 0.05);

  // Settle: ease into target face quaternion
  const target = poseForFace(face);
  tl.to(
    {},
    {
      duration: 0.6,
      ease: "expo.out",
      onStart: () => {
        // little arc / bounce forward
        gsap.to(dicePivot.position, { z: 0.12, duration: 0.25, ease: "power2.out" });
      },
      onUpdate: () => {
        // slerp toward target smoothly
        dice.quaternion.slerp(target, 0.18);
      }
    },
    0.9
  );

  // Impact beat: tiny shake + bloom flash + UI reveal
  tl.to(camRig.position, { x: "+=0.03", y: "+=0.015", duration: 0.05, yoyo: true, repeat: 3, ease: "power1.inOut" }, 1.35);
  tl.to(bloom, { strength: 1.25, duration: 0.08, ease: "power1.out" }, 1.35);
  tl.to(bloom, { strength: 0.85, duration: 0.35, ease: "power2.out" }, 1.43);

  tl.call(() => {
    elResult.textContent = String(face);
  }, null, 1.4);

  tl.to(camera.position, { z: 4.35, y: 1.05, x: 0.0, duration: 0.6, ease: "power2.out" }, 1.5);
  tl.to(camRig.rotation, { y: 0.0, duration: 0.6, ease: "power2.out" }, 1.5);
  tl.to(dicePivot.position, { z: 0.0, duration: 0.5, ease: "power2.out" }, 1.5);
}

// ---------- Calibration controls ----------
const keyToFace = (() => {
  // mapping keys -> faces (20 keys)
  // 1..0 => 1..10, then QWERTYUIOP => 11..20
  const map = {};
  "1234567890".split("").forEach((k, i) => (map[k] = i + 1));
  "qwertyuiop".split("").forEach((k, i) => (map[k] = i + 11));
  return map;
})();

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();

  if (k === " ") rollD20();
  if (k === "c") {
    calibrationMode = !calibrationMode;
    elMode.textContent = calibrationMode ? "mode: calibrate (arrows + A/D, assign: 1-0 + QWERTYUIOP)" : "mode: roll";
  }
  if (k === "s") {
    if (!dice) return;
    console.log("D20_POSES JSON (paste into main.js):");
    console.log(JSON.stringify(D20_POSES, null, 2));
  }

  if (!dice || !calibrationMode) return;

  // rotate die manually to align a face “up”
  const rotStep = 0.06;
  if (k === "arrowup") dice.rotateX(-rotStep);
  if (k === "arrowdown") dice.rotateX(rotStep);
  if (k === "arrowleft") dice.rotateY(-rotStep);
  if (k === "arrowright") dice.rotateY(rotStep);
  if (k === "a") dice.rotateZ(-rotStep);
  if (k === "d") dice.rotateZ(rotStep);

  // assign face quaternion
  if (k in keyToFace) {
    const face = keyToFace[k];
    D20_POSES[face] = { x: dice.quaternion.x, y: dice.quaternion.y, z: dice.quaternion.z, w: dice.quaternion.w };
    currentFace = face;
    elResult.textContent = `set ${face}`;
  }
});

// ---------- Resize ----------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloom.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Render loop ----------
const clock = new THREE.Clock();
function tick() {
  const dt = clock.getDelta();

  // subtle idle motion
  if (dice && !rolling && !calibrationMode) {
    dicePivot.rotation.y += dt * 0.12;
  }

  composer.render();
  requestAnimationFrame(tick);
}
tick();

// ---------- Helpers ----------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function poseForFace(face) {
  const p = D20_POSES[face];
  if (!p) return new THREE.Quaternion(); // identity fallback
  return new THREE.Quaternion(p.x, p.y, p.z, p.w).normalize();
}

// Default placeholder poses (NOT accurate for your GLB)
function defaultD20Poses() {
  // index 0 unused, 1..20 used
  const poses = Array.from({ length: 21 }, () => null);

  // These are just aesthetically different orientations so “settle” looks real.
  // You MUST calibrate for correct face values on your specific model.
  const base = new THREE.Quaternion();
  const axes = [
    new THREE.Vector3(0,1,0),
    new THREE.Vector3(1,0,0),
    new THREE.Vector3(0,0,1),
    new THREE.Vector3(1,1,0).normalize(),
    new THREE.Vector3(0,1,1).normalize()
  ];

  for (let i = 1; i <= 20; i++) {
    const axis = axes[i % axes.length];
    const q = base.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, i * 0.37));
    poses[i] = { x: q.x, y: q.y, z: q.z, w: q.w };
  }
  return poses;
}
