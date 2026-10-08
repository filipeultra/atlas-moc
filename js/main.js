// Orquestra: dados, rotas (#/...), filtros, lista, fichas, sol, configurações e as duas vistas 3D.
// predio.js só entra por import dinâmico (a cidade abre sem baixar a cena do prédio).
import { fmtReais, fmtArea, fmtCurto, fmtData } from './fluxo.js';
import { criarCidade } from './cidade.js';
import { icone } from './icones-ui.js';
import { fatorDia, LIMIAR_NOITE } from './sol.js';
import { carregarConfig, salvarConfig, resolverQualidade, padraoDoAparelho, configResolvida } from './config.js';
import { $, $$, esc, semAcento, ehMobile, aoMudarMobile, aviso, copiar, temShareNativo, compartilharNativo, linkWhatsApp, linkAbsoluto } from './ui/util.js';
import {
  TIPOS, NOME_TIPO, NOME_STATUS, NOME_FIN, resumoLanc, botaoCoracao,
  htmlImovel, htmlLancamento, htmlUnidade, htmlInsolacao, textoImovel, textoLancamento, textoUnidade, pctDia,
} from './ui/fichas.js';
import { criarFolha } from './ui/folha.js';
import { criarPainelSol } from './ui/sol-painel.js';
import { criarPainelConfig } from './ui/config-painel.js';
import { criarLojaSelecao, criarPainelSelecao, hashSelecao, CHAVE_SELECAO, CHAVE_SELECAO_REAL } from './ui/selecao.js';
import { MODOS_DADOS, lerModoSalvo, salvarModo, resolverModoDados, urlDoModo, htmlControleModo } from './ui/modo-dados.js';
import {
  URL_REAL, normalizarReal, valorReal, rotuloPrecoReal, quartosReal, areaReal, dataReal, textoBuscaReal,
  htmlThumbReal, metaCardReal, htmlImovelReal, textoImovelReal, resumoMeta,
} from './ui/real.js';
import { instalarTeclado, criarOverlayAtalhos } from './ui/teclado.js';
import { criarBussolaCidade, criarBussolaPredio } from './ui/bussola.js';
import { criarMedidor } from './ui/medidor.js';
import { iniciarPWA } from './ui/pwa.js';

// ícones do HTML estático: <span data-icone="nome" data-tam="16" data-classe="x"> vira o SVG do icone()
for (const el of $$('[data-icone]')) {
  el.outerHTML = icone(el.dataset.icone, { tamanho: Number(el.dataset.tam) || 16, classe: el.dataset.classe || '' });
}

// ------------------------------------------------------------------ fonte dos dados (demonstração ou anúncios reais)
// Decidida antes de tudo: a seleção do cliente e os links dependem dela. ?dados=real na URL manda.
const MODO = resolverModoDados({ search: location.search, hash: location.hash, salvo: lerModoSalvo({ aoErro: (m) => aviso(m, 'erro') }) });
if (MODO.aviso) aviso(MODO.aviso, 'erro');
if (MODO.modo === 'real' && new URLSearchParams(location.search).get('dados') !== 'real') {
  // escolha salva no aparelho: a URL passa a dizer o modo (recarregar e compartilhar mantêm)
  history.replaceState(history.state, '', urlDoModo(location.href, 'real'));
}

// larguras dos painéis no desktop (px): o voo e o enquadramento descontam o que eles cobrem
const LARG_PAINEL_ESQ = 364;
const LARG_GAVETA = 404;
const MARGEM = 40;

// ------------------------------------------------------------------ erros globais (nunca falha silenciosa)
window.addEventListener('error', (e) => { console.error(e.error || e.message); aviso(`${e.message}`, 'erro'); });
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); aviso(e.reason?.message || String(e.reason), 'erro'); });

/** Chama uma API de módulo 3D: erro síncrono ou Promise rejeitada vira aviso específico. */
function seguro(rotulo, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') r.catch((err) => { console.error(`[${rotulo}]`, err); aviso(`${rotulo}: ${err.message}`, 'erro'); });
    return r;
  } catch (err) {
    console.error(`[${rotulo}]`, err);
    aviso(`${rotulo}: ${err.message}`, 'erro');
    return undefined;
  }
}

// ------------------------------------------------------------------ estado
const S = {
  imoveis: [], corretores: {}, lancamentos: [], lancPorId: {}, imovelPorId: {}, itens: [], itemPorId: {},
  filtros: { fin: 'todos', tipos: new Set(), bairro: '', quartos: 0, preco: 100, busca: '', ordem: 'recente' },
  filtroIds: null, filtroOrigem: null, // seleção aplicada como filtro: 'minha' | 'link'
  selCidade: null, lancAtual: null, unidadeSel: null, tipologiasPredio: new Set(), andarDestacado: null,
  origemClique: null, // '3d' quando a seleção veio de clique na cena (não refoca a câmera)
  modoPredio: 'comercial', luzPredio: 'noite', vista: 'cidade',
  cfg: carregarConfig({ aoErro: (m) => aviso(m, 'erro') }),
  sol: { dataISO: null, minutos: null, pos: null },
  cidade: null, predio: null, predioCarregado: false,
  modoDados: MODO.modo, motivoReal: '', // motivoReal: por que os anúncios reais não abriram (volta à demonstração)
};

const estadoLuz = () => {
  if (S.predio) {
    try { return S.predio.estadoLuz(); } catch (err) { console.error('[predio.estadoLuz]', err); }
  }
  // mesma regra do predio.js: fatorDia < LIMIAR_NOITE é noite
  return S.sol.pos && fatorDia(S.sol.pos.elevacao) < LIMIAR_NOITE ? 'noite' : 'dia';
};

// ------------------------------------------------------------------ tema
const mqEscuro = matchMedia('(prefers-color-scheme: dark)');
function aplicarTema() {
  const t = S.cfg.tema === 'auto' ? (mqEscuro.matches ? 'escuro' : 'claro') : S.cfg.tema;
  document.documentElement.dataset.tema = t;
  $('meta[name="theme-color"]')?.setAttribute('content', t === 'escuro' ? '#070d1f' : '#f5f5f7');
}
mqEscuro.addEventListener('change', () => { if (S.cfg.tema === 'auto') aplicarTema(); });
aplicarTema();
document.documentElement.classList.toggle('sem-animacao', !S.cfg.animacoes);

// ------------------------------------------------------------------ preço e filtros
function precoRef(item) {
  if (item.real) return valorReal(item.ref); // null = sob consulta
  if (item.tipo === 'lancamento') return (resumoLanc(item.ref).aPartir ?? 0) / 100;
  return item.ref.preco ?? item.ref.aluguel;
}

function limitePreco() {
  const v = S.filtros.preco;
  if (v >= 100) return null;
  const k = (v / 100) ** 2;
  return S.filtros.fin === 'locacao' ? Math.round((500 + k * 11500) / 50) * 50 : Math.round((100000 + k * 2900000) / 10000) * 10000;
}

function passaFiltro(item) {
  const f = S.filtros, r = item.ref;
  if (S.filtroIds && !S.filtroIds.has(item.id)) return false;
  if (f.fin !== 'todos' && item.finalidade !== f.fin) return false;
  if (f.tipos.size && !f.tipos.has(item.tipo)) return false;
  if (f.bairro && r.bairro !== f.bairro) return false;
  if (f.quartos) {
    if (item.real) { if (quartosReal(r) < f.quartos) return false; }
    else if (item.tipo === 'lancamento') { if (!Object.values(r.tipologias).some((t) => t.quartos >= f.quartos)) return false; }
    else if ((r.quartos || 0) < f.quartos) return false;
  }
  const lim = limitePreco();
  if (lim !== null) {
    const ehAluguel = item.finalidade === 'locacao';
    const p = precoRef(item); // anúncio sem preço (sob consulta) sai quando há teto de preço
    if (f.fin === 'locacao' ? ehAluguel && (p === null || p > lim) : !ehAluguel && (p === null || p > lim)) return false;
  }
  if (f.busca) {
    const alvo = item.textoBusca;
    if (!semAcento(f.busca).split(/\s+/).every((p) => alvo.includes(p))) return false;
  }
  return true;
}

const areaItem = (it) => (it.real ? areaReal(it.ref) : it.ref.area_m2) || 0;
const dataItem = (it) => String((it.real ? dataReal(it.ref) : it.ref.atualizado_em) || '');
// preço desconhecido (sob consulta) vai para o fim nas duas ordens
const porPreco = (dir) => (a, b) => {
  const pa = precoRef(a), pb = precoRef(b);
  if (pa === null || pb === null) return (pa === null) - (pb === null);
  return dir * (pa - pb);
};

