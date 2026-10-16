// Camera rig: damped spherical orbit around a target with limits, named shots (hero, overhead,
// tray) and a slow cinematic path (low glide across the water, then a rise to overhead).
import * as THREE from 'three';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export const SHOTS = {
  hero: { target: [0.08, 0.40, -0.04], yaw: 0.30, pitch: 0.86, dist: 2.35, fov: 34 },
  intro: { target: [-0.04, 0.44, 0.02], yaw: 0.28, pitch: 0.92, dist: 1.42, fov: 34 },
  overhead: { target: [0.0, 0.45, 0.0], yaw: 0.0, pitch: 1.5698, dist: 1.86, fov: 34 },
  tray: { target: [0.6, 0.62, 0.12], yaw: 0.62, pitch: 0.52, dist: 0.78, fov: 32 },
};

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.cur = { target: new THREE.Vector3(...SHOTS.hero.target), yaw: SHOTS.hero.yaw, pitch: SHOTS.hero.pitch, dist: SHOTS.hero.dist, fov: SHOTS.hero.fov };
    this.goal = { target: this.cur.target.clone(), yaw: this.cur.yaw, pitch: this.cur.pitch, dist: this.cur.dist, fov: this.cur.fov };
    this.shot = 'hero';
    this.k = 2.2;
    this.limits = { yaw: [-0.15, 0.85], pitch: [0.42, 1.30] };
    this.cine = null;
    this.apply();
  }

  go(name, k = 2.2) {
    const s = SHOTS[name];
    this.shot = name;
    this.k = k;
    this.goal.target.set(...s.target); this.goal.yaw = s.yaw; this.goal.pitch = s.pitch; this.goal.dist = s.dist; this.goal.fov = s.fov;
  }

  // user orbit (only around hero)
  orbit(dx, dy) {
    if (this.shot === 'overhead' || this.cine) return;
    if (this.shot !== 'hero') this.go('hero');
    this.goal.yaw = THREE.MathUtils.clamp(this.goal.yaw - dx * 0.004, ...this.limits.yaw);
    this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch + dy * 0.003, ...this.limits.pitch);
  }

  // focus: where the colour is (world x, z); the glide passes over it travelling along the tub
  startCinematic(focus = { x: 0, z: 0 }) {
    // the camera glides toward the colour, looking along the tub (toward -x if the colour is on the
    // tap side, toward +x otherwise); it sits ~0.59 m behind its target
    const fx = Math.max(-0.45, Math.min(0.4, focus.x));
    const dir = fx < 0 ? -1 : 1;
    const cl = (v) => Math.max(-0.6, Math.min(0.42, v));
    this.cine = { t: 0, dir, x0: cl(fx - dir * 0.8), x1: cl(fx - dir * 0.34), z: Math.max(-0.1, Math.min(0.1, focus.z)) };
  }
  stopCinematic() { this.cine = null; this.go(this.shot === 'overhead' ? 'overhead' : 'hero'); }

  update(dt) {
    if (this.cine) {
      // 0–10 s: skim ~15 cm above the water from the tap end toward the tray and window;
      // 10–18 s: rise and swing round to straight overhead; then hold with a slow drift
      const c = this.cine; c.t += dt;
      const T1 = 10, T2 = 18;
      const g = this.goal;
      const sm = (u) => { u = Math.min(Math.max(u, 0), 1); return u * u * (3 - 2 * u); };
      if (c.t < T1) {
        const e = sm(c.t / T1);
        g.target.set(c.x0 + (c.x1 - c.x0) * e + c.dir * 0.58, 0.47, c.z);
        g.yaw = -c.dir * Math.PI / 2 + 0.28 * Math.sin(e * Math.PI) - 0.1; g.pitch = 0.2 + 0.03 * Math.sin(e * 3.0); g.dist = 0.62; g.fov = 40;
        this.k = c.t < 0.2 ? 30 : 3.5;
      } else if (c.t < T2) {
        const e = sm((c.t - T1) / (T2 - T1));
        g.target.set((c.x1 + c.dir * 0.58) * (1 - e), 0.47 - 0.02 * e, c.z * (1 - e));
        g.yaw = (-c.dir * Math.PI / 2 - 0.1) * (1 - e) + SHOTS.overhead.yaw * e; g.pitch = 0.2 + (1.5698 - 0.2) * e; g.dist = 0.62 + (SHOTS.overhead.dist - 0.62) * e; g.fov = 40 - 6 * e;
        this.k = 3.0;
      } else {
        g.target.set(0, 0.45, 0); g.pitch = 1.5698; g.dist = SHOTS.overhead.dist; g.fov = 34;
        g.yaw = SHOTS.overhead.yaw + Math.sin((c.t - T2) * 0.05) * 0.25;
        this.k = 2.0;
      }
    }
    const c = this.cur, g = this.goal, k = this.k;
    c.target.x = damp(c.target.x, g.target.x, k, dt); c.target.y = damp(c.target.y, g.target.y, k, dt); c.target.z = damp(c.target.z, g.target.z, k, dt);
    c.yaw = damp(c.yaw, g.yaw, k, dt); c.pitch = damp(c.pitch, g.pitch, k, dt); c.dist = damp(c.dist, g.dist, k, dt); c.fov = damp(c.fov, g.fov, k, dt);
    this.apply();
  }

  snap() { const c = this.cur, g = this.goal; c.target.copy(g.target); c.yaw = g.yaw; c.pitch = g.pitch; c.dist = g.dist; c.fov = g.fov; this.apply(); }

  apply() {
    const c = this.cur, cam = this.cam;
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    cam.position.set(c.target.x + Math.sin(c.yaw) * cp * c.dist, c.target.y + sp * c.dist, c.target.z + Math.cos(c.yaw) * cp * c.dist);
    // overhead: keep "up" pointing to the back wall so the tub reads left-to-right
    if (c.pitch > 1.45) cam.up.set(-Math.sin(c.yaw), 0, -Math.cos(c.yaw)).lerp(new THREE.Vector3(0, 1, 0), (1.5698 - c.pitch) / 0.12).normalize();
    else cam.up.set(0, 1, 0);
    cam.lookAt(c.target);
    if (Math.abs(cam.fov - c.fov) > 1e-3) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
  }

  distance() { return this.cur.dist; }
}
