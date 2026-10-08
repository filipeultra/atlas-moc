// Harness: roda sw.js num contexto vm com caches/fetch simulados e verifica as estratégias. Uso: node tests/sw.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const ARQ = process.argv[2] || fileURLToPath(new URL('../sw.js', import.meta.url));
const ORIGEM = 'http://127.0.0.1:8792';
const ESCOPO = ORIGEM + '/';
let falhas = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FALHA') + ' ' + m); if (!c) falhas++; };

class CacheMem {
  constructor() { this.m = new Map(); }
  key(r) { return typeof r === 'string' ? r : r.url; }
  async put(r, resp) { const corpo = await resp.arrayBuffer(); const k = this.key(r); this.m.delete(k); this.m.set(k, { corpo, status: resp.status, headers: [...resp.headers] }); }
  async match(r) { const e = this.m.get(this.key(r)); return e ? new Response(e.status === 204 ? null : e.corpo.slice(0), { status: e.status, headers: e.headers }) : undefined; }
  async keys() { return [...this.m.keys()].map((u) => new Request(u)); }
  async delete(r) { return this.m.delete(this.key(r)); }
}
function novoAmbiente({ rede }) {
  const stores = new Map();
  const caches = {
    async open(n) { if (!stores.has(n)) stores.set(n, new CacheMem()); return stores.get(n); },
    async keys() { return [...stores.keys()]; },
    async delete(n) { return stores.delete(n); },
  };
  const ouvintes = {}; const chamadas = [];
  const flags = { skipWaiting: 0, claim: 0 };
  const erros = [], avisos = [];
  const fetchMock = async (entrada, init) => {
    const url = typeof entrada === 'string' ? entrada : entrada.url;
    chamadas.push({ url, init, cache: init?.cache ?? entrada.cache, mode: init?.mode ?? entrada.mode });
    return rede(url, init);
  };
  const self = {
    registration: { scope: ESCOPO },
    location: new URL(ESCOPO + 'sw.js'),
    addEventListener: (t, f) => { ouvintes[t] = f; },
    skipWaiting: async () => { flags.skipWaiting++; },
    clients: { claim: async () => { flags.claim++; } },
  };
  const ctx = vm.createContext({
    self, caches, fetch: fetchMock, Request, Response, Headers, URL, Promise, Symbol, Map, Set, JSON, Date,
    setTimeout, clearTimeout,
    console: { error: (...a) => erros.push(a), warn: (...a) => avisos.push(a), log: console.log },
  });
  vm.runInContext(fs.readFileSync(ARQ, 'utf8'), ctx, { filename: 'sw.js' });
  return { ouvintes, caches, stores, chamadas, flags, erros, avisos };
}
function evento(extra) {
  const extensoes = []; let resposta = null;
  return {
    ...extra,
    waitUntil(p) { extensoes.push(p); },
    respondWith(p) { resposta = p; },
    get resposta() { return resposta; },
    async fim() { await Promise.all(extensoes); },
  };
}
const navReq = (url) => ({ url, method: 'GET', mode: 'navigate', destination: 'document', cache: 'default' });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const texto = (s, status = 200, tipo = 'text/plain') => new Response(s, { status, headers: { 'Content-Type': tipo } });

// Servidor simulado: serve os arquivos reais do projeto, menos js/config.js (404), para provar que
// um item faltando não quebra a instalação.
const RAIZ = path.dirname(path.resolve(ARQ));
const EXISTE = new Set(['/']);
(function varrer(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    if (e.isDirectory()) varrer(`${dir}/${e.name}`, `${rel}${e.name}/`);
    else EXISTE.add(`/${rel}${e.name}`);
  }
})(RAIZ, '');
EXISTE.delete('/js/config.js');
let versaoServidor = 'v1'; let online = true; let atraso = 0;
const rede = async (url) => {
  if (atraso) await espera(atraso);
  if (!online) throw new TypeError('Failed to fetch');
  const u = new URL(url);
  if (u.origin === ORIGEM) return EXISTE.has(u.pathname) ? texto(`${u.pathname}@${versaoServidor}`) : texto('nao achado', 404);
  return texto(`cdn:${url}@${versaoServidor}`);
};

