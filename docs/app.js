import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';

// ---------- constants ----------
const X0 = 385000, Y0 = 5565000, SIZE = 30000;        // data box (EPSG:25832)
const CX = 400000, CY = 5580000, ZB = 60;             // scene origin, base height (Rhine ~60 m)
const Q = new URLSearchParams(location.search);
const FILM = Q.has('film');
const LITE = Q.has('lite') || (!FILM && Math.min(innerWidth, innerHeight) < 700);
const TERRAIN_RES = FILM ? 15 : 30;
const STEP = FILM ? 1 : (LITE ? 2 : 1);               // vertex decimation of the dem grid

// Official LfU RLP legend colours for cold-air height (Stil_Kaltlufthoehe.qml), m
const RAMP = [[0,'#e8f6fc'],[10,'#d4ecf8'],[20,'#82e9fb'],[30,'#33d4f1'],[40,'#1598f6'],[50,'#1761ff'],
              [60,'#1239ff'],[70,'#0008ac'],[80,'#060465'],[90,'#030048'],[100,'#320489'],[120,'#6e05c6']];
// Official LfU night anomaly legend (Cold-/Hot-Spots Nacht)
const NIGHT = [[-4,'#0850b4'],[-3,'#016bff'],[-2,'#1eb7fe'],[-1,'#b1faff'],[0,'#f4f1ea'],[1,'#ffe2a7'],[2,'#ff874b'],[3,'#ff0134'],[4,'#82000d']];

const S = { k: 1, op: 0.8, ex: 1.8, lake: true, flow: true, bld: true, res: false, night: false, t: 0, sec: null, secMode: false };
window.S = S;

// ---------- helpers ----------
async function pixels(url) {
  const b = await (await fetch(url)).blob();
  const bm = await createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bm, 0, 0);
  return { w: bm.width, h: bm.height, d: g.getImageData(0, 0, bm.width, bm.height).data };
}
function dec16(p, scale) { const n = p.w * p.h, a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = (p.d[i*4] * 256 + p.d[i*4+1]) / scale; return a; }
function grid(arr, w, h, cell) {   // bilinear sampler on a north-up grid starting at (X0, Y0+SIZE), cell centres
  return (E, N) => {
    let fx = (E - X0) / cell - 0.5, fy = (Y0 + SIZE - N) / cell - 0.5;
    fx = Math.max(0, Math.min(w - 1.001, fx)); fy = Math.max(0, Math.min(h - 1.001, fy));
    const x = fx | 0, y = fy | 0, u = fx - x, v = fy - y, i = y * w + x;
    return arr[i]*(1-u)*(1-v) + arr[i+1]*u*(1-v) + arr[i+w]*(1-u)*v + arr[i+w+1]*u*v;
  };
}
const hex = h => new THREE.Color(h);
function rampGLSL(name, stops) {
  let s = `vec3 ${name}(float v){\n`;
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i+1], A = hex(ca), B = hex(cb);
    s += ` if(v<${b.toFixed(2)}) return mix(vec3(${A.r.toFixed(4)},${A.g.toFixed(4)},${A.b.toFixed(4)}),vec3(${B.r.toFixed(4)},${B.g.toFixed(4)},${B.b.toFixed(4)}),clamp((v-(${a.toFixed(2)}))/${(b-a).toFixed(2)},0.,1.));\n`;
  }
  const L = hex(stops[stops.length-1][1]);
  return s + ` return vec3(${L.r.toFixed(4)},${L.g.toFixed(4)},${L.b.toFixed(4)});\n}\n`;
}
const toWorld = (E, N, z) => new THREE.Vector3(E - CX, z - ZB, CY - N);
const fromWorld = v => [v.x + CX, CY - v.z];

// ---------- renderer / scene ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: FILM });
renderer.setPixelRatio(FILM ? 1 : Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 20, 200000);
const controls = new MapControls(camera, canvas);
controls.enableDamping = !FILM; controls.maxPolarAngle = 1.45; controls.minDistance = 300; controls.maxDistance = 60000;
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// blue-hour sky
const skyU = { top: { value: hex('#0b1a33') }, mid: { value: hex('#24406b') }, hor: { value: hex('#b07a6e') } };
scene.add(new THREE.Mesh(new THREE.SphereGeometry(150000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, uniforms: skyU,
  vertexShader: `varying vec3 p; void main(){ p=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform vec3 top,mid,hor; varying vec3 p;
    void main(){ float y=p.y; float az=max(0.,dot(normalize(p.xz),normalize(vec2(-0.87,-0.5))));
      vec3 c=mix(mid,top,smoothstep(0.05,0.5,y)); c=mix(c,mix(mid,hor,pow(az,3.)),1.-smoothstep(0.,0.12,y));
      gl_FragColor=vec4(c,1.); }`
})));

