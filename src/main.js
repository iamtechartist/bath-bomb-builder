import * as THREE from 'three';
import { Fluid } from './fluid.js';
import { createWater } from './water.js';
import { Post } from './post.js';
import { PlanarReflection } from './reflect.js';
import { Room } from './room.js';
import { CameraRig, SHOTS } from './camera.js';
import { Bomb, R0 } from './bomb.js';
import { Glitter } from './glitter.js';
import { Floaters } from './floaters.js';
import { Steam } from './steam.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { PALETTES, PRESETS, designFromPreset, randomDesign } from './presets.js';
import { WATER_Y, TUB, tubDist } from './config.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

// ---------------------------------------------------------------- quality
const QUALITY = {
  low: { sim: 192, dye: 768, layer: 384, ripple: 256, jacobi: 8, vort: 5, visc: 0.15, pr: 1.0, prMin: 0.6, samples: 0, refl: 0, shadow: 1024 },
  medium: { sim: 256, dye: 1024, layer: 512, ripple: 320, jacobi: 10, vort: 6, visc: 0.15, pr: 1.5, prStart: 1.25, prMin: 0.8, samples: 0, refl: 0, shadow: 1536 },
  high: { sim: 320, dye: 1280, layer: 640, ripple: 384, jacobi: 26, vort: 7, visc: 0.14, pr: 2.0, prMin: 1.0, samples: 4, refl: 0.6, shadow: 2048 },
};
const coarse = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
const qName = params.get('q') || (coarse ? 'low' : 'medium');
const Q = { ...(QUALITY[qName] || QUALITY.medium) };
if (params.has('vort')) Q.vort = Number(params.get('vort'));
if (params.has('visc')) Q.visc = Number(params.get('visc'));

// ---------------------------------------------------------------- scene
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 30);
const rig = new CameraRig(camera);
const room = new Room(scene, renderer, { areaLight: qName === 'high' });
room.sun.shadow.mapSize.set(Q.shadow, Q.shadow);
const fluid = new Fluid(renderer, Q);
const water = createWater(fluid, qName);
scene.add(water.mesh);
const glitter = new Glitter(renderer, fluid);
scene.add(glitter.points);
const floaters = new Floaters(scene, fluid, room);
const steam = new Steam(scene);
const refl = new PlanarReflection(renderer);
refl.scale = Q.refl || 0.5;
const post = new Post(renderer);
const audio = new Audio();

// tap stream for the refill
const streamU = { uTime: { value: 0 }, uAmt: { value: 0 } };
const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0095, 1, 16, 24, true), new THREE.ShaderMaterial({
  uniforms: streamU, transparent: true, depthWrite: false,
  vertexShader: 'uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vW; void main(){ vUv = uv; vec3 p = position; p.xz *= 1.0 + 0.12 * sin(uv.y * 60.0 + uTime * 30.0); vN = normalize(normalMatrix * normal); vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: 'uniform float uTime, uAmt; varying vec2 vUv; varying vec3 vN; varying vec3 vW; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), vec3(0.0,0.0,1.0))), 2.0); float streak = 0.6 + 0.4 * sin(vUv.x * 40.0 + vUv.y * 8.0 - uTime * 25.0); gl_FragColor = vec4(vec3(1.4, 1.45, 1.5) * (0.35 + 0.8 * f * streak), (0.28 + 0.5 * f) * uAmt); }',
}));
stream.visible = false; stream.renderOrder = 15;
scene.add(stream);

// ---------------------------------------------------------------- environment
const pmrem = new THREE.PMREMGenerator(renderer);
const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
const cubeCam = new THREE.CubeCamera(0.05, 30, cubeRT);
let envRT = null;
const bombs = [];
let trayBomb = null;
function captureEnv() {
  const hide = [water.mesh, glitter.points, floaters.bubPts, steam.group, stream, ...bombs.map((b) => b.mesh)];
  if (trayBomb) hide.push(trayBomb.mesh);
  const vis = hide.map((o) => o.visible);
  hide.forEach((o) => { o.visible = false; });
  scene.environment = null;
  cubeCam.position.set(0.1, 1.05, 0.35);
  cubeCam.update(renderer, scene);
  if (envRT) envRT.dispose();
  envRT = pmrem.fromCubemap(cubeRT.texture);
  scene.environment = envRT.texture;
  hide.forEach((o, i) => { o.visible = vis[i]; });
  water.uniforms.uEnv.value = cubeRT.texture;
}

// ---------------------------------------------------------------- state
let design = designFromPreset(PRESETS[0]);
let presetId = PRESETS[0].id;
let mood = params.get('mood') || 'morning';
let trayRespawn = 0;
const drain = { phase: 'idle', t: 0 };
let uiHidden = false;
let stirLevel = 0;
let ui = null;
let introPull = 0;

