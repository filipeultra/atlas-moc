// Espelho de vendas 3D: o prédio do lançamento, unidade por unidade, numa cidade low-poly.
// À noite, luz acesa = vendida (convenção do vídeo de referência). De dia, verde = disponível.
// Noite/dia vêm do sol real (sol.js): a posição do sol muda céu, luz, sombras e a convenção de cores.
// Render sob demanda: só desenha quando algo muda; parado = 0 quadros.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { fatorDia, LIMIAR_NOITE } from './sol.js';
import { layoutAndar, tocaDireita, tocaEsquerda } from './layout-predio.js';

// Cores lineares (HDR > 1 acende o bloom).
export const COR_JANELA = {
  noite: { vendida: [1.7, 1.08, 0.46], disponivel: [0.03, 0.055, 0.13], reservada: [1.5, 0.52, 0.12] },
  dia: { vendida: [0.13, 0.16, 0.21], disponivel: [0.2, 0.82, 0.58], reservada: [1.0, 0.5, 0.12] },
};
// Extremos do ambiente; entre eles a cena é interpolada por fatorDia (0 = noite, 1 = dia).
const AMBIENTE = {
  noite: { topo: '#030820', horiz: '#1b3c9c', chao: '#0a1128', solo: '#0d1532', quadra: '#141f45', predios: '#18234a', serra: '#0a1430', arvore: '#0f2b27', fog: '#14286a', praca: '#1d2a52', hemiCeu: '#6283e0', hemiChao: '#0a0f22', hemi: 1.15, lua: 0.7, bloom: 0.45, expo: 1.0 },
  dia: { topo: '#2f73d1', horiz: '#cfe2f4', chao: '#9aa48f', solo: '#8e9686', quadra: '#c9c3b5', predios: '#d8d0c2', serra: '#7c8ea8', arvore: '#4d7a3c', fog: '#c4d8ee', praca: '#d7d1c4', hemiCeu: '#dfeeff', hemiChao: '#6f6a58', hemi: 1.05, lua: 0, bloom: 0.12, expo: 0.95 },
};
// Crepúsculo: tom quente no horizonte, máximo com o sol perto da linha do horizonte (graus).
const CREPUSCULO = { horiz: '#ff8a4c', fog: '#c9785a', picoElev: 1, larguraElev: 9, forcaHoriz: 0.75, forcaFog: 0.35 };
const SOL_LUZ = { intensidade: 3.4, elevMin: 4, corBaixa: '#ffad6b', corAlta: '#fff1d6', luaPos: [-180, 260, 140], corLua: '#8aa6ff' };
const SOL_DISCO = { corBaixa: '#ff7a3a', corAlta: '#fff4e0', brilho: 9 };
// Antes do shell mandar o sol: noite, preserva a primeira impressão da v1.
const SOL_INICIAL = { azimute: 300, elevacao: -25 };
// Câmera de sombra ortográfica em volta do prédio (m).
const SOMBRA = { raio: 220, distancia: 800, near: 1, far: 1700, bias: -0.0004, normalBias: 0.35 };
// Qualidade já resolvida pelo shell (nunca 'auto' aqui).
export const QUALIDADE = {
  alta: { pixelRatio: 2, bloom: true, msaa: 4, sombra: 2048, densidade: 1 },
  equilibrada: { pixelRatio: 1.5, bloom: true, msaa: 0, sombra: 1024, densidade: 1 },
  economica: { pixelRatio: 1, bloom: false, msaa: 0, sombra: 0, densidade: 0.5 },
};
const QUALIDADE_PADRAO = 'equilibrada';
// Abaixo destes limiares por quadro o amortecimento terminou (o ângulo cobre a vista da janela, raio 0,1 m).
const LIMIAR_MOVIMENTO = 1e-3; // m
const LIMIAR_ANGULO = 1e-4; // rad
const PULSO = { hz: 5 / (2 * Math.PI), min: 0.35, amp: 0.65, estatico: 0.8, hover: 0.45 };
const VISTA = { afastamento: 0.6, alvo: 0.1, fov: 60, near: 0.1, polarMin: 0.15, giro: -0.45, duracao: 1.2 };
const TWEEN = { voo: 1.1, foco: 0.9, passo: 0.35 };
const CAMERA_BASE = { fov: 38, near: 1, far: 9000 };
const SEMENTE_CIDADE = 1857; // Montes Claros, 1857
const SEMENTE_DENSIDADE = 1831;

const ehNum = (n) => typeof n === 'number' && Number.isFinite(n);
const grau = THREE.MathUtils.DEG2RAD;

// Sol em coordenadas do mundo (azimute a partir do norte, horário) para o referencial do prédio
// (frente = +z, orientação A = azimute da normal da fachada frontal): θ' = az − A + 180.
export function direcaoSolPredio(azimute, elevacao, orientacaoGraus) {
  const t = (azimute - orientacaoGraus + 180) * grau, e = elevacao * grau;
  return [Math.sin(t) * Math.cos(e), Math.sin(e), -Math.cos(t) * Math.cos(e)];
}

function rngSemente(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function embaralhar(lista, rng) {
  for (let i = lista.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [lista[i], lista[j]] = [lista[j], lista[i]]; }
  return lista;
}

const caixaBase = new THREE.BoxGeometry(1, 1, 1);
const matriz = new THREE.Matrix4();
const q = new THREE.Quaternion();
const vs = new THREE.Vector3();
const vp = new THREE.Vector3();
const ROT_FACE = { frente: 0, fundos: Math.PI, dir: Math.PI / 2, esq: -Math.PI / 2 };

function compor(x, y, z, sx, sy, sz, rotY = 0) {
  q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rotY);
  return matriz.compose(vp.set(x, y, z), q, vs.set(sx, sy, sz));
}
function sombrear(obj, projeta, recebe) { obj.castShadow = projeta; obj.receiveShadow = recebe; return obj; }

