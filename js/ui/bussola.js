// Bússola própria (substitui o NavigationControl do MapLibre) e controles de câmera do prédio.
import { icone } from '../icones-ui.js';

// agulha: metade norte no acento, metade sul neutra; "N" acima
const AGULHA = `<svg class="agulha" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
  <path d="M12 2.5 15 12h-6z" class="agulha-n"/><path d="M9 12h6l-3 9.5z" class="agulha-s"/></svg>`;

export function criarBussolaCidade({ el, aoNorte, aoZoom, aoVisao }) {
  el.innerHTML = `
    <button type="button" class="bus-btn bus-norte" data-b="norte" aria-label="Apontar para o norte" title="Norte (N)">${AGULHA}<span class="bus-n" aria-hidden="true">N</span></button>
    <span class="bus-sep" aria-hidden="true"></span>
    <button type="button" class="bus-btn" data-b="mais" aria-label="Aproximar" title="Aproximar">${icone('mais', { tamanho: 18 })}</button>
    <button type="button" class="bus-btn" data-b="menos" aria-label="Afastar" title="Afastar">${icone('menos', { tamanho: 18 })}</button>
    <span class="bus-sep" aria-hidden="true"></span>
    <button type="button" class="bus-btn bus-visao" data-b="visao" aria-label="Mudar para visão 2D" title="Visão 2D (2)"><span>2D</span></button>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-b]');
    if (!b) return;
    if (b.dataset.b === 'norte') aoNorte();
    else if (b.dataset.b === 'mais') aoZoom(1);
    else if (b.dataset.b === 'menos') aoZoom(-1);
    else if (b.dataset.b === 'visao') aoVisao();
  });
  const agulha = el.querySelector('.bus-norte');
  let pendente = null;
  return {
    atualizarCamera({ bearing = 0, pitch = 0 } = {}) {
      // vários eventos por quadro durante um voo: escreve no DOM uma vez por quadro
      if (pendente) { pendente.bearing = bearing; pendente.pitch = pitch; return; }
      pendente = { bearing, pitch };
      requestAnimationFrame(() => {
        const { bearing: b, pitch: p } = pendente;
        pendente = null;
        agulha.style.setProperty('--bearing', `${-b}deg`);
        agulha.style.setProperty('--pitch', `${Math.min(p, 70)}deg`);
        agulha.classList.toggle('fora-do-norte', Math.abs(((b % 360) + 540) % 360 - 180) > 0.5);
      });
    },
    atualizarVisao(visao) {
      const b = el.querySelector('[data-b="visao"]');
      const alvo = visao === '2d' ? '3D' : '2D';
      b.querySelector('span').textContent = alvo;
      b.setAttribute('aria-label', `Mudar para visão ${alvo}`);
      b.title = `Visão ${alvo} (${alvo[0]})`;
    },
  };
}

export function criarBussolaPredio({ el, aoNorte, aoGirar }) {
  el.innerHTML = `
    <button type="button" class="bus-btn" data-b="esq" aria-label="Girar 15 graus para a esquerda" title="Girar 15° (Q)">${icone('esq', { tamanho: 18 })}</button>
    <button type="button" class="bus-btn bus-norte" data-b="norte" aria-label="Fachada de frente" title="Fachada de frente (N)">${icone('bussola', { tamanho: 20 })}</button>
    <button type="button" class="bus-btn" data-b="dir" aria-label="Girar 15 graus para a direita" title="Girar 15° (E)">${icone('dir', { tamanho: 18 })}</button>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-b]');
    if (!b) return;
    if (b.dataset.b === 'norte') aoNorte();
    else if (b.dataset.b === 'esq') aoGirar(-15);
    else if (b.dataset.b === 'dir') aoGirar(15);
  });
  return {};
}
