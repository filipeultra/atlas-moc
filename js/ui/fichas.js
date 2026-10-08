// HTML das fichas (imóvel, lançamento, unidade) e textos para compartilhar.
import { calcularFluxo, fmtCentavos, fmtReais, fmtArea, fmtData } from '../fluxo.js';
import { icone } from '../icones-ui.js';
import { rotuloOrientacao } from '../sol.js';
import { esc, linkAbsoluto, linkWhatsApp } from './util.js';
import { insolacaoUnidade, fmtDuracao, fmtDiaMes, fmtFaixas } from './insolacao.js';
import { HORA_MIN, HORA_MAX } from './sol-painel.js';

export const TIPOS = [
  ['apartamento', 'Apartamento'], ['casa', 'Casa'], ['cobertura', 'Cobertura'],
  ['terreno', 'Terreno'], ['comercial', 'Comercial'], ['lancamento', 'Lançamento'],
];
export const NOME_TIPO = Object.fromEntries(TIPOS);
export const NOME_STATUS = { disponivel: 'Disponível', vendida: 'Vendida', reservada: 'Reservada' };
export const NOME_FIN = { venda: 'Venda', locacao: 'Locação', lancamento: 'Lançamento' };
export const ICONE_FIN = { todos: 'camadas', venda: 'etiqueta', locacao: 'calendario', lancamento: 'lancamento' };

const num = (n) => String(n).replace('.', ',');

export function resumoLanc(l) {
  const c = { vendida: 0, reservada: 0, disponivel: 0 };
  for (const u of l.unidades) c[u.status]++;
  const disp = l.unidades.filter((u) => u.status === 'disponivel');
  const aPartir = disp.length ? Math.min(...disp.map((u) => u.valor_tabela_centavos)) : null;
  return { ...c, total: l.unidades.length, pctVendido: (100 * c.vendida) / l.unidades.length, aPartir };
}

export function botaoCoracao(id, naSelecao, extra = '') {
  return `<button class="coracao ${extra}" type="button" data-coracao="${esc(id)}" aria-pressed="${naSelecao}" aria-label="Guardar na seleção do cliente" title="Seleção do cliente">${icone('coracao', { tamanho: 18 })}</button>`;
}

/** Ações de compartilhar: nativo quando existe; WhatsApp e copiar sempre (corretor usa os dois). */
export function blocoCompartilhar({ share, texto, acaoCopiar, rotuloCopiar, rotuloZap = 'Enviar ao cliente pelo WhatsApp', extra = '' }) {
  return `<div class="acoes">
    ${share ? `<button class="btn prim" type="button" data-acao="compartilhar">${icone('compartilhar', { tamanho: 16 })}Compartilhar</button>` : ''}
    <a class="btn zap" href="${linkWhatsApp(texto)}" target="_blank" rel="noopener">${icone('whatsapp', { tamanho: 16 })}${rotuloZap}</a>
    <div class="lado">
      <button class="btn" type="button" ${acaoCopiar}>${icone('copiar', { tamanho: 16 })}${rotuloCopiar}</button>
      ${extra}
    </div></div>`;
}

// ------------------------------------------------------------------ imóvel avulso
export function textoImovel(i, { comLink = true } = {}) {
  const preco = i.finalidade === 'venda' ? fmtReais(i.preco) : `${fmtReais(i.aluguel)}/mês`;
  const linhas = [`${i.titulo} · ${i.bairro}, Montes Claros`, `${NOME_FIN[i.finalidade]}: ${preco}`,
    `${fmtArea(i.area_m2)}${i.quartos ? ` · ${i.quartos} quartos` : ''}${i.vagas ? ` · ${i.vagas} vagas` : ''}`, `Cód. ${i.id}`];
  if (comLink) linhas.push(linkAbsoluto(`#/imovel/${i.id}`));
  return linhas.join('\n');
}