function ordenar(lista) {
  const o = S.filtros.ordem;
  const c = [...lista];
  if (o === 'menor') c.sort(porPreco(1));
  else if (o === 'maior') c.sort(porPreco(-1));
  else if (o === 'area') c.sort((a, b) => areaItem(b) - areaItem(a));
  else c.sort((a, b) => (b.tipo === 'lancamento') - (a.tipo === 'lancamento') || dataItem(b).localeCompare(dataItem(a)));
  return c;
}

let filtroAgendado = false;
function aplicarFiltros() {
  // vários eventos no mesmo quadro (digitação rápida, slider) viram uma renderização
  if (filtroAgendado) return;
  filtroAgendado = true;
  requestAnimationFrame(() => { filtroAgendado = false; aplicarFiltrosAgora(); });
}
function aplicarFiltrosAgora() {
  const visiveis = S.itens.filter(passaFiltro);
  if (S.cidade) seguro('Mapa (filtro)', () => S.cidade.filtrar(new Set(visiveis.map((i) => i.id))));
  const n = visiveis.length;
  const rotN = `${n} ${n === 1 ? 'imóvel' : 'imóveis'}`;
  $('#contagem').textContent = rotN;
  $('#alca-texto').textContent = `${rotN} · ver lista`;
  $('#abrir-lista .rot').textContent = rotN;
  const lim = limitePreco();
  const rot = S.filtros.fin === 'locacao' ? 'Aluguel' : 'Venda';
  $('#f-preco-out').textContent = lim === null ? 'sem limite' : `${rot} até ${fmtReais(lim)}`;
  const ativos = contarFiltrosAtivos();
  $('#limpar-filtros').hidden = !ativos;
  $('#faixa-selecao').hidden = !S.filtroIds;
  if (S.filtroIds) {
    $('#faixa-selecao-txt').textContent = S.filtroOrigem === 'link'
      ? `Seleção recebida por link · ${S.filtroIds.size}`
      : `Só a seleção do cliente · ${S.filtroIds.size}`;
  }
  renderLista(ordenar(visiveis));
}

function contarFiltrosAtivos() {
  const f = S.filtros;
  return (f.fin !== 'todos') + f.tipos.size + Boolean(f.bairro) + Boolean(f.quartos) + (f.preco < 100) + Boolean(f.busca);
}

function limparFiltros() {
  Object.assign(S.filtros, { fin: 'todos', tipos: new Set(), bairro: '', quartos: 0, preco: 100, busca: '' });
  $('#f-busca').value = '';
  $('#f-bairro').value = '';
  $('#f-quartos').value = '0';
  $('#f-preco').value = '100';
  $$('#f-tipos [data-tipo]').forEach((c) => c.setAttribute('aria-pressed', 'false'));
  pressionar('[data-fin]', $('[data-fin="todos"]'));
  aplicarFiltros();
}

function rotuloPreco(item) {
  if (item.real) return rotuloPrecoReal(item.ref);
  if (item.tipo === 'lancamento') {
    const r = resumoLanc(item.ref);
    return r.aPartir ? `a partir de ${fmtCurto(r.aPartir / 100)}` : 'esgotado';
  }
  return item.finalidade === 'locacao' ? `${fmtCurto(item.ref.aluguel)}/mês` : fmtCurto(item.ref.preco);
}

const hashItem = (id) => (id.startsWith('L:') ? `#/lancamento/${id.slice(2)}` : `#/imovel/${id}`);
const tituloItem = (it) => it.ref.nome || it.ref.titulo || it.ref.predio || ''; // lançamento real não tem 'nome', tem 'titulo'

function metaCard(it) {
  if (it.real) return metaCardReal(it.ref);
  const r = it.ref;
  const m = [`<span>${icone('pin', { tamanho: 12 })}${esc(r.bairro)}</span>`];
  if (it.tipo === 'lancamento') m.push(`<span>${icone('check', { tamanho: 12 })}${resumoLanc(r).disponivel} disponíveis</span>`);
  else {
    m.push(`<span>${icone('area', { tamanho: 12 })}${fmtArea(r.area_m2)}</span>`);
    if (r.quartos) m.push(`<span>${icone('cama', { tamanho: 12 })}${r.quartos}</span>`);
    if (r.vagas) m.push(`<span>${icone('carro', { tamanho: 12 })}${r.vagas}</span>`);
  }
  return m.join('');
}

function renderLista(lista) {
  const ol = $('#lista');
  if (!lista.length) {
    ol.innerHTML = `<li class="vazio">${icone('busca', { tamanho: 22 })}<p>Nenhum imóvel com esses filtros.</p>
      ${contarFiltrosAtivos() ? '<button class="btn" type="button" data-acao="limpar-filtros">Limpar filtros</button>' : ''}</li>`;
    return;
  }
  // HTML do card é fixo por item (cacheado); só seleção e coração variam
  ol.innerHTML = lista.map((it) => {
    it.htmlCard ||= `<a class="card-link" href="${hashItem(it.id)}">
        ${it.real ? htmlThumbReal(it.ref) : `<span class="thumb ${it.finalidade}">${icone(it.tipo, { tamanho: 24 })}</span>`}
        <span class="card-info">
          <span class="card-tit">${esc(tituloItem(it))}</span>
          <span class="card-meta">${metaCard(it)}</span>
          <span class="card-preco">${esc(rotuloPreco(it))} <small><i class="pt ${it.finalidade}"></i>${NOME_FIN[it.finalidade]}</small></span>
        </span></a>`;
    return `<li class="card${it.id === S.selCidade ? ' sel' : ''}" data-id="${esc(it.id)}">${it.htmlCard}${botaoCoracao(it.id, loja.tem(it.id))}</li>`;
  }).join('');
}

// ------------------------------------------------------------------ seleção do cliente
const loja = criarLojaSelecao({
  chave: S.modoDados === 'real' ? CHAVE_SELECAO_REAL : CHAVE_SELECAO,
  aoMudar(ids) {
    atualizarCoracoes();
    painelSel?.render();
    if (S.filtroOrigem === 'minha') {
      if (ids.length) S.filtroIds = new Set(ids);
      else { S.filtroIds = null; S.filtroOrigem = null; }
      aplicarFiltros();
    }
  },
});

function atualizarCoracoes() {
  for (const b of $$('[data-coracao]')) b.setAttribute('aria-pressed', String(loja.tem(b.dataset.coracao)));
}

