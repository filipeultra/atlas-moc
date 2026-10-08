// Menu de configurações: desenhado a partir de um esquema; cada mudança vira um parcial da config.
import { icone } from '../icones-ui.js';
import { $, esc } from './util.js';

export const GRUPOS = [
  {
    titulo: 'Mapa', icone: 'mapa', itens: [
      { chave: 'icones', tipo: 'seg', rotulo: 'Ícones dos imóveis', icone: 'cubo', opcoes: [['3d', '3D'], ['pinos', 'Pinos'], ['ocultos', 'Ocultar']] },
      { chave: 'visao', tipo: 'seg', rotulo: 'Visão', icone: 'camadas', opcoes: [['3d', '3D'], ['2d', '2D']] },
      { chave: 'prediosCidade', tipo: 'sw', rotulo: 'Prédios da cidade em 3D', icone: 'predio' },
      { chave: 'nomesRuas', tipo: 'sw', rotulo: 'Nomes de ruas', icone: 'rua' },
      { chave: 'nomesBairros', tipo: 'sw', rotulo: 'Nomes de bairros', icone: 'pin' },
      { chave: 'pontosInteresse', tipo: 'sw', rotulo: 'Pontos de interesse', icone: 'poi' },
      { chave: 'etiquetasPreco', tipo: 'sw', rotulo: 'Etiquetas de preço', icone: 'etiqueta' },
      { chave: 'agrupar', tipo: 'sw', rotulo: 'Agrupar imóveis próximos', icone: 'agrupar' },
    ],
  },
  {
    titulo: 'Movimento e desempenho', icone: 'desempenho', itens: [
      { chave: 'animacoes', tipo: 'sw', rotulo: 'Animações', icone: 'animacao', ajuda: 'Pulso dos círculos e giro dos ícones 3D. Desligado, o mapa só redesenha quando você mexe.' },
      { chave: 'qualidade', tipo: 'seg', rotulo: 'Qualidade', icone: 'desempenho', opcoes: [['auto', 'Automática'], ['alta', 'Alta'], ['equilibrada', 'Equilibrada'], ['economica', 'Econômica']], ajudaDinamica: true },
      { chave: 'medidor', tipo: 'sw', rotulo: 'Mostrar medidor de desempenho', icone: 'desempenho' },
    ],
  },
  {
    titulo: 'Interface', icone: 'tema', itens: [
      { chave: 'tema', tipo: 'seg', rotulo: 'Tema', icone: 'tema', opcoes: [['escuro', 'Escuro'], ['claro', 'Claro'], ['auto', 'Automático']] },
    ],
  },
];

const NOME_QUALIDADE = { alta: 'Alta', equilibrada: 'Equilibrada', economica: 'Econômica' };

function htmlItem(it) {
  const id = `cfg-${it.chave}`;
  // switch: o rótulo é <label for> e a linha inteira liga e desliga (alvo de toque maior que os 50 px do switch)
  const cab = it.tipo === 'sw'
    ? `<label class="cfg-rot" id="${id}-rot" for="${id}">${icone(it.icone, { tamanho: 16 })}${esc(it.rotulo)}</label>`
    : `<span class="cfg-rot" id="${id}-rot">${icone(it.icone, { tamanho: 16 })}${esc(it.rotulo)}</span>`;
  const ajuda = it.ajuda || it.ajudaDinamica ? `<small class="cfg-ajuda" id="${id}-ajuda">${esc(it.ajuda || '')}</small>` : '';
  if (it.tipo === 'sw') {
    return `<div class="cfg-item cfg-sw">${cab}
      <button class="switch" type="button" role="switch" id="${id}" aria-checked="false" data-chave="${it.chave}" aria-labelledby="${id}-rot"${ajuda ? ` aria-describedby="${id}-ajuda"` : ''}><span></span></button>${ajuda}</div>`;
  }
  return `<div class="cfg-item cfg-seg">${cab}
    <div class="seg seg-cheio" role="radiogroup" aria-labelledby="${id}-rot">
      ${it.opcoes.map(([v, n]) => `<button type="button" role="radio" aria-checked="false" data-chave="${it.chave}" data-valor="${v}">${esc(n)}</button>`).join('')}
    </div>${ajuda}</div>`;
}

