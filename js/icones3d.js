// Ícones 3D low-poly dos imóveis no mapa. Unidade = altura total do pino (~1).
// Cada tipo vira UMA geometria com cores por vértice (1 draw call por ícone).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CORES = {
  venda: '#4f8cff',
  locacao: '#ff8a4c',
  lancamento: '#e4bd68',
};

const JANELA = new THREE.Color('#fff4cf');
const BRANCO = new THREE.Color('#f4f1ea');
const VIDRO = new THREE.Color('#9fd3ff');
const VERDE = new THREE.Color('#5fae62');

function parte(geo, cor, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv');
  g.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1),
  ));
  const n = g.attributes.position.count;
  const cores = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { cores[i * 3] = cor.r; cores[i * 3 + 1] = cor.g; cores[i * 3 + 2] = cor.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cores, 3));
  return g;
}

const caixa = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/** Janelinhas num prédio: colunas x linhas em cada uma das 4 faces. */
function janelas(partes, w, d, y0, y1, cols, linhas, cor) {
  const jw = (w / cols) * 0.42, jh = ((y1 - y0) / linhas) * 0.42, prof = 0.012;
  for (let r = 0; r < linhas; r++) {
    const y = y0 + ((r + 0.5) * (y1 - y0)) / linhas;
    for (let c = 0; c < cols; c++) {
      const x = -w / 2 + ((c + 0.5) * w) / cols;
      partes.push(parte(caixa(jw, jh, prof), cor, x, y, d / 2 + prof / 2));
      partes.push(parte(caixa(jw, jh, prof), cor, x, y, -d / 2 - prof / 2));
      const z = -d / 2 + ((c + 0.5) * d) / cols;
      partes.push(parte(caixa(prof, jh, jw), cor, w / 2 + prof / 2, y, z));
      partes.push(parte(caixa(prof, jh, jw), cor, -w / 2 - prof / 2, y, z));
    }
  }
}

function telhadoDuasAguas(w, h, d) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

