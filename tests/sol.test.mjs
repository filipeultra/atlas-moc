// Testes do módulo do sol. Uso: node tests/sol.test.mjs   (sai com código 1 se algo falhar)
// Referência independente: tests/fixtures/sol-referencia-suncalc.json, gerado com suncalc 2.1.1
// (instalado fora do projeto). Erro máximo medido em 06/10/2026, 238 instantes em Montes Claros:
// azimute 0,046°, elevação 0,011° (limite aceito: 0,3°). Nascer/pôr/meio-dia: diferença < 0,6 min.
import { readFileSync } from 'node:fs';
import {
  MOC, LIMIAR_NOITE, posicaoSol, dataLocalParaUTC, posicaoSolLocal, nascerPorDoSol, janelaDeSol,
  fatorDia, rotuloOrientacao, fmtHora, hojeMOC,
} from '../js/sol.js';

const ERRO_MAX_GRAUS = 0.3;
const ERRO_MAX_MIN = 1; // nascer/pôr/meio-dia arredondados ao minuto

let falhas = 0;
const ok = (cond, msg) => { if (!cond) { falhas++; console.log('  FALHA', msg); } };
const secao = (t) => console.log(`\n# ${t}`);
const lanca = (fn) => { try { fn(); return false; } catch { return true; } };
const difAz = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const RAD = Math.PI / 180;
// mesma fórmula de refração do suncalc 2.x, para conferir também a altitude aparente crua
const refracao = (hGraus) => { const h = Math.max(0, hGraus * RAD); return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179)) / RAD; };

const ref = JSON.parse(readFileSync(new URL('./fixtures/sol-referencia-suncalc.json', import.meta.url), 'utf8'));

secao(`posicaoSol contra ${ref.meta.fonte} (versão ${ref.meta.versao})`);
ok(ref.instantes.length >= 60, `referência com só ${ref.instantes.length} instantes (mínimo 60)`);
ok(ref.meta.local.lat === MOC.lat && ref.meta.local.lng === MOC.lng && ref.meta.local.fusoHoras === MOC.fusoHoras, 'referência gerada para outro local/fuso');
let maxAz = 0, maxEl = 0, maxAp = 0, piorAz = null, piorEl = null;
const datas = new Set(), horas = new Set();
for (const i of ref.instantes) {
  datas.add(i.dataISO); horas.add(Math.floor(i.minutosLocais / 60));
  const utc = dataLocalParaUTC(i.dataISO, i.minutosLocais);
  ok(utc.toISOString() === i.utc, `${i.dataISO} ${i.minutosLocais}: UTC ${utc.toISOString()} != ${i.utc}`);
  const p = posicaoSol(utc, MOC.lat, MOC.lng);
  const pl = posicaoSolLocal(i.dataISO, i.minutosLocais);
  ok(p.azimute === pl.azimute && p.elevacao === pl.elevacao, `${i.dataISO} ${i.minutosLocais}: posicaoSolLocal difere de posicaoSol`);
  ok(p.azimute >= 0 && p.azimute < 360 && p.elevacao >= -90 && p.elevacao <= 90, `${i.dataISO} ${i.minutosLocais}: fora da faixa`);
  const da = difAz(p.azimute, i.azimute);
  const de = Math.abs(p.elevacao - i.elevacaoGeometrica);
  const dp = Math.abs(p.elevacao + refracao(p.elevacao) - i.altitudeAparente);
  if (da > maxAz) { maxAz = da; piorAz = i; }
  if (de > maxEl) { maxEl = de; piorEl = i; }
  maxAp = Math.max(maxAp, dp);
  ok(da <= ERRO_MAX_GRAUS, `${i.dataISO} ${i.minutosLocais}min: azimute ${p.azimute.toFixed(3)} vs ${i.azimute} (Δ ${da.toFixed(3)}°)`);
  ok(de <= ERRO_MAX_GRAUS, `${i.dataISO} ${i.minutosLocais}min: elevação ${p.elevacao.toFixed(3)} vs ${i.elevacaoGeometrica} (Δ ${de.toFixed(3)}°)`);
  ok(dp <= ERRO_MAX_GRAUS, `${i.dataISO} ${i.minutosLocais}min: altitude aparente Δ ${dp.toFixed(3)}°`);
}
console.log(`  ${ref.instantes.length} instantes, ${datas.size} datas, horas locais ${Math.min(...horas)}h a ${Math.max(...horas)}h`);
console.log(`  erro máximo azimute: ${maxAz.toFixed(4)}° (${piorAz.dataISO} ${fmtHora(piorAz.minutosLocais)})`);
console.log(`  erro máximo elevação geométrica: ${maxEl.toFixed(4)}° (${piorEl.dataISO} ${fmtHora(piorEl.minutosLocais)})`);
console.log(`  erro máximo altitude aparente (com a refração do suncalc): ${maxAp.toFixed(4)}°`);

