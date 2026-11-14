import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';

// ---------- constants ----------
const X0 = 385000, Y0 = 5565000, SIZE = 30000;        // 3D box (EPSG:25832)
const CX = 400000, CY = 5580000, ZB = 60;             // scene origin; y = elevation − 60 m
const Q = new URLSearchParams(location.search);
const FILM = Q.has('film');
const LITE = Q.has('lite') || (!FILM && Math.min(innerWidth, innerHeight) < 700);
const TERRAIN_RES = FILM ? 15 : 30;
const STEP = LITE ? 2 : 1;
const BG = '#efebe4';

// LfU RLP legend: cold-air height classes (Stil_Kaltlufthoehe.qml)
const RAMP = [[0,'#e8f6fc'],[10,'#d4ecf8'],[20,'#82e9fb'],[30,'#33d4f1'],[40,'#1598f6'],[50,'#1761ff'],
              [60,'#1239ff'],[70,'#0008ac'],[80,'#060465'],[90,'#030048'],[100,'#320489'],[120,'#6e05c6']];
// LfU RLP legend: flow arrows (Stil_Kaltluftpfeile.qml), volume-flux density m³/(s·m)
const FLOW = [[10,'#09e7ff','moderate 10–20'],[20,'#0076fe','high 20–30'],[30,'#0300dc','very high > 30']];
// LfU RLP legend: night anomaly
const NIGHT = [[-4,'#0850b4'],[-3,'#016bff'],[-2,'#1eb7fe'],[-1,'#b1faff'],[0,'#f4f1ea'],[1,'#ffe2a7'],[2,'#ff874b'],[3,'#ff0134'],[4,'#82000d']];

if (FILM) { let a = 20261115; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const S = { thr: 0, k: 1, op: 0.68, ex: 1.8, t: 0, secMode: false, base: 'map' };
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
function grid(arr, w, h, cell) {
  return (E, N) => {
    let fx = (E - X0) / cell - 0.5, fy = (Y0 + SIZE - N) / cell - 0.5;
    fx = Math.max(0, Math.min(w - 1.001, fx)); fy = Math.max(0, Math.min(h - 1.001, fy));
    const x = fx | 0, y = fy | 0, u = fx - x, v = fy - y, i = y * w + x;
    return arr[i]*(1-u)*(1-v) + arr[i+1]*u*(1-v) + arr[i+w]*(1-u)*v + arr[i+w+1]*u*v;
  };
}
const hex = h => new THREE.Color(h);
const v3 = c => `vec3(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})`;
function rampGLSL(name, stops) {
  let s = `vec3 ${name}(float v){\n`;
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i+1];
    s += ` if(v<${b.toFixed(2)}) return mix(${v3(hex(ca))},${v3(hex(cb))},clamp((v-(${a.toFixed(2)}))/${(b-a).toFixed(2)},0.,1.));\n`;
  }
  return s + ` return ${v3(hex(stops[stops.length-1][1]))};\n}\n`;
}
const toWorld = (E, N, z) => new THREE.Vector3(E - CX, z - ZB, CY - N);
const fromWorld = v => [v.x + CX, CY - v.z];
function flipRows(d, w, h) { const o = new Uint8Array(d.length), rb = w*4; for (let y = 0; y < h; y++) o.set(d.subarray((h-1-y)*rb, (h-y)*rb), y*rb); return o; }

// ---------- renderer / scene ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: FILM });
renderer.setPixelRatio(FILM ? (+Q.get('dpr') || 1) : Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(BG);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 20, 300000);
const controls = new MapControls(camera, canvas);
controls.enableDamping = !FILM; controls.maxPolarAngle = 1.42; controls.minDistance = 250; controls.maxDistance = 80000;
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight;
  if (!FILM && innerWidth > 760) camera.setViewOffset(innerWidth, innerHeight, -192, 0, innerWidth, innerHeight); else camera.clearViewOffset();
  camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const world = new THREE.Group(); scene.add(world);
const LIGHT = new THREE.Vector3(-0.55, 0.62, -0.55).normalize();   // soft light from the NW, like the hillshade
const FOG = hex(BG);
const FOGD = FILM ? 95000 : 120000;

// ---------- data ----------
const [demP, coldP, flowP, nightP] = await Promise.all([
  pixels(`data/dem${TERRAIN_RES}.png`), pixels('data/cold25.png'), pixels('data/flow50.png'), pixels('data/night50.png')]);
