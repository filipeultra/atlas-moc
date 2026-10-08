// Dados do modo real (dados/real/imoveis.json, contrato v3 §3 e §4): esquema, perímetro, ids únicos,
// proveniência, regras de venda/locação, ausência de dado pessoal nos textos e nenhuma duplicata
// pela regra 1 de dedup. Também confere o log de dedup (dados/real/dedup-log.json).
// Uso: node tests/real.test.mjs   (sai com código 1 se algo falhar)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const ARQ = 'dados/real/imoveis.json';
const LOG = 'dados/real/dedup-log.json';
let falhas = 0, total = 0;
const ok = (c, m) => { total++; if (!c) { falhas++; console.log('  FALHA', m); } };
const secao = (t) => console.log(`\n# ${t}`);

const PERIMETRO = { latMin: -16.80, latMax: -16.64, lngMin: -43.93, lngMax: -43.78 };
const FINALIDADES = new Set(['venda', 'locacao', 'lancamento']);
const TIPOS = new Set(['apartamento', 'casa', 'cobertura', 'terreno', 'comercial', 'lancamento']);
const PRECISOES = new Set(['rua', 'bairro', 'empreendimento']);
const STATUS = new Set(['ok', 'bloqueado', 'parcial']);
const CAMPOS = ['id', 'finalidade', 'tipo', 'titulo', 'bairro', 'rua', 'predio', 'lat', 'lng', 'precisao_local',
  'preco', 'aluguel', 'condominio', 'iptu_anual', 'area_m2', 'area_terreno_m2', 'quartos', 'suites', 'banheiros',
  'vagas', 'andar', 'caracteristicas', 'descricao', 'fotos', 'fonte', 'outras_fontes', 'unidades', 'construtora',
  'entrega_prevista', 'coletado_em'];
const NUMERICOS = ['preco', 'aluguel', 'condominio', 'iptu_anual', 'area_m2', 'area_terreno_m2', 'quartos', 'suites', 'banheiros', 'vagas'];
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

// Dado pessoal: telefone (com separador, ou 10/11 dígitos seguidos), e-mail, WhatsApp, CRECI de pessoa física.
// Só em campos de texto: URLs de foto e códigos têm sequências de dígitos e nomes como "WhatsApp-Image" (falso positivo).
const RX_PESSOAL = [
  ['telefone', /(?:\(?\b\d{2}\)?[\s.-]?)?\b9?\d{4}[\s.-]\d{4}\b|\b\d{10,11}\b/],
  ['e-mail', /[\w.+-]+@[\w-]+\.[\w.]+/],
  ['WhatsApp', /whats\s?app|wa\.me|zap\s*\d/i],
  ['CRECI de pessoa física', /creci\s*[-:nº°.]*\s*\d+\s*-?\s*f\b/i],
];
const achaPessoal = (s) => { for (const [n, rx] of RX_PESSOAL) { const m = s.match(rx); if (m) return `${n}: "${m[0]}"`; } return null; };

function textosDoItem(r) {
  const t = [r.titulo, r.descricao, r.bairro, r.rua, r.predio, r.construtora, r.entrega_prevista, r.fonte?.anunciante,
    ...(r.caracteristicas || []), ...(r.fotos || []).map((f) => f.credito),
    ...(r.outras_fontes || []).flatMap((o) => [o.anunciante, o.site]),
    ...(r.unidades || []).flatMap((u) => [u.rotulo, u.anunciante, u.site])];
  return t.filter((s) => typeof s === 'string');
}

// ------------------------------------------------------------------ regra 1 (§4.1), igual à consolidação
const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const chave = (s) => semAcento(String(s || '')).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
const GENERICOS = new Set(['condominio', 'edificio', 'ed', 'residencial', 'residence', 'res', 'predio', 'torre', 'do', 'da', 'de', 'dos', 'das', 'o', 'a']);
const chavePredio = (s) => chave(s).filter((t) => !GENERICOS.has(t));
function mesmoPredio(a, b) {
  const ka = chavePredio(a), kb = chavePredio(b);
  if (!ka.length || !kb.length) return false;
  const [menor, maior] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  return menor.every((t) => maior.some((u) => t === u || (Math.min(t.length, u.length) >= 6 && (t.startsWith(u) || u.startsWith(t)))));
}
const mesmaRua = (a, b) => !!(a && b) && chave(a).join(' ') === chave(b).join(' ');
const valor = (r) => (r.finalidade === 'locacao' ? r.aluguel : r.preco);
const area = (r) => r.area_m2 || r.area_terreno_m2;
const areaBate = (a, b) => Math.abs(a - b) <= 2 || Math.abs(a - b) / Math.max(a, b) <= 0.03;
const fotosEmComum = (a, b) => { const s = new Set(a.fotos.map((f) => f.url)); return b.fotos.some((f) => s.has(f.url)); };