secao('nascerPorDoSol contra suncalc getTimes');
let maxMin = 0;
for (const d of ref.dias) {
  const r = nascerPorDoSol(d.dataISO);
  for (const k of ['nascer', 'meioDia', 'porDoSol']) {
    ok(Number.isInteger(r[k]), `${d.dataISO} ${k} não inteiro: ${r[k]}`);
    const dif = Math.abs(r[k] - d[k]);
    maxMin = Math.max(maxMin, dif);
    ok(dif <= ERRO_MAX_MIN, `${d.dataISO} ${k}: ${r[k]} vs ${d[k]} (Δ ${dif.toFixed(2)} min)`);
  }
  // no nascer calculado a elevação tem que estar perto de -0,833°
  const pn = posicaoSolLocal(d.dataISO, r.nascer);
  ok(Math.abs(pn.elevacao + 0.833) < 0.3, `${d.dataISO}: elevação no nascer ${pn.elevacao.toFixed(3)}°`);
}
console.log(`  ${ref.dias.length} dias, diferença máxima ${maxMin.toFixed(3)} min`);
const inv = nascerPorDoSol('2026-06-21'), ver = nascerPorDoSol('2026-12-21');
console.log(`  21/06: nascer ${fmtHora(inv.nascer)} · meio-dia ${fmtHora(inv.meioDia)} · pôr ${fmtHora(inv.porDoSol)}`);
console.log(`  21/12: nascer ${fmtHora(ver.nascer)} · meio-dia ${fmtHora(ver.meioDia)} · pôr ${fmtHora(ver.porDoSol)}`);
ok(ver.porDoSol - ver.nascer > inv.porDoSol - inv.nascer, 'dia de 21/12 deveria ser mais longo que o de 21/06 (hemisfério sul)');
const polar = nascerPorDoSol('2026-06-21', 80, 0);
ok(polar.nascer === null && polar.porDoSol === null, 'latitude 80°N em 21/06: sol não se põe, nascer/pôr deveriam ser null');

secao('Âncoras astronômicas');
// equinócio de março de 2026: 20/03 ~14:46 UTC, perto do meio-dia solar de MOC
const eq = nascerPorDoSol('2026-03-20');
const pEq = posicaoSolLocal('2026-03-20', eq.meioDia);
const esperado = 90 - Math.abs(MOC.lat);
console.log(`  equinócio, meio-dia solar ${fmtHora(eq.meioDia)}: elevação ${pEq.elevacao.toFixed(3)}° (esperado ≈ ${esperado.toFixed(3)}°)`);
ok(Math.abs(pEq.elevacao - esperado) < 0.5, 'elevação no meio-dia do equinócio ≠ 90 − |lat|');
ok(pEq.azimute > 270 || pEq.azimute < 90, `equinócio ao meio-dia em lat -16,7: sol ao norte (azimute ${pEq.azimute.toFixed(1)})`);
const pInv = posicaoSolLocal('2026-06-21', inv.meioDia);
ok(Math.abs(pInv.elevacao - (90 - Math.abs(MOC.lat) - 23.44)) < 0.5, `21/06 meio-dia: elevação ${pInv.elevacao.toFixed(2)}° ≠ 90 − |lat| − 23,44`);
ok(posicaoSolLocal('2026-06-21', 120).elevacao < -30, 'madrugada (02:00) deveria ter sol bem abaixo do horizonte');
const manha = posicaoSolLocal('2026-03-20', 480), tarde = posicaoSolLocal('2026-03-20', 960);
ok(manha.azimute > 60 && manha.azimute < 120, `equinócio 08:00 deveria ter sol a leste (azimute ${manha.azimute.toFixed(1)})`);
ok(tarde.azimute > 240 && tarde.azimute < 300, `equinócio 16:00 deveria ter sol a oeste (azimute ${tarde.azimute.toFixed(1)})`);

