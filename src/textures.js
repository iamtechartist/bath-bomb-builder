// Small procedural canvas textures (wood grain, terry towel, leaf) for the Blender props.
import * as THREE from 'three';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function woodTexture() {
  const [c, g] = canvas(1024, 256);
  const r = rng(7);
  g.fillStyle = '#b07a4c'; g.fillRect(0, 0, 1024, 256);
  for (let i = 0; i < 260; i++) {
    const y = r() * 256, a = 0.04 + r() * 0.1;
    g.strokeStyle = r() < 0.5 ? `rgba(80,45,20,${a})` : `rgba(230,180,120,${a * 0.8})`;
    g.lineWidth = 0.6 + r() * 2.2;
    g.beginPath();
    let yy = y;
    g.moveTo(0, yy);
    for (let x = 0; x <= 1024; x += 32) { yy += (r() - 0.5) * 2.2; g.lineTo(x, yy + Math.sin(x * 0.01 + i) * 2); }
    g.stroke();
  }
  // a couple of soft knots
  for (let k = 0; k < 3; k++) {
    const x = r() * 1024, y = r() * 256;
    const gr = g.createRadialGradient(x, y, 1, x, y, 26);
    gr.addColorStop(0, 'rgba(70,38,15,0.5)'); gr.addColorStop(1, 'rgba(70,38,15,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, 30, 9, 0, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

export function terryTexture() {
  const [c, g] = canvas(256, 256);
  const r = rng(11);
  g.fillStyle = '#efe7da'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const x = r() * 256, y = r() * 256, l = 200 + r() * 55;
    g.fillStyle = `rgba(${l},${l - 8},${l - 20},${0.25 + r() * 0.35})`;
    g.beginPath(); g.arc(x, y, 0.8 + r() * 1.4, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 2600; i++) {
    const x = r() * 256, y = r() * 256;
    g.fillStyle = `rgba(120,100,80,${0.06 + r() * 0.08})`;
    g.fillRect(x, y, 1.2, 1.2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6);
  return t;
}

export function terryBump() {
  const [c, g] = canvas(256, 256);
  const r = rng(13);
  g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 7000; i++) {
    const x = r() * 256, y = r() * 256, l = Math.floor(90 + r() * 165);
    g.fillStyle = `rgb(${l},${l},${l})`;
    g.beginPath(); g.arc(x, y, 1 + r() * 1.3, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6);
  return t;
}