const ctx = {
  fluid, glitter, floaters,
  onSplash: (b, speed) => { floaters.splash(b.pos.x, b.pos.z, speed); audio.plop(Math.min(1, 0.5 + speed * 0.3)); },
  onRelease: (b) => { floaters.release(b.design.inside, b.pos.x, b.pos.z, PALETTES[b.design.palette].colors); if (b.design.inside !== 'none') audio.pop(2.5); },
  onGone: () => {},
  onBump: (b, v) => audio.bump(v),
};

function dishTop() {
  const d = room.Dish;
  if (!d) return new THREE.Vector3(0.6, 0.631, 0.2);
  const p = new THREE.Vector3(); d.getWorldPosition(p);
  return new THREE.Vector3(p.x, 0.631, p.z);
}
function makeTrayBomb() {
  if (trayBomb) { scene.remove(trayBomb.mesh); trayBomb.dispose(); }
  const b = new Bomb({ ...design, seed: Math.random() * 10 }, ctx);
  const top = dishTop();
  if (b.flat) {
    b.baseQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    b.pos.set(top.x, top.y + R0 * b.halfThick + 0.002, top.z);
  } else {
    b.baseQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.3, 0.2));
    b.pos.set(top.x, top.y + R0 * 0.9, top.z);
  }
  b.quat.copy(b.baseQuat);
  b.u.uSparkle.value = room.M?.sparkle ?? 1;
  scene.add(b.mesh);
  trayBomb = b;
  b.update(0, clock.t, fluid.waterY);
}
function dropAt(x, z) {
  if (!trayBomb || drain.phase !== 'idle') return false;
  const b = trayBomb; trayBomb = null;
  b.quat.copy(b.mesh.quaternion);
  b.launch(x, z, fluid.waterY);
  bombs.push(b);
  // keep at most three fizzing at once
  const live = bombs.filter((o) => o.state === 'floating' || o.state === 'flying');
  if (live.length > 3) live[0].d = Math.max(live[0].d, 0.97);
  trayRespawn = 0.9;
  if (rig.shot === 'tray') rig.go('hero', 1.6);
  audio.tick();
  return true;
}

// ---------------------------------------------------------------- mood
function setMood(name) {
  mood = name;
  room.setMood(name, water.uniforms);
  scene.background = new THREE.Color(room.M.bg);
  scene.environmentIntensity = room.M.envI;
  post.exposure = room.M.exposure;
  glitter.uniforms.uSparkle.value = room.M.sparkle;
  for (const b of [...bombs, trayBomb]) if (b) b.u.uSparkle.value = room.M.sparkle;
  steam.u.uAmt.value = room.M.steam;
  steam.u.uLight.value.set(...(name === 'night' ? [1.0, 0.62, 0.35] : name === 'golden' ? [1.0, 0.8, 0.6] : [1.0, 0.97, 0.93]));
  captureEnv();
  if (ui) { ui.setDark(name === 'night'); ui.setState(design, mood, presetId); }
}