export function criarPainelConfig({ el, botao, aoMudar, aoRestaurar, aoAtalhos, aoInstalar, qualidadeEfetiva, aoAbrirFechar }) {
  let aberto = false;
  el.innerHTML = `
    <button class="puxador" type="button" aria-label="Arraste para baixo para fechar"><span></span></button>
    <div class="pop-cab">
      <h2 id="cfg-titulo">${icone('config', { tamanho: 18 })}Configurações</h2>
      <button class="ic-btn" type="button" data-cfg="fechar" aria-label="Fechar configurações" title="Fechar (Esc)">${icone('fechar', { tamanho: 18 })}</button>
    </div>
    <div class="pop-corpo">
      ${GRUPOS.map((g) => `<section class="cfg-grupo" aria-labelledby="cfg-g-${g.icone}"><h3 id="cfg-g-${g.icone}">${esc(g.titulo)}</h3>${g.itens.map(htmlItem).join('')}
        ${g.titulo === 'Interface' ? `<div class="cfg-item cfg-sw"><span class="cfg-rot">${icone('teclado', { tamanho: 16 })}Atalhos de teclado</span><button class="btn btn-p" type="button" data-cfg="atalhos">Ver atalhos <kbd>?</kbd></button></div>` : ''}
      </section>`).join('')}
      <section class="cfg-grupo" aria-labelledby="cfg-g-app"><h3 id="cfg-g-app">App</h3>
        <div class="cfg-item cfg-sw"><span class="cfg-rot">${icone('instalar', { tamanho: 16 })}Instalar no aparelho</span>
          <button class="btn btn-p" type="button" data-cfg="instalar" disabled>Instalar</button>
          <small class="cfg-ajuda" id="cfg-instalar-ajuda"></small></div>
        <div class="cfg-item"><span class="cfg-rot">${icone('check', { tamanho: 16 })}Modo offline</span>
          <small class="cfg-ajuda cfg-estado" id="cfg-sw-estado">Verificando…</small></div>
      </section>
      <div class="cfg-rodape">
        <button class="btn" type="button" data-cfg="restaurar">Restaurar padrão</button>
      </div>
    </div>`;

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !el.contains(b)) return;
    if (b.dataset.cfg === 'fechar') return fechar();
    if (b.dataset.cfg === 'restaurar') return aoRestaurar?.();
    if (b.dataset.cfg === 'atalhos') { fechar(); return aoAtalhos?.(); }
    if (b.dataset.cfg === 'instalar') return aoInstalar?.();
    const k = b.dataset.chave;
    if (!k) return;
    if (b.getAttribute('role') === 'switch') aoMudar?.({ [k]: b.getAttribute('aria-checked') !== 'true' });
    else if (b.dataset.valor) aoMudar?.({ [k]: b.dataset.valor });
  });
  // setas dentro de um grupo de rádio movem a escolha (padrão ARIA de radiogroup)
  el.addEventListener('keydown', (e) => {
    const b = e.target.closest('[role="radio"]');
    if (!b || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const irmaos = [...b.parentElement.querySelectorAll('[role="radio"]')];
    const i = irmaos.indexOf(b) + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
    const alvo = irmaos[(i + irmaos.length) % irmaos.length];
    e.preventDefault();
    alvo.focus();
    alvo.click();
  });

  function sincronizar(cfg) {
    for (const b of el.querySelectorAll('[role="switch"][data-chave]')) b.setAttribute('aria-checked', String(Boolean(cfg[b.dataset.chave])));
    for (const b of el.querySelectorAll('[role="radio"][data-chave]')) {
      const sel = cfg[b.dataset.chave] === b.dataset.valor;
      b.setAttribute('aria-checked', String(sel));
      b.tabIndex = sel ? 0 : -1;
    }
    const aj = $('#cfg-qualidade-ajuda', el);
    if (aj) {
      const ef = qualidadeEfetiva?.(cfg.qualidade);
      aj.textContent = cfg.qualidade === 'auto' && ef ? `Neste aparelho: ${NOME_QUALIDADE[ef] || ef}.` : 'Econômica desliga sombras e brilho no prédio.';
    }
  }

  /** app: { instalar: 'pronto'|'ios'|'instalado'|'indisponivel', sw: { estado, detalhe } } */
  function atualizarApp({ instalar, sw }) {
    const bt = $('[data-cfg="instalar"]', el), aj = $('#cfg-instalar-ajuda', el);
    if (instalar) {
      bt.disabled = instalar !== 'pronto';
      bt.hidden = instalar === 'ios' || instalar === 'instalado';
      aj.textContent = {
        pronto: 'Abre como app, em tela cheia, com ícone na tela inicial.',
        ios: 'No iPhone: toque em Compartilhar e depois em Adicionar à Tela de Início.',
        instalado: 'Você já está usando o app instalado.',
        indisponivel: 'Este navegador não ofereceu a instalação. No Chrome ou Edge, use o menu do navegador.',
      }[instalar] || '';
    }
    if (sw) {
      const s = $('#cfg-sw-estado', el);
      s.textContent = sw.detalhe;
      s.dataset.estado = sw.estado;
    }
  }

  function abrir() {
    aberto = true;
    el.classList.add('aberto');
    el.inert = false;
    el.setAttribute('aria-hidden', 'false');
    botao.setAttribute('aria-expanded', 'true');
    aoAbrirFechar?.(true);
    requestAnimationFrame(() => $('[role="switch"], [role="radio"][tabindex="0"]', el)?.focus({ preventScroll: true }));
  }
  function fechar({ devolverFoco = true } = {}) {
    if (!aberto) return;
    aberto = false;
    el.classList.remove('aberto');
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
    botao.setAttribute('aria-expanded', 'false');
    aoAbrirFechar?.(false);
    if (devolverFoco && el.contains(document.activeElement)) botao.focus({ preventScroll: true });
  }
  el.inert = true;
  el.setAttribute('aria-hidden', 'true');
  botao.setAttribute('aria-expanded', 'false');
  botao.addEventListener('click', () => (aberto ? fechar() : abrir()));

  return { abrir, fechar, aberto: () => aberto, sincronizar, atualizarApp, puxador: $('.puxador', el) };
}
