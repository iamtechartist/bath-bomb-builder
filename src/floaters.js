// Things that float, sink, rise and splash: petals, lavender buds, gold leaf, confetti, the toy duck
// (instanced, carried by the fluid's surface flow and turned by its curl), plus rising fizz bubbles
// and splash droplets (points drawn after the water).
import * as THREE from 'three';
import { tubDist, TUB } from './config.js';
import { GLSL_COMMON } from './glsl.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);

function petalGeometry() {
  // a cupped rose petal: rounded heart-ish outline, curled up at the edges
  const g = new THREE.PlaneGeometry(1, 1, 10, 10);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i);
    const t = y + 0.5;                                  // 0 base → 1 tip
    const w = Math.sin(Math.min(1, t * 1.1) * Math.PI * 0.92) * (0.55 + 0.45 * t) * 0.62;
    x *= w * 2;
    const cup = (x * x) * 1.1 + (1 - t) * 0.12;          // edges curl up, base dips
    p.setXYZ(i, x * 0.6, cup * 0.18, (t - 0.45) * 0.8);
  }
  g.computeVertexNormals();
  return g;
}
function leafGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 6, 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const crinkle = (Math.sin(x * 17 + y * 5) * 0.5 + Math.sin(y * 21 - x * 3) * 0.5) * 0.035 + (Math.random() - 0.5) * 0.03;
    p.setXYZ(i, x + (Math.random() - 0.5) * 0.06, crinkle, y + (Math.random() - 0.5) * 0.06);
  }
  g.computeVertexNormals();
  return g;
}