const DEM = dec16(demP, 50), demAt = grid(DEM, demP.w, demP.h, TERRAIN_RES);
const COLD = dec16(coldP, 400), coldAt = grid(COLD, coldP.w, coldP.h, 25);
const FU = new Float32Array(360000), FV = new Float32Array(360000), FQ = new Float32Array(360000), NT = new Float32Array(360000);
for (let i = 0; i < 360000; i++) { FU[i] = flowP.d[i*4]/127.5-1; FV[i] = flowP.d[i*4+1]/127.5-1; FQ[i] = flowP.d[i*4+2]/255*120;
  const n = nightP.d[i*4]; NT[i] = n === 0 ? NaN : n/20 - 6; }
const fuAt = grid(FU, 600, 600, 50), fvAt = grid(FV, 600, 600, 50), fqAt = grid(FQ, 600, 600, 50);
const ntAt = (E, N) => { const x = Math.floor((E-X0)/50), y = Math.floor((Y0+SIZE-N)/50); return NT[y*600+x]; };

const texL = new THREE.TextureLoader();
const loadTex = (u, srgb = true) => new Promise(r => texL.load(u, t => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; r(t); }, undefined, () => r(null)));
const [baseT, baseCore, baseCtx, ortho, orthoCore, landuse, resTex, shadeT, conT] = await Promise.all([
  loadTex(FILM ? 'data/base_8k.jpg' : 'data/base.jpg'), loadTex(FILM ? 'data/base_core_8k.jpg' : 'data/base_core.jpg'), loadTex('data/base_ctx.jpg'),
  loadTex(FILM ? 'data/ortho_8k.jpg' : 'data/ortho.jpg'), loadTex(FILM ? 'data/ortho_core_8k.jpg' : 'data/ortho_core.jpg'),
  loadTex('data/landuse10.jpg'), loadTex('data/res10.png', false), loadTex('data/shade15.png', false), loadTex('data/contours.png', false)]);
const nightTex = new THREE.DataTexture(flipRows(nightP.d, 600, 600), 600, 600, THREE.RGBAFormat); nightTex.magFilter = THREE.LinearFilter; nightTex.needsUpdate = true;
const flowTex = new THREE.DataTexture(flipRows(flowP.d, 600, 600), 600, 600, THREE.RGBAFormat); flowTex.magFilter = THREE.LinearFilter; flowTex.needsUpdate = true;

// ---------- terrain + lake geometry ----------
function buildGrid(withCold) {
  const n = Math.floor(demP.w / STEP), cell = TERRAIN_RES * STEP;
  const pos = new Float32Array(n*n*3), uv = new Float32Array(n*n*2), cold = withCold ? new Float32Array(n*n) : null;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const i = r*n + c, E = X0 + (c+0.5)*cell, N = Y0 + SIZE - (r+0.5)*cell, z = demAt(E, N);
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
  g.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return { g, n };
}

const COMMON = `uniform float ex; varying vec3 vN; varying vec2 vUv; varying vec3 vW; varying float vD;`;
const VS = `void main(){ vUv=uv; vN=normalize(vec3(normal.x*ex,normal.y,normal.z*ex));
  vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vec4 mv=viewMatrix*w; vD=-mv.z; gl_Position=projectionMatrix*mv; }`;
