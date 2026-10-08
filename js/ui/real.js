// Modo "Anúncios reais": validação do dados/real/imoveis.json, rótulos de preço e HTML do card e da ficha.
// Tudo que vem do JSON é texto de terceiros: passa por esc() antes de virar HTML, e link ou foto só entra
// se for http(s). Campo ausente não aparece (nada de "null", "undefined" ou "R$ 0" na tela).
import { fmtReais, fmtArea, fmtCurto, fmtData } from '../fluxo.js';
import { icone } from '../icones-ui.js';
import { esc, linkAbsoluto } from './util.js';
import { NOME_TIPO, NOME_FIN, ICONE_FIN, botaoCoracao, blocoCompartilhar } from './fichas.js';

export const URL_REAL = 'dados/real/imoveis.json';
export const MAX_FOTOS = 6;
const FINALIDADES = new Set(['venda', 'locacao', 'lancamento']);
const TIPOS = new Set(['apartamento', 'casa', 'cobertura', 'terreno', 'comercial', 'lancamento']);
// perímetro de Montes Claros (contrato v3 §3): ponto fora disso jogaria o voo do mapa para longe
const PERIMETRO = { latMin: -16.80, latMax: -16.64, lngMin: -43.93, lngMax: -43.78 };
const ID_VALIDO = /^[A-Za-z0-9_-]{1,40}$/;   // vai para a rota (#/imovel/ID) e para o link de seleção
const DATA_ISO = /^\d{4}-\d{2}(-\d{2})?$/;

const positivo = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const texto = (s) => (typeof s === 'string' && s.trim() ? s.trim() : null);
const dataBr = (iso) => (typeof iso === 'string' && DATA_ISO.test(iso) ? fmtData(iso) : null);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

/** URL de terceiro só se for http(s); qualquer outra coisa (javascript:, data:, relativa) vira null. */
export function urlSegura(u) {
  const s = texto(u);
  if (!s || !URL.canParse(s)) return null;
  const url = new URL(s);
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
}

function problemaItem(r, vistos) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'não é um objeto';
  if (typeof r.id !== 'string' || !ID_VALIDO.test(r.id)) return `id inválido (${JSON.stringify(r.id)})`;
  if (vistos.has(r.id)) return 'id repetido';
  if (!FINALIDADES.has(r.finalidade)) return `finalidade desconhecida (${r.finalidade})`;
  if (!TIPOS.has(r.tipo)) return `tipo desconhecido (${r.tipo})`;
  if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return 'sem coordenadas';
  if (r.lat <= PERIMETRO.latMin || r.lat >= PERIMETRO.latMax || r.lng <= PERIMETRO.lngMin || r.lng >= PERIMETRO.lngMax) {
    return `fora de Montes Claros (${r.lat}, ${r.lng})`;
  }
  if (!texto(r.bairro)) return 'sem bairro';
  return null;
}

/**
 * Valida o JSON dos anúncios reais. Lança Error com o motivo se não der para usar nada.
 * → { meta, itens, descartados: [{ id, motivo }] }
 */
export function normalizarReal(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.imoveis)) throw new Error('formato inesperado: falta a lista "imoveis"');
  const itens = [];
  const descartados = [];
  const vistos = new Set();
  json.imoveis.forEach((r, k) => {
    const motivo = problemaItem(r, vistos);
    if (motivo) { descartados.push({ id: typeof r?.id === 'string' ? r.id : `item ${k + 1}`, motivo }); return; }
    vistos.add(r.id);
    // lançamento é sempre tipo e finalidade "lancamento" no mapa (ícone de torre com grua)
    itens.push(r.finalidade === 'lancamento' || r.tipo === 'lancamento' ? { ...r, tipo: 'lancamento', finalidade: 'lancamento' } : r);
  });
  if (!itens.length) {
    throw new Error(json.imoveis.length
      ? `nenhum dos ${json.imoveis.length} anúncios passou na validação (${descartados[0].id}: ${descartados[0].motivo})`
      : 'o arquivo não tem nenhum anúncio');
  }
  const meta = json.meta && typeof json.meta === 'object' && !Array.isArray(json.meta) ? json.meta : {};
  return { meta, itens, descartados };
}

