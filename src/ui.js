// Minimal product-showcase UI: a floating pill with tabs + round swatches, a hint line, and a small
// icon cluster. Everything lives in #ui; H hides it all.
import { PALETTES, SHAPE_LIST, PATTERN_LIST, GLITTER, INSIDE, MOODS, PRESETS } from './presets.js';

const ICON = {
  shuffle: '<path d="M4 7h3.5c2.2 0 3.3 1 4.5 3l1 1.8c1.2 2 2.3 3.2 4.5 3.2H20M4 17h3.5c1.4 0 2.3-.5 3-1.4M17 4.5 20 7l-3 2.5M17 12.5 20 15l-3 2.5M13.5 8.4c.7-.9 1.6-1.4 3-1.4H20"/>',
  overhead: '<rect x="4" y="6" width="16" height="12" rx="6"/><circle cx="12" cy="12" r="2.2"/>',
  save: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/>',
  drain: '<circle cx="12" cy="12" r="7.5"/><path d="M12 7.6a4.4 4.4 0 1 1-4.1 6 2.6 2.6 0 1 1 4.6-2.2"/>',
  sound: '<path d="M5 9.5h3l4-3.5v12l-4-3.5H5z"/><path d="M15.5 9a4 4 0 0 1 0 6M17.8 6.8a7 7 0 0 1 0 10.4"/>',
  mute: '<path d="M5 9.5h3l4-3.5v12l-4-3.5H5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  film: '<rect x="4" y="6" width="16" height="12" rx="2.5"/><path d="M10 9.5v5l4.2-2.5z"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

const INSIDE_ICON = {
  none: '<circle cx="22" cy="22" r="9" fill="none" stroke="#b9b4ad" stroke-width="2" stroke-dasharray="3 3"/>',
  petals: '<g transform="translate(22 22)"><path d="M0 -12c6 0 9 5 7 10-2 4-7 4-7 4s-5 0-7-4c-2-5 1-10 7-10z" fill="#d93a5c"/><path d="M-9 2c3-5 9-4 11 0 2 5-2 9-6 9s-8-4-5-9z" fill="#b8243f"/><path d="M9 2c-3-5-9-4-11 0-2 5 2 9 6 9s8-4 5-9z" fill="#e2557a"/></g>',
  lavender: '<g transform="translate(22 22)"><path d="M0 14V-6" stroke="#6b8a4e" stroke-width="1.8"/><g fill="#8a63cf"><ellipse cx="-2.6" cy="-12" rx="2.2" ry="3"/><ellipse cx="2.6" cy="-10" rx="2.2" ry="3"/><ellipse cx="-2.6" cy="-6" rx="2.2" ry="3"/><ellipse cx="2.6" cy="-4" rx="2.2" ry="3"/><ellipse cx="-2.4" cy="0" rx="2" ry="2.8"/><ellipse cx="2.4" cy="2" rx="2" ry="2.8"/></g></g>',
  goldleaf: '<g transform="translate(22 22) rotate(-12)"><path d="M-10 -8l7-3 9 2 5 6-2 8-8 4-9-2-4-7z" fill="url(#gl)"/></g><defs><linearGradient id="gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b0"/><stop offset=".5" stop-color="#e6b34a"/><stop offset="1" stop-color="#a87418"/></linearGradient></defs>',
  confetti: '<g><circle cx="14" cy="15" r="3" fill="#ff5fa8"/><circle cx="28" cy="12" r="2.6" fill="#4fb6ff"/><circle cx="31" cy="26" r="3" fill="#ffd25a"/><circle cx="18" cy="29" r="2.6" fill="#8d62ff"/><circle cx="23" cy="20" r="2.2" fill="#3ccf9a"/></g>',
  duck: '<g transform="translate(22 24)"><ellipse cx="0" cy="3" rx="11" ry="7" fill="#ffcf1f"/><circle cx="5" cy="-6" r="6" fill="#ffcf1f"/><path d="M10 -5l6 1-6 3z" fill="#ff7a12"/><circle cx="6.5" cy="-7.5" r="1.2" fill="#111"/><path d="M-11 0c-3-3-3-6 0-7 1 3 3 5 5 6z" fill="#ffcf1f"/></g>',
};
const GLITTER_BG = {
  none: 'radial-gradient(circle at 35% 30%, #ffffff, #e9e4dd)',
  gold: 'radial-gradient(circle at 30% 28%, #fff6cf 0 8%, transparent 9%), radial-gradient(circle at 65% 60%, #fff3c0 0 6%, transparent 7%), radial-gradient(circle at 45% 70%, #ffe9a0 0 5%, transparent 6%), radial-gradient(circle at 40% 35%, #f4cf6b, #c58b1e 70%, #9a6510)',
  silver: 'radial-gradient(circle at 30% 28%, #ffffff 0 8%, transparent 9%), radial-gradient(circle at 65% 60%, #ffffff 0 6%, transparent 7%), radial-gradient(circle at 45% 70%, #f4f8ff 0 5%, transparent 6%), radial-gradient(circle at 40% 35%, #eef2f8, #a9b3c2 70%, #7d8796)',
  holo: 'radial-gradient(circle at 30% 28%, #ffffff 0 8%, transparent 9%), radial-gradient(circle at 65% 60%, #ffffff 0 6%, transparent 7%), conic-gradient(from 30deg, #ff9ad5, #9fd0ff, #b8ffd9, #fff2a0, #ffb3e6, #b9a8ff, #ff9ad5)',
  rose: 'radial-gradient(circle at 30% 28%, #fff1ec 0 8%, transparent 9%), radial-gradient(circle at 65% 60%, #ffe8e0 0 6%, transparent 7%), radial-gradient(circle at 40% 35%, #f8c7b6, #d98a78 70%, #b0634f)',
};
const MOOD_BG = {
  morning: 'radial-gradient(circle at 30% 25%, #ffffff, #e7eef7 55%, #c9d6e6)',
  golden: 'radial-gradient(circle at 30% 25%, #fff1cf, #ffc472 55%, #e2833a)',
  night: 'radial-gradient(circle at 62% 62%, #ffcf7a 0 7%, #ff9c3b 9%, transparent 20%), radial-gradient(circle at 30% 25%, #3b4a74, #1a2240 60%, #0d1022)',
};

export class UI {
  constructor(root, h) {
    this.root = root; this.h = h;
    this.tab = 'signature';
    this.thumbs = {};
    root.innerHTML = `
      <div class="brand">Fizz</div>
      <div class="tools" role="toolbar" aria-label="Tools">
        <button data-tool="shuffle" title="Surprise me">${svg('shuffle')}</button>
        <button data-tool="overhead" title="Overhead view">${svg('overhead')}</button>
        <button data-tool="save" title="Save the painting (PNG)">${svg('save')}</button>
        <button data-tool="drain" title="Pull the plug">${svg('drain')}</button>
        <button data-tool="mute" title="Sound">${svg('sound')}</button>
      </div>
      <div class="dockwrap">
        <div class="hint" aria-live="polite"></div>
        <div class="dock">
          <div class="tabs" role="tablist"></div>
          <div class="swatches" role="listbox"></div>
          <div class="caption"></div>
        </div>
      </div>
      <div class="toast"></div>`;
    this.tabsEl = root.querySelector('.tabs');
    this.swEl = root.querySelector('.swatches');
    this.capEl = root.querySelector('.caption');
    this.hintEl = root.querySelector('.hint');
    this.toastEl = root.querySelector('.toast');
    const TABS = [['signature', 'Signature'], ['shape', 'Shape'], ['colours', 'Colours'], ['pattern', 'Pattern'], ['glitter', 'Glitter'], ['inside', 'Inside'], ['mood', 'Mood']];
    this.tabsEl.innerHTML = TABS.map(([k, n]) => `<button role="tab" data-tab="${k}">${n}</button>`).join('');
    this.tabsEl.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; this.tab = b.dataset.tab; this.render(); h.onTab?.(this.tab); });
    root.querySelector('.tools').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) h.onTool?.(b.dataset.tool, b); });
    this.swEl.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.pick(b.dataset.k); });
    this.swEl.addEventListener('pointerover', (e) => { const b = e.target.closest('button'); if (b) this.capEl.textContent = b.title; });
    this.swEl.addEventListener('pointerleave', () => this.caption());
    this.hint('Tap the water to drop your bath bomb · drag through it to stir');
  }

  setState(design, mood, presetId) { this.design = design; this.mood = mood; this.preset = presetId; this.render(); }

  items() {
    const d = this.design;
    switch (this.tab) {
      case 'signature': return PRESETS.map((p) => ({ k: p.id, name: p.name, img: this.thumbs['preset:' + p.id], sel: this.preset === p.id }));
      case 'shape': return SHAPE_LIST.map((s) => ({ k: s.id, name: s.name, img: this.thumbs[`shape:${s.id}:${d.palette}:${d.pattern}`], sel: d.shape === s.id }));
      case 'colours': return Object.entries(PALETTES).map(([k, p]) => ({ k, name: p.name, bg: `conic-gradient(from 200deg, ${p.colors[0]} 0 33%, ${p.colors[1]} 0 66%, ${p.colors[2]} 0)`, sel: d.palette === k }));
      case 'pattern': return PATTERN_LIST.map((p) => ({ k: p.id, name: p.name, img: this.thumbs[`pattern:${p.id}:${d.palette}`], sel: d.pattern === p.id }));
      case 'glitter': return Object.entries(GLITTER).map(([k, g]) => ({ k, name: g.name, bg: GLITTER_BG[k], sel: d.glitter === k }));
      case 'inside': return Object.entries(INSIDE).map(([k, g]) => ({ k, name: g.name, svg: INSIDE_ICON[k], sel: d.inside === k }));
      case 'mood': return Object.entries(MOODS).map(([k, m]) => ({ k, name: m.name, bg: MOOD_BG[k], sel: this.mood === k }));
    }
    return [];
  }

  render() {
    if (!this.design) return;
    for (const b of this.tabsEl.children) b.setAttribute('aria-selected', b.dataset.tab === this.tab ? 'true' : 'false');
    this.swEl.innerHTML = this.items().map((it) => {
      let inner = '';
      if (it.img) inner = `<img src="${it.img}" alt="">`;
      else if (it.svg) inner = `<svg viewBox="0 0 44 44">${it.svg}</svg>`;
      else if (it.bg) inner = `<span class="fill" style="background:${it.bg}"></span>`;
      else inner = `<span class="fill" style="background:radial-gradient(circle at 35% 30%,#fff,#e8e2da)"></span>`;
      return `<button role="option" aria-selected="${it.sel}" class="sw${it.sel ? ' sel' : ''}" data-k="${it.k}" title="${it.name}">${inner}</button>`;
    }).join('');
    this.caption();
  }

  caption() {
    const sel = this.items().find((i) => i.sel);
    this.capEl.textContent = sel ? sel.name : '';
  }

  pick(k) {
    const h = this.h;
    switch (this.tab) {
      case 'signature': h.onPreset?.(k); break;
      case 'shape': h.onDesign?.({ shape: k }); break;
      case 'colours': h.onDesign?.({ palette: k }); break;
      case 'pattern': h.onDesign?.({ pattern: k }); break;
      case 'glitter': h.onDesign?.({ glitter: k }); break;
      case 'inside': h.onDesign?.({ inside: k }); break;
      case 'mood': h.onMood?.(k); break;
    }
  }

  setThumb(key, url) { this.thumbs[key] = url; if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); }); }
  hint(text) { this.hintEl.textContent = text; }
  toast(text) { this.toastEl.textContent = text; this.toastEl.classList.add('on'); clearTimeout(this._tt); this._tt = setTimeout(() => this.toastEl.classList.remove('on'), 1800); }
  setMuted(m) { this.root.querySelector('[data-tool="mute"]').innerHTML = svg(m ? 'mute' : 'sound'); }
  setActive(tool, on) { this.root.querySelector(`[data-tool="${tool}"]`)?.classList.toggle('on', on); }
  setHidden(v) { this.root.classList.toggle('hidden', v); }
  setDark(v) { this.root.classList.toggle('dark', v); }
}
