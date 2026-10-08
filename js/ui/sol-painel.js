// Controlador de sol: data + hora locais de Montes Claros → posição do sol para as duas vistas.
// Recolhido (padrão) é uma linha + o slider, embaixo no centro, para não cobrir o mapa nem o prédio;
// expandido mostra atalhos de hora, data e nascer/pôr. O estado recolhido/expandido fica no aparelho.
import { icone } from '../icones-ui.js';
import { posicaoSolLocal, nascerPorDoSol, fmtHora, hojeMOC, fatorDia, LIMIAR_NOITE } from '../sol.js';
import { $, esc, aviso } from './util.js';

export const HORA_MIN = 5 * 60;          // 05:00
export const HORA_MAX = 20 * 60 + 30;    // 20:30
export const PASSO_MIN = 5;
export const HORA_INICIAL = 20 * 60;     // 20:00: preserva a primeira impressão noturna da v1
const DURACAO_PLAY_MS = 14000;           // 05:00 → 20:30
const ANO_MIN = 1900, ANO_MAX = 2100;    // faixa em que o algoritmo do NOAA (sol.js) é preciso
export const CHAVE_SOL_PAINEL = 'atlas-moc:sol-painel:v1';
const ATALHOS_HORA = [
  ['manha', 'Manhã', 8 * 60, 'nascer'],
  ['meio', 'Meio-dia', 12 * 60, 'sol'],
  ['tarde', 'Tarde', 16 * 60, 'por'],
  ['noite', 'Noite', 20 * 60, 'lua'],
];

const pct = (min) => ((Math.min(Math.max(min, HORA_MIN), HORA_MAX) - HORA_MIN) / (HORA_MAX - HORA_MIN)) * 100;
const graus = (g) => `${Math.round(g)}°`.replace('-', '−');