// ------------------------------------------------------------------ valores derivados
const unidadesDe = (r) => (Array.isArray(r.unidades) ? r.unidades.filter((u) => u && typeof u === 'object') : []);

function menorDasUnidades(r, campo) {
  const v = unidadesDe(r).map((u) => u[campo]).filter(positivo);
  return v.length ? Math.min(...v) : null;
}

/** Preço de referência (venda/lançamento) ou aluguel (locação), em reais; null = sob consulta. */
export function valorReal(r) {
  if (r.finalidade === 'locacao') return positivo(r.aluguel) ? r.aluguel : menorDasUnidades(r, 'aluguel');
  return positivo(r.preco) ? r.preco : menorDasUnidades(r, 'preco');
}

/** "a partir de": lançamento ou prédio com várias unidades anunciadas. */
export const ehAPartir = (r) => r.finalidade === 'lancamento' || unidadesDe(r).length > 1;

export function rotuloPrecoReal(r) {
  const v = valorReal(r);
  if (v === null) return 'sob consulta';
  const base = r.finalidade === 'locacao' ? `${fmtCurto(v)}/mês` : fmtCurto(v);
  return ehAPartir(r) ? `a partir de ${base}` : base;
}

export function quartosReal(r) {
  return Math.max(positivo(r.quartos) ? r.quartos : 0, ...unidadesDe(r).map((u) => (positivo(u.quartos) ? u.quartos : 0)));
}

export function areaReal(r) {
  if (positivo(r.area_m2)) return r.area_m2;
  if (positivo(r.area_terreno_m2)) return r.area_terreno_m2;
  const v = unidadesDe(r).map((u) => u.area_m2).filter(positivo);
  return v.length ? Math.max(...v) : null;
}

export const dataReal = (r) => texto(r.fonte?.publicado_em) || texto(r.coletado_em) || '';
export const nUnidades = (r) => unidadesDe(r).length;

export function textoBuscaReal(r) {
  const outras = Array.isArray(r.outras_fontes) ? r.outras_fontes.flatMap((o) => [o?.site, o?.anunciante]) : [];
  return [r.id, r.titulo, r.bairro, r.rua, r.predio, r.construtora, NOME_TIPO[r.tipo], NOME_FIN[r.finalidade],
    r.fonte?.site, r.fonte?.anunciante, r.fonte?.codigo, ...(Array.isArray(r.caracteristicas) ? r.caracteristicas : []), ...outras]
    .filter((x) => typeof x === 'string' || typeof x === 'number').join(' ');
}

/** Fotos utilizáveis: só http(s), no máximo MAX_FOTOS. */
export function fotosReais(r) {
  const fotos = Array.isArray(r.fotos) ? r.fotos : [];
  return fotos
    .map((f) => (typeof f === 'string' ? { url: f } : f))
    .filter((f) => f && urlSegura(f.url))
    .slice(0, MAX_FOTOS)
    .map((f) => ({ url: urlSegura(f.url), credito: texto(f.credito) }));
}

const titulo = (r) => texto(r.titulo) || `${NOME_TIPO[r.tipo] || 'Imóvel'} no ${r.bairro}`;
const imgFoto = (url, alt) => `<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-foto>`;

// ------------------------------------------------------------------ card da lista
/** Miniatura do card: foto da fonte (lazy) sobre o ícone do tipo; contador quando agrupa unidades. */
export function htmlThumbReal(r) {
  const f = fotosReais(r)[0];
  const n = nUnidades(r);
  return `<span class="thumb ${esc(r.finalidade)}${f ? ' com-foto' : ''}">${icone(r.tipo, { tamanho: 24 })}${f ? imgFoto(f.url, '') : ''}${n > 1 ? `<span class="thumb-un" title="${n} unidades anunciadas neste prédio">${n}</span>` : ''}</span>`;
}