const CONSTRUTORES = {
  casa(base, escura, clara) {
    const p = [];
    p.push(parte(caixa(0.38, 0.2, 0.3), clara, 0, 0.1));
    p.push(parte(telhadoDuasAguas(0.46, 0.15, 0.36), escura, 0, 0.2));
    p.push(parte(caixa(0.07, 0.11, 0.012), escura, 0.08, 0.055, 0.156));
    p.push(parte(caixa(0.08, 0.06, 0.012), JANELA, -0.09, 0.11, 0.156));
    p.push(parte(caixa(0.06, 0.08, 0.06), escura, 0.12, 0.3, -0.05)); // chaminé
    return p;
  },
  apartamento(base, escura, clara) {
    const p = [];
    p.push(parte(caixa(0.24, 0.46, 0.24), clara, 0, 0.23));
    p.push(parte(caixa(0.27, 0.03, 0.27), escura, 0, 0.475));
    p.push(parte(caixa(0.1, 0.05, 0.1), escura, 0.04, 0.515, 0.03));
    janelas(p, 0.24, 0.24, 0.06, 0.44, 2, 4, JANELA);
    return p;
  },
  cobertura(base, escura, clara) {
    const p = [];
    p.push(parte(caixa(0.24, 0.42, 0.24), clara, 0, 0.21));
    janelas(p, 0.24, 0.24, 0.05, 0.4, 2, 4, JANELA);
    p.push(parte(caixa(0.28, 0.025, 0.28), escura, 0, 0.432));
    p.push(parte(caixa(0.16, 0.09, 0.14), new THREE.Color('#ffe2a0'), -0.04, 0.49, -0.04));
    p.push(parte(caixa(0.09, 0.012, 0.08), VIDRO, 0.08, 0.452, 0.08));
    return p;
  },
  terreno(base, escura, clara) {
    const p = [];
    p.push(parte(caixa(0.42, 0.035, 0.42), VERDE, 0, 0.0175));
    for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2]]) {
      p.push(parte(caixa(0.025, 0.08, 0.025), BRANCO, x, 0.07, z));
    }
    p.push(parte(caixa(0.015, 0.34, 0.015), BRANCO, 0, 0.2, 0));
    p.push(parte(caixa(0.14, 0.09, 0.01), base, 0.075, 0.32, 0));
    return p;
  },
  comercial(base, escura, clara) {
    const p = [];
    p.push(parte(caixa(0.4, 0.22, 0.28), clara, 0, 0.11));
    p.push(parte(caixa(0.3, 0.1, 0.012), VIDRO, 0, 0.075, 0.146));
    p.push(parte(caixa(0.42, 0.025, 0.1), escura, 0, 0.16, 0.18, -0.35));
    p.push(parte(caixa(0.3, 0.08, 0.02), base, 0, 0.27, 0.1));
    p.push(parte(caixa(0.43, 0.02, 0.31), escura, 0, 0.23));
    return p;
  },
  lancamento(base, escura, clara) {
    const p = [];
    p.push(parte(caixa(0.22, 0.6, 0.22), new THREE.Color('#f1ece2'), 0, 0.3));
    janelas(p, 0.22, 0.22, 0.06, 0.56, 2, 6, JANELA);
    p.push(parte(caixa(0.26, 0.04, 0.26), base, 0, 0.62));
    p.push(parte(caixa(0.025, 0.66, 0.025), base, 0.125, 0.33, 0.125));
    p.push(parte(caixa(0.025, 0.66, 0.025), base, -0.125, 0.33, 0.125));
    // grua
    p.push(parte(caixa(0.02, 0.32, 0.02), new THREE.Color('#f2b705'), 0.06, 0.8, 0));
    p.push(parte(caixa(0.34, 0.02, 0.02), new THREE.Color('#f2b705'), 0.12, 0.96, 0));
    p.push(parte(caixa(0.05, 0.04, 0.04), escura, -0.04, 0.95, 0));
    return p;
  },
};

const cache = new Map();

/** Geometria do ícone (corpo flutuante), com cores por vértice. Base em y=0. */
export function geometriaIcone(tipo, finalidade) {
  const chave = `${tipo}|${finalidade}`;
  if (cache.has(chave)) return cache.get(chave);
  const base = new THREE.Color(CORES[finalidade] || CORES.venda);
  const escura = base.clone().multiplyScalar(0.55);
  const clara = base.clone().lerp(new THREE.Color('#ffffff'), 0.35);
  const fn = CONSTRUTORES[tipo] || CONSTRUTORES.apartamento;
  const g = mergeGeometries(fn(base, escura, clara), false);
  g.computeVertexNormals();
  g.computeBoundingBox();
  cache.set(chave, g);
  return g;
}

/** Textura radial para a sombra-borrão no chão. */
export function texturaSombra() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** SVG 2D do mesmo tipo, para lista e gaveta. */
export function svgTipo(tipo) {
  const s = {
    casa: '<path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" />',
    apartamento: '<rect x="6" y="3" width="12" height="18" rx="1" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" />',
    cobertura: '<rect x="6" y="7" width="12" height="14" rx="1" /><path d="M8 7V4h8v3" /><path d="M9 11h2M13 11h2M9 15h2M13 15h2" />',
    terreno: '<path d="M3 19h18" /><path d="M5 19V9M19 19V9" /><path d="M12 19V5" /><path d="M12 5h5l-1.5 2L17 9h-5" />',
    comercial: '<path d="M4 9h16l-1-4H5z" /><path d="M5 9v11h14V9" /><path d="M9 20v-5h6v5" />',
    lancamento: '<rect x="7" y="6" width="9" height="15" rx="1" /><path d="M10 10h1M13 10h1M10 14h1M13 14h1" /><path d="M16 3v3M11 3h10" />',
  }[tipo] || '';
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s}</svg>`;
}
