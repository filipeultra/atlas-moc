// Mapa 3D de Montes Claros: MapLibre (prédios extrudados do OSM) + camada three.js com os ícones.
// v2: um InstancedMesh por geometria (poucos draw calls), render sob demanda, pinos nativos com
// feature-state, agrupamento, visão 2D, rótulos configuráveis e luz do sol real.
// Clique/hover não usam raycast: cada quadro projeta base e topo de cada ícone para a tela,
// e o teste de toque é a distância do cursor a esse segmento (nos pinos, do centro ao topo do círculo).
import * as THREE from 'three';
import { geometriaIcone, texturaSombra, CORES } from './icones3d.js';
import { fatorDia } from './sol.js';

const ESTILOS = {
  dia: 'https://tiles.openfreemap.org/styles/liberty',
  noite: 'https://tiles.openfreemap.org/styles/fiord',
};
const CAMERA_INICIAL = { center: [-43.8705, -16.7330], zoom: 13.3, bearing: -14 };
const PITCH_3D = 56;
const MAX_PITCH_3D = 78;
const PITCH_VOO = 62;
const ZOOM_VOO = { imovel: 16.8, lancamento: 16.4 };
const ZOOM_MAX_ENQUADRAR = 16.5;
const MARGEM_ENQUADRAR = 48; // px além do padding dos painéis
const DURACAO = { passo: 320, visao: 650, grupo: 500 }; // ms
const RAIO_TOQUE = { fino: 20, grosso: 28 }; // px; dedo precisa de alvo maior
const ZOOM_ETIQUETAS = 14.6;
const FOLGA_ETIQUETA = 3; // px entre etiquetas no descarte de sobreposição
const LIMIAR_ESTILO = { paraDia: 0.55, paraNoite: 0.45 }; // histerese sobre fatorDia
const ORBITA = { grausPorPxGiro: 0.35, grausPorPxInclinar: 0.25, pxMovimento: 3 };
const AGRUPAMENTO = { raio: 50, zoomMax: 14 };
const PIXEL_RATIO_MAX = { alta: 2, equilibrada: 1.5, economica: 1 };
const PINO = { raio: 7, raioLancamento: 9, raioSel: 11, fatorHover: 1.3, borda: 2 };
const COR_SEL = '#ffe7a8';
const COR_GRUPO = { fundo: '#111827', borda: 'rgba(255,255,255,0.92)', texto: '#ffffff' };
const FONTE_GRUPO = ['Noto Sans Bold'];
const ICONE = { anguloParado: -0.6, escalaAnelParado: 1.12, opacAnelParado: 0.55, fatorHover: 1.18, fatorSel: 1.4 };
const META_VIS = 'atlas:visibilidade-original';

// Céu e luz por fatorDia (0 noite, 1 dia); o crepúsculo pesa mais perto de 0,5.
const CEU = {
  noite: { ceu: '#050b1f', horizonte: '#16295a', nevoa: '#0a1330' },
  dia: { ceu: '#5d9cff', horizonte: '#d6eaff', nevoa: '#eef5ff' },
  crepusculo: { ceu: '#2c3b78', horizonte: '#ff9a5c', nevoa: '#c98a6a' },
};
const LUZ = {
  noite: '#9db0ff', solBaixo: '#ffcf96', solAlto: '#ffffff', elevacaoSolAlto: 30,
  intensidadeMapa: [0.18, 0.5], // MapLibre: 0..1
  icones: { amb: [0.95, 1.1], dir: [0.9, 2.2] }, // three (luzes físicas do r160)
};

const CAMADAS = {
  icones: 'imoveis-3d',
  grupos: 'imoveis-grupos',
  gruposN: 'imoveis-grupos-n',
  pinos: 'imoveis-pinos',
  selHalo: 'imoveis-sel-halo',
  selPino: 'imoveis-sel-pino',
  predios: 'predios-3d',
};
const FONTES = { imoveis: 'imoveis', sel: 'imoveis-sel' };
// source-layer do OpenMapTiles → chave da config que liga/desliga os rótulos
const ROTULOS_POR_FONTE = { transportation_name: 'nomesRuas', place: 'nomesBairros', poi: 'pontosInteresse' };

const PADRAO_CIDADE = {
  icones: '3d', visao: '3d', prediosCidade: true, nomesRuas: true, nomesBairros: true,
  pontosInteresse: false, etiquetasPreco: true, agrupar: true, animacoes: true, qualidade: 'equilibrada',
};
const VALORES = { icones: ['3d', 'pinos', 'ocultos'], visao: ['3d', '2d'], qualidade: ['alta', 'equilibrada', 'economica'] };

const RAD = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

function hexParaRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function misturar(a, b, t) {
  const A = hexParaRgb(a), B = hexParaRgb(b);
  return '#' + A.map((v, i) => Math.round(lerp(v, B[i], clamp(t, 0, 1))).toString(16).padStart(2, '0')).join('');
}

async function carregarEstilo(modo) {
  const r = await fetch(ESTILOS[modo]);
  if (!r.ok) throw new Error(`estilo do mapa (${modo}) respondeu HTTP ${r.status}`);
  const s = await r.json();
  const primeiroSimbolo = s.layers.findIndex((l) => l.type === 'symbol');
  const extrusao = (cor, opac) => ({
    id: CAMADAS.predios, type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13.5,
    layout: { visibility: 'visible' },
    paint: {
      'fill-extrusion-color': cor,
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.5, ['coalesce', ['get', 'render_height'], 6]],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': opac,
    },
  });
  s.layers = s.layers.filter((l) => l.id !== 'building-3d');
  if (modo === 'noite') {
    for (const l of s.layers) {
      if (l.id === 'background') l.paint['background-color'] = '#0a1330';
      if (l.id === 'water') l.paint['fill-color'] = '#0b1d40';
      if (l.id === 'landuse_residential') { l.paint['fill-color'] = '#111c3c'; l.paint['fill-opacity'] = 0.7; }
      if (l.id === 'landcover_wood' || l.id === 'park') { l.paint = { ...l.paint, 'fill-color': '#0f2a2c' }; }
    }
    s.layers.splice(primeiroSimbolo, 0, extrusao(['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#1a2754', 40, '#2f4588'], 0.92));
  } else {
    s.layers.splice(primeiroSimbolo, 0, extrusao(['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#e4ddd0', 40, '#f4efe6'], 0.9));
  }
  // guarda a visibilidade original dos rótulos: "ligar" devolve ao que o estilo queria (fiord esconde highway_ref)
  for (const l of s.layers) {
    if (l.type === 'symbol' && ROTULOS_POR_FONTE[l['source-layer']]) {
      l.metadata = { ...(l.metadata || {}), [META_VIS]: l.layout?.visibility || 'visible' };
    }
  }
  return s;
}