export function htmlImovel(i, { corretor: c, naSelecao, share }) {
  const venda = i.finalidade === 'venda';
  const specs = [];
  if (i.area_m2) specs.push(['area', 'Área', fmtArea(i.area_m2), i.area_terreno_m2 && i.tipo !== 'terreno' ? `terreno ${fmtArea(i.area_terreno_m2)}` : '']);
  if (i.quartos) specs.push(['cama', 'Quartos', i.quartos, i.suites ? `${i.suites} suíte${i.suites > 1 ? 's' : ''}` : '']);
  if (i.banheiros) specs.push(['banho', 'Banheiros', i.banheiros, '']);
  if (i.vagas) specs.push(['carro', 'Vagas', i.vagas, '']);
  if (i.andar) specs.push(['andar', 'Andar', `${i.andar}º`, '']);
  specs.push([i.tipo, 'Tipo', NOME_TIPO[i.tipo], '']);
  let preco;
  if (venda) {
    preco = `<div class="det-preco"><small>Valor de venda</small><strong>${fmtReais(i.preco)}</strong>
      <span>${fmtReais(i.preco / i.area_m2)} por m²</span></div>
      <table class="tabela">
        ${i.condominio ? `<tr><td>Condomínio</td><td>${fmtReais(i.condominio)}/mês</td></tr>` : ''}
        <tr><td>IPTU</td><td>${fmtReais(i.iptu_anual)}/ano</td></tr></table>`;
  } else {
    // custo mensal da locação: aluguel + condomínio + IPTU anual ÷ 12
    const iptuMes = Math.round(i.iptu_anual / 12);
    const total = i.aluguel + (i.condominio || 0) + iptuMes;
    preco = `<div class="det-preco"><small>Aluguel</small><strong>${fmtReais(i.aluguel)}<span class="por-mes"> /mês</span></strong></div>
      <table class="tabela">
        <tr><td>Aluguel</td><td>${fmtReais(i.aluguel)}</td></tr>
        ${i.condominio ? `<tr><td>Condomínio</td><td>${fmtReais(i.condominio)}</td></tr>` : ''}
        <tr><td>IPTU <small>${fmtReais(i.iptu_anual)}/ano ÷ 12</small></td><td>${fmtReais(iptuMes)}</td></tr>
        <tr class="total"><td>Total mensal</td><td>${fmtReais(total)}</td></tr></table>`;
  }
  return `<div class="det">
    <div class="det-capa ${i.finalidade}">${icone(i.tipo, { tamanho: 56, classe: 'capa-ic' })}<span class="sem-foto">Sem fotos no protótipo</span></div>
    <div class="det-topo">
      <div class="det-kicker"><span class="badge ${i.finalidade}">${icone(ICONE_FIN[i.finalidade], { tamanho: 13 })}${NOME_FIN[i.finalidade]}</span><span>Cód. ${esc(i.id)}</span></div>
      ${botaoCoracao(`${i.id}`, naSelecao, 'grande')}
    </div>
    <h2>${esc(i.titulo)}</h2>
    <p class="det-loc">${icone('pin', { tamanho: 14 })}${esc(i.bairro)}, Montes Claros · endereço exato sob consulta</p>
    ${preco}
    <div class="det-specs">${specs.map(([ic, a, b, c2]) => `<div>${icone(ic, { tamanho: 18, classe: 'spec-ic' })}<small>${a}</small><b>${esc(b)}</b>${c2 ? `<em>${esc(c2)}</em>` : ''}</div>`).join('')}</div>
    <div class="det-chips">${i.caracteristicas.map((x) => `<span>${icone('check', { tamanho: 12 })}${esc(x)}</span>`).join('')}</div>
    <p class="det-texto">${esc(i.descricao)}</p>
    <div class="det-corretor"><div class="avatar" style="background:${esc(c.cor)}">${esc(c.nome.split(' ').map((p) => p[0]).join(''))}</div>
      <div><b>${esc(c.nome)}</b><small>${esc(c.creci)} · atualizado em ${fmtData(i.atualizado_em)}</small></div></div>
    ${blocoCompartilhar({
    share, texto: textoImovel(i), acaoCopiar: 'data-acao="copiar-ficha"', rotuloCopiar: 'Copiar ficha',
    extra: `<a class="btn" href="https://www.google.com/maps/search/?api=1&query=${i.lat},${i.lng}" target="_blank" rel="noopener">${icone('externo', { tamanho: 16 })}Abrir no Maps</a>`,
  })}</div>`;
}

