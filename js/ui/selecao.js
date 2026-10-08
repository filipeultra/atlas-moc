// Seleção do cliente: imóveis e lançamentos marcados com coração, persistidos no aparelho,
// compartilháveis por link #/selecao/ID,ID,L:lancamento.
import { icone } from '../icones-ui.js';
import { $, esc, aviso } from './util.js';

export const CHAVE_SELECAO = 'atlas-moc:selecao:v1';
const ID_SEGURO = /^[A-Za-z0-9:_-]+$/;

/** ids → hash da rota de seleção. Ids comuns (MC-1001, L:serra-azul) vão sem escape, como no contrato. */
export function hashSelecao(ids) {
  return `#/selecao/${ids.map((id) => (ID_SEGURO.test(id) ? id : encodeURIComponent(id))).join(',')}`;
}

export const CHAVE_SELECAO_REAL = 'atlas-moc:selecao:real:v1'; // anúncios reais têm outros ids: seleção à parte

export function criarLojaSelecao({ aoMudar, chave = CHAVE_SELECAO } = {}) {
  let ids = [];
  const ler = () => {
    ids = [];
    try {
      const bruto = localStorage.getItem(chave);
      if (bruto) {
        const v = JSON.parse(bruto);
        if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new Error('formato inesperado');
        ids = v;
      }
    } catch (err) {
      console.error('[selecao]', err);
      aviso(`Não consegui ler a seleção salva (${err.message}). Começando vazia.`, 'erro');
    }
  };
  ler();
  const salvar = () => {
    try { localStorage.setItem(chave, JSON.stringify(ids)); }
    catch (err) {
      console.error('[selecao]', err);
      aviso(`Não consegui salvar a seleção neste aparelho (${err.message}). Ela vale até fechar a página.`, 'erro');
    }
    aoMudar?.(ids.slice());
  };
  return {
    ids: () => ids.slice(),
    tem: (id) => ids.includes(id),
    alternar(id) { ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]; salvar(); return ids.includes(id); },
    adicionar(novos) { const antes = ids.length; ids = [...new Set([...ids, ...novos])]; salvar(); return ids.length - antes; },
    remover(id) { ids = ids.filter((x) => x !== id); salvar(); },
    definir(lista) { ids = [...new Set(lista)]; salvar(); },
    limpar() { const antes = ids; ids = []; salvar(); return antes; },
    // troca de modo de dados (ex.: os reais não abriram e o app voltou à demonstração)
    usarChave(nova) { if (nova === chave) return; chave = nova; ler(); aoMudar?.(ids.slice()); },
    chave: () => chave,
  };
}

/**
 * Painel da seleção. descrever(id) → { titulo, sub, preco, finalidade, tipo, hash } | null.
 * recebida: ids que chegaram pela rota (o cliente abrindo o link), mostrados à parte.
 */
