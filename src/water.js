// The bath water surface: one shader that renders reflection, the dye film, the stacked dye volume
// (sampled where the refracted view ray crosses each layer), and the enamel tub floor/walls below
// with caustics and dye-coloured light. Drawn after the opaque scene, no depth write.
import * as THREE from 'three';
import { GLSL_COMMON, GLSL_MIX, GLSL_CAUSTIC } from './glsl.js';
import { DOMAIN, TUB, tubDist } from './config.js';

// The tub interior is a heightfield (its walls only ever lean outward), so the underwater ray can
// march a texture instead of evaluating the superellipse many times per pixel.
// R = interior surface height (world y), G/B = surface normal x/z, A = ambient occlusion.
function tubHeightfield(W = 256, H = 108) {
  const data = new Uint16Array(W * H * 4);
  const hgt = new Float32Array(W * H);
  const toH = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = ((i + 0.5) / W - 0.5) * 2 * DOMAIN.x, z = ((j + 0.5) / H - 0.5) * 2 * DOMAIN.z;
    let y;
    if (tubDist(x, z, TUB.depth) > 0) y = TUB.rimY + 0.05;
    else if (tubDist(x, z, 0) <= 0) y = TUB.floorY;
    else { let a = 0, b = TUB.depth; for (let k = 0; k < 22; k++) { const m = (a + b) / 2; if (tubDist(x, z, m) > 0) a = m; else b = m; } y = TUB.floorY + b; }
    hgt[j * W + i] = y;
  }
  const dx = 2 * DOMAIN.x / W, dz = 2 * DOMAIN.z / H;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const g = (ii, jj) => hgt[Math.min(H - 1, Math.max(0, jj)) * W + Math.min(W - 1, Math.max(0, ii))];
    const y = g(i, j);
    let gx = (g(i + 1, j) - g(i - 1, j)) / (2 * dx), gz = (g(i, j + 1) - g(i, j - 1)) / (2 * dz);
    gx = Math.max(-30, Math.min(30, gx)); gz = Math.max(-30, Math.min(30, gz));
    const l = Math.hypot(gx, 1, gz);
    const nx = -gx / l, nz = -gz / l;
    const x = ((i + 0.5) / W - 0.5) * 2 * DOMAIN.x, z = ((j + 0.5) / H - 0.5) * 2 * DOMAIN.z;
    const wallD = -tubDist(x, z, Math.min(TUB.depth, y - TUB.floorY + 0.02));
    const above = y - TUB.floorY;
    const isFloor = above < 0.001 ? 1 : 0;
    const ao = (0.55 + 0.45 * Math.min(1, Math.max(0, wallD / 0.09))) * (0.7 + 0.3 * Math.min(1, Math.max(0, (above + isFloor * 0.06) / 0.06)));
    const k = (j * W + i) * 4;
    data[k] = toH(y); data[k + 1] = toH(nx); data[k + 2] = toH(nz); data[k + 3] = toH(ao);
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

