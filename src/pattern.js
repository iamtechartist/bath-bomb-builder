// The bomb's 3D colour field, identical in JS (dye emission) and GLSL (the bomb's surface).
// weights(p) → (w1, w2, w3) for the three palette colours at unit-bomb position p (|p| <= 1).
// Radial structure: the pattern lives in the outer shell; inside are a colour-2 layer and a
// colour-3 core, so the water shows the outer design first, then the inner colours.

export const PATTERNS = ['marble', 'ombre', 'stripes', 'speckle', 'galaxy'];

// --- JS
function fract(x) { return x - Math.floor(x); }
function hash13(x, y, z) {
  let px = fract(x * 0.1031), py = fract(y * 0.1031), pz = fract(z * 0.1031);
  const d = px * (pz + 31.32) + py * (py + 31.32) + pz * (px + 31.32);
  px += d; py += d; pz += d;
  return fract((px + py) * pz);
}
function vnoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const h = (a, b, c) => hash13(ix + a, iy + b, iz + c);
  const l = (a, b, t) => a + (b - a) * t;
  const a = l(l(h(0, 0, 0), h(1, 0, 0), ux), l(h(0, 1, 0), h(1, 1, 0), ux), uy);
  const b = l(l(h(0, 0, 1), h(1, 0, 1), ux), l(h(0, 1, 1), h(1, 1, 1), ux), uy);
  return l(a, b, uz);
}
function fbm3(x, y, z) { let s = 0, a = 0.5; for (let i = 0; i < 3; i++) { s += a * vnoise3(x, y, z); x = x * 2.03 + 7.1; y = y * 2.03 + 3.3; z = z * 2.03 + 1.7; a *= 0.5; } return s; }
const sstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

export function weights(p, pattern, seed, out = [0, 0, 0]) {
  const [x, y, z] = p;
  const r = Math.hypot(x, y, z);
  let w1 = 0, w2 = 0, w3 = 0;
  const sx = x + seed * 3.7, sy = y + seed * 1.3, sz = z + seed * 2.1;
  if (pattern === 'marble') {
    const m = Math.sin(x * 2.6 + y * 1.4 + 5.5 * fbm3(sx * 1.6, sy * 1.6, sz * 1.6));
    const m2 = Math.sin(z * 2.2 - x * 1.1 + 4.0 * fbm3(sx * 2.1 + 9, sy * 2.1, sz * 2.1));
    w1 = sstep(-0.2, 0.5, m) * 0.9 + 0.1; w2 = sstep(0.1, 0.7, m2) * (1 - sstep(0.2, 0.7, m) * 0.6); w3 = sstep(0.5, 0.95, -m);
  } else if (pattern === 'ombre') {
    const t = y * 0.5 + 0.5 + (fbm3(sx * 2, sy * 2, sz * 2) - 0.5) * 0.25;
    w1 = sstep(0.45, 0.85, t); w3 = sstep(0.55, 0.15, t); w2 = Math.max(0, 1 - w1 - w3) + 0.05;
  } else if (pattern === 'stripes') {
    const t = fract(y * 1.6 + 0.08 * Math.sin(x * 4 + z * 3) + 0.5);
    const b = Math.floor(t * 3);
    const e = Math.min(t * 3 - b, 1 - (t * 3 - b));
    const soft = sstep(0.0, 0.12, e);
    w1 = b === 0 ? 1 : 0; w2 = b === 1 ? 1 : 0; w3 = b === 2 ? 1 : 0;
    w1 = w1 * soft + 0.15 * (1 - soft); w2 = w2 * soft + 0.15 * (1 - soft); w3 = w3 * soft + 0.15 * (1 - soft);
  } else if (pattern === 'speckle') {
    const s2 = vnoise3(sx * 9, sy * 9, sz * 9), s3 = vnoise3(sx * 11 + 5, sy * 11, sz * 11);
    w1 = 1; w2 = sstep(0.72, 0.8, s2) * 2.5; w3 = sstep(0.74, 0.82, s3) * 2.5;
  } else { // galaxy: deep base, nebula clouds of the other two
    const n1 = fbm3(sx * 1.8, sy * 1.8, sz * 1.8), n2 = fbm3(sx * 2.4 + 11, sy * 2.4, sz * 2.4);
    w1 = 0.55; w2 = sstep(0.36, 0.56, n1) * 1.8; w3 = sstep(0.42, 0.6, n2) * 1.8;
  }
  // inner layers
  const shell = sstep(0.62, 0.8, r), core = 1 - sstep(0.38, 0.5, r);
  const mid = (1 - shell) * (1 - core);
  w1 = w1 * shell + 0.15 * mid; w2 = w2 * shell + 1.0 * mid + 0.15 * core; w3 = w3 * shell + 0.15 * mid + 1.0 * core;
  const s = w1 + w2 + w3 || 1;
  out[0] = w1 / s; out[1] = w2 / s; out[2] = w3 / s;
  return out;
}

