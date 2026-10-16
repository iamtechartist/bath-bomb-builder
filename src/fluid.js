// GPU stable-fluids on the bath water surface (WebGL2, half-float render targets).
//  - velocity (world m/s) on a sim grid, vorticity confinement, Jacobi pressure, free-slip tub walls
//  - dye: a high-res surface film (MacCormack) + three deeper, softer layers that receive dye
//    sinking from above in billowing plumes (fakes the volume)
//  - foam (persistent lacy foam + short-lived fizz froth), surface ripples (wave equation)
//  - a tiny probe target read back asynchronously for CPU floaters
import * as THREE from 'three';
import { GLSL_COMMON, GLSL_MIX } from './glsl.js';
import { DOMAIN, TUB, WATER_Y } from './config.js';

const MAXS = 40;

const VERT = /* glsl */`
precision highp float;
in vec3 position; in vec2 uv;
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function rt(w, h, opts = {}) {
  const t = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false, ...opts,
  });
  t.texture.generateMipmaps = false;
  return t;
}
class Double {
  constructor(w, h) { this.a = rt(w, h); this.b = rt(w, h); this.w = w; this.h = h; }
  get read() { return this.a; } get write() { return this.b; }
  swap() { const t = this.a; this.a = this.b; this.b = t; }
  dispose() { this.a.dispose(); this.b.dispose(); }
}

const HEAD = /* glsl */`
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform float uWaterH;   // current water height above the tub floor
uniform vec2 uTexel;     // 1/size of the target
${GLSL_COMMON}
float inside(vec2 uv) { return tubDist(domainXZ(uv), uWaterH) < 0.0 ? 1.0 : 0.0; }
`;

export class Fluid {
  constructor(renderer, q) {
    this.r = renderer;
    this.q = q;
    this.time = 0;
    this.waterY = WATER_Y;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.velSplats = []; this.dyeSplats = []; this.foamSplats = []; this.rippleSplats = [];
    this.bombs = [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0)];
    this.vortex = new THREE.Vector4(TUB.drainX, 0, 0, 0); // x, z, swirl, inflow
    this.drainSink = 0;
    this.ambient = 1;
    this.probe = { w: 48, h: 20, data: null, pending: false, frame: 0 };
    this.alloc(q);
    this.buildPasses();
  }

  alloc(q) {
    const sw = q.sim, sh = Math.round(q.sim * DOMAIN.z / DOMAIN.x);
    const dw = q.dye, dh = Math.round(q.dye * DOMAIN.z / DOMAIN.x);
    const lw = q.layer, lh = Math.round(q.layer * DOMAIN.z / DOMAIN.x);
    const rw = q.ripple, rh = Math.round(q.ripple * DOMAIN.z / DOMAIN.x);
    this.size = { sw, sh, dw, dh, lw, lh, rw, rh };
    this.vel = new Double(sw, sh);
    this.pres = new Double(sw, sh);
    this.div = rt(sw, sh);
    this.curl = rt(sw, sh);
    this.dye0 = new Double(dw, dh);
    this.dyeTmp = rt(dw, dh);
    this.layers = [new Double(lw, lh), new Double(lw, lh), new Double(lw, lh)];
    this.foam = new Double(lw, lh);
    this.ripple = new Double(rw, rh);
    this.column = rt(lw, lh);
    this.haze = rt(32, 14);
    this.tint = rt(lw, lh);
    this.mean = rt(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.probeRT = rt(this.probe.w, this.probe.h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.probe.buf = new Uint16Array(this.probe.w * this.probe.h * 4);
    this.clearAll();
  }

  clearAll() {
    const r = this.r;
    const prev = r.getRenderTarget();
    const cc = r.getClearColor(new THREE.Color()); const ca = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const t of [this.vel.a, this.vel.b, this.pres.a, this.pres.b, this.div, this.curl, this.dye0.a, this.dye0.b, this.dyeTmp,
      ...this.layers.flatMap((l) => [l.a, l.b]), this.foam.a, this.foam.b, this.ripple.a, this.ripple.b, this.column, this.tint, this.probeRT, this.haze, this.mean]) {
      r.setRenderTarget(t); r.clear(true, false, false);
    }
    r.setRenderTarget(prev);
    r.setClearColor(cc, ca);
  }

  mat(frag, uniforms = {}) {
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: HEAD + frag,
      uniforms: { uWaterH: { value: 0.33 }, uTexel: { value: new THREE.Vector2() }, ...uniforms },
      depthTest: false, depthWrite: false,
    });
  }

  buildPasses() {
    const S = this.size;
    const v4 = (n) => Array.from({ length: n }, () => new THREE.Vector4());
    const sim = { uDX: { value: new THREE.Vector2(2 * DOMAIN.x / S.sw, 2 * DOMAIN.z / S.sh) } };

    // --- velocity splats + ambient circulation + drain vortex
    this.pSplatVel = this.mat(/* glsl */`
      uniform sampler2D uVel; uniform vec4 uS[${MAXS}]; uniform vec4 uF[${MAXS}]; uniform int uN;
      uniform float uDt, uTime, uAmb; uniform vec4 uVortex;
      float n2(vec2 q) { return vnoise(q) * 0.65 + vnoise(q * 2.07 + 11.3) * 0.35; }
      vec2 psiGrad(vec2 p, float t) {
        float e = 0.02;
        vec2 o = vec2(t * 0.05, -t * 0.04);
        float a = n2(p * 3.0 + o), bx = n2((p + vec2(e, 0.0)) * 3.0 + o), bz = n2((p + vec2(0.0, e)) * 3.0 + o);
        return vec2(bz - a, -(bx - a)) / e; // curl of a stream function
      }
      void main() {
        vec2 v = texture(uVel, vUv).xy;
        vec2 p = domainXZ(vUv);
        for (int i = 0; i < ${MAXS}; i++) {
          if (i >= uN) break;
          vec2 d = p - uS[i].xy;
          float g = exp(-dot(d, d) / (uS[i].z * uS[i].z));
          vec2 rad = d / max(length(d), 1e-4);
          if (uS[i].w < 0.5) v += g * uDt * (uF[i].xy + rad * uF[i].z + vec2(-rad.y, rad.x) * uF[i].w);
          else v = mix(v, uF[i].xy, clamp(g * uF[i].z, 0.0, 1.0));
        }
        v += uDt * uAmb * 0.0035 * psiGrad(p, uTime);
        if (uVortex.z != 0.0 || uVortex.w != 0.0) {
          vec2 d = p - uVortex.xy; float r = length(d) + 0.01;
          vec2 t = vec2(-d.y, d.x) / r;
          float fall = exp(-r * 3.2);
          v += uDt * (t * uVortex.z * fall / (r * 3.0 + 0.15) - d / r * uVortex.w * fall);
        }
        outColor = vec4(v, 0.0, 1.0);
      }`, { uVel: { value: null }, uS: { value: v4(MAXS) }, uF: { value: v4(MAXS) }, uN: { value: 0 }, uDt: { value: 0 }, uTime: { value: 0 }, uAmb: { value: 1 }, uVortex: { value: new THREE.Vector4() } });

    this.pCurl = this.mat(/* glsl */`
      uniform sampler2D uVel; uniform vec2 uDX;
      void main() {
        float L = texture(uVel, vUv - vec2(uTexel.x, 0)).y, R = texture(uVel, vUv + vec2(uTexel.x, 0)).y;
        float B = texture(uVel, vUv - vec2(0, uTexel.y)).x, T = texture(uVel, vUv + vec2(0, uTexel.y)).x;
        outColor = vec4((R - L) / (2.0 * uDX.x) - (T - B) / (2.0 * uDX.y), 0, 0, 1);
      }`, { uVel: { value: null }, ...sim });

    this.pVort = this.mat(/* glsl */`
      uniform sampler2D uVel, uCurl; uniform float uDt, uEps; uniform vec2 uDX;
      void main() {
        float L = abs(texture(uCurl, vUv - vec2(uTexel.x, 0)).x), R = abs(texture(uCurl, vUv + vec2(uTexel.x, 0)).x);
        float B = abs(texture(uCurl, vUv - vec2(0, uTexel.y)).x), T = abs(texture(uCurl, vUv + vec2(0, uTexel.y)).x);
        float C = texture(uCurl, vUv).x;
        vec2 g = vec2((R - L) / uDX.x, (T - B) / uDX.y) * 0.5;
        vec2 N = g / (length(g) + 1e-3);
        vec2 f = uEps * uDX.x * vec2(N.y, -N.x) * C;
        vec2 v = texture(uVel, vUv).xy + f * uDt;
        outColor = vec4(v, 0, 1);
      }`, { uVel: { value: null }, uCurl: { value: null }, uDt: { value: 0 }, uEps: { value: 0 }, ...sim });

    this.pDiv = this.mat(/* glsl */`
      uniform sampler2D uVel; uniform vec2 uDX;
      vec2 vAt(vec2 uv) { return inside(uv) > 0.5 ? texture(uVel, uv).xy : vec2(0.0); }
      void main() {
        float L = vAt(vUv - vec2(uTexel.x, 0)).x, R = vAt(vUv + vec2(uTexel.x, 0)).x;
        float B = vAt(vUv - vec2(0, uTexel.y)).y, T = vAt(vUv + vec2(0, uTexel.y)).y;
        outColor = vec4((R - L) / (2.0 * uDX.x) + (T - B) / (2.0 * uDX.y), 0, 0, 1);
      }`, { uVel: { value: null }, ...sim });

    this.pScale = this.mat(/* glsl */`
      uniform sampler2D uSrc; uniform float uK;
      void main() { outColor = texture(uSrc, vUv) * uK; }`, { uSrc: { value: null }, uK: { value: 0.8 } });

    this.pJacobi = this.mat(/* glsl */`
      uniform sampler2D uP, uDiv; uniform vec2 uDX;
      void main() {
        float C = texture(uP, vUv).x;
        vec2 ul = vUv - vec2(uTexel.x, 0), ur = vUv + vec2(uTexel.x, 0), ub = vUv - vec2(0, uTexel.y), ut = vUv + vec2(0, uTexel.y);
        float L = inside(ul) > 0.5 ? texture(uP, ul).x : C;
        float R = inside(ur) > 0.5 ? texture(uP, ur).x : C;
        float B = inside(ub) > 0.5 ? texture(uP, ub).x : C;
        float T = inside(ut) > 0.5 ? texture(uP, ut).x : C;
        float d = texture(uDiv, vUv).x;
        float ax = 1.0 / (uDX.x * uDX.x), az = 1.0 / (uDX.y * uDX.y);
        outColor = vec4(((L + R) * ax + (B + T) * az - d) / (2.0 * ax + 2.0 * az), 0, 0, 1);
      }`, { uP: { value: null }, uDiv: { value: null }, ...sim });

    this.pGrad = this.mat(/* glsl */`
      uniform sampler2D uP, uVel; uniform vec2 uDX;
      void main() {
        float C = texture(uP, vUv).x;
        vec2 ul = vUv - vec2(uTexel.x, 0), ur = vUv + vec2(uTexel.x, 0), ub = vUv - vec2(0, uTexel.y), ut = vUv + vec2(0, uTexel.y);
        float L = inside(ul) > 0.5 ? texture(uP, ul).x : C;
        float R = inside(ur) > 0.5 ? texture(uP, ur).x : C;
        float B = inside(ub) > 0.5 ? texture(uP, ub).x : C;
        float T = inside(ut) > 0.5 ? texture(uP, ut).x : C;
        vec2 v = texture(uVel, vUv).xy - vec2((R - L) / (2.0 * uDX.x), (T - B) / (2.0 * uDX.y));
        // free-slip walls: remove the outward normal component close to the wall, zero outside
        vec2 p = domainXZ(vUv);
        float d = tubDist(p, uWaterH);
        if (d > 0.0) v = vec2(0.0);
        else if (d > -0.012) {
          float e = 0.004;
          vec2 n = normalize(vec2(tubDist(p + vec2(e, 0), uWaterH) - tubDist(p - vec2(e, 0), uWaterH),
                                  tubDist(p + vec2(0, e), uWaterH) - tubDist(p - vec2(0, e), uWaterH)) + 1e-6);
          float vn = dot(v, n);
          if (vn > 0.0) v -= n * vn * smoothstep(-0.012, -0.002, d);
        }
        outColor = vec4(v, 0, 1);
      }`, { uP: { value: null }, uVel: { value: null }, ...sim });

    this.pAdvVel = this.mat(/* glsl */`
      uniform sampler2D uVel; uniform float uDt, uDiss, uVisc;
      void main() {
        vec2 v = texture(uVel, vUv).xy;
        vec2 uv = vUv - uDt * v / (2.0 * DOMAIN);
        vec2 nv = texture(uVel, uv).xy;
        // a touch of viscosity: kills the grid-scale (checkerboard) mode that shreds the dye into mazes
        vec2 nb = texture(uVel, uv + vec2(uTexel.x, 0)).xy + texture(uVel, uv - vec2(uTexel.x, 0)).xy + texture(uVel, uv + vec2(0, uTexel.y)).xy + texture(uVel, uv - vec2(0, uTexel.y)).xy;
        nv = mix(nv, nb * 0.25, uVisc) * uDiss;
        outColor = vec4(nv * inside(vUv), 0, 1);
      }`, { uVel: { value: null }, uDt: { value: 0 }, uDiss: { value: 1 }, uVisc: { value: 0.1 } });

    // --- dye: shared splat + plume helpers
    const dyeCommon = /* glsl */`
      uniform vec4 uDS[${MAXS}]; uniform vec4 uDC[${MAXS}]; uniform int uDN;
      uniform vec4 uBombs[3]; uniform float uTime, uDt;
      vec4 dyeSplats(vec2 p, float layer) {
        vec4 add = vec4(0.0);
        for (int i = 0; i < ${MAXS}; i++) {
          if (i >= uDN) break;
          float w = max(0.0, 1.0 - abs(layer - uDS[i].w));
          if (w <= 0.0) continue;
          vec2 d = p - uDS[i].xy;
          add += w * uDC[i] * exp(-dot(d, d) / (uDS[i].z * uDS[i].z));
        }
        return add;
      }
      // fraction per second that sinks from layer k to k+1 at p
      float sinkRate(vec2 p, float k) {
        vec2 pq = p * (7.0 + k * 2.0) + vec2(uTime * 0.03 + k * 3.1, -uTime * 0.02);
        float pl = smoothstep(0.38, 0.78, vnoise(pq) * 0.7 + vnoise(pq * 2.1 + 5.0) * 0.3);
        float near = 0.0;
        for (int i = 0; i < 3; i++) { vec2 d = p - uBombs[i].xy; near += uBombs[i].w * exp(-dot(d, d) / 0.0036); }
        if (k < 0.5) return 0.012 + near * 0.9;
        float base = k < 1.5 ? 0.09 : 0.05;
        return base * (0.25 + 1.6 * pl) + near * 0.45;
      }
    `;

    // MacCormack step 1: plain backtrace
    this.pAdvDye = this.mat(/* glsl */`
      uniform sampler2D uVel, uSrc; uniform float uDt;
      void main() {
        vec2 v = texture(uVel, vUv).xy;
        outColor = texture(uSrc, vUv - uDt * v / (2.0 * DOMAIN));
      }`, { uVel: { value: null }, uSrc: { value: null }, uDt: { value: 0 } });

    // MacCormack step 2 (surface film): correction + clamp + splats + sinking + drain + saturation
    this.pDye0 = this.mat(dyeCommon + /* glsl */`
      uniform sampler2D uVel, uSrc, uHat; uniform vec2 uSrcTexel; uniform float uDrain, uCap; uniform vec4 uVortex;
      void main() {
        vec2 v = texture(uVel, vUv).xy;
        vec2 back = vUv - uDt * v / (2.0 * DOMAIN);
        vec4 hat = texture(uHat, vUv);
        vec4 fwd = texture(uHat, vUv + uDt * v / (2.0 * DOMAIN));
        vec4 orig = texture(uSrc, vUv);
        vec4 r = hat + 0.5 * (orig - fwd);
        // clamp to the neighbourhood of the backtraced source
        vec2 st = back / uSrcTexel - 0.5; vec2 i0 = (floor(st) + 0.5) * uSrcTexel;
        vec4 a = texture(uSrc, i0), b = texture(uSrc, i0 + vec2(uSrcTexel.x, 0)), c = texture(uSrc, i0 + vec2(0, uSrcTexel.y)), d = texture(uSrc, i0 + uSrcTexel);
        r = clamp(r, min(min(a, b), min(c, d)), max(max(a, b), max(c, d)));
        vec2 p = domainXZ(vUv);
        r *= 1.0 - clamp(sinkRate(p, 0.0) * uDt, 0.0, 0.5);
        r += dyeSplats(p, 0.0);
        // soft saturation so repeated bombs never blow out
        r *= 1.0 / (1.0 + max(r.a - uCap, 0.0) * 0.5 * uDt);
        if (uDrain > 0.0) { vec2 dd = p - uVortex.xy; r *= 1.0 - clamp(uDrain * uDt * (0.15 + 3.0 * exp(-dot(dd, dd) / 0.004)), 0.0, 1.0); }
        outColor = max(r, 0.0) * step(-0.004, -tubDist(p, uWaterH + 0.01));
      }`, { uVel: { value: null }, uSrc: { value: null }, uHat: { value: null }, uSrcTexel: { value: new THREE.Vector2() }, uDrain: { value: 0 }, uCap: { value: 3 }, uVortex: { value: this.vortex },
      uDS: { value: v4(MAXS) }, uDC: { value: v4(MAXS) }, uDN: { value: 0 }, uBombs: { value: this.bombs }, uTime: { value: 0 }, uDt: { value: 0 } });

    // deeper layers: slower, swirled, softened, fed from above
    this.pLayer = this.mat(dyeCommon + /* glsl */`
      uniform sampler2D uVel, uSrc, uAbove; uniform float uK, uSpeed, uSoft, uDrain; uniform vec4 uVortex;
      void main() {
        vec2 p = domainXZ(vUv);
        vec2 v = texture(uVel, vUv).xy * uSpeed;
        float e = 0.03;
        vec2 q = p * (5.0 + uK) + vec2(uK * 7.3, uTime * 0.04);
        float n0 = vnoise(q), nx = vnoise(q + vec2(e, 0)), nz = vnoise(q + vec2(0, e));
        v += vec2(nz - n0, -(nx - n0)) / e * 0.0045 * (0.6 + uK * 0.4);
        vec2 uv = vUv - uDt * v / (2.0 * DOMAIN);
        vec4 c = texture(uSrc, uv) * (1.0 - 4.0 * uSoft);
        c += uSoft * (texture(uSrc, uv + vec2(uTexel.x, 0)) + texture(uSrc, uv - vec2(uTexel.x, 0)) + texture(uSrc, uv + vec2(0, uTexel.y)) + texture(uSrc, uv - vec2(0, uTexel.y)));
        float down = uK < 2.5 ? sinkRate(p, uK) : 0.0;
        c *= 1.0 - clamp(down * uDt, 0.0, 0.5);
        c += texture(uAbove, vUv) * clamp(sinkRate(p, uK - 1.0) * uDt, 0.0, 0.5);
        c += dyeSplats(p, uK);
        c *= 1.0 / (1.0 + max(c.a - 2.5, 0.0) * 0.4 * uDt);
        if (uDrain > 0.0) { vec2 dd = p - uVortex.xy; c *= 1.0 - clamp(uDrain * uDt * (0.2 + 3.0 * exp(-dot(dd, dd) / 0.006)), 0.0, 1.0); }
        outColor = max(c, 0.0);
      }`, { uVel: { value: null }, uSrc: { value: null }, uAbove: { value: null }, uK: { value: 1 }, uSpeed: { value: 0.8 }, uSoft: { value: 0.02 }, uDrain: { value: 0 }, uVortex: { value: this.vortex },
      uDS: { value: v4(MAXS) }, uDC: { value: v4(MAXS) }, uDN: { value: 0 }, uBombs: { value: this.bombs }, uTime: { value: 0 }, uDt: { value: 0 } });

    // foam: r = lasting foam, g = fizz froth (short-lived)
    this.pFoam = this.mat(/* glsl */`
      uniform sampler2D uVel, uSrc; uniform float uDt, uDrain; uniform vec4 uFS[16]; uniform int uFN; uniform vec4 uVortex;
      void main() {
        vec2 v = texture(uVel, vUv).xy;
        vec2 uv = vUv - uDt * v / (2.0 * DOMAIN);
        vec4 f = texture(uSrc, uv);
        vec2 p = domainXZ(vUv);
        for (int i = 0; i < 16; i++) {
          if (i >= uFN) break;
          vec2 d = p - uFS[i].xy;
          float g = exp(-dot(d, d) / (uFS[i].z * uFS[i].z));
          f.r += g * uFS[i].w * 0.04;
          f.g += g * uFS[i].w;
        }
        f.r *= exp(-uDt / 30.0);
        f.g *= exp(-uDt / 0.55);
        f.r = min(f.r, 1.6); f.g = min(f.g, 2.0);
        if (uDrain > 0.0) f *= 1.0 - clamp(uDrain * uDt * 0.6, 0.0, 1.0);
        outColor = f * step(-0.004, -tubDist(p, uWaterH + 0.01));
      }`, { uVel: { value: null }, uSrc: { value: null }, uDt: { value: 0 }, uDrain: { value: 0 }, uFS: { value: v4(16) }, uFN: { value: 0 }, uVortex: { value: this.vortex } });

    // ripples: r = h, g = previous h
    this.pRipple = this.mat(/* glsl */`
      uniform sampler2D uSrc; uniform float uC, uDamp; uniform vec4 uRS[16]; uniform int uRN;
      void main() {
        vec2 hv = texture(uSrc, vUv).xy;
        float C = hv.x;
        vec2 ul = vUv - vec2(uTexel.x, 0), ur = vUv + vec2(uTexel.x, 0), ub = vUv - vec2(0, uTexel.y), ut = vUv + vec2(0, uTexel.y);
        float L = inside(ul) > 0.5 ? texture(uSrc, ul).x : C;
        float R = inside(ur) > 0.5 ? texture(uSrc, ur).x : C;
        float B = inside(ub) > 0.5 ? texture(uSrc, ub).x : C;
        float T = inside(ut) > 0.5 ? texture(uSrc, ut).x : C;
        float n = (2.0 * C - hv.y + uC * (L + R + B + T - 4.0 * C)) * uDamp;
        vec2 p = domainXZ(vUv);
        for (int i = 0; i < 16; i++) {
          if (i >= uRN) break;
          vec2 d = p - uRS[i].xy;
          n += uRS[i].w * exp(-dot(d, d) / (uRS[i].z * uRS[i].z));
        }
        n = clamp(n, -0.02, 0.02);
        outColor = vec4(n * inside(vUv), C, 0, 1);
      }`, { uSrc: { value: null }, uC: { value: 0.2 }, uDamp: { value: 0.996 }, uRS: { value: v4(16) }, uRN: { value: 0 } });

    // column densities for light shadowing: r = surface, g/b/a = layers
    this.pColumn = this.mat(/* glsl */`
      uniform sampler2D uD0, uD1, uD2, uD3;
      float dens(vec4 c) { return c.a; }
      void main() { outColor = vec4(dens(texture(uD0, vUv)), dens(texture(uD1, vUv)), dens(texture(uD2, vUv)), dens(texture(uD3, vUv))); }`,
    { uD0: { value: null }, uD1: { value: null }, uD2: { value: null }, uD3: { value: null } });

    // light reaching the tub floor through the whole dye column (rgb transmittance)
    this.pTint = this.mat(/* glsl */`
      uniform sampler2D uD0, uD1, uD2, uD3;
      ${GLSL_MIX}
      void main() {
        vec4 c = texture(uD0, vUv) + texture(uD1, vUv) * 0.8 + texture(uD2, vUv) * 0.8 + texture(uD3, vUv) * 0.5;
        outColor = vec4(exp(-(dyeAbsorb(dyeColor(c)) * 0.22 + 0.04) * c.a), c.a);
      }`, { uD0: { value: null }, uD1: { value: null }, uD2: { value: null }, uD3: { value: null } });

    // regional average of all dye (the colour that has diffused through the bath) + the tub-wide mean
    this.pHaze = this.mat(/* glsl */`
      uniform sampler2D uD0, uD1, uD2, uD3;
      void main() {
        vec4 acc = vec4(0.0);
        for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
          vec2 o = (vec2(float(i), float(j)) - 1.5) / 4.0 * uTexel;
          vec2 uv = vUv + o;
          acc += texture(uD0, uv) * 0.5 + texture(uD1, uv) + texture(uD2, uv) + texture(uD3, uv);
        }
        outColor = acc / 16.0;
      }`, { uD0: { value: null }, uD1: { value: null }, uD2: { value: null }, uD3: { value: null } });
    this.pMean = this.mat(/* glsl */`
      uniform sampler2D uH;
      void main() {
        vec4 acc = vec4(0.0);
        for (int j = 0; j < 14; j++) for (int i = 0; i < 32; i++) acc += texture(uH, (vec2(float(i), float(j)) + 0.5) / vec2(32.0, 14.0));
        outColor = acc / 448.0 * 1.6;
      }`, { uH: { value: null } });

    this.pProbe = this.mat(/* glsl */`
      uniform sampler2D uVel, uRip, uCol, uFoam;
      void main() {
        vec2 v = texture(uVel, vUv).xy;
        outColor = vec4(v, texture(uRip, vUv).x * 100.0, texture(uCol, vUv).x + texture(uFoam, vUv).r);
      }`, { uVel: { value: null }, uRip: { value: null }, uCol: { value: null }, uFoam: { value: null } });
  }

  run(mat, target, texel) {
    mat.uniforms.uTexel.value.set(1 / target.width, 1 / target.height);
    mat.uniforms.uWaterH.value = this.waterY - TUB.floorY;
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.quad, this.camera);
  }

  // --- splat API (world xz)
  // acceleration splat (m/s²): directional + radial + swirl
  addVel(x, z, radius, fx, fz, radial = 0, swirl = 0) { if (this.velSplats.length < MAXS) this.velSplats.push([x, z, radius, fx, fz, radial, swirl, 0]); }
  // pull the local velocity toward (vx, vz) — for stirring
  setVel(x, z, radius, vx, vz, k = 0.5) { if (this.velSplats.length < MAXS) this.velSplats.push([x, z, radius, vx, vz, k, 0, 1]); }
  // dye: linear pigment colour (r,g,b) times amount, plus white milk; stored premultiplied
  addDye(x, z, radius, r, g, b, amount, milk = 0, layer = 0) {
    if (this.dyeSplats.length < MAXS) this.dyeSplats.push([x, z, radius, layer, r * amount + milk, g * amount + milk, b * amount + milk, amount + milk]);
  }
  addFoam(x, z, radius, amount) { if (this.foamSplats.length < 16) this.foamSplats.push([x, z, radius, amount]); }
  addRipple(x, z, radius, amount) { if (this.rippleSplats.length < 16) this.rippleSplats.push([x, z, radius, amount]); }

  step(dt) {
    const r = this.r;
    const prevTarget = r.getRenderTarget();
    const ac = r.autoClear; r.autoClear = false;
    this.time += dt;
    const S = this.size;
    const q = this.q;

    const G0 = this.gpuT; G0 && G0.begin('f_splat');
    // velocity splats
    {
      const m = this.pSplatVel, u = m.uniforms;
      const n = this.velSplats.length;
      for (let i = 0; i < n; i++) { const s = this.velSplats[i]; u.uS.value[i].set(s[0], s[1], s[2], s[7]); u.uF.value[i].set(s[3], s[4], s[5], s[6]); }
      u.uN.value = n; u.uDt.value = dt; u.uTime.value = this.time; u.uAmb.value = this.ambient; u.uVortex.value.copy(this.vortex);
      u.uVel.value = this.vel.read.texture;
      this.run(m, this.vel.write); this.vel.swap();
      this.velSplats.length = 0;
    }
    const G = this.gpuT; G && G.end(); G && G.begin('f_vort');
    // vorticity confinement
    this.pCurl.uniforms.uVel.value = this.vel.read.texture; this.run(this.pCurl, this.curl);
    { const u = this.pVort.uniforms; u.uVel.value = this.vel.read.texture; u.uCurl.value = this.curl.texture; u.uDt.value = dt; u.uEps.value = q.vort; }
    this.run(this.pVort, this.vel.write); this.vel.swap();
    G && G.end(); G && G.begin('f_pressure');
    // pressure projection
    this.pDiv.uniforms.uVel.value = this.vel.read.texture; this.run(this.pDiv, this.div);
    this.pScale.uniforms.uSrc.value = this.pres.read.texture; this.pScale.uniforms.uK.value = 0.85; this.run(this.pScale, this.pres.write); this.pres.swap();
    this.pJacobi.uniforms.uDiv.value = this.div.texture;
    for (let i = 0; i < q.jacobi; i++) { this.pJacobi.uniforms.uP.value = this.pres.read.texture; this.run(this.pJacobi, this.pres.write); this.pres.swap(); }
    { const u = this.pGrad.uniforms; u.uP.value = this.pres.read.texture; u.uVel.value = this.vel.read.texture; }
    this.run(this.pGrad, this.vel.write); this.vel.swap();
    G && G.end(); G && G.begin('f_advvel');
    // advect velocity
    { const u = this.pAdvVel.uniforms; u.uVel.value = this.vel.read.texture; u.uDt.value = dt; u.uDiss.value = Math.exp(-dt * 0.12); u.uVisc.value = q.visc ?? 0.1; }
    this.run(this.pAdvVel, this.vel.write); this.vel.swap();

    // dye splat uniforms (shared by surface + layers)
    const nD = this.dyeSplats.length;
    for (const m of [this.pDye0, this.pLayer]) {
      const u = m.uniforms;
      for (let i = 0; i < nD; i++) { const s = this.dyeSplats[i]; u.uDS.value[i].set(s[0], s[1], s[2], s[3]); u.uDC.value[i].set(s[4], s[5], s[6], s[7]); }
      u.uDN.value = nD; u.uTime.value = this.time; u.uDt.value = dt;
    }
    this.dyeSplats.length = 0;

    G && G.end(); G && G.begin('f_layers');
    // deeper layers bottom-up so each reads the not-yet-updated layer above
    const lp = this.pLayer.uniforms;
    lp.uVel.value = this.vel.read.texture; lp.uDrain.value = this.drainSink;
    const speeds = [0.9, 0.7, 0.5], soft = [0.02, 0.035, 0.05];
    for (let k = 2; k >= 0; k--) {
      const L = this.layers[k];
      lp.uSrc.value = L.read.texture;
      lp.uAbove.value = k === 0 ? this.dye0.read.texture : this.layers[k - 1].read.texture;
      lp.uK.value = k + 1; lp.uSpeed.value = speeds[k]; lp.uSoft.value = soft[k];
      this.run(this.pLayer, L.write); L.swap();
    }
    G && G.end(); G && G.begin('f_dye0');
    // surface film (MacCormack)
    { const u = this.pAdvDye.uniforms; u.uVel.value = this.vel.read.texture; u.uSrc.value = this.dye0.read.texture; u.uDt.value = dt; }
    this.run(this.pAdvDye, this.dyeTmp);
    { const u = this.pDye0.uniforms; u.uVel.value = this.vel.read.texture; u.uSrc.value = this.dye0.read.texture; u.uHat.value = this.dyeTmp.texture;
      u.uSrcTexel.value.set(1 / S.dw, 1 / S.dh); u.uDrain.value = this.drainSink; }
    this.run(this.pDye0, this.dye0.write); this.dye0.swap();

    G && G.end(); G && G.begin('f_foamrip');
    // foam
    {
      const u = this.pFoam.uniforms; const n = this.foamSplats.length;
      for (let i = 0; i < n; i++) { const s = this.foamSplats[i]; u.uFS.value[i].set(s[0], s[1], s[2], s[3]); }
      u.uFN.value = n; u.uVel.value = this.vel.read.texture; u.uSrc.value = this.foam.read.texture; u.uDt.value = dt; u.uDrain.value = this.drainSink;
      this.run(this.pFoam, this.foam.write); this.foam.swap();
      this.foamSplats.length = 0;
    }
    // ripples (2 substeps)
    {
      const u = this.pRipple.uniforms; const n = this.rippleSplats.length;
      for (let i = 0; i < n; i++) { const s = this.rippleSplats[i]; u.uRS.value[i].set(s[0], s[1], s[2], s[3] * 0.5); }
      u.uRN.value = n;
      const dx = 2 * DOMAIN.x / S.rw, sub = dt > 1 / 50 ? 2 : 1, h = dt / sub, c = Math.min(0.22, 0.68 * dx / h);
      u.uC.value = Math.min(0.24, (c * h / dx) ** 2);
      u.uDamp.value = Math.pow(0.9, h);
      for (let i = 0; i < sub; i++) { u.uSrc.value = this.ripple.read.texture; this.run(this.pRipple, this.ripple.write); this.ripple.swap(); }
      this.rippleSplats.length = 0;
    }
    G && G.end(); G && G.begin('f_rest');
    // column
    { const u = this.pColumn.uniforms; u.uD0.value = this.dye0.read.texture; u.uD1.value = this.layers[0].read.texture; u.uD2.value = this.layers[1].read.texture; u.uD3.value = this.layers[2].read.texture; }
    this.run(this.pColumn, this.column);
    { const u = this.pTint.uniforms; u.uD0.value = this.dye0.read.texture; u.uD1.value = this.layers[0].read.texture; u.uD2.value = this.layers[1].read.texture; u.uD3.value = this.layers[2].read.texture; }
    this.run(this.pTint, this.tint);
    if (this.probe.frame % 4 === 0) {
      const hu = this.pHaze.uniforms; hu.uD0.value = this.dye0.read.texture; hu.uD1.value = this.layers[0].read.texture; hu.uD2.value = this.layers[1].read.texture; hu.uD3.value = this.layers[2].read.texture;
      this.run(this.pHaze, this.haze);
      this.pMean.uniforms.uH.value = this.haze.texture;
      this.run(this.pMean, this.mean);
    }

    // probe readback every few frames
    this.probe.frame++;
    if (!this.probe.pending && this.probe.frame % 3 === 0 && this.r.readRenderTargetPixelsAsync) {
      const u = this.pProbe.uniforms; u.uVel.value = this.vel.read.texture; u.uRip.value = this.ripple.read.texture; u.uCol.value = this.column.texture; u.uFoam.value = this.foam.read.texture;
      this.run(this.pProbe, this.probeRT);
      this.probe.pending = true;
      this.r.readRenderTargetPixelsAsync(this.probeRT, 0, 0, this.probe.w, this.probe.h, this.probe.buf).then(() => {
        const n = this.probe.buf.length;
        if (!this.probe.data) this.probe.data = new Float32Array(n);
        for (let i = 0; i < n; i++) this.probe.data[i] = THREE.DataUtils.fromHalfFloat(this.probe.buf[i]);
        this.probe.pending = false;
      }).catch(() => { this.probe.pending = false; });
    }

    G && G.end();
    r.autoClear = ac;
    r.setRenderTarget(prevTarget);
  }

  // CPU sample of the probe: velocity (m/s), ripple height (cm), density
  sample(x, z, out = { vx: 0, vz: 0, h: 0, d: 0 }) {
    const P = this.probe; if (!P.data) { out.vx = out.vz = out.h = out.d = 0; return out; }
    const u = x / (2 * DOMAIN.x) + 0.5, v = z / (2 * DOMAIN.z) + 0.5;
    const fx = Math.min(Math.max(u * P.w - 0.5, 0), P.w - 1.001), fy = Math.min(Math.max(v * P.h - 0.5, 0), P.h - 1.001);
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const g = (i, j, c) => P.data[((iy + j) * P.w + (ix + i)) * 4 + c];
    const bl = (c) => (g(0, 0, c) * (1 - tx) + g(1, 0, c) * tx) * (1 - ty) + (g(0, 1, c) * (1 - tx) + g(1, 1, c) * tx) * ty;
    out.vx = bl(0); out.vz = bl(1); out.h = bl(2); out.d = bl(3);
    return out;
  }

  textures() {
    return {
      dye0: this.dye0.read.texture, dye1: this.layers[0].read.texture, dye2: this.layers[1].read.texture, dye3: this.layers[2].read.texture,
      foam: this.foam.read.texture, ripple: this.ripple.read.texture, column: this.column.texture, vel: this.vel.read.texture, haze: this.haze.texture, mean: this.mean.texture, tint: this.tint.texture,
    };
  }
}
