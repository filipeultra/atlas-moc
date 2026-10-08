// Preferências do usuário: o que aparece no mapa, movimento, qualidade e tema.
// Módulo sem DOM (só lê matchMedia/navigator quando existem) para rodar também no Node (testes).

export const CHAVE_ARMAZENAMENTO = 'atlas-moc:config:v1';

export const PADRAO = {
  icones: '3d',            // '3d' | 'pinos' | 'ocultos'
  visao: '3d',             // '3d' | '2d'
  prediosCidade: true,     // extrusões do OSM
  nomesRuas: true,
  nomesBairros: true,
  pontosInteresse: false,
  etiquetasPreco: true,
  agrupar: true,           // clusters
  animacoes: true,         // padrão real: !matchMedia('(prefers-reduced-motion: reduce)').matches
  qualidade: 'auto',       // 'auto' | 'alta' | 'equilibrada' | 'economica'
  tema: 'escuro',          // 'escuro' | 'claro' | 'auto'
  medidor: false,          // overlay de FPS e draw calls
};

// Valores aceitos por chave: o que vier do armazenamento fora disso é descartado (e avisado).
export const OPCOES = {
  icones: ['3d', 'pinos', 'ocultos'],
  visao: ['3d', '2d'],
  qualidade: ['auto', 'alta', 'equilibrada', 'economica'],
  tema: ['escuro', 'claro', 'auto'],
};

// Limiares da qualidade automática (memória em GB, núcleos lógicos).
const LIMIAR_ECONOMICA = { memoria: 2, nucleos: 2 };
const LIMIAR_EQUILIBRADA = { memoria: 4, nucleos: 4 };

function armazenamento() {
  // globalThis.localStorage pode não existir (Node) ou lançar (modo privado, cookies bloqueados)
  return globalThis.localStorage;
}

function prefereMenosMovimento() {
  try { return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches); }
  catch (err) { console.error('[config]', err); return false; }
}

/** Padrão efetivo deste aparelho: animações seguem prefers-reduced-motion. */
export function padraoDoAparelho() {
  return { ...PADRAO, animacoes: !prefereMenosMovimento() };
}

function valido(chave, valor) {
  if (!(chave in PADRAO)) return false;
  if (OPCOES[chave]) return OPCOES[chave].includes(valor);
  return typeof valor === typeof PADRAO[chave];
}

/**
 * Lê do localStorage e mescla com o padrão. Nunca lança: em falha devolve o padrão e
 * chama aoErro(msg) com o motivo específico (o shell mostra no aviso).
 */
export function carregarConfig({ aoErro } = {}) {
  const base = padraoDoAparelho();
  let bruto;
  try {
    const ls = armazenamento();
    if (!ls) return base;
    bruto = ls.getItem(CHAVE_ARMAZENAMENTO);
  } catch (err) {
    console.error('[config]', err);
    aoErro?.(`Não consegui ler as preferências salvas (${err.message}). Usando o padrão.`);
    return base;
  }
  if (bruto == null) return base;
  let salvo;
  try {
    salvo = JSON.parse(bruto);
    if (!salvo || typeof salvo !== 'object' || Array.isArray(salvo)) throw new Error('conteúdo não é um objeto');
  } catch (err) {
    console.error('[config]', err);
    aoErro?.(`Preferências salvas estão corrompidas (${err.message}). Usando o padrão.`);
    return base;
  }
  const cfg = { ...base };
  const descartadas = [];
  for (const [k, v] of Object.entries(salvo)) {
    if (valido(k, v)) cfg[k] = v;
    else if (k in PADRAO) descartadas.push(`${k}=${JSON.stringify(v)}`);
    // chaves desconhecidas (versões futuras) são ignoradas sem alarde: não é erro
  }
  if (descartadas.length) {
    const msg = `Preferências com valor inválido foram restauradas ao padrão: ${descartadas.join(', ')}.`;
    console.error('[config]', msg);
    aoErro?.(msg);
  }
  return cfg;
}

/** Grava só chaves conhecidas. Devolve true se gravou. */
export function salvarConfig(cfg, { aoErro } = {}) {
  const limpo = {};
  for (const k of Object.keys(PADRAO)) if (valido(k, cfg?.[k])) limpo[k] = cfg[k];
  try {
    const ls = armazenamento();
    if (!ls) throw new Error('localStorage indisponível neste ambiente');
    ls.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(limpo));
    return true;
  } catch (err) {
    console.error('[config]', err);
    aoErro?.(`Não consegui salvar as preferências (${err.message}). Elas valem só até fechar a página.`);
    return false;
  }
}

/** Retrato do aparelho usado pela qualidade automática. Exportado para teste. */
export function ambienteAtual() {
  const nav = globalThis.navigator || {};
  let mobile = Boolean(nav.userAgentData?.mobile);
  try {
    mobile ||= Boolean(globalThis.matchMedia?.('(pointer: coarse)').matches && globalThis.matchMedia?.('(max-width: 1024px)').matches);
  } catch (err) { console.error('[config]', err); }
  return {
    mobile,
    memoria: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null, // GB; Safari e Firefox não informam
    nucleos: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
  };
}

/** 'auto' → 'alta' | 'equilibrada' | 'economica'. Valores explícitos passam direto. */
export function resolverQualidade(q, amb = ambienteAtual()) {
  if (q === 'alta' || q === 'equilibrada' || q === 'economica') return q;
  if (q !== 'auto') {
    console.error('[config]', new Error(`qualidade desconhecida: ${q}; usando automática`));
  }
  const { mobile, memoria, nucleos } = amb;
  const abaixo = (lim) => (memoria !== null && memoria <= lim.memoria) || (nucleos !== null && nucleos <= lim.nucleos);
  if (abaixo(LIMIAR_ECONOMICA)) return 'economica';
  if (mobile || abaixo(LIMIAR_EQUILIBRADA)) return 'equilibrada';
  return 'alta';
}

/** Config pronta para os módulos 3D: qualidade nunca chega como 'auto'. */
export function configResolvida(cfg, amb) {
  return { ...cfg, qualidade: resolverQualidade(cfg.qualidade, amb) };
}
