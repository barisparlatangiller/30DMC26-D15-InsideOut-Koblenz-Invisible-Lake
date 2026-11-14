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
  const TOP = (e, n, h) => [E(e, n - h * 0.02, h), E(e, n, 60)];   // straight down, north up
  const K = [ // time, camera position, target
    [0.0, ...TOP(399600, 5580200, 40000)],
    [2.0, ...TOP(399700, 5580100, 38500)],
    [6.8, ...TOP(400000, 5579700, 17000)],
    [8.6, ...TOP(400350, 5579850, 7000)],
    [11.0, E(398700, 5576700, 1500), E(400600, 5580000, 80)],
    [12.0, E(398950, 5577050, 1250), E(400650, 5580050, 80)],
  ];
  const ease = u => u < .5 ? 4*u*u*u : 1 - Math.pow(-2*u+2, 3)/2;
  function cam(t) {
    let i = 0; while (i < K.length - 2 && t > K[i+1][0]) i++;
    const [t0, p0, a0] = K[i], [t1, p1, a1] = K[i+1], u = ease(Math.min(1, Math.max(0, (t - t0)/(t1 - t0))));
    return { p: new V().lerpVectors(p0, p1, u), t: new V().lerpVectors(a0, a1, u) };
  }
  const HECK = 48.7;   // 50 m model cell at the Deutsches Eck
  window.__shot = (fr) => {
    const t = fr / FPS;
    const k = t < 2 ? 0 : t > 6.5 ? 1 : ease((t - 2)/4.5);
    const o = { cam: cam(t), k, op: 0.8, labels: t < 8.8 ? 1 : Math.max(0.0, 1-(t-8.8)/0.5) };
    o.fq = '<small>Koblenz · 2 hours after sunset</small>Where does the cold air go?'; o.fqo = t < 6.6 ? 1 : Math.max(0, 1 - (t-6.6)/0.4);
    o.fc = `<b>${Math.round(HECK * k)} m</b><span>of cold air over<br>the Deutsches Eck</span>`; o.fco = t < 2.1 ? 0 : t < 9.1 ? 1 : Math.max(0, 1-(t-9.1)/0.4);
    o.fa = '<em>60%</em> of Koblenz\'s residential land lies under 20 m or more of cold air<small>The plateaus stay dry: Karthause, Ehrenbreitstein, Horchheimer Höhe</small>'; o.fao = t < 9.4 ? 0 : Math.min(1, (t-9.4)/0.4);
    o.fs = 'Modelled for a clear, calm night · DWD ORKA-DE via LfU Rheinland-Pfalz';
    F.set(o); F.step(1 / FPS);
  };
  F.warm(4);
  // particles are deterministic (seeded); replay the frames before FROM without rendering so shards line up
  window.__kAt = (fr) => { const t = fr / FPS; return t < 2 ? 0 : t > 6.5 ? 1 : ease((t - 2)/4.5); };
  for (let f = 0; f < FROM; f++) F.advance(window.__kAt(f), 1 / FPS);
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
