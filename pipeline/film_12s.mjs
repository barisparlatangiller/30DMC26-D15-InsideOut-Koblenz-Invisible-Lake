// Frame-by-frame film of the Invisible Lake. Usage: node film.mjs  (env: W,H,FPS,FROM,TO,OUT)
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = process.env.ROOT || '/home/claude/d15/site';
const W = +process.env.W || 1080, H = +process.env.H || 1350, FPS = +process.env.FPS || 30, DUR = 12;
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
  const OB1 = { p: E(398700, 5576700, 1500), t: E(400600, 5580000, 80) }, OB2 = { p: E(398950, 5577050, 1250), t: E(400650, 5580050, 80) };
  const cam = t => {
    if (t <= 8.6) { const u = ease(t / 8.6); return TOP(lerp(399700, 400250, u), lerp(5580300, 5579850, u), lerp(40000, 19000, u)); }
    const a = TOP(400250, 5579850, 19000);
    if (t <= 11) { const u = ease((t - 8.6) / 2.4); return { p: new V().lerpVectors(a.p, OB1.p, u), t: new V().lerpVectors(a.t, OB1.t, u) }; }
    const u = (t - 11); return { p: new V().lerpVectors(OB1.p, OB2.p, u), t: new V().lerpVectors(OB1.t, OB2.t, u) };
  };
  // share of Koblenz's residential land (Basis-DLM) under ≥ x m of cold air, x = 0..120 (50 m model grid)
  const SH = [100.0, 97.6, 97.2, 95.7, 93.5, 89.6, 86.5, 83.6, 80.5, 78.2, 75.8, 73.3, 70.9, 68.6, 66.9, 65.5, 64.0, 62.8, 61.8, 60.9, 60.0, 59.2, 58.3, 57.1, 55.9, 54.5, 52.6, 50.5, 49.1, 47.2, 45.7, 44.2, 42.7, 40.1, 36.6, 32.5, 27.7, 24.3, 21.3, 17.9, 15.6, 13.6, 12.0, 10.7, 9.6, 8.6, 7.9, 7.2, 6.7, 6.3, 5.8, 5.3, 4.8, 4.0, 3.4, 2.9, 2.5, 2.2, 1.8, 1.6, 1.3, 1.1, 1.1, 0.9, 0.8, 0.7, 0.6, 0.6, 0.5, 0.4, 0.2, 0.2, 0.1, 0.1, 0.1, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
  const share = x => { const i = Math.max(0, Math.min(119, Math.floor(x))), f = x - i; return SH[i] + (SH[i+1] - SH[i]) * f; };
  window.__thrAt = fr => { const t = fr / FPS; if (t < 1.4) return 125; if (t > 8.4) return 20; const u = (t - 1.4) / 7; return 115 - 95 * (u < .5 ? 2*u*u : 1 - Math.pow(-2*u + 2, 2)/2); };
  const HECK = 48.7;
  window.__shot = (fr) => {
    const t = fr / FPS, thr = window.__thrAt(fr), sh = thr > 120 ? 0 : share(thr);
    const o = { cam: cam(t), k: 1, thr, op: 0.82, labels: t < 8.8 ? 1 : Math.max(0, 1 - (t-8.8)/0.5) };
    o.fq = '<small>Koblenz · 2 hours after sunset</small>Where does the cold air go?'; o.fqo = t < 8.8 ? 1 : Math.max(0, 1 - (t-8.8)/0.4);
    o.fc = `<b>${Math.round(sh)}%</b><span>of residential land lies under<br>≥ ${Math.round(Math.min(thr, 120))} m of cold air</span>`; o.fco = t < 1.4 ? 0 : t < 9.0 ? 1 : Math.max(0, 1-(t-9.0)/0.4);
    o.fa = '<em>60%</em> of Koblenz\'s residential land lies under 20 m or more of cold air<small>It drains off the Hunsrück and Westerwald. The plateaus stay dry: Karthause, Ehrenbreitstein</small>'; o.fao = t < 9.8 ? 0 : Math.min(1, (t-9.8)/0.4);
    o.fs = 'Modelled cold air, clear and calm night · DWD ORKA-DE via LfU Rheinland-Pfalz';
    F.set(o); F.step(1 / FPS);
  };
  F.set({ thr: 125 });
  F.warm(4);
  for (let f = 0; f < FROM; f++) F.advance(1, 1 / FPS, window.__thrAt(f));
  return { HECK };
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
