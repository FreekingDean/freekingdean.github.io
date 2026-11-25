// Turn any image into a small pixel-art picture: shrink it, then boil its
// colours down to a handful with k-means so each colour can be a crate.

export function loadImage(src, cors) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load that image.'));
    img.src = src;
  });
}

export function loremUrl(seed) {
  return `https://picsum.photos/seed/nibblecrate-${seed}/360/360`;
}

const KEYS = '0123456789abcdefghij';

// size: the long side, in pixels. colors: how many crate colours.
export function pixelate(img, size, colors) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  // Keep photos roughly square so they fit the screen: crop to at most 4:3.
  let sx = 0, sy = 0, sw = iw, sh = ih;
  if (sw / sh > 4 / 3) { sw = Math.round(sh * 4 / 3); sx = Math.round((iw - sw) / 2); }
  if (sh / sw > 4 / 3) { sh = Math.round(sw * 4 / 3); sy = Math.round((ih - sh) / 2); }
  const w = sw >= sh ? size : Math.round(size * sw / sh);
  const h = sh >= sw ? size : Math.round(size * sh / sw);

  // Shrink in steps so the result averages nicely instead of aliasing.
  let src = img, cw = sw, ch = sh, ox = sx, oy = sy;
  while (cw / 2 > w * 2) {
    const c = document.createElement('canvas');
    c.width = Math.round(cw / 2); c.height = Math.round(ch / 2);
    const cx = c.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(src, ox, oy, cw, ch, 0, 0, c.width, c.height);
    src = c; cw = c.width; ch = c.height; ox = 0; oy = 0;
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(src, ox, oy, cw, ch, 0, 0, w, h);
  const data = cx.getImageData(0, 0, w, h).data; // throws if the image is cross-origin without CORS

  // Pixels, with a little extra saturation and contrast so it pops.
  const px = [];
  for (let i = 0; i < w * h; i++) {
    let r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    if (a < 128) { px.push(null); continue; }
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = 1.25, con = 1.08;
    r = (l + (r - l) * sat - 128) * con + 128;
    g = (l + (g - l) * sat - 128) * con + 128;
    b = (l + (b - l) * sat - 128) * con + 128;
    px.push([clamp(r), clamp(g), clamp(b)]);
  }
  const solid = px.filter(Boolean);
  let centers = kmeans(solid, colors);

  // Merge colours that are too close to tell apart as crates.
  centers.sort((a, b) => lum(a) - lum(b));
  const merged = [];
  for (const c of centers) {
    if (!merged.some((m) => dist(m, c) < 40 * 40)) merged.push(c);
  }
  centers = merged;

  const palette = {};
  centers.forEach((c, i) => { palette[KEYS[i]] = hex(c); });
  const grid = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const p = px[y * w + x];
      row.push(p ? KEYS[nearest(centers, p)] : null);
    }
    grid.push(row);
  }
  return { w, h, grid, palette };
}

function kmeans(points, k) {
  // k-means++ seeding with a fixed little generator, so the same image gives
  // the same picture.
  let s = 12345;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const centers = [points[Math.floor(rand() * points.length)].slice()];
  while (centers.length < k) {
    const d = points.map((p) => Math.min(...centers.map((c) => dist(c, p))));
    const sum = d.reduce((a, b) => a + b, 0);
    if (!sum) break;
    let t = rand() * sum, i = 0;
    while (t > d[i]) t -= d[i++];
    centers.push(points[Math.min(i, points.length - 1)].slice());
  }
  for (let it = 0; it < 12; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (const p of points) {
      const a = acc[nearest(centers, p)];
      a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; a[3]++;
    }
    acc.forEach((a, i) => { if (a[3]) centers[i] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  return centers;
}

function nearest(centers, p) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const d = dist(centers[i], p);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function dist(a, b) {
  // Weighted RGB distance; close enough to perceptual for this.
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}
const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const hex = (c) => '#' + c.map((v) => clamp(v).toString(16).padStart(2, '0')).join('');
