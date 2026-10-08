/* Service worker do Atlas MOC.
 *
 * Estratégias:
 * - Arquivos do próprio site (GET): rede primeiro. A rede sempre ganha quando responde; o cache só
 *   entra quando a rede falha ou, para o que não é código, quando demora mais que TEMPO_REDE_MS.
 *   Código (navegação, scripts e CSS do site) espera a rede: misturar index.html, módulos ou
 *   folha de estilo de versões diferentes quebra o app, então cópia antiga de código só aparece sem conexão.
 * - CDNs com versão fixa na URL (unpkg, jsdelivr, fonts.gstatic): cache primeiro.
 * - CSS do Google Fonts e tiles.openfreemap.org: stale-while-revalidate com teto de entradas.
 * - Navegação sem rede cai no index.html guardado.
 * - Fotos dos anúncios reais (OLX, imobiliárias, construtoras) não passam pelo SW e não são guardadas:
 *   são de terceiros, sem teto natural, e o crédito/remoção é da fonte. dados/real/imoveis.json é do
 *   próprio site (rede primeiro, guardado no primeiro uso); fica fora do precache porque pode não existir.
 * O que ficou fora do precache (404, erro de rede) é registrado e respondido por mensagem:
 *   postMessage({ tipo: 'estado-sw' }) → { tipo: 'estado-sw', versao, instaladoEm, precache: { total, ok, faltando: [{ url, motivo }] } }
 */

const VERSAO = '3.0.0';
const PREFIXO = 'atlas-moc-';
const CACHE_APP = `${PREFIXO}app-${VERSAO}`;
const CACHE_CDN = `${PREFIXO}cdn-v1`;          // conteúdo imutável (versão na URL): sobrevive a versões do app
const CACHE_MAPA = `${PREFIXO}mapa-v1`;        // estilos, tiles, glifos e sprites do OpenFreeMap
const CACHE_FONTES = `${PREFIXO}fontes-css-v1`;
const CACHES_ATUAIS = [CACHE_APP, CACHE_CDN, CACHE_MAPA, CACHE_FONTES];

const TEMPO_REDE_MS = 3000;
const MAX_ENTRADAS_MAPA = 1500;
const MAX_ENTRADAS_FONTES = 30;
const APARAR_A_CADA = 50;                      // aparar a cada N gravações: keys() de 1500 itens não é de graça
const INTERVALO_LOG_MAPA_MS = 5000;            // sem rede, cada tile falharia; resume os erros em um log

const ESCOPO = self.registration ? self.registration.scope : self.location.href;
const absoluta = (caminho) => new URL(caminho, ESCOPO).href;
const URL_ESTADO = absoluta('__atlas-sw-estado.json');
const URL_INDEX = absoluta('index.html');
const URL_RAIZ = absoluta('./');