export function metaCardReal(r) {
  const m = [`<span>${icone('pin', { tamanho: 12 })}${esc(r.bairro)}</span>`];
  const area = areaReal(r);
  if (area) m.push(`<span>${icone('area', { tamanho: 12 })}${fmtArea(area)}</span>`);
  const q = quartosReal(r);
  if (q) m.push(`<span>${icone('cama', { tamanho: 12 })}${q}</span>`);
  if (positivo(r.vagas)) m.push(`<span>${icone('carro', { tamanho: 12 })}${r.vagas}</span>`);
  const n = nUnidades(r);
  if (n > 1) m.push(`<span>${icone('andar', { tamanho: 12 })}${plural(n, 'unidade', 'unidades')}</span>`);
  return m.join('');
}

// ------------------------------------------------------------------ ficha
function htmlGaleria(r, fotos) {
  const n = fotos.length;
  const site = texto(r.fonte?.site);
  const anunciante = texto(r.fonte?.anunciante);
  const slides = fotos.map((f, i) => {
    const quem = f.credito || anunciante;
    // o crédito coletado às vezes já cita o site ("X via OLX") ou é o próprio site: não repetir
    const jaCita = quem && site && quem.toLowerCase().includes(site.toLowerCase());
    const credito = quem && site && !jaCita ? `Foto: ${quem} via ${site}` : quem ? `Foto: ${quem}` : site ? `Foto via ${site}` : 'Foto do anúncio original';
    return `<figure class="gal-foto" role="group" aria-roledescription="foto" aria-label="${i + 1} de ${n}">
        ${imgFoto(f.url, `Foto ${i + 1} de ${n}: ${titulo(r)}`)}
        <span class="gal-falha" hidden>${icone('alerta', { tamanho: 22 })}Foto indisponível na fonte</span>
        <figcaption>${esc(credito)}</figcaption></figure>`;
  }).join('');
  const setas = n > 1
    ? `<button class="gal-seta esq" type="button" data-acao="gal-ant" aria-label="Foto anterior">${icone('esq', { tamanho: 20 })}</button>
       <button class="gal-seta dir" type="button" data-acao="gal-prox" aria-label="Próxima foto">${icone('dir', { tamanho: 20 })}</button>`
    : '';
  return `<div class="gal" data-gal data-i="0" data-n="${n}">
      <div class="gal-trilho" tabindex="0" role="region" aria-roledescription="carrossel" aria-label="Fotos do anúncio (${n})">${slides}</div>
      ${setas}<span class="gal-cont" aria-live="polite">1/${n}</span></div>`;
}

