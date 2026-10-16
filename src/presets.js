// Curated palettes (each mix stays beautiful), patterns, glitter, contents and the signature presets.

export const PALETTES = {
  galaxy: { name: 'Galaxy', colors: ['#5a2ee0', '#1f63f0', '#ff4fae'] },
  sunset: { name: 'Sunset', colors: ['#ff5a3c', '#ff2d84', '#ffb22e'] },
  ocean: { name: 'Ocean', colors: ['#0f5fe0', '#00b4b0', '#4fd8ff'] },
  lavender: { name: 'Lavender dream', colors: ['#8d62ff', '#e48cff', '#5f86ff'] },
  candy: { name: 'Cotton candy', colors: ['#ff6fc4', '#5cc4ff', '#b98cff'] },
  emerald: { name: 'Emerald', colors: ['#06956a', '#14c7a3', '#e9b938'] },
};

export const SHAPE_LIST = [
  { id: 'sphere', name: 'Sphere' },
  { id: 'heart', name: 'Heart' },
  { id: 'star', name: 'Star' },
  { id: 'moon', name: 'Half-moon' },
];

export const PATTERN_LIST = [
  { id: 'marble', name: 'Marbled swirl' },
  { id: 'ombre', name: 'Ombré' },
  { id: 'stripes', name: 'Layered stripes' },
  { id: 'speckle', name: 'Speckled' },
  { id: 'galaxy', name: 'Galaxy' },
];

export const GLITTER = {
  none: { name: 'No glitter', color: null },
  gold: { name: 'Gold', color: '#ffc95a' },
  silver: { name: 'Silver', color: '#e8eef7' },
  holo: { name: 'Holographic', color: 'holo' },
  rose: { name: 'Rose gold', color: '#ffb0a0' },
};

export const INSIDE = {
  none: { name: 'Nothing' },
  petals: { name: 'Rose petals' },
  lavender: { name: 'Lavender buds' },
  goldleaf: { name: 'Gold leaf' },
  confetti: { name: 'Confetti burst' },
  duck: { name: 'Toy duck' },
};

export const MOODS = {
  morning: { name: 'Morning' },
  golden: { name: 'Golden hour' },
  night: { name: 'Candlelit' },
};

export const PRESETS = [
  { id: 'galaxy', name: 'Galaxy', shape: 'sphere', palette: 'galaxy', pattern: 'galaxy', glitter: 'gold', inside: 'confetti' },
  { id: 'sunsetrose', name: 'Sunset Rose', shape: 'heart', palette: 'sunset', pattern: 'marble', glitter: 'rose', inside: 'petals' },
  { id: 'oceanpearl', name: 'Ocean Pearl', shape: 'moon', palette: 'ocean', pattern: 'ombre', glitter: 'silver', inside: 'duck' },
  { id: 'lavender', name: 'Lavender Dream', shape: 'sphere', palette: 'lavender', pattern: 'marble', glitter: 'holo', inside: 'lavender' },
  { id: 'cottoncandy', name: 'Cotton Candy', shape: 'star', palette: 'candy', pattern: 'stripes', glitter: 'holo', inside: 'confetti' },
  { id: 'emeraldgold', name: 'Emerald Gold', shape: 'sphere', palette: 'emerald', pattern: 'speckle', glitter: 'gold', inside: 'goldleaf' },
];

export function designFromPreset(p) {
  return { shape: p.shape, palette: p.palette, pattern: p.pattern, glitter: p.glitter, inside: p.inside, seed: Math.random() * 10 };
}

export function randomDesign(rng = Math.random) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return {
    shape: pick(SHAPE_LIST).id,
    palette: pick(Object.keys(PALETTES)),
    pattern: pick(PATTERN_LIST).id,
    glitter: pick(['gold', 'silver', 'holo', 'rose', 'gold', 'none']),
    inside: pick(['petals', 'lavender', 'goldleaf', 'confetti', 'duck']),
    seed: rng() * 10,
  };
}
