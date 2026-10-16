// The bath bomb: pressed-powder look with its pattern, fizz physics on the water, layered dye
// emission (the colour field at the dissolving surface goes into the water), crumble and release.
import * as THREE from 'three';
import { meshShape } from './shapes.js';
import { weights, PATTERNS, GLSL_PATTERN } from './pattern.js';
import { PALETTES, GLITTER } from './presets.js';
import { tubDist, TUB } from './config.js';

const R0 = 0.05;           // bomb radius (m): a 10 cm jumbo bomb
const DISSOLVE_S = 28;     // seconds to fully dissolve at full fizz
const geoCache = {};
export function shapeGeometry(shape) { return geoCache[shape] || (geoCache[shape] = meshShape(shape)); }

export function linColor(hex) { const c = new THREE.Color(hex); return new THREE.Vector3(c.r, c.g, c.b); }

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _p = [0, 0, 0], _w = [0, 0, 0], _c = [0, 0, 0];

function makeMaterial(design) {
  const pal = PALETTES[design.palette].colors;
  const gl = GLITTER[design.glitter];
  const uniforms = {
    uC1: { value: linColor(pal[0]) }, uC2: { value: linColor(pal[1]) }, uC3: { value: linColor(pal[2]) },
    uPattern: { value: PATTERNS.indexOf(design.pattern) }, uSeed: { value: design.seed || 0 },
    uScale: { value: 1 }, uErode: { value: 0 }, uWaterY: { value: -10 }, uWetAll: { value: 0 },
    uGlitter: { value: gl.color ? 1 : 0 }, uHolo: { value: gl.color === 'holo' ? 1 : 0 },
    uGlitterCol: { value: gl.color && gl.color !== 'holo' ? linColor(gl.color) : new THREE.Vector3(1, 1, 1) },
    uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSparkle: { value: 1 },
  };
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uScale, uErode, uTime;
        varying vec3 vUnit; varying vec3 vWPos;
        ${GLSL_PATTERN}`)
      .replace('#include <begin_vertex>', `
        vUnit = position;
        // crumble: the dissolving surface pits and erodes unevenly
        float ero = uErode * (0.06 + 0.14 * smoothstep(0.3, 0.8, pNoise3(position * 4.0 + 3.1)) + 0.025 * pNoise3(position * 11.0));
        vec3 transformed = position * (1.0 - ero);`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uC1, uC2, uC3, uGlitterCol, uSunDir;
        uniform int uPattern; uniform float uSeed, uScale, uErode, uWaterY, uWetAll, uGlitter, uHolo, uTime, uSparkle;
        varying vec3 vUnit; varying vec3 vWPos;
        ${GLSL_PATTERN}
        vec3 hsv2rgb(vec3 c) { vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
        float gWet; vec3 gSparkle;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 pu = vUnit * uScale;
          vec3 w = bombWeights(pu, uPattern, uSeed);
          vec3 col = w.x * uC1 + w.y * uC2 + w.z * uC3;
          // pressed powder: fine grain, tiny darker specks and paler crumbs
          float g1 = pNoise3(vUnit * 70.0), g2 = pNoise3(vUnit * 190.0 + 4.0);
          col *= 0.86 + 0.16 * g1 + 0.06 * g2;
          col = mix(col, col * 0.55, smoothstep(0.82, 0.9, g2) * 0.6);
          col = mix(col, mix(col, vec3(1.0), 0.35), smoothstep(0.78, 0.86, pNoise3(vUnit * 33.0 + 9.0)) * 0.5);
          // wet where it sits in the water (and a fresh wet sheen after the splash)
          float wl = uWaterY + 0.003 + 0.002 * sin(atan(vWPos.z, vWPos.x) * 9.0 + uTime * 6.0);
          gWet = max(smoothstep(wl + 0.004, wl - 0.004, vWPos.y), uWetAll);
          col = mix(col, pow(col, vec3(1.35)) * 0.85, gWet);
          // glitter flakes pressed into the surface
          gSparkle = vec3(0.0);
          if (uGlitter > 0.5) {
            vec3 cp = vUnit * 46.0;
            vec3 ci = floor(cp);
            float h = pHash13(ci + 0.5);
            vec3 fo = fract(cp) - 0.5;
            float flake = step(0.55, h) * smoothstep(0.32, 0.2, length(fo));
            vec3 fn = normalize(vec3(pHash13(ci + 1.7), pHash13(ci + 2.9), pHash13(ci + 5.3)) - 0.5);
            vec3 V = normalize(cameraPosition - vWPos);
            vec3 Hh = normalize(normalize(uSunDir) + V);
            float sp = pow(max(dot(fn, Hh), 0.0), 60.0) + 0.04;
            vec3 gc = uHolo > 0.5 ? hsv2rgb(vec3(fract(h * 7.0 + dot(fn, V) * 1.5), 0.6, 1.0)) : uGlitterCol;
            gSparkle = gc * sp * flake * 5.0 * uSparkle;
            col = mix(col, gc * 0.7, flake * 0.55);
          }
          diffuseColor.rgb = col;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.93, 0.38, gWet);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // chalky micro-relief: bump from noise derivatives
          vec3 pp = vUnit * 55.0;
          float e = 0.6;
          float n0 = pNoise3(pp);
          vec3 gr = vec3(pNoise3(pp + vec3(e, 0, 0)) - n0, pNoise3(pp + vec3(0, e, 0)) - n0, pNoise3(pp + vec3(0, 0, e)) - n0);
          vec3 gv = (viewMatrix * vec4(gr, 0.0)).xyz;
          normal = normalize(normal - gv * (0.9 + uErode * 0.8));
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += gSparkle;`);
  };
  m.customProgramCacheKey = () => 'fizzbomb';
  m.userData.uniforms = uniforms;
  return m;
}

