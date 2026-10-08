// Fonte dos dados: demonstração (fictícios) ou anúncios reais. A escolha vive na URL (?dados=real) e a
// última escolha fica no aparelho. Link com rota (#/imovel/..., #/selecao/...) sem o parâmetro foi gerado
// no modo demonstração, então abre em demonstração mesmo para quem escolheu os reais por último.
import { icone } from '../icones-ui.js';
import { esc } from './util.js';

export const CHAVE_DADOS = 'atlas-moc:dados:v1';
export const PARAM_DADOS = 'dados';
export const MODOS_DADOS = ['demo', 'real'];
const ROTA_PROFUNDA = /^#\/?(imovel|lancamento|predio|selecao)\//;

/** Última escolha salva ('demo' | 'real') ou null. Nunca lança: falha vira aoErro(msg). */
export function lerModoSalvo({ aoErro } = {}) {
  let v;
  try {
    v = globalThis.localStorage ? globalThis.localStorage.getItem(CHAVE_DADOS) : null;
  } catch (err) {
    console.error('[modo-dados]', err);
    aoErro?.(`Não consegui ler a última fonte de dados escolhida (${err.message}). Usando a demonstração.`);
    return null;
  }
  if (v === null) return null;
  if (!MODOS_DADOS.includes(v)) {
    console.error('[modo-dados]', new Error(`valor salvo inválido: ${v}`));
    aoErro?.(`A fonte de dados salva neste aparelho é inválida (${v}). Usando a demonstração.`);
    return null;
  }
  return v;
}

export function salvarModo(modo, { aoErro } = {}) {
  try {
    if (!globalThis.localStorage) throw new Error('localStorage indisponível neste ambiente');
    globalThis.localStorage.setItem(CHAVE_DADOS, modo);
    return true;
  } catch (err) {
    console.error('[modo-dados]', err);
    aoErro?.(`Não consegui guardar a escolha da fonte de dados (${err.message}). Ela vale só por este link.`);
    return false;
  }
}

/**
 * Decide o modo ao abrir a página.
 * → { modo: 'demo' | 'real', origem: 'url' | 'link' | 'salvo' | 'padrao', aviso? }
 */
export function resolverModoDados({ search = '', hash = '', salvo = null } = {}) {
  const p = new URLSearchParams(search).get(PARAM_DADOS);
  if (p === 'real' || p === 'demo') return { modo: p, origem: 'url' };
  if (p !== null) {
    return { modo: 'demo', origem: 'url', aviso: `Parâmetro dados=${p} desconhecido (use dados=real). Mostrando a demonstração.` };
  }
  if (ROTA_PROFUNDA.test(hash)) return { modo: 'demo', origem: 'link' };
  if (MODOS_DADOS.includes(salvo)) return { modo: salvo, origem: 'salvo' };
  return { modo: 'demo', origem: 'padrao' };
}

/** URL da página no modo pedido: real leva ?dados=real; demonstração tira o parâmetro. */
export function urlDoModo(href, modo, { hash } = {}) {
  const u = new URL(href);
  if (modo === 'real') u.searchParams.set(PARAM_DADOS, 'real');
  else u.searchParams.delete(PARAM_DADOS);
  if (hash !== undefined) u.hash = hash;
  return u.href;
}

/** Botões do controle segmentado [Demonstração | Anúncios reais]. motivoReal: por que os reais não abriram. */
export function htmlControleModo(modo, { motivoReal = '' } = {}) {
  const botao = (k, ic, rot, dica) => `<button type="button" data-dados="${k}" aria-pressed="${modo === k}" aria-label="${rot}" title="${esc(dica)}">${icone(ic, { tamanho: 15 })}<span class="rot">${rot}</span></button>`;
  return botao('demo', 'cubo', 'Demonstração', 'Dados de demonstração: imóveis, corretores e lançamentos fictícios')
    + botao('real', 'vendido', 'Anúncios reais', motivoReal
      ? `Os anúncios reais não abriram: ${motivoReal}`
      : 'Anúncios reais de Montes Claros (portais, imobiliárias e construtoras), com fotos e link do anúncio original');
}
