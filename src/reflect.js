// Planar reflection of the room in the water (mirrored camera + oblique near plane), HDR target.
import * as THREE from 'three';

export class PlanarReflection {
  constructor(renderer) {
    this.r = renderer;
    this.cam = new THREE.PerspectiveCamera();
    this.cam.layers.enableAll();
    this.target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 0 });
    this.matrix = new THREE.Matrix4();
    this.scale = 0.5;
    this._v = { n: new THREE.Vector3(0, 1, 0), p: new THREE.Vector3(), cp: new THREE.Vector3(), rot: new THREE.Matrix4(), look: new THREE.Vector3(),
      view: new THREE.Vector3(), tgt: new THREE.Vector3(), plane: new THREE.Plane(), clip: new THREE.Vector4(), q: new THREE.Vector4() };
  }
  setSize(w, h) { this.target.setSize(Math.max(2, Math.round(w * this.scale)), Math.max(2, Math.round(h * this.scale))); }

  render(scene, camera, y, hide = []) {
    const v = this._v, cam = this.cam;
    v.p.set(0, y, 0);
    v.cp.setFromMatrixPosition(camera.matrixWorld);
    v.view.subVectors(v.p, v.cp);
    if (v.view.dot(v.n) > 0) return false;
    v.view.reflect(v.n).negate().add(v.p);
    v.rot.extractRotation(camera.matrixWorld);
    v.look.set(0, 0, -1).applyMatrix4(v.rot).add(v.cp);
    v.tgt.subVectors(v.p, v.look).reflect(v.n).negate().add(v.p);
    cam.position.copy(v.view);
    cam.up.set(0, 1, 0).applyMatrix4(v.rot).reflect(v.n);
    cam.lookAt(v.tgt);
    cam.far = camera.far; cam.near = camera.near;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);
    this.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.matrix.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    v.plane.setFromNormalAndCoplanarPoint(v.n, v.p).applyMatrix4(cam.matrixWorldInverse);
    v.clip.set(v.plane.normal.x, v.plane.normal.y, v.plane.normal.z, v.plane.constant);
    const e = cam.projectionMatrix.elements;
    v.q.set((Math.sign(v.clip.x) + e[8]) / e[0], (Math.sign(v.clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    v.clip.multiplyScalar(2 / v.clip.dot(v.q));
    e[2] = v.clip.x; e[6] = v.clip.y; e[10] = v.clip.z + 1 - 0.002; e[14] = v.clip.w;
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    const prev = this.r.getRenderTarget();
    const sa = this.r.shadowMap.autoUpdate; this.r.shadowMap.autoUpdate = false;
    this.r.setRenderTarget(this.target);
    this.r.clear();
    this.r.render(scene, cam);
    this.r.setRenderTarget(prev);
    this.r.shadowMap.autoUpdate = sa;
    hide.forEach((o, i) => { o.visible = vis[i]; });
    return true;
  }
}