export class Bomb {
  constructor(design, ctx) {
    this.design = { ...design };
    this.ctx = ctx;
    this.geo = shapeGeometry(design.shape);
    this.mat = makeMaterial(design);
    this.u = this.mat.userData.uniforms;
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.castShadow = true;
    this.mesh.scale.setScalar(R0);
    this.state = 'tray';
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();
    this.d = 0;            // dissolve 0..1
    this.s = 1;            // remaining size
    this.fizz = 0;
    this.age = 0;
    this.jets = [];
    this.spinBias = (Math.random() < 0.5 ? -1 : 1) * (1.6 + Math.random() * 1.6);
    this.spinTimer = 2 + Math.random() * 3;
    this.released = false;
    this.flat = design.shape !== 'sphere';
    this.halfThick = this.geo.userData.halfThick || 1;
    this.emitted = [0, 0, 0];
    this.pal = PALETTES[design.palette].colors.map(linColor);
    this.trayT = 0;
    this.wet = 0;
    const pal = PALETTES[design.palette].colors;
    this.glitterCol = GLITTER[design.glitter].color;
    this.glitterType = { none: 0, gold: 1, silver: 2, holo: 3, rose: 4 }[design.glitter] || 0;
  }

  // throw from the current position to land on the water at (x, z)
  launch(x, z, waterY) {
    this.state = 'flying';
    const T = 0.62;
    const g = 9.81;
    const target = new THREE.Vector3(x, waterY + 0.01, z);
    this.vel.set((target.x - this.pos.x) / T, 0, (target.z - this.pos.z) / T);
    this.vel.y = (target.y - this.pos.y + 0.5 * g * T * T) / T;
    this.angVel.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6);
    this.flightT = 0;
  }

  // an intro drop straight down from above
  dropFrom(x, y, z, vy = -1.5) {
    this.state = 'flying';
    this.pos.set(x, y, z);
    this.vel.set(0, vy, 0);
    this.angVel.set(1.5, 2.5, -1.0);
    this.flightT = 0;
  }

  update(dt, t, waterY) {
    this.age += dt;
    const u = this.u;
    u.uTime.value = t;
    u.uWaterY.value = this.state === 'tray' || this.state === 'flying' ? -10 : waterY;
    if (this.state === 'tray') {
      this.trayT += dt;
      _q.setFromAxisAngle(_v.set(0, 1, 0), this.trayT * 0.6);
      this.mesh.quaternion.copy(this.baseQuat || _q.identity()).premultiply(_q);
      const pop = Math.min(1, this.trayT / 0.45);
      const sc = R0 * (pop < 1 ? 0.6 + 0.4 * (1 - Math.pow(1 - pop, 3)) * (1 + 0.12 * Math.sin(pop * Math.PI)) : 1);
      this.mesh.scale.setScalar(sc);
      this.mesh.position.copy(this.pos);
      return;
    }
    if (this.state === 'flying') {
      this.flightT += dt;
      this.vel.y -= 9.81 * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.integrateRot(dt);
      const bottom = this.pos.y - R0 * this.extentY();
      if (bottom <= waterY && this.vel.y < 0) this.splash(waterY);
      this.sync();
      return;
    }
    if (this.state === 'gone') return;
    this.floatStep(dt, t, waterY);
    this.sync();
  }

  extentY() {
    // vertical half-extent in world for the current orientation (unit units)
    if (!this.flat) return 0.92;
    _v.set(0, 0, 1).applyQuaternion(this.quat);
    const up = Math.abs(_v.y);
    return this.halfThick * up + 0.85 * (1 - up);
  }

  splash(waterY) {
    this.state = 'floating';
    const speed = -this.vel.y;
    this.impact = speed;
    this.vel.y *= 0.25;
    this.vel.x *= 0.3; this.vel.z *= 0.3;
    this.wet = 1;
    this.ctx.onSplash?.(this, speed);
    const f = this.ctx.fluid;
    const x = this.pos.x, z = this.pos.z;
    // the plop: a deep ring + an outward rush that kicks the first colour out
    f.addRipple(x, z, 0.03, -0.006 * Math.min(speed, 3));
    f.addRipple(x, z, 0.012, 0.004 * Math.min(speed, 3));
    f.addVel(x, z, 0.06, 0, 0, 2.5 * Math.min(speed, 3), 0);
    const sp = Math.min(speed, 3);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
      const rr = R0 * (1.05 + Math.random() * 0.4);
      this.colorAt(a, 1, _w); this.sharpen(_w); this.mixCol(_w, _c);
      f.addDye(x + Math.cos(a) * rr, z + Math.sin(a) * rr, 0.012, _c[0], _c[1], _c[2], 6.5, 0.1, 0);
      if (i % 2 === 0) f.addVel(x + Math.cos(a) * rr * 1.4, z + Math.sin(a) * rr * 1.4, 0.016, Math.cos(a) * 2.2 * sp, Math.sin(a) * 2.2 * sp);
    }
    _w[0] = this.avgW(0); _w[1] = this.avgW(1); _w[2] = this.avgW(2); this.mixCol(_w, _c);
    f.addDye(x, z, 0.05, _c[0], _c[1], _c[2], 5.0, 0.2, 1);
    f.addDye(x, z, 0.04, _c[0], _c[1], _c[2], 3.0, 0.1, 2);
    f.addFoam(x, z, 0.055, 0.8);
  }

  sharpen(w) { let a = w[0] ** 3, b = w[1] ** 3, c = w[2] ** 3; const s = a + b + c || 1; w[0] = a / s; w[1] = b / s; w[2] = c / s; return w; }
  mixCol(w, out) { const P = this.pal; out[0] = w[0] * P[0].x + w[1] * P[1].x + w[2] * P[2].x; out[1] = w[0] * P[0].y + w[1] * P[1].y + w[2] * P[2].y; out[2] = w[0] * P[0].z + w[1] * P[1].z + w[2] * P[2].z; return out; }

  avgW(k) { this.colorAt(0, 1, _w); const a = _w[k]; this.colorAt(2.1, 1, _w); const b = _w[k]; this.colorAt(4.2, 1, _w); return (a + b + _w[k]) / 3; }

  // colour weights of the bomb's surface at world bearing `a` (around the waterline)
  colorAt(a, depthFrac, out) {
    _v.set(Math.cos(a), -0.15, Math.sin(a)).normalize();
    _qi.copy(this.quat).invert();
    _v.applyQuaternion(_qi);
    // shapes are thinner along z: project the direction onto the shape's surface roughly
    const sc = this.s * 0.97;
    _p[0] = _v.x * sc; _p[1] = _v.y * sc; _p[2] = _v.z * sc * (this.flat ? this.halfThick : 1);
    return weights(_p, this.design.pattern, this.design.seed || 0, out);
  }

  integrateRot(dt) {
    const w = this.angVel;
    const ang = w.length() * dt;
    if (ang > 1e-6) { _q.setFromAxisAngle(_v.copy(w).normalize(), ang); this.quat.premultiply(_q); this.quat.normalize(); }
  }

  floatStep(dt, t, waterY) {
    const f = this.ctx.fluid;
    const R = R0 * this.s;
    // --- fizz intensity and dissolving
    const ramp = Math.min(1, this.age / 0.35);
    const late = 1 - THREE.MathUtils.smoothstep(this.d, 0.8, 1.0) * 0.7;
    this.fizz = ramp * (0.85 + 0.15 * Math.sin(t * 3.1 + this.spinBias)) * late;
    this.boost = 1 + 1.4 * Math.exp(-this.age / 2.6);
    this.d = Math.min(1, this.d + dt * this.fizz / DISSOLVE_S * (1 + (1 - this.s) * 0.6));
    this.s = Math.max(0.0, Math.cbrt(1 - this.d));
    if (!this.released && this.d > 0.68) { this.released = true; this.ctx.onRelease?.(this); }
    if (this.d >= 1 || this.s < 0.12) { this.state = 'gone'; this.mesh.visible = false; this.ctx.onGone?.(this); return; }

    // --- vertical: buoyancy spring toward the floating depth, heavy damping in water
    const ext = R0 * this.extentY() * this.s;
    const yEq = waterY + ext * 0.12;
    const ay = 38 * (yEq - this.pos.y) - 5.5 * this.vel.y;
    this.vel.y += ay * dt;
    this.pos.y += this.vel.y * dt;

    // --- horizontal: fizz jets, water drag toward the local flow, wall bounces
    this.spinTimer -= dt;
    if (this.spinTimer < 0) { this.spinTimer = 2.5 + Math.random() * 4; this.spinBias = (Math.random() < 0.7 ? Math.sign(this.spinBias) : -Math.sign(this.spinBias)) * (1.3 + Math.random() * 2.0); }
    if (Math.random() < dt * 3.2 * this.fizz) {
      this.jets.push({ a: Math.random() * Math.PI * 2, life: 0.35 + Math.random() * 0.9, mag: 0.05 + Math.random() * 0.1, tang: (Math.random() - 0.5) * 1.2 });
    }
    let ax = 0, az = 0, spinAcc = 0;
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i];
      j.life -= dt;
      if (j.life <= 0) { this.jets.splice(i, 1); continue; }
      const dx = Math.cos(j.a), dz = Math.sin(j.a);
      // the jet blows water out at bearing a; the reaction pushes the bomb the other way (+ a sideways kick)
      const fx = -(dx - dz * j.tang * 0.4) * j.mag * this.fizz, fz = -(dz + dx * j.tang * 0.4) * j.mag * this.fizz;
      ax += fx; az += fz;
      spinAcc += j.tang * j.mag * 40 * this.fizz;
      f.addVel(this.pos.x + dx * R * 1.25, this.pos.z + dz * R * 1.25, 0.016, dx * 0.7 * this.fizz * this.boost, dz * 0.7 * this.fizz * this.boost);
    }
    this.wander = (this.wander ?? Math.random() * 6.28) + (Math.random() - 0.5) * dt * 1.6;
    ax += Math.cos(this.wander) * 0.06 * this.fizz; az += Math.sin(this.wander) * 0.035 * this.fizz;
    const flow = f.sample(this.pos.x, this.pos.z, this._s || (this._s = {}));
    const drag = 2.0;
    ax += drag * (flow.vx * 0.6 - this.vel.x);
    az += drag * (flow.vz * 0.6 - this.vel.z);
    this.vel.x += ax * dt; this.vel.z += az * dt;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    // walls (interior outline at the waterline)
    const h = waterY - TUB.floorY;
    const d = tubDist(this.pos.x, this.pos.z, h) + R * 0.95;
    if (d > 0) {
      const e = 0.003;
      let nx = tubDist(this.pos.x + e, this.pos.z, h) - tubDist(this.pos.x - e, this.pos.z, h);
      let nz = tubDist(this.pos.x, this.pos.z + e, h) - tubDist(this.pos.x, this.pos.z - e, h);
      const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      this.pos.x -= nx * d; this.pos.z -= nz * d;
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn > 0) {
        this.vel.x -= 1.4 * vn * nx; this.vel.z -= 1.4 * vn * nz;
        this.angVel.y += (this.vel.x * nz - this.vel.z * nx) * 25;
        this.wander = Math.atan2(-nz, -nx) + (Math.random() - 0.5) * 1.6;
        if (vn > 0.015) { this.ctx.onBump?.(this, vn); f.addRipple(this.pos.x + nx * R, this.pos.z + nz * R, 0.012, 0.0012 * Math.min(vn * 20, 1)); }
      }
    }

    // --- rotation: spin bias + jet torques, wobble, and (for flat shapes) settle face-up
    const wy = this.angVel.y;
    this.angVel.y += ((this.spinBias * this.fizz - wy) * 0.9 + spinAcc) * dt;
    this.angVel.x += ((Math.random() - 0.5) * 9 * this.fizz - this.angVel.x * 2.5) * dt;
    this.angVel.z += ((Math.random() - 0.5) * 9 * this.fizz - this.angVel.z * 2.5) * dt;
    if (this.flat) {
      _v.set(0, 0, 1).applyQuaternion(this.quat);
      const s = _v.y >= 0 ? 1 : -1;
      // torque that turns the face normal toward vertical
      const tx = _v.z * s, tz = -_v.x * s;
      this.angVel.x += tx * 30 * dt; this.angVel.z += tz * 30 * dt;
      this.angVel.x *= Math.exp(-dt * 3); this.angVel.z *= Math.exp(-dt * 3);
    } else {
      // rolling from asymmetric fizz shows the pattern turning
      this.angVel.x += Math.sin(t * 0.7 + this.spinBias) * 0.6 * dt * this.fizz;
    }
    this.integrateRot(dt);

    // --- emission into the water
    this.emit(dt, t, waterY, R);
    this.wet = Math.max(0, this.wet - dt * 0.15);
  }

  emit(dt, t, waterY, R) {
    const f = this.ctx.fluid;
    const x = this.pos.x, z = this.pos.z, F = this.fizz;
    const area = this.s * this.s;
    const N = 10;
    const amt = F * dt * 126 * area * (1.25 - 0.35 * this.d) * this.boost;
    const rw = R * 1.02;
    const ph = this.age * 0.15;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + ph;
      this.colorAt(a, 1, _w);
      // the water shows the bomb's colours as distinct ribbons: sharpen toward the dominant colour
      this.sharpen(_w); this.mixCol(_w, _c);
      f.addDye(x + Math.cos(a) * rw, z + Math.sin(a) * rw, 0.0078 * (0.6 + 0.4 * this.s), _c[0], _c[1], _c[2], amt, amt * 0.012, 0);
      this.emitted[0] += _w[0] * amt; this.emitted[1] += _w[1] * amt; this.emitted[2] += _w[2] * amt;
    }
    // the colour cloud that sinks under the bomb (from its underside)
    this.colorAt(0, 1, _w);
    _v.set(0, -1, 0).applyQuaternion(_qi.copy(this.quat).invert());
    _p[0] = _v.x * this.s * 0.8; _p[1] = _v.y * this.s * 0.8; _p[2] = _v.z * this.s * 0.8;
    weights(_p, this.design.pattern, this.design.seed || 0, _w);
    const ca = F * dt * 26 * area;
    this.mixCol(_w, _c);
    f.addDye(x, z, 0.022, _c[0], _c[1], _c[2], ca, ca * 0.04, 1);
    // the fizz pushes water outward and drags it along with the moving bomb
    f.addVel(x, z, R * 1.8, 0, 0, 0.2 * F, 0.06 * F * Math.sign(this.angVel.y));
    f.setVel(x, z, R * 1.1, this.vel.x, this.vel.z, 0.12);
    // glitter pressed into the powder washes out with the fizz
    if (this.glitterType && this.ctx.glitter) this.ctx.glitter.spawn(x, z, R * 1.3, Math.round(9 * F * (0.6 + 0.4 * this.s)), this.glitterType, 0.01);
    // bubbles streaming up from the bomb's underside
    const fl = this.ctx.floaters;
    if (fl) for (let i = 0; i < 3; i++) if (Math.random() < F) {
      const a = Math.random() * Math.PI * 2, rr = R * Math.random() * 0.9;
      fl.bubble(x + Math.cos(a) * rr, waterY - R * (0.3 + Math.random() * 0.7) - Math.random() * 0.02, z + Math.sin(a) * rr, 0.0009 + Math.random() * 0.0022, 1, 0, 0.1 + Math.random() * 0.1, 0);
    }
    // froth ring + lasting foam
    f.addFoam(x, z, R * 1.08, F * dt * 5.5);
    // bobbing ripples + fizz pops
    f.addRipple(x, z, R * 0.9, -this.vel.y * dt * 0.08);
    if (Math.random() < 0.6 * F) {
      const a = Math.random() * Math.PI * 2, rr = R * (1.1 + Math.random() * 0.8);
      f.addRipple(x + Math.cos(a) * rr, z + Math.sin(a) * rr, 0.003, 0.00012 * F);
    }
  }

  sync() {
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.quat);
    this.mesh.scale.setScalar(R0 * this.s);
    this.u.uScale.value = this.s;
    this.u.uErode.value = this.state === 'floating' ? Math.min(1, this.d * 1.6 + 0.08) : 0;
    this.u.uWetAll.value = this.wet * 0.5;
  }

  dispose() { this.mat.dispose(); }
}

export { R0 };