// 1. Instalação: js/config.js ausente (404) não quebra; estado registra o que ficou de fora.
const A = novoAmbiente({ rede });
let ev = evento({}); A.ouvintes.install(ev); await ev.fim();
ok(A.flags.skipWaiting === 1, 'install chama skipWaiting');
const cacheApp = [...A.stores.keys()].find((n) => n.startsWith('atlas-moc-app-'));
ok(!!cacheApp, `cache do app criado: ${cacheApp}`);
ok(await (await A.caches.open(cacheApp)).match(ESCOPO + 'js/main.js'), 'js/main.js precacheado');
ok(!(await (await A.caches.open(cacheApp)).match(ESCOPO + 'js/config.js')), 'js/config.js (404) fora do precache');
ok(A.chamadas.filter((c) => c.url.startsWith(ORIGEM)).every((c) => c.cache === 'reload'), 'precache do app usa cache: reload');
ok(A.erros.some((e) => String(e[1]).includes('precache incompleto')), 'console.error do precache incompleto');
let msg = null; ev = evento({ data: { tipo: 'estado-sw' }, source: { postMessage: (m) => { msg = m; } }, ports: [] });
A.ouvintes.message(ev); await ev.fim();
ok(msg && msg.tipo === 'estado-sw' && msg.versao && msg.precache.faltando.length === 1 && msg.precache.faltando[0].url.endsWith('js/config.js') && msg.precache.faltando[0].motivo === 'HTTP 404', 'estado-sw lista js/config.js como faltando (HTTP 404)');
console.log('     estado:', JSON.stringify({ total: msg.precache.total, ok: msg.precache.ok, faltando: msg.precache.faltando }));
const B = novoAmbiente({ rede: async (url) => { if (!url.startsWith(ORIGEM)) throw new TypeError('cdn fora'); return rede(url); } });
ev = evento({}); let instalou = true; B.ouvintes.install(ev); try { await ev.fim(); } catch { instalou = false; }
ok(instalou && B.flags.skipWaiting === 1, 'install conclui mesmo com CDN inacessível');

// 2. Activate: apaga caches antigos do app, mantém outros, chama claim.
await A.caches.open('atlas-moc-app-1.0.0'); await A.caches.open('outro-site');
ev = evento({}); A.ouvintes.activate(ev); await ev.fim();
const nomes = await A.caches.keys();
ok(!nomes.includes('atlas-moc-app-1.0.0') && nomes.includes('outro-site') && nomes.includes(cacheApp), 'activate apaga só caches antigos do atlas');
ok(A.flags.claim === 1, 'activate chama clients.claim');

// 3. Rede primeiro: com rede, JS novo do servidor, nunca o do cache.
versaoServidor = 'v2';
ev = evento({ request: new Request(ESCOPO + 'js/main.js') }); A.ouvintes.fetch(ev);
let r = await ev.resposta; await ev.fim();
ok((await r.text()) === '/js/main.js@v2', 'JS com rede: versão nova do servidor');
ok(A.chamadas.at(-1).cache === 'no-cache', 'requisição de rede usa cache: no-cache (revalida o cache HTTP)');
ok((await (await (await A.caches.open(cacheApp)).match(ESCOPO + 'js/main.js')).text()) === '/js/main.js@v2', 'cache atualizado com a versão nova');

// 4. JS lento (> 3 s) com cópia em cache: espera a rede (não serve JS velho).
versaoServidor = 'v3'; atraso = 3300;
ev = evento({ request: new Request(ESCOPO + 'js/cidade.js') }); A.ouvintes.fetch(ev);
r = await ev.resposta; await ev.fim();
ok((await r.text()) === '/js/cidade.js@v3', 'JS lento: esperou a rede e entregou v3');
// 4b. CSS do site lento: também espera a rede (CSS velho com HTML e JS novos quebra o layout).
ev = evento({ request: new Request(ESCOPO + 'css/app.css') }); A.ouvintes.fetch(ev);
r = await ev.resposta; await ev.fim();
ok((await r.text()) === '/css/app.css@v3', 'CSS lento: esperou a rede e entregou v3');
// 5. JSON lento: cai no cache após 3 s e revalida em segundo plano.
const t0 = Date.now();
ev = evento({ request: new Request(ESCOPO + 'dados/imoveis.json') }); A.ouvintes.fetch(ev);
r = await ev.resposta; const dt = Date.now() - t0;
ok((await r.text()) === '/dados/imoveis.json@v1' && dt >= 2900 && dt < 3300, `JSON lento: cópia local em ${dt} ms`);
await ev.fim(); atraso = 0;
ok((await (await (await A.caches.open(cacheApp)).match(ESCOPO + 'dados/imoveis.json')).text()) === '/dados/imoveis.json@v3', 'JSON: rede lenta terminou e atualizou o cache');

// 6. Offline: JS do cache; navegação cai no index.html; sem cópia: 503 na navegação.
online = false;
ev = evento({ request: new Request(ESCOPO + 'js/main.js') }); A.ouvintes.fetch(ev);
r = await ev.resposta; await ev.fim();
ok((await r.text()) === '/js/main.js@v2', 'offline: JS servido do cache');
ev = evento({ request: navReq(ESCOPO + 'qualquer/rota?x=1') }); A.ouvintes.fetch(ev);
r = await ev.resposta; await ev.fim();
ok((await r.text()) === '/index.html@v1', 'offline: navegação cai no index.html');
const C = novoAmbiente({ rede });
ev = evento({ request: navReq(ESCOPO) }); C.ouvintes.fetch(ev); r = await ev.resposta; await ev.fim();
ok(r.status === 503 && (await r.text()).includes('Sem conexão') && C.erros.length === 1, 'offline sem cache: página 503 + console.error');
ev = evento({ request: new Request(ESCOPO + 'js/ui/x.js') }); C.ouvintes.fetch(ev); r = await ev.resposta; await ev.fim();
ok(r.type === 'error', 'offline sem cache (JS): Response.error()');
online = true;

