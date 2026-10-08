// Insolação de uma unidade: quais faces ela tem e quando o sol bate direto em cada uma.
// Módulo puro (sem DOM): roda no navegador e no Node.
import { janelaDeSol, rotuloOrientacao, fmtHora } from '../sol.js';
import { layoutAndar, facesDoRetangulo } from '../layout-predio.js';

export const NOME_FACE = { frente: 'Frente', fundos: 'Fundos', direita: 'Lateral direita', esquerda: 'Lateral esquerda' };

const norm360 = (a) => ((a % 360) + 360) % 360;

/** Azimute da normal de cada face, dado o azimute A da fachada frontal (seção 8 do contrato). */
export function azimuteDaFace(face, A) {
  const desvio = { frente: 0, fundos: 180, direita: -90, esquerda: 90 }[face];
  if (desvio === undefined) throw new Error(`face desconhecida: ${face}`);
  return norm360(A + desvio);
}

/**
 * Faces externas da unidade, pela mesma distribuição da cena 3D (layout-predio.js): no andar,
 * por ordem de final, a primeira metade fica na frente e o resto nos fundos; ponta de fileira = canto.
 */
export function facesDaUnidade(lancamento, unidade) {
  const doAndar = lancamento.unidades.filter((x) => x.andar === unidade.andar).sort((a, b) => a.final - b.final);
  const { largura_m: W, profundidade_m: D } = lancamento.predio || {};
  if (!(W > 0) || !(D > 0)) throw new Error(`o lançamento ${lancamento.id} não tem largura_m e profundidade_m válidas`);
  const s = layoutAndar(doAndar, W, D).find((x) => x.u.numero === unidade.numero);
  if (!s) throw new Error(`unidade ${unidade.numero} não encontrada no ${unidade.andar}º andar`);
  return facesDoRetangulo(s, W, D);
}

/** Duração em minutos → '5h28' | '45 min'. */
export function fmtDuracao(min) {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

/** 'AAAA-MM-DD' → 'DD/MM'. */
export const fmtDiaMes = (iso) => { const [, m, d] = String(iso).split('-'); return `${d}/${m}`; };

/** Faixas → '06:12–11:40, 15:00–17:20'. */
export const fmtFaixas = (faixas) => faixas.map(([a, b]) => `${fmtHora(a)}–${fmtHora(b)}`).join(', ');

/**
 * → [{ face, nomeFace, azimute, orientacao, janela: {faixas, minutos, inicio, fim} }]
 * Lança se o lançamento não tem orientação: o chamador mostra o motivo na ficha.
 */
export function insolacaoUnidade(lancamento, unidade, dataISO) {
  const A = lancamento?.predio?.orientacao_graus;
  if (typeof A !== 'number' || !Number.isFinite(A)) {
    throw new Error(`o lançamento ${lancamento?.id} não tem predio.orientacao_graus nos dados`);
  }
  return facesDaUnidade(lancamento, unidade).map((face) => {
    const azimute = azimuteDaFace(face, A);
    return { face, nomeFace: NOME_FACE[face], azimute, orientacao: rotuloOrientacao(azimute), janela: janelaDeSol(dataISO, azimute) };
  });
}