function descreverItem(id) {
  const it = S.itemPorId[id];
  if (!it) return null;
  const r = it.ref;
  let sub;
  if (it.real) {
    const a = areaReal(r), q = quartosReal(r);
    sub = [r.bairro, it.tipo === 'lancamento' ? 'lançamento' : null, a ? fmtArea(a) : null, q ? `${q} qto${q > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ');
  } else sub = it.tipo === 'lancamento' ? `${r.bairro} · lançamento` : `${r.bairro} · ${fmtArea(r.area_m2)}${r.quartos ? ` · ${r.quartos} qto${r.quartos > 1 ? 's' : ''}` : ''}`;
  return { titulo: tituloItem(it), sub, preco: `${rotuloPreco(it)} · ${NOME_FIN[it.finalidade]}`, finalidade: it.finalidade, tipo: it.tipo, hash: hashItem(id) };
}

function textoSelecao(ids) {
  const linhas = ['Seleção de imóveis · Atlas MOC (Montes Claros)'];
  for (const id of ids) {
    const d = descreverItem(id);
    if (d) linhas.push(`· ${d.titulo}, ${d.sub}: ${d.preco}`);
  }
  return linhas.join('\n');
}

async function compartilharSelecao(modo) {
  const ids = loja.ids();
  if (!ids.length) { aviso('A seleção está vazia.', 'info'); return; }
  const url = linkAbsoluto(hashSelecao(ids));
  const texto = textoSelecao(ids);
  if (modo === 'copiar') { copiar(url, 'Link da seleção copiado.'); return; }
  if (modo === 'compartilhar' && temShareNativo()) {
    await compartilharNativo({ title: 'Seleção de imóveis · Atlas MOC', text: texto, url });
    return;
  }
  const w = window.open(linkWhatsApp(`${texto}\n${url}`), '_blank', 'noopener');
  if (w === null && !document.hidden) {
    // com 'noopener' alguns navegadores devolvem null mesmo abrindo; só avisa se a aba não perdeu o foco
    setTimeout(() => { if (document.hasFocus()) aviso('O navegador bloqueou a janela do WhatsApp. Use Copiar link.', 'erro'); }, 600);
  }
}

function alternarSoSelecao(ligar) {
  if (ligar) {
    const ids = loja.ids();
    if (!ids.length) { aviso('Marque imóveis com o coração antes de filtrar pela seleção.', 'info'); return; }
    S.filtroIds = new Set(ids);
    S.filtroOrigem = 'minha';
  } else {
    S.filtroIds = null;
    S.filtroOrigem = null;
  }
  painelSel.render();
  aplicarFiltros();
  if (ligar && S.cidade) seguro('Mapa (enquadrar)', () => S.cidade.enquadrarTudo(paddingMapa()));
}

// ------------------------------------------------------------------ gaveta (ficha)
const gaveta = $('#gaveta');
gaveta.inert = true;
const folhaGaveta = criarFolha(gaveta, {
  puxador: $('#puxador-gaveta'), paradas: ['recolhida', 'meio', 'cheia'], inicial: 'fechada', fechavel: true,
  aoFechar: () => fecharViaRota(),
  aoMudar: () => aoMudarFolhas(),
});

function abrirGaveta(html) {
  $('#gaveta-corpo').innerHTML = html;
  gaveta.classList.add('aberta');
  gaveta.setAttribute('aria-hidden', 'false');
  gaveta.inert = false;
  $('#gaveta-corpo').scrollTop = 0;
  document.body.classList.add('gaveta-aberta');
  if (ehMobile()) {
    if (folhaGaveta.estado() !== 'cheia') folhaGaveta.ir('meio');
    folhaLista.ir('recolhida');
    folhaEspelho.ir('recolhida');
  }
  enquadrarPredio();
  posicionarSol();
}
function fecharGaveta() {
  gaveta.classList.remove('aberta');
  gaveta.setAttribute('aria-hidden', 'true');
  gaveta.inert = true;
  document.body.classList.remove('gaveta-aberta');
  if (ehMobile()) folhaGaveta.ir('fechada', { avisar: false });
  enquadrarPredio();
  posicionarSol();
}
function fecharViaRota() {
  const r = rotaAtual();
  location.hash = r.vista === 'predio' ? `#/predio/${r.lanc}` : '#/cidade';
}

function enquadrarPredio() {
  if (!S.predio) return;
  if (ehMobile()) return seguro('Prédio (enquadrar)', () => S.predio.enquadrar(0, 0));
  const esq = $('#painel-espelho').classList.contains('recolhido') ? 0 : LARG_PAINEL_ESQ;
  seguro('Prédio (enquadrar)', () => S.predio.enquadrar(esq, gaveta.classList.contains('aberta') ? LARG_GAVETA : 0));
}
window.addEventListener('resize', enquadrarPredio);

// Com espelho e ficha abertos a barra do prédio quebra em linhas: o chip da vista da janela desce junto
// (a altura real vira --barra-predio-h, usada no CSS).
if (typeof ResizeObserver === 'function') {
  const barraPredio = $('.barra-predio');
  new ResizeObserver(() => {
    if (barraPredio.offsetHeight) $('#vista-predio').style.setProperty('--barra-predio-h', `${barraPredio.offsetHeight}px`);
  }).observe(barraPredio);
}

function aoMudarFolhas() {
  // a folha mudou de altura no mobile: o prédio reenquadra; o mapa usa o padding no próximo voo
  enquadrarPredio();
  posicionarSol();
}

gaveta.addEventListener('click', (e) => {
  const b = e.target.closest('[data-acao]');
  if (!b) return;
  const a = b.dataset.acao;
  if (a === 'copiar-ficha') {
    const it = S.itemPorId[S.selCidade];
    copiar(it.real ? textoImovelReal(it.ref) : textoImovel(it.ref), 'Ficha copiada.');
  } else if (a === 'gal-ant' || a === 'gal-prox') moverGaleria(b.closest('[data-gal]'), a === 'gal-prox' ? 1 : -1);
  else if (a === 'copiar-link') copiar(b.dataset.link, 'Link copiado.');
  else if (a === 'copiar-texto') copiar(b.dataset.texto, 'Resumo copiado.');
  else if (a === 'compartilhar') compartilharFichaAtual();
  else if (a === 'vista') alternarVista(b.dataset.un);
  else if (a === 'abrir-sol') painelSol.abrir();
});
$('#fechar-gaveta').addEventListener('click', fecharViaRota);

// ------------------------------------------------------------------ galeria de fotos (anúncios reais)
function marcarFoto(gal, i) {
  gal.dataset.i = String(i);
  const cont = gal.querySelector('.gal-cont');
  if (cont) cont.textContent = `${i + 1}/${gal.dataset.n}`;
}
function moverGaleria(gal, delta) {
  if (!gal) return;
  const n = Number(gal.dataset.n) || 1;
  const i = ((((Number(gal.dataset.i) || 0) + delta) % n) + n) % n;
  marcarFoto(gal, i);
  const trilho = gal.querySelector('.gal-trilho');
  if (trilho?.clientWidth && typeof trilho.scrollTo === 'function') {
    trilho.scrollTo({ left: i * trilho.clientWidth, behavior: S.cfg.animacoes ? 'smooth' : 'auto' });
  }
}
// arrastar (swipe) ou rolar com o teclado também troca a foto: o contador segue a posição do trilho
gaveta.addEventListener('scroll', (e) => {
  const t = e.target;
  if (!t.classList?.contains('gal-trilho') || !t.clientWidth) return;
  const gal = t.closest('[data-gal]');
  const i = Math.min(Math.round(t.scrollLeft / t.clientWidth), (Number(gal.dataset.n) || 1) - 1);
  if (String(i) !== gal.dataset.i) marcarFoto(gal, i);
}, { capture: true, passive: true });
// foto que a fonte não serve mais: placeholder visível no lugar (erro de imagem não borbulha, só captura)
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!img || img.tagName !== 'IMG' || !img.hasAttribute('data-foto')) return;
  console.warn('[foto]', `indisponível na fonte: ${img.getAttribute('src')}`);
  img.hidden = true;
  const fig = img.closest('.gal-foto');
  if (fig) {
    fig.classList.add('falhou');
    const ph = fig.querySelector('.gal-falha');
    if (ph) ph.hidden = false;
  }
  img.closest('.thumb')?.classList.remove('com-foto');
}, true);

async function compartilharFichaAtual() {
  const r = rotaAtual();
  let dados;
  if (r.vista === 'predio' && r.unidade) {
    const l = S.lancPorId[r.lanc];
    const u = l.unidades.find((x) => x.numero === r.unidade);
    dados = { title: `${l.nome} · apto ${u.numero}`, text: textoUnidade(l, u, { comLink: false }), url: linkAbsoluto(`#/predio/${l.id}/${u.numero}`) };
  } else if (S.selCidade) {
    const it = S.itemPorId[S.selCidade];
    if (it.real) dados = { title: tituloItem(it), text: textoImovelReal(it.ref, { comLink: false }), url: linkAbsoluto(`#/imovel/${it.id}`) };
    else {
      dados = it.tipo === 'lancamento'
        ? { title: it.ref.nome, text: textoLancamento(it.ref, { comLink: false }), url: linkAbsoluto(`#/predio/${it.ref.id}`) }
        : { title: it.ref.titulo, text: textoImovel(it.ref, { comLink: false }), url: linkAbsoluto(`#/imovel/${it.id}`) };
    }
  } else return;
  const res = await compartilharNativo(dados);
  if (res === 'indisponivel') aviso('Este navegador não tem compartilhamento nativo. Use WhatsApp ou copiar.', 'info');
}

// ------------------------------------------------------------------ vista da janela
function alternarVista(numero) {
  if (!S.predio) return;
  const em = seguro('Prédio (vista)', () => S.predio.emVista());
  seguro('Prédio (vista da janela)', () => S.predio.vistaDaUnidade(em === numero ? null : numero));
  if (em !== numero && ehMobile()) folhaGaveta.ir('recolhida'); // libera a tela para olhar a vista
  atualizarVistaUI();
}
function sairDaVista() {
  if (!S.predio) return false;
  const em = seguro('Prédio (vista)', () => S.predio.emVista());
  if (!em) return false;
  seguro('Prédio (vista da janela)', () => S.predio.vistaDaUnidade(null));
  atualizarVistaUI();
  return true;
}
function atualizarVistaUI() {
  const em = S.predio ? seguro('Prédio (vista)', () => S.predio.emVista()) ?? null : null;
  const chip = $('#chip-vista');
  chip.hidden = !em;
  if (em) $('#chip-vista-txt').textContent = `Vista da janela · apto ${em}`;
  const b = $('#gaveta [data-acao="vista"]');
  if (b) {
    const ativa = em === b.dataset.un;
    b.setAttribute('aria-pressed', String(ativa));
    b.innerHTML = `${icone(ativa ? 'voltar' : 'vista', { tamanho: 16 })}${ativa ? 'Sair da vista' : 'Ver vista da janela'}`;
  }
}
$('#chip-vista-sair').addEventListener('click', () => sairDaVista());