secao('fatorDia');
let anterior = -1, monotonico = true;
for (let e = -90; e <= 90; e += 0.25) {
  const f = fatorDia(e);
  if (f < anterior || f < 0 || f > 1) monotonico = false;
  anterior = f;
}
ok(monotonico, 'fatorDia não é monotônico em [0,1] de -90° a 90°');
ok(fatorDia(-6) === 0 && fatorDia(-30) === 0, 'fatorDia(≤ -6°) deveria ser 0');
ok(fatorDia(8) === 1 && fatorDia(60) === 1, 'fatorDia(≥ 8°) deveria ser 1');
ok(Math.abs(fatorDia(1) - 0.5) < 1e-12, `fatorDia(1°) = ${fatorDia(1)} (meio da faixa -6..8 deveria ser 0,5)`);
ok(LIMIAR_NOITE === 0.5, 'LIMIAR_NOITE deveria ser 0,5');
ok(fatorDia(posicaoSolLocal('2026-10-06', 1200).elevacao) < LIMIAR_NOITE, '06/10 às 20:00 deveria ser noite (estado inicial do app)');
ok(fatorDia(posicaoSolLocal('2026-10-06', 720).elevacao) > LIMIAR_NOITE, '06/10 ao meio-dia deveria ser dia');
ok(lanca(() => fatorDia(NaN)), 'fatorDia(NaN) deveria lançar');

secao('janelaDeSol');
const norteInv = janelaDeSol('2026-06-21', 0), sulInv = janelaDeSol('2026-06-21', 180);
const leste = janelaDeSol('2026-06-21', 90), oeste = janelaDeSol('2026-06-21', 270);
const desc = (j) => `${j.faixas.map(([a, b]) => `${fmtHora(a)}-${fmtHora(b)}`).join(', ') || 'nenhuma'} (${j.minutos} min)`;
console.log(`  21/06 · norte ${desc(norteInv)} · sul ${desc(sulInv)} · leste ${desc(leste)} · oeste ${desc(oeste)}`);
ok(norteInv.minutos > sulInv.minutos, 'inverno: fachada norte deveria ter mais sol que a sul');
ok(sulInv.minutos === 0, `inverno em lat -16,7: fachada sul não deveria ter sol direto (${sulInv.minutos} min)`);
ok(norteInv.minutos > 600, `inverno: fachada norte deveria ter sol quase o dia todo (${norteInv.minutos} min)`);
// janelaDeSol usa elevação geométrica > 0, que vem uns 4 min depois do nascer oficial (-0,833°)
ok(leste.inicio !== null && leste.inicio >= inv.nascer && leste.inicio - inv.nascer <= 8, `fachada leste deveria pegar sol logo após o nascer (${leste.inicio} vs ${inv.nascer})`);
ok(leste.fim !== null && Math.abs(leste.fim - inv.meioDia) <= 2, `fachada leste deveria perder o sol perto do meio-dia (${leste.fim} vs ${inv.meioDia})`);
ok(oeste.inicio !== null && Math.abs(oeste.inicio - inv.meioDia) <= 2, `fachada oeste deveria ganhar sol perto do meio-dia (${oeste.inicio})`);
// 21/12: declinação (-23,4°) ao sul da latitude (-16,7°), o sol passa ao sul do zênite o dia inteiro
const sulVer = janelaDeSol('2026-12-21', 180), norteVer = janelaDeSol('2026-12-21', 0);
console.log(`  21/12 · sul ${desc(sulVer)} · norte ${desc(norteVer)}`);
ok(sulVer.faixas.length === 1 && sulVer.minutos > 720 && norteVer.minutos === 0, 'verão: fachada sul com sol o dia todo e norte sem sol');
// 14/02: declinação (~-13°) ao norte da latitude, sol nasce e se põe ao sul do leste/oeste mas passa ao norte ao meio-dia
const sulFev = janelaDeSol('2026-02-14', 180);
console.log(`  14/02 · sul ${desc(sulFev)}`);
ok(sulFev.faixas.length === 2, 'fevereiro: fachada sul deveria ter sol de manhã e no fim da tarde (2 faixas)');
// estrutura e coerência
for (const j of [norteInv, sulInv, leste, oeste, sulVer, norteVer, sulFev]) {
  const soma = j.faixas.reduce((s, [a, b]) => s + (b - a), 0);
  ok(soma === j.minutos, 'minutos ≠ soma das faixas');
  ok(j.faixas.every(([a, b], k) => Number.isInteger(a) && Number.isInteger(b) && a < b && (k === 0 || a > j.faixas[k - 1][1])), 'faixas fora de ordem ou não inteiras');
  ok(j.faixas.length ? j.inicio === j.faixas[0][0] && j.fim === j.faixas.at(-1)[1] : j.inicio === null && j.fim === null, 'inicio/fim incoerentes');
}
// o refino por bisseção torna o resultado quase independente do passo
const passo1 = janelaDeSol('2026-06-21', 20, MOC.lat, MOC.lng, 1), passo15 = janelaDeSol('2026-06-21', 20, MOC.lat, MOC.lng, 15);
ok(Math.abs(passo1.minutos - passo15.minutos) <= 1, `passo 1 vs 15 min: ${passo1.minutos} vs ${passo15.minutos}`);
ok(lanca(() => janelaDeSol('2026-06-21', 0, MOC.lat, MOC.lng, 0)), 'passoMin 0 deveria lançar');
ok(lanca(() => janelaDeSol('2026-02-30', 0)), 'data inexistente deveria lançar');