/** Mesmo imóvel pela regra 1. Contra-evidência explícita (rua ou prédio com nomes diferentes) separa. */
function regra1(a, b) {
  if (a.tipo !== b.tipo || a.finalidade !== b.finalidade) return false;
  if (chave(a.bairro).join(' ') !== chave(b.bairro).join(' ')) return false;
  if (a.predio && b.predio && !mesmoPredio(a.predio, b.predio)) return false;
  if (a.rua && b.rua && !mesmaRua(a.rua, b.rua)) return false;
  const forte = (a.predio && b.predio) || mesmaRua(a.rua, b.rua) || fotosEmComum(a, b);
  if (a.finalidade === 'lancamento') return !!(a.predio && b.predio);
  if (a.quartos && b.quartos && a.quartos !== b.quartos) return false;
  const va = valor(a), vb = valor(b);
  if (!(va && vb) || Math.abs(va - vb) / Math.max(va, vb) > 0.07) return false;
  const aa = area(a), ab = area(b);
  if (aa && ab) return areaBate(aa, ab);
  return !!forte;
}

// ------------------------------------------------------------------ 0. o próprio detector
secao('Autoteste: regex de dado pessoal e regra 1');
for (const s of ['(38) 99876-5432', '38 3221-1234', '38999876543', 'fale com fulano@exemplo.com', 'chama no WhatsApp', 'wa.me/5538', 'CRECI 12345-F']) {
  ok(achaPessoal(s), `deveria acusar dado pessoal em "${s}"`);
}
for (const s of ['R$ 1.200.000', '120 m² de área', 'coletado em 2026-10-07', 'Rua Quarenta e Seis', 'CRECI 1234-J', '3 quartos, 2 vagas', 'Ref. AP05899']) {
  ok(!achaPessoal(s), `falso positivo de dado pessoal em "${s}"`);
}
const base = { tipo: 'apartamento', finalidade: 'venda', bairro: 'Melo', rua: null, predio: null, quartos: 3, preco: 500000, aluguel: null, area_m2: 90, area_terreno_m2: null, fotos: [] };
ok(regra1(base, { ...base, preco: 520000, area_m2: 91.5 }), 'regra 1: preço +4% e área +1,5 m² = mesmo imóvel');
ok(!regra1(base, { ...base, preco: 560000 }), 'regra 1: preço +12% = outro imóvel');
ok(!regra1(base, { ...base, quartos: 2 }), 'regra 1: quartos diferentes = outro imóvel');
ok(!regra1(base, { ...base, bairro: 'Centro' }), 'regra 1: bairro diferente = outro imóvel');
ok(!regra1({ ...base, rua: 'Rua A' }, { ...base, rua: 'Rua B' }), 'regra 1: ruas com nomes diferentes = outro imóvel (contra-evidência)');
ok(regra1({ ...base, area_m2: null, predio: 'Ed. Firenze' }, { ...base, predio: 'Edifício Firenze' }), 'regra 1: área ausente, mas mesmo prédio e preço = mesmo imóvel');
ok(mesmoPredio('Edifício Kandinsk', 'Edifício Kandinsky') && mesmoPredio('Saint Germain', 'Condominio Parque Saint Germain') && !mesmoPredio('Residencial Miami', 'Residencial Malibu'), 'nomes de prédio equivalentes');