// 7. Navegação online: busca a URL com no-cache.
ev = evento({ request: navReq(ESCOPO) }); A.ouvintes.fetch(ev);
r = await ev.resposta; await ev.fim();
ok((await r.text()) === '/@v3' && A.chamadas.at(-1).cache === 'no-cache', 'navegação online: rede com no-cache');

// 8. Não-GET e outras origens: ignorados.
ev = evento({ request: new Request(ESCOPO + 'api', { method: 'POST', body: 'x' }) }); A.ouvintes.fetch(ev);
ok(ev.resposta === null, 'POST ignorado');
ev = evento({ request: new Request('https://wa.me/?text=oi') }); A.ouvintes.fetch(ev);
ok(ev.resposta === null, 'origem externa não listada ignorada');

// 9. CDN versionado: cache primeiro (segunda vez sem rede), pedido em CORS.
const urlCdn = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
const D = novoAmbiente({ rede });
ev = evento({ request: new Request(urlCdn, { mode: 'no-cors' }) }); D.ouvintes.fetch(ev); r = await ev.resposta;
ok(D.chamadas.at(-1).mode === 'cors', 'CDN pedido em modo cors');
const n1 = D.chamadas.length; online = false;
ev = evento({ request: new Request(urlCdn, { mode: 'no-cors' }) }); D.ouvintes.fetch(ev); r = await ev.resposta;
ok(r.status === 200 && D.chamadas.length === n1, 'CDN: segunda vez vem do cache, sem rede');
online = true;
ev = evento({ request: new Request('https://unpkg.com/lucide-static@latest/icons/map.svg') }); D.ouvintes.fetch(ev);
ok(ev.resposta === null, 'unpkg sem versão fixa (@latest) não entra no cache primeiro');
ev = evento({ request: new Request('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js') }); D.ouvintes.fetch(ev);
ok(ev.resposta !== null, 'jsdelivr three@0.160.0 entra no cache primeiro');
await ev.resposta;
const E = novoAmbiente({ rede: async () => texto('x', 404) });
ev = evento({ request: new Request('https://fonts.gstatic.com/s/inter/v1/a.woff2') }); E.ouvintes.fetch(ev); r = await ev.resposta;
ok(r.status === 404 && !(await (await E.caches.open('atlas-moc-cdn-v1')).match('https://fonts.gstatic.com/s/inter/v1/a.woff2')) && E.erros.length === 1, 'CDN 404: não guarda e loga');

// 10. Tiles: SWR (devolve cópia, revalida) e teto de 1500 entradas.
const tile = 'https://tiles.openfreemap.org/planet/20250101_001001_pt/14/6000/9000.pbf';
versaoServidor = 'a';
ev = evento({ request: new Request(tile) }); D.ouvintes.fetch(ev); r = await ev.resposta; await ev.fim();
ok((await r.text()).endsWith('@a'), 'tile: primeira vez da rede');
versaoServidor = 'b';
ev = evento({ request: new Request(tile) }); D.ouvintes.fetch(ev); r = await ev.resposta;
ok((await r.text()).endsWith('@a'), 'tile: segunda vez devolve cópia (stale)');
await ev.fim();
ok((await (await (await D.caches.open('atlas-moc-mapa-v1')).match(tile)).text()).endsWith('@b'), 'tile: revalidado em segundo plano');
for (let i = 0; i < 1600; i++) {
  ev = evento({ request: new Request(`https://tiles.openfreemap.org/planet/x/15/${i}/1.pbf`) }); D.ouvintes.fetch(ev); await ev.resposta; await ev.fim();
}
const nTiles = (await (await D.caches.open('atlas-moc-mapa-v1')).keys()).length;
ok(nTiles <= 1500 && nTiles > 1400, `tiles aparados: ${nTiles} entradas (teto 1500)`);
ok(!(await (await D.caches.open('atlas-moc-mapa-v1')).match(tile)), 'tile mais antigo foi o removido');
ev = evento({ request: new Request('https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap') }); D.ouvintes.fetch(ev);
ok(ev.resposta !== null, 'CSS do Google Fonts em stale-while-revalidate');
await ev.resposta; await ev.fim();
online = false; const nErr = D.erros.length;
for (let i = 0; i < 20; i++) { ev = evento({ request: new Request(`https://tiles.openfreemap.org/planet/x/16/${i}/1.pbf`) }); D.ouvintes.fetch(ev); r = await ev.resposta; await ev.fim(); }
ok(r.type === 'error' && D.erros.length - nErr === 1, `tiles offline: Response.error e ${D.erros.length - nErr} log resumido para 20 falhas`);
online = true;

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DO SW PASSARAM');
process.exit(falhas ? 1 : 0);