// ------------------------------------------------------------------ espelho (painel do prédio)
function legendaPredio() {
  // mesmas classes da grade: a legenda não pode divergir das células
  const sw = (k) => `<i class="sw un ${k}"></i>`;
  return S.luzPredio === 'noite'
    ? `<span>${sw('vendida')}Luz acesa · vendida</span><span>${sw('disponivel')}Apagada · disponível</span><span>${sw('reservada')}Reservada</span>`
    : `<span>${sw('disponivel')}Disponível</span><span>${sw('vendida')}Vendida</span><span>${sw('reservada')}Reservada</span>`;
}

function passaTipologia(u) { return !S.tipologiasPredio.size || S.tipologiasPredio.has(u.tipologia); }

function renderEspelho() {
  const l = S.lancPorId[S.lancAtual];
  if (!l) return;
  const r = resumoLanc(l);
  const finais = Math.max(...l.unidades.map((u) => u.final));
  const porAndar = {};
  for (const u of l.unidades) (porAndar[u.andar] ||= {})[u.final] = u;
  // no toque, --col-andar e --min-un levam as células a 44 px (a grade rola na horizontal se não couber)
  const cols = `grid-template-columns: var(--col-andar, 34px) repeat(${finais}, minmax(var(--min-un, 0px), 1fr))`;
  let grade = `<div class="gl" style="${cols}"><span></span>${Array.from({ length: finais }, (_, i) => `<span class="gh">${String(i + 1).padStart(2, '0')}</span>`).join('')}</div>`;
  for (const a of [...l.andares].reverse()) {
    grade += `<div class="gl" style="${cols}"><button type="button" class="ga" data-andar="${a}" aria-pressed="${a === S.andarDestacado}" title="Destacar o ${a}º andar no 3D">${a}º</button>${Array.from({ length: finais }, (_, i) => {
      const u = porAndar[a][i + 1];
      if (!u) return '<span></span>';
      const cls = ['un', u.status, passaTipologia(u) ? '' : 'apagada', u.numero === S.unidadeSel ? 'sel' : ''].join(' ');
      return `<button type="button" class="${cls}" data-un="${u.numero}" title="${u.numero} · ${esc(l.tipologias[u.tipologia].nome)} · ${NOME_STATUS[u.status]}">${String(u.final).padStart(2, '0')}</button>`;
    }).join('')}</div>`;
  }
  const chips = Object.entries(l.tipologias).map(([k, t]) => `<button type="button" class="chip" data-tip="${k}" aria-pressed="${S.tipologiasPredio.has(k)}">${esc(t.nome)} · ${fmtArea(t.area_m2)}</button>`).join('');
  const obra = S.modoPredio === 'obra' ? `<div class="esp-sec"><h3>${icone('obra', { tamanho: 14 })}Andamento da obra · ${l.obra.geral_pct}%</h3><div class="obra-et">${l.obra.etapas.map((e) => `<div><span>${esc(e.nome)}</span><span class="bar"><i style="width:${e.pct}%"></i></span><b>${e.pct}%</b></div>`).join('')}</div><p class="nota">Entrega prevista ${fmtData(l.entrega_prevista)}. Andares acima da alvenaria aparecem como volumes translúcidos, na cor do status.</p></div>` : '';
  $('#espelho-corpo').innerHTML = `
    <div class="esp-cab"><div class="esp-selo">${esc(l.selo)}</div><div class="esp-cab-txt"><h2>${esc(l.nome)}</h2><p>${esc(l.bairro)} · ${r.total} unidades · tabela de ${fmtData(l.tabela_data)}</p>
      ${S.modoDados === 'real'
    ? `<span class="badge demo" title="Os espelhos 3D são de lançamentos fictícios: os anúncios reais não trazem tabela de unidades.">${icone('info', { tamanho: 13 })}Demonstração</span>`
    : `<a href="#/lancamento/${esc(l.id)}">${icone('voltar', { tamanho: 14 })}Ver no mapa da cidade</a>`}</div>
      ${S.modoDados === 'real' ? '' : botaoCoracao(`L:${l.id}`, loja.tem(`L:${l.id}`))}</div>
    <div class="esp-vendido">
      <div class="esp-pct"><strong>${r.pctVendido.toFixed(1).replace('.', ',')}%</strong><span>vendido</span></div>
      <div class="barra" title="${r.vendida} vendidas · ${r.reservada} reservadas · ${r.disponivel} disponíveis">
        <i style="width:${(100 * r.vendida) / r.total}%;background:var(--vendida)"></i>
        <i style="width:${(100 * r.reservada) / r.total}%;background:var(--reservada)"></i>
      </div>
      <div class="esp-leg">${S.luzPredio === 'noite' ? icone('lua', { tamanho: 14, classe: 'leg-ic' }) : icone('sol', { tamanho: 14, classe: 'leg-ic' })}${legendaPredio()}</div>
      <p class="nota">${r.vendida} vendidas · ${r.reservada} reservadas · ${r.disponivel} disponíveis</p>
    </div>
    ${obra}
    <div class="esp-sec"><h3>${icone('filtro', { tamanho: 14 })}Tipologias</h3><div class="chips">${chips}</div></div>
    <div class="esp-sec"><h3>${icone('andar', { tamanho: 14 })}Espelho por pavimento</h3><div class="grade">${grade}</div></div>`;
  $('#painel-espelho').classList.toggle('luz-dia', S.luzPredio === 'dia');
  const rot = `${r.pctVendido.toFixed(0)}% vendido · ${r.disponivel} disponíveis`;
  $('#alca-espelho-texto').textContent = `${rot} · ver espelho`;
  $('#abrir-espelho .rot').textContent = rot;
}

$('#espelho-corpo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-un]');
  if (b) { location.hash = `#/predio/${S.lancAtual}/${b.dataset.un}`; if (ehMobile()) folhaEspelho.ir('recolhida'); return; }
  const a = e.target.closest('[data-andar]');
  if (a) {
    const andar = Number(a.dataset.andar);
    S.andarDestacado = S.andarDestacado === andar ? null : andar;
    seguro('Prédio (andar)', () => S.predio?.destacarAndar(S.andarDestacado));
    for (const x of $$('#espelho-corpo [data-andar]')) x.setAttribute('aria-pressed', String(Number(x.dataset.andar) === S.andarDestacado));
    return;
  }
  const c = e.target.closest('[data-tip]');
  if (c) {
    const k = c.dataset.tip;
    S.tipologiasPredio.has(k) ? S.tipologiasPredio.delete(k) : S.tipologiasPredio.add(k);
    seguro('Prédio (filtro)', () => S.predio?.filtrar(passaTipologia));
    renderEspelho();
  }
});
$('#espelho-corpo').addEventListener('mouseover', (e) => {
  const b = e.target.closest('[data-un]');
  seguro('Prédio (destaque)', () => S.predio?.destacar(b ? b.dataset.un : null));
  const a = e.target.closest('[data-andar]');
  if (S.andarDestacado == null) seguro('Prédio (andar)', () => S.predio?.destacarAndar(a ? Number(a.dataset.andar) : null));
});
$('#espelho-corpo').addEventListener('mouseleave', () => {
  seguro('Prédio (destaque)', () => S.predio?.destacar(null));
  if (S.andarDestacado == null) seguro('Prédio (andar)', () => S.predio?.destacarAndar(null));
});

// ------------------------------------------------------------------ dica (tooltip)
const dica = $('#dica');
let dicaPend = null;
function mostrarDica(html, x, y) {
  if (!html) { dicaPend = null; dica.hidden = true; return; }
  const agendar = !dicaPend;
  dicaPend = { html, x, y };
  if (!agendar) return;
  // escreve e mede uma vez por quadro, não a cada mousemove
  requestAnimationFrame(() => {
    if (!dicaPend) return;
    const { html: h, x: px, y: py } = dicaPend;
    dicaPend = null;
    if (dica.dataset.html !== h) { dica.innerHTML = h; dica.dataset.html = h; }
    dica.hidden = false;
    const w = dica.offsetWidth;
    dica.style.transform = `translate3d(${Math.min(px + 14, innerWidth - w - 12)}px, ${py + 14}px, 0)`;
  });
}

