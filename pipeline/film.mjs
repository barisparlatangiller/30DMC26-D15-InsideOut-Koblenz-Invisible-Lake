// Frame-by-frame film of the Invisible Lake. Usage: node film.mjs  (env: W,H,FPS,FROM,TO,OUT)
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = process.env.ROOT || '/home/claude/d15/site';
const W = +process.env.W || 1080, H = +process.env.H || 1350, FPS = +process.env.FPS || 30, DUR = 28;
const FROM = +process.env.FROM || 0, TO = +(process.env.TO || DUR * FPS);
const OUT = process.env.OUT || '/home/claude/d15/frames'; fs.mkdirSync(OUT, { recursive: true });
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html';
  fs.readFile(path.join(root, u), (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[path.extname(u)] || 'application/octet-stream' }); r.end(d); }); }).listen(8766);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: W, height: H } });
p.on('pageerror', e => console.log('ERR', e.message));
const LOCAL3 = process.env.THREE_DIR || '/home/claude/d15/node_modules/three/';
if (fs.existsSync(LOCAL3)) await p.route(/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.*)/, rt => rt.fulfill({ path: LOCAL3 + rt.request().url().split('three@0.160.0/')[1], contentType: 'text/javascript' }));
await p.goto('http://localhost:8766/?film', { waitUntil: 'load' });
await p.waitForFunction(() => window.Film && window.Film.ready, null, { timeout: 300000 });
await p.evaluate(() => window.Film.bldReady);
await p.evaluate(() => document.fonts.ready);