// ------------------------------------------------------------------ lançamento
export function textoLancamento(l, { comLink = true } = {}) {
  const r = resumoLanc(l);
  const linhas = [`${l.nome} · ${l.bairro}, Montes Claros`, `Lançamento de ${l.construtora}, entrega prevista ${fmtData(l.entrega_prevista)}`,
    r.aPartir ? `A partir de ${fmtCentavos(r.aPartir)} · ${r.disponivel} unidades disponíveis` : 'Esgotado'];
  if (comLink) linhas.push(linkAbsoluto(`#/predio/${l.id}`));
  return linhas.join('\n');
}

export function htmlLancamento(l, { naSelecao, share }) {
  const r = resumoLanc(l);
  const tips = Object.entries(l.tipologias).map(([k, t]) => {
    const us = l.unidades.filter((u) => u.tipologia === k);
    const disp = us.filter((u) => u.status === 'disponivel');
    const min = disp.length ? fmtCentavos(Math.min(...disp.map((u) => u.valor_tabela_centavos))) : 'esgotada';
    return `<tr><td>${esc(t.nome)} <small>${fmtArea(t.area_m2)} · ${disp.length} de ${us.length} disponíveis</small></td><td>${disp.length ? `a partir de<br>${min}` : min}</td></tr>`;
  }).join('');
  const A = l.predio?.orientacao_graus;
  const orient = typeof A === 'number'
    ? `<p class="det-orient">${icone('bussola', { tamanho: 14 })}Fachada principal voltada para ${rotuloOrientacao(A)} (${Math.round(A)}°)</p>` : '';
  return `<div class="det">
    <div class="det-capa lancamento">${icone('lancamento', { tamanho: 56, classe: 'capa-ic' })}<span class="sem-foto">Sem fotos no protótipo</span></div>
    <div class="det-topo">
      <div class="det-kicker"><span class="badge lancamento">${icone('lancamento', { tamanho: 13 })}Lançamento</span><span>${esc(l.construtora)}</span></div>
      ${botaoCoracao(`L:${l.id}`, naSelecao, 'grande')}
    </div>
    <h2>${esc(l.nome)}</h2>
    <p class="det-loc">${icone('pin', { tamanho: 14 })}${esc(l.bairro)}, Montes Claros · entrega prevista ${fmtData(l.entrega_prevista)}</p>
    ${orient}
    <div class="mini-resumo">
      <div><b>${r.disponivel}</b><small>disponíveis</small></div>
      <div><b>${num(r.pctVendido.toFixed(1))}%</b><small>vendido</small></div>
      <div><b>${l.obra.geral_pct}%</b><small>obra</small></div>
    </div>
    <div class="det-preco"><small>A partir de</small><strong>${r.aPartir ? fmtCentavos(r.aPartir) : 'Esgotado'}</strong><span>tabela de ${fmtData(l.tabela_data)}</span></div>
    <table class="tabela">${tips}</table>
    <a class="btn prim grande" href="#/predio/${esc(l.id)}">${icone('cubo', { tamanho: 18 })}Abrir espelho de vendas 3D</a>
    ${blocoCompartilhar({
    share, texto: textoLancamento(l), rotuloZap: 'Enviar pelo WhatsApp',
    acaoCopiar: `data-acao="copiar-link" data-link="${esc(linkAbsoluto(`#/predio/${l.id}`))}"`, rotuloCopiar: 'Copiar link do espelho',
  })}</div>`;
}

// ------------------------------------------------------------------ unidade
export function unidadesOrdenadas(l) {
  return [...l.unidades].sort((a, b) => a.andar - b.andar || a.final - b.final);
}