const world = new THREE.Group(); scene.add(world);           // world.scale.y = exaggeration
const LIGHT = new THREE.Vector3(-0.78, 0.30, -0.45).normalize(); // low light from the WNW (last glow after sunset)

// ---------- load data ----------
const [demP, coldP, flowP, nightP] = await Promise.all([
  pixels(`data/dem${TERRAIN_RES}.png`), pixels('data/cold25.png'), pixels('data/flow50.png'), pixels('data/night50.png')]);
const DEM = dec16(demP, 50), demAt = grid(DEM, demP.w, demP.h, TERRAIN_RES);
const COLD = dec16(coldP, 400), coldAt = grid(COLD, coldP.w, coldP.h, 25);
const FU = new Float32Array(600*600), FV = new Float32Array(600*600), FQ = new Float32Array(600*600), NT = new Float32Array(600*600);
for (let i = 0; i < 360000; i++) { FU[i] = flowP.d[i*4]/127.5-1; FV[i] = flowP.d[i*4+1]/127.5-1; FQ[i] = flowP.d[i*4+2]/255*120;
  const n = nightP.d[i*4]; NT[i] = n === 0 ? NaN : n/20 - 6; }
const fuAt = grid(FU, 600, 600, 50), fvAt = grid(FV, 600, 600, 50), fqAt = grid(FQ, 600, 600, 50);
const ntAt = (E, N) => { const x = Math.floor((E-X0)/50), y = Math.floor((Y0+SIZE-N)/50); return NT[y*600+x]; };

const texL = new THREE.TextureLoader();
const loadTex = u => new Promise(r => texL.load(u, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; r(t); }, undefined, () => r(null)));
const [ortho, orthoCore, landuse, resTex] = await Promise.all([loadTex(FILM ? 'data/ortho_8k.jpg' : 'data/ortho.jpg'), loadTex(FILM ? 'data/ortho_core_8k.jpg' : 'data/ortho_core.jpg'), loadTex('data/landuse10.jpg'), loadTex('data/res10.png')]);
resTex.colorSpace = THREE.NoColorSpace;
function flipRows(d, w, h) { const o = new Uint8Array(d.length), rb = w*4; for (let y = 0; y < h; y++) o.set(d.subarray((h-1-y)*rb, (h-y)*rb), y*rb); return o; }
const nightTex = new THREE.DataTexture(flipRows(nightP.d, 600, 600), 600, 600, THREE.RGBAFormat); nightTex.magFilter = THREE.LinearFilter; nightTex.needsUpdate = true;
const flowTex = new THREE.DataTexture(flipRows(flowP.d, 600, 600), 600, 600, THREE.RGBAFormat); flowTex.magFilter = THREE.LinearFilter; flowTex.needsUpdate = true;