const plan = await p.evaluate(({ FPS, FROM }) => {
  const F = window.Film, V = F.THREE.Vector3;
  const E = (e, n, z) => F.toWorld(e, n, z);
  const TOP = (e, n, h) => ({ p: E(e, n - h * 0.02, h), t: E(e, n, 60) });   // straight down, north up
  const ease = u => u < .5 ? 4*u*u*u : 1 - Math.pow(-2*u+2, 3)/2;
  const lerp = (a, b, u) => a + (b - a) * u;
  // ---- camera keyframes after the top-down sweep
  const KEYS = [
    [8.6, TOP(400250, 5579850, 19000)],
    [11.0, { p: E(398700, 5576700, 1500), t: E(400600, 5580000, 80) }],
    [12.6, { p: E(398950, 5577050, 1250), t: E(400650, 5580050, 80) }],
    [14.4, { p: E(401300, 5581700, 3400), t: E(399200, 5579000, 100) }],    // rise and turn while high
    [16.0, { p: E(401900, 5581600, 1100), t: E(395200, 5574800, 160) }],    // look up the Moselle towards the Hunsrück
    [18.4, { p: E(401300, 5580900, 900), t: E(394600, 5574300, 180) }],
    [20.6, { p: E(399500, 5580300, 620), t: E(398900, 5577400, 150) }],     // from the Moselle, south to the Karthause plateau
    [23.0, { p: E(399300, 5579900, 560), t: E(398800, 5577300, 150) }],
    [26.2, { p: E(400600, 5595500, 7200), t: E(399800, 5577800, 60) }],    // back out: the whole valley, still facing south
    [28.0, { p: E(400700, 5596800, 7800), t: E(399800, 5577400, 60) }],
  ];
  const cam = t => {
    if (t <= 8.6) { const u = ease(t / 8.6); return TOP(lerp(399700, 400250, u), lerp(5580300, 5579850, u), lerp(40000, 19000, u)); }
    let i = 0; while (i < KEYS.length - 2 && t > KEYS[i+1][0]) i++;
    const [t0, A] = KEYS[i], [t1, B] = KEYS[i+1], u = ease(Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
    return { p: new V().lerpVectors(A.p, B.p, u), t: new V().lerpVectors(A.t, B.t, u) };
  };
  const fade = (t, a, b, f = 0.4) => t < a ? 0 : t < a + f ? (t - a) / f : t < b - f ? 1 : t < b ? (b - t) / f : 0;
  // share of Koblenz's residential land (Basis-DLM) under ≥ x m of cold air, x = 0..120 (50 m model grid)
  const SH = [100.0, 97.6, 97.2, 95.7, 93.5, 89.6, 86.5, 83.6, 80.5, 78.2, 75.8, 73.3, 70.9, 68.6, 66.9, 65.5, 64.0, 62.8, 61.8, 60.9, 60.0, 59.2, 58.3, 57.1, 55.9, 54.5, 52.6, 50.5, 49.1, 47.2, 45.7, 44.2, 42.7, 40.1, 36.6, 32.5, 27.7, 24.3, 21.3, 17.9, 15.6, 13.6, 12.0, 10.7, 9.6, 8.6, 7.9, 7.2, 6.7, 6.3, 5.8, 5.3, 4.8, 4.0, 3.4, 2.9, 2.5, 2.2, 1.8, 1.6, 1.3, 1.1, 1.1, 0.9, 0.8, 0.7, 0.6, 0.6, 0.5, 0.4, 0.2, 0.2, 0.1, 0.1, 0.1, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  const share = x => { const i = Math.max(0, Math.min(119, Math.floor(x))), f = x - i; return SH[i] + (SH[i+1] - SH[i]) * f; };
  window.__thrAt = fr => { const t = fr / FPS; if (t < 1.4) return 125; if (t > 8.4) return 20; const u = (t - 1.4) / 7; return 115 - 95 * (u < .5 ? 2*u*u : 1 - Math.pow(-2*u + 2, 2)/2); };
  window.__shot = (fr) => {
    const t = fr / FPS, thr = window.__thrAt(fr), sh = thr > 120 ? 0 : share(thr);
    const lab = t < 8.8 ? 1 : t < 9.3 ? 1 - (t - 8.8) / 0.5 : t < 13.6 ? 0 : Math.min(1, (t - 13.6) / 0.5);
    const o = { cam: cam(t), k: 1, thr, op: 0.82, labels: lab };
    let q = '', qo = 0;
    if (t < 9.2) { q = '<small>Koblenz · 2 hours after sunset</small>Where does the cold air go?'; qo = fade(t, -1, 9.2); }
    else if (t < 18.8) { q = '<small>Where it comes from</small>It drains off the Hunsrück and the Westerwald'; qo = fade(t, 13.8, 18.8); }
    else if (t < 23.4) { q = '<small>Who stays dry</small>The plateaus stay above the lake'; qo = fade(t, 19.0, 23.4); }
    o.fq = q; o.fqo = qo;
    let c = '', co = 0;
    if (t < 9.4) { c = `<b>${Math.round(sh)}%</b><span>of residential land lies under<br>≥ ${Math.round(Math.min(thr, 120))} m of cold air</span>`; co = fade(t, 1.4, 9.4); }
    else if (t < 18.6) { c = '<b>0.5–1.2</b><span>metres per second:<br>slower than walking</span>'; co = fade(t, 14.6, 18.6); }
    else if (t < 23.2) { c = '<b>4 m</b><span>of cold air on the<br>Karthause plateau<br>vs 32 m in the old town</span>'; co = fade(t, 19.8, 23.2); }
    o.fc = c; o.fco = co;
    let a = '', ao = 0;
    if (t < 14.0) { a = '<em>60%</em> of Koblenz\'s residential land lies under 20 m or more of cold air'; ao = fade(t, 9.8, 14.0); }
    else if (t >= 24.2) { a = 'Koblenz\'s invisible lake<small>Fill it, drain it, cut a section through the valley: 3D map in the post</small>'; ao = fade(t, 24.2, 29); }
    o.fa = a; o.fao = ao;
    o.fs = 'Modelled cold air, clear and calm night · DWD ORKA-DE via LfU Rheinland-Pfalz';
    F.set(o); F.step(1 / FPS);
  };
  F.set({ thr: 125 });
  F.warm(4);
  for (let f = 0; f < FROM; f++) F.advance(1, 1 / FPS, window.__thrAt(f));
  return { HECK: 0 };
}, { FPS, FROM });
console.log('heck', plan.HECK);
const LIST = process.env.LIST ? process.env.LIST.split(',').map(Number) : null;
for (let f = FROM; f < TO; f++) {
  if (LIST && !LIST.includes(f)) continue;
  await p.evaluate(fr => window.__shot(fr), f);
  await p.screenshot({ path: `${OUT}/f${String(f).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
  if (f % 30 === 0) console.log('frame', f);
}
await b.close(); srv.close();
