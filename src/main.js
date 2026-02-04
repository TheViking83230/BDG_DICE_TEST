import "./style.css";

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { gsap } from "gsap";

// ---------- UI ----------
const elResult = document.getElementById("result");
const elMode = document.getElementById("mode");

// ---------- Renderer ----------
const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false, // IMPORTANT: fond opaque (sinon tu te manges le blanc si le CSS foire)
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.setClearColor(0x05060a, 1); // fond sombre sûr

// ---------- Scene ----------
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05060a, 0.06);

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0.0, 1.15, 5.2);

const camRig = new THREE.Group();
camRig.add(camera);
scene.add(camRig);

// ---------- Lights ----------
scene.add(new THREE.AmbientLight(0x2b2f3d, 0.35));

const key = new THREE.DirectionalLight(0xffd7a8, 2.2);
key.position.set(2.0, 3.0, 2.2);
scene.add(key);

const fill = new THREE.DirectionalLight(0xa8c8ff, 0.7);
fill.position.set(-2.5, 1.2, 2.0);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffcc6a, 1.8);
rim.position.set(0.0, 2.2, -3.5);
scene.add(rim);

const bounce = new THREE.PointLight(0x5e83ff, 0.35, 12);
bounce.position.set(0, -1.2, 1.5);
scene.add(bounce);

// ---------- Postprocessing ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.75,
  0.55,
  0.18
);
composer.addPass(bloom);

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset: { value: 1.05 },
    darkness: { value: 1.25 },
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
  `,
};
composer.addPass(new ShaderPass(VignetteShader));

// ---------- Dice ----------
let dice = null;
const dicePivot = new THREE.Group();
scene.add(dicePivot);
dicePivot.position.set(0, -0.1, 0);

let rolling = false;

// DEBUG: si le GLB charge pas, on met un cube pour prouver que le rendu marche
function addDebugCube() {
  const geo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xd6b35d, metalness: 0.7, roughness: 0.25 });
  const cube = new THREE.Mesh(geo, mat);
  dicePivot.add(cube);
  dice = cube;
  elResult.textContent = "GLB?";
}

const loader = new GLTFLoader();

loadDice().catch((err) => {
  console.error("❌ GLB load failed:", err);
  addDebugCube();
});

async function loadDice() {
  // IMPORTANT: le fichier doit être exactement: public/models/d20.glb
  const gltf = await loader.loadAsync("/models/d20.glb");

  dice = gltf.scene;

  dice.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
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
  const target = 1.35;
  const s = target / (maxDim || 1);
  dice.scale.setScalar(s);

  // Center
  const center = new THREE.Vector3();
  box.getCenter(center);
  dice.position.sub(center.multiplyScalar(s));

  dicePivot.add(dice);

  dicePivot.position.set(0.0, -0.05, 0.0);
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

function roll() {
  if (!dice || rolling) return;
  rolling = true;

  const face = 1 + Math.floor(Math.random() * 20);
  elResult.textContent = "—";

  const tl = gsap.timeline({
    defaults: { ease: "power2.out" },
    onComplete: () => (rolling = false),
  });

  tl.to(bloom, { strength: 1.05, duration: 0.15, ease: "power1.out" }, 0);

  tl.to(camera.position, { z: 4.1, y: 1.0, x: 0.08, duration: 0.55 }, 0);
  tl.to(camRig.rotation, { y: -0.06, duration: 0.55 }, 0);

  const spin = { t: 0 };
  const startQuat = dice.quaternion.clone();
  const spinAxis = new THREE.Vector3(0.25, 1.0, 0.35).normalize();

  tl.to(
    spin,
    {
      t: 1,
      duration: 0.85,
      ease: "power1.in",
      onUpdate: () => {
        const angle = spin.t * Math.PI * 10.0;
        const q = new THREE.Quaternion().setFromAxisAngle(spinAxis, angle);
        dice.quaternion.copy(startQuat).multiply(q);
      },
    },
    0.05
  );

  // settle "fake" (just slows down)
  tl.to(
    {},
    {
      duration: 0.6,
      ease: "expo.out",
      onUpdate: () => {
        dice.quaternion.slerp(startQuat, 0.08);
      },
    },
    0.9
  );

  tl.to(camRig.position, { x: "+=0.03", y: "+=0.015", duration: 0.05, yoyo: true, repeat: 3 }, 1.35);
  tl.to(bloom, { strength: 1.25, duration: 0.08 }, 1.35);
  tl.to(bloom, { strength: 0.85, duration: 0.35 }, 1.43);

  tl.call(() => {
    elResult.textContent = String(face);
  }, null, 1.4);

  tl.to(camera.position, { z: 4.35, y: 1.05, x: 0.0, duration: 0.6 }, 1.5);
  tl.to(camRig.rotation, { y: 0.0, duration: 0.6 }, 1.5);
}

window.addEventListe