const terrainMat = new THREE.ShaderMaterial({
  uniforms: { tex: { value: baseT || landuse }, photo: { value: ortho || landuse }, core: { value: orthoCore || ortho || landuse },
    mapCore: { value: baseCore || baseT || landuse }, hasMapCore: { value: baseCore ? 1 : 0 }, usePhoto: { value: 0 }, hasCore: { value: orthoCore ? 1 : 0 }, shade: { value: shadeT }, con: { value: conT }, showCon: { value: 1 },
    resT: { value: resTex }, nightT: { value: nightTex }, ex: { value: S.ex }, light: { value: LIGHT },
    showRes: { value: 0 }, showNight: { value: 0 }, fogC: { value: FOG }, fogD: { value: FOGD } },
  vertexShader: `${COMMON} ${VS}`,
  fragmentShader: `${COMMON} uniform sampler2D tex,mapCore,photo,core,shade,con,resT,nightT; uniform vec3 light,fogC;
    uniform float usePhoto,hasCore,hasMapCore,showCon,showRes,showNight,fogD;
    ${rampGLSL('nightRamp', NIGHT)}
    void main(){
      vec3 n=normalize(vN);
      float lam=max(dot(n,light),0.);
      float hs=texture2D(shade,vUv).r;
      vec3 col;
      vec2 cu=(vUv-vec2(${(11000/30000).toFixed(6)},0.3))/${(8000/30000).toFixed(6)};   // Koblenz core at 1 m
      float inCore=step(0.,cu.x)*step(cu.x,1.)*step(0.,cu.y)*step(cu.y,1.);
      float ce=smoothstep(0.,0.04,min(min(cu.x,1.-cu.x),min(cu.y,1.-cu.y)))*inCore;
      if(usePhoto>0.5){
        col=texture2D(photo,vUv).rgb;
        if(hasCore>0.5 && cu.x>0. && cu.x<1. && cu.y>0. && cu.y<1.){ float e=min(min(cu.x,1.-cu.x),min(cu.y,1.-cu.y)); col=mix(col,texture2D(core,cu).rgb,smoothstep(0.,0.04,e)); }
        col*=0.62+0.5*lam;
      } else {
        col=texture2D(tex,vUv).rgb;
        if(hasMapCore>0.5) col=mix(col,texture2D(mapCore,clamp(cu,0.,1.)).rgb,ce);
        col*=mix(0.62,1.06,hs)*(0.88+0.18*lam);          // cartographic hillshade on the grey basemap
      }
      if(showCon>0.5){ float c=texture2D(con,vUv).r; col=mix(col,vec3(0.42,0.38,0.33),c*(usePhoto>0.5?0.35:0.45)); }
      float r=texture2D(resT,vUv).r;
      if(showRes>0.5) col=mix(col,vec3(0.91,0.55,0.28),r*0.55);
      if(showNight>0.5){ vec4 nt=texture2D(nightT,vUv); if(nt.r>0.){ float a=nt.r*255./20.-6.; col=mix(col,nightRamp(a),0.7);} }
      col=mix(col,fogC,smoothstep(0.,1.,vD/fogD)*0.9);
      gl_FragColor=vec4(col,1.);
      #include <colorspace_fragment>
    }`
});
const TG = buildGrid(false);
const terrain = new THREE.Mesh(TG.g, terrainMat); world.add(terrain);