// ------------------------------------------------------------------ rotas
function decodificar(t) {
  try { return decodeURIComponent(t); } catch (err) {
    console.error('[rota]', err);
    aviso(`Link com caractere inválido (${t}).`, 'erro');
    return t;
  }
}
function rotaAtual() {
  const p = location.hash.replace(/^#\/?/, '').split('/');
  const p1 = p[1] !== undefined ? decodificar(p[1]) : undefined;
  if (p[0] === 'predio') return { vista: 'predio', lanc: S.lancPorId[p1] ? p1 : S.lancamentos[0].id, unidade: p[2] ? decodificar(p[2]) : null, lancInvalido: p1 && !S.lancPorId[p1] ? p1 : null };
  if (p[0] === 'imovel' && S.imovelPorId[p1]) return { vista: 'cidade', sel: p1 };
  if (p[0] === 'lancamento' && S.itemPorId[`L:${p1}`]) return { vista: 'cidade', sel: `L:${p1}` };
  if (p[0] === 'selecao') return { vista: 'cidade', sel: null, selecao: (p[1] || '').split(',').map(decodificar).filter(Boolean) };
  return { vista: 'cidade', sel: null, invalida: p[0] && !['cidade', ''].includes(p[0]) ? location.hash : null };
}

function paddingMapa() {
  const popAberto = painelSel.aberto() || painelConfig.aberto();
  if (ehMobile()) {
    const pop = popAberto ? Math.max($('#painel-selecao').offsetHeight * painelSel.aberto(), $('#painel-config').offsetHeight * painelConfig.aberto()) : 0;
    const baixo = Math.max(folhaGaveta.visivel(), folhaLista.visivel(), pop);
    return { top: 70, bottom: baixo + 16, left: 16, right: 16 };
  }
  const esq = $('#painel-lista').classList.contains('recolhido') ? MARGEM : LARG_PAINEL_ESQ;
  return { top: 70, bottom: MARGEM, left: esq, right: gaveta.classList.contains('aberta') || popAberto ? LARG_GAVETA : MARGEM };
}

function aplicarSelecaoRecebida(ids) {
  const validos = ids.filter((id) => S.itemPorId[id]);
  const invalidos = ids.filter((id) => !S.itemPorId[id]);
  if (invalidos.length) aviso(`Itens do link que não existem mais: ${invalidos.join(', ')}.`, 'erro');
  if (!validos.length) { aviso('O link de seleção não tem nenhum imóvel válido.', 'erro'); location.hash = '#/cidade'; return; }
  S.filtroIds = new Set(validos);
  S.filtroOrigem = 'link';
  // padding medido antes de abrir o painel: no mobile a folha cobriria a tela e o enquadramento não caberia
  const pad = paddingMapa();
  if (!ehMobile()) pad.right = LARG_GAVETA;
  painelSel.receber(validos);
  painelSel.abrir();
  aplicarFiltrosAgora();
  if (S.cidade) seguro('Mapa (enquadrar)', () => S.cidade.enquadrarTudo(pad));
}

function mostrarVista(v) {
  S.vista = v;
  $$('.modos [data-modo]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.modo === v)));
  $('#vista-cidade').hidden = v !== 'cidade';
  $('#vista-predio').hidden = v !== 'predio';
  document.body.dataset.vista = v;
  posicionarSol();
}

// A cena do prédio é criada uma vez só, mesmo que várias rotas cheguem durante o download.
let promessaPredio = null;
function garantirPredio() {
  promessaPredio ||= (async () => {
    $('#carregando-texto').textContent = 'Montando o prédio em 3D…';
    $('#carregando').classList.remove('saindo');
    try {
      const { criarPredio } = await import('./predio.js');
      S.predio = criarPredio({
        canvas: $('#cena-predio'),
        config: configResolvida(S.cfg),
        eventos: {
          aoPassar(u, x, y) {
            if (!u) return mostrarDica(null);
            const t = S.lancPorId[S.lancAtual].tipologias[u.tipologia];
            mostrarDica(`<b>${esc(u.numero)}</b> · ${esc(t.nome)} · <span class="s-${u.status}">${NOME_STATUS[u.status]}</span>`, x, y);
          },
          aoClicar(u) { location.hash = `#/predio/${S.lancAtual}/${u.numero}`; },
          aoErro(msg) { aviso(msg, 'erro'); },
        },
      });
      if (S.sol.pos) S.predio.sol(S.sol.pos);
      return true;
    } catch (err) {
      console.error('[predio]', err);
      aviso(`Não foi possível montar a cena 3D do prédio: ${err.message}`, 'erro');
      S.predio = null;
      promessaPredio = null; // permite tentar de novo ao voltar para a rota do prédio
      return false;
    } finally {
      $('#carregando').classList.add('saindo');
    }
  })();
  return promessaPredio;
}

async function aplicarRota() {
  if (!S.itens.length) return; // dados ainda chegando: o boot chama aplicarRota quando estiverem prontos
  const r = rotaAtual();
  mostrarVista(r.vista);
  mostrarDica(null);

  if (r.vista === 'cidade') {
    if (S.predio) { sairDaVista(); seguro('Prédio', () => S.predio.ativar(false)); }
    if (S.cidade) seguro('Mapa', () => S.cidade.redimensionar());
    if (r.invalida) aviso(`Endereço não encontrado (${r.invalida}). Mostrando o mapa.`, 'erro');
    if (r.selecao) {
      S.selCidade = null;
      if (S.cidade) seguro('Mapa (seleção)', () => S.cidade.selecionar(null));
      fecharGaveta();
      aplicarSelecaoRecebida(r.selecao);
      return;
    }
    S.selCidade = r.sel;
    $$('#lista .card').forEach((c) => c.classList.toggle('sel', c.dataset.id === r.sel));
    if (r.sel) {
      const it = S.itemPorId[r.sel];
      abrirGaveta(it.real ? htmlImovelReal(it.ref, { naSelecao: loja.tem(r.sel), share: temShareNativo() }) : it.tipo === 'lancamento'
        ? htmlLancamento(it.ref, { naSelecao: loja.tem(r.sel), share: temShareNativo() })
        : htmlImovel(it.ref, { corretor: S.corretores[it.ref.corretor_id], naSelecao: loja.tem(r.sel), share: temShareNativo() }));
    } else fecharGaveta();
    // o padding já desconta a ficha aberta (ou a folha no mobile)
    if (S.cidade) seguro('Mapa (seleção)', () => S.cidade.selecionar(r.sel, { padding: paddingMapa() }));
    return;
  }

  // prédio
  if (r.lancInvalido) aviso(`Lançamento "${r.lancInvalido}" não existe. Mostrando ${S.lancPorId[r.lanc].nome}.`, 'erro');
  if (!S.predio) {
    const hashAntes = location.hash;
    if (!(await garantirPredio())) return;
    // a rota mudou enquanto a cena baixava: a chamada mais nova de aplicarRota manda
    if (location.hash !== hashAntes) return;
  }
  if (S.lancAtual !== r.lanc || !S.predioCarregado) {
    sairDaVista();
    S.lancAtual = r.lanc;
    S.tipologiasPredio.clear();
    S.unidadeSel = null;
    S.andarDestacado = null;
    const ok = seguro('Prédio (carregar)', () => { S.predio.carregar(S.lancPorId[r.lanc]); return true; });
    if (!ok) return;
    enquadrarPredio();
    if (S.sol.pos) seguro('Prédio (sol)', () => S.predio.sol(S.sol.pos));
    seguro('Prédio (filtro)', () => S.predio.filtrar(passaTipologia));
    S.predioCarregado = true;
    $('#sel-lanc').value = r.lanc;
  }
  S.luzPredio = estadoLuz();
  seguro('Prédio', () => S.predio.ativar(true));
  const focar = r.unidade && r.unidade !== S.unidadeSel;
  if (r.unidade !== S.unidadeSel) sairDaVista();
  S.unidadeSel = r.unidade;
  seguro('Prédio (seleção)', () => S.predio.selecionar(r.unidade, { focar: focar && S.origemClique !== '3d' }));
  S.origemClique = null;
  renderEspelho();
  const l = S.lancPorId[r.lanc];
  const u = r.unidade && l.unidades.find((x) => x.numero === r.unidade);
  if (r.unidade && !u) aviso(`A unidade ${r.unidade} não existe no ${l.nome}.`, 'erro');
  if (u) {
    const emVista = seguro('Prédio (vista)', () => S.predio.emVista()) === u.numero;
    abrirGaveta(htmlUnidade(l, u, { share: temShareNativo(), dataISO: S.sol.dataISO, minutos: S.sol.minutos, emVista }));
  } else fecharGaveta();
  atualizarVistaUI();
}
window.addEventListener('hashchange', aplicarRota);

// ------------------------------------------------------------------ sol
function aoMudarSol({ dataISO, minutos, pos, mudouData }) {
  S.sol = { dataISO, minutos, pos };
  if (S.cidade) seguro('Mapa (sol)', () => S.cidade.sol(pos));
  if (S.predio) seguro('Prédio (sol)', () => S.predio.sol(pos));
  // paridade de visões: legenda e grade seguem o estado de luz do prédio
  const luz = estadoLuz();
  if (luz !== S.luzPredio) {
    S.luzPredio = luz;
    if (S.vista === 'predio' && S.lancAtual) renderEspelho();
  }
  const ins = $('#insolacao');
  if (ins) {
    if (mudouData) {
      const r = rotaAtual();
      const l = S.lancPorId[r.lanc];
      const u = l && r.unidade && l.unidades.find((x) => x.numero === r.unidade);
      if (u) {
        const emVista = S.predio ? seguro('Prédio (vista)', () => S.predio.emVista()) === u.numero : false;
        ins.outerHTML = htmlInsolacao(l, u, { dataISO, minutos, emVista });
      }
    } else ins.style.setProperty('--agora', `${pctDia(minutos).toFixed(2)}%`);
  }
}

// ------------------------------------------------------------------ configurações
function mudarConfig(parcial) {
  Object.assign(S.cfg, parcial);
  salvarConfig(S.cfg, { aoErro: (m) => aviso(m, 'erro') });
  const resolvido = { ...parcial };
  if ('qualidade' in parcial) resolvido.qualidade = resolverQualidade(parcial.qualidade);
  if (S.cidade) seguro('Mapa (configuração)', () => S.cidade.configurar(resolvido));
  const doPredio = {};
  if ('animacoes' in resolvido) doPredio.animacoes = resolvido.animacoes;
  if ('qualidade' in resolvido) doPredio.qualidade = resolvido.qualidade;
  if (S.predio && Object.keys(doPredio).length) seguro('Prédio (configuração)', () => S.predio.configurar(doPredio));
  if ('tema' in parcial) aplicarTema();
  if ('animacoes' in parcial) document.documentElement.classList.toggle('sem-animacao', !parcial.animacoes);
  if ('medidor' in parcial) medidor.ligar(parcial.medidor);
  if ('visao' in parcial) bussolaCidade.atualizarVisao(parcial.visao);
  painelConfig.sincronizar(S.cfg);
}

// ------------------------------------------------------------------ componentes
// Painel de sol compacto: no mobile flutua logo acima da folha mais alta (lista/espelho ou ficha), sem
// cobrir a folha; a altura dele vira --sol-h para os avisos subirem junto.
let folhasProntas = false; // as folhas são criadas depois do painel de sol
function posicionarSol() {
  const corpo = document.body;
  const el = $('#painel-sol');
  corpo.style.setProperty('--sol-h', `${el.offsetHeight || 0}px`);
  if (!folhasProntas || !ehMobile()) { corpo.style.removeProperty('--sol-baixo'); return; }
  const folha = Math.max(S.vista === 'predio' ? folhaEspelho.visivel() : folhaLista.visivel(), folhaGaveta.visivel());
  const topo = $('.topo').offsetHeight || 52;
  const teto = innerHeight - topo - (el.offsetHeight || 90) - 12; // nunca sobe por baixo do topo
  corpo.style.setProperty('--sol-baixo', `${Math.max(0, Math.min(folha, teto))}px`);
}
window.addEventListener('resize', posicionarSol);

const painelSol = criarPainelSol({
  el: $('#painel-sol'), botao: $('#b-sol'), aoMudar: aoMudarSol, aoRedimensionar: posicionarSol,
  aoAbrirFechar: (aberto) => {
    if (aberto) fecharFolhasMoveisExceto('sol');
    document.body.classList.toggle('sol-aberto', aberto);
    posicionarSol();
  },
});
const painelConfig = criarPainelConfig({
  el: $('#painel-config'), botao: $('#b-config'),
  aoMudar: mudarConfig,
  aoRestaurar: () => { mudarConfig(padraoDoAparelho()); aviso('Configurações restauradas ao padrão.', 'ok'); },
  aoAtalhos: () => atalhos.abrir(),
  aoInstalar: () => pwa.instalar(),
  qualidadeEfetiva: (q) => resolverQualidade(q),
  aoAbrirFechar: (aberto) => { if (aberto) { fecharFolhasMoveisExceto('config'); painelSel.fechar(); } atualizarVeu(); },
});
const painelSel = criarPainelSelecao({
  el: $('#painel-selecao'), botao: $('#b-selecao'), loja, descrever: descreverItem,
  compartilhavel: temShareNativo,
  aoCompartilhar: compartilharSelecao,
  aoAlternarSoSelecao: alternarSoSelecao,
  soSelecaoAtiva: () => Boolean(S.filtroIds),
  aoAbrirFechar: (aberto) => { if (aberto) { fecharFolhasMoveisExceto('selecao'); painelConfig.fechar({ devolverFoco: false }); } atualizarVeu(); },
});
const atalhos = criarOverlayAtalhos({ el: $('#atalhos') });
const medidor = criarMedidor({
  el: $('#medidor'),
  obterVista: () => (S.vista === 'predio'
    ? (S.predio ? { nome: 'prédio', diagnostico: () => S.predio.diagnostico() } : null)
    : (S.cidade ? { nome: 'mapa', diagnostico: () => S.cidade.diagnostico() } : null)),
});
const bussolaCidade = criarBussolaCidade({
  el: $('#bussola-cidade'),
  aoNorte: () => S.cidade && seguro('Mapa (norte)', () => S.cidade.norte()),
  aoZoom: (d) => S.cidade && seguro('Mapa (zoom)', () => (d > 0 ? S.cidade.map.zoomIn() : S.cidade.map.zoomOut())),
  aoVisao: () => mudarConfig({ visao: S.cfg.visao === '2d' ? '3d' : '2d' }),
});
criarBussolaPredio({
  el: $('#bussola-predio'),
  aoNorte: () => S.predio && seguro('Prédio (norte)', () => S.predio.norte()),
  aoGirar: (d) => S.predio && seguro('Prédio (girar)', () => S.predio.girarPasso(d)),
});
const pwa = iniciarPWA({ aoEstado: (e) => painelConfig.atualizarApp(e) });

// folhas no mobile: lista e espelho com 3 paradas; sol, configurações e seleção fecham arrastando
const folhaLista = criarFolha($('#painel-lista'), { puxador: $('#alca-lista'), inicial: 'recolhida', aoMudar: aoMudarFolhas });
const folhaEspelho = criarFolha($('#painel-espelho'), { puxador: $('#alca-espelho'), inicial: 'recolhida', aoMudar: aoMudarFolhas });
criarFolha($('#painel-config'), { puxador: painelConfig.puxador, modo: 'simples', aoFechar: () => painelConfig.fechar() });
criarFolha($('#painel-selecao'), { puxador: painelSel.puxador, modo: 'simples', aoFechar: () => painelSel.fechar() });
folhasProntas = true;

function fecharFolhasMoveisExceto(nome) {
  // no mobile só uma folha de ferramenta por vez (a tela é pequena)
  if (!ehMobile()) return;
  if (nome !== 'sol') painelSol.fechar();
  if (nome !== 'config') painelConfig.fechar({ devolverFoco: false });
  if (nome !== 'selecao') painelSel.fechar();
}
function atualizarVeu() {
  $('#veu').hidden = !(ehMobile() && (painelConfig.aberto() || painelSel.aberto()));
}
$('#veu').addEventListener('click', () => { painelConfig.fechar(); painelSel.fechar(); });
// desktop: clicar fora fecha os popovers da direita (o painel de sol fica, para mexer no mapa com ele aberto)
document.addEventListener('pointerdown', (e) => {
  if (ehMobile()) return;
  const dentro = (sel) => e.target.closest(sel);
  if (painelConfig.aberto() && !dentro('#painel-config') && !dentro('#b-config') && !dentro('#atalhos')) painelConfig.fechar({ devolverFoco: false });
  if (painelSel.aberto() && !dentro('#painel-selecao') && !dentro('#b-selecao') && !dentro('[data-coracao]') && !dentro('.aviso')) painelSel.fechar();
});
aoMudarMobile((mobile) => {
  if (mobile) {
    // painel recolhido é coisa do desktop; no mobile a folha manda
    for (const [painel, abrir, vista] of [['#painel-lista', '#abrir-lista', 'cidade'], ['#painel-espelho', '#abrir-espelho', 'predio']]) {
      $(painel).classList.remove('recolhido');
      $(painel).inert = false;
      $(abrir).hidden = true;
      $(`#vista-${vista}`).classList.remove('painel-fechado');
      document.body.classList.remove(`esq-fechado-${vista}`);
    }
  }
  // a ficha aberta no desktop precisa de uma parada ao virar folha
  if (mobile && gaveta.classList.contains('aberta') && folhaGaveta.estado() === 'fechada') folhaGaveta.ir('meio');
  atualizarVeu();
  enquadrarPredio();
  posicionarSol();
});

// ------------------------------------------------------------------ painéis laterais (recolher no desktop)
// Recolhe ou abre o painel esquerdo de uma vista (desktop), sem depender de S.vista: o atalho '/' abre a
// lista enquanto o hash ainda não trocou a vista.
function definirPainelEsq(vista, recolher, { focar = true } = {}) {
  const cidade = vista === 'cidade';
  const painel = cidade ? $('#painel-lista') : $('#painel-espelho');
  painel.classList.toggle('recolhido', recolher);
  painel.inert = recolher;
  $(cidade ? '#vista-cidade' : '#vista-predio').classList.toggle('painel-fechado', recolher);
  document.body.classList.toggle(`esq-fechado-${vista}`, recolher); // o CSS centraliza sol, legenda e avisos na área livre
  $(cidade ? '#abrir-lista' : '#abrir-espelho').hidden = !recolher;
  if (!cidade) enquadrarPredio();
  if (!recolher && focar) $('button, input, a', painel)?.focus({ preventScroll: true });
}
function alternarPainelEsq() {
  const cidade = S.vista === 'cidade';
  const folha = cidade ? folhaLista : folhaEspelho;
  if (ehMobile()) { folha.ir(folha.estado() === 'recolhida' ? 'meio' : 'recolhida'); return; }
  definirPainelEsq(S.vista, !$(cidade ? '#painel-lista' : '#painel-espelho').classList.contains('recolhido'));
}
// Leva à busca de qualquer vista: abre a lista (painel no desktop, folha cheia no mobile) e foca o campo.
function irParaBusca() {
  const focar = () => requestAnimationFrame(() => $('#f-busca').focus());
  if (ehMobile()) folhaLista.ir('cheia');
  else if ($('#painel-lista').classList.contains('recolhido')) definirPainelEsq('cidade', false, { focar: false });
  if (S.vista !== 'cidade') {
    // o foco só pega depois que o aplicarRota (ouvinte anterior do mesmo hashchange) mostrar a vista Cidade
    window.addEventListener('hashchange', focar, { once: true });
    location.hash = S.selCidade ? hashItem(S.selCidade) : '#/cidade';
  } else focar();
}
for (const id of ['#recolher-lista', '#abrir-lista', '#recolher-espelho', '#abrir-espelho']) $(id).addEventListener('click', alternarPainelEsq);
// O link de pular é âncora (#f-busca), não rota: sem interceptar, o hashchange o trataria como endereço inválido.
$('.pular').addEventListener('click', (e) => { e.preventDefault(); irParaBusca(); });

// ------------------------------------------------------------------ modo de dados: controle e troca
function montarControleModo() {
  const html = htmlControleModo(S.modoDados, { motivoReal: S.motivoReal });
  for (const el of [$('#modo-dados'), $('#modo-dados-lista')]) if (el) el.innerHTML = html;
}
function trocarModoDados(novo) {
  if (!MODOS_DADOS.includes(novo) || novo === S.modoDados) return;
  salvarModo(novo, { aoErro: (m) => aviso(m, 'erro') });
  aviso(novo === 'real' ? 'Abrindo os anúncios reais…' : 'Abrindo os dados de demonstração…', 'info');
  // ids de imóvel não existem no outro modo: a cidade abre sem ficha; a aba Prédio é a mesma nos dois
  location.assign(urlDoModo(location.href, novo, { hash: S.vista === 'predio' ? location.hash : '#/cidade' }));
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-dados]');
  if (b) trocarModoDados(b.dataset.dados);
});

