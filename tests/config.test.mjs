// Testa js/config.js com localStorage simulado. Uso: node tests/config.test.mjs
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const raiz = process.argv[2] || fileURLToPath(new URL('../', import.meta.url));
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? 'ok   ' : 'FALHA'} ${m}`); if (!c) falhas++; };

// localStorage simulado (com modo "quebrado" para testar falhas)
const mem = new Map();
let quebrado = false;
globalThis.localStorage = {
  getItem(k) { if (quebrado) throw new Error('SecurityError simulado'); return mem.has(k) ? mem.get(k) : null; },
  setItem(k, v) { if (quebrado) throw new Error('QuotaExceededError simulado'); mem.set(k, String(v)); },
  removeItem(k) { mem.delete(k); },
};
let reduzir = false;
globalThis.matchMedia = (q) => ({ matches: q.includes('prefers-reduced-motion') ? reduzir : false });

const C = await import(pathToFileURL(path.join(raiz, 'js/config.js')).href);
const erros = [];
const aoErro = (m) => erros.push(m);
const origErr = console.error; console.error = () => {}; // silencia o log esperado; contamos via aoErro

// 1. vazio → padrão
let cfg = C.carregarConfig({ aoErro });
ok(JSON.stringify(cfg) === JSON.stringify(C.PADRAO), 'sem nada salvo devolve PADRAO');
ok(erros.length === 0, 'sem erro quando não há nada salvo');

// 2. prefers-reduced-motion → animacoes false no padrão
reduzir = true;
ok(C.carregarConfig().animacoes === false, 'reduced-motion desliga animações no padrão');
reduzir = false;

// 3. salvar e carregar ida e volta
const alterada = { ...C.PADRAO, icones: 'pinos', visao: '2d', tema: 'claro', medidor: true, nomesRuas: false, qualidade: 'economica' };
ok(C.salvarConfig(alterada, { aoErro }) === true, 'salvarConfig devolve true');
cfg = C.carregarConfig({ aoErro });
ok(cfg.icones === 'pinos' && cfg.visao === '2d' && cfg.tema === 'claro' && cfg.medidor === true && cfg.nomesRuas === false && cfg.qualidade === 'economica', 'ida e volta preserva valores');
ok(mem.get(C.CHAVE_ARMAZENAMENTO).startsWith('{'), `grava na chave ${C.CHAVE_ARMAZENAMENTO}`);

// 4. mescla parcial: só uma chave salva, resto do padrão
mem.set(C.CHAVE_ARMAZENAMENTO, JSON.stringify({ tema: 'auto' }));
cfg = C.carregarConfig({ aoErro });
ok(cfg.tema === 'auto' && cfg.icones === '3d' && cfg.agrupar === true, 'mescla parcial com PADRAO');

// 5. valor inválido descartado E avisado
erros.length = 0;
mem.set(C.CHAVE_ARMAZENAMENTO, JSON.stringify({ icones: 'gigante', animacoes: 'sim', tema: 'claro', futura: 1 }));
cfg = C.carregarConfig({ aoErro });
ok(cfg.icones === '3d' && cfg.animacoes === true && cfg.tema === 'claro', 'inválidos voltam ao padrão, válidos ficam');
ok(erros.length === 1 && erros[0].includes('icones') && erros[0].includes('animacoes') && !erros[0].includes('futura'), `aviso cita as chaves inválidas: ${erros[0]}`);

// 6. JSON corrompido
erros.length = 0;
mem.set(C.CHAVE_ARMAZENAMENTO, '{nao é json');
cfg = C.carregarConfig({ aoErro });
ok(JSON.stringify(cfg) === JSON.stringify(C.PADRAO) && erros.length === 1 && erros[0].includes('corrompidas'), 'JSON corrompido → padrão + aviso');
mem.set(C.CHAVE_ARMAZENAMENTO, '[1,2]');
erros.length = 0;
C.carregarConfig({ aoErro });
ok(erros.length === 1, 'array salvo → aviso');

// 7. localStorage lançando
quebrado = true; erros.length = 0;
cfg = C.carregarConfig({ aoErro });
ok(JSON.stringify(cfg) === JSON.stringify(C.PADRAO) && erros[0]?.includes('SecurityError'), 'leitura que lança → padrão + aviso com o erro real');
erros.length = 0;
ok(C.salvarConfig(C.PADRAO, { aoErro }) === false && erros[0]?.includes('QuotaExceededError'), 'gravação que lança → false + aviso com o erro real');
quebrado = false;

// 8. salvar descarta chaves desconhecidas e valores inválidos
C.salvarConfig({ ...C.PADRAO, lixo: 1, icones: 'nada' });
const gravado = JSON.parse(mem.get(C.CHAVE_ARMAZENAMENTO));
ok(!('lixo' in gravado) && !('icones' in gravado), 'salvar grava só chaves conhecidas e válidas');

// 9. resolverQualidade
const R = C.resolverQualidade;
ok(R('alta') === 'alta' && R('equilibrada') === 'equilibrada' && R('economica') === 'economica', 'explícitas passam direto');
ok(R('auto', { mobile: false, memoria: 8, nucleos: 8 }) === 'alta', 'desktop forte → alta');
ok(R('auto', { mobile: true, memoria: 8, nucleos: 8 }) === 'equilibrada', 'mobile forte → equilibrada');
ok(R('auto', { mobile: false, memoria: 4, nucleos: 8 }) === 'equilibrada', '4 GB → equilibrada');
ok(R('auto', { mobile: false, memoria: null, nucleos: 4 }) === 'equilibrada', '4 núcleos, memória desconhecida → equilibrada');
ok(R('auto', { mobile: true, memoria: 2, nucleos: 8 }) === 'economica', '2 GB → economica');
ok(R('auto', { mobile: false, memoria: null, nucleos: 2 }) === 'economica', '2 núcleos → economica');
ok(R('auto', { mobile: false, memoria: null, nucleos: null }) === 'alta', 'nada informado no desktop → alta');
ok(R('xyz', { mobile: false, memoria: 8, nucleos: 8 }) === 'alta', 'valor desconhecido cai na automática (e loga)');
ok(['alta', 'equilibrada', 'economica'].includes(R('auto')), `ambiente real deste Node → ${R('auto')}`);
const res = C.configResolvida({ ...C.PADRAO }, { mobile: false, memoria: 8, nucleos: 8 });
ok(res.qualidade === 'alta' && C.PADRAO.qualidade === 'auto', 'configResolvida nunca devolve auto e não altera PADRAO');

console.error = origErr;
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nconfig.js: TUDO OK');
process.exit(falhas ? 1 : 0);