// skirt: the 3D box sits like a model on the grey map
{
  const n = TG.n, P = TG.g.attributes.position.array, pts = [];
  const edge = [];
  for (let c = 0; c < n; c++) edge.push(c);
  for (let r = 1; r < n; r++) edge.push(r*n + n-1);
  for (let c = n-2; c >= 0; c--) edge.push((n-1)*n + c);
  for (let r = n-2; r > 0; r--) edge.push(r*n);
  edge.push(0);
  const pos = [], col = [];
  for (let i = 0; i < edge.length-1; i++) {
    const a = edge[i], b = edge[i+1], ax = P[a*3], ay = P[a*3+1], az = P[a*3+2], bx = P[b*3], by = P[b*3+1], bz = P[b*3+2], lo = -12;
    pos.push(ax,ay,az, bx,by,bz, ax,lo,az,  bx,by,bz, bx,lo,bz, ax,lo,az);
    for (const y of [ay,by,lo,by,lo,lo]) { const t = y <= lo ? 0.72 : 0.86; col.push(t, t*0.97, t*0.93); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  world.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
}
// context: 150 km of grey basemap around the box, flat
if (baseCtx) {
  const m = new THREE.ShaderMaterial({ uniforms: { t: { value: baseCtx }, fogC: { value: FOG }, fogD: { value: FOGD } },
    vertexShader: `varying vec2 vUv; varying float vD; void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vD=-mv.z; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D t; uniform vec3 fogC; uniform float fogD; varying vec2 vUv; varying float vD;
      void main(){ vec3 c=texture2D(t,vUv).rgb*0.97; c=mix(c,fogC,smoothstep(0.,1.,vD/fogD)*0.95); gl_FragColor=vec4(c,1.);
      #include <colorspace_fragment>
      }` });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(150000, 150000), m);
  p.rotation.x = -Math.PI/2; p.position.set(400000 - CX, -12, -(5580000 - CY)); world.add(p);
}

// ---------- the lake ----------
const lakeMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { ex: { value: S.ex }, k: { value: S.k }, thr: { value: 0 }, op: { value: S.op }, t: { value: 0 }, flowT: { value: flowTex }, light: { value: LIGHT },
    camP: { value: new THREE.Vector3() }, fogC: { value: FOG }, fogD: { value: FOGD } },
  vertexShader: `${COMMON} attribute float cold; uniform float k; varying float vH;
    void main(){ vUv=uv; vH=cold*k; vec3 p=position; p.y+=vH+0.6;
      vN=normalize(vec3(normal.x*ex,normal.y,normal.z*ex));
      vec4 w=modelMatrix*vec4(p,1.); vW=w.xyz; vec4 mv=viewMatrix*w; vD=-mv.z; gl_Position=projectionMatrix*mv; }`,
  fragmentShader: `${COMMON} uniform float op,t,fogD,thr; uniform sampler2D flowT; uniform vec3 light,camP,fogC; varying float vH;
    ${rampGLSL('coldRamp', RAMP)}
    float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
    float fbm(vec2 p){ return 0.55*vn(p)+0.3*vn(p*2.07)+0.15*vn(p*4.3); }
    void main(){
      if(vH<0.6 || vH<thr-1.5) discard;
      vec3 fl=texture2D(flowT,vUv).rgb; vec2 dir=fl.rg*2.-1.; float q=fl.b;
      vec2 P=vec2(vW.x,-vW.z)/260.;
      float ph=fract(t*0.08), ph2=fract(t*0.08+0.5);
      float mist=mix(fbm(P-dir*ph*(1.5+4.*q)),fbm(P-dir*ph2*(1.5+4.*q)+7.3),abs(ph-0.5)*2.);
      float depth=1.-exp(-vH/38.);
      vec3 c=coldRamp(max(vH,12.));
      vec3 V=normalize(camP-vW); vec3 n=normalize(vN);
      float fres=pow(1.-max(dot(n,V),0.),3.);
      c=c*(0.86+0.2*mist)+vec3(1.)*fres*0.18*depth;
      float a=op*(0.10+0.70*depth)*(0.88+0.25*mist);
      a*=smoothstep(2.,12.,vH)*smoothstep(thr-1.5,thr+2.5,vH);
      c=mix(c,fogC,smoothstep(0.,1.,vD/fogD)*0.85);
      gl_FragColor=vec4(c,clamp(a,0.,0.92));
      #include <colorspace_fragment>
    }`
});
const lake = new THREE.Mesh(buildGrid(true).g, lakeMat); lake.renderOrder = 3; world.add(lake);

// ---------- buildings (LoD2, real roofs) ----------
const litMat = (extra = '') => new THREE.ShaderMaterial({ uniforms: { light: { value: LIGHT }, ex: { value: S.ex }, fogC: { value: FOG }, fogD: { value: FOGD } },
  vertexShader: `${COMMON} attribute vec3 color; varying vec3 vC; ${extra ? 'attribute vec4 inst;' : ''}
    void main(){ vC=color; vec3 p=position; ${extra}
      vec4 w=modelMatrix*vec4(p,1.); vW=w.xyz; vec4 mv=viewMatrix*w; vD=-mv.z; gl_Position=projectionMatrix*mv; }`,
  fragmentShader: `${COMMON} uniform vec3 light,fogC; uniform float fogD; varying vec3 vC;
    void main(){ vec3 n=normalize(cross(dFdx(vW),dFdy(vW))); if(n.y<0.) n=-n; float lam=max(dot(n,light),0.);
      vec3 c=vC*(0.55+0.55*lam);
      c=mix(c,fogC,smoothstep(0.,1.,vD/fogD)*0.9); gl_FragColor=vec4(c,1.);
      #include <colorspace_fragment>
    }` });
