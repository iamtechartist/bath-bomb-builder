// Fallback tub mesh built from the shared interior formula (used until/unless assets/props.glb loads).
import * as THREE from 'three';
import { TUB, tubSection } from './config.js';

function ring(A, B, n, y, segs, out) {
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    out.push(A * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), y, B * Math.sign(s) * Math.pow(Math.abs(s), 2 / n));
  }
}

export function buildTubGeometry() {
  const segs = 160;
  const pos = [];
  const rows = [];
  // interior from the floor centre up to the rim, then over the rolled lip and down the outside
  const hs = [];
  for (let i = 0; i <= 14; i++) hs.push(TUB.fillet * (1 - Math.cos((i / 14) * Math.PI / 2)));
  for (let i = 1; i <= 24; i++) hs.push(TUB.fillet + (TUB.depth - TUB.fillet) * (i / 24));
  // floor centre ring (tiny)
  rows.push(pos.length / 3); ring(0.02, 0.006, 3, TUB.floorY, segs, pos);
  for (const h of hs) { const s = tubSection(h); rows.push(pos.length / 3); ring(s.A, s.B, s.n, TUB.floorY + h, segs, pos); }
  const top = tubSection(TUB.depth);
  // rolled lip: semicircle from inner rim to outer rim
  const lipR = 0.035;
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    const off = lipR - lipR * Math.cos(a);
    rows.push(pos.length / 3);
    ring(top.A + off, top.B + off, 3.4, TUB.rimY - lipR + lipR * Math.sin(a) * 0.9 + lipR * 0.0 + (lipR - lipR) , segs, pos);
  }
  // outer wall down to the base
  for (let i = 0; i <= 12; i++) {
    const y = TUB.rimY - lipR - (TUB.rimY - lipR - 0.06) * (i / 12);
    const k = y / 0.6;
    rows.push(pos.length / 3); ring(0.80 + 0.04 * k, 0.35 + 0.04 * k, 3.4, y, segs, pos);
  }
  for (let i = 1; i <= 4; i++) {
    const a = (i / 4) * Math.PI / 2;
    rows.push(pos.length / 3); ring(0.80 - 0.03 * (1 - Math.cos(a)), 0.35 - 0.03 * (1 - Math.cos(a)), 3.4, 0.06 - 0.025 * Math.sin(a), segs, pos);
  }
  rows.push(pos.length / 3); ring(0.70, 0.27, 3.4, 0.035, segs, pos);
  const idx = [];
  for (let r = 0; r < rows.length - 1; r++) {
    const a0 = rows[r], b0 = rows[r + 1];
    for (let i = 0; i < segs; i++) {
      const i1 = (i + 1) % segs;
      idx.push(a0 + i, b0 + i, a0 + i1, a0 + i1, b0 + i, b0 + i1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