/**
 * itens: [{ id, tipo, finalidade, lat, lng, rotulo }]
 * eventos: { aoPassar(id|null, clientX, clientY), aoClicar(id), aoErro(msg), aoPronto(), aoMudarCamera({ bearing, pitch, zoom }) }
 * config: chaves da seção 4 do contrato, com qualidade já resolvida. sol: { azimute, elevacao }
 */
export async function criarCidade({ container, camadaEtiquetas, itens, eventos = {}, config = {}, sol: solInicial }) {
  const erro = (msg, err) => {
    console.error('[cidade]', msg, err || '');
    eventos.aoErro?.(msg);
  };

  const cfg = { ...PADRAO_CIDADE };
  for (const [k, v] of Object.entries(config || {})) if (valorValido(k, v)) cfg[k] = v;

  let estadoSol = normalizarSol(solInicial) || { azimute: 0, elevacao: -30 };
  let fDia = fatorSeguro(estadoSol.elevacao);

  // ---------- estilos base (dia/noite), baixados uma vez e reaproveitados
  const cargas = {};
  const obterEstilo = (modo) => {
    if (!cargas[modo]) cargas[modo] = carregarEstilo(modo).catch((err) => { delete cargas[modo]; throw err; });
    return cargas[modo];
  };
  let modoEstilo = fDia < 0.5 ? 'noite' : 'dia';
  let modoPendente = null;
  let estiloPronto = false;
  const estiloInicial = prepararEstilo(await obterEstilo(modoEstilo));

  // ---------- itens válidos (sem coordenada não entra no mapa, e isso é avisado)
  const validos = [];
  for (const it of itens || []) {
    if (Number.isFinite(it?.lat) && Number.isFinite(it?.lng)) validos.push(it);
    else erro(`Imóvel ${it?.id ?? '(sem id)'} sem coordenadas válidas: fora do mapa.`);
  }
  if (!validos.length) throw new Error('nenhum imóvel com coordenadas para mostrar no mapa');

  const latMedia = validos.reduce((s, i) => s + i.lat, 0) / validos.length;
  const lngMedia = validos.reduce((s, i) => s + i.lng, 0) / validos.length;

  const map = new maplibregl.Map({
    container,
    style: estiloInicial,
    ...CAMERA_INICIAL,
    pitch: cfg.visao === '2d' ? 0 : PITCH_3D,
    maxPitch: cfg.visao === '2d' ? 0 : MAX_PITCH_3D,
    antialias: cfg.qualidade !== 'economica', // não muda depois de criado
    pixelRatio: pixelRatioPara(cfg.qualidade),
    attributionControl: { compact: true }, // licenças OSM/OpenFreeMap: atribuição sempre visível
  });
  // sem NavigationControl: o shell desenha a bússola com girar/inclinar/norte e aoMudarCamera

  // o sprite do estilo diurno não tem alguns ícones de POI: preenche com 1px transparente
  map.on('styleimagemissing', (e) => {
    if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
  const errosVistos = new Set();
  map.on('error', (e) => {
    const msg = e?.error?.message || String(e?.error || e);
    console.error('[mapa]', msg, e);
    if (!errosVistos.has(msg)) { errosVistos.add(msg); eventos.aoErro?.(`Mapa: ${msg}`); }
  });

  // ---------- cena three.js compartilhada (sobrevive à troca de estilo)
  const origem = maplibregl.MercatorCoordinate.fromLngLat([lngMedia, latMedia], 0);
  const s = origem.meterInMercatorCoordinateUnits();
  // local: +x leste, +y para cima, +z sul (metros)
  const localParaMerc = new THREE.Matrix4()
    .makeTranslation(origem.x, origem.y, origem.z)
    .scale(new THREE.Vector3(s, -s, s))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));

  const cena = new THREE.Scene();
  const camera = new THREE.Camera();
  const luzAmb = new THREE.AmbientLight(0xffffff, 1.1);
  const luzSol = new THREE.DirectionalLight(0xffffff, 2.2);
  cena.add(luzAmb, luzSol);

  const N = validos.length;
  const ds = validos.map((it, idx) => {
    const mc = maplibregl.MercatorCoordinate.fromLngLat([it.lng, it.lat], 0);
    const etq = document.createElement('div');
    etq.className = `etq ${it.finalidade}`;
    etq.textContent = it.rotulo ?? '';
    etq.style.display = 'none';
    camadaEtiquetas.appendChild(etq);
    const lanc = it.finalidade === 'lancamento';
    return {
      it, idx, lanc,
      x: (mc.x - origem.x) / s, z: (mc.y - origem.y) / s,
      fase: (idx * 0.618) % 1,
      base: lanc ? 1.3 : 1,
      topo: it.tipo === 'lancamento' ? 1.5 : 1.05,
      escala: 0,
      visivel: true, em3d: false, emPino: false, tela: null,
      malha: null, inst: -1,
      etq, etqW: 0, etqH: 0, etqVisivel: false, etqX: NaN, etqY: NaN, etqSel: false, etqHover: false,
      feature: {
        type: 'Feature', id: idx,
        geometry: { type: 'Point', coordinates: [it.lng, it.lat] },
        properties: { id: it.id, tipo: it.tipo, finalidade: it.finalidade, lanc },
      },
    };
  });
  const porId = new Map(ds.map((d) => [d.it.id, d]));

  // corpos: um InstancedMesh por geometria (tipo|finalidade)
  const matCorpo = new THREE.MeshLambertMaterial({ vertexColors: true });
  const porChave = new Map();
  for (const d of ds) {
    const k = `${d.it.tipo}|${d.it.finalidade}`;
    if (!porChave.has(k)) porChave.set(k, []);
    porChave.get(k).push(d);
  }
  const malhas = [];
  for (const [k, lista] of porChave) {
    const [tipo, finalidade] = k.split('|');
    const m = new THREE.InstancedMesh(geometriaIcone(tipo, finalidade), matCorpo, lista.length);
    lista.forEach((d, i) => { d.malha = m; d.inst = i; });
    malhas.push(m);
  }
  // anéis, sombras e hastes: uma instância por item em cada
  const geoAnel = new THREE.RingGeometry(0.24, 0.3, 48).rotateX(-Math.PI / 2);
  const opacAnel = new THREE.InstancedBufferAttribute(new Float32Array(N).fill(1), 1);
  opacAnel.setUsage(THREE.DynamicDrawUsage);
  geoAnel.setAttribute('aOpacidade', opacAnel);
  const matAnel = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  // opacidade por instância (o pulso apaga cada anel num tempo diferente)
  matAnel.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aOpacidade;\nvarying float vOpacidade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOpacidade = aOpacidade;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vOpacidade;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vOpacidade;');
  };
  matAnel.customProgramCacheKey = () => 'atlas-anel-opacidade';
  const aneis = new THREE.InstancedMesh(geoAnel, matAnel, N);
  aneis.renderOrder = 2;
  const geoSombra = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const matSombra = new THREE.MeshBasicMaterial({ map: texturaSombra(), transparent: true, depthWrite: false });
  const sombras = new THREE.InstancedMesh(geoSombra, matSombra, N);
  sombras.renderOrder = 1;
  const geoHaste = new THREE.CylinderGeometry(0.01, 0.01, 0.5, 6).translate(0, 0.25, 0);
  const matHaste = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
  const hastes = new THREE.InstancedMesh(geoHaste, matHaste, N);

  const todasMalhas = [...malhas, aneis, sombras, hastes];
  for (const m of todasMalhas) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // a esfera envolvente do InstancedMesh é calculada uma vez e não acompanha as matrizes
    m.frustumCulled = false;
    cena.add(m);
  }
  const corTmp = new THREE.Color();
  function pintarAneis() {
    for (const d of ds) aneis.setColorAt(d.idx, corTmp.set(d === sel ? COR_SEL : CORES[d.it.finalidade] || CORES.venda));
    aneis.instanceColor.needsUpdate = true;
  }

  // ---------- estado
  let hover = null;
  let sel = null;
  let naoAgrupados = null; // Set de ids soltos (fora de bolha); null = ainda não lido
  let n3d = 0;
  let sujo = true;
  let quadros = 0;
  let drawCalls = 0;
  let renderer = null;
  let W = 0, H = 0;
  let mapaNaTela = true;
  let ultimoZoom = NaN;
  const ultimaMatriz = new Float64Array(16).fill(NaN);
  const t0 = performance.now();
  const sombraDesvio = { x: 0, z: 0 };
  const raioToque = (globalThis.matchMedia?.('(pointer: coarse)').matches) ? RAIO_TOQUE.grosso : RAIO_TOQUE.fino;

  const v4 = new THREE.Vector4();
  const m4 = new THREE.Matrix4();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const pos = new THREE.Vector3();
  const esc = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const QUAT_ID = new THREE.Quaternion();
  const EIXO_Y = new THREE.Vector3(0, 1, 0);

  pintarAneis();
  aplicarSolIcones();

  function medirCanvas() {
    const c = map.getCanvas();
    W = c.clientWidth; H = c.clientHeight;
  }
  medirCanvas();

  function efetivo() {
    if (cfg.icones === 'ocultos') return 'ocultos';
    if (cfg.visao === '2d') return 'pinos';
    return cfg.icones;
  }
  const modo3d = () => {
    const ef = efetivo();
    return ef === '3d' || (ef === 'ocultos' && cfg.visao === '3d');
  };
  const deveAnimar = () => cfg.animacoes && n3d > 0;
  const lacoAtivo = () => deveAnimar() && mapaNaTela && !document.hidden;

  function recalcularVisibilidade() {
    const ef = efetivo();
    const em3dModo = modo3d();
    const agrupando = cfg.agrupar && ef !== 'ocultos';
    n3d = 0;
    for (const d of ds) {
      const solto = d === sel || !agrupando || (naoAgrupados !== null && naoAgrupados.has(d.it.id));
      const permitido = ef === 'ocultos' ? d === sel : solto;
      d.em3d = d.visivel && em3dModo && permitido;
      d.emPino = d.visivel && !em3dModo && permitido;
      if (d.em3d) n3d++;
      if (!d.em3d && !d.emPino) d.tela = null;
    }
  }

  function projetar(x, y, z, P) {
    v4.set(x, y, z, 1).applyMatrix4(P);
    if (v4.w <= 0) return null;
    return [((v4.x / v4.w + 1) / 2) * W, ((1 - v4.y / v4.w) / 2) * H, v4.w];
  }

  function atualizarInstancias(t, zoom, anim) {
    const mpp = (40075016.686 * Math.cos(latMedia * RAD)) / (512 * 2 ** zoom);
    const px = clamp(24 + ((zoom - 11.5) / 5) * 34, 24, 60);
    const alvoBase = px * mpp;
    for (const d of ds) {
      if (!d.em3d) {
        d.escala = 0;
        d.malha.setMatrixAt(d.inst, ZERO);
        aneis.setMatrixAt(d.idx, ZERO);
        sombras.setMatrixAt(d.idx, ZERO);
        hastes.setMatrixAt(d.idx, ZERO);
        continue;
      }
      const destaque = d === sel ? ICONE.fatorSel : d === hover ? ICONE.fatorHover : 1;
      const alvo = alvoBase * d.base * destaque;
      d.escala = anim && d.escala ? d.escala + (alvo - d.escala) * 0.18 : alvo;
      const e = d.escala;
      const ang = anim ? t * 0.55 + d.fase * Math.PI * 2 : ICONE.anguloParado;
      const bob = anim ? Math.sin(t * 2 + d.fase * 6) * 0.025 : 0;
      d.malha.setMatrixAt(d.inst, m4.compose(pos.set(d.x, (0.5 + bob) * e, d.z), quat.setFromAxisAngle(EIXO_Y, ang), esc.setScalar(e)));
      hastes.setMatrixAt(d.idx, m4.compose(pos.set(d.x, 0, d.z), QUAT_ID, esc.setScalar(e)));
      sombras.setMatrixAt(d.idx, m4.compose(pos.set(d.x + sombraDesvio.x * e, 0, d.z + sombraDesvio.z * e), QUAT_ID, esc.setScalar(0.75 * e)));
      const pulso = anim ? (t * 0.7 + d.fase) % 1 : 0;
      const escAnel = anim ? 1 + pulso * 0.9 : ICONE.escalaAnelParado;
      aneis.setMatrixAt(d.idx, m4.compose(pos.set(d.x, 0, d.z), QUAT_ID, esc.setScalar(e * escAnel)));
      opacAnel.array[d.idx] = (d === sel ? 1 : 0.85) * (anim ? 1 - pulso : ICONE.opacAnelParado);
    }
    for (const m of todasMalhas) m.instanceMatrix.needsUpdate = true;
    opacAnel.needsUpdate = true;
  }

  function raioPino(d) {
    return d === sel ? PINO.raioSel : d.lanc ? PINO.raioLancamento : PINO.raio;
  }

  function atualizarTela(P) {
    for (const d of ds) {
      if (!d.em3d && !d.emPino) { d.tela = null; continue; }
      const b = projetar(d.x, 0, d.z, P);
      if (!b) { d.tela = null; continue; }
      if (d.em3d) {
        const a = projetar(d.x, d.escala * d.topo, d.z, P);
        d.tela = a ? { x0: b[0], y0: b[1], x1: a[0], y1: a[1], w: b[2] } : null;
      } else {
        d.tela = { x0: b[0], y0: b[1], x1: b[0], y1: b[1] - raioPino(d), w: b[2] };
      }
    }
  }

  function prioridadeEtiqueta(d) {
    return d === sel ? 0 : d === hover ? 1 : d.lanc ? 2 : 3;
  }
  const sobrepoe = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

  function atualizarEtiquetas() {
    const ativo = cfg.etiquetasPreco && map.getZoom() >= ZOOM_ETIQUETAS && mapaNaTela;
    const cands = [];
    if (ativo) {
      for (const d of ds) {
        const t = d.tela;
        if (!t || t.x1 < -60 || t.x1 > W + 60 || t.y1 < -30 || t.y1 > H + 40) continue;
        cands.push(d);
      }
    }
    // mede uma vez cada etiqueta nova: escreve todas, depois lê todas (um único reflow)
    const semMedida = cands.filter((d) => !d.etqW);
    if (semMedida.length) {
      for (const d of semMedida) { d.etq.style.visibility = 'hidden'; d.etq.style.display = ''; }
      for (const d of semMedida) { d.etqW = d.etq.offsetWidth; d.etqH = d.etq.offsetHeight; }
      for (const d of semMedida) { d.etq.style.visibility = ''; if (!d.etqVisivel) d.etq.style.display = 'none'; }
    }
    cands.sort((a, b) => prioridadeEtiqueta(a) - prioridadeEtiqueta(b) || a.tela.w - b.tela.w);
    const ocupados = [];
    const mostrar = new Set();
    for (const d of cands) {
      const w = d.etqW || 14 + 7 * d.etq.textContent.length; // estimativa se o container estiver oculto
      const h = d.etqH || 20;
      const x = d.tela.x1, y = d.tela.y1 - 6;
      const r = [x - w / 2 - FOLGA_ETIQUETA, y - h - FOLGA_ETIQUETA, x + w / 2 + FOLGA_ETIQUETA, y + FOLGA_ETIQUETA];
      if (ocupados.some((o) => sobrepoe(o, r))) continue;
      ocupados.push(r);
      mostrar.add(d);
    }
    for (const d of ds) {
      const vis = mostrar.has(d);
      if (vis !== d.etqVisivel) { d.etq.style.display = vis ? '' : 'none'; d.etqVisivel = vis; }
      if (!vis) continue;
      const x = d.tela.x1, y = d.tela.y1 - 6;
      // !(<=) porque a posição inicial é NaN e NaN > 0,25 seria falso
      if (!(Math.abs(x - d.etqX) <= 0.25 && Math.abs(y - d.etqY) <= 0.25)) {
        d.etq.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
        d.etqX = x; d.etqY = y;
      }
      const eSel = d === sel, eHover = d === hover;
      if (eSel !== d.etqSel) { d.etq.classList.toggle('sel', eSel); d.etqSel = eSel; }
      if (eHover !== d.etqHover) { d.etq.classList.toggle('hover', eHover); d.etqHover = eHover; }
    }
  }

  function matrizMudou(matrix) {
    let mudou = false;
    for (let i = 0; i < 16; i++) {
      if (ultimaMatriz[i] !== matrix[i]) { mudou = true; ultimaMatriz[i] = matrix[i]; }
    }
    return mudou;
  }

  function agendarQuadro() {
    if (mapaNaTela && !document.hidden) map.triggerRepaint();
  }
  function marcarSujo() {
    sujo = true;
    map.triggerRepaint();
  }

  const camada = {
    id: CAMADAS.icones,
    type: 'custom',
    renderingMode: '3d',
    onAdd(m, gl) {
      if (!renderer) {
        renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
        renderer.autoClear = false;
      }
    },
    render(gl, matrix) {
      quadros++;
      try {
        const anim = deveAnimar();
        const t = (performance.now() - t0) / 1000;
        const zoom = map.getZoom();
        const camMudou = matrizMudou(matrix);
        const P = camera.projectionMatrix.fromArray(matrix).multiply(localParaMerc);
        if (anim || sujo || zoom !== ultimoZoom) atualizarInstancias(t, zoom, anim);
        ultimoZoom = zoom;
        if (anim || sujo || camMudou) {
          atualizarTela(P);
          atualizarEtiquetas();
        }
        sujo = false;
        if (n3d > 0) {
          renderer.resetState();
          renderer.render(cena, camera);
          drawCalls = renderer.info.render.calls;
        } else {
          drawCalls = 0;
        }
        if (anim) agendarQuadro();
      } catch (err) {
        // um erro por quadro viraria enxurrada: avisa uma vez por mensagem
        const msg = `Ícones do mapa: ${err.message}`;
        if (!errosVistos.has(msg)) { errosVistos.add(msg); erro(msg, err); }
      }
    },
  };

  // ---------- fontes e camadas nativas dos pinos e das bolhas
  function dadosImoveis() {
    return { type: 'FeatureCollection', features: ds.filter((d) => d.visivel && d !== sel).map((d) => d.feature) };
  }
  function dadosSel() {
    return { type: 'FeatureCollection', features: sel && sel.visivel ? [sel.feature] : [] };
  }
  const corFinalidade = ['match', ['get', 'finalidade'], 'venda', CORES.venda, 'locacao', CORES.locacao, 'lancamento', CORES.lancamento, CORES.venda];
  const hoverExpr = ['boolean', ['feature-state', 'hover'], false];
  const ehLanc = ['==', ['get', 'lanc'], true];

  function adicionarFontesECamadas() {
    map.addSource(FONTES.imoveis, {
      type: 'geojson', data: dadosImoveis(),
      cluster: cfg.agrupar, clusterRadius: AGRUPAMENTO.raio, clusterMaxZoom: AGRUPAMENTO.zoomMax,
    });
    map.addSource(FONTES.sel, { type: 'geojson', data: dadosSel() });
    map.addLayer({
      id: CAMADAS.grupos, type: 'circle', source: FONTES.imoveis, filter: ['has', 'point_count'],
      paint: {
        'circle-color': COR_GRUPO.fundo,
        'circle-opacity': 0.9,
        'circle-radius': ['step', ['get', 'point_count'], 15, 10, 19, 30, 24],
        'circle-stroke-width': 2,
        'circle-stroke-color': COR_GRUPO.borda,
      },
    });
    map.addLayer({
      id: CAMADAS.gruposN, type: 'symbol', source: FONTES.imoveis, filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': FONTE_GRUPO,
        'text-size': 12,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': COR_GRUPO.texto },
    });
    const raio = ['case', ehLanc, PINO.raioLancamento, PINO.raio];
    map.addLayer({
      id: CAMADAS.pinos, type: 'circle', source: FONTES.imoveis, filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': corFinalidade,
        'circle-radius': ['case', hoverExpr, ['*', raio, PINO.fatorHover], raio],
        'circle-stroke-width': PINO.borda,
        'circle-stroke-color': ['case', ehLanc, '#fff6dc', '#ffffff'],
      },
    });
    map.addLayer({
      id: CAMADAS.selHalo, type: 'circle', source: FONTES.sel,
      paint: { 'circle-color': COR_SEL, 'circle-opacity': 0.28, 'circle-radius': PINO.raioSel + 9, 'circle-blur': 0.4 },
    });
    map.addLayer({
      id: CAMADAS.selPino, type: 'circle', source: FONTES.sel,
      paint: {
        'circle-color': corFinalidade,
        'circle-radius': ['case', hoverExpr, PINO.raioSel * 1.12, PINO.raioSel],
        'circle-stroke-width': 3.5,
        'circle-stroke-color': COR_SEL,
      },
    });
    map.addLayer(camada);
  }

  function visibilidade(id, vis) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis ? 'visible' : 'none');
  }
  function aplicarVisibilidadeCamadas() {
    if (!estiloPronto) return;
    const ef = efetivo();
    const grupos = cfg.agrupar && ef !== 'ocultos';
    visibilidade(CAMADAS.grupos, grupos);
    visibilidade(CAMADAS.gruposN, grupos);
    visibilidade(CAMADAS.pinos, ef === 'pinos');
    const selNativo = ef === 'pinos' || (ef === 'ocultos' && cfg.visao === '2d');
    visibilidade(CAMADAS.selHalo, selNativo);
    visibilidade(CAMADAS.selPino, selNativo);
    visibilidade(CAMADAS.predios, cfg.prediosCidade && cfg.visao === '3d');
  }

  function atualizarFontes() {
    if (!estiloPronto) return;
    map.getSource(FONTES.imoveis)?.setData(dadosImoveis());
    map.getSource(FONTES.sel)?.setData(dadosSel());
    aplicarHoverNativo(); // o feature-state sobrevive ao setData; só troca se o hover mudou
  }

  // feature-state do hover nos pinos nativos
  let estadoHover = null; // { source, id }
  function aplicarHoverNativo() {
    if (!estiloPronto) return;
    const novo = hover && (hover.emPino) ? { source: hover === sel ? FONTES.sel : FONTES.imoveis, id: hover.idx } : null;
    if (estadoHover && (!novo || novo.source !== estadoHover.source || novo.id !== estadoHover.id)) {
      if (map.getSource(estadoHover.source)) map.removeFeatureState(estadoHover, 'hover');
      estadoHover = null;
    }
    if (novo && !estadoHover && map.getSource(novo.source)) {
      map.setFeatureState(novo, { hover: true });
      estadoHover = novo;
    }
  }

  // quais imóveis estão soltos (fora de bolha) no zoom atual
  let leituraAgendada = null;
  function agendarLeituraAgrupamento() {
    if (leituraAgendada) return;
    leituraAgendada = setTimeout(() => { leituraAgendada = null; lerAgrupamento(); }, 40);
  }
  function lerAgrupamento() {
    if (!estiloPronto || !cfg.agrupar || !map.getSource(FONTES.imoveis)) return;
    let feicoes;
    try { feicoes = map.querySourceFeatures(FONTES.imoveis); }
    catch (err) { erro(`Não li o agrupamento dos imóveis: ${err.message}`, err); return; }
    const novo = new Set();
    for (const f of feicoes) if (!f.properties?.cluster && f.properties?.id != null) novo.add(f.properties.id);
    if (naoAgrupados && novo.size === naoAgrupados.size && [...novo].every((id) => naoAgrupados.has(id))) return;
    naoAgrupados = novo;
    recalcularVisibilidade();
    aplicarHoverNativo();
    marcarSujo();
  }
  map.on('sourcedata', (e) => {
    if (e.sourceId === FONTES.imoveis && e.isSourceLoaded) agendarLeituraAgrupamento();
  });
  map.on('moveend', agendarLeituraAgrupamento);

  // ---------- rótulos do mapa base
  function visRotulo(l) {
    const chave = ROTULOS_POR_FONTE[l['source-layer']];
    if (l.type !== 'symbol' || !chave) return null;
    return cfg[chave] ? (l.metadata?.[META_VIS] || 'visible') : 'none';
  }
  function prepararEstilo(json) {
    // cópia: o MapLibre guarda a referência do JSON e nós reaproveitamos o original
    const c = structuredClone(json);
    for (const l of c.layers) {
      const v = visRotulo(l);
      if (v) l.layout = { ...(l.layout || {}), visibility: v };
      if (l.id === CAMADAS.predios) l.layout = { ...(l.layout || {}), visibility: cfg.prediosCidade && cfg.visao === '3d' ? 'visible' : 'none' };
    }
    return c;
  }
  let camadasRotulo = estiloInicial.layers.filter((l) => visRotulo(l) !== null);
  function aplicarRotulos() {
    if (!estiloPronto) return;
    for (const l of camadasRotulo) {
      if (map.getLayer(l.id)) map.setLayoutProperty(l.id, 'visibility', visRotulo(l));
    }
  }

  // ---------- sol: luz das extrusões, céu, luz dos ícones e estilo base dia/noite
  function corDaLuz(f, elevacao) {
    const dia = misturar(LUZ.solBaixo, LUZ.solAlto, clamp(elevacao / LUZ.elevacaoSolAlto, 0, 1));
    return misturar(LUZ.noite, dia, f);
  }
  function ceuPara(f) {
    const crep = 4 * f * (1 - f) * 0.85;
    const cor = (k) => misturar(misturar(CEU.noite[k], CEU.dia[k], f), CEU.crepusculo[k], crep);
    return {
      'sky-color': cor('ceu'),
      'horizon-color': cor('horizonte'),
      'fog-color': cor('nevoa'),
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.5,
    };
  }
  function aplicarSolNoMapa() {
    if (!estiloPronto) return;
    const { azimute, elevacao } = estadoSol;
    try {
      map.setLight({
        anchor: 'map',
        position: [1.15, azimute, 90 - clamp(elevacao, 0, 90)],
        color: corDaLuz(fDia, elevacao),
        intensity: lerp(LUZ.intensidadeMapa[0], LUZ.intensidadeMapa[1], fDia),
      });
      map.setSky(ceuPara(fDia));
    } catch (err) {
      erro(`Não apliquei a luz do sol no mapa: ${err.message}`, err);
    }
  }
  function aplicarSolIcones() {
    const { azimute, elevacao } = estadoSol;
    const A = azimute * RAD;
    const e = Math.max(elevacao, 4) * RAD;
    // direção para o sol no referencial local (+x leste, +y cima, +z sul); de noite, luz de cima
    const dirSol = new THREE.Vector3(Math.sin(A) * Math.cos(e), Math.sin(e), -Math.cos(A) * Math.cos(e));
    const dirNoite = new THREE.Vector3(0.3, 1, 0.5).normalize();
    luzSol.position.copy(dirNoite.lerp(dirSol, fDia).normalize());
    luzSol.intensity = lerp(LUZ.icones.dir[0], LUZ.icones.dir[1], fDia);
    luzSol.color.set(corDaLuz(fDia, elevacao));
    luzAmb.intensity = lerp(LUZ.icones.amb[0], LUZ.icones.amb[1], fDia);
    luzAmb.color.set(misturar('#c9d4ff', '#ffffff', fDia));
    // sombra-borrão escorrega para o lado oposto ao sol (mais longe com sol baixo)
    const k = elevacao > 0 ? Math.min(2.2, 1 / Math.tan(Math.max(elevacao, 8) * RAD)) * 0.12 * fDia : 0;
    sombraDesvio.x = -Math.sin(A) * k;
    sombraDesvio.z = Math.cos(A) * k;
  }
  let solPendente = false;
  function aplicarSol() {
    solPendente = false;
    aplicarSolIcones();
    aplicarSolNoMapa();
    garantirEstilo();
    marcarSujo();
  }
  async function garantirEstilo() {
    const alvo = modoPendente || modoEstilo;
    let desejado = alvo;
    if (alvo === 'noite' && fDia > LIMIAR_ESTILO.paraDia) desejado = 'dia';
    else if (alvo === 'dia' && fDia < LIMIAR_ESTILO.paraNoite) desejado = 'noite';
    if (desejado === alvo) return;
    modoPendente = desejado;
    try {
      const json = await obterEstilo(desejado);
      if (modoPendente !== desejado) return; // o sol voltou antes de o estilo chegar
      modoPendente = null;
      if (desejado === modoEstilo) return;
      const pronto = prepararEstilo(json);
      camadasRotulo = pronto.layers.filter((l) => visRotulo(l) !== null);
      modoEstilo = desejado;
      estiloPronto = false;
      estadoHover = null;
      // diff:false garante style.load (o diff entre liberty e fiord removeria a camada custom sem avisar)
      map.setStyle(pronto, { diff: false });
    } catch (err) {
      if (modoPendente === desejado) modoPendente = null;
      erro(`Não troquei o mapa para ${desejado === 'dia' ? 'o dia' : 'a noite'}: ${err.message}`, err);
    }
  }

  map.on('style.load', () => {
    estiloPronto = true;
    try {
      if (!map.getSource(FONTES.imoveis)) adicionarFontesECamadas();
      aplicarRotulos();
      aplicarVisibilidadeCamadas();
      aplicarSolNoMapa();
      // naoAgrupados fica: mesma fonte e mesmo zoom dão o mesmo agrupamento (evita piscar na troca dia/noite)
      recalcularVisibilidade();
      aplicarHoverNativo();
      marcarSujo();
    } catch (err) {
      erro(`Não montei as camadas dos imóveis no mapa: ${err.message}`, err);
    }
  });
  map.once('load', () => {
    avisarCamera();
    eventos.aoPronto?.();
  });
  map.on('resize', () => { medirCanvas(); sujo = true; });

  // ---------- câmera
  function avisarCamera() {
    eventos.aoMudarCamera?.({ bearing: map.getBearing(), pitch: map.getPitch(), zoom: map.getZoom() });
  }
  map.on('move', avisarCamera);
  const duracao = (ms) => (cfg.animacoes ? ms : 0);

  let tokenVisao = 0;
  function aplicarVisao(animar) {
    const token = ++tokenVisao;
    if (cfg.visao === '2d') {
      if (animar && cfg.animacoes && map.getPitch() > 0.5) {
        map.easeTo({ pitch: 0, duration: DURACAO.visao });
        map.once('moveend', () => {
          if (token === tokenVisao && cfg.visao === '2d') map.setMaxPitch(0);
        });
      } else {
        map.setMaxPitch(0); // já zera o pitch se estiver inclinado
      }
    } else {
      map.setMaxPitch(MAX_PITCH_3D);
      map.easeTo({ pitch: PITCH_3D, duration: animar ? duracao(DURACAO.visao) : 0 });
    }
  }

  // ---------- teste de toque por projeção na tela
  function testar(px, py) {
    let melhor = null;
    for (const d of ds) {
      if (!d.tela) continue;
      const { x0, y0, x1, y1, w } = d.tela;
      const dx = x1 - x0, dy = y1 - y0;
      const L = dx * dx + dy * dy || 1;
      const u = clamp(((px - x0) * dx + (py - y0) * dy) / L, 0, 1);
      const dist = Math.hypot(x0 + u * dx - px, y0 + u * dy - py);
      const raio = raioToque * (d.base > 1 ? 1.3 : 1);
      if (dist < raio && (!melhor || w < melhor.w)) melhor = { d, w };
    }
    return melhor?.d || null;
  }
  function grupoEm(ponto) {
    if (!estiloPronto || !cfg.agrupar || efetivo() === 'ocultos' || !map.getLayer(CAMADAS.grupos)) return null;
    const r = 6;
    const fs = map.queryRenderedFeatures([[ponto.x - r, ponto.y - r], [ponto.x + r, ponto.y + r]], { layers: [CAMADAS.grupos] });
    return fs[0] || null;
  }

  function definirHover(d) {
    if (d === hover) return;
    hover = d;
    aplicarHoverNativo();
    marcarSujo();
  }

  const canvas = map.getCanvas();
  map.on('mousemove', (e) => {
    if (orbita) return;
    const d = testar(e.point.x, e.point.y);
    definirHover(d);
    if (!espaco) canvas.style.cursor = d || grupoEm(e.point) ? 'pointer' : '';
    eventos.aoPassar?.(d?.it.id || null, e.originalEvent.clientX, e.originalEvent.clientY);
  });
  map.on('mouseout', () => { definirHover(null); eventos.aoPassar?.(null); });
  map.on('click', (e) => {
    const d = testar(e.point.x, e.point.y);
    if (d) { eventos.aoClicar?.(d.it.id); return; }
    const g = grupoEm(e.point);
    if (!g) return;
    const fonte = map.getSource(FONTES.imoveis);
    fonte.getClusterExpansionZoom(g.properties.cluster_id)
      .then((z) => map.easeTo({ center: g.geometry.coordinates, zoom: z, duration: duracao(DURACAO.grupo) }))
      .catch((err) => erro(`Não abri o grupo de imóveis: ${err.message}`, err));
  });

  // ---------- Espaço + arrastar = orbitar (botão esquerdo ou direito)
  const contCanvas = map.getCanvasContainer();
  let espaco = false;
  let orbita = null;
  let ponteiroNoMapa = false;
  let ignorarClique = false;
  let handlersAntes = null;
  const campoDeTexto = (el) => !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
  const mapaVisivel = () => container.isConnected !== false && container.getClientRects().length > 0;

  function entrarEspaco() {
    espaco = true;
    handlersAntes = { pan: map.dragPan.isEnabled(), rot: map.dragRotate.isEnabled() };
    map.dragPan.disable();
    map.dragRotate.disable();
    canvas.style.cursor = 'grab';
  }
  function sairEspaco() {
    if (!espaco) return;
    espaco = false;
    if (orbita) soltarOrbita();
    if (handlersAntes?.pan) map.dragPan.enable();
    if (handlersAntes?.rot) map.dragRotate.enable();
    handlersAntes = null;
    canvas.style.cursor = '';
  }
  function aoTeclaBaixo(e) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (campoDeTexto(e.target) || campoDeTexto(document.activeElement)) return;
    if (!mapaVisivel()) return;
    const foco = document.activeElement;
    const emBotao = foco && foco !== document.body && foco.closest?.('button, a, summary, [role="button"]');
    if (emBotao && !ponteiroNoMapa) return; // Espaço num botão fora do mapa continua acionando o botão
    e.preventDefault(); // não rolar a página
    if (emBotao) foco.blur();
    if (!espaco) entrarEspaco();
  }
  function aoTeclaCima(e) {
    if (e.code === 'Space' || e.key === ' ') sairEspaco();
  }
  function moverOrbita(e) {
    if (!orbita) return;
    const dx = e.clientX - orbita.x, dy = e.clientY - orbita.y;
    if (Math.abs(dx) + Math.abs(dy) > ORBITA.pxMovimento) orbita.moveu = true;
    map.jumpTo({
      bearing: orbita.bearing + dx * ORBITA.grausPorPxGiro,
      pitch: clamp(orbita.pitch - dy * ORBITA.grausPorPxInclinar, 0, map.getMaxPitch()),
    });
  }
  function soltarOrbita() {
    window.removeEventListener('mousemove', moverOrbita, true);
    window.removeEventListener('mouseup', soltarOrbita, true);
    if (orbita?.moveu) {
      ignorarClique = true; // o click que vem depois do arrasto não seleciona nada
      setTimeout(() => { ignorarClique = false; }, 0);
    }
    orbita = null;
    canvas.style.cursor = espaco ? 'grab' : '';
  }
  // captura: chega antes dos handlers do MapLibre (que escutam o mesmo container na fase de bolha)
  contCanvas.addEventListener('mousedown', (e) => {
    if (!espaco || (e.button !== 0 && e.button !== 2)) return;
    e.preventDefault();
    e.stopPropagation();
    orbita = { x: e.clientX, y: e.clientY, bearing: map.getBearing(), pitch: map.getPitch(), moveu: false };
    canvas.style.cursor = 'grabbing';
    window.addEventListener('mousemove', moverOrbita, true);
    window.addEventListener('mouseup', soltarOrbita, true);
  }, true);
  contCanvas.addEventListener('click', (e) => {
    if (ignorarClique) { ignorarClique = false; e.stopPropagation(); }
  }, true);
  contCanvas.addEventListener('contextmenu', (e) => {
    if (espaco || orbita) e.preventDefault();
  }, true);
  contCanvas.addEventListener('mouseenter', () => { ponteiroNoMapa = true; });
  contCanvas.addEventListener('mouseleave', () => { ponteiroNoMapa = false; });
  window.addEventListener('keydown', aoTeclaBaixo);
  window.addEventListener('keyup', aoTeclaCima);
  window.addEventListener('blur', sairEspaco);

  // ---------- laço só quando visível
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sairEspaco();
    else { sujo = true; agendarQuadro(); }
  });
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver((entradas) => {
      const vis = entradas[entradas.length - 1].isIntersecting;
      if (vis === mapaNaTela) return;
      mapaNaTela = vis;
      if (vis && solPendente) aplicarSol();
      if (vis) { sujo = true; agendarQuadro(); }
      else for (const d of ds) if (d.etqVisivel) { d.etq.style.display = 'none'; d.etqVisivel = false; }
    }).observe(container);
  }

  recalcularVisibilidade();

  // ---------- validação das chaves da config
  function valorValido(k, v) {
    if (!(k in PADRAO_CIDADE)) return false; // tema, medidor etc. são do shell
    const ok = VALORES[k] ? VALORES[k].includes(v) : typeof v === typeof PADRAO_CIDADE[k];
    if (!ok) {
      console.error('[cidade]', `config inválida: ${k} = ${JSON.stringify(v)}`);
      eventos.aoErro?.(`Configuração do mapa inválida: ${k} = ${JSON.stringify(v)}. Mantive o valor anterior.`);
    }
    return ok;
  }
  function pixelRatioPara(q) {
    return Math.min(globalThis.devicePixelRatio || 1, PIXEL_RATIO_MAX[q] || PIXEL_RATIO_MAX.equilibrada);
  }
  function normalizarSol(sv) {
    if (!sv) return null;
    if (!Number.isFinite(sv.azimute) || !Number.isFinite(sv.elevacao)) {
      erro(`Posição do sol inválida (azimute ${sv.azimute}, elevação ${sv.elevacao}).`);
      return null;
    }
    return { azimute: ((sv.azimute % 360) + 360) % 360, elevacao: clamp(sv.elevacao, -90, 90) };
  }
  function fatorSeguro(elevacao) {
    try { return fatorDia(elevacao); }
    catch (err) { erro(`Não calculei dia/noite: ${err.message}`, err); return 0; }
  }

  return {
    map,
    filtrar(idsVisiveis) {
      const ids = idsVisiveis instanceof Set ? idsVisiveis : new Set(idsVisiveis || []);
      for (const d of ds) d.visivel = ids.has(d.it.id);
      atualizarFontes();
      recalcularVisibilidade();
      aplicarHoverNativo();
      marcarSujo();
    },
    destacar(id) {
      definirHover(id ? porId.get(id) || null : null);
    },
    selecionar(id, { voar = true, padding } = {}) {
      const novo = id ? porId.get(id) || null : null;
      if (id && !novo) erro(`Imóvel ${id} não está no mapa.`);
      if (novo !== sel) {
        sel = novo;
        pintarAneis();
        atualizarFontes();
        recalcularVisibilidade();
        aplicarHoverNativo();
        marcarSujo();
      }
      if (sel && voar) {
        map.flyTo({
          center: [sel.it.lng, sel.it.lat],
          zoom: Math.max(map.getZoom(), sel.it.tipo === 'lancamento' ? ZOOM_VOO.lancamento : ZOOM_VOO.imovel),
          pitch: cfg.visao === '2d' ? 0 : PITCH_VOO,
          speed: 1.1,
          padding: padding || { top: 0, bottom: 0, left: 0, right: 0 },
          essential: true,
        });
      }
    },
    configurar(parcial) {
      const antes = { ...cfg };
      for (const [k, v] of Object.entries(parcial || {})) if (valorValido(k, v)) cfg[k] = v;
      const mudou = (...ks) => ks.some((k) => antes[k] !== cfg[k]);
      try {
        if (mudou('visao')) aplicarVisao(true);
        if (mudou('agrupar') && estiloPronto) {
          map.getSource(FONTES.imoveis)?.setClusterOptions({
            cluster: cfg.agrupar, clusterRadius: AGRUPAMENTO.raio, clusterMaxZoom: AGRUPAMENTO.zoomMax,
          });
          naoAgrupados = null;
        }
        if (mudou('nomesRuas', 'nomesBairros', 'pontosInteresse')) aplicarRotulos();
        if (mudou('qualidade')) map.setPixelRatio(pixelRatioPara(cfg.qualidade));
        if (mudou('icones', 'visao', 'agrupar', 'prediosCidade')) aplicarVisibilidadeCamadas();
        recalcularVisibilidade();
        aplicarHoverNativo();
        marcarSujo();
      } catch (err) {
        erro(`Não apliquei a configuração do mapa: ${err.message}`, err);
      }
    },
    sol(novo) {
      const sv = normalizarSol(novo);
      if (!sv) return;
      estadoSol = sv;
      fDia = fatorSeguro(sv.elevacao);
      // Mapa escondido (vista Prédio): o play do sol não pode redesenhar nem trocar o estilo de um mapa
      // que ninguém vê; aplica uma vez quando ele voltar à tela.
      if (!mapaNaTela) { solPendente = true; return; }
      aplicarSol();
    },
    girar(delta) {
      map.easeTo({ bearing: map.getBearing() + delta, duration: duracao(DURACAO.passo) });
    },
    inclinar(delta) {
      map.easeTo({ pitch: clamp(map.getPitch() + delta, 0, map.getMaxPitch()), duration: duracao(DURACAO.passo) });
    },
    norte() {
      map.easeTo({ bearing: 0, duration: duracao(DURACAO.passo) });
    },
    enquadrarTudo(padding = 0) {
      const vis = ds.filter((d) => d.visivel);
      if (!vis.length) return false;
      if (vis.length === 1) {
        map.flyTo({ center: [vis[0].it.lng, vis[0].it.lat], zoom: ZOOM_VOO.imovel, essential: true });
        return true;
      }
      const b = new maplibregl.LngLatBounds();
      for (const d of vis) b.extend([d.it.lng, d.it.lat]);
      // o MapLibre soma o padding atual do mapa (deixado pelos voos) ao padding pedido: desconta
      const p = typeof padding === 'number' ? { top: padding, bottom: padding, left: padding, right: padding } : { top: 0, bottom: 0, left: 0, right: 0, ...padding };
      const atual = map.getPadding();
      const opcoes = (margem) => {
        const pad = {};
        for (const k of ['top', 'bottom', 'left', 'right']) pad[k] = (p[k] || 0) + margem - (atual[k] || 0);
        return { padding: pad, maxZoom: ZOOM_MAX_ENQUADRAR, bearing: map.getBearing() };
      };
      // tela pequena com folha aberta pode não caber: tenta sem a margem extra antes de desistir
      const o = [opcoes(MARGEM_ENQUADRAR), opcoes(0)].find((x) => map.cameraForBounds(b, x));
      if (!o) {
        erro('Não coube enquadrar todos os imóveis com os painéis abertos. Feche um painel e tente de novo.');
        return false;
      }
      map.fitBounds(b, { ...o, pitch: map.getPitch(), duration: duracao(900), essential: true });
      return true;
    },
    redimensionar() {
      map.resize();
      medirCanvas();
      marcarSujo();
    },
    diagnostico() {
      return {
        drawCalls,
        instancias: n3d,
        quadros,
        modoRender: lacoAtivo() ? 'continuo' : 'sob-demanda',
        icones: efetivo(),
        estilo: modoEstilo,
        malhas: todasMalhas.length,
      };
    },
  };
}