let bld = null;
const bldReady = (async () => {
  const [pb, kb] = await Promise.all([fetch('data/lod2.bin').then(r => r.arrayBuffer()), fetch('data/lod2kind.bin').then(r => r.arrayBuffer())]);
  const P = new Uint16Array(pb), K = new Uint8Array(kb), nv = P.length/3;
  const pos = new Float32Array(nv*3), col = new Float32Array(nv*3);
  const roof = hex('#9a8f84'), wall = hex('#f3eee6');     // Day 5 building tones: warm white walls, darker roofs
  for (let i = 0; i < nv; i++) {
    const E = 395900 + P[i*3]/5, N = 5575900 + P[i*3+1]/5, z = P[i*3+2]/5;
    pos[i*3] = E - CX; pos[i*3+1] = z - ZB; pos[i*3+2] = CY - N;
    const c = K[(i/3)|0] === 0 ? roof : wall; col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  bld = new THREE.Mesh(g, litMat()); bld.renderOrder = 1; bld.material.uniforms.ex.value = S.ex;
  bld.visible = document.getElementById('tBld').checked; world.add(bld);
})();

// ---------- forest: one tree per ~40 m inside Basis-DLM forest polygons ----------
let trees = null;
{
  const tb = new Uint16Array(await fetch('data/trees.bin').then(r => r.arrayBuffer()));
  const every = LITE ? 3 : 1, nt = Math.floor(tb.length/3/every);
  const cone = new THREE.ConeGeometry(1, 1, 6, 1, true); cone.translate(0, 0.5, 0);
  const g = new THREE.InstancedBufferGeometry(); g.index = cone.index; g.attributes.position = cone.attributes.position;
  const inst = new Float32Array(nt*4), colr = new Float32Array(cone.attributes.position.count*3);
  for (let i = 0; i < cone.attributes.position.count; i++) { const y = cone.attributes.position.getY(i); const t = 0.78 + 0.22*y; colr[i*3] = 0.42*t; colr[i*3+1] = 0.52*t; colr[i*3+2] = 0.38*t; }
  g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  for (let j = 0; j < nt; j++) { const i = j*every, E = X0 + tb[i*3], N = Y0 + tb[i*3+1], h = tb[i*3+2]/10;
    inst[j*4] = E - CX; inst[j*4+1] = demAt(E, N) - ZB - 1.5; inst[j*4+2] = CY - N; inst[j*4+3] = h; }
  g.setAttribute('inst', new THREE.InstancedBufferAttribute(inst, 4)); g.instanceCount = nt;
  trees = new THREE.Mesh(g, litMat('p = vec3(p.x*inst.w*0.32, p.y*inst.w, p.z*inst.w*0.32) + inst.xyz;'));
  trees.frustumCulled = false; world.add(trees);
}

// ---------- flow: comet particles advected through the modelled flow field ----------
const NP = FILM ? 9000 : (LITE ? 3000 : 7000), TRAIL = 18, TIMESCALE = 300;
const spawnCells = []; let qsum = 0;
for (let i = 0; i < 360000; i++) if (FQ[i] > 10) { qsum += FQ[i]; spawnCells.push(i, qsum); }
function spawn(p) {
  const r = Math.random()*qsum; let lo = 0, hi = spawnCells.length/2 - 1;
  while (lo < hi) { const m = (lo+hi) >> 1; if (spawnCells[m*2+1] < r) lo = m+1; else hi = m; }
  const i = spawnCells[lo*2], x = i % 600, y = (i/600)|0;
  p.E = X0 + (x + Math.random())*50; p.N = Y0 + SIZE - (y + Math.random())*50; p.age = 0; p.life = 6 + Math.random()*8; p.tr = [];
}
const parts = Array.from({ length: NP }, () => { const p = {}; spawn(p); p.age = Math.random()*p.life; return p; });
const NV = NP*TRAIL*2;
const pPos = new Float32Array(NV*3), pCol = new Float32Array(NV*4), pSize = new Float32Array(NV);
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 4).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
const pMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { scale: { value: 1 } },
  vertexShader: `attribute vec4 color; attribute float size; uniform float scale; varying vec4 vC;
    void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=clamp(size*scale/-mv.z,1.8,6.5); gl_Position=projectionMatrix*mv; }`,
  fragmentShader: `varying vec4 vC; void main(){ vec2 d=gl_PointCoord-0.5; float r=length(d); if(r>0.5) discard; gl_FragColor=vec4(vC.rgb,vC.a*smoothstep(0.5,0.25,r));
    #include <colorspace_fragment>
  }` });