secao('rotuloOrientacao');
const casos = [[0, 'Norte'], [22.4, 'Norte'], [22.6, 'Nordeste'], [45, 'Nordeste'], [90, 'Leste'], [135, 'Sudeste'], [180, 'Sul'],
  [190, 'Sul'], [225, 'Sudoeste'], [270, 'Oeste'], [315, 'Noroeste'], [337.6, 'Norte'], [359.9, 'Norte'], [360, 'Norte'], [-90, 'Oeste'], [20, 'Norte'], [100, 'Leste']];
for (const [az, r] of casos) ok(rotuloOrientacao(az) === r, `rotuloOrientacao(${az}) = ${rotuloOrientacao(az)}, esperado ${r}`);
ok(lanca(() => rotuloOrientacao('norte')), 'rotuloOrientacao(texto) deveria lançar');

secao('fmtHora');
for (const [m, s] of [[0, '00:00'], [5, '00:05'], [300, '05:00'], [870, '14:30'], [1230, '20:30'], [1439, '23:59'], [1440, '00:00'], [59.6, '01:00'], [-1, '23:59']]) {
  ok(fmtHora(m) === s, `fmtHora(${m}) = ${fmtHora(m)}, esperado ${s}`);
}
ok(lanca(() => fmtHora(null)), 'fmtHora(null) deveria lançar');

secao('dataLocalParaUTC e hojeMOC');
ok(dataLocalParaUTC('2026-10-06', 1200).toISOString() === '2026-10-06T23:00:00.000Z', '06/10 20:00 local = 23:00 UTC');
ok(dataLocalParaUTC('2026-10-06', 1320).toISOString() === '2026-10-07T01:00:00.000Z', '06/10 22:00 local = 07/10 01:00 UTC');
ok(dataLocalParaUTC('2026-10-06', 0, 0).toISOString() === '2026-10-06T00:00:00.000Z', 'fuso 0');
ok(lanca(() => dataLocalParaUTC('06/10/2026', 0)), 'formato errado deveria lançar');
ok(lanca(() => dataLocalParaUTC('2026-10-06', 1500)), 'minutos > 1440 deveria lançar');
ok(lanca(() => posicaoSol(new Date('x'), MOC.lat, MOC.lng)), 'Date inválido deveria lançar');
const h1 = hojeMOC(new Date('2026-10-07T01:30:00Z'));
ok(h1.dataISO === '2026-10-06' && h1.minutos === 1350, `hojeMOC 07/10 01:30 UTC = 06/10 22:30 local (veio ${JSON.stringify(h1)})`);
const h2 = hojeMOC(new Date('2026-01-01T02:59:00Z'));
ok(h2.dataISO === '2025-12-31' && h2.minutos === 1439, `hojeMOC virada de ano (veio ${JSON.stringify(h2)})`);
const h3 = hojeMOC();
ok(/^\d{4}-\d{2}-\d{2}$/.test(h3.dataISO) && h3.minutos >= 0 && h3.minutos < 1440, `hojeMOC() sem argumento: ${JSON.stringify(h3)}`);
ok(dataLocalParaUTC(h3.dataISO, h3.minutos).getTime() <= Date.now() && Date.now() - dataLocalParaUTC(h3.dataISO, h3.minutos).getTime() < 120_000, 'hojeMOC() não bate com o relógio');

console.log(falhas ? `\n${falhas} FALHA(S) em sol.test.mjs` : '\nsol.test.mjs: TUDO OK');
process.exit(falhas ? 1 : 0);