export function createWater(fluid, quality = 'medium') {
  const geo = new THREE.PlaneGeometry(DOMAIN.x * 2, DOMAIN.z * 2, 220, 92);
  geo.rotateX(-Math.PI / 2);

  const uniforms = {
    uDye0: { value: null }, uDye1: { value: null }, uDye2: { value: null }, uDye3: { value: null },
    uFoam: { value: null }, uRipple: { value: null }, uColumn: { value: null }, uTint: { value: null }, uHaze: { value: null }, uMean: { value: null }, uHazeK: { value: 1 },
    uRippleTexel: { value: new THREE.Vector2(1 / fluid.size.rw, 1 / fluid.size.rh) },
    uWaterY: { value: 0.45 }, uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(-0.3, 0.8, -0.5).normalize() }, uSunCol: { value: new THREE.Vector3(3, 2.9, 2.7) },
    uSkyCol: { value: new THREE.Vector3(0.6, 0.65, 0.75) }, uBounceCol: { value: new THREE.Vector3(0.5, 0.45, 0.4) },
    uEnv: { value: null }, uEnvIntensity: { value: 1 }, uEnvPos: { value: new THREE.Vector3(0.1, 1.05, 0.35) },
    uRefl: { value: null }, uReflOn: { value: 0 }, uReflMat: { value: new THREE.Matrix4() },
    uShadow: { value: null }, uShadowMat: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 },
    uPts: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uPtCol: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uDip: { value: new THREE.Vector4(TUB.drainX, 0, 0, 0) }, // drain vortex dimple: x, z, depth, swirl phase
    uDensity: { value: 1 },
    uGlow: { value: 0 },
    uDebug: { value: 0 },
    uTubHF: { value: tubHeightfield() },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: false,
    depthWrite: false,
    defines: { VSAMP: quality === 'high' ? 2 : 1, CAUS2: quality === 'high' ? 1 : 0 },
    vertexShader: /* glsl */`
      uniform float uWaterY; uniform vec4 uDip;
      varying vec3 vWorld;
      varying vec4 vClip;
      void main() {
        vec3 p = position;
        p.y = uWaterY;
        if (uDip.z > 0.0) {
          vec2 d = p.xz - uDip.xy; float r2 = dot(d, d);
          p.y -= uDip.z * exp(-r2 / 0.0035) + uDip.z * 0.25 * exp(-r2 / 0.03);
        }
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        vClip = gl_Position;
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      ${GLSL_COMMON}
      ${GLSL_MIX}
      ${GLSL_CAUSTIC}
      uniform sampler2D uDye0, uDye1, uDye2, uDye3, uFoam, uRipple, uColumn, uTint, uRefl, uHaze, uMean, uTubHF; uniform float uHazeK;
      uniform sampler2DShadow uShadow;
      uniform samplerCube uEnv;
      uniform vec2 uRippleTexel;
      uniform vec3 uEnvPos;
      uniform float uWaterY, uTime, uEnvIntensity, uReflOn, uShadowOn, uDensity, uGlow; uniform int uDebug;
      uniform vec3 uSunDir, uSunCol, uSkyCol, uBounceCol;
      uniform mat4 uReflMat, uShadowMat;
      uniform vec4 uPts[4]; uniform vec3 uPtCol[4];
      uniform vec4 uDip;
      varying vec3 vWorld;
      varying vec4 vClip;

      float shadowAt(vec3 wp) {
        if (uShadowOn < 0.5) return 1.0;
        vec4 sc = uShadowMat * vec4(wp, 1.0);
        vec3 s = sc.xyz / sc.w;
        if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
        return texture(uShadow, vec3(s.xy, s.z - 0.0008));
      }

      // ripple normal (world), from the height field gradient
      vec3 rippleNormal(vec2 uv, float k) {
        float hl = texture2D(uRipple, uv - vec2(uRippleTexel.x, 0)).x, hr = texture2D(uRipple, uv + vec2(uRippleTexel.x, 0)).x;
        float hb = texture2D(uRipple, uv - vec2(0, uRippleTexel.y)).x, ht = texture2D(uRipple, uv + vec2(0, uRippleTexel.y)).x;
        vec2 dx = 2.0 * DOMAIN * uRippleTexel;
        vec2 g = vec2((hr - hl) / (2.0 * dx.x), (ht - hb) / (2.0 * dx.y)) * k;
        return normalize(vec3(-g.x, 1.0, -g.y));
      }

      // first hit of a ray (starting under the surface) with the tub interior heightfield
      float hitTub(vec3 o, vec3 d, out vec3 n, out float isFloor, out float ao) {
        float tMax = (o.y - TUB_FLOOR) / max(-d.y, 0.05);
        float t0 = 0.0, t1 = tMax;
        const int N = 6;
        for (int i = 1; i <= N; i++) {
          float t = tMax * float(i) / float(N);
          vec3 q = o + d * t;
          if (q.y <= texture2D(uTubHF, domainUV(q.xz)).r) { t1 = t; break; }
          t0 = t;
        }
        for (int i = 0; i < 3; i++) {
          float tm = 0.5 * (t0 + t1); vec3 q = o + d * tm;
          if (q.y <= texture2D(uTubHF, domainUV(q.xz)).r) t1 = tm; else t0 = tm;
        }
        vec4 hf = texture2D(uTubHF, domainUV((o + d * t1).xz));
        n = normalize(vec3(hf.g, sqrt(max(1.0 - hf.g * hf.g - hf.b * hf.b, 0.0)), hf.b));
        isFloor = step(hf.r, TUB_FLOOR + 0.0015);
        ao = hf.a;
        return t1;
      }

      // pigment optics: every pigment absorbs the complement of its colour (ink over a white tub),
      // plus a little scattering so dense clouds read as lit volume rather than stained glass
      void slab(vec4 d, float path, vec3 light, inout vec3 acc, inout vec3 T, float kS, float kA) {
        float s = d.a;
        if (s < 1e-4) return;
        vec3 col = dyeColor(d);
        float sigS = s * kS * uDensity;
        vec3 ext = dyeAbsorb(col) * s * kA * uDensity + sigS;
        vec3 tr = exp(-ext * path);
        vec3 scat = col * light * sigS / max(ext, vec3(1e-4)) * (1.0 - tr);
        acc += T * scat;
        T *= tr;
      }

      void main() {
        vec3 P = vWorld;
        float h = uWaterY - TUB_FLOOR;
        float wd = tubDist(P.xz, h);
        if (wd > 0.003) discard;
        vec2 uv = domainUV(P.xz);
        vec3 V = normalize(cameraPosition - P);

        // --- surface normal: ripples + a whisper of micro-ripple + drain dimple
        vec3 n = rippleNormal(uv, 1.0);
        float t = uTime;
        vec2 mr = vec2(vnoise(P.xz * 38.0 + t * 0.35) - 0.5, vnoise(P.xz * 38.0 - t * 0.31 + 9.0) - 0.5);
        vec4 foamS = texture2D(uFoam, uv);
        n = normalize(n + vec3(mr.x, 0.0, mr.y) * (0.012 + foamS.g * 0.05));
        if (uDip.z > 0.0) {
          vec2 d = P.xz - uDip.xy; float r2 = dot(d, d);
          vec2 g = 2.0 * d * (uDip.z / 0.0035 * exp(-r2 / 0.0035) + uDip.z * 0.25 / 0.03 * exp(-r2 / 0.03));
          float ang = atan(d.y, d.x);
          float sw = sin(ang * 3.0 + sqrt(r2) * 90.0 - uDip.w * 6.0) * 0.25 * smoothstep(0.25, 0.02, sqrt(r2)) * clamp(uDip.z * 20.0, 0.0, 1.0);
          n = normalize(n + vec3(g.x, 0.0, g.y) + vec3(-d.y, 0.0, d.x) / (sqrt(r2) + 0.01) * sw);
        }
        float NdV = max(dot(n, V), 0.0);
        float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);

        // --- light at the surface
        vec3 L = normalize(uSunDir);
        float sh = shadowAt(P + n * 0.002);
        vec3 sunAtSurf = uSunCol * sh;
        vec3 ambient = uSkyCol;

        // --- reflection
        vec3 R = reflect(-V, n);
        vec3 refl;
        if (uReflOn > 0.5) {
          vec4 rc = uReflMat * vec4(P + vec3(n.x, 0.0, n.z) * 0.04, 1.0);
          refl = texture2D(uRefl, rc.xy / rc.w).rgb;
        } else {
          // box-projected room reflection (the cube was captured at uEnvPos inside the room box)
          vec3 bmin = vec3(-1.6, 0.0, -0.66), bmax = vec3(2.2, 2.9, 3.2);
          vec3 t1 = (bmax - P) / R, t2 = (bmin - P) / R;
          vec3 tf = max(t1, t2);
          float tb = min(min(tf.x, tf.y), tf.z);
          vec3 X = P + R * tb;
          refl = textureCube(uEnv, normalize(X - uEnvPos)).rgb * uEnvIntensity;
        }
        // sun + candle glints
        vec3 Hs = normalize(L + V);
        refl += uSunCol * sh * pow(max(dot(n, Hs), 0.0), 900.0) * 6.0;
        for (int i = 0; i < 4; i++) {
          if (uPts[i].w <= 0.0) continue;
          vec3 lp = uPts[i].xyz - P; float dl = length(lp); vec3 Lp = lp / dl;
          vec3 Hp = normalize(Lp + V);
          float nh = max(dot(n, Hp), 0.0);
          refl += uPtCol[i] * (pow(nh, 600.0) * 3.0 + pow(nh, 30.0) * 0.12) / (dl * dl + 0.05) * uPts[i].w;
          // only flames above the rim can light the water inside the tub
          ambient += uPtCol[i] * uPts[i].w * 0.03 / (dl * dl + 0.08) * smoothstep(0.58, 0.66, uPts[i].y);
        }

        // --- refracted path into the water
        vec3 Rd = refract(-V, n, 1.0 / 1.333);
        vec3 nT; float isFloor, aoT;
        float tHit = hitTub(P, Rd, nT, isFloor, aoT);
        vec3 H = P + Rd * tHit;
        float hitDepth = uWaterY - H.y;

        // light direction under water
        vec3 Lw = -refract(-L, vec3(0, 1, 0), 1.0 / 1.333);
        vec4 col4 = texture2D(uColumn, uv);

        // --- the tub (floor/walls) under the water: enamel, AO, caustics, dye-coloured light
        vec3 floorCol;
        {
          // where did the sun ray that reaches H enter the water?
          vec3 E = H + Lw * (hitDepth / max(Lw.y, 0.2));
          vec2 euv = domainUV(E.xz);
          // the tub wall shading the floor (ray leaves the opening at the rim?)
          vec3 Rm = E + L * ((TUB_RIM - uWaterY) / max(L.y, 0.2));
          float wallSh = smoothstep(0.03, -0.05, tubDist(Rm.xz, TUB_DEPTH));
          float sSun = shadowAt(E) * wallSh;
          // light passing through the dye column above the hit point
          vec3 tint = texture2D(uTint, euv).rgb;
          // caustics, bent by the surface ripples
          vec2 cp = H.xz * 15.0 + n.xz * 2.5 + vec2(7.31, 3.17);
          float ca = causticPattern(cp, t * 0.45) * 1.1;
          #if CAUS2 == 1
          ca += causticPattern(cp * 1.7 + 3.0, t * 0.6 + 2.0) * 0.5;
          #else
          ca *= 1.2;
          #endif
          float cAmt = 0.25 + 0.75 * clamp(hitDepth * 4.0, 0.0, 1.0);
          float caus = mix(1.0, clamp(0.6 + ca * 0.9, 0.4, 2.2), cAmt);
          float ndl = max(dot(nT, Lw), 0.0);
          // ambient occlusion in the floor fillet / deep corners
          float ao = aoT;
          vec3 enamel = vec3(0.86, 0.87, 0.88);
          // the chrome drain plug
          vec2 dd = H.xz - vec2(${TUB.drainX.toFixed(3)}, 0.0);
          float plug = isFloor * smoothstep(0.026, 0.024, length(dd));
          vec3 chrome = vec3(0.32, 0.33, 0.35) * (ambient + uBounceCol * 0.5) * (0.7 + 0.6 * smoothstep(0.02, 0.026, length(dd)));
          vec3 lit = enamel * (uSunCol * 0.36 * sSun * ndl * caus * tint + (ambient * 1.35 + uBounceCol * 0.75) * tint * ao);
          // candle flames above the rim pool warm light on the floor (through the dye)
          for (int i = 0; i < 4; i++) {
            if (uPts[i].w <= 0.0) continue;
            vec3 lp = uPts[i].xyz - H; float d2 = dot(lp, lp);
            lit += enamel * uPtCol[i] * uPts[i].w * max(dot(nT, normalize(lp)), 0.0) * 0.35 / (d2 + 0.04) * tint * smoothstep(0.58, 0.66, uPts[i].y);
          }
          // a whisper of natural aqua with depth
          lit *= exp(-vec3(0.55, 0.12, 0.10) * (hitDepth + tHit) * 0.6);
          floorCol = mix(lit, chrome * (0.6 + 0.4 * ca), plug);
          floorCol *= mix(1.0, 0.5, smoothstep(0.03, 0.0, length(dd)) * (1.0 - plug) * isFloor * 0.0 + smoothstep(0.034, 0.026, length(dd)) * smoothstep(0.024, 0.027, length(dd)) * isFloor);
        }

        // --- the dye volume along the refracted ray: 3 layers, 2 samples each, then the surface film
        vec3 acc = vec3(0.0);
        vec3 T = vec3(1.0);
        float pathScale = 1.0 / max(-Rd.y, 0.25);
        // light inside the volume: sun through the column above + ambient
        vec3 Ldir = uSunCol * max(Lw.y, 0.0);
        // layers back-to-front would be cheaper to reason about; do front-to-back from just under the film
        float dL[3]; dL[0] = 0.10; dL[1] = 0.32; dL[2] = 0.62;
        float thick[3]; thick[0] = 0.05; thick[1] = 0.08; thick[2] = 0.12;
        vec3 accV = vec3(0.0); vec3 TV = vec3(1.0);
        vec4 meanC = texture2D(uMean, vec2(0.5)) * 0.9;
        for (int k = 0; k < 3; k++) {
          for (int j = 0; j < VSAMP; j++) {
            float dd = (dL[k] + (VSAMP == 1 ? 0.0 : (float(j) - 0.5) * thick[k] * 0.6)) * h;
            if (dd > hitDepth) continue;
            vec3 Q = P + Rd * (dd / max(-Rd.y, 0.05));
            vec2 quv = domainUV(Q.xz);
            vec4 c = k == 0 ? texture2D(uDye1, quv) : (k == 1 ? texture2D(uDye2, quv) : texture2D(uDye3, quv));
            // colour that has diffused through the whole bath (regional + tub-wide average)
            c += (texture2D(uHaze, quv) * 0.4 + meanC) * uHazeK;
            // sun shadow from everything above this depth (column texture, shifted toward the sun)
            vec2 suv = domainUV(Q.xz + Lw.xz / max(Lw.y, 0.3) * dd);
            vec4 cs = texture2D(uColumn, suv);
            float above = cs.r + (k > 0 ? cs.g : cs.g * 0.5 * float(j)) + (k > 1 ? cs.b : 0.0);
            vec3 light = Ldir * sh * max(exp(-above * 0.15 * uDensity), 0.45) * 0.5 + ambient * 1.0 + uBounceCol * 0.5;
            slab(c * 1.0, thick[k] * (VSAMP == 1 ? 1.0 : 0.5) * h * pathScale * 14.0, light, accV, TV, 0.10, 0.20);
          }
        }
        vec3 under = accV + TV * floorCol;

        // --- the surface film
        vec4 c0f = texture2D(uDye0, uv);
        vec3 lightS = sunAtSurf * max(dot(n, L), 0.0) * 0.5 + ambient * 0.95 + uBounceCol * 0.25;
        vec3 film = vec3(0.0); vec3 TF = vec3(1.0);
        slab(c0f, 0.06 * 14.0 * pathScale, lightS, film, TF, 0.55, 0.55);
        vec3 body = film + TF * under;

        // --- foam: continuous lacy patches with bubble texture + a dense froth halo at the bomb
        float fl = clamp(foamS.r, 0.0, 1.5), fz = clamp(foamS.g, 0.0, 2.0);
        float foamA = 0.0; vec3 foamC = vec3(0.0); vec4 c0 = texture2D(uDye0, uv);
        if (fl + fz > 0.02) {
        vec3 foamLight = sunAtSurf * max(dot(n, L), 0.0) * 0.55 + ambient * 1.05 + uBounceCol * 0.2;
        // foam: soft white lace (no visible cell network at this distance), fine bubble grain
        float fw = length(fwidth(P.xz));
        vec4 vs = voro(P.xz * 520.0 + vec2(1.3, 2.9));
        float lodS = smoothstep(0.45, 0.2, fw * 520.0);
        float grain = mix(0.5, smoothstep(0.0, 0.5, vs.x), lodS);
        float holes = fbm2(P.xz * 26.0 + vec2(t * 0.012, 3.0)) * 0.75 + 0.25 * vnoise(P.xz * 90.0);
        float lace = smoothstep(0.36, 0.62, fl * 0.8 + (holes - 0.5) * 0.9);
        float froth = smoothstep(0.25, 0.9, fz);
        float fThick = max(lace * clamp(fl, 0.0, 1.0), froth);
        foamA = clamp(max(lace * 0.8, froth * (0.55 + 0.4 * grain)), 0.0, 0.97);
        // brighter where thick, a faint blue-grey where it thins to a film
        foamC = vec3(0.97, 0.97, 0.985) * foamLight * mix(0.78, 1.04, smoothstep(0.0, 0.8, fThick)) * (0.9 + 0.12 * grain);
        float gl = lodS * step(0.93, vs.w) * smoothstep(0.3, 0.08, vs.x) * fThick;
        foamC += gl * uSunCol * sh * 0.3;
        float sd0 = c0.a;
        // the fizz froth is made of the bomb's own coloured powder; lasting lace is paler
        vec3 dc = normalize(dyeColor(c0) + 0.06) * 1.6;
        float tintAmt = mix(clamp(sd0 * 0.1, 0.0, 0.25), clamp(sd0 * 0.22, 0.0, 0.62), froth);
        foamC *= mix(vec3(1.0), dc * 0.85 + 0.12, tintAmt);
        }

        // meniscus: a bright thin line where the water meets the wall
        float men = smoothstep(-0.006, 0.0, wd) * (1.0 - smoothstep(0.0, 0.003, wd));

        vec3 col = mix(body, refl, F);
        col = mix(col, foamC, foamA);
        col += refl * men * 0.25;
        col += uGlow * vec3(0.0);
        if (uDebug == 1) { col = mix(vec3(1.0), dyeColor(c0), 1.0 - exp(-c0.a * 1.5)); }
        if (uDebug == 2) { vec4 c1 = texture2D(uDye1, uv); col = mix(vec3(1.0), dyeColor(c1), 1.0 - exp(-c1.a * 1.5)); }
        if (uDebug == 3) col = vec3(foamS.r, foamS.g, 0.0);
        if (uDebug == 5) col = under * (1.0 - F);
        if (uDebug == 6) col = refl * F;
        if (uDebug == 7) col = floorCol;
        if (uDebug == 4) { col = vec3(0.2); if (any(isnan(floorCol)) || any(isinf(floorCol))) col.r = 50.0; if (any(isnan(accV)) || any(isinf(accV))) col.g = 50.0; if (any(isnan(film)) || any(isinf(film))) col.b = 50.0; if (any(isnan(refl)) || any(isinf(refl))) col = vec3(50.0); if (any(isnan(foamC))) col = vec3(50.0, 0.0, 50.0); }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.name = 'Water';

  function update(time) {
    const T = fluid.textures();
    uniforms.uDye0.value = T.dye0; uniforms.uDye1.value = T.dye1; uniforms.uDye2.value = T.dye2; uniforms.uDye3.value = T.dye3;
    uniforms.uFoam.value = T.foam; uniforms.uRipple.value = T.ripple; uniforms.uColumn.value = T.column; uniforms.uHaze.value = T.haze; uniforms.uMean.value = T.mean; uniforms.uTint.value = T.tint;
    uniforms.uWaterY.value = fluid.waterY;
    uniforms.uTime.value = time;
  }
  return { mesh, mat, uniforms, update };
}