const pts = new THREE.Points(pGeo, pMat); pts.frustumCulled = false; pts.renderOrder = 4; world.add(pts);
const FC = FLOW.map(f => hex(f[1]));
function stepParticles(dt) {
  const k = S.k;
  for (let j = 0; j < NP; j++) {
    const p = parts[j]; p.age += dt;
    const q = fqAt(p.E, p.N), h = coldAt(p.E, p.N);
    if (p.age > p.life || q < 5 || p.E < X0 || p.E > X0+SIZE || p.N < Y0 || p.N > Y0+SIZE) { spawn(p); continue; }
    const sp = q / Math.max(h, 3);                           // m/s = volume-flux density / layer height
    const u = fuAt(p.E, p.N), v = fvAt(p.E, p.N), L = Math.hypot(u, v) || 1;
    p.E += u/L*sp*dt*TIMESCALE; p.N += v/L*sp*dt*TIMESCALE;
    p.tr.unshift([p.E, p.N, demAt(p.E, p.N), h, q]);
    if (p.tr.length > TRAIL) p.tr.pop();
  }
  let o = 0;
  for (let j = 0; j < NP; j++) {
    const p = parts[j], h0 = p.tr[0] ? p.tr[0][3] : 0, fade = Math.min(1, p.age/1.0, (p.life - p.age)/1.0) * k * Math.min(1, Math.max(0, (h0 - S.thr + 2) / 4));
    for (let s = 0; s < TRAIL; s++) {
      const a = p.tr[s], b = p.tr[s+1] || a;
      for (let h2 = 0; h2 < 2; h2++, o++) {
        if (!a) { pCol[o*4+3] = 0; pSize[o] = 0; continue; }
        const f = h2 * 0.5, E = a[0] + (b[0]-a[0])*f, N = a[1] + (b[1]-a[1])*f, G = a[2] + (b[2]-a[2])*f, H = a[3] + (b[3]-a[3])*f;
        pPos[o*3] = E-CX; pPos[o*3+1] = G + H*k + 4 - ZB; pPos[o*3+2] = CY-N;
        const c = a[4] >= 30 ? FC[2] : a[4] >= 20 ? FC[1] : FC[0], tt = 1 - (s + f)/TRAIL;
        pCol[o*4] = c.r; pCol[o*4+1] = c.g; pCol[o*4+2] = c.b; pCol[o*4+3] = fade * tt * 0.9;
        pSize[o] = (a[4] >= 30 ? 60 : a[4] >= 20 ? 50 : 42) * (0.35 + 0.65*tt);
      }
    }
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true; pGeo.attributes.size.needsUpdate = true;
}

// ---------- labels ----------
const LABELS = [
  ['Koblenz', 399600, 5579000, 'big'], ['Deutsches Eck', 400860, 5580120, ''], ['Ehrenbreitstein', 402350, 5580550, ''],
  ['Karthause', 398700, 5577300, ''], ['Neuwied', 390700, 5587300, ''], ['Lahnstein', 401300, 5574000, ''], ['Vallendar', 402300, 5585100, ''],
  ['Bendorf', 398600, 5587900, ''], ['Andernach', 387600, 5590800, ''], ['Winningen', 391300, 5574700, ''], ['Rhens', 397600, 5570200, ''],
  ['Rhein', 403200, 5571000, 'water'], ['Mosel', 393700, 5577300, 'water'], ['Lahn', 404400, 5573700, 'water'],
  ['Hunsrück', 393000, 5568200, 'reg'], ['Westerwald', 409500, 5588500, 'reg'], ['Maifeld', 387500, 5580500, 'reg'],
];
const lblBox = document.getElementById('labels');
const lbls = LABELS.map(([t, E, N, cls]) => { const d = document.createElement('div'); d.className = 'lbl ' + cls; d.textContent = t; lblBox.appendChild(d);
  return { d, E, N, z: (cls === 'reg' ? 120 : 30) }; });
const _v = new THREE.Vector3();
function placeLabels() {
  const w = innerWidth, h = innerHeight;
  for (const l of lbls) {
    _v.set(l.E - CX, (demAt(l.E, l.N) + l.z - ZB) * S.ex, CY - l.N).project(camera);
    const vis = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
    l.d.style.display = vis ? '' : 'none';
    if (vis) l.d.style.transform = `translate(-50%,-50%) translate(${(_v.x*0.5+0.5)*w}px,${(-_v.y*0.5+0.5)*h}px)`;
  }
}

// ---------- legend ----------
document.getElementById('legend').innerHTML = `
  <h4>Cold-air depth above ground</h4>
  <div class="ramp">${RAMP.slice(1,-1).map(r => `<i style="background:${r[1]}"></i>`).join('')}</div>
  <div class="tick mono"><span>10</span><span>30</span><span>50</span><span>70</span><span>90</span><span>120 m</span></div>
  <h4>Flow, m³/(s·m)</h4>
  ${FLOW.map(f => `<div class="lg-row"><i class="ln" style="background:${f[1]}"></i>${f[2]}</div>`).join('')}
  <div class="lg-row" style="margin-top:6px;color:var(--ink-3)">Colours: LfU Rheinland-Pfalz legend</div>`;

// ---------- camera ----------
const VIEWS = {
  all: { p: toWorld(391500, 5557500, 11500), t: toWorld(399800, 5580500, 60) },
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
function applyEx() { world.scale.y = S.ex; for (const m of [terrainMat, lakeMat, trees.material, bld && bld.material]) if (m) m.uniforms.ex.value = S.ex; $('exv').textContent = S.ex.toFixed(1)+'×'; }
applyEx();
$('tLake').onchange = e => lake.visible = e.target.checked;
$('tFlow').onchange = e => pts.visible = e.target.checked;
$('tBld').onchange = e => { if (bld) bld.visible = e.target.checked; };
$('tTree').onchange = e => trees.visible = e.target.checked;
$('tCon').onchange = e => terrainMat.uniforms.showCon.value = e.target.checked ? 1 : 0;
$('tRes').onchange = e => terrainMat.uniforms.showRes.value = e.target.checked ? 1 : 0;
$('tNight').onchange = e => terrainMat.uniforms.showNight.value = e.target.checked ? 1 : 0;
$('rK').oninput = e => { S.k = +e.target.value; lakeMat.uniforms.k.value = S.k; $('kO').textContent = S.k > 0.99 ? '2 h' : Math.round(S.k*100)+'%'; };
$('rThr').oninput = e => { S.thr = +e.target.value; lakeMat.uniforms.thr.value = S.thr; $('thrO').textContent = S.thr + ' m'; };
$('rOp').oninput = e => { S.op = +e.target.value; lakeMat.uniforms.op.value = S.op; $('opO').textContent = Math.round(S.op*100)+'%'; };
$('rEx').oninput = e => { S.ex = +e.target.value; applyEx(); };
$('bEck').onclick = () => setView(VIEWS.eck);
$('bAll').onclick = () => setView(VIEWS.all);
document.querySelectorAll('#baseSeg button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#baseSeg button').forEach(x => x.classList.toggle('on', x === b));
  terrainMat.uniforms.usePhoto.value = b.dataset.b === 'photo' ? 1 : 0;
});

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
  const z = demAt(p.E, p.N), h = coldAt(p.E, p.N), q = fqAt(p.E, p.N), nt = ntAt(p.E, p.N), sp = q > 5 ? q/Math.max(h, 3) : 0;
  const u = fuAt(p.E, p.N), v = fvAt(p.E, p.N), dirs = ['N','NE','E','SE','S','SW','W','NW'];
  const toward = dirs[Math.round(((Math.atan2(u, v)*180/Math.PI)+360)%360/45)%8];
  $('detail').hidden = false;
  $('detail').innerHTML = `<h3>${h < 2 ? 'Dry: almost no cold air here' : h.toFixed(0) + ' m of cold air above this point'}</h3>
    <div class="row"><span>Ground</span><b class="mono">${z.toFixed(0)} m a.s.l.</b></div>
    <div class="row"><span>Top of the cold air</span><b class="mono">${(z+h).toFixed(0)} m a.s.l.</b></div>
    <div class="row"><span>Flow</span><b class="mono">${q > 5 ? `${q.toFixed(0)} m³/(s·m) · ${sp.toFixed(1)} m/s → ${toward}` : 'weak or none'}</b></div>
    <div class="row"><span>Night surface temp. (6 Aug 2024)</span><b class="mono">${isNaN(nt) ? 'n/a' : (nt>0?'+':'')+nt.toFixed(1)+' °C'}</b></div>`;
});