// ---------- terrain + lake geometry (shared grid) ----------
function buildGrid(withCold) {
  const n = Math.floor(demP.w / STEP), cell = TERRAIN_RES * STEP;
  const pos = new Float32Array(n*n*3), uv = new Float32Array(n*n*2), cold = withCold ? new Float32Array(n*n) : null;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const i = r*n + c, E = X0 + (c+0.5)*cell, N = Y0 + SIZE - (r+0.5)*cell;
    const z = demAt(E, N);
    pos[i*3] = E - CX; pos[i*3+1] = z - ZB; pos[i*3+2] = CY - N;
    uv[i*2] = (E - X0)/SIZE; uv[i*2+1] = (N - Y0)/SIZE;
    if (cold) cold[i] = coldAt(E, N);
  }
  const idx = [];
  for (let r = 0; r < n-1; r++) for (let c = 0; c < n-1; c++) {
    const a = r*n+c, b = a+1, d = a+n, e = d+1;
    if (cold && Math.max(cold[a], cold[b], cold[d], cold[e]) < 0.5) continue;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (cold) g.setAttribute('cold', new THREE.BufferAttribute(cold, 1));
  g.setIndex(n*n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

const COMMON = `uniform float ex; varying vec3 vN; varying vec2 vUv; varying vec3 vW; varying float vD;`;
const terrainMat = new THREE.ShaderMaterial({
  uniforms: { tex: { value: ortho || landuse }, core: { value: orthoCore || ortho || landuse }, hasCore: { value: orthoCore ? 1 : 0 }, resT: { value: resTex }, nightT: { value: nightTex }, ex: { value: S.ex },
    light: { value: LIGHT }, showRes: { value: 0 }, showNight: { value: 0 }, isOrtho: { value: ortho ? 1 : 0 }, fogC: { value: hex('#1c2f4d') } },
  vertexShader: `${COMMON}
    void main(){ vUv=uv; vN=normalize(vec3(normal.x*ex,normal.y,normal.z*ex));
      vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vec4 mv=viewMatrix*w; vD=-mv.z; gl_Position=projectionMatrix*mv; }`,
  fragmentShader: `${COMMON} uniform sampler2D tex,core,resT,nightT; uniform vec3 light,fogC; uniform float showRes,showNight,isOrtho,hasCore;
    ${rampGLSL('nightRamp', NIGHT)}
    void main(){
      vec3 base=texture2D(tex,vUv).rgb;
      vec2 cu=(vUv-vec2(${(11000/30000).toFixed(6)},0.3))/${(8000/30000).toFixed(6)};   // Koblenz core, 1 m orthophoto
      if(hasCore>0.5 && cu.x>0. && cu.x<1. && cu.y>0. && cu.y<1.){ float e=min(min(cu.x,1.-cu.x),min(cu.y,1.-cu.y)); base=mix(base,texture2D(core,cu).rgb,smoothstep(0.,0.04,e)); }
      vec3 n=normalize(vN);
      float lam=max(dot(n,light),0.);
      float sky=0.55+0.45*n.y;
      // blue-hour light: dim warm key from the WNW + cool sky fill
      vec3 col=base*(vec3(1.0,0.78,0.62)*lam*0.62 + vec3(0.36,0.46,0.68)*sky*0.55);
      float r=texture2D(resT,vUv).r;
      if(showRes>0.5) col=mix(col,vec3(1.0,0.80,0.45)*(0.55+0.45*lam),r*0.75);
      if(showNight>0.5){ vec4 nt=texture2D(nightT,vUv); if(nt.r>0.){ float a=nt.r*255./20.-6.; col=mix(col,nightRamp(a)*(0.6+0.4*sky),0.72);} }
      float f=1.-exp(-vD/52000.); col=mix(col,fogC,f*0.85);
      gl_FragColor=vec4(col,1.);
      #include <colorspace_fragment>
    }`
});
const terrain = new THREE.Mesh(buildGrid(false), terrainMat); world.add(terrain);

const lakeMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { ex: { value: S.ex }, k: { value: S.k }, op: { value: S.op }, t: { value: 0 }, flowT: { value: flowTex }, light: { value: LIGHT },
    camP: { value: new THREE.Vector3() }, legend: { value: 0 }, fogC: { value: hex('#1c2f4d') } },
  vertexShader: `${COMMON} attribute float cold; uniform float k; varying float vH;
    void main(){ vUv=uv; vH=cold*k; vec3 p=position; p.y+=vH+0.6;
      vN=normalize(vec3(normal.x*ex,normal.y,normal.z*ex));
      vec4 w=modelMatrix*vec4(p,1.); vW=w.xyz; vec4 mv=viewMatrix*w; vD=-mv.z; gl_Position=projectionMatrix*mv; }`,
  fragmentShader: `${COMMON} uniform float op,t,legend; uniform sampler2D flowT; uniform vec3 light,camP,fogC; varying float vH;
    ${rampGLSL('coldRamp', RAMP)}
    ${rampGLSL('natRamp', [[0,'#d4ecf8'],[20,'#82e9fb'],[35,'#33d4f1'],[55,'#1598f6'],[90,'#1761ff']])}
    float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
    float fbm(vec2 p){ return 0.55*vn(p)+0.3*vn(p*2.07)+0.15*vn(p*4.3); }
    void main(){
      if(vH<0.6) discard;
      vec3 fl=texture2D(flowT,vUv).rgb; vec2 dir=fl.rg*2.-1.; float q=fl.b;
      vec2 P=vec2(vW.x,-vW.z)/260.;
      float ph=fract(t*0.08), ph2=fract(t*0.08+0.5);
      float m1=fbm(P-dir*ph*(1.5+4.*q)), m2=fbm(P-dir*ph2*(1.5+4.*q)+7.3);
      float mist=mix(m1,m2,abs(ph-0.5)*2.);
      float depth=1.-exp(-vH/38.);
      // natural look: cold air as a pale, icy haze that thickens with depth; legend mode: official LfU classes
      vec3 nat=natRamp(vH);
      vec3 c=mix(nat,coldRamp(vH),legend);
      vec3 V=normalize(camP-vW); vec3 n=normalize(vN);
      float fres=pow(1.-max(dot(n,V),0.),3.);
      float spec=pow(max(dot(reflect(-light,n),V),0.),40.);
      c=c*(0.80+0.25*mist)+vec3(0.85,0.95,1.)*(fres*0.25+spec*0.2)*depth;
      float a=op*(0.08+0.72*depth)*(0.85+0.3*mist);
      a*=smoothstep(2.,12.,vH);                               // thin sheets on slopes fade out
      float rim=smoothstep(14.,22.,vH)*(1.-smoothstep(22.,30.,vH));  // soft contour where the pooled lake begins
      c=mix(c,vec3(0.86,0.98,1.),rim*0.18);
      float f=1.-exp(-vD/52000.); c=mix(c,fogC,f*0.8);
      gl_FragColor=vec4(c,clamp(a,0.,0.95));
      #include <colorspace_fragment>
    }`
});
const lake = new THREE.Mesh(buildGrid(true), lakeMat); lake.renderOrder = 2; world.add(lake);

