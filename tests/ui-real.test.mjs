// Modo "Anúncios reais" sem navegador: validação do JSON, fichas e cards renderizados com a fixture
// (tests/fixtures/real-exemplo.json, 6 anúncios claramente fictícios), escape de texto de terceiros,
// escolha do modo pela URL e service worker sem cache de fotos de terceiros.
// Se dados/real/imoveis.json já existir, renderiza todos os anúncios dele também.
// Uso: node tests/ui-real.test.mjs   (sai com código 1 se algo falhar)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const ler = (p) => readFileSync(path.join(raiz, p), 'utf8');
let falhas = 0, total = 0;
const ok = (c, m) => { total++; if (!c) { falhas++; console.log('  FALHA', m); } };
const secao = (t) => console.log(`\n# ${t}`);

// util.js lê matchMedia ao carregar; linkAbsoluto usa location
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.location ??= { origin: 'http://127.0.0.1:8792', pathname: '/', search: '?dados=real' };
globalThis.navigator ??= {};
const imp = (p) => import(pathToFileURL(path.join(raiz, p)).href);
const R = await imp('js/ui/real.js');
const M = await imp('js/ui/modo-dados.js');

const semSvg = (h) => h.replace(/<svg[\s\S]*?<\/svg>/g, '');
const semTags = (h) => semSvg(h).replace(/<[^>]+>/g, ' ');
// o que nunca pode aparecer: valor ausente vazando, R$ 0, travessão
const RUIM = /\bnull\b|undefined|NaN|\[object Object\]|—|R\$[\s ]*0(?![\d.,])/;
function conferirSemVazamento(rotulo, html) {
  const m = semTags(html).match(RUIM) || semSvg(html).match(/="(?:null|undefined)"/);
  ok(!m, `${rotulo}: vazou "${m?.[0]}"`);
}

// ------------------------------------------------------------------ 1. validação
secao('normalizarReal: fixture válida, arquivos e itens inválidos');
const fixture = JSON.parse(ler('tests/fixtures/real-exemplo.json'));
const N = R.normalizarReal(fixture);
ok(N.itens.length === 6 && N.descartados.length === 0, `fixture: ${N.itens.length} itens, ${N.descartados.length} descartados`);
ok(N.meta.aviso.startsWith('EXEMPLO FICTÍCIO'), 'meta.aviso preservado');
const porId = Object.fromEntries(N.itens.map((r) => [r.id, r]));
ok(porId['R-9003'].tipo === 'lancamento' && porId['R-9003'].finalidade === 'lancamento', 'lançamento vira tipo/finalidade lancamento');

for (const [desc, json, trecho] of [
  ['sem lista', { meta: {} }, 'falta a lista "imoveis"'],
  ['nulo', null, 'falta a lista'],
  ['vazio', { imoveis: [] }, 'não tem nenhum anúncio'],
  ['só inválidos', { imoveis: [{ id: 'x y', finalidade: 'venda', tipo: 'casa', lat: -16.73, lng: -43.87, bairro: 'Centro' }] }, 'nenhum dos 1 anúncios'],
]) {
  let msg = '';
  try { R.normalizarReal(json); } catch (err) { msg = err.message; }
  ok(msg.includes(trecho), `arquivo ${desc} recusado com motivo específico: "${msg}"`);
}
const base = { finalidade: 'venda', tipo: 'casa', lat: -16.73, lng: -43.87, bairro: 'Centro', preco: 1 };
const misto = R.normalizarReal({ imoveis: [
  { ...base, id: 'R-1' },
  { ...base, id: 'R-1' },
  { ...base, id: 'R-2', lat: -19.9 },
  { ...base, id: 'R-3', tipo: 'castelo' },
  { ...base, id: 'R-4', finalidade: 'permuta' },
  { ...base, id: 'R-5', lng: null },
  { ...base, id: 'L:serra-azul' },
  { ...base, id: 'R-6', bairro: '  ' },
  'texto solto',
] });
ok(misto.itens.length === 1 && misto.descartados.length === 8, `item inválido é descartado, não derruba o resto: ${misto.itens.length} ok, ${misto.descartados.length} descartados`);
console.log(`  motivos: ${misto.descartados.map((d) => `${d.id}: ${d.motivo}`).join(' | ')}`);
for (const t of ['id repetido', 'fora de Montes Claros', 'tipo desconhecido', 'finalidade desconhecida', 'sem coordenadas', 'id inválido', 'sem bairro', 'não é um objeto']) {
  ok(misto.descartados.some((d) => d.motivo.includes(t)), `motivo "${t}" registrado`);
}
ok(R.urlSegura('javascript:alert(1)') === null && R.urlSegura('data:image/png;base64,AA') === null && R.urlSegura('nao-e-url') === null && R.urlSegura(null) === null, 'urlSegura recusa javascript:, data:, texto e null');
ok(R.urlSegura(' https://exemplo.invalid/a b.jpg ') === 'https://exemplo.invalid/a%20b.jpg', 'urlSegura aceita https e normaliza');