export function textoUnidade(l, u, { comLink = true } = {}) {
  const t = l.tipologias[u.tipologia];
  const linhas = [`${l.nome} · apto ${u.numero}`, `${t.descricao}`, `${fmtArea(t.area_m2)} privativos · ${u.andar}º andar · ${t.vagas} vaga(s)`,
    `Valor de tabela: ${fmtCentavos(u.valor_tabela_centavos)} (tabela de ${fmtData(l.tabela_data)})`];
  if (comLink) linhas.push(linkAbsoluto(`#/predio/${l.id}/${u.numero}`));
  return linhas.join('\n');
}

const pctDia = (min) => ((Math.min(Math.max(min, HORA_MIN), HORA_MAX) - HORA_MIN) / (HORA_MAX - HORA_MIN)) * 100;
export { pctDia };

/** Bloco Insolação: faces, horários de sol direto na data do controle de sol, barra do dia. */
export function htmlInsolacao(l, u, { dataISO, minutos, emVista }) {
  const botaoVista = `<button class="btn" type="button" data-acao="vista" data-un="${esc(u.numero)}" aria-pressed="${emVista}">${icone(emVista ? 'voltar' : 'vista', { tamanho: 16 })}${emVista ? 'Sair da vista' : 'Ver vista da janela'}</button>`;
  let faces;
  try {
    faces = insolacaoUnidade(l, u, dataISO);
  } catch (err) {
    console.error('[insolacao]', err);
    return `<section class="ins" id="insolacao"><h3>${icone('sol', { tamanho: 16 })}Insolação</h3>
      <p class="erro-txt">${icone('alerta', { tamanho: 14 })}Não consegui calcular a insolação: ${esc(err.message)}</p>${botaoVista}</section>`;
  }
  const dm = fmtDiaMes(dataISO);
  const linhas = faces.map((f) => {
    const j = f.janela;
    const texto = j.minutos ? `Sol direto em ${dm}: ${fmtFaixas(j.faixas)} (${fmtDuracao(j.minutos)})` : `Sem sol direto em ${dm}`;
    const segs = j.faixas.map(([a, b]) => `<i style="left:${pctDia(a).toFixed(2)}%;width:${Math.max(0, pctDia(b) - pctDia(a)).toFixed(2)}%"></i>`).join('');
    return `<li>
      <div class="ins-face">${icone('bussola', { tamanho: 14 })}<b>${esc(f.nomeFace)}</b><span>voltada para ${esc(f.orientacao)} · ${Math.round(f.azimute)}°</span></div>
      <p>${texto}</p>
      <div class="ins-barra" role="img" aria-label="${esc(texto)}">${segs}<span class="ins-agora"></span></div></li>`;
  }).join('');
  return `<section class="ins" id="insolacao" style="--agora:${pctDia(minutos).toFixed(2)}%">
    <div class="ins-cab"><h3>${icone('sol', { tamanho: 16 })}Insolação</h3>
      <button class="link-btn" type="button" data-acao="abrir-sol">${icone('calendario', { tamanho: 14 })}Mudar data e hora</button></div>
    <ul>${linhas}</ul>
    <div class="ins-escala" aria-hidden="true"><span>05h</span><span>09h</span><span>13h</span><span>17h</span><span>20h30</span></div>
    <p class="nota">Sem considerar sombra de prédios vizinhos. Faixa clara: sol direto; traço: hora do controle de sol.</p>
    ${botaoVista}
  </section>`;
}

