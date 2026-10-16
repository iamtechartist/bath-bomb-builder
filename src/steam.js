// Warm steam: a few slow, thin wisps drifting up off the water, brightest where they catch the window
// light from behind (forward scattering). Kept faint so the frame stays crisp.
import * as THREE from 'three';
import { GLSL_NOISE } from './glsl.js';

export class Steam {
  constructor(scene) {
    this.u = { uTime: { value: 0 }, uLight: { value: new THREE.Vector3(1, 0.95, 0.9) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uAmt: { value: 0.5 }, uWaterY: { value: 0.45 } };
    this.group = new THREE.Group();
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.NormalBlending, side: THREE.DoubleSide,
      vertexShader: `uniform float uTime, uWaterY; attribute float seed; varying vec2 vUv; varying float vSeed; varying vec3 vW;
        void main(){ vUv = uv; vSeed = seed;
          vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          c.y = uWaterY + 0.03;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 p = c + right * position.x * 0.55 + vec3(0.0, 1.0, 0.0) * (position.y + 0.5) * 0.5;
          vW = p;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `uniform float uTime, uAmt; uniform vec3 uLight, uSunDir; varying vec2 vUv; varying float vSeed; varying vec3 vW;
        ${GLSL_NOISE}
        void main(){
          vec2 q = vUv;
          float t = uTime * 0.05 + vSeed * 10.0;
          vec2 w = vec2(fbm2(vec2(q.x * 2.0, q.y * 1.5 - t * 1.5) + vSeed), fbm2(vec2(q.x * 2.0 + 5.0, q.y * 1.5 - t * 1.2)));
          float n = fbm2(vec2(q.x * 3.0, q.y * 2.2 - t * 2.0) + w * 1.8 + vSeed * 3.0);
          float wisp = smoothstep(0.52, 0.78, n) * smoothstep(0.0, 0.25, q.y) * smoothstep(1.0, 0.45, q.y) * smoothstep(0.5, 0.15, abs(q.x - 0.5));
          vec3 V = normalize(cameraPosition - vW);
          float back = pow(max(dot(-V, normalize(uSunDir)), 0.0), 3.0);
          gl_FragColor = vec4(uLight * (0.5 + 1.5 * back), wisp * 0.13 * uAmt);
        }`,
    });
    const g = new THREE.PlaneGeometry(1, 1);
    this.wisps = [];
    const spots = [[-0.4, 0.05], [-0.05, -0.12], [0.28, 0.08], [0.1, 0.18], [-0.22, -0.02]];
    spots.forEach(([x, z], i) => {
      const gg = g.clone();
      gg.setAttribute('seed', new THREE.BufferAttribute(new Float32Array(4).fill(i * 1.37 + 0.3), 1));
      const m = new THREE.Mesh(gg, mat);
      m.position.set(x, 0.5, z); m.frustumCulled = false; m.renderOrder = 14;
      this.group.add(m); this.wisps.push({ m, x, z, ph: i * 1.7 });
    });
    scene.add(this.group);
  }
  update(t, waterY, visible = true) {
    this.u.uTime.value = t; this.u.uWaterY.value = waterY;
    this.group.visible = visible;
    for (const w of this.wisps) { w.m.position.x = w.x + Math.sin(t * 0.07 + w.ph) * 0.08; w.m.position.z = w.z + Math.cos(t * 0.05 + w.ph) * 0.05; }
  }
}