// ------------------------------------------------------------------ ambiente
const CEU_FRAG = `
uniform vec3 topo; uniform vec3 horiz; uniform vec3 chao; uniform vec3 crep; uniform float forcaCrep;
uniform vec3 dirSol; uniform vec3 corSol; uniform float forcaDisco;
varying vec3 vP;
void main(){
  vec3 d = normalize(vP);
  float h = d.y;
  vec3 c = h > 0.0 ? mix(horiz, topo, pow(h, 0.55)) : mix(horiz, chao, clamp(-h*6.0,0.0,1.0));
  // crepúsculo: faixa quente rente ao horizonte, mais forte do lado do sol
  vec2 hz = normalize(d.xz + vec2(1e-5)); vec2 hs = normalize(dirSol.xz + vec2(1e-5));
  float lado = 0.5 + 0.5 * dot(hz, hs);
  float faixa = exp(-max(h, 0.0) * 7.0) * smoothstep(-0.12, 0.0, h);
  c = mix(c, crep, clamp(forcaCrep * faixa * (0.3 + 0.7 * lado * lado), 0.0, 1.0));
  // disco do sol (raio ~0,9°) e halo
  float cosA = dot(d, normalize(dirSol));
  float disco = smoothstep(0.99986, 0.99992, cosA);
  float halo = pow(max(cosA, 0.0), 600.0) * 0.8 + pow(max(cosA, 0.0), 30.0) * 0.12;
  c += corSol * forcaDisco * (disco * ${SOL_DISCO.brilho.toFixed(1)} + halo);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function criarAmbiente(cena) {
  const rng = rngSemente(SEMENTE_CIDADE);
  const amb = {};

  const ceuMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      topo: { value: new THREE.Color() }, horiz: { value: new THREE.Color() }, chao: { value: new THREE.Color() },
      crep: { value: new THREE.Color(CREPUSCULO.horiz) }, forcaCrep: { value: 0 },
      dirSol: { value: new THREE.Vector3(0, -1, 0) }, corSol: { value: new THREE.Color() }, forcaDisco: { value: 0 },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: CEU_FRAG,
  });
  amb.ceuMat = ceuMat;
  amb.ceu = new THREE.Mesh(new THREE.SphereGeometry(4200, 32, 16), ceuMat);
  cena.add(amb.ceu);

  const pos = [];
  for (let i = 0; i < 1600; i++) {
    const a = rng() * Math.PI * 2, e = 0.08 + rng() * 1.4;
    pos.push(Math.cos(a) * Math.cos(e) * 3900, Math.sin(e) * 3900, Math.sin(a) * Math.cos(e) * 3900);
  }
  const gEst = new THREE.BufferGeometry();
  gEst.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  amb.estrelas = new THREE.Points(gEst, new THREE.PointsMaterial({ color: 0xbfd2ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
  cena.add(amb.estrelas);

  amb.soloMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  const solo = sombrear(new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), amb.soloMat), false, true);
  cena.add(solo);

  // Serra: anel de cristas, mais alto a oeste (lado do Ibituruna).
  const seg = 320, R = 2000, posS = [], idx = [];
  const fases = [rng() * 6, rng() * 6, rng() * 6];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const oeste = Math.max(0, -Math.cos(a));
    const h = 70 + 55 * Math.sin(a * 5 + fases[0]) + 35 * Math.sin(a * 13 + fases[1]) + 18 * Math.sin(a * 31 + fases[2]) + 300 * oeste * oeste;
    posS.push(Math.cos(a) * R, -2, Math.sin(a) * R, Math.cos(a) * R * 0.985, Math.max(20, h), Math.sin(a) * R * 0.985);
    if (i < seg) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const gS = new THREE.BufferGeometry();
  gS.setAttribute('position', new THREE.Float32BufferAttribute(posS, 3));
  gS.setIndex(idx);
  gS.computeVertexNormals();
  amb.serraMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  cena.add(new THREE.Mesh(gS, amb.serraMat));

  // Quadras (calçadas), prédios do entorno, janelas, árvores e postes.
  // A sequência de sorteios é a mesma da v1 (mesma cidade); só a ordem das instâncias muda depois.
  const PASSO = 64, QUADRA = 50, LIM = 9, LIVRE = 78;
  const quadras = [], predios = [], arvores = [], postes = [];
  for (let i = -LIM; i <= LIM; i++) {
    for (let j = -LIM; j <= LIM; j++) {
      const cx = i * PASSO, cz = j * PASSO;
      if (Math.hypot(cx, cz) < LIVRE) continue;
      quadras.push([cx, cz]);
      const dist = Math.hypot(cx, cz);
      const n = 1 + Math.floor(rng() * 4);
      for (let k = 0; k < n; k++) {
        const w = 10 + rng() * 16, d = 10 + rng() * 16;
        const alto = dist > 230 && rng() < 0.14 * Math.max(0.2, 1 - dist / 700);
        const h = alto ? 24 + rng() * 40 : 4 + rng() * (dist > 230 ? 12 : 7);
        const x = cx + (rng() - 0.5) * (QUADRA - w), z = cz + (rng() - 0.5) * (QUADRA - d);
        const jp = [];
        predios.push({ x, z, w, h, d, janelas: jp, tom: 1 });
        const andares = Math.floor(h / 3.2);
        for (const face of ['frente', 'fundos', 'dir', 'esq']) {
          const larg = face === 'frente' || face === 'fundos' ? w : d;
          const cols = Math.max(1, Math.floor(larg / 3.6));
          for (let a = 0; a < andares; a++) {
            for (let c = 0; c < cols; c++) {
              if (rng() > 0.2) continue;
              const off = -larg / 2 + ((c + 0.5) * larg) / cols;
              const y = 1.6 + a * 3.2;
              let px = x, pz = z;
              if (face === 'frente') { px += off; pz += d / 2 + 0.06; }
              if (face === 'fundos') { px -= off; pz -= d / 2 + 0.06; }
              if (face === 'dir') { px += w / 2 + 0.06; pz -= off; }
              if (face === 'esq') { px -= w / 2 + 0.06; pz += off; }
              jp.push([px, y, pz, ROT_FACE[face], rng()]);
            }
          }
        }
      }
      for (let k = 0; k < 4; k++) {
        if (rng() < 0.55) arvores.push([cx + (rng() - 0.5) * QUADRA, cz + (k % 2 ? 1 : -1) * (QUADRA / 2 - 1.5), 0.7 + rng() * 0.6]);
      }
      postes.push([cx + QUADRA / 2 + 3, cz + QUADRA / 2 + 3]);
    }
  }
  for (const p of predios) p.tom = 0.8 + rng() * 0.35;

  // Ordem embaralhada: com mesh.count pela metade, some metade espalhada pela cidade, não um lado inteiro.
  const emb = rngSemente(SEMENTE_DENSIDADE);
  embaralhar(predios, emb);
  embaralhar(postes, emb);

  amb.quadraMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const mQ = sombrear(new THREE.InstancedMesh(caixaBase, amb.quadraMat, quadras.length), false, true);
  quadras.forEach(([x, z], i) => mQ.setMatrixAt(i, compor(x, 0.12, z, QUADRA, 0.24, QUADRA)));
  cena.add(mQ);

  amb.prediosMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const mP = sombrear(new THREE.InstancedMesh(caixaBase, amb.prediosMat, predios.length), true, true);
  const cor = new THREE.Color();
  const janelas = [], janelasAte = [0];
  predios.forEach(({ x, z, w, h, d, janelas: jp, tom }, i) => {
    mP.setMatrixAt(i, compor(x, h / 2, z, w, h, d));
    mP.setColorAt(i, cor.setScalar(tom));
    janelas.push(...jp);
    janelasAte.push(janelas.length);
  });
  cena.add(mP);

  amb.janelasMat = new THREE.MeshBasicMaterial({ fog: true });
  const mJ = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.5, 1.7), amb.janelasMat, janelas.length);
  janelas.forEach(([x, y, z, r, k], i) => {
    mJ.setMatrixAt(i, compor(x, y, z, 1, 1, 1, r));
    const quente = k < 0.8;
    mJ.setColorAt(i, quente ? cor.setRGB(0.9 + k * 0.5, 0.6 + k * 0.3, 0.25) : cor.setRGB(0.45, 0.7, 1.05));
  });
  amb.janelasCidade = mJ;
  cena.add(mJ);

  // árvores do terreno do lançamento vêm primeiro: nunca somem na qualidade econômica
  const lote = [];
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2, r = 46 + rng() * 14;
    lote.push([Math.cos(a) * r, Math.sin(a) * r, 0.8 + rng() * 0.6]);
  }
  embaralhar(arvores, emb);
  const todasArvores = [...lote, ...arvores];
  amb.arvoreMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
  const mA = sombrear(new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.6, 0), amb.arvoreMat, todasArvores.length), true, false);
  const troncoMat = new THREE.MeshStandardMaterial({ color: '#3b2a1e' });
  const mT = sombrear(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.3, 1, 5), troncoMat, todasArvores.length), true, false);
  todasArvores.forEach(([x, z, s], i) => {
    mA.setMatrixAt(i, compor(x, 3.6 * s + 0.2, z, s, s * 1.15, s));
    mT.setMatrixAt(i, compor(x, 1.4 * s, z, s, 2.8 * s, s));
  });
  cena.add(mA, mT);

  const mPo = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.15, 1, 5), new THREE.MeshStandardMaterial({ color: '#5a6275' }), postes.length);
  amb.lampMat = new THREE.MeshBasicMaterial();
  const mL = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 8, 6), amb.lampMat, postes.length);
  postes.forEach(([x, z], i) => { mPo.setMatrixAt(i, compor(x, 3.5, z, 1, 7, 1)); mL.setMatrixAt(i, compor(x, 7.2, z, 1, 1, 1)); });
  cena.add(mPo, mL);

  // Densidade da cidade via mesh.count (sem recriar buffers).
  amb.densidade = (frac) => {
    const nP = Math.ceil(predios.length * frac);
    mP.count = nP;
    mJ.count = janelasAte[nP];
    mA.count = mT.count = lote.length + Math.ceil(arvores.length * frac);
    mPo.count = mL.count = Math.ceil(postes.length * frac);
    for (const m of [mP, mJ, mA, mT, mPo, mL]) m.boundingSphere = null; // recalcula o culling com o novo count
    return { predios: nP, janelas: mJ.count, arvores: mA.count, postes: mPo.count };
  };
  amb.totais = { predios: predios.length, janelas: janelas.length, arvores: todasArvores.length, postes: postes.length };
  amb.instancias = { predios: mP, janelas: mJ, arvores: mA, troncos: mT, postes: mPo, lampadas: mL };

  // terreno do lançamento: praça, gramado e piscina
  amb.pracaMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const praca = sombrear(new THREE.Mesh(caixaBase, amb.pracaMat), false, true);
  praca.scale.set(120, 0.3, 120); praca.position.y = 0.15;
  cena.add(praca);
  amb.piscinaMat = new THREE.MeshBasicMaterial();
  const piscina = new THREE.Mesh(caixaBase, amb.piscinaMat);
  piscina.scale.set(14, 0.12, 6); piscina.position.set(-6, 0.36, -38);
  cena.add(piscina);

  amb.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  // Sol: única luz que projeta sombra. O alvo fica na origem (o prédio), fora da cena de propósito.
  amb.sol = new THREE.DirectionalLight(0xffffff, 1);
  const cs = amb.sol.shadow.camera;
  cs.left = cs.bottom = -SOMBRA.raio; cs.right = cs.top = SOMBRA.raio;
  cs.near = SOMBRA.near; cs.far = SOMBRA.far;
  cs.updateProjectionMatrix();
  amb.sol.shadow.bias = SOMBRA.bias;
  amb.sol.shadow.normalBias = SOMBRA.normalBias;
  amb.lua = new THREE.DirectionalLight(SOL_LUZ.corLua, 0);
  amb.lua.position.set(...SOL_LUZ.luaPos);
  cena.add(amb.hemi, amb.sol, amb.lua);
  amb.spot = new THREE.SpotLight(0xffd9a0, 0, 0, 0.55, 0.85, 1.4);
  amb.spot.position.set(0, 1, 70);
  cena.add(amb.spot, amb.spot.target);
  cena.fog = new THREE.Fog(0x000000, 420, 2300);

  const N = {}, D = {};
  for (const k of ['topo', 'horiz', 'chao', 'solo', 'quadra', 'predios', 'serra', 'arvore', 'fog', 'praca', 'hemiCeu', 'hemiChao']) {
    N[k] = new THREE.Color(AMBIENTE.noite[k]); D[k] = new THREE.Color(AMBIENTE.dia[k]);
  }
  const crepHoriz = new THREE.Color(CREPUSCULO.horiz), crepFog = new THREE.Color(CREPUSCULO.fog);
  const solBaixo = new THREE.Color(SOL_LUZ.corBaixa), solAlto = new THREE.Color(SOL_LUZ.corAlta);
  const discoBaixo = new THREE.Color(SOL_DISCO.corBaixa), discoAlto = new THREE.Color(SOL_DISCO.corAlta);
  const lerp = THREE.MathUtils.lerp, suave = THREE.MathUtils.smoothstep;
  const mix = (alvo, k, f) => alvo.lerpColors(N[k], D[k], f);
  const rgb = (a, b, f) => [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];

  // f = fatorDia(elev); dirCeu = direção real do sol (referencial do prédio); dirLuz = mesma, com elevação mínima.
  amb.aplicar = ({ f, elevacao, dirCeu, dirLuz }) => {
    const crep = Math.max(0, 1 - Math.abs(elevacao - CREPUSCULO.picoElev) / CREPUSCULO.larguraElev);
    const u = ceuMat.uniforms;
    mix(u.topo.value, 'topo', f);
    mix(u.horiz.value, 'horiz', f).lerp(crepHoriz, crep * CREPUSCULO.forcaHoriz);
    mix(u.chao.value, 'chao', f);
    u.forcaCrep.value = crep;
    u.dirSol.value.set(...dirCeu);
    u.corSol.value.lerpColors(discoBaixo, discoAlto, suave(elevacao, 0, 25));
    u.forcaDisco.value = suave(elevacao, -1.5, 1.5);
    mix(cena.fog.color, 'fog', f).lerp(crepFog, crep * CREPUSCULO.forcaFog);
    mix(amb.soloMat.color, 'solo', f);
    mix(amb.quadraMat.color, 'quadra', f);
    mix(amb.prediosMat.color, 'predios', f);
    mix(amb.serraMat.color, 'serra', f);
    mix(amb.arvoreMat.color, 'arvore', f);
    mix(amb.pracaMat.color, 'praca', f);
    // estrelas e janelas da cidade somem com o dia
    amb.estrelas.material.opacity = 0.85 * (1 - f) * (1 - f);
    amb.estrelas.visible = amb.estrelas.material.opacity > 0.01;
    amb.janelasMat.color.setScalar(1 - f);
    amb.janelasCidade.visible = f < 0.97;
    amb.lampMat.color.setRGB(...rgb([1.5, 1.0, 0.45], [0.9, 0.9, 0.85], f));
    amb.piscinaMat.color.setRGB(...rgb([0.2, 1.4, 1.8], [0.35, 0.75, 0.95], f));
    mix(amb.hemi.color, 'hemiCeu', f);
    mix(amb.hemi.groundColor, 'hemiChao', f);
    amb.hemi.intensity = lerp(AMBIENTE.noite.hemi, AMBIENTE.dia.hemi, f);
    amb.sol.position.set(dirLuz[0] * SOMBRA.distancia, dirLuz[1] * SOMBRA.distancia, dirLuz[2] * SOMBRA.distancia);
    amb.sol.intensity = SOL_LUZ.intensidade * suave(elevacao, -2, 10);
    amb.sol.color.lerpColors(solBaixo, solAlto, suave(elevacao, 2, 30));
    amb.lua.intensity = lerp(AMBIENTE.noite.lua, AMBIENTE.dia.lua, f);
    amb.spot.intensity = 260 * (1 - f);
    return { bloom: lerp(AMBIENTE.noite.bloom, AMBIENTE.dia.bloom, f), expo: lerp(AMBIENTE.noite.expo, AMBIENTE.dia.expo, f) };
  };
  return amb;
}

// ------------------------------------------------------------------ prédio
// layoutAndar vem de layout-predio.js: a insolação da ficha usa a mesma distribuição.

function construirPredio(l, modo) {
  const p = l.predio;
  const W = p.largura_m, D = p.profundidade_m, h = p.pe_direito_m;
  const podioH = 4.2 * p.podio_pavimentos;
  const andares = l.andares;
  const nAnd = andares.length;
  const topo = podioH + nAnd * h;
  const g = new THREE.Group();
  const obra = modo === 'obra';
  const nEstr = obra ? Math.round((l.obra.etapas.find((e) => e.nome === 'Estrutura')?.pct ?? 100) / 100 * nAnd) : nAnd;
  const nAlv = obra ? Math.min(nEstr, Math.round((l.obra.etapas.find((e) => e.nome === 'Alvenaria')?.pct ?? 100) / 100 * nAnd)) : nAnd;

  const fachada = new THREE.MeshStandardMaterial({ color: p.cor_fachada, roughness: 0.82 });
  const detalhe = new THREE.MeshStandardMaterial({ color: p.cor_detalhe, roughness: 0.5, metalness: 0.2 });
  const concreto = new THREE.MeshStandardMaterial({ color: '#9a9a96', roughness: 1 });

  // pódio
  const podio = sombrear(new THREE.Mesh(caixaBase, new THREE.MeshStandardMaterial({ color: '#3a3f4c', roughness: 0.7 })), true, true);
  podio.scale.set(W + 8, podioH, D + 8); podio.position.y = podioH / 2;
  g.add(podio);
  const lobbyMat = new THREE.MeshBasicMaterial();
  const lobby = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.7, podioH * 0.62), lobbyMat);
  lobby.position.set(0, podioH * 0.42, (D + 8) / 2 + 0.05);
  g.add(lobby);

  // núcleo (alvenaria pronta) e esqueleto (estrutura sem vedação)
  const altAlv = nAlv * h;
  if (altAlv > 0) {
    const nucleo = sombrear(new THREE.Mesh(caixaBase, fachada), true, true);
    nucleo.scale.set(W - 0.5, altAlv, D - 0.5); nucleo.position.y = podioH + altAlv / 2;
    g.add(nucleo);
  }
  const nLajes = nEstr + 1;
  const lajes = sombrear(new THREE.InstancedMesh(caixaBase, obra ? concreto : fachada, nLajes), true, false);
  for (let i = 0; i < nLajes; i++) lajes.setMatrixAt(i, compor(0, podioH + i * h, 0, W + 0.5, 0.24, D + 0.5));
  g.add(lajes);
  if (obra && nEstr > nAlv) {
    const pilares = [];
    for (let a = nAlv; a < nEstr; a++) {
      for (const fx of [-0.5, -0.17, 0.17, 0.5]) for (const fz of [-0.5, 0.5]) pilares.push([fx * (W - 1), podioH + a * h + h / 2, fz * (D - 1)]);
    }
    const mPil = sombrear(new THREE.InstancedMesh(caixaBase, concreto, pilares.length), true, false);
    pilares.forEach(([x, y, z], i) => mPil.setMatrixAt(i, compor(x, y, z, 0.6, h, 0.6)));
    g.add(mPil);
    const tela = new THREE.Mesh(caixaBase, new THREE.MeshStandardMaterial({ color: '#2f8f4e', transparent: true, opacity: 0.28, depthWrite: false }));
    const altT = (nEstr - nAlv) * h;
    tela.scale.set(W + 1.6, altT, D + 1.6); tela.position.y = podioH + nAlv * h + altT / 2;
    g.add(tela);
  }

  // varandas na frente + aletas verticais + coroamento
  const unidadesPorAndar = new Map();
  for (const u of l.unidades) {
    if (!unidadesPorAndar.has(u.andar)) unidadesPorAndar.set(u.andar, []);
    unidadesPorAndar.get(u.andar).push(u);
  }
  const vol = []; // por unidade: { u, cx, cy, cz, sx, sy, sz, face, janelas:[{x,y,z,w,h,rot}] }
  andares.forEach((andar, ia) => {
    const us = unidadesPorAndar.get(andar).sort((a, b) => a.final - b.final);
    const y0 = podioH + ia * h;
    for (const s of layoutAndar(us, W, D)) {
      const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2, sx = s.x1 - s.x0, sz = s.z1 - s.z0;
      const jan = [];
      const jh = h * 0.6, jy = y0 + h * 0.52;
      if (s.face === 'frente') jan.push({ x: cx, y: jy, z: D / 2 - 0.2, w: sx * 0.76, h: jh, rot: ROT_FACE.frente });
      else jan.push({ x: cx, y: jy, z: -D / 2 + 0.2, w: sx * 0.76, h: jh, rot: ROT_FACE.fundos });
      if (tocaDireita(s, W)) jan.push({ x: W / 2 - 0.2, y: jy, z: cz, w: sz * 0.6, h: jh, rot: ROT_FACE.dir });
      if (tocaEsquerda(s, W)) jan.push({ x: -W / 2 + 0.2, y: jy, z: cz, w: sz * 0.6, h: jh, rot: ROT_FACE.esq });
      vol.push({ u: s.u, ia, cx, cy: y0 + h / 2, cz, sx, sy: h, sz, face: s.face, janelas: jan, construida: ia < nAlv });
    }
  });

  const varandas = vol.filter((v) => v.face === 'frente' && v.construida);
  if (varandas.length) {
    const mV = sombrear(new THREE.InstancedMesh(caixaBase, fachada, varandas.length), true, false);
    const mG = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#a9cdf0', transparent: true, opacity: 0.22, depthWrite: false, roughness: 0.1 }), varandas.length);
    varandas.forEach((v, i) => {
      mV.setMatrixAt(i, compor(v.cx, v.cy - v.sy / 2 + 0.08, D / 2 + 0.75, v.sx * 0.86, 0.18, 1.5));
      mG.setMatrixAt(i, compor(v.cx, v.cy - v.sy / 2 + 0.65, D / 2 + 1.5, v.sx * 0.86, 1.05, 1));
    });
    g.add(mV, mG);
  }

  const altFin = podioH + nAlv * h + (nAlv === nAnd ? 5 : 0);
  if (nAlv > 0) {
    for (const x of [-W / 2 - 0.25, W / 2 + 0.25]) {
      const f = sombrear(new THREE.Mesh(caixaBase, detalhe), true, false);
      f.scale.set(0.5, altFin - podioH, 0.9); f.position.set(x, podioH + (altFin - podioH) / 2, D / 2 + 0.3);
      g.add(f);
    }
  }
  const led = new THREE.Mesh(caixaBase, new THREE.MeshBasicMaterial());
  led.scale.set(0.35, Math.max(0.01, altFin - podioH), 0.35);
  led.position.set(W * 0.18, podioH + (altFin - podioH) / 2, D / 2 + 1.7);
  led.visible = nAlv > 0;
  g.add(led);

  let coroa = null;
  if (nAlv === nAnd) {
    const casa = sombrear(new THREE.Mesh(caixaBase, fachada), true, false);
    casa.scale.set(W * 0.32, 3.4, D * 0.4); casa.position.set(-W * 0.18, topo + 1.7, -D * 0.1);
    g.add(casa);
    const plat = sombrear(new THREE.Mesh(caixaBase, fachada), true, false);
    plat.scale.set(W + 0.5, 1.1, D + 0.5); plat.position.y = topo + 0.55;
    g.add(plat);
    const r = new THREE.BufferGeometry().setFromPoints([
      [-W / 2 - 0.3, D / 2 + 0.3], [W / 2 + 0.3, D / 2 + 0.3], [W / 2 + 0.3, -D / 2 - 0.3], [-W / 2 - 0.3, -D / 2 - 0.3], [-W / 2 - 0.3, D / 2 + 0.3],
    ].map(([x, z]) => new THREE.Vector3(x, topo + 1.15, z)));
    coroa = new THREE.Line(r, new THREE.LineBasicMaterial());
    g.add(coroa);
  }

  // grua da obra
  if (obra && nAlv < nAnd) {
    const amarelo = new THREE.MeshStandardMaterial({ color: '#f2b705', roughness: 0.6 });
    const hg = podioH + nEstr * h + 16;
    const mastro = sombrear(new THREE.Mesh(caixaBase, amarelo), true, false);
    mastro.scale.set(1.6, hg, 1.6); mastro.position.set(W / 2 + 7, hg / 2, -D / 2 - 4);
    const lanca = sombrear(new THREE.Mesh(caixaBase, amarelo), true, false);
    lanca.scale.set(46, 1.2, 1.2); lanca.position.set(W / 2 + 7 - 14, hg, -D / 2 - 4);
    const contra = sombrear(new THREE.Mesh(caixaBase, concreto), true, false);
    contra.scale.set(4, 2.4, 2.4); contra.position.set(W / 2 + 7 + 8, hg - 0.6, -D / 2 - 4);
    const cabo = sombrear(new THREE.Mesh(caixaBase, concreto), true, false);
    cabo.scale.set(0.08, 14, 0.08); cabo.position.set(W / 2 + 7 - 24, hg - 7, -D / 2 - 4);
    g.add(mastro, lanca, contra, cabo);
  }

  return { grupo: g, vol, W, D, h, topo, podioH, lobbyMat, led, coroa, nAlv };
}

// Controles que o Espaço aciona nativamente (todos são <button>, os papéis ARIA ficam por garantia).
const SELETOR_BOTAO = 'button, a, summary, [role="button"], [role="switch"], [role="radio"], [role="tab"], [role="checkbox"]';
function ehCampoDeTexto(el) {
  return !!el && (el.isContentEditable === true || /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName || ''));
}

// ------------------------------------------------------------------ API
export function criarPredio({ canvas, eventos = {}, config = {} }) {
  const erro = (msg, err) => { console.error('[predio]', msg, err ?? ''); eventos.aoErro?.(msg); };

  let animacoes = config.animacoes ?? true;
  let qualidade = config.qualidade ?? QUALIDADE_PADRAO;
  if (!QUALIDADE[qualidade]) {
    erro(`Qualidade "${qualidade}" desconhecida para o prédio 3D; usando ${QUALIDADE_PADRAO}.`);
    qualidade = QUALIDADE_PADRAO;
  }

  // antialias só se decide na criação do contexto
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: qualidade !== 'economica', powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // a cena é estática: o mapa de sombra só muda com sol, geometria ou qualidade
  renderer.info.autoReset = false; // o composer chama render() várias vezes por quadro; zeramos à mão
  const cena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_BASE.fov, 1, CAMERA_BASE.near, CAMERA_BASE.far);
  const controles = new OrbitControls(camera, canvas);
  controles.enableDamping = true;
  controles.dampingFactor = 0.08;
  controles.minDistance = 18;
  controles.maxDistance = 520;
  controles.maxPolarAngle = Math.PI / 2 - 0.04;
  controles.autoRotateSpeed = 0.7;
  const LIMITES = { minDistance: 18, maxDistance: 520, minPolarAngle: 0, maxPolarAngle: Math.PI / 2 - 0.04, rotateSpeed: 1 };

  let composer = null, bloom = null, composerMsaa = -1, composerPR = 0, composerFlutuante = null;
  let bloomForca = AMBIENTE.noite.bloom;

  const amb = criarAmbiente(cena);
  let solAtual = { ...SOL_INICIAL };
  let luz = 'noite';
  let fDia = 0;
  let modo = 'comercial';
  let lanc = null;
  let orientacao = 0;
  let pr = null; // prédio construído
  let mJan = null, mHit = null, mFant = null, contorno = null, contornoLigado = false;
  let jPorUnidade = []; // índices de janela por volume
  let filtro = () => true;
  let hoverIdx = -1, selIdx = -1, andarDest = null;
  let vista = null, salvoOrbita = null;

  const caixaContorno = new THREE.EdgesGeometry(caixaBase);
  const hoverBox = new THREE.LineSegments(caixaContorno, new THREE.LineBasicMaterial({ color: 0xffffff }));
  const selBox = new THREE.LineSegments(caixaContorno, new THREE.LineBasicMaterial());
  const andarBox = new THREE.LineSegments(caixaContorno, new THREE.LineBasicMaterial());
  hoverBox.visible = selBox.visible = andarBox.visible = false;
  cena.add(hoverBox, selBox, andarBox);

  // ---------- render sob demanda
  let ativo = false, raf = 0, ultimoT = 0, noQuadro = false, quadros = 0, falhouRender = false;
  let ultimoInfo = { calls: 0, triangles: 0 };
  const posAnt = new THREE.Vector3(), alvoAnt = new THREE.Vector3(), quatAnt = new THREE.Quaternion();

  function pedirQuadro() {
    if (!ativo || raf || document.hidden) return;
    raf = requestAnimationFrame(quadro);
  }
  const pulsando = () => selIdx >= 0 && animacoes;
  const continuo = () => controles.autoRotate || pulsando();

  function corUnidade(v) {
    const c = COR_JANELA[luz][v.u.status];
    const k = filtro(v.u) ? 1 : 0.12;
    return [c[0] * k, c[1] * k, c[2] * k];
  }

  function pintarJanelas() {
    if (!pr) return;
    const cor = new THREE.Color();
    pr.vol.forEach((v, i) => {
      const [r, gg, b] = corUnidade(v);
      for (const j of jPorUnidade[i]) mJan.setColorAt(j, cor.setRGB(r, gg, b));
      if (mFant) {
        const base = { vendida: [1, 0.75, 0.3], disponivel: [0.25, 0.85, 1], reservada: [1, 0.5, 0.15] }[v.u.status];
        const k = filtro(v.u) ? 1 : 0.15;
        mFant.setColorAt(i, cor.setRGB(base[0] * k, base[1] * k, base[2] * k));
      }
    });
    mJan.instanceColor.needsUpdate = true;
    if (mFant) mFant.instanceColor.needsUpdate = true;
  }
  // Hover e seleção por cima da cor base; t em segundos (pulso só com animações ligadas).
  const corDest = new THREE.Color();
  function pintarDestaques(t) {
    if (!pr || (selIdx < 0 && hoverIdx < 0)) return;
    const brilho = luz === 'noite' ? [2.3, 1.95, 1.2] : [1.6, 1.25, 0.2];
    const kSel = animacoes ? PULSO.min + PULSO.amp * (0.5 + 0.5 * Math.sin(t * 2 * Math.PI * PULSO.hz)) : PULSO.estatico;
    for (const [i, k] of [[hoverIdx, PULSO.hover], [selIdx, kSel]]) {
      if (i < 0) continue;
      const base = corUnidade(pr.vol[i]);
      corDest.setRGB(...base.map((b, c) => b + (brilho[c] - b) * k));
      for (const j of jPorUnidade[i]) mJan.setColorAt(j, corDest);
    }
    mJan.instanceColor.needsUpdate = true;
  }

  function montarContorno() {
    if (contorno) { pr.grupo.remove(contorno); contorno.geometry.dispose(); contorno.material.dispose(); contorno = null; }
    if (!contornoLigado || !pr) return;
    const pts = [];
    const e = 0.18;
    for (const v of pr.vol) {
      if (v.u.status !== 'disponivel' || !filtro(v.u)) continue;
      for (const j of v.janelas) {
        const hw = j.w / 2 + e, hh = j.h / 2 + e;
        const nx = Math.sin(j.rot), nz = Math.cos(j.rot); // normal da face
        const tx = Math.cos(j.rot), tz = -Math.sin(j.rot); // tangente
        const ox = j.x + nx * 0.12, oz = j.z + nz * 0.12;
        const c = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([a, b]) => new THREE.Vector3(ox + tx * a, j.y + b, oz + tz * a));
        pts.push(c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]);
      }
    }
    contorno = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: new THREE.Color().setRGB(0.25, 2.2, 1.6) }));
    pr.grupo.add(contorno);
  }

  // ---------- sol, céu e luz
  function aplicarLuz() {
    const { azimute, elevacao } = solAtual;
    fDia = fatorDia(elevacao);
    const novaLuz = fDia < LIMIAR_NOITE ? 'noite' : 'dia';
    const dirCeu = direcaoSolPredio(azimute, elevacao, orientacao);
    const dirLuz = direcaoSolPredio(azimute, Math.max(elevacao, SOL_LUZ.elevMin), orientacao);
    const p = amb.aplicar({ f: fDia, elevacao, dirCeu, dirLuz });
    bloomForca = p.bloom;
    if (bloom) bloom.strength = bloomForca;
    renderer.toneMappingExposure = p.expo;
    renderer.shadowMap.needsUpdate = true;
    const lerp = THREE.MathUtils.lerp;
    const mistura = (a, b) => [lerp(a[0], b[0], fDia), lerp(a[1], b[1], fDia), lerp(a[2], b[2], fDia)];
    luz = novaLuz;
    if (pr) {
      pr.lobbyMat.color.setRGB(...mistura([0.55, 0.42, 0.26], [0.35, 0.45, 0.55]));
      pr.led.material.color.setRGB(...mistura([1.5, 1.15, 0.65], [0.85, 0.8, 0.7]));
      if (pr.coroa) pr.coroa.material.color.setRGB(...mistura([1.6, 1.2, 0.6], [0.6, 0.55, 0.45]));
    }
    selBox.material.color.setRGB(...(luz === 'noite' ? [3, 2.2, 0.8] : [0.9, 0.6, 0.05]));
    andarBox.material.color.setRGB(...(luz === 'noite' ? [1.4, 1.3, 1.1] : [0.12, 0.16, 0.26]));
    marcar();
    pedirQuadro();
  }

  // ---------- qualidade
  function descartarComposer() {
    if (!composer) return;
    for (const pass of composer.passes) pass.dispose?.();
    composer.dispose();
    composer = bloom = null; composerMsaa = -1; composerPR = 0; composerFlutuante = null;
  }
  function criarComposer(msaa) {
    descartarComposer();
    // HalfFloat só renderiza com EXT_color_buffer_float/half_float; sem elas a cena sairia preta sem exceção
    const ext = renderer.extensions;
    const flutuante = !ext || ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
    if (!flutuante) console.warn('[predio]', 'GPU sem render target em ponto flutuante: bloom em 8 bits (menos brilho nas janelas).');
    composerFlutuante = flutuante;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: flutuante ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: msaa });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(cena, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), bloomForca, 0.3, 1.0);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composerMsaa = msaa;
  }
  function aplicarQualidade(nome) {
    const qq = QUALIDADE[nome];
    if (!qq) { erro(`Qualidade "${nome}" desconhecida para o prédio 3D; mantida ${qualidade}.`); return; }
    qualidade = nome;
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, qq.pixelRatio));
    // ligar/desligar sombra muda o número de luzes com sombra: o three recompila os materiais sozinho
    const sombra = qq.sombra > 0;
    renderer.shadowMap.enabled = sombra;
    amb.sol.castShadow = sombra;
    if (sombra && amb.sol.shadow.mapSize.x !== qq.sombra) {
      amb.sol.shadow.mapSize.set(qq.sombra, qq.sombra);
      if (amb.sol.shadow.map) { amb.sol.shadow.map.dispose(); amb.sol.shadow.map = null; }
    }
    renderer.shadowMap.needsUpdate = true;
    if (qq.bloom) { if (!composer || composerMsaa !== qq.msaa) criarComposer(qq.msaa); } else descartarComposer();
    amb.densidade(qq.densidade);
    redimensionar();
    pedirQuadro();
  }

  // ---------- construção
  function descartarGrupo(g) {
    g.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && o.geometry !== caixaBase) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
  function construir() {
    if (pr) { cena.remove(pr.grupo); descartarGrupo(pr.grupo); contorno = null; }
    pr = construirPredio(lanc, modo);
    const nJan = pr.vol.reduce((s, v) => s + v.janelas.length, 0);
    mJan = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), nJan);
    mHit = new THREE.InstancedMesh(caixaBase, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), pr.vol.length);
    const fantasmas = modo === 'obra' && pr.vol.some((v) => !v.construida);
    mFant = fantasmas ? new THREE.InstancedMesh(caixaBase, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.32, depthWrite: false }), pr.vol.length) : null;
    jPorUnidade = [];
    let k = 0;
    pr.vol.forEach((v, i) => {
      const idx = [];
      for (const j of v.janelas) {
        mJan.setMatrixAt(k, v.construida ? compor(j.x, j.y, j.z, j.w, j.h, 1, j.rot) : compor(0, -50, 0, 0, 0, 0));
        idx.push(k++);
      }
      jPorUnidade.push(idx);
      mHit.setMatrixAt(i, compor(v.cx, v.cy, v.cz, v.sx, v.sy, v.sz));
      if (mFant) mFant.setMatrixAt(i, v.construida ? compor(0, -50, 0, 0, 0, 0) : compor(v.cx, v.cy, v.cz, v.sx * 0.94, v.sy * 0.86, v.sz * 0.94));
    });
    mJan.setColorAt(0, new THREE.Color());
    if (mFant) mFant.setColorAt(0, new THREE.Color());
    mHit.computeBoundingSphere();
    pr.grupo.add(mJan, mHit);
    if (mFant) pr.grupo.add(mFant);
    cena.add(pr.grupo);
    amb.spot.target.position.set(0, pr.topo * 0.6, 0);
    amb.spot.position.set(0, 1, pr.D / 2 + 46);
    montarContorno();
    posicionarAndar();
    aplicarLuz();
  }

  function caixaDe(i, box, folga) {
    const v = pr.vol[i];
    box.position.set(v.cx, v.cy, v.cz);
    box.scale.set(v.sx + folga, v.sy + folga, v.sz + folga);
  }
  function marcar() {
    if (!pr) return;
    pintarJanelas();
    pintarDestaques(performance.now() / 1000);
    hoverBox.visible = hoverIdx >= 0 && hoverIdx !== selIdx;
    if (hoverBox.visible) caixaDe(hoverIdx, hoverBox, 0.25);
    selBox.visible = selIdx >= 0;
    if (selBox.visible) caixaDe(selIdx, selBox, 0.4);
    pedirQuadro();
  }
  // Contorno do andar inteiro, incluindo as varandas da frente.
  function posicionarAndar() {
    const ia = andarDest == null || !pr ? -1 : lanc.andares.indexOf(andarDest);
    if (andarDest != null && pr && ia < 0) erro(`Andar ${andarDest} não existe em ${lanc.nome}.`);
    andarBox.visible = ia >= 0;
    if (!andarBox.visible) return;
    const zFrente = pr.D / 2 + 1.7, zFundos = -pr.D / 2 - 0.7;
    andarBox.position.set(0, pr.podioH + ia * pr.h + pr.h / 2, (zFrente + zFundos) / 2);
    andarBox.scale.set(pr.W + 1.4, pr.h - 0.08, zFrente - zFundos);
  }
  const indice = (numero) => (numero && pr ? pr.vol.findIndex((v) => v.u.numero === numero) : -1);

  // ---------- câmera
  let anim = null;
  const sph = new THREE.Spherical();
  const vtmp = new THREE.Vector3();
  function presets() {
    const retrato = Math.max(1, (0.8 / camera.aspect) ** 0.6); // tela em pé: afasta para caber na largura
    const H = pr.topo + 8, W = pr.W, D = pr.D, dist = Math.max(95, H * 2.05) * retrato;
    return {
      frente: { pos: [W * 0.9, H * 0.42, D / 2 + dist], alvo: [0, H * 0.46, 0] },
      lateral: { pos: [W / 2 + dist, H * 0.45, D * 0.5], alvo: [0, H * 0.46, 0] },
      fundos: { pos: [-W * 0.8, H * 0.45, -(D / 2 + dist)], alvo: [0, H * 0.46, 0] },
      topo: { pos: [W * 0.7, H * 1.7, D + 18], alvo: [0, H * 0.82, 0] },
    };
  }
  // Sem animações (prefers-reduced-motion), as transições de câmera viram corte seco.
  const duracao = (s) => (animacoes ? s * 1000 : 0);
  function voar(pos, alvo, dur = TWEEN.voo, { fov, aoFim, orbita } = {}) {
    // Um voo que interrompe outro herda o FOV de destino e o aoFim dele quando não traz os seus:
    // sair da vista da janela e logo trocar de câmera não pode perder o FOV 38 nem os limites da órbita.
    const ant = anim;
    if (fov == null) fov = ant?.fov;
    if (!aoFim) aoFim = ant?.aoFim;
    if (!orbita) orbita = ant?.orbita;
    const p0 = camera.position.clone(), a0 = controles.target.clone(), f0 = camera.fov;
    const p1 = new THREE.Vector3(...pos), a1 = new THREE.Vector3(...alvo);
    anim = {
      t0: performance.now(), dur: duracao(dur), aoFim, fov, orbita,
      aplicar(e) {
        camera.position.lerpVectors(p0, p1, e);
        controles.target.lerpVectors(a0, a1, e);
        if (fov != null) { camera.fov = f0 + (fov - f0) * e; camera.updateProjectionMatrix(); }
      },
    };
    pedirQuadro();
  }
  // Giro em arco (mantém a distância), para teclado e botões.
  function orbitar(dTheta, dPhi) {
    if (!pr) return;
    // Voo com fim pendente (volta da vista da janela): conclui antes, senão o giro parte do meio do caminho
    // e o FOV e os limites da órbita nunca voltam.
    if (anim?.aoFim) terminarAnim();
    vtmp.copy(camera.position).sub(controles.target);
    sph.setFromVector3(vtmp);
    const th0 = sph.theta, ph0 = sph.phi, r = sph.radius;
    const th1 = th0 + dTheta;
    const ph1 = THREE.MathUtils.clamp(ph0 + dPhi, Math.max(0.05, controles.minPolarAngle), controles.maxPolarAngle);
    controles.autoRotate = false;
    anim = {
      t0: performance.now(), dur: duracao(TWEEN.passo),
      aplicar(e) {
        sph.set(r, ph0 + (ph1 - ph0) * e, th0 + (th1 - th0) * e).makeSafe();
        camera.position.setFromSpherical(sph).add(controles.target);
      },
    };
    pedirQuadro();
  }
  function terminarAnim() {
    if (!anim) return;
    const a = anim; anim = null;
    a.aplicar(1);
    a.aoFim?.();
  }
  function limitesOrbita() { Object.assign(controles, LIMITES); controles.enablePan = true; controles.enableZoom = true; }
  // Sai da vista da janela; com voltar=false só devolve os limites (outra câmera vem em seguida).
  function sairDaVista(voltar) {
    if (!vista) return;
    vista = null;
    anim = null; // o voo de entrada na vista (FOV 60, trava em 0,1 m) não vale mais
    camera.near = CAMERA_BASE.near;
    camera.updateProjectionMatrix();
    const s = salvoOrbita; salvoOrbita = null;
    if (!voltar || !s) { limitesOrbita(); camera.fov = CAMERA_BASE.fov; camera.updateProjectionMatrix(); return; }
    // durante a volta a distância mínima fica livre, senão o clamp do OrbitControls dá um salto
    Object.assign(controles, { minDistance: 0.01, maxDistance: LIMITES.maxDistance, rotateSpeed: 1 });
    controles.enableZoom = true;
    voar(s.pos, s.alvo, TWEEN.voo, { fov: CAMERA_BASE.fov, aoFim: limitesOrbita, orbita: s });
  }

  // ---------- picking
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downXY = null, espaco = false, arrastando = false;
  function pick(ev) {
    if (!pr) return -1;
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    camera.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(mHit, false)[0];
    return hit ? hit.instanceId : -1;
  }
  function atualizarCursor() {
    canvas.style.cursor = espaco ? (arrastando ? 'grabbing' : 'grab') : hoverIdx >= 0 ? 'pointer' : '';
  }
  canvas.addEventListener('pointermove', (ev) => {
    if (!pr || ev.buttons) return; // arrastando: só a câmera importa
    const i = pick(ev);
    if (i !== hoverIdx) { hoverIdx = i; marcar(); atualizarCursor(); }
    eventos.aoPassar?.(i >= 0 ? pr.vol[i].u : null, ev.clientX, ev.clientY);
  });
  let ponteiroNoCanvas = false;
  canvas.addEventListener('pointerenter', () => { ponteiroNoCanvas = true; });
  canvas.addEventListener('pointerleave', () => {
    ponteiroNoCanvas = false;
    if (hoverIdx !== -1) { hoverIdx = -1; marcar(); atualizarCursor(); }
    eventos.aoPassar?.(null);
  });
  canvas.addEventListener('pointerdown', (ev) => {
    downXY = [ev.clientX, ev.clientY];
    if (anim) { if (anim.aoFim) terminarAnim(); else anim = null; }
    if (espaco) { arrastando = true; atualizarCursor(); }
    pedirQuadro();
  });
  const soltar = (ev) => {
    if (arrastando) { arrastando = false; atualizarCursor(); }
    if (ev.type !== 'pointerup' || !downXY || espaco || ev.button !== 0) return;
    if (Math.hypot(ev.clientX - downXY[0], ev.clientY - downXY[1]) > 6) return;
    const i = pick(ev);
    if (i >= 0) eventos.aoClicar?.(pr.vol[i].u);
  };
  canvas.addEventListener('pointerup', soltar);
  canvas.addEventListener('pointercancel', soltar);

  // Espaço + arrastar: o botão direito também gira (sem Espaço ele arrasta o prédio, padrão do OrbitControls).
  function soltarEspaco() {
    if (!espaco) return;
    espaco = false; arrastando = false;
    controles.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    atualizarCursor();
  }
  const ehEspaco = (ev) => ev.code === 'Space' || ev.key === ' ';
  window.addEventListener('keydown', (ev) => {
    if (!ativo || !ehEspaco(ev) || ehCampoDeTexto(ev.target) || ehCampoDeTexto(document.activeElement)) return;
    // Mesma regra da cidade: Espaço num botão (grade, switch, rádio) com o ponteiro fora do canvas aciona o botão.
    const foco = document.activeElement;
    const emBotao = foco && foco !== document.body && foco.closest?.(SELETOR_BOTAO);
    if (emBotao && !ponteiroNoCanvas) return;
    ev.preventDefault(); // não rola a página
    if (emBotao) foco.blur();
    if (espaco) return;
    espaco = true;
    controles.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    atualizarCursor();
  });
  window.addEventListener('keyup', (ev) => { if (ehEspaco(ev)) soltarEspaco(); });
  window.addEventListener('blur', soltarEspaco);

  // Interação do usuário pelo OrbitControls (arrasto, roda): pede quadro; dentro do quadro ignoramos o
  // 'change' do próprio update(), quem decide continuar é o limiar de movimento.
  controles.addEventListener('change', () => { if (!noQuadro) pedirQuadro(); });
  controles.addEventListener('start', pedirQuadro);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; ultimoT = 0; } else pedirQuadro();
  });

  // ---------- laço
  function renderizar(dt) {
    renderer.info.reset();
    if (composer) composer.render(dt); else renderer.render(cena, camera);
    quadros++;
    ultimoInfo = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  }
  function quadro(agora) {
    raf = 0;
    if (!ativo || document.hidden) { ultimoT = 0; return; }
    const dt = ultimoT ? Math.min(0.1, (agora - ultimoT) / 1000) : 1 / 60;
    ultimoT = agora;
    let continuar = false;
    if (anim) {
      const k = anim.dur > 0 ? Math.min(1, (performance.now() - anim.t0) / anim.dur) : 1;
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      anim.aplicar(e);
      if (k >= 1) { const fim = anim.aoFim; anim = null; fim?.(); }
      continuar = true;
    }
    posAnt.copy(camera.position); alvoAnt.copy(controles.target); quatAnt.copy(camera.quaternion);
    noQuadro = true;
    controles.update(dt);
    noQuadro = false;
    if (posAnt.distanceToSquared(camera.position) + alvoAnt.distanceToSquared(controles.target) > LIMIAR_MOVIMENTO ** 2) continuar = true;
    if (camera.quaternion.angleTo(quatAnt) > LIMIAR_ANGULO) continuar = true;
    if (controles.autoRotate) continuar = true;
    if (pulsando()) { pintarDestaques(agora / 1000); continuar = true; }
    try {
      renderizar(dt);
    } catch (err) {
      if (!falhouRender) erro(`Falha ao desenhar o prédio em 3D: ${err.message}`, err);
      falhouRender = true;
      return;
    }
    if (continuar) pedirQuadro(); else ultimoT = 0;
  }

  let margens = { esq: 0, dir: 0 };
  function redimensionar() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    if (composer) {
      const prAtual = renderer.getPixelRatio();
      if (composerPR !== prAtual) { composer.setPixelRatio(prAtual); composerPR = prAtual; }
      composer.setSize(w, h);
    }
    camera.aspect = w / h;
    const desloc = (margens.dir - margens.esq) / 2;
    if (desloc) camera.setViewOffset(w, h, desloc, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    pedirQuadro();
  }
  new ResizeObserver(redimensionar).observe(canvas);
  aplicarQualidade(qualidade);
  aplicarLuz();

  const api = {
    carregar(l) {
      lanc = l; hoverIdx = selIdx = -1; andarDest = null;
      orientacao = l?.predio?.orientacao_graus;
      if (!ehNum(orientacao)) {
        erro(`${l?.nome ?? 'Lançamento'} sem predio.orientacao_graus: sol e sombras calculados como se a frente olhasse para o norte.`);
        orientacao = 0;
      }
      // Sempre (não só com a vista aberta): a volta da vista pode estar em curso com FOV e limites pela metade.
      vista = null; salvoOrbita = null; anim = null;
      camera.near = CAMERA_BASE.near; camera.fov = CAMERA_BASE.fov; limitesOrbita();
      construir();
      redimensionar();
      const p = presets().frente;
      camera.position.set(...p.pos); controles.target.set(...p.alvo);
      pedirQuadro();
    },
    ativar(sim) {
      if (sim && !ativo) { ativo = true; redimensionar(); pedirQuadro(); }
      if (!sim && ativo) { ativo = false; soltarEspaco(); if (raf) cancelAnimationFrame(raf); raf = 0; ultimoT = 0; }
    },
    sol({ azimute, elevacao } = {}) {
      if (!ehNum(azimute) || !ehNum(elevacao)) { erro(`Posição do sol inválida para o prédio (azimute ${azimute}, elevação ${elevacao}).`); return; }
      solAtual = { azimute, elevacao };
      aplicarLuz();
    },
    // Compatibilidade com a v1 (o shell v2 usa sol()).
    luz(m) {
      api.sol(m === 'dia' ? { azimute: (orientacao + 40) % 360, elevacao: 55 } : { ...SOL_INICIAL });
    },
    estadoLuz: () => luz,
    configurar(parcial = {}) {
      if ('animacoes' in parcial && !!parcial.animacoes !== animacoes) { animacoes = !!parcial.animacoes; marcar(); }
      if ('qualidade' in parcial && parcial.qualidade !== qualidade) aplicarQualidade(parcial.qualidade);
    },
    modo(m) {
      if (m === modo) return;
      modo = m; const s = selIdx, hv = hoverIdx;
      construir();
      selIdx = s; hoverIdx = hv; marcar();
    },
    camera(nome) {
      const p = pr && presets()[nome];
      if (!p) { erro(`Câmera "${nome}" desconhecida ou prédio ainda não carregado.`); return; }
      sairDaVista(false);
      controles.autoRotate = false;
      voar(p.pos, p.alvo);
    },
    girar(sim) {
      if (sim) sairDaVista(true);
      controles.autoRotate = !!sim;
      pedirQuadro();
    },
    // Positivo gira a vista no sentido horário visto de cima, como o bearing do mapa.
    girarPasso(deltaGraus) { if (vista) return; orbitar(-deltaGraus * grau, 0); },
    // Positivo inclina para o horizonte (como o pitch do mapa).
    inclinar(deltaGraus) { if (vista) return; orbitar(0, deltaGraus * grau); },
    // Câmera de frente para a fachada principal (+z); na vista da janela, volta a olhar para fora.
    norte() {
      if (!pr) return;
      if (vista) { voar(vista.pos, vista.alvo, TWEEN.passo); return; }
      vtmp.copy(camera.position).sub(controles.target);
      sph.setFromVector3(vtmp);
      const th = Math.atan2(Math.sin(sph.theta), Math.cos(sph.theta));
      orbitar(-th, 0);
    },
    contorno(sim) { contornoLigado = sim; montarContorno(); pedirQuadro(); },
    filtrar(fn) { filtro = fn; montarContorno(); marcar(); },
    destacar(numero) { hoverIdx = indice(numero); marcar(); },
    destacarAndar(andar) { andarDest = andar ?? null; posicionarAndar(); pedirQuadro(); },
    selecionar(numero, { focar = false } = {}) {
      selIdx = indice(numero);
      if (numero && selIdx < 0 && pr) erro(`Unidade ${numero} não encontrada em ${lanc.nome}.`);
      marcar();
      if (focar && selIdx >= 0) {
        sairDaVista(false);
        const v = pr.vol[selIdx];
        const j = v.janelas[0];
        const n = [Math.sin(j.rot), Math.cos(j.rot)];
        const d = Math.max(88, pr.W * 2.6);
        controles.autoRotate = false;
        voar([v.cx + n[0] * d + n[1] * 10, v.cy + 6, v.cz + n[1] * d - n[0] * 10], [v.cx, v.cy, v.cz], TWEEN.foco);
      }
    },
    // Câmera 0,6 m para fora da janela principal, olhando para fora; null volta à órbita anterior.
    vistaDaUnidade(numero) {
      if (numero == null) { sairDaVista(true); return; }
      const i = indice(numero);
      if (i < 0) { erro(`Unidade ${numero} não encontrada para a vista da janela.`); return; }
      // Se a volta da vista anterior ainda está em curso, a órbita a guardar é o destino dela, não o meio do caminho.
      if (!vista) salvoOrbita = anim?.orbita ?? { pos: camera.position.toArray(), alvo: controles.target.toArray() };
      const j = pr.vol[i].janelas[0];
      const nx = Math.sin(j.rot), nz = Math.cos(j.rot);
      const pos = [j.x + nx * VISTA.afastamento, j.y, j.z + nz * VISTA.afastamento];
      const alvo = [pos[0] + nx * VISTA.alvo, pos[1], pos[2] + nz * VISTA.alvo];
      vista = { numero, pos, alvo };
      controles.autoRotate = false;
      controles.enablePan = false;
      Object.assign(controles, { minDistance: 0.01, maxDistance: LIMITES.maxDistance, minPolarAngle: VISTA.polarMin, maxPolarAngle: Math.PI - VISTA.polarMin });
      camera.near = VISTA.near;
      camera.updateProjectionMatrix();
      voar(pos, alvo, VISTA.duracao, {
        fov: VISTA.fov,
        aoFim() {
          if (!vista) return;
          // olhar em volta: órbita colada no alvo, arrasto invertido (puxa a paisagem, como foto 360)
          Object.assign(controles, { minDistance: VISTA.alvo, maxDistance: VISTA.alvo, rotateSpeed: VISTA.giro });
          controles.enableZoom = false;
        },
      });
    },
    emVista: () => vista?.numero ?? null,
    enquadrar(esq, dir) { margens = { esq, dir }; redimensionar(); },
    diagnostico() {
      return {
        drawCalls: ultimoInfo.calls,
        triangulos: ultimoInfo.triangles,
        quadros,
        modoRender: continuo() ? 'continuo' : 'sob-demanda',
        sombras: renderer.shadowMap.enabled ? amb.sol.shadow.mapSize.x : 0,
        qualidade,
        pixelRatio: renderer.getPixelRatio(),
        bloom: !!composer,
        composerFlutuante, // null = sem composer; false = GPU sem render target float (bloom em 8 bits)
        cidade: { predios: amb.instancias.predios.count, janelas: amb.instancias.janelas.count, arvores: amb.instancias.arvores.count },
        fatorDia: fDia,
      };
    },
  };
  api.__debug = { renderer, cena, camera, amb }; // alça de depuração (console), sem uso no app
  return api;
}