/** Os anúncios reais não abriram: aviso com o motivo e o app segue com a demonstração. */
function voltarParaDemo(err) {
  console.error('[dados-reais]', err);
  S.motivoReal = err.message;
  S.modoDados = 'demo';
  loja.usarChave(CHAVE_SELECAO);
  history.replaceState(history.state, '', urlDoModo(location.href, 'demo'));
  aviso(`Os anúncios reais não abriram (${err.message}). Voltei para os dados de demonstração. Tente de novo em "Anúncios reais" quando o arquivo estiver pronto.`, 'erro', { ms: 16000 });
}

function aplicarModoNaTela(meta) {
  const real = S.modoDados === 'real';
  document.body.classList.toggle('modo-real', real);
  const selo = $('#selo-dados');
  if (real) {
    const m = resumoMeta(meta, S.itens.length);
    selo.innerHTML = `${icone('vendido', { tamanho: 14 })}<span>${esc(m.selo)}</span>`;
    selo.title = m.dica;
    selo.classList.add('real');
    $('#nota-real').textContent = m.aviso;
  } else if (S.motivoReal) {
    selo.title = `Imóveis, preços, corretores e lançamentos são fictícios. Os anúncios reais não abriram: ${S.motivoReal}`;
  }
  $('#nota-real').hidden = !real;
  $('#selo-predio-demo').hidden = !real;
  montarControleModo();
}