// ---------------------------------------------------------------- thumbnails (real renders of bombs)
const thumbs = (() => {
  const tScene = new THREE.Scene();
  const tCam = new THREE.PerspectiveCamera(26, 1, 0.01, 2);
  tCam.position.set(0.0, 0.05, 0.25); tCam.lookAt(0, 0, 0);
  const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(-0.4, 0.6, 0.6);
  const rim = new THREE.DirectionalLight(0xffffff, 1.2); rim.position.set(0.5, 0.3, -0.5);
  tScene.add(key, rim, new THREE.HemisphereLight(0xffffff, 0xd8cfc4, 0.9));
  const rt = new THREE.WebGLRenderTarget(112, 112, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const cv = document.createElement('canvas'); cv.width = cv.height = 112;
  const c2 = cv.getContext('2d');
  const buf = new Uint8Array(112 * 112 * 4);
  const queue = [];
  let busy = false;
  function render(k, d) {
    const b = new Bomb({ ...d, seed: 2.0 }, { fluid });
    if (b.flat) b.mesh.quaternion.setFromEuler(new THREE.Euler(-0.5, 0.35, 0));
    else b.mesh.quaternion.setFromEuler(new THREE.Euler(0.5, 0.4, 0.1));
    b.mesh.position.set(0, 0, 0); b.mesh.scale.setScalar(R0);
    b.u.uSunDir.value.set(-0.4, 0.6, 0.6).normalize();
    tScene.environment = scene.environment;
    tScene.add(b.mesh);
    const prevT = renderer.getRenderTarget(); const sm = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setRenderTarget(rt); renderer.setClearColor(0xf1ece6, 1); renderer.clear(); renderer.render(tScene, tCam);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.readRenderTargetPixels(rt, 0, 0, 112, 112, buf);
    renderer.setRenderTarget(prevT); renderer.shadowMap.autoUpdate = sm; renderer.setClearColor(0x000000, 0);
    tScene.remove(b.mesh); b.dispose();
    const img = c2.createImageData(112, 112);
    for (let y = 0; y < 112; y++) img.data.set(buf.subarray((111 - y) * 448, (112 - y) * 448), y * 448);
    c2.putImageData(img, 0, 0);
    ui.setThumb(k, cv.toDataURL('image/png'));
  }
  function pump() {
    if (!queue.length) { busy = false; return; }
    busy = true;
    const [k, d] = queue.shift();
    if (!ui.thumbs[k]) render(k, d);
    setTimeout(pump, 30);
  }
  return {
    want(k, d) { if (ui.thumbs[k] || queue.some((q) => q[0] === k)) return; queue.push([k, d]); if (!busy) { busy = true; setTimeout(pump, 50); } },
    refresh() {
      for (const p of PRESETS) this.want('preset:' + p.id, designFromPreset(p));
      for (const s of ['sphere', 'heart', 'star', 'moon']) this.want(`shape:${s}:${design.palette}:${design.pattern}`, { ...design, shape: s });
      for (const p of ['marble', 'ombre', 'stripes', 'speckle', 'galaxy']) this.want(`pattern:${p}:${design.palette}`, { ...design, shape: 'sphere', pattern: p });
    },
  };
})();

// ---------------------------------------------------------------- UI
function designChanged(hint) {
  makeTrayBomb(); audio.tick();
  if (rig.shot !== 'overhead' && !rig.cine) rig.go('tray', 1.8);
  ui.setState(design, mood, presetId); thumbs.refresh(); ui.hint(hint || 'Tap the water to drop it');
}
ui = new UI(document.getElementById('ui'), {
  onPreset(id) { const p = PRESETS.find((q) => q.id === id); if (!p) return; presetId = id; design = designFromPreset(p); designChanged(); },
  onDesign(part) { design = { ...design, ...part }; presetId = null; designChanged(); },
  onMood(m) { audio.tick(); setMood(m); },
  onTab() { audio.tick(); },
  onTool(t) {
    audio.start();
    if (t === 'shuffle') { design = randomDesign(); presetId = null; designChanged('Surprise! Tap the water to drop it'); }
    if (t === 'overhead') toggleOverhead();
    if (t === 'save') savePainting();
    if (t === 'drain') startDrain();
    if (t === 'mute') { audio.setMuted(!audio.muted); ui.setMuted(audio.muted); }
  },
});
ui.setState(design, mood, presetId);

// where the colour is: density-weighted centroid of the probe grid
function colourCentroid() {
  const P = fluid.probe; if (!P.data) return { x: 0, z: 0 };
  let sx = 0, sz = 0, sw = 0;
  for (let j = 0; j < P.h; j++) for (let i = 0; i < P.w; i++) {
    const d = P.data[(j * P.w + i) * 4 + 3]; if (!(d > 0.05)) continue;
    const w = Math.min(d, 4);
    sx += w * ((i + 0.5) / P.w - 0.5) * 2 * 0.775; sz += w * ((j + 0.5) / P.h - 0.5) * 2 * 0.325; sw += w;
  }
  return sw > 0 ? { x: sx / sw, z: sz / sw } : { x: 0, z: 0 };
}
function toggleCinematic() {
  if (rig.cine) { rig.stopCinematic(); ui.toast('Cinematic camera off'); }
  else { rig.startCinematic(colourCentroid()); ui.setActive('overhead', false); ui.toast('Cinematic camera · C to stop'); }
}

function toggleOverhead() {
  if (rig.cine) rig.stopCinematic();
  if (rig.shot === 'overhead') { rig.go('hero', 1.6); ui.setActive('overhead', false); }
  else { rig.go('overhead', 1.4); ui.setActive('overhead', true); }
}

// ---------------------------------------------------------------- save the overhead painting
function savePainting() {
  const Wp = 2400, Hp = 1100;
  const cam = new THREE.PerspectiveCamera(30, Wp / Hp, 0.05, 10);
  const halfW = 0.80, dist = halfW / (Math.tan(THREE.MathUtils.degToRad(15)) * (Wp / Hp));
  cam.position.set(0, fluid.waterY + dist, 0.0001); cam.up.set(0, 0, -1); cam.lookAt(0, fluid.waterY, 0); cam.updateMatrixWorld();
  const tgt = new THREE.WebGLRenderTarget(Wp, Hp); tgt.texture.colorSpace = THREE.SRGBColorSpace;
  const oldW = post.w, oldH = post.h;
  post.setSize(Wp, Hp, Q.samples);
  refl.setSize(Wp, Hp);
  const hideNow = [trayBomb?.mesh, steam.group].filter(Boolean);
  const vis = hideNow.map((m) => m.visible);
  hideNow.forEach((m) => { m.visible = false; });
  const ok = refl.render(scene, cam, fluid.waterY, [water.mesh, glitter.points, floaters.bubPts, steam.group]);
  water.uniforms.uReflOn.value = ok ? 1 : 0; water.uniforms.uReflMat.value.copy(refl.matrix); water.uniforms.uRefl.value = refl.target.texture;
  const fa = post.focus.amount; post.focus.amount = 0;
  post.render(scene, cam, clock.t, { target: tgt });
  post.focus.amount = fa;
  hideNow.forEach((m, i) => { m.visible = vis[i]; });
  const buf = new Uint8Array(Wp * Hp * 4);
  renderer.readRenderTargetPixels(tgt, 0, 0, Wp, Hp, buf);
  tgt.dispose();
  post.setSize(oldW, oldH, Q.samples); refl.setSize(oldW, oldH);
  const cv = document.createElement('canvas'); cv.width = Wp; cv.height = Hp;
  const c2 = cv.getContext('2d'); const img = c2.createImageData(Wp, Hp);
  for (let y = 0; y < Hp; y++) img.data.set(buf.subarray((Hp - 1 - y) * Wp * 4, (Hp - y) * Wp * 4), y * Wp * 4);
  c2.putImageData(img, 0, 0);
  window.__fz.lastSave = cv;
  if (params.has('shot')) return;
  cv.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `fizz-painting-${Date.now()}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
  ui.toast('Painting saved');
}

// ---------------------------------------------------------------- drain + refill
const SPOUT = new THREE.Vector3(-0.64, 0.80, 0.0);
function startDrain() {
  if (drain.phase !== 'idle') return;
  drain.phase = 'drain'; drain.t = 0; ui.setActive('drain', true); ui.hint('Pulling the plug…');
}
const ease = (x) => { x = Math.min(Math.max(x, 0), 1); return x * x * (3 - 2 * x); };
function drainStep(dt) {
  const D = drain;
  if (D.phase === 'idle') return;
  D.t += dt;
  const LOW = TUB.floorY + 0.004;
  if (D.phase === 'drain') {
    const s = ease(D.t / 1.5);
    const lv = ease((D.t - 1.0) / 8.0);
    fluid.waterY = WATER_Y + (LOW - WATER_Y) * lv;
    const depth = fluid.waterY - TUB.floorY;
    fluid.vortex.z = 1.9 * s * Math.min(1, depth / 0.08 + 0.2); fluid.vortex.w = 0.35 * s;
    fluid.drainSink = 0.5 * s;
    water.uniforms.uDip.value.set(TUB.drainX, 0, 0.045 * s * Math.min(1, depth / 0.1), D.t);
    if (D.t > 9.4) { D.phase = 'empty'; D.t = 0; }
  } else if (D.phase === 'empty') {
    fluid.vortex.z = fluid.vortex.w = 0; fluid.drainSink = 0; water.uniforms.uDip.value.z = 0;
    if (D.t > 0.2 && !D.cleared) {
      D.cleared = true;
      fluid.clearAll(); glitter.clear(); floaters.clear();
      for (const b of bombs) { scene.remove(b.mesh); b.dispose(); }
      bombs.length = 0;
    }
    if (D.t > 1.2) { D.phase = 'refill'; D.t = 0; D.cleared = false; ui.hint('Refilling…'); }
  } else if (D.phase === 'refill') {
    const lv = ease(D.t / 7.5);
    fluid.waterY = LOW + (WATER_Y - LOW) * lv;
    const flow = ease(D.t / 0.4) * (1 - ease((D.t - 7.2) / 0.6));
    streamU.uAmt.value = flow;
    stream.visible = flow > 0.01;
    const len = SPOUT.y - fluid.waterY;
    stream.scale.set(1, len, 1); stream.position.set(SPOUT.x, fluid.waterY + len / 2, SPOUT.z);
    if (flow > 0.1) {
      fluid.addRipple(SPOUT.x, SPOUT.z, 0.012, 0.0016 * flow * Math.sin(D.t * 40));
      fluid.addVel(SPOUT.x, SPOUT.z, 0.05, 0, 0, 0.4 * flow, 0.1 * flow);
      fluid.addFoam(SPOUT.x, SPOUT.z, 0.035, 0.8 * flow * dt * 12);
      if (Math.random() < 0.7) floaters.bubble(SPOUT.x + (Math.random() - 0.5) * 0.04, fluid.waterY - Math.random() * 0.06, SPOUT.z + (Math.random() - 0.5) * 0.04, 0.0015 + Math.random() * 0.003, 1, 0, 0.15, 0);
    }
    if (D.t > 8.0) { D.phase = 'idle'; D.t = 0; fluid.waterY = WATER_Y; stream.visible = false; streamU.uAmt.value = 0; ui.setActive('drain', false); ui.hint('Fresh, still water. Tap it to drop a bath bomb'); if (!trayBomb) makeTrayBomb(); }
  }
}

// ---------------------------------------------------------------- input
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitP = new THREE.Vector3();
function waterHit(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  plane.constant = -fluid.waterY;
  if (!ray.ray.intersectPlane(plane, hitP)) return null;
  if (tubDist(hitP.x, hitP.z, fluid.waterY - TUB.floorY) > -0.01) return null;
  if (room.Tray && ray.intersectObject(room.Tray, true).length) return null;
  return hitP.clone();
}
const ptr = { id: -1, mode: '', x: 0, y: 0, t: 0, last: null, lt: 0, moved: 0 };
canvas.addEventListener('pointerdown', (e) => {
  audio.start();
  if (ptr.id !== -1) return;
  canvas.setPointerCapture(e.pointerId);
  ptr.id = e.pointerId; ptr.x = e.clientX; ptr.y = e.clientY; ptr.t = performance.now(); ptr.moved = 0;
  const h = drain.phase === 'idle' || drain.phase === 'drain' ? waterHit(e) : null;
  ptr.mode = h ? 'water' : 'orbit';
  ptr.last = h; ptr.lt = performance.now();
});
canvas.addEventListener('pointermove', (e) => {
  if (ptr.id !== e.pointerId) { if (e.pointerType === 'mouse') canvas.classList.toggle('water', !!waterHit(e)); return; }
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
  ptr.x = e.clientX; ptr.y = e.clientY;
  ptr.moved += Math.abs(dx) + Math.abs(dy);
  if (ptr.mode === 'orbit') { rig.orbit(dx, dy); return; }
  const h = waterHit(e);
  const now = performance.now();
  if (h && ptr.last && ptr.moved > 6) {
    const dt = Math.max((now - ptr.lt) / 1000, 1 / 120);
    let vx = (h.x - ptr.last.x) / dt, vz = (h.z - ptr.last.z) / dt;
    const sp = Math.hypot(vx, vz), mx = 0.6;
    if (sp > mx) { vx *= mx / sp; vz *= mx / sp; }
    // stir along the stroke: several splats between the last and current point
    const n = Math.min(4, 1 + Math.floor(Math.hypot(h.x - ptr.last.x, h.z - ptr.last.z) / 0.015));
    for (let i = 1; i <= n; i++) {
      const x = ptr.last.x + (h.x - ptr.last.x) * i / n, z = ptr.last.z + (h.z - ptr.last.z) * i / n;
      fluid.setVel(x, z, 0.024, vx * 0.85, vz * 0.85, 0.35);
      fluid.addRipple(x, z, 0.01, 0.00035 * Math.min(sp / 0.3, 1.5));
    }
    // nudge floating bombs near the finger
    for (const b of bombs) if (b.state === 'floating' && Math.hypot(b.pos.x - h.x, b.pos.z - h.z) < 0.08) { b.vel.x += vx * 0.08; b.vel.z += vz * 0.08; b.angVel.y += (Math.random() - 0.5) * 2; }
    stirLevel = Math.min(1, stirLevel + sp * 0.4);
  }
  if (h) { ptr.last = h; ptr.lt = now; }
});
function endPtr(e) {
  if (ptr.id !== e.pointerId) return;
  const quick = performance.now() - ptr.t < 350 && ptr.moved < 10;
  if (ptr.mode === 'water' && quick && ptr.last) {
    if (dropAt(ptr.last.x, ptr.last.z)) ui.hint('Drag through the water to stir it');
  }
  ptr.id = -1; ptr.mode = '';
}
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', endPtr);
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'h') { uiHidden = !uiHidden; ui.setHidden(uiHidden); }
  if (k === 'c') toggleCinematic();
  if (k === 'o') toggleOverhead();
  if (k === 'd') startDrain();
  if (k === 'p') savePainting();
  if (k === ' ') { e.preventDefault(); const a = Math.random() * 6.28; dropAt(Math.cos(a) * 0.35 - 0.05, Math.sin(a) * 0.12); }
});

// ---------------------------------------------------------------- sizing + governor
let W = 0, H = 0, PR = Math.min(window.devicePixelRatio || 1, Number(params.get('pr')) || Q.prStart || Q.pr);
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  renderer.setPixelRatio(PR);
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  // portrait screens: widen the lens / back off so the whole tub stays in frame
  const a = W / H;
  SHOTS.hero.fov = a < 1.25 ? Math.min(62, 34 * Math.pow(1.25 / a, 0.9)) : 34;
  // overhead: fit the tub's rim (1.7 x 0.8 m) with a small margin; portrait turns the tub upright
  const tv = Math.tan(THREE.MathUtils.degToRad(17));
  const portrait = a < 1;
  const needW = portrait ? 0.44 : 0.9, needH = portrait ? 0.9 : 0.44;
  SHOTS.overhead.dist = Math.max(needH / tv, needW / (tv * a)) + 0.0;
  SHOTS.overhead.yaw = portrait ? Math.PI / 2 : 0;
  if (rig.shot && SHOTS[rig.shot]) rig.go(rig.shot, rig.k);
  camera.updateProjectionMatrix();
  post.setSize(Math.round(W * PR), Math.round(H * PR), Q.samples);
  refl.setSize(Math.round(W * PR), Math.round(H * PR));
  floaters.bubU.uPx.value = PR;
  glitter.uniforms.uPx.value = PR;
}
window.addEventListener('resize', resize);
const gov = { acc: 0, n: 0, good: 0, auto: !params.has('pr') && !params.has('shot') };
function governor(frameMs) {
  if (!gov.auto || document.hidden) return;
  gov.acc += Math.min(frameMs, 100); gov.n++;
  if (gov.acc < 1500) return;
  const avg = gov.acc / gov.n; gov.acc = 0; gov.n = 0;
  if (avg > 19 && PR > Q.prMin) { PR = Math.max(Q.prMin, PR - 0.15); resize(); gov.good = 0; }
  else if (avg > 19 && !fluidHalf) { fluidHalf = true; gov.good = 0; }
  else if (avg < 13.5) { gov.good++; if (gov.good >= 3 && PR < Math.min(window.devicePixelRatio || 1, Q.pr)) { PR = Math.min(Q.pr, PR + 0.1); resize(); gov.good = 0; } }
}

// ---------------------------------------------------------------- loop
const clock = { t: 0, last: performance.now(), acc: 0 };
let paused = false;
const _sunDir = new THREE.Vector3();
function simStep(dt) {
  const wy = fluid.waterY;
  if (introPull > 0) { introPull -= dt; if (introPull <= 0 && rig.shot === 'intro') rig.go('hero', 0.55); }
  drainStep(dt);
  if (!trayBomb && trayRespawn > 0) { trayRespawn -= dt; if (trayRespawn <= 0 && drain.phase === 'idle') makeTrayBomb(); }
  if (trayBomb) trayBomb.update(dt, clock.t, wy);
  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i];
    b.update(dt, clock.t, wy);
    if (b.state === 'gone') { scene.remove(b.mesh); b.dispose(); bombs.splice(i, 1); }
  }
  const G = window.__fz.gpu && gpuT;
  fluidAcc += dt;
  if (!window.__fz.skipFluid && (!fluidHalf || (simNo++ & 1) === 1)) { fluid.gpuT = G ? gpuT : null; fluid.step(fluidAcc); fluidAcc = 0; G && gpuT.begin('glitter'); glitter.step(dt, clock.t); G && gpuT.end(); }
  floaters.update(dt, clock.t, (x, z) => { fluid.addRipple(x, z, 0.003, 0.00008); });
  room.update(clock.t, dt);
  stirLevel *= Math.exp(-dt * 4);
  const fizz = bombs.reduce((s, b) => s + (b.state === 'floating' ? b.fizz * b.s : 0), 0);
  audio.update(dt, { fizz, stir: stirLevel, drain: drain.phase === 'drain' ? Math.min(1, drain.t / 1.5) * (fluid.waterY - TUB.floorY > 0.01 ? 1 : 0) : 0, pour: drain.phase === 'refill' ? streamU.uAmt.value : 0 });
}
function render(dt = 1 / 60) {
  rig.update(dt);
  water.update(clock.t);
  water.mesh.visible = !window.__fz.hideWater && fluid.waterY - TUB.floorY > 0.006;
  streamU.uTime.value = clock.t;
  _sunDir.copy(room.sun.position).sub(room.sun.target.position).normalize();
  water.uniforms.uSunDir.value.copy(_sunDir);
  const gu = glitter.uniforms;
  gu.uSunDir.value.copy(_sunDir); gu.uSunCol.value.copy(water.uniforms.uSunCol.value); gu.uAmb.value.copy(water.uniforms.uSkyCol.value);
  gu.uColumn.value = fluid.column.texture; gu.uDye0.value = fluid.dye0.read.texture; gu.uWaterY.value = fluid.waterY; gu.uTime.value = clock.t;
  floaters.bubU.uDye0.value = fluid.dye0.read.texture;
  steam.u.uSunDir.value.copy(_sunDir);
  steam.update(clock.t, fluid.waterY, water.mesh.visible);
  for (const b of bombs) b.u.uSunDir.value.copy(_sunDir);
  if (trayBomb) trayBomb.u.uSunDir.value.copy(_sunDir);
  for (let i = 0; i < 4; i++) {
    const f = room.flames[i];
    const on = f && f.light.intensity > 0.05 && mood !== 'morning';
    if (on) { water.uniforms.uPts.value[i].set(f.light.position.x, f.light.position.y, f.light.position.z, f.light.intensity); water.uniforms.uPtCol.value[i].set(1.0, 0.55, 0.22); gu.uPts.value[i].copy(water.uniforms.uPts.value[i]); }
    else { water.uniforms.uPts.value[i].w = 0; gu.uPts.value[i].w = 0; }
  }
  const sm = room.sun.shadow.map;
  if (sm && sm.depthTexture && room.sun.visible) { water.uniforms.uShadow.value = sm.depthTexture; water.uniforms.uShadowMat.value.copy(room.sun.shadow.matrix); water.uniforms.uShadowOn.value = 1; }
  else water.uniforms.uShadowOn.value = 0;
  const G = window.__fz.gpu && gpuT;
  if (G) gpuT.poll();
  if (Q.refl) {
    G && gpuT.begin('reflection');
    const ok = refl.render(scene, camera, fluid.waterY, [water.mesh, glitter.points, floaters.bubPts, steam.group]);
    G && gpuT.end();
    water.uniforms.uReflOn.value = ok ? 1 : 0;
    water.uniforms.uRefl.value = refl.target.texture;
    water.uniforms.uReflMat.value.copy(refl.matrix);
  }
  if (G && window.__fz.gpuWaterAB) {
    // A/B: the scene pass with and without the water
    gpuT.begin('sceneNoWater'); water.mesh.visible = false; renderer.setRenderTarget(post.scene); renderer.clear(); renderer.render(scene, camera); water.mesh.visible = true; gpuT.end();
  }
  post.gpuT = G ? gpuT : null;
  // the shadow map only needs refreshing every other frame (props are still; bombs move slowly)
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = (frameNo++ & 1) === 0 || params.has('shot');
  post.focus.dist = rig.distance();
  post.focus.range = rig.shot === 'tray' ? 0.12 : 0.35;
  post.focus.amount = rig.shot === 'overhead' || window.__fz.noBlur ? 0 : 1;
  post.render(scene, camera, clock.t);
}
let lastFrame = performance.now();
let frameNo = 0, simNo = 0, fluidAcc = 0, fluidHalf = qName === 'low';
function frame(now) {
  const dt = Math.min(0.05, (now - clock.last) / 1000);
  clock.last = now;
  governor(now - lastFrame); lastFrame = now;
  if (!paused) {
    // one simulation step per rendered frame (variable, clamped dt): a slow frame never triggers
    // extra catch-up simulations, so there is no spiral of death on slower GPUs
    const h = Math.min(Math.max(dt, 1 / 144), 1 / 30);
    simStep(h); clock.t += h;
  }
  if (!window.__fz.noloop) render(dt);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
async function boot() {
  resize();
  setMood(mood);
  ui.setDark(mood === 'night');
  const ok = await Promise.race([room.loadProps('assets/props.glb'), new Promise((r) => setTimeout(() => r(false), 8000))]);
  if (ok) { captureEnv(); floaters.setDuckSource(room.duckToy); }
  // intro: the Galaxy bomb drops straight into the still tub
  if (params.get('intro') !== '0') {
    const intro = designFromPreset(PRESETS[0]);
    const b = new Bomb(intro, ctx);
    scene.add(b.mesh); bombs.push(b);
    b.dropFrom(-0.06, WATER_Y + 0.42, 0.03, -1.2);
    b.u.uSparkle.value = room.M.sparkle;
    // open close on the impact, then drift back to the room
    rig.go('intro'); rig.snap(); introPull = 2.6;
  } else rig.snap();
  try { await renderer.compileAsync(scene, camera); } catch (e) { /* older drivers */ }
  clock.last = performance.now();
  window.__fz.ready = true;
  requestAnimationFrame(frame);
  document.getElementById('loader')?.classList.add('gone');
  setTimeout(() => { makeTrayBomb(); thumbs.refresh(); }, params.has('shot') ? 0 : 1200);
}

// ---------------------------------------------------------------- debug / capture hooks
// stage timing (debug): forces the GPU to finish between stages
function profileFrame() {
  const T = {}; let t = performance.now(); const px = new Uint8Array(4);
  const syncRT = profileFrame.rt || (profileFrame.rt = new THREE.WebGLRenderTarget(1, 1));
  const sync = () => { const prev = renderer.getRenderTarget(); renderer.setRenderTarget(syncRT); renderer.clear(); renderer.readRenderTargetPixels(syncRT, 0, 0, 1, 1, px); renderer.setRenderTarget(prev); };
  const mark = (k) => { sync(); const n = performance.now(); T[k] = +(n - t).toFixed(2); t = n; };
  mark('start');
  for (let i = 0; i < bombs.length; i++) bombs[i].update(1 / 60, clock.t, fluid.waterY);
  fluid.step(1 / 60); mark('fluid');
  glitter.step(1 / 60, clock.t); mark('glitter');
  floaters.update(1 / 60, clock.t); mark('floaters');
  rig.update(1 / 60); water.update(clock.t);
  if (Q.refl) { refl.render(scene, camera, fluid.waterY, [water.mesh, glitter.points, floaters.bubPts, steam.group]); } mark('reflection');
  const r = renderer; r.setRenderTarget(post.scene); r.clear(); r.render(scene, camera); mark('scene');
  water.mesh.visible = false; r.setRenderTarget(post.scene); r.clear(); r.render(scene, camera); water.mesh.visible = true; mark('sceneNoWater');
  post.render(scene, camera, clock.t); mark('post+scene');
  return T;
}

// GPU timer queries (EXT_disjoint_timer_query_webgl2): async per-stage GPU milliseconds
const gpuT = (() => {
  const gl = renderer.getContext(); const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;
  const pending = []; const acc = {}; let cur = null;
  return {
    begin(k) { if (cur) return; const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); cur = [k, q]; },
    end() { if (!cur) return; gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(cur); cur = null; },
    poll() {
      for (let i = pending.length - 1; i >= 0; i--) {
        const [k, q] = pending[i];
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT)) {
          const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
          (acc[k] ||= []).push(ms); gl.deleteQuery(q); pending.splice(i, 1);
        }
      }
    },
    report() { const o = {}; for (const [k, v] of Object.entries(acc)) { const s = v.slice(-30); o[k] = +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2); } return o; },
    reset() { for (const k in acc) delete acc[k]; },
  };
})();

window.__fz = {
  gpuT,
  profileFrame,
  THREE, renderer, scene, camera, rig, fluid, water, post, room, bombs, glitter, floaters, audio, ui, Q, clock, ready: false,
  play(sec) { const h = 1 / 60; for (let i = 0; i < Math.round(sec * 60); i++) { simStep(h); clock.t += h; rig.update(h); } render(0); return +clock.t.toFixed(2); },
  advance(sec) { const h = 1 / 60; for (let i = 0; i < Math.round(sec * 60); i++) { simStep(h); clock.t += h; } rig.snap(); render(); return +clock.t.toFixed(2); },
  pause(v = true) { paused = v; },
  render: () => render(),
  setFluidHalf(v) { fluidHalf = v; },
  setMood, dropAt, startDrain, savePainting, toggleOverhead, toggleCinematic, colourCentroid,
  get tray() { return trayBomb; },
  get drain() { return drain; },
  preset(id) { ui.h.onPreset(id); },
  design(p) { ui.h.onDesign(p); },
  shot(name) { rig.go(name); rig.snap(); render(); },
  view(name) { this.shot(name === 'top' ? 'overhead' : name); },
  stir(x0, z0, x1, z1, steps = 20) { for (let i = 0; i < steps; i++) { const x = x0 + (x1 - x0) * i / steps, z = z0 + (z1 - z0) * i / steps; fluid.setVel(x, z, 0.024, (x1 - x0) * 2, (z1 - z0) * 2, 0.35); fluid.addRipple(x, z, 0.01, 0.0004); simStep(1 / 60); clock.t += 1 / 60; } render(); },
  stats() {
    const out = {};
    for (const [k, t] of Object.entries({ vel: fluid.vel.read, dye0: fluid.dye0.read, l1: fluid.layers[0].read, foam: fluid.foam.read })) {
      const buf = new Uint16Array(t.width * t.height * 4);
      renderer.readRenderTargetPixels(t, 0, 0, t.width, t.height, buf);
      const mx = [-1e9, -1e9, -1e9, -1e9]; let nan = 0;
      for (let i = 0; i < buf.length; i++) { const v = THREE.DataUtils.fromHalfFloat(buf[i]); if (!isFinite(v)) { nan++; continue; } const c = i % 4; if (v > mx[c]) mx[c] = v; }
      out[k] = { max: mx.map((v) => +v.toFixed(3)), nan };
    }
    return out;
  },
};
boot();
