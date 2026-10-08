// Canário do fluxo + integridade dos dados. Uso: node tests/run.mjs
// Sai com código 1 se qualquer verificação falhar.
import { readFileSync } from 'node:fs';
import { calcularFluxo } from '../js/fluxo.js';

const raiz = new URL('../', import.meta.url);
const ler = (p) => JSON.parse(readFileSync(new URL(p, raiz), 'utf8'));
const { imoveis, corretores } = ler('dados/imoveis.json');
const { lancamentos } = ler('dados/lancamentos.json');

let falhas = 0;
const ok = (cond, msg) => { if (!cond) { falhas++; console.log('  FALHA', msg); } };
const secao = (t) => console.log(`\n# ${t}`);

secao('Canário: âncoras fixas do fluxo (centavos)');
// Âncoras calculadas à mão: 100.000,00 em 10% + 15%/36 + 10%/3 + 65%.
const anc = calcularFluxo(10_000_000, [
  { rotulo: 'E', pct_bp: 1000, parcelas: 1 }, { rotulo: 'M', pct_bp: 1500, parcelas: 36 },
  { rotulo: 'R', pct_bp: 1000, parcelas: 3 }, { rotulo: 'F', pct_bp: 6500, parcelas: 1 },
]);
console.log(JSON.stringify(anc.map((e) => [e.totalCentavos, e.parcelaCentavos, e.primeiraCentavos])));
ok(anc[0].totalCentavos === 1_000_000, 'entrada 10% de 100 mil = 10.000,00');
ok(anc[1].totalCentavos === 1_500_000 && anc[1].parcelaCentavos === 41_666 && anc[1].primeiraCentavos === 41_690, 'mensais: 36x 416,66 com 1ª 416,90');
ok(anc[2].parcelaCentavos === 333_333 && anc[2].primeiraCentavos === 333_334, 'reforços: 3x 3.333,33 com 1ª 3.333,34');
ok(anc[3].totalCentavos === 6_500_000, 'financiamento 65% = 65.000,00');

secao('Trava adversarial: fluxo que não soma 100% tem que ser recusado');
for (const [desc, etapas] of [
  ['soma 99%', [{ rotulo: 'E', pct_bp: 9900, parcelas: 1 }]],
  ['parcelas 0', [{ rotulo: 'E', pct_bp: 10000, parcelas: 0 }]],
]) {
  let recusou = false;
  try { calcularFluxo(100_00, etapas); } catch { recusou = true; }
  ok(recusou, `fluxo inválido aceito (${desc})`);
  console.log(`  ${desc}: ${recusou ? 'recusado (ok)' : 'ACEITO'}`);
}
let recusouValor = false;
try { calcularFluxo(123.45, [{ rotulo: 'E', pct_bp: 10000, parcelas: 1 }]); } catch { recusouValor = true; }
ok(recusouValor, 'valor não inteiro em centavos aceito');

secao('Fechamento no centavo: soma das parcelas = valor de tabela, em toda unidade');
let unidadesTestadas = 0;
for (const l of lancamentos) {
  for (const u of l.unidades) {
    const f = calcularFluxo(u.valor_tabela_centavos, l.fluxo);
    const soma = f.reduce((s, e) => s + e.primeiraCentavos + e.parcelaCentavos * (e.parcelas - 1), 0);
    ok(soma === u.valor_tabela_centavos, `${l.id} ${u.numero}: soma ${soma} != ${u.valor_tabela_centavos}`);
    unidadesTestadas++;
  }
}
console.log(`  ${unidadesTestadas} unidades conferidas`);

secao('Integridade dos lançamentos');
const STATUS = new Set(['vendida', 'disponivel', 'reservada']);
for (const l of lancamentos) {
  const nums = new Set();
  for (const u of l.unidades) {
    ok(STATUS.has(u.status), `${l.id} ${u.numero}: status ${u.status}`);
    ok(l.tipologias[u.tipologia], `${l.id} ${u.numero}: tipologia ${u.tipologia} inexistente`);
    ok(!nums.has(u.numero), `${l.id}: número repetido ${u.numero}`);
    nums.add(u.numero);
  }
  const og = l.predio?.orientacao_graus;
  ok(typeof og === 'number' && Number.isFinite(og) && og >= 0 && og < 360, `${l.id}: predio.orientacao_graus ${og} fora de [0,360)`);
  const v = l.unidades.filter((u) => u.status === 'vendida').length;
  console.log(`  ${l.id}: ${l.unidades.length} unidades, ${v} vendidas (${((100 * v) / l.unidades.length).toFixed(1)}%), fachada ${og}°`);
}

secao('Integridade dos imóveis avulsos');
const BBOX = { latMin: -16.80, latMax: -16.64, lngMin: -43.93, lngMax: -43.78 }; // perímetro urbano aproximado
const ids = new Set();
const corr = new Set(corretores.map((c) => c.id));
for (const i of imoveis) {
  ok(!ids.has(i.id), `id repetido ${i.id}`); ids.add(i.id);
  ok(i.lat > BBOX.latMin && i.lat < BBOX.latMax && i.lng > BBOX.lngMin && i.lng < BBOX.lngMax, `${i.id} fora de Montes Claros (${i.lat}, ${i.lng})`);
  ok(corr.has(i.corretor_id), `${i.id}: corretor ${i.corretor_id} inexistente`);
  ok(i.finalidade === 'venda' ? i.preco > 0 && i.aluguel === null : i.aluguel > 0 && i.preco === null, `${i.id}: preço incoerente com finalidade`);
}
for (const l of lancamentos) {
  ok(l.lat > BBOX.latMin && l.lat < BBOX.latMax && l.lng > BBOX.lngMin && l.lng < BBOX.lngMax, `${l.id} fora de Montes Claros`);
}
console.log(`  ${imoveis.length} imóveis conferidos`);

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK');
process.exit(falhas ? 1 : 0);