// ---------- buildings (LoD2, real roofs) ----------
let bld = null;
{
  const [pb, kb] = await Promise.all([fetch('data/lod2.bin').then(r => r.arrayBuffer()), fetch('data/lod2kind.bin').then(r => r.arrayBuffer())]);
  const P = new Uint16Array(pb), K = new Uint8Array(kb), nv = P.length/3;
  const pos = new Float32Array(nv*3), col = new Float32Array(nv*3);
  const roof = hex('#4a4f57'), wall = hex('#d9d2c5');   // slate roofs, light plaster walls (typical Koblenz)
  for (let i = 0; i < nv; i++) {
    const E = 399900 + P[i*3]/10, N = 5577900 + P[i*3+1]/10, z = P[i*3+2]/10;
    pos[i*3] = E - CX; pos[i*3+1] = z - ZB; pos[i*3+2] = CY - N;
    const c = K[(i/3)|0] === 0 ? roof : wall; col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.ShaderMaterial({ uniforms: { light: { value: LIGHT }, ex: { value: S.ex }, fogC: { value: hex('#1c2f4d') } },
    vertexShader: `${COMMON} attribute vec3 color; varying vec3 vC;
      void main(){ vC=color; vN=normalize(vec3(normal.x*ex,normal.y,normal.z*ex)); vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vec4 mv=viewMatrix*w; vD=-mv.z; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `${COMMON} uniform vec3 light,fogC; varying vec3 vC;
      void main(){ vec3 n=normalize(cross(dFdx(vW),dFdy(vW))); if(n.y<0.) n=-n; float lam=max(dot(n,light),0.)+0.0;
        vec3 c=vC*(vec3(1.,0.8,0.65)*lam*0.8+vec3(0.42,0.52,0.72)*(0.6+0.4*n.y)*0.7);
        c=mix(c,fogC,(1.-exp(-vD/52000.))*0.85); gl_FragColor=vec4(c,1.);
        #include <colorspace_fragment>
      }` });
  bld = new THREE.Mesh(g, m); bld.renderOrder = 1; world.add(bld);
}

// ---------- flow particles (advected on the modelled flow field) ----------
const NP = FILM ? 9000 : (LITE ? 2500 : 6000), TRAIL = 10, TIMESCALE = 300;
const spawnCells = []; let qsum = 0;
for (let i = 0; i < 360000; i++) if (FQ[i] > 10) { qsum += FQ[i]; spawnCells.push(i, qsum); }
function spawn(p) {
  const r = Math.random()*qsum; let lo = 0, hi = spawnCells.length/2 - 1;
  while (lo < hi) { const m = (lo+hi) >> 1; if (spawnCells[m*2+1] < r) lo = m+1; else hi = m; }
  const i = spawnCells[lo*2], x = i % 600, y = (i/600)|0;
  p.E = X0 + (x + Math.random())*50; p.N = Y0 + SIZE - (y + Math.random())*50; p.age = 0; p.life = 6 + Math.random()*8;
  p.tr = [];
}
const parts = Array.from({ length: NP }, () => { const p = {}; spawn(p); p.age = Math.random()*p.life; return p; });
const pPos = new Float32Array(NP*TRAIL*2*3), pCol = new Float32Array(NP*TRAIL*2*4);
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 4).setUsage(THREE.DynamicDrawUsage));
const pMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `attribute vec4 color; varying vec4 vC; void main(){ vC=color; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `varying vec4 vC; void main(){ gl_FragColor=vC; }` });
const pLines = new THREE.LineSegments(pGeo, pMat); pLines.frustumCulled = false; pLines.renderOrder = 3; world.add(pLines);
function stepParticles(dt) {
  const k = S.k;
  for (let j = 0; j < NP; j++) {
    const p = parts[j];
    p.age += dt;
    const q = fqAt(p.E, p.N), h = coldAt(p.E, p.N);
    if (p.age > p.life || q < 5 || p.E < X0 || p.E > X0+SIZE || p.N < Y0 || p.N > Y0+SIZE) { spawn(p); continue; }
    const sp = q / Math.max(h, 3);                       // m/s: volume flux density / layer height
    const u = fuAt(p.E, p.N), v = fvAt(p.E, p.N), L = Math.hypot(u, v) || 1;
    p.E += u/L*sp*dt*TIMESCALE; p.N += v/L*sp*dt*TIMESCALE;
    p.tr.unshift([p.E, p.N, demAt(p.E, p.N), h, Math.min(1, sp/1.5)]);
    if (p.tr.length > TRAIL+1) p.tr.pop();
  }
  let o = 0, oc = 0;
  for (let j = 0; j < NP; j++) {
    const p = parts[j], fade = Math.min(1, p.age/1.2, (p.life - p.age)/1.2) * k;
    for (let s = 0; s < TRAIL; s++) {
      const a = p.tr[s], b = p.tr[s+1];
      if (!a || !b) { for (let z = 0; z < 6; z++) pPos[o++] = 0; for (let z = 0; z < 8; z++) pCol[oc++] = 0; continue; }
      pPos[o++] = a[0]-CX; pPos[o++] = a[2]+a[3]*k+3-ZB; pPos[o++] = CY-a[1];
      pPos[o++] = b[0]-CX; pPos[o++] = b[2]+b[3]*k+3-ZB; pPos[o++] = CY-b[1];
      const al = fade * (1 - s/TRAIL) * 0.85, w = a[4];
      for (const al2 of [al, al*0.85]) { pCol[oc++] = 0.75+0.25*w; pCol[oc++] = 0.95; pCol[oc++] = 1.0; pCol[oc++] = al2; }
    }
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
}

// ---------- stats (computed in the browser from the same grids) ----------
fetch('data/stats.json').then(r => r.json()).then(st => {
  document.getElementById('sRes').textContent = Math.round(st.res_ge20_share*100) + '%';
  document.getElementById('sMax').textContent = Math.round(st.koblenz_max_h) + ' m';
}).catch(() => {});

// legend
document.getElementById('legend').innerHTML =
  `Cold-air depth above ground (m), LfU RLP classes<div class="ramp">${RAMP.slice(1,-1).map(r => `<i style="background:${r[1]}"></i>`).join('')}</div>
   <div class="tick"><span>10</span><span>30</span><span>50</span><span>70</span><span>90</span><span>120</span></div>`;

// ---------- camera ----------
const VIEWS = {
  all: { p: toWorld(392500, 5560500, 9500), t: toWorld(399500, 5580500, 60) },
  eck: { p: toWorld(398300, 5577000, 1150), t: toWorld(400600, 5580000, 80) },
};
function setView(v, dur = 1.6) {
  if (FILM || dur === 0) { camera.position.copy(v.p); controls.target.copy(v.t); controls.update(); return; }
  const p0 = camera.position.clone(), t0 = controls.target.clone(), st = performance.now();
  (function an() { const u = Math.min(1, (performance.now()-st)/(dur*1000)), e = u<.5 ? 4*u*u*u : 1-Math.pow(-2*u+2, 3)/2;
    camera.position.lerpVectors(p0, v.p, e); controls.target.lerpVectors(t0, v.t, e); if (u < 1) requestAnimationFrame(an); })();
}
setView(VIEWS.all, 0);

// ---------- UI ----------
const $ = id => document.getElementById(id);
function applyEx() { world.scale.y = S.ex; for (const m of [terrainMat, lakeMat, bld.material]) m.uniforms.ex.value = S.ex; $('exv').textContent = S.ex.toFixed(1)+'×'; }
applyEx();
$('tLake').onchange = e => lake.visible = S.lake = e.target.checked;
$('tFlow').onchange = e => pLines.visible = S.flow = e.target.checked;
$('tBld').onchange = e => bld.visible = S.bld = e.target.checked;
$('tRes').onchange = e => terrainMat.uniforms.showRes.value = (S.res = e.target.checked) ? 1 : 0;
$('tNight').onchange = e => terrainMat.uniforms.showNight.value = (S.night = e.target.checked) ? 1 : 0;
$('tLeg').onchange = e => { lakeMat.uniforms.legend.value = e.target.checked ? 1 : 0; document.getElementById('legend').style.opacity = e.target.checked ? 1 : .45; };
$('rK').oninput = e => { S.k = +e.target.value; lakeMat.uniforms.k.value = S.k; };
$('rOp').oninput = e => { S.op = +e.target.value; lakeMat.uniforms.op.value = S.op; };
$('rEx').oninput = e => { S.ex = +e.target.value; applyEx(); };
$('bEck').onclick = () => setView(VIEWS.eck);
$('bAll').onclick = () => setView(VIEWS.all);

// picking
const ray = new THREE.Raycaster();
function pick(ev) {
  const r = canvas.getBoundingClientRect(), m = new THREE.Vector2(((ev.clientX-r.left)/r.width)*2-1, -((ev.clientY-r.top)/r.height)*2+1);
  ray.setFromCamera(m, camera); const hit = ray.intersectObject(terrain)[0]; if (!hit) return null;
  const [E, N] = fromWorld(hit.point); return { E, N };
}
let downAt = null;
canvas.addEventListener('pointerdown', e => downAt = [e.clientX, e.clientY]);
canvas.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX-downAt[0], e.clientY-downAt[1]) > 5) return;
  const p = pick(e); if (!p) return;
  if (S.secMode) { secClick(p); return; }
  const z = demAt(p.E, p.N), h = coldAt(p.E, p.N), q = fqAt(p.E, p.N), nt = ntAt(p.E, p.N);
  const sp = q > 5 ? q/Math.max(h, 3) : 0;
  $('info').hidden = false;
  $('info').innerHTML = `<div><b>${h < 0.5 ? 'No cold-air layer' : h.toFixed(0)+' m of cold air'}</b> above this point</div>
    <div><span class="k">Ground</span> ${z.toFixed(0)} m a.s.l. · <span class="k">cold-air top</span> ${(z+h).toFixed(0)} m</div>
    <div><span class="k">Flow</span> ${q > 5 ? q.toFixed(0)+' m³/(s·m), ≈ '+sp.toFixed(1)+' m/s' : 'none or weak'}</div>
    <div><span class="k">Satellite night surface temp.</span> ${isNaN(nt) ? 'n/a' : (nt>0?'+':'')+nt.toFixed(1)+' °C vs district mean'}</div>`;
});

