// Integração sem navegador: grafo de módulos, contrato entre shell e vistas 3D, chaves de config,
// arquivos referenciados, precache do SW, manifest e um smoke dos módulos puros com os dados reais.
// Uso: node tests/integracao.test.mjs   (sai com código 1 se algo falhar)
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const ler = (p) => readFileSync(path.join(raiz, p), 'utf8');
const existe = (p) => existsSync(path.join(raiz, p));
let falhas = 0, total = 0;
const ok = (c, m) => { total++; if (!c) { falhas++; console.log('  FALHA', m); } };
const secao = (t) => console.log(`\n# ${t}`);
const listar = (dir) => readdirSync(path.join(raiz, dir)).filter((f) => statSync(path.join(raiz, dir, f)).isFile()).map((f) => `${dir}/${f}`);
const JS = [...listar('js'), ...listar('js/ui')].filter((f) => f.endsWith('.js'));

// ------------------------------------------------------------------ 1. grafo de módulos
secao('Imports: todo módulo e todo nome importado existem');
function exportsDe(arq) {
  const s = ler(arq);
  const nomes = new Set();
  for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) nomes.add(m[1]);
  for (const m of s.matchAll(/export\s*\{([^}]*)\}/g)) for (const p of m[1].split(',')) { const n = p.trim().split(/\s+as\s+/).pop(); if (n) nomes.add(n); }
  return nomes;
}
let nNomes = 0, nMods = 0;
for (const f of JS) {
  const s = ler(f);
  for (const m of s.matchAll(/import\s*(\{[^}]*\}|\*\s+as\s+\w+|\w+)?\s*(?:from\s*)?'(\.[^']+)'|import\('(\.[^']+)'\)/g)) {
    const espec = m[2] || m[3];
    const alvo = path.posix.normalize(path.posix.join(path.posix.dirname(f), espec));
    nMods++;
    ok(existe(alvo), `${f}: módulo ${espec} (${alvo}) não existe`);
    if (!existe(alvo) || !m[1]?.startsWith('{')) continue;
    const ex = exportsDe(alvo);
    for (const n of m[1].slice(1, -1).split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      nNomes++;
      ok(ex.has(n), `${f}: '${n}' não é exportado por ${alvo}`);
    }
  }
}
console.log(`  ${nMods} imports relativos em ${JS.length} arquivos, ${nNomes} nomes conferidos`);
for (const f of JS.filter((x) => x !== 'js/predio.js')) {
  ok(!/import\s[^(]*from\s*'(?:\.\.?\/)+predio\.js'/.test(ler(f)), `${f} importa predio.js estaticamente (contrato §8: só import dinâmico)`);
}
ok(/await import\('\.\/predio\.js'\)/.test(ler('js/main.js')), 'main.js carrega predio.js por import dinâmico');
for (const f of ['js/sol.js', 'js/config.js', 'js/layout-predio.js', 'js/ui/insolacao.js', 'js/fluxo.js']) {
  ok(!/from\s*'three/.test(ler(f)), `${f} é puro (não importa three)`);
}

// ------------------------------------------------------------------ 2. contrato shell x vistas 3D
secao('Chamadas do shell x API de cidade.js e predio.js');
const cidadeSrc = ler('js/cidade.js');
const blocoCidade = cidadeSrc.slice(cidadeSrc.lastIndexOf('\n  return {\n    map,'));
const apiCidade = new Set([...blocoCidade.matchAll(/^ {4}(\w+)(?:\(|,)/gm)].map((m) => m[1]));
const predioSrc = ler('js/predio.js');
const blocoPredio = predioSrc.slice(predioSrc.indexOf('\n  const api = {'), predioSrc.indexOf('\n  return api;'));
const apiPredio = new Set([...blocoPredio.matchAll(/^ {4}(\w+)(?:\(|:)/gm)].map((m) => m[1]));
const CONTRATO_CIDADE = ['map', 'filtrar', 'destacar', 'selecionar', 'configurar', 'sol', 'girar', 'inclinar', 'norte', 'enquadrarTudo', 'redimensionar', 'diagnostico'];
const CONTRATO_PREDIO = ['carregar', 'ativar', 'modo', 'sol', 'estadoLuz', 'configurar', 'camera', 'girar', 'girarPasso', 'inclinar', 'norte', 'contorno', 'filtrar', 'destacar', 'destacarAndar', 'selecionar', 'vistaDaUnidade', 'emVista', 'enquadrar', 'diagnostico'];
for (const k of CONTRATO_CIDADE) ok(apiCidade.has(k), `cidade.js não expõe ${k} (contrato §5)`);
for (const k of CONTRATO_PREDIO) ok(apiPredio.has(k), `predio.js não expõe ${k} (contrato §6)`);
const main = ler('js/main.js');
const usadosCidade = new Set([...main.matchAll(/S\.cidade\.(\w+)/g)].map((m) => m[1]));
const usadosPredio = new Set([...main.matchAll(/S\.predio\.(\w+)/g)].map((m) => m[1]));
for (const k of usadosCidade) ok(apiCidade.has(k), `main.js chama S.cidade.${k}, que cidade.js não expõe`);
for (const k of usadosPredio) ok(apiPredio.has(k), `main.js chama S.predio.${k}, que predio.js não expõe`);
console.log(`  cidade: ${usadosCidade.size} métodos usados pelo shell (${[...usadosCidade].join(', ')})`);
console.log(`  prédio: ${usadosPredio.size} métodos usados pelo shell (${[...usadosPredio].join(', ')})`);
ok(/\bmap\.zoomIn\(\)/.test(main) && /\bmap\.zoomOut\(\)/.test(main), 'bússola usa map.zoomIn/zoomOut (MapLibre 4.7.1)');

secao('Eventos: disparados pelo módulo 3D e tratados pelo shell');
for (const ev of ['aoPassar', 'aoClicar', 'aoErro', 'aoPronto', 'aoMudarCamera']) {
  ok(new RegExp(`eventos\\.${ev}\\?\\.\\(`).test(cidadeSrc), `cidade.js não dispara ${ev}`);
}
for (const ev of ['aoPassar', 'aoClicar', 'aoErro']) ok(new RegExp(`eventos\\.${ev}\\?\\.\\(`).test(predioSrc), `predio.js não dispara ${ev}`);
const blocoCriarCidade = main.slice(main.indexOf('S.cidade = await criarCidade('), main.indexOf('} catch (err) {', main.indexOf('S.cidade = await criarCidade(')));
for (const ev of ['aoPassar', 'aoClicar', 'aoErro', 'aoPronto', 'aoMudarCamera']) ok(new RegExp(`\\b${ev}\\(`).test(blocoCriarCidade), `main.js não trata ${ev} da cidade`);
const blocoCriarPredio = main.slice(main.indexOf('S.predio = criarPredio('), main.indexOf('if (S.sol.pos) S.predio.sol'));
for (const ev of ['aoPassar', 'aoClicar', 'aoErro']) ok(new RegExp(`\\b${ev}\\(`).test(blocoCriarPredio), `main.js não trata ${ev} do prédio`);

secao('Sol: cada mudança passa nas duas vistas e a legenda/grade segue estadoLuz()');
const aoMudarSol = main.slice(main.indexOf('function aoMudarSol('), main.indexOf('\n}\n', main.indexOf('function aoMudarSol(')));
const iC = aoMudarSol.indexOf('S.cidade.sol('), iP = aoMudarSol.indexOf('S.predio.sol('), iL = aoMudarSol.indexOf('estadoLuz()'), iR = aoMudarSol.indexOf('renderEspelho()');
ok(iC > 0 && iP > 0, 'aoMudarSol chama cidade.sol e predio.sol');
ok(iL > iP && iR > iL, 'estadoLuz() é lido depois de predio.sol() e decide o re-render do espelho');
ok(/S\.predio\.estadoLuz\(\)/.test(main), 'estadoLuz do shell vem de predio.estadoLuz() quando o prédio existe');
ok(/legendaPredio\(\)/.test(main) && /S\.luzPredio === 'noite'/.test(main), 'legenda e grade usam S.luzPredio (vindo de estadoLuz)');

// ------------------------------------------------------------------ 3. config
secao('Chaves de configuração: config.js x cidade.js x predio.js');
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const C = await import(pathToFileURL(path.join(raiz, 'js/config.js')).href);
const padraoCidade = cidadeSrc.match(/const PADRAO_CIDADE = \{([\s\S]*?)\};/)[1];
const chavesCidade = [...padraoCidade.matchAll(/(\w+):/g)].map((m) => m[1]).sort();
const chavesShell = Object.keys(C.PADRAO).filter((k) => !['tema', 'medidor'].includes(k)).sort();
ok(JSON.stringify(chavesCidade) === JSON.stringify(chavesShell), `chaves do mapa divergem: cidade ${chavesCidade} x config ${chavesShell}`);
const valoresCidade = eval(`(${cidadeSrc.match(/const VALORES = (\{[^;]*\});/)[1]})`);
for (const k of ['icones', 'visao']) ok(JSON.stringify(valoresCidade[k]) === JSON.stringify(C.OPCOES[k]), `opções de ${k} divergem: ${valoresCidade[k]} x ${C.OPCOES[k]}`);
const qualidadesShell = C.OPCOES.qualidade.filter((q) => q !== 'auto');
ok(JSON.stringify(valoresCidade.qualidade) === JSON.stringify(qualidadesShell), 'qualidades da cidade = config sem auto');
const qualidadesPredio = [...predioSrc.match(/export const QUALIDADE = \{([\s\S]*?)\n\};/)[1].matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
ok(JSON.stringify(qualidadesPredio) === JSON.stringify(qualidadesShell), `qualidades do prédio divergem: ${qualidadesPredio}`);
for (const amb of [{ mobile: true, memoria: 8, nucleos: 8 }, { mobile: false, memoria: 1, nucleos: 8 }, { mobile: false, memoria: 16, nucleos: 16 }]) {
  const r = C.configResolvida({ ...C.PADRAO }, amb);
  ok(r.qualidade !== 'auto' && qualidadesShell.includes(r.qualidade), `configResolvida(${JSON.stringify(amb)}) → ${r.qualidade}`);
}
ok(/configResolvida\(S\.cfg\)/.test(blocoCriarCidade) && /configResolvida\(S\.cfg\)/.test(blocoCriarPredio), 'as duas vistas recebem a config já resolvida');
ok(/resolverQualidade\(parcial\.qualidade\)/.test(main), 'mudança de qualidade chega resolvida em configurar()');

// ------------------------------------------------------------------ 4. ícones
secao('Ícones: ICONES tem exatamente as chaves do contrato e o shell só usa nomes existentes');
const { ICONES, icone } = await import(pathToFileURL(path.join(raiz, 'js/icones-ui.js')).href);
const contrato = ler('docs/CONTRATO-V2.md');
const doContrato = [...contrato.matchAll(/`([a-z0-9]+)`→[a-z0-9-]+/g)].map((m) => m[1]);
ok(doContrato.length === 69 && doContrato.every((n) => Object.hasOwn(ICONES, n)) && Object.keys(ICONES).length === doContrato.length, `ICONES (${Object.keys(ICONES).length}) x contrato (${doContrato.length})`);
const usados = new Set();
const ehComentario = (l) => /^\s*(\/\/|\/?\*)/.test(l);
for (const f of ['index.html', ...JS]) {
  const s = ler(f).split('\n').filter((l) => !ehComentario(l)).join('\n').replace(/\s\/\/ .*$/gm, '');
  for (const m of s.matchAll(/data-icone="([^"]+)"/g)) usados.add(m[1]);
  for (const m of s.matchAll(/\bicone\(\s*'([^']+)'/g)) usados.add(m[1]);
  for (const m of s.matchAll(/\bicone\([^,)]*\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) { usados.add(m[1]); usados.add(m[2]); }
  for (const m of s.matchAll(/\bicone: '([^']+)'/g)) usados.add(m[1]);
}
const errosOrig = console.error; let errosIcone = 0; console.error = () => { errosIcone++; };
for (const n of usados) ok(Object.hasOwn(ICONES, n), `ícone '${n}' usado no app não existe em ICONES`);
const svg = icone('nao-existe');
console.error = errosOrig;
ok(errosIcone === 1 && svg.startsWith('<svg') && !svg.includes('<path'), 'icone() com nome inexistente loga e devolve SVG vazio');
console.log(`  ${usados.size} nomes literais usados no app`);

// ------------------------------------------------------------------ 5. index.html, manifest e SW
secao('index.html: arquivos locais referenciados existem; tags PWA presentes');
const html = ler('index.html');
const locais = [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|data:|mailto:)/.test(u));
for (const u of locais) ok(existe(u), `index.html referencia ${u}, que não existe`);
console.log(`  ${locais.length} referências locais: ${locais.join(', ')}`);
for (const [re, nome] of [[/<link rel="manifest" href="manifest\.webmanifest">/, 'manifest'], [/<meta name="theme-color" content="#070d1f">/, 'theme-color'], [/<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/, 'apple-touch-icon'], [/<meta name="apple-mobile-web-app-capable" content="yes">/, 'apple-mobile-web-app-capable']]) ok(re.test(html), `index.html sem ${nome}`);
ok(!/Fraunces|Manrope/.test(html + ler('css/app.css')), 'sem Fraunces/Manrope (tipografia v2)');
ok(/register\('sw\.js'/.test(ler('js/ui/pwa.js')) || /register\(['"`]\.?\/?sw\.js/.test(ler('js/ui/pwa.js')), 'pwa.js registra sw.js');

secao('manifest.webmanifest');
const man = JSON.parse(ler('manifest.webmanifest'));
ok(man.name === 'Atlas MOC · Imóveis 3D' && man.short_name === 'Atlas MOC' && man.display === 'standalone' && man.start_url === './' && man.scope === './', 'campos do manifest (contrato §7)');
for (const ic of man.icons) {
  ok(existe(ic.src), `ícone do manifest ${ic.src} não existe`);
  if (!existe(ic.src)) continue;
  const b = readFileSync(path.join(raiz, ic.src));
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  ok(ic.sizes === `${w}x${h}`, `${ic.src}: sizes ${ic.sizes} x PNG real ${w}x${h}`);
}

secao('sw.js: precache = arquivos reais do app');
const sw = ler('sw.js');
const precacheApp = [...sw.match(/const PRECACHE_APP = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
for (const u of precacheApp.filter((x) => x !== './')) ok(existe(u), `PRECACHE_APP lista ${u}, que não existe`);
const doApp = [...JS, ...listar('css'), ...listar('dados'), ...listar('icons'), 'index.html', 'manifest.webmanifest'];
for (const f of doApp) ok(precacheApp.includes(f), `${f} existe mas não está no PRECACHE_APP (primeiro uso offline quebraria)`);
console.log(`  ${precacheApp.length} itens no PRECACHE_APP, ${doApp.length} arquivos do app no disco`);
const threeJsm = sw.match(/const THREE_JSM = '([^']+)'/)[1];
const precacheCdn = new Set([...sw.match(/const PRECACHE_CDN = \[([\s\S]*?)\n\];/)[1].matchAll(/'([^']+)'/g)].map((m) => (m[1].startsWith('http') ? m[1] : threeJsm + m[1])));
const cdnHtml = [...html.matchAll(/"(https:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net)\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
for (const u of cdnHtml) ok(precacheCdn.has(u), `CDN do index.html fora do PRECACHE_CDN: ${u}`);
const importmap = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
for (const f of JS) for (const m of ler(f).matchAll(/from '(three\/addons\/[^']+)'/g)) {
  ok(precacheCdn.has(importmap['three/addons/'] + m[1].slice('three/addons/'.length)), `${f}: addon ${m[1]} fora do PRECACHE_CDN`);
}
ok(/const VERSAO = '\d+\.\d+\.\d+'/.test(sw), 'VERSAO do SW é constante semântica');

// ------------------------------------------------------------------ 6. smoke dos módulos puros com os dados reais
secao('Smoke: fluxo, sol, layout-predio, insolação e fichas com os dados reais');
globalThis.location ??= { origin: 'http://127.0.0.1:8792', pathname: '/' };
globalThis.navigator ??= {};
const F = await import(pathToFileURL(path.join(raiz, 'js/fluxo.js')).href);
const SOL = await import(pathToFileURL(path.join(raiz, 'js/sol.js')).href);
const LP = await import(pathToFileURL(path.join(raiz, 'js/layout-predio.js')).href);
const FI = await import(pathToFileURL(path.join(raiz, 'js/ui/fichas.js')).href);
const SP = await import(pathToFileURL(path.join(raiz, 'js/ui/sol-painel.js')).href);
const { imoveis, corretores } = JSON.parse(ler('dados/imoveis.json'));
const { lancamentos } = JSON.parse(ler('dados/lancamentos.json'));
const corretorPorId = Object.fromEntries(corretores.map((c) => [c.id, c]));

const hoje = SOL.hojeMOC(new Date('2026-10-06T23:00:00Z'));
ok(hoje.dataISO === '2026-10-06' && hoje.minutos === 20 * 60, `hojeMOC 23:00 UTC → ${hoje.dataISO} ${SOL.fmtHora(hoje.minutos)} em MOC`);
const pos20 = SOL.posicaoSolLocal(hoje.dataISO, SP.HORA_INICIAL);
ok(SOL.fatorDia(pos20.elevacao) < SOL.LIMIAR_NOITE, `estado inicial do painel (20:00) é noite: elevação ${pos20.elevacao.toFixed(1)}°`);
const pos12 = SOL.posicaoSolLocal(hoje.dataISO, 12 * 60);
ok(SOL.fatorDia(pos12.elevacao) > SOL.LIMIAR_NOITE, `meio-dia é dia: elevação ${pos12.elevacao.toFixed(1)}°`);
ok(SP.HORA_MIN === 300 && SP.HORA_MAX === 1230 && SP.PASSO_MIN === 5, 'slider 05:00 a 20:30, passo 5 min (contrato §8)');
const np = SOL.nascerPorDoSol(hoje.dataISO);
ok(np.nascer > SP.HORA_MIN - 60 && np.porDoSol < SP.HORA_MAX, `nascer ${SOL.fmtHora(np.nascer)} e pôr ${SOL.fmtHora(np.porDoSol)} dentro do slider`);

let nFichas = 0;
const ruim = (h) => /undefined|NaN|\[object Object\]|—/.test(h.replace(/<svg[\s\S]*?<\/svg>/g, ''));
for (const i of imoveis) {
  const h = FI.htmlImovel(i, { corretor: corretorPorId[i.corretor_id], naSelecao: false, share: false });
  nFichas++;
  ok(!ruim(h), `ficha do imóvel ${i.id} tem undefined/NaN/travessão`);
  ok(!ruim(FI.textoImovel(i)), `texto do imóvel ${i.id} tem undefined/NaN`);
  if (i.finalidade === 'locacao') ok(/IPTU/.test(h), `ficha da locação ${i.id} sem custo mensal/IPTU`);
}
for (const l of lancamentos) {
  const h = FI.htmlLancamento(l, { naSelecao: true, share: true });
  ok(!ruim(h) && h.includes(`#/predio/${l.id}`), `ficha do lançamento ${l.id} (botão para o espelho)`);
  const andares = new Map();
  for (const u of l.unidades) (andares.get(u.andar) || andares.set(u.andar, []).get(u.andar)).push(u);
  for (const [, us] of andares) {
    const lay = LP.layoutAndar(us.sort((a, b) => a.final - b.final), l.predio.largura_m, l.predio.profundidade_m);
    const area = lay.reduce((s, r) => s + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
    ok(Math.abs(area - l.predio.largura_m * l.predio.profundidade_m) < 1e-6, `${l.id}: layout do andar cobre a planta inteira`);
  }
  for (const u of l.unidades) {
    const hu = FI.htmlUnidade(l, u, { share: false, dataISO: '2026-06-21', minutos: 600, emVista: false });
    nFichas++;
    ok(!ruim(hu), `ficha da unidade ${l.id}/${u.numero} tem undefined/NaN/travessão`);
    ok(/Insolação/.test(hu) && /Sem considerar sombra de prédios vizinhos/.test(hu), `ficha ${l.id}/${u.numero} sem bloco Insolação`);
    ok(/data-acao="vista"/.test(hu) && /Ver vista da janela/.test(hu), `ficha ${l.id}/${u.numero} sem botão Ver vista da janela`);
  }
}
console.log(`  ${nFichas} fichas renderizadas (${imoveis.length} imóveis, ${lancamentos.reduce((s, l) => s + l.unidades.length, 0)} unidades)`);

// ------------------------------------------------------------------ 7. texto de interface sem travessão
secao('Texto de interface sem travessão (—); comentários de código à parte');
for (const f of ['index.html', 'css/app.css', ...JS, 'sw.js']) {
  ler(f).split('\n').forEach((l, i) => ehComentario(l) || ok(!l.includes('—'), `${f}:${i + 1} tem travessão: ${l.trim().slice(0, 80)}`));
}

// ------------------------------------------------------------------ 8. v3: modo real e sol compacto
secao('v3: controles do modo real no HTML e ligação no shell');
for (const id of ['modo-dados', 'modo-dados-lista', 'nota-real', 'selo-predio-demo', 'selo-dados']) ok(html.includes(`id="${id}"`), `index.html sem #${id}`);
ok(/resolverModoDados\(/.test(main) && /history\.replaceState\(/.test(main) && /location\.assign\(urlDoModo\(/.test(main), 'main.js decide o modo pela URL/escolha salva e troca recarregando');
ok(/carregarJSON\(URL_REAL\)\.then\(normalizarReal\)/.test(main) && /voltarParaDemo\(rReal\.reason\)/.test(main), 'falha dos dados reais volta à demonstração com aviso');
ok(/CHAVE_SELECAO_REAL/.test(main), 'seleção do cliente separada por modo');
ok(!/criarFolha\(\$\('#painel-sol'\)/.test(main) && /posicionarSol\(\)/.test(main), 'painel de sol não é mais folha: flutua compacto acima da folha de baixo');
ok(/location\.search/.test(ler('js/ui/util.js')), 'linkAbsoluto preserva ?dados=real');

secao('Modo real e painel de sol: tests/ui-real.test.mjs');
const { spawnSync } = await import('node:child_process');
const filho = spawnSync(process.execPath, [path.join(raiz, 'tests/ui-real.test.mjs')], { encoding: 'utf8' });
const saidaFilho = `${filho.stdout || ''}${filho.stderr || ''}`;
ok(filho.status === 0, `tests/ui-real.test.mjs saiu com ${filho.status}:\n${saidaFilho.split('\n').filter((l) => /FALHA|Error/.test(l)).slice(0, 12).join('\n')}`);
console.log(`  ${saidaFilho.trim().split('\n').pop()}`);

console.log(falhas ? `\nintegracao.test.mjs: ${falhas} FALHA(S) em ${total} verificações` : `\nintegracao.test.mjs: TUDO OK (${total} verificações)`);
process.exit(falhas ? 1 : 0);