// ------------------------------------------------------------------ 2. fichas e cards da fixture
secao('Fichas, cards e textos da fixture: nada de null/undefined/R$ 0, tudo escapado');
const fichas = {};
for (const r of N.itens) {
  const h = R.htmlImovelReal(r, { naSelecao: false, share: true });
  fichas[r.id] = h;
  conferirSemVazamento(`ficha ${r.id}`, h);
  conferirSemVazamento(`card ${r.id}`, R.htmlThumbReal(r) + R.metaCardReal(r) + R.rotuloPrecoReal(r));
  conferirSemVazamento(`texto ${r.id}`, R.textoImovelReal(r));
  ok(!/javascript:/i.test(h + R.htmlThumbReal(r) + R.textoImovelReal(r)), `${r.id}: nenhum link javascript:`);
  ok(!/<[^>]*\son\w+=/i.test(semSvg(h)), `${r.id}: nenhum atributo on* injetado`);
  for (const img of semSvg(h + R.htmlThumbReal(r)).match(/<img[^>]*>/g) || []) {
    ok(/loading="lazy"/.test(img) && /decoding="async"/.test(img) && /referrerpolicy="no-referrer"/.test(img) && /data-foto/.test(img), `${r.id}: <img> com lazy, async, no-referrer e data-foto: ${img.slice(0, 80)}`);
  }
  for (const a of h.match(/<a [^>]*target="_blank"[^>]*>/g) || []) ok(/rel="noopener/.test(a), `${r.id}: link externo com rel=noopener`);
  ok(h.includes('Onde está anunciado'), `${r.id}: bloco Onde está anunciado`);
  ok(h.includes(`data-coracao="${r.id}"`), `${r.id}: coração da seleção`);
  ok(!h.includes('#/predio/'), `${r.id}: sem botão de espelho 3D`);
}
const t9006 = fichas['R-9006'];
ok(t9006.includes('&lt;img src=x onerror=alert(1)&gt;') && !t9006.includes('<img src=x'), 'R-9006: título com HTML vira texto escapado');
ok(t9006.includes('Sala &quot;comercial&quot;'), 'R-9006: aspas escapadas');

const a = fichas['R-9001'];
ok(a.includes('Unidades neste prédio · 3') && (a.match(/<tr>/g) || []).length >= 3, 'R-9001: Unidades neste prédio com 3 linhas');
ok(a.includes('1/3') && a.includes('data-acao="gal-prox"') && a.includes('data-acao="gal-ant"'), 'R-9001: galeria com setas e contador 1/3');
ok(a.includes('Foto: Imobiliária Fictícia via Portal Exemplo'), 'R-9001: crédito "Foto: <anunciante> via <site>"');
ok((a.match(/Foto indisponível na fonte/g) || []).length === 3 && (a.match(/class="gal-falha" hidden/g) || []).length === 3, 'R-9001: placeholder "Foto indisponível na fonte" em cada foto, escondido até a foto falhar');
ok(a.includes('Também anunciado por') && a.includes('https://imobiliaria.exemplo.invalid/9001'), 'R-9001: outras_fontes com link');
ok(a.includes('A partir de') && R.rotuloPrecoReal(porId['R-9001']) === 'a partir de R$ 480 mil', `R-9001: "a partir de" no agrupado (${R.rotuloPrecoReal(porId['R-9001'])})`);
ok(/class="thumb-un"[^>]*>3</.test(R.htmlThumbReal(porId['R-9001'])) && R.metaCardReal(porId['R-9001']).includes('3 unidades'), 'R-9001: card com contador de unidades');
ok(!a.includes('Localização aproximada'), 'R-9001 (precisão rua): sem selo de localização aproximada');
ok(a.includes('sob consulta'), 'R-9001: unidade sem preço aparece como sob consulta');

const c = fichas['R-9002'];
ok(c.includes('Localização aproximada'), 'R-9002 (precisão bairro): selo Localização aproximada');
ok(c.includes('Foto: Particular via Portal Exemplo'), 'R-9002: anunciante particular só como "Particular"');
ok(c.includes('Outro Portal Exemplo · Corretora Exemplo') && !c.includes('href="javascript'), 'R-9002: outra fonte com URL javascript: aparece sem link');
ok(!/<tr><td>Condomínio/.test(c) && !/<tr><td>IPTU/.test(c), 'R-9002: condomínio e IPTU ausentes não viram linha');
ok(c.includes('terreno 360 m²'), 'R-9002: área do terreno como complemento');

const l = fichas['R-9003'];
ok(l.includes('Sob consulta') && R.rotuloPrecoReal(porId['R-9003']) === 'sob consulta', 'R-9003: lançamento sem preço = Sob consulta');
ok(l.includes('Construtora Exemplo') && l.includes('06/2028'), 'R-9003: construtora e entrega prevista');
ok(l.includes('Sem espelho de vendas 3D') && l.includes('Plantas do lançamento · 2'), 'R-9003: sem espelho 3D, com plantas');
ok(R.quartosReal(porId['R-9003']) === 3, 'R-9003: quartos do filtro vêm das plantas (3)');
ok(l.includes('href="https://construtora.exemplo.invalid/beta"'), 'R-9003: link do anúncio original');

const loc = fichas['R-9004'];
ok(loc.includes('Total mensal') && /R\$\s2\.250/.test(loc) && loc.includes('÷ 12'), 'R-9004: custo mensal da locação = 1.800 + 350 + 1.200/12');
ok(R.rotuloPrecoReal(porId['R-9004']).replace(/ /g, ' ') === 'R$ 1.800/mês', `R-9004: rótulo ${R.rotuloPrecoReal(porId['R-9004'])}`);
ok(loc.includes('4º'), 'R-9004: andar');

const ter = fichas['R-9005'];
ok(!ter.includes('<small>Quartos</small>') && !ter.includes('<small>Banheiros</small>') && ter.includes('<small>Terreno</small>') && ter.includes('360 m²'), 'R-9005: terreno sem quartos, com área do terreno');
ok(ter.includes('Anúncio sem fotos') && !ter.includes('data-gal'), 'R-9005: sem fotos = capa com ícone, sem galeria');
ok(R.areaReal(porId['R-9005']) === 360, 'R-9005: área para ordenar = área do terreno');

ok(!t9006.includes('data-gal') && R.fotosReais(porId['R-9006']).length === 0, 'R-9006: fotos com URL inválida são descartadas');
ok(t9006.includes('Térreo') && t9006.includes('condomínio e IPTU não informados no anúncio'), 'R-9006: andar 0 = Térreo; ausências explicadas');
ok(!t9006.includes('cód.'), 'R-9006: código ausente não aparece');

const meta = R.resumoMeta(N.meta, N.itens.length);
ok(meta.selo === 'Anúncios reais · 07/10/2026', `selo: ${meta.selo}`);
ok(meta.dica.includes('Portal Exemplo, Imobiliária Fictícia') && !meta.dica.includes('Bloqueado'), 'dica do selo lista só as fontes que entraram');
ok(R.resumoMeta({}, 1).selo === 'Anúncios reais' && !RUIM.test(R.resumoMeta(null, 2).dica), 'meta ausente não vaza null');
ok(R.textoImovelReal(porId['R-9001']).includes('?dados=real#/imovel/R-9001'), 'link da ficha leva ?dados=real (o modo viaja com o link)');

// ------------------------------------------------------------------ 3. modo pela URL
secao('Modo de dados: URL, escolha salva e link com rota');
const casos = [
  [{ search: '?dados=real' }, 'real', 'url'],
  [{ search: '?dados=demo', salvo: 'real' }, 'demo', 'url'],
  [{ search: '?dados=xyz' }, 'demo', 'url'],
  [{ search: '', hash: '#/imovel/MC-1001', salvo: 'real' }, 'demo', 'link'],
  [{ search: '', hash: '#/selecao/MC-1001,L:serra-azul', salvo: 'real' }, 'demo', 'link'],
  [{ search: '', hash: '#/cidade', salvo: 'real' }, 'real', 'salvo'],
  [{ search: '', hash: '', salvo: null }, 'demo', 'padrao'],
  [{ search: '', hash: '', salvo: 'lixo' }, 'demo', 'padrao'],
];
for (const [ent, modo, origem] of casos) {
  const r = M.resolverModoDados(ent);
  ok(r.modo === modo && r.origem === origem, `${JSON.stringify(ent)} → ${r.modo}/${r.origem} (esperado ${modo}/${origem})`);
}
ok(/dados=xyz desconhecido/.test(M.resolverModoDados({ search: '?dados=xyz' }).aviso), 'parâmetro desconhecido vira aviso');
ok(M.urlDoModo('http://x/app/?a=1#/imovel/MC-1', 'real', { hash: '#/cidade' }) === 'http://x/app/?a=1&dados=real#/cidade', 'urlDoModo real');
ok(M.urlDoModo('http://x/app/?dados=real#/predio/serra-azul', 'demo') === 'http://x/app/#/predio/serra-azul', 'urlDoModo demonstração tira o parâmetro');
const ctrl = M.htmlControleModo('real', {});
ok(/data-dados="real" aria-pressed="true"/.test(ctrl) && /data-dados="demo" aria-pressed="false"/.test(ctrl), 'controle marca o modo ativo');
ok(M.htmlControleModo('demo', { motivoReal: 'HTTP 404 <x>' }).includes('não abriram: HTTP 404 &lt;x&gt;'), 'controle explica (escapado) por que os reais não abriram');
const armazem = new Map();
globalThis.localStorage = { getItem: (k) => (armazem.has(k) ? armazem.get(k) : null), setItem: (k, v) => armazem.set(k, String(v)) };
ok(M.salvarModo('real') && M.lerModoSalvo() === 'real' && armazem.get(M.CHAVE_DADOS) === 'real', `escolha salva em ${M.CHAVE_DADOS}`);
armazem.set(M.CHAVE_DADOS, 'xyz');
let erroLido = '';
const errosOrig = console.error; console.error = () => {}; // erros esperados abaixo (o módulo loga)
ok(M.lerModoSalvo({ aoErro: (m) => { erroLido = m; } }) === null && /inválida/.test(erroLido), 'valor salvo inválido: null + aviso');
globalThis.localStorage = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('cota'); } };
let e1 = '', e2 = '';
ok(M.lerModoSalvo({ aoErro: (m) => { e1 = m; } }) === null && /bloqueado/.test(e1), 'localStorage que lança na leitura: aviso com o motivo');
ok(M.salvarModo('real', { aoErro: (m) => { e2 = m; } }) === false && /cota/.test(e2), 'localStorage que lança na gravação: aviso com o motivo');
console.error = errosOrig;
delete globalThis.localStorage;

