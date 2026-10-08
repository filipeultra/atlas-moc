// Cálculo do fluxo de pagamento e formatadores. Módulo puro: sem DOM, sem three.
// Roda no navegador e no Node (tests/run.mjs). Tudo em centavos inteiros.

/**
 * Divide o valor de tabela nas etapas do fluxo do lançamento.
 * Etapas: [{ rotulo, pct_bp (basis points, 10000 = 100%), parcelas }].
 * A última etapa absorve o resto do arredondamento, e dentro de cada etapa
 * a 1ª parcela absorve o resto da divisão: a soma de tudo bate no centavo.
 */
export function calcularFluxo(valorCentavos, etapas) {
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) {
    throw new Error(`valor de tabela inválido: ${valorCentavos}`);
  }
  const somaBp = etapas.reduce((s, e) => s + e.pct_bp, 0);
  if (somaBp !== 10000) {
    throw new Error(`fluxo soma ${somaBp / 100}% (deveria ser 100%)`);
  }
  let alocado = 0;
  return etapas.map((e, i) => {
    if (!Number.isInteger(e.parcelas) || e.parcelas < 1) {
      throw new Error(`etapa "${e.rotulo}" com parcelas inválidas: ${e.parcelas}`);
    }
    const ultima = i === etapas.length - 1;
    const total = ultima ? valorCentavos - alocado : Math.floor((valorCentavos * e.pct_bp) / 10000);
    alocado += total;
    const parcela = Math.floor(total / e.parcelas);
    const primeira = total - parcela * (e.parcelas - 1);
    return { rotulo: e.rotulo, pct: e.pct_bp / 100, parcelas: e.parcelas, totalCentavos: total, parcelaCentavos: parcela, primeiraCentavos: primeira };
  });
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export const fmtCentavos = (c) => brl.format(c / 100);
export const fmtReais = (r) => brl0.format(r);
export const fmtArea = (m2) => `${num1.format(m2)} m²`;

/** "R$ 1,2 mi", "R$ 890 mil", "R$ 2.300" — rótulo curto para o mapa. */
export function fmtCurto(reais) {
  if (reais >= 1_000_000) return `R$ ${num1.format(reais / 1_000_000)} mi`;
  if (reais >= 10_000) return `R$ ${Math.round(reais / 1000)} mil`;
  return brl0.format(reais);
}

export function fmtData(iso) {
  const [a, m, d] = iso.split('-');
  return d ? `${d}/${m}/${a}` : `${m}/${a}`;
}