function htmlPreco(r) {
  const v = valorReal(r);
  const aPartir = ehAPartir(r);
  if (r.finalidade === 'locacao') {
    if (v === null) return '<div class="det-preco"><small>Aluguel</small><strong>Sob consulta</strong><span>Valor não informado no anúncio</span></div>';
    const linhas = [`<tr><td>Aluguel</td><td>${fmtReais(v)}</td></tr>`];
    let total = v;
    const faltam = [];
    if (positivo(r.condominio)) { linhas.push(`<tr><td>Condomínio</td><td>${fmtReais(r.condominio)}</td></tr>`); total += r.condominio; } else faltam.push('condomínio');
    if (positivo(r.iptu_anual)) {
      // custo mensal da locação: aluguel + condomínio + IPTU anual ÷ 12 (mesma regra da demonstração)
      const iptuMes = Math.round(r.iptu_anual / 12);
      linhas.push(`<tr><td>IPTU <small>${fmtReais(r.iptu_anual)}/ano ÷ 12</small></td><td>${fmtReais(iptuMes)}</td></tr>`);
      total += iptuMes;
    } else faltam.push('IPTU');
    if (total !== v) linhas.push(`<tr class="total"><td>Total mensal</td><td>${fmtReais(total)}</td></tr>`);
    return `<div class="det-preco"><small>${aPartir ? 'Aluguel a partir de' : 'Aluguel'}</small><strong>${fmtReais(v)}<span class="por-mes"> /mês</span></strong></div>
      <table class="tabela">${linhas.join('')}</table>
      ${faltam.length ? `<p class="nota nota-fina">${faltam.join(' e ')} não ${faltam.length > 1 ? 'informados' : 'informado'} no anúncio.</p>` : ''}`;
  }
  const rotulo = r.finalidade === 'lancamento' ? 'A partir de' : aPartir ? 'A partir de' : 'Valor de venda';
  if (v === null) return `<div class="det-preco"><small>${rotulo}</small><strong>Sob consulta</strong><span>Preço não informado no anúncio</span></div>`;
  const area = positivo(r.area_m2) ? r.area_m2 : null;
  const m2 = area && !aPartir ? `<span>${fmtReais(v / area)} por m²</span>` : '';
  const linhas = [];
  if (positivo(r.condominio)) linhas.push(`<tr><td>Condomínio</td><td>${fmtReais(r.condominio)}/mês</td></tr>`);
  if (positivo(r.iptu_anual)) linhas.push(`<tr><td>IPTU</td><td>${fmtReais(r.iptu_anual)}/ano</td></tr>`);
  return `<div class="det-preco"><small>${rotulo}</small><strong>${fmtReais(v)}</strong>${m2}</div>
    ${linhas.length ? `<table class="tabela">${linhas.join('')}</table>` : ''}`;
}

function htmlSpecs(r) {
  const s = [];
  if (r.tipo === 'terreno') {
    const a = positivo(r.area_terreno_m2) ? r.area_terreno_m2 : positivo(r.area_m2) ? r.area_m2 : null;
    if (a) s.push(['terreno', 'Terreno', fmtArea(a), '']);
  } else if (positivo(r.area_m2)) {
    s.push(['area', 'Área', fmtArea(r.area_m2), positivo(r.area_terreno_m2) ? `terreno ${fmtArea(r.area_terreno_m2)}` : '']);
  } else if (positivo(r.area_terreno_m2)) s.push(['terreno', 'Terreno', fmtArea(r.area_terreno_m2), '']);
  if (positivo(r.quartos)) s.push(['cama', 'Quartos', r.quartos, positivo(r.suites) ? plural(r.suites, 'suíte', 'suítes') : '']);
  if (positivo(r.banheiros)) s.push(['banho', 'Banheiros', r.banheiros, '']);
  if (positivo(r.vagas)) s.push(['carro', 'Vagas', r.vagas, '']);
  if (Number.isInteger(r.andar) && r.andar >= 0) s.push(['andar', 'Andar', r.andar === 0 ? 'Térreo' : `${r.andar}º`, '']);
  s.push([r.tipo, 'Tipo', NOME_TIPO[r.tipo], '']);
  return `<div class="det-specs">${s.map(([ic, a, b, c]) => `<div>${icone(ic, { tamanho: 18, classe: 'spec-ic' })}<small>${a}</small><b>${esc(b)}</b>${c ? `<em>${esc(c)}</em>` : ''}</div>`).join('')}</div>`;
}

function htmlLancamentoInfo(r) {
  const construtora = texto(r.construtora);
  const entrega = dataBr(r.entrega_prevista);
  const linhas = [];
  if (construtora) linhas.push(`<tr><td>Construtora</td><td>${esc(construtora)}</td></tr>`);
  if (entrega) linhas.push(`<tr><td>Entrega prevista</td><td>${entrega}</td></tr>`);
  return `${linhas.length ? `<table class="tabela">${linhas.join('')}</table>` : ''}
    <p class="nota nota-caixa">${icone('info', { tamanho: 14 })}Sem espelho de vendas 3D: o anúncio não traz a tabela de unidades. Os espelhos da aba Prédio são de demonstração.</p>`;
}