// cross-section
let secPts = [], secLine = null;
$('bSec').onclick = () => { S.secMode = !S.secMode; $('bSec').classList.toggle('on', S.secMode); secPts = []; canvas.style.cursor = S.secMode ? 'crosshair' : ''; };
$('secX').onclick = () => { $('sec').hidden = true; if (secLine) world.remove(secLine); };
function secClick(p) { secPts.push(p); if (secPts.length < 2) return; const [a, b] = secPts; secPts = []; S.secMode = false; $('bSec').classList.remove('on'); canvas.style.cursor = ''; drawSection(a, b); }
function drawSection(a, b) {
  const n = 300, L = Math.hypot(b.E-a.E, b.N-a.N), G = [], T = [];
  for (let i = 0; i <= n; i++) { const E = a.E+(b.E-a.E)*i/n, N = a.N+(b.N-a.N)*i/n, z = demAt(E, N), h = coldAt(E, N); G.push(z); T.push(z+h); }
  const c = $('secC'), g = c.getContext('2d'), W = c.width, H = c.height, pad = 30;
  const lo = Math.min(...G)-10, hi = Math.max(...T)+10, X = i => pad + (W-2*pad)*i/n, Y = z => H-pad - (H-2*pad)*(z-lo)/(hi-lo);
  g.clearRect(0, 0, W, H);
  g.beginPath(); for (let i = 0; i <= n; i++) g.lineTo(X(i), Y(T[i])); for (let i = n; i >= 0; i--) g.lineTo(X(i), Y(G[i]));
  const gr = g.createLinearGradient(0, Y(hi), 0, Y(lo)); gr.addColorStop(0, 'rgba(130,233,251,.6)'); gr.addColorStop(1, 'rgba(21,152,246,.9)'); g.fillStyle = gr; g.fill();
  g.beginPath(); g.moveTo(X(0), H-pad); for (let i = 0; i <= n; i++) g.lineTo(X(i), Y(G[i])); g.lineTo(X(n), H-pad); g.fillStyle = '#d8d0c3'; g.fill();
  g.strokeStyle = '#6f6a61'; g.lineWidth = 1.5; g.beginPath(); for (let i = 0; i <= n; i++) g.lineTo(X(i), Y(G[i])); g.stroke();
  g.fillStyle = '#6f6a61'; g.font = '12px "DM Mono"'; g.fillText(`${Math.round(hi)} m`, 2, Y(hi)+4); g.fillText(`${Math.round(lo)} m`, 2, Y(lo));
  $('secT').textContent = `${(L/1000).toFixed(1)} km · blue = modelled cold-air layer · vertical scale exaggerated`;
  $('sec').hidden = false;
  if (secLine) world.remove(secLine);
  const P = []; for (let i = 0; i <= 60; i++) { const E = a.E+(b.E-a.E)*i/60, N = a.N+(b.N-a.N)*i/60; P.push(toWorld(E, N, demAt(E, N)+coldAt(E, N)+6)); }
  secLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(P), new THREE.LineBasicMaterial({ color: 0x2b2925 })); world.add(secLine);
}

