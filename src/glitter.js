// GPU glitter: 16k flakes whose state lives in a float texture. Each frame a pass moves them with
// the fluid's velocity field (most float in the surface film, some sink in slow flutters); new flakes
// are written with a points pass. Rendered as tiny glinting points after the water, dimmed by the dye
// above them.
import * as THREE from 'three';
import { GLSL_COMMON } from './glsl.js';
import { TUB } from './config.js';

const SIZE = 128;
const N = SIZE * SIZE;

export class Glitter {
  constructor(renderer, fluid) {
    this.r = renderer;
    this.fluid = fluid;
    const gl = renderer.getContext();
    const floatOK = !!gl.getExtension('EXT_color_buffer_float');
    const type = floatOK ? THREE.FloatType : THREE.HalfFloatType;
    const mk = () => new THREE.WebGLRenderTarget(SIZE, SIZE, { type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    this.a = mk(); this.b = mk();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.next = 0;
    this.queue = [];
    this.active = 0;
    // clear
    const prev = renderer.getRenderTarget();
    for (const t of [this.a, this.b]) { renderer.setRenderTarget(t); renderer.setClearColor(0x000000, 0); renderer.clear(); }
    renderer.setRenderTarget(prev);

    // update pass: state = (x, z, depth, type); type 0 = empty
    this.upd = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uState: { value: null }, uVel: { value: null }, uDt: { value: 0 }, uTime: { value: 0 }, uWaterH: { value: 0.33 }, uVortex: { value: fluid.vortex }, uDrain: { value: 0 } },
      vertexShader: 'precision highp float; in vec3 position; in vec2 uv; out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `precision highp float; in vec2 vUv; out vec4 o;
        uniform sampler2D uState, uVel; uniform float uDt, uTime, uWaterH, uDrain; uniform vec4 uVortex;
        ${GLSL_COMMON}
        void main(){
          vec4 s = texture(uState, vUv);
          if (s.w < 0.5) { o = s; return; }
          float id = hash12(vUv * 517.3);
          vec2 v = texture(uVel, domainUV(s.xy)).xy;
          // the surface film carries flakes at full speed; deeper ones lag
          float k = mix(1.0, 0.45, smoothstep(0.0, 0.12, s.z));
          vec2 jit = (vec2(hash12(vUv * 91.7 + uTime), hash12(vUv * 37.1 - uTime)) - 0.5) * 0.004;
          s.xy += (v * k) * uDt + jit * uDt;
          // a third sink in slow flutters, the rest ride the surface
          float sinker = step(0.62, id);
          s.z = clamp(s.z + sinker * (0.004 + 0.003 * sin(uTime * 2.0 + id * 40.0)) * uDt, 0.0, max(uWaterH - 0.004, 0.0));
          // stay inside the tub
          float d = tubDist(s.xy, max(uWaterH - s.z, 0.0));
          if (d > -0.004) {
            float e = 0.003;
            vec2 n = normalize(vec2(tubDist(s.xy + vec2(e, 0), uWaterH) - tubDist(s.xy - vec2(e, 0), uWaterH), tubDist(s.xy + vec2(0, e), uWaterH) - tubDist(s.xy - vec2(0, e), uWaterH)) + 1e-6);
            s.xy -= n * (d + 0.004);
          }
          // the drain swallows them
          if (uDrain > 0.0 && length(s.xy - uVortex.xy) < 0.03) s.w = 0.0;
          if (uWaterH < 0.012) s.w = 0.0;
          o = s;
        }`,
      depthTest: false, depthWrite: false,
    }));
    this.upd.frustumCulled = false;

    // spawn pass: points written at chosen texels
    const MAXSP = 512;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXSP * 3), 3));
    sg.setAttribute('state', new THREE.BufferAttribute(new Float32Array(MAXSP * 4), 4));
    sg.setDrawRange(0, 0);
    this.spawnGeo = sg;
    this.spawnPts = new THREE.Points(sg, new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: 'precision highp float; in vec3 position; in vec4 state; out vec4 vS; void main(){ vS = state; gl_PointSize = 1.0; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'precision highp float; in vec4 vS; out vec4 o; void main(){ o = vS; }',
      depthTest: false, depthWrite: false,
    }));
    this.spawnPts.frustumCulled = false;

    // render points
    const ref = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { ref[i * 2] = ((i % SIZE) + 0.5) / SIZE; ref[i * 2 + 1] = (Math.floor(i / SIZE) + 0.5) / SIZE; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('ref', new THREE.BufferAttribute(ref, 2));
    this.uniforms = {
      uState: { value: null }, uColumn: { value: null }, uDye0: { value: null }, uWaterY: { value: 0.45 }, uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Vector3(3, 3, 3) }, uAmb: { value: new THREE.Vector3(0.6, 0.6, 0.6) },
      uPx: { value: 1 }, uSparkle: { value: 1 },
      uPts: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
      vertexShader: `uniform sampler2D uState, uColumn, uDye0; uniform float uWaterY, uTime, uPx, uSparkle; uniform vec3 uSunDir, uSunCol, uAmb; uniform vec4 uPts[4];
        attribute vec2 ref; varying vec3 vCol; varying float vA;
        ${GLSL_COMMON}
        vec3 hsv2rgb(vec3 c) { vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
        void main(){
          vec4 s = texture2D(uState, ref);
          if (s.w < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
          vec3 wp = vec3(s.x, uWaterY - s.z - 0.0008, s.y);
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mv;
          float id = hash12(ref * 733.1);
          // flake normal tumbles slowly; it glints when it mirrors the light into the eye
          float a1 = id * 50.0 + uTime * (0.6 + id * 1.4), a2 = id * 31.0 + uTime * (0.4 + id);
          vec3 n = normalize(vec3(sin(a1) * 0.6, 1.0, cos(a2) * 0.6) + vec3(0.0, 0.0, 0.0));
          vec3 V = normalize(cameraPosition - wp);
          vec3 Hs = normalize(normalize(uSunDir) + V);
          float g = pow(max(dot(n, Hs), 0.0), 220.0) * 60.0;
          float gp = 0.0;
          for (int i = 0; i < 4; i++) { if (uPts[i].w <= 0.0) continue; vec3 Lp = normalize(uPts[i].xyz - wp); gp += pow(max(dot(n, normalize(Lp + V)), 0.0), 160.0) * uPts[i].w * 40.0; }
          float t = s.w;
          vec3 base = t < 1.5 ? vec3(1.0, 0.72, 0.28) : t < 2.5 ? vec3(0.85, 0.9, 1.0) : t < 3.5 ? hsv2rgb(vec3(fract(id * 7.0 + dot(n, V) * 2.0 + uTime * 0.05), 0.75, 1.0)) : vec3(1.0, 0.62, 0.55);
          vec3 lit = base * (uSunCol * g + vec3(1.0, 0.7, 0.45) * gp + uAmb * 0.35 * uSparkle);
          // hidden under dense dye / deeper water
          vec2 uv = domainUV(s.xy);
          float above = texture2D(uDye0, uv).a * 0.35 + texture2D(uColumn, uv).g * smoothstep(0.0, 0.08, s.z) * 0.8;
          float vis = exp(-above) * exp(-s.z * 6.0);
          vCol = lit * vis * uSparkle;
          vA = 1.0;
          gl_PointSize = clamp(uPx * (1.4 + 1.6 * step(0.985, id)) * (1.6 / -mv.z), 1.0, 4.0);
        }`,
      fragmentShader: `varying vec3 vCol; varying float vA;
        void main(){ vec2 q = gl_PointCoord - 0.5; float r = length(q); float m = smoothstep(0.5, 0.15, r); if (vA <= 0.0 || m <= 0.0) discard; gl_FragColor = vec4(vCol * m, 1.0); }`,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
    this.points.name = 'Glitter';
  }

  // queue flakes: type 1 gold, 2 silver, 3 holo, 4 rose
  spawn(x, z, radius, count, type, depth = 0) {
    for (let i = 0; i < count && this.queue.length < 512; i++) {
      const a = Math.random() * Math.PI * 2, r = radius * Math.sqrt(Math.random());
      this.queue.push([x + Math.cos(a) * r, z + Math.sin(a) * r, depth * Math.random(), type]);
    }
  }

  clear() {
    const prev = this.r.getRenderTarget();
    for (const t of [this.a, this.b]) { this.r.setRenderTarget(t); this.r.setClearColor(0x000000, 0); this.r.clear(); }
    this.r.setRenderTarget(prev);
    this.queue.length = 0;
  }

  step(dt, t) {
    const r = this.r;
    const prev = r.getRenderTarget();
    const ac = r.autoClear; r.autoClear = false;
    const u = this.upd.material.uniforms;
    u.uState.value = this.a.texture; u.uVel.value = this.fluid.vel.read.texture; u.uDt.value = dt; u.uTime.value = t;
    u.uWaterH.value = this.fluid.waterY - TUB.floorY; u.uDrain.value = this.fluid.drainSink;
    r.setRenderTarget(this.b);
    r.render(this.upd, this.cam);
    // spawns
    const n = this.queue.length;
    if (n) {
      const pos = this.spawnGeo.attributes.position.array, st = this.spawnGeo.attributes.state.array;
      for (let i = 0; i < n; i++) {
        const k = this.next; this.next = (this.next + 1) % N;
        const tx = k % SIZE, ty = Math.floor(k / SIZE);
        pos[i * 3] = ((tx + 0.5) / SIZE) * 2 - 1; pos[i * 3 + 1] = ((ty + 0.5) / SIZE) * 2 - 1; pos[i * 3 + 2] = 0;
        const q = this.queue[i];
        st[i * 4] = q[0]; st[i * 4 + 1] = q[1]; st[i * 4 + 2] = q[2]; st[i * 4 + 3] = q[3];
      }
      this.spawnGeo.attributes.position.needsUpdate = true; this.spawnGeo.attributes.state.needsUpdate = true;
      this.spawnGeo.setDrawRange(0, n);
      r.render(this.spawnPts, this.cam);
      this.queue.length = 0;
      this.active = Math.min(N, this.active + n);
    }
    r.autoClear = ac;
    r.setRenderTarget(prev);
    const tmp = this.a; this.a = this.b; this.b = tmp;
    this.uniforms.uState.value = this.a.texture;
  }
}
