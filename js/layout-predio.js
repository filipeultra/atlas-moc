// Distribuição das unidades no andar: fonte única para a cena 3D (predio.js) e para a insolação
// da ficha (ui/insolacao.js). Módulo puro, sem three e sem DOM, para a ficha não baixar a cena.

const FOLGA_BORDA = 0.01; // m: tolerância para dizer que a unidade encosta na lateral

/**
 * Unidades do andar (já ordenadas por final) → retângulos na planta, frente = +z.
 * A primeira metade (arredondada para cima) fica na frente, da esquerda (−x) para a direita (+x);
 * o resto fica nos fundos, da direita para a esquerda. Andar com uma unidade ocupa a planta toda.
 */
export function layoutAndar(unidadesDoAndar, W, D) {
  const n = unidadesDoAndar.length;
  const nf = Math.ceil(n / 2), nb = n - nf;
  return unidadesDoAndar.map((u, i) => {
    if (nb === 0) return { u, x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2, face: 'frente' };
    if (i < nf) {
      const w = W / nf;
      return { u, x0: -W / 2 + i * w, x1: -W / 2 + (i + 1) * w, z0: 0, z1: D / 2, face: 'frente' };
    }
    const j = i - nf, w = W / nb;
    return { u, x0: W / 2 - (j + 1) * w, x1: W / 2 - j * w, z0: -D / 2, z1: 0, face: 'fundos' };
  });
}

/** Encosta na lateral direita (+x, azimute A − 90) ou esquerda (−x, A + 90)? */
export const tocaDireita = (s, W) => s.x1 >= W / 2 - FOLGA_BORDA;
export const tocaEsquerda = (s, W) => s.x0 <= -W / 2 + FOLGA_BORDA;

/** Faces externas de um retângulo do layoutAndar: face principal, laterais que toca e, se ocupa a planta toda, os fundos. */
export function facesDoRetangulo(s, W, D) {
  const f = [s.face];
  if (tocaDireita(s, W)) f.push('direita');
  if (tocaEsquerda(s, W)) f.push('esquerda');
  if (s.face === 'frente' && s.z0 <= -D / 2 + FOLGA_BORDA) f.push('fundos');
  return f;
}
