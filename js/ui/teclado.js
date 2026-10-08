// Atalhos de teclado e o overlay que os lista.
import { icone } from '../icones-ui.js';
import { $, esc, focoEmCampo } from './util.js';

export const PASSO_GIRO = 15;      // graus por toque em Q/E
export const PASSO_INCLINA = 10;   // graus por toque em T/G

export const ATALHOS = [
  { teclas: ['Espaço', 'arrastar'], icone: 'girar', desc: 'Orbitar: segure Espaço e arraste com o botão esquerdo ou direito' },
  { teclas: ['Q', 'E'], icone: 'girar', desc: `Girar ${PASSO_GIRO}° para a esquerda ou direita` },
  { teclas: ['T', 'G'], icone: 'camera', desc: 'Inclinar a câmera para cima ou para baixo' },
  { teclas: ['N'], icone: 'bussola', desc: 'Voltar para o norte (no prédio: fachada de frente)' },
  { teclas: ['2', '3'], icone: 'plano', desc: 'Mapa em 2D ou 3D' },
  { teclas: ['S'], icone: 'sol', desc: 'Abrir ou fechar o controle de sol' },
  { teclas: ['L'], icone: 'lista', desc: 'Mostrar ou recolher a lista (no prédio, o espelho)' },
  { teclas: ['/'], icone: 'busca', desc: 'Ir para a busca' },
  { teclas: ['?'], icone: 'teclado', desc: 'Mostrar esta lista de atalhos' },
  { teclas: ['Esc'], icone: 'fechar', desc: 'Fechar o que estiver aberto' },
];

/** acoes: { girar(d), inclinar(d), norte(), visao(v), sol(), lista(), busca(), atalhos(), esc() } */
export function instalarTeclado(acoes) {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (e.key === 'Escape') {
      if (focoEmCampo()) { document.activeElement.blur(); return; }
      if (acoes.esc()) e.preventDefault();
      return;
    }
    if (focoEmCampo()) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const unico = (fn) => { if (!e.repeat) fn(); e.preventDefault(); };
    switch (k) {
      case 'q': acoes.girar(-PASSO_GIRO); e.preventDefault(); break;
      case 'e': acoes.girar(PASSO_GIRO); e.preventDefault(); break;
      case 't': acoes.inclinar(PASSO_INCLINA); e.preventDefault(); break;
      case 'g': acoes.inclinar(-PASSO_INCLINA); e.preventDefault(); break;
      case 'n': unico(acoes.norte); break;
      case '2': unico(() => acoes.visao('2d')); break;
      case '3': unico(() => acoes.visao('3d')); break;
      case 's': unico(acoes.sol); break;
      case 'l': unico(acoes.lista); break;
      case '/': unico(acoes.busca); break; // preventDefault: o Firefox abriria a busca rápida
      case '?': unico(acoes.atalhos); break;
      default: break;
    }
  });
}

export function criarOverlayAtalhos({ el }) {
  let aberto = false;
  let focoAnterior = null;
  el.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="atalhos-titulo">
      <div class="pop-cab">
        <h2 id="atalhos-titulo">${icone('teclado', { tamanho: 18 })}Atalhos de teclado</h2>
        <button class="ic-btn" type="button" data-fechar aria-label="Fechar atalhos" title="Fechar (Esc)">${icone('fechar', { tamanho: 18 })}</button>
      </div>
      <ul class="atalhos">
        ${ATALHOS.map((a) => `<li>${icone(a.icone, { tamanho: 16, classe: 'atalho-ic' })}<span class="atalho-desc">${esc(a.desc)}</span>
          <span class="teclas">${a.teclas.map((t) => (t === 'arrastar' ? '<span class="mais-tecla">+ arrastar</span>' : `<kbd>${esc(t)}</kbd>`)).join('')}</span></li>`).join('')}
      </ul>
      <p class="nota">Os atalhos ficam desligados enquanto você digita num campo.</p>
    </div>`;
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-fechar]')) fechar(); });
  // prende o Tab dentro do diálogo
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focaveis = [...el.querySelectorAll('button')];
    if (!focaveis.length) return;
    const [pri, ult] = [focaveis[0], focaveis[focaveis.length - 1]];
    if (e.shiftKey && document.activeElement === pri) { e.preventDefault(); ult.focus(); }
    else if (!e.shiftKey && document.activeElement === ult) { e.preventDefault(); pri.focus(); }
  });
  function abrir() {
    aberto = true;
    focoAnterior = document.activeElement;
    el.hidden = false;
    $('[data-fechar]', el).focus();
  }
  function fechar() {
    if (!aberto) return;
    aberto = false;
    el.hidden = true;
    if (focoAnterior?.isConnected) focoAnterior.focus({ preventScroll: true });
  }
  return { abrir, fechar, aberto: () => aberto, alternar: () => (aberto ? fechar() : abrir()) };
}