// ------------------------------------------------------------------ 1. arquivo e meta
secao(`${ARQ}: arquivo e meta`);
ok(existsSync(path.join(raiz, ARQ)), `${ARQ} existe`);
if (!existsSync(path.join(raiz, ARQ))) {
  console.log(`\nreal.test.mjs: ${falhas} FALHA(S) em ${total} verificações`);
  process.exit(1);
}
const json = JSON.parse(readFileSync(path.join(raiz, ARQ), 'utf8'));
const { meta, imoveis } = json;
ok(meta && Array.isArray(imoveis), 'tem meta e lista imoveis');
ok(meta.coletado_em === '2026-10-07', `meta.coletado_em = 2026-10-07 (${meta.coletado_em})`);
ok(meta.total === imoveis.length, `meta.total (${meta.total}) = número de imóveis (${imoveis.length})`);
ok(imoveis.length >= 90 && imoveis.length <= 110, `~100 imóveis (${imoveis.length})`);
ok(typeof meta.aviso === 'string' && /não publicar/i.test(meta.aviso), 'meta.aviso presente');
ok(Array.isArray(meta.fontes) && meta.fontes.length >= 10, `meta.fontes lista as fontes (${meta.fontes?.length})`);
for (const f of meta.fontes || []) {
  ok(typeof f.site === 'string' && f.site && /^https?:\/\//.test(f.url_busca || ''), `fonte ${f.site}: site e url_busca`);
  ok(Number.isInteger(f.anuncios_brutos) && f.anuncios_brutos >= 0, `fonte ${f.site}: anuncios_brutos inteiro`);
  ok(STATUS.has(f.status), `fonte ${f.site}: status ok|bloqueado|parcial (${f.status})`);
}
const d = meta.dedup || {};
ok(['brutos', 'duplicatas_mescladas', 'agrupados_em_predios'].every((k) => Number.isInteger(d[k]) && d[k] >= 0), 'meta.dedup com brutos, duplicatas_mescladas, agrupados_em_predios');
ok(d.brutos >= imoveis.length, `brutos (${d.brutos}) >= imóveis finais`);

// ------------------------------------------------------------------ 2. esquema de cada imóvel
secao('Esquema, perímetro, proveniência e regras de venda/locação');
const ids = new Set();
const urlsFoto = new Map();
const urlsAnuncio = new Map();
const marcaUrl = (u, id, onde) => {
  if (!u) return;
  const k = u.replace(/[?#].*$/, '').replace(/\/$/, '');
  if (urlsAnuncio.has(k) && urlsAnuncio.get(k) !== id) ok(false, `${id}: link de anúncio repetido em ${urlsAnuncio.get(k)} (${onde}: ${u})`);
  urlsAnuncio.set(k, id);
};
for (const r of imoveis) {
  const id = r.id;
  ok(/^R-\d{4}$/.test(id), `id no formato R-0001 (${id})`);
  ok(!ids.has(id), `id único (${id})`);
  ids.add(id);
  ok(CAMPOS.every((k) => k in r), `${id}: tem todos os campos do esquema (faltam: ${CAMPOS.filter((k) => !(k in r)).join(', ')})`);
  ok(Object.keys(r).every((k) => CAMPOS.includes(k)), `${id}: nenhum campo fora do esquema (${Object.keys(r).filter((k) => !CAMPOS.includes(k)).join(', ')})`);
  ok(FINALIDADES.has(r.finalidade) && TIPOS.has(r.tipo), `${id}: finalidade/tipo válidos (${r.finalidade}/${r.tipo})`);
  ok((r.finalidade === 'lancamento') === (r.tipo === 'lancamento'), `${id}: lançamento é finalidade e tipo "lancamento"`);
  if (r.finalidade === 'venda') ok(r.preco > 0 && r.aluguel === null, `${id}: venda tem preço > 0 e aluguel null`);
  if (r.finalidade === 'locacao') ok(r.aluguel > 0 && r.preco === null, `${id}: locação tem aluguel > 0 e preço null`);
  if (r.finalidade === 'lancamento') ok(r.aluguel === null && (r.preco === null || r.preco > 0), `${id}: lançamento sem aluguel, preço null ou > 0`);
  for (const k of NUMERICOS) ok(r[k] === null || (typeof r[k] === 'number' && Number.isFinite(r[k]) && r[k] > 0), `${id}: ${k} null ou número > 0 (${r[k]})`);
  ok(Number.isFinite(r.lat) && Number.isFinite(r.lng) && r.lat > PERIMETRO.latMin && r.lat < PERIMETRO.latMax && r.lng > PERIMETRO.lngMin && r.lng < PERIMETRO.lngMax,
    `${id}: dentro do perímetro de Montes Claros (${r.lat}, ${r.lng})`);
  ok(PRECISOES.has(r.precisao_local), `${id}: precisao_local rua|bairro|empreendimento (${r.precisao_local})`);
  if (r.precisao_local === 'rua') ok(!!r.rua, `${id}: precisão "rua" exige rua`);
  ok(typeof r.bairro === 'string' && r.bairro.trim().length > 1, `${id}: tem bairro`);
  ok(typeof r.titulo === 'string' && r.titulo.length > 5, `${id}: tem título`);
  ok(typeof r.descricao === 'string' && r.descricao.length >= 20 && r.descricao.length <= 500, `${id}: descrição própria de 1 a 2 frases (${r.descricao?.length} caracteres)`);
  ok(Array.isArray(r.caracteristicas) && r.caracteristicas.every((c) => typeof c === 'string'), `${id}: caracteristicas é lista de textos`);
  // endereço: no máximo rua + bairro, nunca número de casa/apto
  ok(r.rua === null || (typeof r.rua === 'string' && !/,\s*\d|\bn[º°o.]?\s*\d|\s-\s*\d|\d+\s*$/i.test(r.rua)), `${id}: rua sem número (${r.rua})`);
  // proveniência
  const f = r.fonte || {};
  ok(typeof f.site === 'string' && f.site && /^https?:\/\//.test(f.url || '') && typeof f.anunciante === 'string' && f.anunciante,
    `${id}: fonte com site, url e anunciante`);
  ok(f.publicado_em === null || f.publicado_em === undefined || DATA_ISO.test(f.publicado_em), `${id}: publicado_em ISO ou null`);
  ok(r.coletado_em === '2026-10-07', `${id}: coletado_em 2026-10-07`);
  marcaUrl(f.url, id, 'fonte');
  for (const o of r.outras_fontes || []) {
    ok(typeof o.site === 'string' && /^https?:\/\//.test(o.url || '') && typeof o.anunciante === 'string', `${id}: outras_fontes com site, url e anunciante`);
    marcaUrl(o.url, id, 'outras_fontes');
  }
  ok(r.outras_fontes === null || (Array.isArray(r.outras_fontes) && r.outras_fontes.length > 0), `${id}: outras_fontes null ou lista não vazia`);
  // fotos: só URLs http(s), 1 a 6, com crédito; a mesma foto não aparece em dois imóveis
  ok(Array.isArray(r.fotos) && r.fotos.length >= 1 && r.fotos.length <= 6, `${id}: 1 a 6 fotos (${r.fotos?.length})`);
  for (const ft of r.fotos || []) {
    ok(/^https?:\/\//.test(ft.url) && typeof ft.credito === 'string' && ft.credito, `${id}: foto com URL http(s) e crédito`);
    ok(!urlsFoto.has(ft.url) || urlsFoto.get(ft.url) === id, `${id}: foto repetida em ${urlsFoto.get(ft.url)} (${ft.url.slice(0, 70)})`);
    urlsFoto.set(ft.url, id);
  }
  // unidades: só prédio agrupado (2+ anúncios) ou tipologias de lançamento
  if (r.unidades !== null) {
    ok(Array.isArray(r.unidades) && r.unidades.length > 0, `${id}: unidades null ou lista não vazia`);
    ok(r.tipo === 'lancamento' || r.unidades.length >= 2, `${id}: unidades só em lançamento ou prédio com 2+ anúncios`);
    for (const u of r.unidades) {
      ok(typeof u.rotulo === 'string' && u.rotulo && !/\b(apto|apartamento|casa|unidade|sala)\.?\s*n?[º°]?\s*\d{2,}/i.test(u.rotulo), `${id}: rótulo de unidade sem número de apto (${u.rotulo})`);
      ok(u.url === undefined || u.url === null || /^https?:\/\//.test(u.url), `${id}: url da unidade http(s)`);
      if (u.url && u.url !== f.url && r.tipo !== 'lancamento') marcaUrl(u.url, id, 'unidade');
      for (const k of ['area_m2', 'quartos', 'preco', 'aluguel']) ok(u[k] === undefined || u[k] === null || u[k] > 0, `${id}: unidade ${k} null ou > 0`);
    }
    if (r.tipo !== 'lancamento') {
      const ps = r.unidades.map((u) => (r.finalidade === 'locacao' ? u.aluguel : u.preco)).filter((v) => v > 0);
      ok(ps.length && valor(r) === Math.min(...ps), `${id}: preço do prédio = menor preço das unidades ("a partir de")`);
    }
  }
  if (r.tipo !== 'lancamento') ok(r.construtora === null || typeof r.construtora === 'string', `${id}: construtora null ou texto`);
}

// ------------------------------------------------------------------ 3. dado pessoal e texto
secao('Nenhum dado pessoal nos campos de texto; texto sem travessão e sem "null"');
for (const r of imoveis) {
  for (const s of textosDoItem(r)) {
    const p = achaPessoal(s);
    ok(!p, `${r.id}: ${p} em "${s.slice(0, 80)}"`);
    ok(!/[—–]/.test(s), `${r.id}: travessão em "${s.slice(0, 80)}"`);
    ok(!/\b(null|undefined|NaN)\b/.test(s), `${r.id}: texto com "null/undefined" em "${s.slice(0, 80)}"`);
  }
  ok(r.fonte.anunciante === 'Particular' || !/^(sr|sra|dr|dra)\.?\s/i.test(r.fonte.anunciante), `${r.id}: anunciante não é nome de pessoa (${r.fonte.anunciante})`);
}

// ------------------------------------------------------------------ 4. dedup
secao('Nenhum par de imóveis bate na regra 1 de dedup (todos contra todos)');
let pares = 0;
for (let i = 0; i < imoveis.length; i++) {
  for (let j = i + 1; j < imoveis.length; j++) {
    pares++;
    ok(!regra1(imoveis[i], imoveis[j]), `duplicata pela regra 1: ${imoveis[i].id} (${imoveis[i].titulo}) x ${imoveis[j].id} (${imoveis[j].titulo})`);
  }
}
console.log(`  ${pares} pares comparados`);
ok(existsSync(path.join(raiz, LOG)), `${LOG} existe`);
if (existsSync(path.join(raiz, LOG))) {
  const log = JSON.parse(readFileSync(path.join(raiz, LOG), 'utf8'));
  ok(Array.isArray(log) && log.length > 0, 'log de dedup não vazio');
  for (const e of log) {
    ok(typeof e.motivo === 'string' && e.motivo.length > 10 && [1, 2, null].includes(e.regra) && Array.isArray(e.mesclados), `log: entrada com regra, mesclados e motivo (${e.base})`);
    ok(e.mantido === 'não selecionado' || ids.has(e.mantido), `log: "mantido" aponta para imóvel existente (${e.mantido})`);
  }
  const r1 = log.filter((e) => e.regra === 1).reduce((s, e) => s + e.mesclados.length, 0);
  const r2 = log.filter((e) => e.regra === 2).reduce((s, e) => s + e.mesclados.length + 1, 0);
  ok(r1 === d.duplicatas_mescladas, `meta.dedup.duplicatas_mescladas (${d.duplicatas_mescladas}) bate com o log (${r1})`);
  ok(r2 === d.agrupados_em_predios, `meta.dedup.agrupados_em_predios (${d.agrupados_em_predios}) bate com o log (${r2})`);
}

// ------------------------------------------------------------------ 5. variedade e cotas (§4)
secao('Variedade: cotas aproximadas e bairros');
const cont = {};
const porBairro = {};
for (const r of imoveis) {
  const k = ['cobertura', 'comercial', 'terreno', 'lancamento'].includes(r.tipo) ? r.tipo : `${r.tipo}/${r.finalidade}`;
  cont[k] = (cont[k] || 0) + 1;
  porBairro[r.bairro] = (porBairro[r.bairro] || 0) + 1;
}
console.log(' ', JSON.stringify(cont));
ok((cont.cobertura || 0) >= 3, `cobertura 3+ (${cont.cobertura})`);
ok((cont.lancamento || 0) >= 6, `lançamento 6+ (${cont.lancamento})`);
for (const [k, alvo] of [['apartamento/venda', 25], ['apartamento/locacao', 15], ['casa/venda', 20], ['casa/locacao', 8], ['terreno', 10], ['comercial', 10]]) {
  ok((cont[k] || 0) >= Math.floor(alvo * 0.6), `${k}: perto da cota ${alvo} (${cont[k] || 0})`);
}
const maxB = Math.max(...Object.values(porBairro));
ok(Object.keys(porBairro).length >= 25, `bairros distintos >= 25 (${Object.keys(porBairro).length})`);
ok(maxB <= 12, `nenhum bairro concentra demais (máximo ${maxB})`);
console.log(`  ${Object.keys(porBairro).length} bairros; mais frequentes: ${Object.entries(porBairro).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([b, n]) => `${b} ${n}`).join(', ')}`);

console.log(falhas ? `\nreal.test.mjs: ${falhas} FALHA(S) em ${total} verificações` : `\nreal.test.mjs: TUDO OK (${total} verificações)`);
process.exit(falhas ? 1 : 0);