export class Floaters {
  constructor(scene, fluid, room) {
    this.scene = scene; this.fluid = fluid; this.room = room;
    this.items = [];
    this.groups = {};
    const mk = (name, geo, mat, max) => {
      const im = new THREE.InstancedMesh(geo, mat, max);
      im.count = 0; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(im);
      this.groups[name] = { im, max, list: [] };
      return im;
    };
    const petalMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.45, sheen: 1.0, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xffc0d0), side: THREE.DoubleSide, emissive: 0x200008 });
    mk('petals', petalGeometry(), petalMat, 90);
    const budMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const bud = new THREE.SphereGeometry(1, 8, 6); bud.scale(0.35, 0.35, 1);
    mk('lavender', bud, budMat, 220);
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xffc35a, metalness: 1, roughness: 0.18, side: THREE.DoubleSide });
    mk('goldleaf', leafGeometry(), goldMat, 120);
    const confMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide });
    const disc = new THREE.CircleGeometry(1, 14); disc.rotateX(-Math.PI / 2);
    mk('confetti', disc, confMat, 260);
    this.duck = null;
    this.ducks = [];

    // rising bubbles + splash droplets (points)
    const NB = 600;
    this.bub = { n: NB, pos: new Float32Array(NB * 3), vel: new Float32Array(NB * 3), size: new Float32Array(NB), life: new Float32Array(NB), kind: new Float32Array(NB), next: 0 };
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(this.bub.pos, 3).setUsage(THREE.DynamicDrawUsage));
    bg.setAttribute('size', new THREE.BufferAttribute(this.bub.size, 1).setUsage(THREE.DynamicDrawUsage));
    bg.setAttribute('kind', new THREE.BufferAttribute(this.bub.kind, 1).setUsage(THREE.DynamicDrawUsage));
    this.bubU = { uWaterY: { value: 0.45 }, uPx: { value: 1 }, uLight: { value: new THREE.Vector3(1, 1, 1) }, uDye0: { value: null } };
    this.bubPts = new THREE.Points(bg, new THREE.ShaderMaterial({
      uniforms: this.bubU, transparent: true, depthWrite: false, blending: THREE.NormalBlending,
      vertexShader: `uniform float uWaterY, uPx; uniform sampler2D uDye0; attribute float size; attribute float kind; varying float vK; varying float vVis;
        ${GLSL_COMMON}
        void main(){ vK = kind; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          float under = max(uWaterY - position.y, 0.0);
          vVis = kind > 1.5 ? 1.0 : exp(-texture2D(uDye0, domainUV(position.xz)).a * 0.5 * step(0.002, under)) * exp(-under * 10.0);
          gl_PointSize = size <= 0.0 ? 0.0 : clamp(size * uPx * 260.0 / -mv.z, 1.0, 26.0); }`,
      fragmentShader: `uniform vec3 uLight; varying float vK; varying float vVis;
        void main(){ vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0; if (r > 1.0) discard;
          float rim = smoothstep(0.55, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
          float hi = smoothstep(0.32, 0.0, length(q - vec2(-0.16, -0.16)));
          if (vK > 1.5) { // droplet: clear bead with a bright rim and highlight
            gl_FragColor = vec4(uLight * (0.55 * rim + 1.6 * hi + 0.06), (0.35 * rim + 0.9 * hi + 0.12)); return; }
          gl_FragColor = vec4(uLight * (0.9 * rim + 1.4 * hi), (0.75 * rim + 0.8 * hi) * vVis); }`,
    }));
    this.bubPts.frustumCulled = false;
    this.bubPts.renderOrder = 13;
    scene.add(this.bubPts);
    this._smp = {};
  }

  setDuckSource(obj) { this.duckSrc = obj; }

  // --- spawns
  release(kind, x, z, palette) {
    const y0 = this.fluid.waterY;
    if (kind === 'petals') for (let i = 0; i < 24; i++) this.add('petals', x, z, rnd(0.008, 0.05), { color: new THREE.Color().setHSL(rnd(0.95, 1.0), rnd(0.65, 0.85), rnd(0.42, 0.58)), size: rnd(0.026, 0.038), out: rnd(0.04, 0.12) });
    if (kind === 'lavender') for (let i = 0; i < 60; i++) this.add('lavender', x, z, rnd(0.005, 0.05), { color: new THREE.Color().setHSL(rnd(0.72, 0.77), rnd(0.45, 0.6), rnd(0.55, 0.68)), size: rnd(0.0042, 0.006), out: rnd(0.03, 0.14) });
    if (kind === 'goldleaf') for (let i = 0; i < 38; i++) this.add('goldleaf', x, z, rnd(0.01, 0.05), { color: new THREE.Color(0xffffff), size: rnd(0.008, 0.02), out: rnd(0.03, 0.11), sink: Math.random() < 0.35 });
    if (kind === 'confetti') {
      const cols = (palette || []).map((c) => new THREE.Color(c)).concat([new THREE.Color(0xffffff), new THREE.Color(0xffd36b)]);
      for (let i = 0; i < 90; i++) this.add('confetti', x, z, rnd(0.005, 0.04), { color: cols[i % cols.length].clone(), size: rnd(0.0045, 0.0075), out: rnd(0.08, 0.3), pop: true });
    }
    if (kind === 'duck' && this.duckSrc) {
      const d = this.duckSrc.clone(true);
      d.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      d.scale.setScalar(0.62);
      this.scene.add(d);
      const it = { kind: 'duck', obj: d, x, z, vx: 0, vz: 0, y: y0 - 0.08, vy: 0.9, yaw: rnd(0, 6.28), wy: rnd(-1, 1), age: 0, size: 0.04 };
      this.ducks.push(it);
      this.fluid.addRipple(x, z, 0.03, 0.004);
    }
  }

  add(kind, x, z, r0, o) {
    const G = this.groups[kind];
    if (G.list.length >= G.max) G.list.shift();
    const a = Math.random() * Math.PI * 2;
    const it = {
      kind, x: x + Math.cos(a) * r0, z: z + Math.sin(a) * r0, vx: Math.cos(a) * o.out, vz: Math.sin(a) * o.out,
      y: o.pop ? 0.03 + Math.random() * 0.05 : 0, vy: o.pop ? rnd(0.3, 0.9) : 0,
      yaw: rnd(0, 6.28), wy: rnd(-2, 2), tilt: rnd(-0.25, 0.25), tilt2: rnd(-0.25, 0.25), size: o.size, color: o.color,
      sink: !!o.sink, depth: 0, age: 0, airborne: !!o.pop,
    };
    G.list.push(it);
  }

  clear() {
    for (const G of Object.values(this.groups)) G.list.length = 0;
    for (const d of this.ducks) this.scene.remove(d.obj);
    this.ducks.length = 0;
    this.bub.life.fill(0); this.bub.size.fill(0);
  }

  bubble(x, y, z, size = 0.002, kind = 1, vx = 0, vy = 0.12, vz = 0) {
    const B = this.bub; const i = B.next; B.next = (B.next + 1) % B.n;
    B.pos[i * 3] = x; B.pos[i * 3 + 1] = y; B.pos[i * 3 + 2] = z;
    B.vel[i * 3] = vx; B.vel[i * 3 + 1] = vy; B.vel[i * 3 + 2] = vz;
    B.size[i] = size; B.life[i] = kind > 1.5 ? 1.2 : 4; B.kind[i] = kind;
  }

  splash(x, z, speed) {
    const y = this.fluid.waterY;
    const n = Math.floor(36 + speed * 16);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rnd(0.25, 0.9) * Math.min(speed, 2.6) * 0.7;
      const up = rnd(0.6, 1.4) * Math.min(speed, 2.6) * 0.75;
      this.bubble(x + Math.cos(a) * 0.04, y + 0.005, z + Math.sin(a) * 0.04, rnd(0.0015, 0.0042), 2, Math.cos(a) * s, up, Math.sin(a) * s);
    }
    // an air pocket of bubbles dragged down with the bomb
    for (let i = 0; i < 40; i++) this.bubble(x + rnd(-0.04, 0.04), y - rnd(0.01, 0.08), z + rnd(-0.04, 0.04), rnd(0.0012, 0.004), 1, 0, rnd(0.1, 0.25), 0);
  }

  update(dt, t, onPop) {
    const f = this.fluid, wy = f.waterY, h = wy - TUB.floorY;
    const S = this._smp;
    const drain = f.drainSink > 0;
    for (const [kind, G] of Object.entries(this.groups)) {
      const L = G.list;
      for (let i = L.length - 1; i >= 0; i--) {
        const it = L[i];
        it.age += dt;
        f.sample(it.x, it.z, S);
        if (it.airborne) {
          it.vy -= 9.81 * dt; it.y += it.vy * dt; it.x += it.vx * dt; it.z += it.vz * dt;
          it.yaw += it.wy * 3 * dt; it.tilt += dt * 4;
          if (it.y <= 0 && it.vy < 0) { it.airborne = false; it.y = 0; it.vy = 0; it.tilt = rnd(-0.1, 0.1); }
        } else {
          // carried by the surface flow, turned by its curl
          const k = 2.2;
          it.vx += (S.vx * 1.05 - it.vx) * k * dt; it.vz += (S.vz * 1.05 - it.vz) * k * dt;
          it.x += it.vx * dt; it.z += it.vz * dt;
          const e = 0.02; const a1 = f.sample(it.x + e, it.z, {}), a2 = f.sample(it.x, it.z + e, {});
          const curl = ((a1.vz - S.vz) - (a2.vx - S.vx)) / e;
          it.wy += (curl * 0.5 - it.wy) * 1.5 * dt;
          it.yaw += it.wy * dt;
          it.y = S.h * 0.01 * 0.6; // bob on ripples (probe h is in cm)
          if (it.sink) { it.depth = Math.min(h - 0.01, it.depth + dt * 0.01 * (0.5 + 0.5 * Math.sin(t + i))); it.y = -it.depth; it.tilt = Math.sin(t * 1.3 + i) * 0.5; }
        }
        // walls
        const d = tubDist(it.x, it.z, Math.max(h, 0.01)) + it.size;
        if (d > 0) {
          const ee = 0.003;
          let nx = tubDist(it.x + ee, it.z, h) - tubDist(it.x - ee, it.z, h), nz = tubDist(it.x, it.z + ee, h) - tubDist(it.x, it.z - ee, h);
          const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
          it.x -= nx * d; it.z -= nz * d;
          const vn = it.vx * nx + it.vz * nz; if (vn > 0) { it.vx -= vn * nx * 1.5; it.vz -= vn * nz * 1.5; }
        }
        if (drain && Math.hypot(it.x - f.vortex.x, it.z - f.vortex.y) < 0.03) { L.splice(i, 1); continue; }
        if (h < 0.01) { L.splice(i, 1); continue; }
      }
      // write instances
      const im = G.im;
      im.count = L.length;
      for (let i = 0; i < L.length; i++) {
        const it = L[i];
        _e.set(it.tilt, it.yaw, it.tilt2 || 0, 'YXZ'); _q.setFromEuler(_e);
        _s.setScalar(it.size);
        if (kind === 'lavender') { _e.set(Math.PI / 2 + it.tilt * 0.2, it.yaw, 0, 'YXZ'); _q.setFromEuler(_e); }
        _p.set(it.x, wy + it.y + (kind === 'lavender' ? it.size * 0.2 : 0.0012), it.z);
        _m.compose(_p, _q, _s);
        im.setMatrixAt(i, _m);
        if (it.color) im.setColorAt(i, it.color);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    // the toy duck pops up and bobs
    for (let i = this.ducks.length - 1; i >= 0; i--) {
      const d = this.ducks[i];
      d.age += dt;
      f.sample(d.x, d.z, S);
      d.vx += (S.vx * 0.8 - d.vx) * 1.5 * dt; d.vz += (S.vz * 0.8 - d.vz) * 1.5 * dt;
      d.x += d.vx * dt; d.z += d.vz * dt;
      const yEq = wy - 0.006;
      d.vy += (40 * (yEq - d.y) - 3.2 * d.vy) * dt;
      d.y += d.vy * dt;
      d.wy += (-d.wy * 0.5) * dt; d.yaw += d.wy * dt;
      const dd = tubDist(d.x, d.z, Math.max(h, 0.01)) + 0.035;
      if (dd > 0) { const e = 0.003; let nx = tubDist(d.x + e, d.z, h) - tubDist(d.x - e, d.z, h), nz = tubDist(d.x, d.z + e, h) - tubDist(d.x, d.z - e, h); const nl = Math.hypot(nx, nz) || 1; d.x -= nx / nl * dd; d.z -= nz / nl * dd; d.vx *= -0.3; d.vz *= -0.3; }
      const rock = Math.sin(d.age * 2.3) * 0.06 * Math.exp(-d.age * 0.15) + Math.sin(d.age * 1.1) * 0.025;
      d.obj.position.set(d.x, d.y, d.z);
      d.obj.rotation.set(rock, d.yaw, rock * 0.6);
      if (h < 0.02) { d.y = TUB.floorY; }
    }
    // bubbles + droplets
    const B = this.bub;
    for (let i = 0; i < B.n; i++) {
      if (B.life[i] <= 0) continue;
      B.life[i] -= dt;
      const k = B.kind[i];
      if (k > 1.5) {
        B.vel[i * 3 + 1] -= 9.81 * dt;
        B.pos[i * 3] += B.vel[i * 3] * dt; B.pos[i * 3 + 1] += B.vel[i * 3 + 1] * dt; B.pos[i * 3 + 2] += B.vel[i * 3 + 2] * dt;
        if (B.pos[i * 3 + 1] < wy && B.vel[i * 3 + 1] < 0) { B.life[i] = 0; B.size[i] = 0; f.addRipple(B.pos[i * 3], B.pos[i * 3 + 2], 0.004, 0.0002); }
      } else {
        f.sample(B.pos[i * 3], B.pos[i * 3 + 2], S);
        B.pos[i * 3] += (S.vx * 0.5 + (Math.random() - 0.5) * 0.03) * dt;
        B.pos[i * 3 + 2] += (S.vz * 0.5 + (Math.random() - 0.5) * 0.03) * dt;
        B.pos[i * 3 + 1] += B.vel[i * 3 + 1] * dt * (0.8 + B.size[i] * 120);
        if (B.pos[i * 3 + 1] >= wy - 0.001) { B.life[i] = 0; B.size[i] = 0; onPop?.(B.pos[i * 3], B.pos[i * 3 + 2]); }
      }
      if (B.life[i] <= 0) B.size[i] = 0;
    }
    this.bubPts.geometry.attributes.position.needsUpdate = true;
    this.bubPts.geometry.attributes.size.needsUpdate = true;
    this.bubPts.geometry.attributes.kind.needsUpdate = true;
    this.bubU.uWaterY.value = wy;
  }
}
