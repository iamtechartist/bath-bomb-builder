// Shared GLSL snippets.
import { GLSL_TUB } from './config.js';

export const GLSL_NOISE = /* glsl */`
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1,0,0)), u.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), u.x), u.y);
  float b = mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), u.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), u.x), u.y);
  return mix(a, b, u.z);
}
// voronoi: x = F1, y = F2, z = cell id hash, w = second hash
vec4 voro(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0; float id = 0.0, id2 = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash22(i + g);
    vec2 r = g + o - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hash12(i + g + 7.13); id2 = hash12(i + g + 19.7); } else if (d < d2) d2 = d;
  }
  return vec4(sqrt(d1), sqrt(d2), id, id2);
}
float fbm2(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

// Dye is stored as (premultiplied linear pigment colour, concentration), so any bombs can share a
// tub. dyeColor() un-premultiplies and restores chroma lost to averaging (no mud); dyeAbsorb()
// turns a pigment colour into per-channel absorbance (each pigment absorbs its complement).
export const GLSL_MIX = /* glsl */`
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 dyeColor(vec4 d) {
  vec3 c = max(d.rgb / max(d.a, 1e-4), 0.0);
  float L = lum(c);
  vec3 dv = c - L; float ch = length(dv);
  float target = max(ch, 0.75 * L * smoothstep(0.02, 0.12, ch));
  return max(L + dv * min(target / max(ch, 1e-4), 2.2), 0.0);
}
vec3 dyeAbsorb(vec3 col) { float m = max(col.r, max(col.g, col.b)); return -log(clamp(col / max(m, 1e-4), 0.0, 1.0) * 0.92 + 0.015); }
`;

export const GLSL_COMMON = GLSL_TUB + GLSL_NOISE;

// Dave Hoskins-style tileable caustic (iterated sines) — cheap, sharp, animated.
export const GLSL_CAUSTIC = /* glsl */`
float causticPattern(vec2 p, float t) {
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / max(length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten))), 0.05);
  }
  c = min(c / 4.0, 1.25);
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 7.0);
}
`;
