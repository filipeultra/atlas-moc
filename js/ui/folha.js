// Folhas inferiores no mobile: arrastar pelo puxador entre paradas (recolhida, meio, cheia)
// ou, no modo simples, só arrastar para baixo para fechar. No desktop não faz nada.
import { ehMobile, aoMudarMobile } from './util.js';

const ALTURA_RECOLHIDA = 64;    // px visíveis na parada recolhida (sem contar a área segura)
const FRACAO_MEIO = 0.5;        // da altura da janela
const FRACAO_CHEIA = 0.88;
const LIMIAR_TOQUE = 6;         // px: abaixo disso o gesto é um toque, não arraste
const PROJECAO_MS = 180;        // quanto a velocidade empurra a parada escolhida
const LIMIAR_FECHAR_SIMPLES = 90; // px arrastados para baixo que fecham uma folha simples

let areaSeguraBaixo = 0;
function medirAreaSegura() {
  // env() não é legível por JS: mede um elemento com essa altura
  const sonda = document.createElement('div');
  sonda.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none';
  document.body.appendChild(sonda);
  areaSeguraBaixo = sonda.offsetHeight || 0;
  sonda.remove();
}

function alturaParada(nome) {
  const h = innerHeight;
  const topo = document.querySelector('.topo')?.offsetHeight || 56;
  const max = h - topo - 8;
  if (nome === 'recolhida') return ALTURA_RECOLHIDA + areaSeguraBaixo;
  if (nome === 'meio') return Math.min(max, Math.round(h * FRACAO_MEIO));
  if (nome === 'cheia') return Math.min(max, Math.round(h * FRACAO_CHEIA));
  return 0; // fechada
}

/**
 * el: a folha. puxador: elemento que recebe o arraste (botão, para valer também no teclado).
 * modo 'paradas': paradas = subconjunto ordenado de ['recolhida','meio','cheia'].
 * modo 'simples': a folha tem altura natural; arrastar para baixo chama aoFechar().
 */
export function criarFolha(el, { puxador, modo = 'paradas', paradas = ['recolhida', 'meio', 'cheia'], inicial = 'recolhida', fechavel = false, aoFechar, aoMudar, aoTocar } = {}) {
  let estado = inicial;
  let gesto = null;
  let arrastou = false;

  const ativo = () => ehMobile();

  function aplicar(animado = true) {
    if (!ativo()) {
      el.style.removeProperty('height');
      el.style.removeProperty('transform');
      el.style.removeProperty('--folha-oculto');
      el.classList.remove('folha-movel');
      return;
    }
    el.classList.add('folha-movel');
    if (modo === 'simples') { el.style.removeProperty('transform'); return; }
    el.classList.toggle('sem-transicao', !animado);
    const cheia = alturaParada(paradas[paradas.length - 1]);
    const vis = estado === 'fechada' ? 0 : alturaParada(estado);
    el.style.height = `${cheia}px`;
    el.style.transform = estado === 'fechada' ? `translateY(calc(100% + 24px))` : `translateY(${cheia - vis}px)`;
    el.style.setProperty('--folha-oculto', `${Math.max(0, cheia - vis)}px`);
    el.dataset.parada = estado;
    puxador.setAttribute('aria-expanded', String(estado !== 'fechada' && estado !== paradas[0]));
    if (!animado) requestAnimationFrame(() => el.classList.remove('sem-transicao'));
  }

  function ir(nome, { avisar = true } = {}) {
    if (nome !== 'fechada' && !paradas.includes(nome)) {
      console.error('[folha]', new Error(`parada inexistente: ${nome}`));
      return;
    }
    const mudou = nome !== estado;
    estado = nome;
    aplicar();
    if (mudou && avisar) aoMudar?.(estado);
  }

  function visivel() {
    if (!ativo()) return 0;
    if (modo === 'simples') return el.classList.contains('aberto') ? el.offsetHeight : 0;
    return estado === 'fechada' ? 0 : alturaParada(estado);
  }

  // ---------- gesto
  puxador.addEventListener('pointerdown', (e) => {
    if (!ativo() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    puxador.setPointerCapture(e.pointerId);
    gesto = { id: e.pointerId, y0: e.clientY, vis0: visivel(), amostras: [[e.timeStamp, e.clientY]], moveu: false };
    arrastou = false;
  });
  puxador.addEventListener('pointermove', (e) => {
    if (!gesto || e.pointerId !== gesto.id) return;
    const dy = e.clientY - gesto.y0;
    if (!gesto.moveu && Math.abs(dy) < LIMIAR_TOQUE) return;
    gesto.moveu = true;
    el.classList.add('arrastando');
    gesto.amostras.push([e.timeStamp, e.clientY]);
    if (gesto.amostras.length > 6) gesto.amostras.shift();
    if (modo === 'simples') {
      el.style.transform = `translateY(${Math.max(0, dy)}px)`;
      return;
    }
    const cheia = alturaParada(paradas[paradas.length - 1]);
    const minimo = fechavel ? 0 : alturaParada(paradas[0]);
    let vis = gesto.vis0 - dy;
    if (vis > cheia) vis = cheia + (vis - cheia) * 0.25;          // elástico no topo
    if (vis < minimo) vis = minimo - (minimo - vis) * 0.25;       // e embaixo
    el.style.transform = `translateY(${cheia - vis}px)`;
    gesto.vis = vis;
  });
  const soltar = (e) => {
    if (!gesto || e.pointerId !== gesto.id) return;
    const g = gesto;
    gesto = null;
    el.classList.remove('arrastando');
    if (!g.moveu) return; // toque: o click cuida
    arrastou = true;
    const [[t0, y0], [t1, y1]] = [g.amostras[0], g.amostras[g.amostras.length - 1]];
    const vel = t1 > t0 ? (y1 - y0) / (t1 - t0) : 0; // px/ms, positivo = para baixo
    if (modo === 'simples') {
      const dy = e.clientY - g.y0;
      el.style.removeProperty('transform');
      if (dy > LIMIAR_FECHAR_SIMPLES || vel > 0.9) aoFechar?.();
      return;
    }
    const projetado = (g.vis ?? g.vis0) - vel * PROJECAO_MS;
    const candidatos = [...paradas, ...(fechavel ? ['fechada'] : [])];
    let melhor = estado, dist = Infinity;
    for (const c of candidatos) {
      const d = Math.abs(alturaParada(c) - projetado);
      if (d < dist) { dist = d; melhor = c; }
    }
    if (melhor === 'fechada') { estado = 'fechada'; aplicar(); aoFechar?.(); return; }
    ir(melhor);
  };
  puxador.addEventListener('pointerup', soltar);
  puxador.addEventListener('pointercancel', soltar);
  puxador.addEventListener('click', (e) => {
    if (arrastou) { arrastou = false; e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (!ativo()) return;
    if (aoTocar) { aoTocar(e); return; }
    if (modo === 'paradas') {
      // toque alterna entre a parada mais baixa e o meio (ou a cheia, se não houver meio)
      const baixa = paradas[0];
      const alvo = paradas.includes('meio') ? 'meio' : paradas[paradas.length - 1];
      ir(estado === baixa || estado === 'fechada' ? alvo : baixa);
    }
  });

  addEventListener('resize', () => { medirAreaSegura(); aplicar(false); });
  aoMudarMobile(() => aplicar(false));
  medirAreaSegura();
  aplicar(false);

  return { ir, estado: () => estado, visivel, ativo, reaplicar: () => aplicar(false) };
}