function htmlUnidades(r) {
  const us = unidadesDe(r);
  if (!us.length) return '';
  const lanc = r.finalidade === 'lancamento';
  const linhas = us.map((u, i) => {
    const det = [positivo(u.area_m2) ? fmtArea(u.area_m2) : null, positivo(u.quartos) ? plural(u.quartos, 'quarto', 'quartos') : null].filter(Boolean).join(' · ');
    const valor = positivo(u.preco) ? fmtReais(u.preco) : positivo(u.aluguel) ? `${fmtReais(u.aluguel)}/mês` : 'sob consulta';
    const url = urlSegura(u.url);
    const rot = texto(u.rotulo) || `${lanc ? 'Planta' : 'Unidade'} ${i + 1}`;
    return `<tr><td>${esc(rot)}${det ? `<small>${esc(det)}</small>` : ''}</td><td>${valor}${url ? `<a class="un-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Ver anúncio${icone('externo', { tamanho: 12 })}</a>` : ''}</td></tr>`;
  }).join('');
  const tit = lanc ? 'Plantas do lançamento' : 'Unidades neste prédio';
  return `<section class="det-sec"><div class="sec-tit">${icone('andar', { tamanho: 14 })}${tit} · ${us.length}</div><table class="tabela tab-un">${linhas}</table></section>`;
}