// cross-section
let secPts = [];
$('bSec').onclick = () => { S.secMode = !S.secMode; $('bSec').classList.toggle('on', S.secMode); secPts = []; canvas.style.cursor = S.secMode ? 'crosshair' : ''; };
$('secX').onclick = () => { $('sec').hidden = true; if (secLine) world.remove(secLine); };
let secLine = null;
function secClick(p) {
  secPts.push(p); if (secPts.length < 2) return;
  const [a, b] = secPts; secPts = []; S.secMode = false; $('bSec').classList.remove('on'); canvas.style.cursor = '';
  drawSection(a, b);
}
function drawSection(a, b) {
  const n = 300, L = Math.hypot(b.E-a.E, b.N-a.N), G = [], T = [];
  for (let i = 0; i <= n; i++) { const E = a.E+(b.E-a.E)*i/n, N = a.N+(b.N-a.N)*i/n, z = demAt(E, N), h = coldAt(E, N); G.push(z); T.push(z+h); }
  const c = $('secC'), g = c.getContext('2d'), W = c.width, H = c.height, pad = 30;
  const lo = Math.min(...G)-10, hi = Math.max(...T)+10, X = i => pad + (W-2*pad)*i/n, Y = z => H-pad - (H-2*pad)*(z-lo)/(hi-lo);
  g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(8,14,26,.0)'; g.fillRect(0, 0, W, H);
  // cold air
  g.beginPath(); for (let i = 0; i <= n; i++) g.lineTo(X(i), Y(T[i])); for (let i = n; i >= 0; i--) g.lineTo(X(i), Y(G[i]));
  const gr = g.createLinearGradient(0, Y(hi), 0, Y(lo)); gr.addColorStop(0, 'rgba(130,233,251,.55)'); gr.addColorStop(1, 'rgba(21,152,246,.85)');
  g.fillStyle = gr; g.fill();
  // ground
  g.beginPath(); g.moveTo(X(0), H-pad); for (let i = 0; i <= n; i++) g.lineTo(X(i), Y(G[i])); g.lineTo(X(n), H-pad); g.fillStyle = '#3a3a33'; g.fill();
  g.strokeStyle = '#d8d2c2'; g.lineWidth = 1.5; g.beginPath(); for (let i = 0; i <= n; i++) g.lineTo(X(i), Y(G[i])); g.stroke();
  g.fillStyle = '#9fb0c3'; g.font = '12px Inter'; g.fillText(`${Math.round(hi)} m`, 2, Y(hi)+4); g.fillText(`${Math.round(lo)} m`, 2, Y(lo));
  $('secT').textContent = `${(L/1000).toFixed(1)} km · blue = modelled cold-air layer · vertical scale exaggerated`;
  $('sec').hidden = false;
  if (secLine) world.remove(secLine);
  const pts = []; for (let i = 0; i <= 60; i++) { const E = a.E+(b.E-a.E)*i/60, N = a.N+(b.N-a.N)*i/60; pts.push(toWorld(E, N, demAt(E, N)+coldAt(E, N)+6)); }
  secLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff }));
  world.add(secLine);
}