export function criarPainelSol({ el, botao, aoMudar, aoAbrirFechar, aoRedimensionar }) {
  const hoje = hojeMOC();
  const ano = hoje.dataISO.slice(0, 4);
  const ATALHOS_DATA = [
    ['hoje', 'Hoje', () => hojeMOC().dataISO],
    ['inverno', '21 jun · inverno', () => `${ano}-06-21`],
    ['verao', '21 dez · verão', () => `${ano}-12-21`],
    ['equinocio', '20 mar · equinócio', () => `${ano}-03-20`],
  ];
  const st = { dataISO: hoje.dataISO, minutos: HORA_INICIAL, pos: null, play: null, aberto: false, expandido: false };

  el.innerHTML = `
    <h2 id="sol-titulo" class="sr">Sol e sombra</h2>
    <div class="sol-linha">
      <span class="sol-ic" aria-hidden="true">${icone('sol', { tamanho: 18 })}</span>
      <output class="sol-hora" id="sol-hora" aria-live="off">20:00</output>
      <span class="sol-curta" id="sol-curta" aria-hidden="true"></span>
      <span class="sol-dia" id="sol-dia" aria-hidden="true" hidden></span>
      <span id="sol-posicao" class="sr"></span>
      <span class="sol-botoes">
        <button class="ic-btn play" type="button" data-sol="play" aria-label="Animar o dia" title="Animar o dia">${icone('play', { tamanho: 16 })}</button>
        <button class="ic-btn sol-expandir" type="button" data-sol="expandir" aria-expanded="false" aria-controls="sol-extra" aria-label="Mostrar data e atalhos de hora" title="Data e atalhos">${icone('baixo', { tamanho: 18 })}</button>
        <button class="ic-btn" type="button" data-sol="fechar" aria-label="Fechar controle de sol" title="Fechar (Esc)">${icone('fechar', { tamanho: 18 })}</button>
      </span>
    </div>
    <div class="sol-trilho">
      <input id="sol-slider" type="range" min="${HORA_MIN}" max="${HORA_MAX}" step="${PASSO_MIN}" value="${HORA_INICIAL}" aria-label="Hora do dia" aria-describedby="sol-posicao">
    </div>
    <div class="sol-extra" id="sol-extra" hidden>
      <div class="sol-marcas" aria-hidden="true"><span>05h</span><span>09h</span><span>13h</span><span>17h</span><span>20h30</span></div>
      <p id="sol-nascer" class="sol-nascer"></p>
      <div class="chips sol-horas" role="group" aria-label="Atalhos de hora">
        ${ATALHOS_HORA.map(([k, n, m, ic]) => `<button class="chip" type="button" data-hora="${m}" data-k="${k}">${icone(ic, { tamanho: 14 })}${n} <small>${fmtHora(m)}</small></button>`).join('')}
        <button class="chip" type="button" data-sol="agora">${icone('relogio', { tamanho: 14 })}Agora</button>
      </div>
      <div class="sol-data">
        <label class="campo-data">${icone('calendario', { tamanho: 16 })}<span class="sr">Data</span>
          <input id="sol-data" type="date" value="${st.dataISO}" min="${ANO_MIN}-01-01" max="${ANO_MAX}-12-31" required></label>
        <div class="chips" role="group" aria-label="Atalhos de data">
          ${ATALHOS_DATA.map(([k, n]) => `<button class="chip" type="button" data-data="${k}">${esc(n)}</button>`).join('')}
        </div>
      </div>
    </div>`;

  const slider = $('#sol-slider', el);
  const campoData = $('#sol-data', el);
  const btPlay = $('[data-sol="play"]', el);
  const btExpandir = $('[data-sol="expandir"]', el);
  const extra = $('#sol-extra', el);

  // ---------- recolhido / expandido (persistido)
  function lerExpandido() {
    let bruto;
    try { bruto = globalThis.localStorage ? globalThis.localStorage.getItem(CHAVE_SOL_PAINEL) : null; } catch (err) {
      console.error('[sol-painel]', err);
      aviso(`Não consegui ler o estado do controle de sol (${err.message}). Abrindo recolhido.`, 'erro');
      return false;
    }
    if (bruto === null) return false;
    const v = /^\{"expandido":(true|false)\}$/.exec(bruto);
    if (!v) {
      console.error('[sol-painel]', new Error(`estado salvo inválido: ${bruto}`));
      aviso('O estado salvo do controle de sol estava corrompido. Abrindo recolhido.', 'erro');
      return false;
    }
    return v[1] === 'true';
  }
  function expandir(sim, { salvar = true } = {}) {
    st.expandido = sim;
    extra.hidden = !sim;
    el.classList.toggle('expandido', sim);
    btExpandir.setAttribute('aria-expanded', String(sim));
    btExpandir.setAttribute('aria-label', sim ? 'Esconder data e atalhos de hora' : 'Mostrar data e atalhos de hora');
    btExpandir.title = sim ? 'Recolher' : 'Data e atalhos';
    aoRedimensionar?.();
    if (!salvar) return;
    try {
      if (!globalThis.localStorage) throw new Error('localStorage indisponível');
      globalThis.localStorage.setItem(CHAVE_SOL_PAINEL, JSON.stringify({ expandido: sim }));
    } catch (err) {
      console.error('[sol-painel]', err);
      aviso(`Não consegui guardar o estado do controle de sol (${err.message}).`, 'erro');
    }
  }

  function pintarTrilho(np) {
    // trilho com noite / dia conforme nascer e pôr da data escolhida
    const a = np.nascer == null ? 0 : pct(np.nascer), b = np.porDoSol == null ? 100 : pct(np.porDoSol);
    slider.style.setProperty('--nascer', `${a}%`);
    slider.style.setProperty('--por', `${b}%`);
  }

  // Calcula com os valores candidatos e só então grava no estado: data ruim nunca envenena o sol atual.
  function atualizar({ mudouData = false, dataISO = st.dataISO, minutos = st.minutos } = {}) {
    let pos, np;
    try {
      pos = posicaoSolLocal(dataISO, minutos);
      np = nascerPorDoSol(dataISO);
    } catch (err) {
      console.error('[sol-painel]', err);
      aviso(`Não consegui calcular a posição do sol para ${dataISO} ${fmtHora(minutos)}: ${err.message}`, 'erro');
      if (campoData.value !== st.dataISO) campoData.value = st.dataISO;
      return false;
    }
    st.dataISO = dataISO;
    st.minutos = minutos;
    st.pos = pos;
    const noite = fatorDia(pos.elevacao) < LIMIAR_NOITE;
    $('#sol-hora', el).textContent = fmtHora(st.minutos);
    $('#sol-posicao', el).textContent = `${fmtHora(st.minutos)} · azimute ${graus(pos.azimute)} · elevação ${graus(pos.elevacao)}`;
    $('#sol-curta', el).textContent = `az ${graus(pos.azimute)} · el ${graus(pos.elevacao)}`;
    // data diferente de hoje aparece na linha recolhida: sem isso a hora pareceria ser de hoje
    const dia = $('#sol-dia', el);
    dia.hidden = st.dataISO === hojeMOC().dataISO;
    dia.textContent = st.dataISO.split('-').reverse().slice(0, 2).join('/');
    $('.sol-ic', el).innerHTML = icone(noite ? 'lua' : 'sol', { tamanho: 18 });
    $('#sol-nascer', el).innerHTML = `${icone('nascer', { tamanho: 14 })} nascer ${np.nascer == null ? 'sem' : fmtHora(np.nascer)} · ${icone('por', { tamanho: 14 })} pôr ${np.porDoSol == null ? 'sem' : fmtHora(np.porDoSol)}`;
    slider.value = String(Math.min(Math.max(st.minutos, HORA_MIN), HORA_MAX));
    slider.setAttribute('aria-valuetext', fmtHora(st.minutos));
    // não atropela o ano que o usuário está digitando (o play continua chamando atualizar)
    if (campoData.value !== st.dataISO && document.activeElement !== campoData) campoData.value = st.dataISO;
    pintarTrilho(np);
    el.classList.toggle('noite', noite);
    for (const b of el.querySelectorAll('[data-hora]')) b.setAttribute('aria-pressed', String(Number(b.dataset.hora) === st.minutos));
    for (const b of el.querySelectorAll('[data-data]')) {
      const alvo = ATALHOS_DATA.find(([k]) => k === b.dataset.data)[2]();
      b.setAttribute('aria-pressed', String(alvo === st.dataISO));
    }
    // botão do topo: ícone e hora
    botao.innerHTML = `${icone(noite ? 'lua' : 'sol', { tamanho: 18 })}<span class="rot">${fmtHora(st.minutos)}</span>`;
    botao.setAttribute('aria-label', `Sol e sombra: ${fmtHora(st.minutos)} de ${st.dataISO.split('-').reverse().join('/')}`);
    aoMudar?.({ dataISO: st.dataISO, minutos: st.minutos, pos, noite, mudouData });
    return true;
  }

  function definir({ dataISO, minutos }) {
    const novaData = dataISO ?? st.dataISO;
    return atualizar({ mudouData: novaData !== st.dataISO, dataISO: novaData, minutos: minutos !== undefined ? Math.round(minutos) : st.minutos });
  }
  // Motivo para recusar a data digitada, ou null se ela serve.
  function problemaData(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Data inválida no controle de sol.';
    const ano = Number(v.slice(0, 4));
    if (ano < ANO_MIN || ano > ANO_MAX) return `Ano ${ano} fora da faixa do controle de sol (${ANO_MIN} a ${ANO_MAX}).`;
    try { posicaoSolLocal(v, st.minutos); nascerPorDoSol(v); } catch (err) {
      console.error('[sol-painel]', err);
      return `Não consegui calcular o sol para ${v}: ${err.message}.`;
    }
    return null;
  }

  // ---------- play
  function pararPlay() {
    if (!st.play) return;
    cancelAnimationFrame(st.play.raf);
    st.play = null;
    btPlay.innerHTML = icone('play', { tamanho: 16 });
    btPlay.setAttribute('aria-label', 'Animar o dia');
    btPlay.title = 'Animar o dia';
    btPlay.setAttribute('aria-pressed', 'false');
  }
  function iniciarPlay() {
    const inicio = st.minutos >= HORA_MAX - PASSO_MIN || st.minutos < HORA_MIN ? HORA_MIN : st.minutos;
    const t0 = performance.now();
    const vel = (HORA_MAX - HORA_MIN) / DURACAO_PLAY_MS; // minutos por ms
    st.play = { raf: 0 };
    btPlay.innerHTML = icone('pausa', { tamanho: 16 });
    btPlay.setAttribute('aria-label', 'Pausar animação do dia');
    btPlay.title = 'Pausar';
    btPlay.setAttribute('aria-pressed', 'true');
    const passo = (agora) => {
      if (!st.play) return;
      const m = Math.min(HORA_MAX, inicio + (agora - t0) * vel);
      const degrau = Math.round(m / PASSO_MIN) * PASSO_MIN;
      // só redesenha a cena quando cruza um degrau de 5 min (não a cada quadro)
      if (degrau !== st.minutos) definir({ minutos: degrau });
      if (m >= HORA_MAX) { pararPlay(); return; }
      st.play.raf = requestAnimationFrame(passo);
    };
    st.play.raf = requestAnimationFrame(passo);
  }
  // aba escondida: a animação do dia para (não queima bateria em segundo plano)
  document.addEventListener('visibilitychange', () => { if (document.hidden) pararPlay(); });

  // ---------- eventos
  slider.addEventListener('input', () => { pararPlay(); definir({ minutos: Number(slider.value) }); });
  // Digitando o ano, o Chrome dispara change com valores intermediários (0002, 0020, 0202): marca o campo
  // como inválido e espera; só ao sair do campo uma data ainda recusada vira aviso e volta à anterior.
  function marcarData(problema) {
    campoData.setCustomValidity(problema || '');
    if (problema) campoData.setAttribute('aria-invalid', 'true'); else campoData.removeAttribute('aria-invalid');
  }
  campoData.addEventListener('change', () => {
    const problema = problemaData(campoData.value);
    marcarData(problema);
    if (!problema) definir({ dataISO: campoData.value });
  });
  campoData.addEventListener('blur', () => {
    const problema = campoData.value === st.dataISO ? null : problemaData(campoData.value);
    if (!problema) { marcarData(null); return; }
    aviso(`${problema} Voltei para ${st.dataISO.split('-').reverse().join('/')}.`, 'erro');
    campoData.value = st.dataISO;
    marcarData(null);
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !el.contains(b)) return;
    if (b.dataset.hora) { pararPlay(); definir({ minutos: Number(b.dataset.hora) }); }
    else if (b.dataset.data) {
      const [, , fn] = ATALHOS_DATA.find(([k]) => k === b.dataset.data);
      definir({ dataISO: fn() });
    } else if (b.dataset.sol === 'agora') { pararPlay(); const h = hojeMOC(); definir({ dataISO: h.dataISO, minutos: h.minutos }); }
    else if (b.dataset.sol === 'play') { st.play ? pararPlay() : iniciarPlay(); }
    else if (b.dataset.sol === 'expandir') expandir(!st.expandido);
    else if (b.dataset.sol === 'fechar') fechar();
  });

  function abrir() {
    st.aberto = true;
    el.classList.add('aberto');
    el.inert = false;
    el.setAttribute('aria-hidden', 'false');
    botao.setAttribute('aria-expanded', 'true');
    aoAbrirFechar?.(true);
  }
  function fechar() {
    if (!st.aberto) return;
    st.aberto = false;
    el.classList.remove('aberto');
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
    botao.setAttribute('aria-expanded', 'false');
    aoAbrirFechar?.(false);
  }
  el.inert = true;
  el.setAttribute('aria-hidden', 'true');
  botao.setAttribute('aria-expanded', 'false');
  botao.addEventListener('click', () => (st.aberto ? fechar() : abrir()));
  expandir(lerExpandido(), { salvar: false });

  return {
    abrir, fechar,
    alternar: () => (st.aberto ? fechar() : abrir()),
    aberto: () => st.aberto,
    estado: () => ({ dataISO: st.dataISO, minutos: st.minutos, pos: st.pos }),
    definir,
    iniciar: () => atualizar({ mudouData: true }),
    expandir: (sim) => expandir(sim),
    expandido: () => st.expandido,
    pararPlay,
  };
}