export function criarPainelSelecao({ el, botao, loja, descrever, compartilhavel, aoCompartilhar, aoAlternarSoSelecao, soSelecaoAtiva, aoAbrirFechar }) {
  let aberto = false;
  let recebida = null;

  function linhaItem(id, removivel) {
    const d = descrever(id);
    if (!d) return '';
    return `<li class="sel-item">
      <a class="sel-link" href="${esc(d.hash)}">
        <span class="sel-thumb ${esc(d.finalidade)}">${icone(d.tipo, { tamanho: 18 })}</span>
        <span class="sel-info"><b>${esc(d.titulo)}</b><small>${esc(d.sub)}</small><span class="sel-preco">${esc(d.preco)}</span></span>
      </a>
      ${removivel ? `<button class="ic-btn coracao" type="button" aria-pressed="true" data-remover="${esc(id)}" aria-label="Tirar ${esc(d.titulo)} da seleção" title="Tirar da seleção">${icone('coracao', { tamanho: 18 })}</button>` : ''}
    </li>`;
  }

  function render() {
    const meus = loja.ids();
    const n = meus.length;
    botao.querySelector('.contador').textContent = String(n);
    botao.querySelector('.contador').hidden = n === 0;
    botao.setAttribute('aria-label', `Seleção do cliente: ${n} ${n === 1 ? 'item' : 'itens'}`);
    if (!aberto) return; // não desenha o que não está à vista
    const so = soSelecaoAtiva();
    const blocoRecebida = recebida?.length ? `
      <div class="sel-recebida">
        <p>${icone('link', { tamanho: 16 })}<span><b>Seleção recebida por link</b> · ${recebida.length} ${recebida.length === 1 ? 'imóvel' : 'imóveis'}</span></p>
        <ul class="sel-lista">${recebida.map((id) => linhaItem(id, false)).join('')}</ul>
        <button class="btn" type="button" data-sel="guardar">${icone('coracao', { tamanho: 16 })}Guardar na minha seleção</button>
      </div>` : '';
    const lista = n
      ? `<ul class="sel-lista">${meus.map((id) => linhaItem(id, true)).join('')}</ul>`
      : `<div class="sel-vazia">${icone('coracao', { tamanho: 28 })}<p>Toque no coração de um imóvel ou lançamento para montar a seleção do cliente.</p></div>`;
    $('.pop-corpo', el).innerHTML = `${blocoRecebida}
      ${recebida?.length ? '<h3 class="sel-sub">Minha seleção</h3>' : ''}
      ${lista}
      <div class="sel-acoes">
        ${compartilhavel()
    ? `<button class="btn prim" type="button" data-sel="compartilhar" ${n ? '' : 'disabled'}>${icone('compartilhar', { tamanho: 16 })}Compartilhar seleção</button>
          <button class="btn" type="button" data-sel="copiar" ${n ? '' : 'disabled'}>${icone('copiar', { tamanho: 16 })}Copiar link da seleção</button>`
    : `<div class="lado">
          <button class="btn zap" type="button" data-sel="whatsapp" ${n ? '' : 'disabled'}>${icone('whatsapp', { tamanho: 16 })}Enviar no WhatsApp</button>
          <button class="btn" type="button" data-sel="copiar" ${n ? '' : 'disabled'}>${icone('copiar', { tamanho: 16 })}Copiar link</button></div>`}
        <div class="cfg-item cfg-sw"><label class="cfg-rot" id="sel-so-rot" for="sel-so">${icone('filtro', { tamanho: 16 })}Mostrar só a seleção no mapa</label>
          <button class="switch" type="button" role="switch" id="sel-so" aria-checked="${so}" aria-labelledby="sel-so-rot" data-sel="so" ${n || so ? '' : 'disabled'}><span></span></button></div>
        <button class="btn btn-perigo" type="button" data-sel="limpar" ${n ? '' : 'disabled'}>${icone('limpar', { tamanho: 16 })}Limpar seleção</button>
      </div>`;
  }

  el.innerHTML = `
    <button class="puxador" type="button" aria-label="Arraste para baixo para fechar"><span></span></button>
    <div class="pop-cab">
      <h2>${icone('coracao', { tamanho: 18 })}Seleção do cliente</h2>
      <button class="ic-btn" type="button" data-sel="fechar" aria-label="Fechar seleção" title="Fechar (Esc)">${icone('fechar', { tamanho: 18 })}</button>
    </div>
    <div class="pop-corpo"></div>`;

  el.addEventListener('click', (e) => {
    // Abrir um item fecha o painel: senão a ficha abre escondida atrás dele (desktop) ou sob o véu (mobile).
    // O hash do link segue normalmente.
    if (e.target.closest('.sel-link')) { fechar(); return; }
    const b = e.target.closest('button');
    if (!b || !el.contains(b)) return;
    if (b.dataset.remover) {
      const id = b.dataset.remover;
      loja.remover(id);
      aviso('Tirado da seleção.', 'ok', { acao: { rotulo: 'Desfazer', fn: () => loja.adicionar([id]) } });
      return;
    }
    const a = b.dataset.sel;
    if (a === 'fechar') fechar();
    else if (a === 'guardar') {
      const novos = loja.adicionar(recebida || []);
      aviso(novos ? `${novos} ${novos === 1 ? 'item guardado' : 'itens guardados'} na sua seleção.` : 'Esses itens já estavam na sua seleção.', 'ok');
    } else if (a === 'compartilhar' || a === 'whatsapp' || a === 'copiar') aoCompartilhar?.(a);
    else if (a === 'so') aoAlternarSoSelecao?.(b.getAttribute('aria-checked') !== 'true');
    else if (a === 'limpar') {
      const antes = loja.limpar();
      aviso('Seleção limpa.', 'ok', { acao: { rotulo: 'Desfazer', fn: () => loja.definir(antes) } });
    }
  });

  function abrir() {
    aberto = true;
    el.classList.add('aberto');
    el.inert = false;
    el.setAttribute('aria-hidden', 'false');
    botao.setAttribute('aria-expanded', 'true');
    render();
    aoAbrirFechar?.(true);
  }
  function fechar() {
    if (!aberto) return;
    aberto = false;
    el.classList.remove('aberto');
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
    botao.setAttribute('aria-expanded', 'false');
    if (el.contains(document.activeElement)) botao.focus({ preventScroll: true });
    aoAbrirFechar?.(false);
  }
  el.inert = true;
  el.setAttribute('aria-hidden', 'true');
  botao.setAttribute('aria-expanded', 'false');
  botao.addEventListener('click', () => (aberto ? fechar() : abrir()));

  return {
    abrir, fechar, aberto: () => aberto, render,
    receber(ids) { recebida = ids; render(); },
    recebida: () => recebida,
    puxador: $('.puxador', el),
  };
}