// --- GLSL (same maths)
export const GLSL_PATTERN = /* glsl */`
float pHash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float pNoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(pHash13(i), pHash13(i + vec3(1,0,0)), u.x), mix(pHash13(i + vec3(0,1,0)), pHash13(i + vec3(1,1,0)), u.x), u.y);
  float b = mix(mix(pHash13(i + vec3(0,0,1)), pHash13(i + vec3(1,0,1)), u.x), mix(pHash13(i + vec3(0,1,1)), pHash13(i + vec3(1,1,1)), u.x), u.y);
  return mix(a, b, u.z);
}
float pFbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * pNoise3(p); p = p * 2.03 + vec3(7.1, 3.3, 1.7); a *= 0.5; } return s; }
// pattern: 0 marble, 1 ombre, 2 stripes, 3 speckle, 4 galaxy
vec3 bombWeights(vec3 p, int pattern, float seed) {
  float r = length(p);
  vec3 sp = p + seed * vec3(3.7, 1.3, 2.1);
  float w1 = 0.0, w2 = 0.0, w3 = 0.0;
  if (pattern == 0) {
    float m = sin(p.x * 2.6 + p.y * 1.4 + 5.5 * pFbm3(sp * 1.6));
    float m2 = sin(p.z * 2.2 - p.x * 1.1 + 4.0 * pFbm3(sp * 2.1 + vec3(9.0, 0.0, 0.0)));
    w1 = smoothstep(-0.2, 0.5, m) * 0.9 + 0.1; w2 = smoothstep(0.1, 0.7, m2) * (1.0 - smoothstep(0.2, 0.7, m) * 0.6); w3 = smoothstep(0.5, 0.95, -m);
  } else if (pattern == 1) {
    float t = p.y * 0.5 + 0.5 + (pFbm3(sp * 2.0) - 0.5) * 0.25;
    w1 = smoothstep(0.45, 0.85, t); w3 = 1.0 - smoothstep(0.15, 0.55, t); w2 = max(0.0, 1.0 - w1 - w3) + 0.05;
  } else if (pattern == 2) {
    float t = fract(p.y * 1.6 + 0.08 * sin(p.x * 4.0 + p.z * 3.0) + 0.5);
    float b = floor(t * 3.0);
    float e = min(t * 3.0 - b, 1.0 - (t * 3.0 - b));
    float soft = smoothstep(0.0, 0.12, e);
    w1 = (b < 0.5 ? 1.0 : 0.0) * soft + 0.15 * (1.0 - soft);
    w2 = (b > 0.5 && b < 1.5 ? 1.0 : 0.0) * soft + 0.15 * (1.0 - soft);
    w3 = (b > 1.5 ? 1.0 : 0.0) * soft + 0.15 * (1.0 - soft);
  } else if (pattern == 3) {
    float s2 = pNoise3(sp * 9.0), s3 = pNoise3(sp * 11.0 + vec3(5.0, 0.0, 0.0));
    w1 = 1.0; w2 = smoothstep(0.72, 0.8, s2) * 2.5; w3 = smoothstep(0.74, 0.82, s3) * 2.5;
  } else {
    float n1 = pFbm3(sp * 1.8), n2 = pFbm3(sp * 2.4 + vec3(11.0, 0.0, 0.0));
    w1 = 0.55; w2 = smoothstep(0.36, 0.56, n1) * 1.8; w3 = smoothstep(0.42, 0.6, n2) * 1.8;
  }
  float shell = smoothstep(0.62, 0.8, r), core = 1.0 - smoothstep(0.38, 0.5, r);
  float mid = (1.0 - shell) * (1.0 - core);
  w1 = w1 * shell + 0.15 * mid; w2 = w2 * shell + mid + 0.15 * core; w3 = w3 * shell + 0.15 * mid + core;
  return vec3(w1, w2, w3) / max(w1 + w2 + w3, 1e-4);
}
`;
