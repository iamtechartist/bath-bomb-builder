// Bath bomb shapes: signed fields meshed with surface nets (smooth, crumble-friendly, any topology).
// Local frame: the bomb's "face" looks along +Z (as it stands on the tray); thickness is along Z.
// Units: the result is normalised so the shape fits a sphere of radius 1.
import * as THREE from 'three';

const len2 = (x, y) => Math.hypot(x, y);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

// iq's 2D SDFs
function sdStar5(px, py, r, rf) {
  const k1x = 0.809016994375, k1y = -0.587785252292;
  const k2x = -k1x, k2y = k1y;
  px = Math.abs(px);
  let d = 2 * Math.max(k1x * px + k1y * py, 0); px -= d * k1x; py -= d * k1y;
  d = 2 * Math.max(k2x * px + k2y * py, 0); px -= d * k2x; py -= d * k2y;
  px = Math.abs(px); py -= r;
  const bax = rf * -k1y, bay = rf * k1x - 1; // ba = rf*(-k1.y,k1.x) - (0,1)
  const h = clamp((px * bax + py * bay) / (bax * bax + bay * bay), 0, r);
  return len2(px - bax * h, py - bay * h) * Math.sign(py * bax - px * bay);
}
function sdHeart(px, py) {
  px = Math.abs(px);
  if (py + px > 1) return Math.sqrt((px - 0.25) ** 2 + (py - 0.75) ** 2) - Math.SQRT2 / 4;
  const a = (px - 0) ** 2 + (py - 1) ** 2;
  const m = 0.5 * Math.max(px + py, 0);
  const b = (px - m) ** 2 + (py - m) ** 2;
  return Math.sqrt(Math.min(a, b)) * Math.sign(px - py);
}
function sdMoon(px, py, d, ra, rb) {
  py = Math.abs(py);
  const a = (ra * ra - rb * rb + d * d) / (2 * d);
  const b = Math.sqrt(Math.max(ra * ra - a * a, 0));
  if (d * (px * b - py * a) > d * d * Math.max(b - py, 0)) return len2(px - a, py - b);
  return Math.max(len2(px, py) - ra, -(len2(px - d, py) - rb));
}
// puffy extrusion: 2D field d2 with a rounded, pillow-like thickness profile
function puff(d2, z, thick, round) {
  // thickness shrinks toward the outline so the edge is soft and domed
  const t = thick * Math.sqrt(clamp(-d2 / round, 0, 1)) + 0.0001;
  const wx = d2, wz = Math.abs(z) - t;
  return Math.min(Math.max(wx, wz), 0) + Math.hypot(Math.max(wx, 0), Math.max(wz, 0));
}

export const SHAPES = {
  sphere: (x, y, z) => Math.hypot(x, y, z) - 0.92,
  heart: (x, y, z) => puff(sdHeart(x * 0.62, y * 0.62 + 0.52) / 0.62, z, 0.5, 0.75),
  star: (x, y, z) => puff(sdStar5(x, y - 0.04, 0.95, 0.5), z, 0.42, 0.55),
  moon: (x, y, z) => puff(sdMoon(x + 0.12, y, 0.55, 0.92, 0.72), z, 0.46, 0.5),
};

// surface nets over [-1.15, 1.15]^3
export function meshShape(name, N = 44) {
  const f = SHAPES[name];
  const R = 1.15, h = (2 * R) / N, n1 = N + 1;
  const vals = new Float32Array(n1 * n1 * n1);
  for (let k = 0; k <= N; k++) for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    vals[i + n1 * (j + n1 * k)] = f(-R + i * h, -R + j * h, -R + k * h);
  }
  const vidx = new Int32Array(N * N * N).fill(-1);
  const pos = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const [a, b, d] = corners[c];
      cv[c] = vals[(i + a) + n1 * ((j + b) + n1 * (k + d))];
      if (cv[c] < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [e0, e1] of edges) {
      const v0 = cv[e0], v1 = cv[e1];
      if ((v0 < 0) === (v1 < 0)) continue;
      const t = v0 / (v0 - v1);
      const c0 = corners[e0], c1 = corners[e1];
      sx += c0[0] + (c1[0] - c0[0]) * t; sy += c0[1] + (c1[1] - c0[1]) * t; sz += c0[2] + (c1[2] - c0[2]) * t; cnt++;
    }
    vidx[i + N * (j + N * k)] = pos.length / 3;
    pos.push(-R + (i + sx / cnt) * h, -R + (j + sy / cnt) * h, -R + (k + sz / cnt) * h);
  }
  const idx = [];
  const V = (i, j, k) => vidx[i + N * (j + N * k)];
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const v0 = vals[i + n1 * (j + n1 * k)];
    // x edge
    if (j > 0 && k > 0 && i < N) {
      const v1 = vals[(i + 1) + n1 * (j + n1 * k)];
      if ((v0 < 0) !== (v1 < 0)) {
        const a = V(i, j - 1, k - 1), b = V(i, j, k - 1), c = V(i, j, k), d = V(i, j - 1, k);
        if (a >= 0 && b >= 0 && c >= 0 && d >= 0) { if (v0 < 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c); }
      }
    }
    if (i > 0 && k > 0 && j < N) {
      const v1 = vals[i + n1 * ((j + 1) + n1 * k)];
      if ((v0 < 0) !== (v1 < 0)) {
        const a = V(i - 1, j, k - 1), b = V(i, j, k - 1), c = V(i, j, k), d = V(i - 1, j, k);
        if (a >= 0 && b >= 0 && c >= 0 && d >= 0) { if (v0 < 0) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d); }
      }
    }
    if (i > 0 && j > 0 && k < N) {
      const v1 = vals[i + n1 * (j + n1 * (k + 1))];
      if ((v0 < 0) !== (v1 < 0)) {
        const a = V(i - 1, j - 1, k), b = V(i, j - 1, k), c = V(i, j, k), d = V(i - 1, j, k);
        if (a >= 0 && b >= 0 && c >= 0 && d >= 0) { if (v0 < 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c); }
      }
    }
  }
  // normalise to fit a unit sphere, normals from the field gradient
  let maxR = 0;
  for (let i = 0; i < pos.length; i += 3) maxR = Math.max(maxR, Math.hypot(pos[i], pos[i + 1], pos[i + 2]));
  const nrm = new Float32Array(pos.length);
  const e = 0.01;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    let gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    nrm[i] = gx / l; nrm[i + 1] = gy / l; nrm[i + 2] = gz / l;
    pos[i] /= maxR; pos[i + 1] /= maxR; pos[i + 2] /= maxR;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  // thickness (z) half-extent, for buoyancy
  let maxZ = 0, maxY = 0;
  for (let i = 0; i < pos.length; i += 3) { maxZ = Math.max(maxZ, Math.abs(pos[i + 2])); maxY = Math.max(maxY, Math.abs(pos[i + 1])); }
  g.userData = { halfThick: maxZ, halfH: maxY, tris: idx.length / 3 };
  return g;
}