// ------------------------------------------------------------------ 4. painel de sol compacto (estático)
secao('Painel de sol: recolhido por padrão, estado persistido, linha curta');
const sp = ler('js/ui/sol-painel.js');
ok(/CHAVE_SOL_PAINEL = 'atlas-moc:sol-painel:v1'/.test(sp) && /expandir\(lerExpandido\(\), \{ salvar: false \}\)/.test(sp), 'estado recolhido/expandido lido do aparelho ao criar');
ok(/id="sol-extra" hidden/.test(sp) && /data-sol="expandir" aria-expanded="false"/.test(sp), 'começa recolhido (extra escondido, aria-expanded=false)');
ok(/`az \$\{graus\(pos\.azimute\)\} · el \$\{graus\(pos\.elevacao\)\}`/.test(sp), 'leitura curta "az 252° · el 32°"');
const css = ler('css/app.css');
ok(/\.sol-hora \{ font: 700 22px/.test(css), 'hora com 22 px');
ok(/\.pop-sol \{[^}]*width: min\(460px/.test(css), 'largura máx 460 px no desktop');
ok(/\.pop\.pop-sol \{[^}]*bottom: calc\(var\(--sol-baixo/.test(css), 'mobile: cartão compacto acima da folha de baixo');

// ------------------------------------------------------------------ 5. service worker x fotos de terceiros
secao('sw.js: foto de terceiro não passa pelo SW nem vai para o cache');
const ouvintes = {};
const abertos = [];
const ctx = vm.createContext({
  self: { registration: { scope: 'http://127.0.0.1:8792/' }, location: new URL('http://127.0.0.1:8792/sw.js'), addEventListener: (t, f) => { ouvintes[t] = f; }, skipWaiting() {}, clients: { claim() {} } },
  caches: { open: async (n) => { abertos.push(n); return { match: async () => undefined, put: async () => {}, keys: async () => [] }; } },
  fetch: async () => new Response('x'), Request, Response, Headers, URL, Promise, Symbol, Map, Set, JSON, Date, setTimeout, clearTimeout, console,
});
vm.runInContext(ler('sw.js'), ctx, { filename: 'sw.js' });
for (const url of ['https://img.olx.com.br/images/12/123.jpg', 'https://exemplo.invalid/fotos/alfa-1.jpg', 'https://cdn.imobiliaria.exemplo/foto.webp?w=800']) {
  let respondeu = false;
  ouvintes.fetch({ request: { url, method: 'GET', mode: 'no-cors', destination: 'image', cache: 'default' }, respondWith() { respondeu = true; }, waitUntil() {} });
  ok(!respondeu, `foto ${url} fica fora do SW`);
}
ok(abertos.length === 0, 'nenhum cache aberto para fotos de terceiros');
ok(/'js\/ui\/real\.js'/.test(ler('sw.js')) && /'js\/ui\/modo-dados\.js'/.test(ler('sw.js')), 'módulos do modo real no precache');

// ------------------------------------------------------------------ 6. dados reais, se já existirem
secao('dados/real/imoveis.json (se existir): todos os anúncios renderizam sem vazamento');
if (!existsSync(path.join(raiz, R.URL_REAL))) {
  console.log(`  ${R.URL_REAL} ainda não existe: pulado (a interface cai na demonstração com aviso)`);
} else {
  let real;
  try { real = R.normalizarReal(JSON.parse(ler(R.URL_REAL))); } catch (err) {
    console.error('[ui-real]', err);
    ok(false, `${R.URL_REAL} não abre na interface: ${err.message}`);
  }
  if (real) {
    ok(real.descartados.length === 0, `${real.descartados.length} anúncio(s) descartados pela interface: ${real.descartados.slice(0, 5).map((d) => `${d.id} (${d.motivo})`).join('; ')}`);
    for (const r of real.itens) {
      conferirSemVazamento(`real ${r.id}`, R.htmlImovelReal(r, { naSelecao: false, share: false }) + R.htmlThumbReal(r) + R.metaCardReal(r) + R.textoImovelReal(r));
    }
    const porTipo = {};
    for (const r of real.itens) porTipo[`${r.tipo}/${r.finalidade}`] = (porTipo[`${r.tipo}/${r.finalidade}`] || 0) + 1;
    console.log(`  ${real.itens.length} anúncios renderizados; ${JSON.stringify(porTipo)}`);
  }
}

console.log(falhas ? `\nui-real.test.mjs: ${falhas} FALHA(S) em ${total} verificações` : `\nui-real.test.mjs: TUDO OK (${total} verificações)`);
process.exit(falhas ? 1 : 0);
