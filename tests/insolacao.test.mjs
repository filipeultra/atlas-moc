// Insolação da ficha: faces pela distribuição de layout-predio.js e janelas de sol. Uso: node tests/insolacao.test.mjs
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const raiz = process.argv[2] || fileURLToPath(new URL('../', import.meta.url));
const I = await import(pathToFileURL(path.join(raiz, 'js/ui/insolacao.js')).href);
const { lancamentos } = JSON.parse(readFileSync(path.join(raiz, 'dados/lancamentos.json'), 'utf8'));
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'ok   ' : 'FALHA'} ${m}`); if (!c) falhas++; };

ok(I.azimuteDaFace('frente', 20) === 20 && I.azimuteDaFace('fundos', 20) === 200 && I.azimuteDaFace('direita', 20) === 290 && I.azimuteDaFace('esquerda', 20) === 110, 'azimutes das faces (A=20): 20/200/290/110');
ok(I.fmtDuracao(328) === '5h28' && I.fmtDuracao(45) === '45 min' && I.fmtDuracao(60) === '1h00', 'fmtDuracao');
ok(I.fmtDiaMes('2026-06-21') === '21/06', 'fmtDiaMes');
ok(I.fmtFaixas([[372, 700]]) === '06:12–11:40', 'fmtFaixas');

for (const l of lancamentos) {
  const andar = l.andares[0];
  const doAndar = l.unidades.filter((u) => u.andar === andar).sort((a, b) => a.final - b.final);
  const faces = doAndar.map((u) => `${u.numero}:${I.facesDaUnidade(l, u).join('+')}`);
  console.log(`  ${l.id} (A=${l.predio.orientacao_graus}) ${andar}º: ${faces.join('  ')}`);
  // cantos: primeira e última da frente e da fundos têm 2 faces
  const n = doAndar.length, nf = Math.ceil(n / 2);
  ok(I.facesDaUnidade(l, doAndar[0]).includes('esquerda') && I.facesDaUnidade(l, doAndar[nf - 1]).includes('direita'), `${l.id}: cantos da frente`);
  const u = doAndar[0];
  for (const data of ['2026-06-21', '2026-12-21']) {
    const r = I.insolacaoUnidade(l, u, data);
    console.log(`    ${u.numero} ${data}: ${r.map((f) => `${f.nomeFace} (${f.orientacao}, ${Math.round(f.azimute)}°) ${f.janela.minutos ? I.fmtFaixas(f.janela.faixas) + ' ' + I.fmtDuracao(f.janela.minutos) : 'sem sol'}`).join(' | ')}`);
  }
}
// âncora física: no inverno (21/06) a fachada norte do Serra Azul (A=20, frente ~NNE) recebe mais sol que no verão
const sa = lancamentos.find((l) => l.id === 'serra-azul');
const u = sa.unidades.find((x) => I.facesDaUnidade(sa, x).length === 1 && I.facesDaUnidade(sa, x)[0] === 'frente');
const inv = I.insolacaoUnidade(sa, u, '2026-06-21')[0].janela.minutos, ver = I.insolacaoUnidade(sa, u, '2026-12-21')[0].janela.minutos;
ok(inv > ver, `frente NNE do Serra Azul: inverno ${inv} min > verão ${ver} min`);
// sem orientação → lança com mensagem específica
let msg = '';
try { I.insolacaoUnidade({ ...sa, predio: { ...sa.predio, orientacao_graus: undefined } }, u, '2026-06-21'); } catch (e) { msg = e.message; }
ok(msg.includes('orientacao_graus'), `sem orientação lança: "${msg}"`);
console.log(falhas ? `\n${falhas} FALHA(S)` : '\ninsolacao.js: TUDO OK');
process.exit(falhas ? 1 : 0);