// ------------------------------------------------------------------ controles
function pressionar(grupo, botao) { $$(grupo).forEach((b) => b.setAttribute('aria-pressed', String(b === botao))); }

$$('.modos [data-modo]').forEach((b) => b.addEventListener('click', () => {
  location.hash = b.dataset.modo === 'predio' ? `#/predio/${S.lancAtual || S.lancamentos[0].id}` : (S.selCidade ? hashItem(S.selCidade) : '#/cidade');
}));

$$('[data-fin]').forEach((b) => b.addEventListener('click', () => { pressionar('[data-fin]', b); S.filtros.fin = b.dataset.fin; aplicarFiltros(); }));
$('#f-busca').addEventListener('input', (e) => { S.filtros.busca = e.target.value.trim(); aplicarFiltros(); });
$('#f-bairro').addEventListener('change', (e) => { S.filtros.bairro = e.target.value; aplicarFiltros(); });
$('#f-quartos').addEventListener('change', (e) => { S.filtros.quartos = Number(e.target.value); aplicarFiltros(); });
$('#f-preco').addEventListener('input', (e) => { S.filtros.preco = Number(e.target.value); aplicarFiltros(); });
$('#f-ordem').addEventListener('change', (e) => { S.filtros.ordem = e.target.value; aplicarFiltros(); });
$('#f-tipos').addEventListener('click', (e) => {
  const c = e.target.closest('[data-tipo]');
  if (!c) return;
  const k = c.dataset.tipo;
  S.filtros.tipos.has(k) ? S.filtros.tipos.delete(k) : S.filtros.tipos.add(k);
  c.setAttribute('aria-pressed', String(S.filtros.tipos.has(k)));
  aplicarFiltros();
});
$('#limpar-filtros').addEventListener('click', limparFiltros);
$('#enquadrar').addEventListener('click', () => S.cidade && seguro('Mapa (enquadrar)', () => S.cidade.enquadrarTudo(paddingMapa())));
$('#faixa-selecao-todos').addEventListener('click', () => { S.filtroIds = null; S.filtroOrigem = null; painelSel.receber(null); aplicarFiltros(); });
$('#lista').addEventListener('click', (e) => { if (e.target.closest('[data-acao="limpar-filtros"]')) limparFiltros(); });
let destacadoLista = null;
function destacarDaLista(id) {
  // mouseover dispara a cada filho do card: só repassa ao mapa quando o card muda
  if (id === destacadoLista) return;
  destacadoLista = id;
  if (S.cidade) seguro('Mapa (destaque)', () => S.cidade.destacar(id));
}
$('#lista').addEventListener('mouseover', (e) => destacarDaLista(e.target.closest('[data-id]')?.dataset.id ?? null));
$('#lista').addEventListener('mouseleave', () => destacarDaLista(null));

// coração em qualquer lugar (lista, ficha, espelho)
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-coracao]');
  if (!b) return;
  e.preventDefault();
  const id = b.dataset.coracao;
  const agora = loja.alternar(id);
  const nome = descreverItem(id)?.titulo || id;
  aviso(agora ? `${nome} entrou na seleção do cliente.` : `${nome} saiu da seleção.`, 'ok', agora ? { acao: { rotulo: 'Ver seleção', fn: () => painelSel.abrir() } } : {});
});