function htmlFontes(r) {
  const f = r.fonte && typeof r.fonte === 'object' ? r.fonte : {};
  const site = texto(f.site) || 'Fonte';
  const det = [texto(f.anunciante), texto(f.codigo) ? `cód. ${texto(f.codigo)}` : null, dataBr(f.publicado_em) ? `publicado em ${dataBr(f.publicado_em)}` : null]
    .filter(Boolean).map(esc).join(' · ');
  const url = urlSegura(f.url);
  const principal = url
    ? `<a class="fonte-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><span><b>${esc(site)}</b>${det ? `<small>${det}</small>` : ''}</span>${icone('externo', { tamanho: 16 })}</a>`
    : `<div class="fonte-link sem-link"><span><b>${esc(site)}</b>${det ? `<small>${det}</small>` : ''}<small>Link do anúncio indisponível</small></span></div>`;
  const outras = (Array.isArray(r.outras_fontes) ? r.outras_fontes : []).filter((o) => o && typeof o === 'object').map((o) => {
    const u = urlSegura(o.url);
    const nome = [texto(o.site), texto(o.anunciante)].filter(Boolean).map(esc).join(' · ') || 'Outro anúncio';
    const preco = positivo(o.preco) ? ` · ${fmtReais(o.preco)}` : positivo(o.aluguel) ? ` · ${fmtReais(o.aluguel)}/mês` : '';
    return `<li>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${nome}${preco}${icone('externo', { tamanho: 12 })}</a>` : `<span>${nome}${preco}</span>`}</li>`;
  });
  const coletado = dataBr(r.coletado_em);
  return `<section class="det-sec fontes">
      <div class="sec-tit">${icone('link', { tamanho: 14 })}Onde está anunciado</div>
      ${principal}
      ${outras.length ? `<p class="fonte-sub">Também anunciado por</p><ul class="fonte-outras">${outras.join('')}</ul>` : ''}
      <p class="nota">${coletado ? `Coletado em ${coletado}. ` : ''}Confirme preço e disponibilidade no anúncio original.</p></section>`;
}

/** Texto para WhatsApp e "Copiar ficha" de um anúncio real. */
export function textoImovelReal(r, { comLink = true } = {}) {
  const specs = [areaReal(r) ? fmtArea(areaReal(r)) : null, quartosReal(r) ? plural(quartosReal(r), 'quarto', 'quartos') : null,
    positivo(r.vagas) ? plural(r.vagas, 'vaga', 'vagas') : null].filter(Boolean).join(' · ');
  const linhas = [`${titulo(r)} · ${r.bairro}, Montes Claros`, `${NOME_FIN[r.finalidade]}: ${rotuloPrecoReal(r)}`];
  if (specs) linhas.push(specs);
  const url = urlSegura(r.fonte?.url);
  if (url) linhas.push(`Anúncio original (${texto(r.fonte?.site) || 'fonte'}): ${url}`);
  if (comLink) linhas.push(linkAbsoluto(`#/imovel/${r.id}`));
  return linhas.join('\n');
}

export function htmlImovelReal(r, { naSelecao, share }) {
  const fotos = fotosReais(r);
  const aprox = r.precisao_local === 'bairro';
  const capa = fotos.length
    ? htmlGaleria(r, fotos)
    : `<div class="det-capa ${esc(r.finalidade)}">${icone(r.tipo, { tamanho: 56, classe: 'capa-ic' })}<span class="sem-foto">Anúncio sem fotos</span></div>`;
  const local = [texto(r.rua), r.bairro].filter(Boolean).map(esc).join(', ');
  const predio = texto(r.predio);
  const chips = (Array.isArray(r.caracteristicas) ? r.caracteristicas : []).map(texto).filter(Boolean);
  const descricao = texto(r.descricao);
  return `<div class="det det-real">
    ${capa}
    <div class="det-topo">
      <div class="det-kicker"><span class="badge ${esc(r.finalidade)}">${icone(ICONE_FIN[r.finalidade], { tamanho: 13 })}${NOME_FIN[r.finalidade]}</span><span>Cód. ${esc(r.id)}</span>
        ${aprox ? `<span class="badge aprox" title="Posição no mapa pelo centro do bairro, com pequeno deslocamento. O endereço só aparece no anúncio original.">${icone('pin', { tamanho: 13 })}Localização aproximada</span>` : ''}</div>
      ${botaoCoracao(r.id, naSelecao, 'grande')}
    </div>
    <h2>${esc(titulo(r))}</h2>
    <p class="det-loc">${icone('pin', { tamanho: 14 })}${local}, Montes Claros${predio ? ` · ${esc(predio)}` : ''}</p>
    ${htmlPreco(r)}
    ${r.finalidade === 'lancamento' ? htmlLancamentoInfo(r) : ''}
    ${htmlSpecs(r)}
    ${chips.length ? `<div class="det-chips">${chips.map((x) => `<span>${icone('check', { tamanho: 12 })}${esc(x)}</span>`).join('')}</div>` : ''}
    ${descricao ? `<p class="det-texto">${esc(descricao)}</p>` : ''}
    ${htmlUnidades(r)}
    ${htmlFontes(r)}
    ${blocoCompartilhar({
    share, texto: textoImovelReal(r), acaoCopiar: 'data-acao="copiar-ficha"', rotuloCopiar: 'Copiar ficha',
    extra: `<a class="btn" href="https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}" target="_blank" rel="noopener">${icone('externo', { tamanho: 16 })}${aprox ? 'Maps (aprox.)' : 'Abrir no Maps'}</a>`,
  })}</div>`;
}

/** Texto do selo e da dica do topo no modo real. */
export function resumoMeta(meta, nItens) {
  const data = dataBr(meta?.coletado_em);
  const sites = (Array.isArray(meta?.fontes) ? meta.fontes : [])
    .filter((f) => f && texto(f.site) && f.status !== 'bloqueado').map((f) => texto(f.site));
  const selo = data ? `Anúncios reais · ${data}` : 'Anúncios reais';
  const dica = `${plural(nItens, 'imóvel único', 'imóveis únicos')} de anúncios públicos de Montes Claros${sites.length ? ` (${sites.join(', ')})` : ''}${data ? `, coletados em ${data}` : ''}, sem duplicatas. Fotos e textos pertencem aos anunciantes; cada ficha traz o link do anúncio original.`;
  const aviso = texto(meta?.aviso) || 'Anúncios públicos. Fotos e textos pertencem aos anunciantes.';
  return { selo, dica, aviso };
}