// ---------- loop ----------
function frame(dt) {
  S.t += dt; lakeMat.uniforms.t.value = S.t; lakeMat.uniforms.camP.value.copy(camera.position);
  pMat.uniforms.scale.value = innerHeight * (FILM ? 1.7 : 1.0);
  if (pts.visible) stepParticles(Math.min(dt, 0.05));
  controls.update(); renderer.render(scene, camera); placeLabels();
}
let last = performance.now();
if (!FILM) (function loop(now) { const dt = (now-last)/1000; last = now; frame(dt); requestAnimationFrame(loop); })(last);
else { document.body.classList.add('film'); $('film').hidden = false; }
$('load').classList.add('gone');

// ---------- film API ----------
window.Film = {
  ready: true, bldReady, THREE, camera, controls, toWorld, demAt, coldAt, S, VIEWS,
  set(o) {
    if (o.k !== undefined) { S.k = o.k; lakeMat.uniforms.k.value = o.k; }
    if (o.thr !== undefined) { S.thr = o.thr; lakeMat.uniforms.thr.value = o.thr; }
    if (o.op !== undefined) lakeMat.uniforms.op.value = o.op;
    if (o.ex !== undefined) { S.ex = o.ex; applyEx(); }
    if (o.res !== undefined) terrainMat.uniforms.showRes.value = o.res;
    if (o.photo !== undefined) terrainMat.uniforms.usePhoto.value = o.photo;
    if (o.labels !== undefined) lblBox.style.opacity = o.labels;
    if (o.cam) { camera.position.copy(o.cam.p); controls.target.copy(o.cam.t); camera.lookAt(o.cam.t); }
    for (const id of ['fq', 'fa', 'fc', 'fs']) if (o[id] !== undefined) $(id).innerHTML = o[id];
    for (const id of ['fq', 'fa', 'fc', 'fs']) if (o[id+'o'] !== undefined) $(id).style.opacity = o[id+'o'];
  },
  warm(sec) { for (let t = 0; t < sec; t += 1/30) stepParticles(1/30); },
  advance(k, dt, thr = 0) { S.thr = thr; lakeMat.uniforms.thr.value = thr; S.k = k; lakeMat.uniforms.k.value = k; S.t += dt; stepParticles(Math.min(dt, 0.05)); },
  step(dt) { frame(dt); }
};