$('#sel-lanc').addEventListener('change', (e) => { location.hash = `#/predio/${e.target.value}`; });
$$('[data-modo-predio]').forEach((b) => b.addEventListener('click', () => {
  pressionar('[data-modo-predio]', b);
  S.modoPredio = b.dataset.modoPredio;
  if (S.predio) seguro('Prédio (modo)', () => S.predio.modo(S.modoPredio));
  renderEspelho();
}));
$$('[data-cam]').forEach((b) => b.addEventListener('click', () => {
  if (!S.predio) return;
  sairDaVista();
  seguro('Prédio (câmera)', () => S.predio.camera(b.dataset.cam));
  $('#b-girar').setAttribute('aria-pressed', 'false');
  seguro('Prédio (girar)', () => S.predio.girar(false));
}));
$('#b-contorno').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  if (S.predio) seguro('Prédio (contorno)', () => S.predio.contorno(on));
});
$('#b-girar').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  if (S.predio) seguro('Prédio (girar)', () => S.predio.girar(on));
  atualizarVistaUI(); // girar sai da vista da janela
});

// cliques no 3D chegam via hash; marca a origem para não girar a câmera à toa
$('#cena-predio').addEventListener('pointerup', () => { S.origemClique = '3d'; setTimeout(() => { if (S.origemClique === '3d') S.origemClique = null; }, 300); });

// ------------------------------------------------------------------ teclado
instalarTeclado({
  girar: (d) => (S.vista === 'predio' ? S.predio && seguro('Prédio (girar)', () => S.predio.girarPasso(d)) : S.cidade && seguro('Mapa (girar)', () => S.cidade.girar(d))),
  inclinar: (d) => (S.vista === 'predio' ? S.predio && seguro('Prédio (inclinar)', () => S.predio.inclinar(d)) : S.cidade && seguro('Mapa (inclinar)', () => S.cidade.inclinar(d))),
  norte: () => (S.vista === 'predio' ? S.predio && seguro('Prédio (norte)', () => S.predio.norte()) : S.cidade && seguro('Mapa (norte)', () => S.cidade.norte())),
  visao: (v) => {
    if (S.cfg.visao !== v) mudarConfig({ visao: v });
    if (S.vista === 'predio') aviso(`Mapa em ${v.toUpperCase()}. Vale na vista Cidade.`, 'info', { ms: 2500 });
  },
  sol: () => painelSol.alternar(),
  lista: alternarPainelEsq,
  busca: irParaBusca,
  atalhos: () => atalhos.alternar(),
  esc: () => {
    // fecha a camada mais de cima; devolve true se fechou algo
    if (atalhos.aberto()) { atalhos.fechar(); return true; }
    if (painelConfig.aberto()) { painelConfig.fechar(); return true; }
    if (painelSel.aberto()) { painelSel.fechar(); return true; }
    if (painelSol.aberto()) { painelSol.fechar(); return true; }
    if (S.vista === 'predio' && sairDaVista()) return true;
    if (gaveta.classList.contains('aberta')) { fecharViaRota(); return true; }
    return false;
  },
});

// ------------------------------------------------------------------ boot
function montarFiltros() {
  $('#f-tipos').innerHTML = TIPOS.map(([k, n]) => `<button type="button" class="chip" data-tipo="${k}" aria-pressed="false">${icone(k, { tamanho: 14 })}${n}</button>`).join('');
  const bairros = [...new Set(S.itens.map((i) => i.ref.bairro))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  $('#f-bairro').insertAdjacentHTML('beforeend', bairros.map((b) => `<option>${esc(b)}</option>`).join(''));
  $('#sel-lanc').innerHTML = S.lancamentos.map((l) => `<option value="${esc(l.id)}">${esc(l.nome)}</option>`).join('');
}

async function carregarJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${url} respondeu HTTP ${resp.status}`);
  const texto = await resp.text();
  if (!texto.trim()) throw new Error(`${url} está vazio`);
  try {
    return JSON.parse(texto);
  } catch (err) {
    console.error('[dados]', err);
    throw new Error(`${url} não é um JSON válido (${err.message})`);
  }
}

function falhaFatal(msg) {
  $('#carregando-texto').textContent = msg;
  $('.spinner').hidden = true;
  $('#carregando').classList.add('falha');
}

async function iniciar() {
  montarControleModo(); // o controle aparece já no carregamento; o selo muda quando os dados chegam
  painelConfig.sincronizar(S.cfg);
  bussolaCidade.atualizarVisao(S.cfg.visao);
  medidor.ligar(S.cfg.medidor);
  painelSol.iniciar(); // calcula o sol inicial (hoje, 20:00) antes de abrir o mapa

  // Os lançamentos de demonstração vêm sempre (aba Prédio); os imóveis vêm do modo escolhido.
  let im = null, la, real = null;
  try {
    const pedidos = [carregarJSON('dados/lancamentos.json')];
    if (S.modoDados === 'real') pedidos.push(carregarJSON(URL_REAL).then(normalizarReal));
    const [rLa, rReal] = await Promise.allSettled(pedidos);
    if (rLa.status === 'rejected') throw rLa.reason;
    la = rLa.value;
    if (rReal?.status === 'fulfilled') real = rReal.value;
    else if (rReal) voltarParaDemo(rReal.reason);
    if (!real) im = await carregarJSON('dados/imoveis.json');
  } catch (err) {
    console.error('[dados]', err);
    falhaFatal(`Falha ao carregar os dados: ${err.message}`);
    return;
  }
  S.lancamentos = la.lancamentos;
  S.lancPorId = Object.fromEntries(S.lancamentos.map((l) => [l.id, l]));
  if (real) {
    S.imoveis = real.itens;
    S.corretores = {};
    S.itens = real.itens.map((r) => ({ id: r.id, tipo: r.tipo, finalidade: r.finalidade, lat: r.lat, lng: r.lng, ref: r, real: true }));
    if (real.descartados.length) {
      console.error('[dados-reais]', new Error(`${real.descartados.length} anúncio(s) descartado(s) na validação`), real.descartados);
      const ex = real.descartados.slice(0, 3).map((d) => `${d.id} (${d.motivo})`).join('; ');
      aviso(`${real.descartados.length} anúncio(s) com dados inválidos ficaram fora do mapa: ${ex}${real.descartados.length > 3 ? '…' : ''}.`, 'erro');
    }
  } else {
    S.imoveis = im.imoveis;
    S.corretores = Object.fromEntries(im.corretores.map((c) => [c.id, c]));
    S.itens = [
      ...S.lancamentos.map((l) => ({ id: `L:${l.id}`, tipo: 'lancamento', finalidade: 'lancamento', lat: l.lat, lng: l.lng, ref: l })),
      ...S.imoveis.map((i) => ({ id: i.id, tipo: i.tipo, finalidade: i.finalidade, lat: i.lat, lng: i.lng, ref: i })),
    ];
  }
  S.imovelPorId = Object.fromEntries(S.imoveis.map((i) => [i.id, i]));
  for (const it of S.itens) {
    const r = it.ref;
    it.textoBusca = semAcento(it.real ? textoBuscaReal(r) : [it.id, r.titulo, r.nome, r.bairro, NOME_TIPO[it.tipo], ...(r.caracteristicas || [])].join(' '));
  }
  aplicarModoNaTela(real?.meta);
  S.itemPorId = Object.fromEntries(S.itens.map((i) => [i.id, i]));
  montarFiltros();
  painelSel.render();

  try {
    S.cidade = await criarCidade({
      container: $('#mapa'),
      camadaEtiquetas: $('#etiquetas'),
      itens: S.itens.map((i) => ({ id: i.id, tipo: i.tipo, finalidade: i.finalidade, lat: i.lat, lng: i.lng, rotulo: rotuloPreco(i) })),
      config: configResolvida(S.cfg),
      sol: S.sol.pos,
      eventos: {
        aoPassar(id, x, y) {
          if (!id) return mostrarDica(null);
          const it = S.itemPorId[id];
          if (!it) return mostrarDica(null);
          mostrarDica(`<b>${esc(rotuloPreco(it))}</b> · ${esc(tituloItem(it))} · ${esc(it.ref.bairro)}`, x, y);
        },
        aoClicar(id) { location.hash = hashItem(id); },
        aoErro(msg) { aviso(msg, 'erro'); },
        aoPronto() { $('#carregando').classList.add('saindo'); },
        aoMudarCamera(cam) { bussolaCidade.atualizarCamera(cam); },
      },
    });
  } catch (err) {
    console.error('[mapa]', err);
    falhaFatal(`Falha ao abrir o mapa: ${err.message}`);
    return;
  }
  // Config e sol mudados enquanto o estilo baixava só ficaram em S (criarCidade copiou os valores da chamada).
  seguro('Mapa (configuração)', () => S.cidade.configurar(configResolvida(S.cfg)));
  if (S.sol.pos) seguro('Mapa (sol)', () => S.cidade.sol(S.sol.pos));
  aplicarFiltrosAgora();
  aplicarRota();
  window.__atlas = S; // alça de depuração (console)
}

iniciar();