// ---------- loop ----------
let last = performance.now();
function frame(dt) {
  S.t += dt; lakeMat.uniforms.t.value = S.t; lakeMat.uniforms.camP.value.copy(camera.position);
  if (S.flow) stepParticles(Math.min(dt, 0.05));
  controls.update(); renderer.render(scene, camera);
}
if (!FILM) {
  (function loop(now) { const dt = (now-last)/1000; last = now; frame(dt); requestAnimationFrame(loop); })(last);
} else {
  document.body.classList.add('film'); $('film').hidden = false;
}
$('load').classList.add('gone');

// ---------- film API (driven frame by frame by pipeline/film.mjs) ----------
window.Film = {
  ready: true, THREE, camera, controls, toWorld, demAt, coldAt, S, VIEWS,
  set(o) {
    if (o.k !== undefined) { S.k = o.k; lakeMat.uniforms.k.value = o.k; }
    if (o.op !== undefined) lakeMat.uniforms.op.value = o.op;
    if (o.ex !== undefined) { S.ex = o.ex; applyEx(); }
    if (o.legend !== undefined) lakeMat.uniforms.legend.value = o.legend;
    if (o.res !== undefined) terrainMat.uniforms.showRes.value = o.res;
    if (o.cam) { camera.position.copy(o.cam.p); controls.target.copy(o.cam.t); camera.lookAt(o.cam.t); }
    for (const id of ['fq', 'fa', 'fc', 'fs']) if (o[id] !== undefined) { $(id).innerHTML = o[id]; }
    for (const id of ['fq', 'fa', 'fc', 'fs']) if (o[id+'o'] !== undefined) $(id).style.opacity = o[id+'o'];
  },
  warm(sec) { for (let t = 0; t < sec; t += 1/30) stepParticles(1/30); },
  step(dt) { frame(dt); }
};