export function htmlUnidade(l, u, { share, dataISO, minutos, emVista }) {
  const t = l.tipologias[u.tipologia];
  const iAndar = l.andares.indexOf(u.andar);
  const cota = 4.2 * l.predio.podio_pavimentos + iAndar * l.predio.pe_direito_m;
  let fluxoHtml;
  try {
    const f = calcularFluxo(u.valor_tabela_centavos, l.fluxo);
    fluxoHtml = f.map((e) => {
      const parc = e.parcelas === 1 ? fmtCentavos(e.totalCentavos) : `${e.parcelas}× ${fmtCentavos(e.parcelaCentavos)}`;
      const ajuste = e.parcelas > 1 && e.primeiraCentavos !== e.parcelaCentavos ? ` · 1ª de ${fmtCentavos(e.primeiraCentavos)} (arredondamento)` : '';
      return `<tr><td>${esc(e.rotulo)} · ${num(e.pct)}%${e.parcelas > 1 ? `<small>total ${fmtCentavos(e.totalCentavos)}${ajuste}</small>` : ''}</td><td>${parc}</td></tr>`;
    }).join('');
  } catch (err) {
    console.error('[fluxo]', err);
    fluxoHtml = `<tr><td colspan="2" class="erro-txt">Fluxo de pagamento inválido na tabela: ${esc(err.message)}</td></tr>`;
  }
  const ord = unidadesOrdenadas(l);
  const pos = ord.findIndex((x) => x.numero === u.numero);
  const ant = [...ord.slice(0, pos)].reverse().find((x) => x.status === 'disponivel');
  const prox = ord.slice(pos + 1).find((x) => x.status === 'disponivel');
  return `<div class="det">
    <div class="det-kicker">${icone('apartamento', { tamanho: 13 })}Apartamento · final ${String(u.final).padStart(2, '0')}</div>
    <div class="det-num"><h2>${esc(u.numero)}</h2><span class="badge ${u.status}"><i class="pt ${u.status}"></i>${NOME_STATUS[u.status]}</span></div>
    <p class="det-desc">${esc(t.descricao)}</p>
    <div class="det-specs">
      <div>${icone('area', { tamanho: 18, classe: 'spec-ic' })}<small>Área privativa</small><b>${fmtArea(t.area_m2)}</b></div>
      <div>${icone('andar', { tamanho: 18, classe: 'spec-ic' })}<small>Pavimento</small><b>${u.andar}º</b><em>cota +${num(cota.toFixed(2))} m</em></div>
      <div>${icone('carro', { tamanho: 18, classe: 'spec-ic' })}<small>Vagas</small><b>${t.vagas}</b></div>
      ${t.quartos ? `<div>${icone('cama', { tamanho: 18, classe: 'spec-ic' })}<small>Quartos</small><b>${t.quartos}</b>${t.suites ? `<em>${t.suites} suíte${t.suites > 1 ? 's' : ''}</em>` : ''}</div>` : ''}
    </div>
    <div class="det-preco"><small>Valor de tabela</small><strong>${fmtCentavos(u.valor_tabela_centavos)}</strong>
      <span>${fmtCentavos(Math.round(u.valor_tabela_centavos / t.area_m2))} por m² privativo</span></div>
    ${htmlInsolacao(l, u, { dataISO, minutos, emVista })}
    <div class="sec-tit">${icone('calendario', { tamanho: 14 })}Fluxo de pagamento</div>
    <table class="tabela">${fluxoHtml}</table>
    <p class="nota">Tabela de ${fmtData(l.tabela_data)}. Valores de demonstração; parcelas sem correção (INCC) no protótipo.</p>
    <div class="nav-un">
      <a class="btn" ${ant ? `href="#/predio/${esc(l.id)}/${esc(ant.numero)}"` : 'aria-disabled="true"'}>${icone('esq', { tamanho: 16 })}Disponível anterior</a>
      <a class="btn" ${prox ? `href="#/predio/${esc(l.id)}/${esc(prox.numero)}"` : 'aria-disabled="true"'}>Próximo disponível${icone('dir', { tamanho: 16 })}</a>
    </div>
    ${u.status === 'vendida'
    ? `<div class="acoes"><button class="btn" type="button" data-acao="copiar-texto" data-texto="${esc(textoUnidade(l, u))}">${icone('copiar', { tamanho: 16 })}Copiar resumo da unidade</button></div>`
    : blocoCompartilhar({
      share, texto: textoUnidade(l, u), rotuloZap: 'Enviar unidade pelo WhatsApp',
      acaoCopiar: `data-acao="copiar-texto" data-texto="${esc(textoUnidade(l, u))}"`, rotuloCopiar: 'Copiar resumo',
    })}
  </div>`;
}
