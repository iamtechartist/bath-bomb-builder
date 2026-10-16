// Shared dimensions (metres, Y up, room floor at y = 0, tub centred on the origin, long axis = X).
// The tub interior is a loft of superellipse cross-sections; the same formula drives the Blender
// tub mesh (blender/scripts/fz_tub.py), the analytic underwater render and the fluid mask, so the
// three always agree.

export const TUB = {
  floorY: 0.12,     // interior floor
  rimY: 0.60,       // rim top
  depth: 0.48,      // rimY - floorY
  fillet: 0.07,     // floor/wall fillet radius
  // half extents: A(h) = a0 + a1*s, B(h) = b0 + b1*s, s = (h/depth)^sp, exponent n0 + n1*s
  a0: 0.62, a1: 0.15,
  b0: 0.25, b1: 0.07,
  n0: 3.0, n1: 0.6,
  sp: 0.6,
  drainX: -0.50,    // plug on the floor at the tap end
};

export const WATER_Y = 0.45;            // resting water level
export const DOMAIN = { x: 0.775, z: 0.325 }; // half extents of the fluid domain (covers the rim opening)

export function tubSection(h) {
  const t = TUB;
  const hh = Math.min(Math.max(h, 0), t.depth);
  const s = Math.pow(hh / t.depth, t.sp);
  let A = t.a0 + t.a1 * s, B = t.b0 + t.b1 * s;
  if (hh < t.fillet) { const k = t.fillet - Math.sqrt(t.fillet * t.fillet - (t.fillet - hh) ** 2); A -= k; B -= k; }
  return { A, B, n: t.n0 + t.n1 * s };
}

// < 1 inside the interior outline at height h above the interior floor
export function tubF(x, z, h) {
  const { A, B, n } = tubSection(h);
  return Math.pow(Math.abs(x) / A, n) + Math.pow(Math.abs(z) / B, n);
}

// Signed distance-ish (metres) to the interior wall at height h, negative inside.
export function tubDist(x, z, h) {
  const { A, B, n } = tubSection(h);
  const f = Math.pow(Math.pow(Math.abs(x) / A, n) + Math.pow(Math.abs(z) / B, n), 1 / n);
  return (f - 1) * Math.min(A, B) * 1.15;
}

export const GLSL_TUB = /* glsl */`
const float TUB_FLOOR = ${TUB.floorY.toFixed(4)};
const float TUB_RIM = ${TUB.rimY.toFixed(4)};
const float TUB_DEPTH = ${TUB.depth.toFixed(4)};
const vec2 DOMAIN = vec2(${DOMAIN.x.toFixed(4)}, ${DOMAIN.z.toFixed(4)});
vec3 tubSection(float h) {
  float hh = clamp(h, 0.0, TUB_DEPTH);
  float s = pow(hh / TUB_DEPTH, ${TUB.sp.toFixed(3)});
  float A = ${TUB.a0.toFixed(4)} + ${TUB.a1.toFixed(4)} * s;
  float B = ${TUB.b0.toFixed(4)} + ${TUB.b1.toFixed(4)} * s;
  float fr = ${TUB.fillet.toFixed(4)};
  if (hh < fr) { float k = fr - sqrt(max(fr * fr - (fr - hh) * (fr - hh), 0.0)); A -= k; B -= k; }
  return vec3(A, B, ${TUB.n0.toFixed(3)} + ${TUB.n1.toFixed(3)} * s);
}
// signed distance-ish to the interior wall at height h (negative inside)
float tubDist(vec2 xz, float h) {
  vec3 s = tubSection(h);
  vec2 q = abs(xz) / s.xy;
  float f = pow(pow(q.x, s.z) + pow(q.y, s.z), 1.0 / s.z);
  return (f - 1.0) * min(s.x, s.y) * 1.15;
}
vec2 domainUV(vec2 xz) { return xz / (2.0 * DOMAIN) + 0.5; }
vec2 domainXZ(vec2 uv) { return (uv - 0.5) * 2.0 * DOMAIN; }
`;