// App shell. Módulos que ainda não existirem no servidor (404) ficam de fora sem quebrar a
// instalação; o cache de rede primeiro os guarda no primeiro uso online.
const PRECACHE_APP = [
  './',
  'index.html',
  'css/app.css',
  'js/main.js',
  'js/config.js',
  'js/cidade.js',
  'js/icones3d.js',
  'js/icones-ui.js',
  'js/sol.js',
  'js/fluxo.js',
  'js/predio.js',
  'js/layout-predio.js',
  // Módulos de interface do shell. tests/pwa.test.mjs confere esta lista contra o disco:
  // todo .js do app precisa estar aqui (senão o primeiro uso offline quebra).
  'js/ui/util.js',
  'js/ui/fichas.js',
  'js/ui/folha.js',
  'js/ui/bussola.js',
  'js/ui/config-painel.js',
  'js/ui/sol-painel.js',
  'js/ui/insolacao.js',
  'js/ui/selecao.js',
  'js/ui/teclado.js',
  'js/ui/medidor.js',
  'js/ui/pwa.js',
  'js/ui/modo-dados.js',
  'js/ui/real.js',
  'dados/imoveis.json',
  'dados/lancamentos.json',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

// Bibliotecas com versão fixa (mesmas URLs do index.html e do importmap). Na primeira visita a
// página baixa tudo antes do SW existir; sem este precache o primeiro uso offline ficaria sem mapa.
const THREE_JSM = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/';
const PRECACHE_CDN = [
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  ...[
    'utils/BufferGeometryUtils.js',
    'controls/OrbitControls.js',
    'postprocessing/EffectComposer.js',
    'postprocessing/Pass.js',
    'postprocessing/ShaderPass.js',
    'postprocessing/MaskPass.js',
    'postprocessing/RenderPass.js',
    'postprocessing/UnrealBloomPass.js',
    'postprocessing/OutputPass.js',
    'shaders/CopyShader.js',
    'shaders/LuminosityHighPassShader.js',
    'shaders/OutputShader.js',
  ].map((f) => THREE_JSM + f),
];

const HOSTS_CDN = new Set(['unpkg.com', 'cdn.jsdelivr.net', 'fonts.gstatic.com']);
// unpkg/jsdelivr só são imutáveis com versão exata (pacote@1.2.3); "@latest" ou sem versão vai pela rede.
const VERSAO_FIXA = /@\d+\.\d+\.\d+([-+][\w.]+)?\//;

function ehCdnImutavel(url) {
  if (!HOSTS_CDN.has(url.hostname)) return false;
  if (url.hostname === 'fonts.gstatic.com') return true;
  return VERSAO_FIXA.test(url.pathname);
}

function ehCodigo(req) {
  if (req.mode === 'navigate') return true;
  if (req.destination === 'script' || req.destination === 'worker' || req.destination === 'sharedworker' || req.destination === 'style') return true;
  return /\.(m?js|css)$/i.test(new URL(req.url).pathname);
}

const cacheavel = (resp) => resp && resp.ok && resp.status !== 206 && (resp.type === 'basic' || resp.type === 'cors' || resp.type === 'default');

// ---------- instalação ----------

async function precachear(nomeCache, urls, opcoesFetch) {
  const cache = await caches.open(nomeCache);
  const resultados = await Promise.allSettled(urls.map(async (u) => {
    const url = u.startsWith('http') ? u : absoluta(u);
    let resp;
    try {
      resp = await fetch(new Request(url, opcoesFetch));
    } catch (err) {
      throw new Error(`rede: ${err && err.message ? err.message : err}`);
    }
    if (!cacheavel(resp)) throw new Error(`HTTP ${resp.status}${resp.type === 'opaque' ? ' (opaca)' : ''}`);
    await cache.put(url, resp);
    return url;
  }));
  const ok = [];
  const faltando = [];
  resultados.forEach((r, i) => {
    const url = urls[i].startsWith('http') ? urls[i] : absoluta(urls[i]);
    if (r.status === 'fulfilled') ok.push(url);
    else faltando.push({ url, motivo: r.reason && r.reason.message ? r.reason.message : String(r.reason) });
  });
  return { ok, faltando };
}

async function gravarEstado(estado) {
  const cache = await caches.open(CACHE_APP);
  await cache.put(URL_ESTADO, new Response(JSON.stringify(estado), { headers: { 'Content-Type': 'application/json' } }));
}

async function lerEstado() {
  const cache = await caches.open(CACHE_APP);
  const resp = await cache.match(URL_ESTADO);
  if (!resp) return { versao: VERSAO, instaladoEm: null, precache: null, erro: 'estado do precache não encontrado no cache' };
  return resp.json();
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // cache: 'reload' fura o cache HTTP do navegador: o precache nunca guarda arquivo velho.
    const app = await precachear(CACHE_APP, PRECACHE_APP, { cache: 'reload' });
    const cdn = await precachear(CACHE_CDN, PRECACHE_CDN, { mode: 'cors', credentials: 'omit' });
    const faltando = [...app.faltando, ...cdn.faltando];
    if (faltando.length) {
      console.error('[sw]', new Error(`precache incompleto: ${faltando.length} de ${PRECACHE_APP.length + PRECACHE_CDN.length} itens ficaram de fora`), faltando);
    }
    const estado = {
      versao: VERSAO,
      instaladoEm: new Date().toISOString(),
      precache: { total: PRECACHE_APP.length + PRECACHE_CDN.length, ok: app.ok.length + cdn.ok.length, faltando },
    };
    await gravarEstado(estado);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const nomes = await caches.keys();
    const velhos = nomes.filter((n) => n.startsWith(PREFIXO) && !CACHES_ATUAIS.includes(n));
    await Promise.all(velhos.map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const dados = event.data || {};
  if (dados.tipo !== 'estado-sw') return;
  const destino = (event.ports && event.ports[0]) || event.source;
  const responder = (msg) => {
    if (destino && typeof destino.postMessage === 'function') destino.postMessage(msg);
    else console.error('[sw]', new Error('mensagem estado-sw sem remetente para responder'));
  };
  event.waitUntil(lerEstado()
    .then((estado) => responder({ tipo: 'estado-sw', ...estado }))
    .catch((err) => {
      console.error('[sw]', err);
      responder({ tipo: 'estado-sw', versao: VERSAO, erro: `falha ao ler o estado do service worker: ${err && err.message ? err.message : err}` });
    }));
});

// ---------- estratégias ----------

const ESGOTADO = Symbol('tempo esgotado');

async function copiaLocal(req) {
  const cache = await caches.open(CACHE_APP);
  const achada = await cache.match(req.url, { ignoreVary: true });
  if (achada || req.mode !== 'navigate') return achada;
  // Navegação offline para qualquer rota do app: o roteamento é por hash, o index resolve.
  return (await cache.match(URL_INDEX)) || (await cache.match(URL_RAIZ));
}

function redePrimeiro(event) {
  const req = event.request;
  const navegacao = req.mode === 'navigate';
  // no-cache revalida com o servidor (304 é barato) em vez de confiar no cache HTTP heurístico.
  const busca = navegacao
    ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    : fetch(req, { cache: 'no-cache' });
  let gravacao = Promise.resolve();
  const rede = busca.then((resp) => {
    if (cacheavel(resp) && !resp.redirected) {
      const copia = resp.clone();
      gravacao = caches.open(CACHE_APP)
        .then((c) => c.put(req.url, copia))
        .catch((err) => console.error('[sw]', `falha ao gravar no cache: ${req.url}`, err));
    }
    // Navegação tem redirect 'manual': devolver resposta já redirecionada vira erro de rede no
    // navegador. Devolve o redirecionamento para o navegador seguir.
    if (navegacao && resp.redirected) return Response.redirect(resp.url, 302);
    return resp;
  });
  // Mantém o SW vivo até a gravação terminar, mesmo se a resposta já saiu do cache por demora.
  // A rejeição da rede é tratada (e logada) em responder(); aqui só não pode vazar sem handler.
  event.waitUntil(rede.then(() => gravacao, () => undefined));

  const responder = async () => {
    let relogio;
    try {
      if (!ehCodigo(req)) {
        const limite = new Promise((res) => { relogio = setTimeout(() => res(ESGOTADO), TEMPO_REDE_MS); });
        const primeira = await Promise.race([rede, limite]);
        if (primeira !== ESGOTADO) return primeira;
        const copia = await copiaLocal(req);
        if (copia) {
          console.warn('[sw]', `rede demorou mais de ${TEMPO_REDE_MS} ms, servindo cópia local: ${req.url}`);
          return copia;
        }
      }
      return await rede;
    } catch (err) {
      const copia = await copiaLocal(req);
      if (copia) {
        console.warn('[sw]', `sem rede, servindo cópia local: ${req.url}`, err);
        return copia;
      }
      console.error('[sw]', `sem rede e sem cópia local: ${req.url}`, err);
      if (navegacao) {
        return new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
          + '<title>Atlas MOC · sem conexão</title><body style="font-family:system-ui,sans-serif;background:#070d1f;color:#e8ecf6;padding:24px">'
          + '<h1 style="font-size:20px">Sem conexão</h1><p>O Atlas MOC ainda não foi guardado neste aparelho. Conecte-se à internet e abra de novo.</p></body>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      }
      return Response.error();
    } finally {
      clearTimeout(relogio);
    }
  };
  event.respondWith(responder());
}

async function buscarCdn(req) {
  // Pede em CORS mesmo quando a página pediu no-cors (script/link sem crossorigin): esses CDNs
  // mandam Access-Control-Allow-Origin: *, e assim o status é real em vez de resposta opaca.
  try {
    return await fetch(new Request(req.url, { mode: 'cors', credentials: 'omit' }));
  } catch (errCors) {
    if (req.mode === 'cors') throw errCors;
    return fetch(req);
  }
}

async function cachePrimeiro(req) {
  const cache = await caches.open(CACHE_CDN);
  const achada = await cache.match(req.url, { ignoreVary: true });
  if (achada) return achada;
  try {
    const resp = await buscarCdn(req);
    if (cacheavel(resp)) {
      await cache.put(req.url, resp.clone()).catch((err) => console.error('[sw]', `falha ao gravar no cache: ${req.url}`, err));
    } else {
      console.error('[sw]', new Error(`CDN respondeu ${resp.status} (${resp.type}) para ${req.url}; não guardado`));
    }
    return resp;
  } catch (err) {
    console.error('[sw]', `CDN inacessível e sem cópia local: ${req.url}`, err);
    return Response.error();
  }
}

const gravacoesPorCache = new Map();
// Apara a cada `intervalo` gravações deixando `maximo - intervalo` entradas: assim o cache nunca
// passa do teto entre uma aparada e outra.
const intervaloAparar = (maximo) => Math.max(1, Math.min(APARAR_A_CADA, Math.ceil(maximo / 10)));
async function aparar(nomeCache, maximo) {
  const cache = await caches.open(nomeCache);
  const chaves = await cache.keys(); // ordem de inserção: os primeiros são os mais antigos
  const excesso = chaves.length - (maximo - intervaloAparar(maximo));
  if (excesso > 0) await Promise.all(chaves.slice(0, excesso).map((k) => cache.delete(k)));
}

let falhasSemCopia = 0;
let ultimoLogFalha = 0;
function registrarFalhaSemCopia(url, err) {
  falhasSemCopia += 1;
  const agora = Date.now();
  if (agora - ultimoLogFalha < INTERVALO_LOG_MAPA_MS) return;
  console.error('[sw]', `${falhasSemCopia} requisição(ões) de mapa/fontes sem rede e sem cópia local (última: ${url})`, err);
  falhasSemCopia = 0;
  ultimoLogFalha = agora;
}

function staleWhileRevalidate(event, nomeCache, maximo) {
  const req = event.request;
  const atualizar = (async () => {
    const resp = await fetch(req);
    if (cacheavel(resp)) {
      const cache = await caches.open(nomeCache);
      await cache.put(req.url, resp.clone());
      const n = (gravacoesPorCache.get(nomeCache) || 0) + 1;
      gravacoesPorCache.set(nomeCache, n);
      if (n % intervaloAparar(maximo) === 0) await aparar(nomeCache, maximo);
    }
    return resp;
  })();
  // O handler de rejeição aqui só evita "unhandled rejection"; o erro é logado abaixo quando importa.
  event.waitUntil(atualizar.catch(() => undefined));
  event.respondWith((async () => {
    const cache = await caches.open(nomeCache);
    const achada = await cache.match(req.url, { ignoreVary: true });
    if (achada) {
      atualizar.catch((err) => console.warn('[sw]', `revalidação falhou, mantida a cópia local: ${req.url}`, err));
      return achada;
    }
    try {
      return await atualizar;
    } catch (err) {
      registrarFalhaSemCopia(req.url, err);
      return Response.error();
    }
  })());
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Bug conhecido do Chrome (DevTools): only-if-cached fora de same-origin lança no fetch.
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  let url;
  try { url = new URL(req.url); } catch (err) { console.error('[sw]', `URL inválida: ${req.url}`, err); return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.href === URL_ESTADO) return;

  if (url.origin === self.location.origin) { redePrimeiro(event); return; }
  if (ehCdnImutavel(url)) { event.respondWith(cachePrimeiro(req)); return; }
  if (url.hostname === 'tiles.openfreemap.org') { staleWhileRevalidate(event, CACHE_MAPA, MAX_ENTRADAS_MAPA); return; }
  if (url.hostname === 'fonts.googleapis.com') { staleWhileRevalidate(event, CACHE_FONTES, MAX_ENTRADAS_FONTES); return; }
  // Demais origens (wa.me, Google Maps, fotos dos anúncios reais): o navegador resolve sem o SW e nada
  // vai para o cache (contrato v3 §5: sem cache ilimitado de fotos de terceiros).
});
