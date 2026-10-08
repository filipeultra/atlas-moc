// Posição do sol, nascer/pôr e insolação de fachada. Módulo puro (sem DOM, sem three).
//
// Algoritmo: NOAA Solar Calculator (Global Monitoring Laboratory, planilha "NOAA_Solar_Calculations_day"),
// que implementa as fórmulas de Jean Meeus, "Astronomical Algorithms" (2ª ed., cap. 25 e 28):
// longitude média, anomalia média, equação do centro, obliquidade, declinação e equação do tempo;
// depois tempo solar verdadeiro → ângulo horário → elevação/azimute.
// https://gml.noaa.gov/grad/solcalc/calcdetails.html
// Precisão declarada pela NOAA: ~0,01° entre 1800 e 2100 (sem refração). Validado contra suncalc 2.x
// em tests/sol.test.mjs.
//
// Convenções do app:
// - azimute em graus a partir do norte, sentido horário, [0, 360): 90 = leste, 180 = sul, 270 = oeste.
// - elevação GEOMÉTRICA (sem refração atmosférica), [-90, 90]. A refração só entra no nascer/pôr,
//   pelo limiar padrão de -0,833° (refração média no horizonte + raio do disco).

export const MOC = { lat: -16.7350, lng: -43.8617, fusoHoras: -3 }; // Montes Claros, America/Sao_Paulo, sem horário de verão desde 2019

export const ELEVACAO_NASCER = -0.833;     // graus, centro do disco quando a borda toca o horizonte aparente
export const FAIXA_CREPUSCULO = [-6, 8];  // graus: fatorDia vai de 0 (fim do crepúsculo civil) a 1
export const LIMIAR_NOITE = 0.5;          // fatorDia < LIMIAR_NOITE → convenção "noite" (luz acesa = vendida)
const PRECISAO_BORDA_MIN = 0.05;          // janelaDeSol: refino por bisseção das bordas de cada faixa

const RAD = Math.PI / 180;
const MS_DIA = 86_400_000;
const DIRECOES = ['Norte', 'Nordeste', 'Leste', 'Sudeste', 'Sul', 'Sudoeste', 'Oeste', 'Noroeste'];

const norm360 = (g) => ((g % 360) + 360) % 360;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function exigirNumero(v, nome) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`[sol] ${nome} inválido: ${v}`);
}

// Termos do sol que variam devagar (declinação e equação do tempo) para um instante em ms UTC.
function termosSolares(ms) {
  const jd = ms / MS_DIA + 2440587.5;
  const T = (jd - 2451545) / 36525; // séculos julianos desde J2000
  const L0 = norm360(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * RAD;
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T)
    + Math.sin(3 * Mr) * 0.000289;
  const omega = (125.04 - 1934.136 * T) * RAD;
  const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * RAD; // longitude aparente
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * RAD; // obliquidade corrigida
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const y = Math.tan(eps / 2) ** 2;
  const L0r = L0 * RAD;
  const eqTempoMin = 4 / RAD * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr)
    + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r)
    - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));
  return { decl, eqTempoMin };
}

function horizontais(haRad, latRad, decl) {
  const sinEl = Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(haRad);
  const elevacao = Math.asin(clamp(sinEl, -1, 1)) / RAD;
  // atan2 mede a partir do sul, positivo para oeste; +180 leva para "a partir do norte, horário".
  const az = Math.atan2(Math.sin(haRad), Math.cos(haRad) * Math.sin(latRad) - Math.tan(decl) * Math.cos(latRad));
  return { azimute: norm360(az / RAD + 180), elevacao };
}

/** Date (instante UTC) → { azimute, elevacao } em graus. */
export function posicaoSol(dataUTC, lat, lng) {
  if (!(dataUTC instanceof Date) || Number.isNaN(dataUTC.getTime())) throw new TypeError(`[sol] data inválida: ${dataUTC}`);
  exigirNumero(lat, 'lat'); exigirNumero(lng, 'lng');
  const ms = dataUTC.getTime();
  const { decl, eqTempoMin } = termosSolares(ms);
  const minUTC = ((ms % MS_DIA) + MS_DIA) % MS_DIA / 60_000;
  const tempoSolarVerdadeiro = minUTC + eqTempoMin + 4 * lng; // minutos; lng positiva a leste
  const ha = (tempoSolarVerdadeiro / 4 - 180) * RAD;
  return horizontais(ha, lat * RAD, decl);
}

function lerDataISO(dataISO) {
  const m = typeof dataISO === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataISO) : null;
  if (!m) throw new TypeError(`[sol] data deve ser 'AAAA-MM-DD': ${dataISO}`);
  const [a, mes, d] = [+m[1], +m[2], +m[3]];
  // setUTCFullYear em vez de Date.UTC: Date.UTC(20, ...) vira 1920 e a data seria tida como inexistente.
  const chk = new Date(0);
  chk.setUTCFullYear(a, mes - 1, d);
  const t = chk.getTime();
  if (chk.getUTCFullYear() !== a || chk.getUTCMonth() !== mes - 1 || chk.getUTCDate() !== d) {
    throw new RangeError(`[sol] data inexistente: ${dataISO}`);
  }
  return t;
}

/** 'AAAA-MM-DD' + minutos locais (0..1440) no fuso dado → Date (instante UTC). */
export function dataLocalParaUTC(dataISO, minutos, fusoHoras = MOC.fusoHoras) {
  exigirNumero(minutos, 'minutos'); exigirNumero(fusoHoras, 'fusoHoras');
  if (minutos < 0 || minutos > 1440) throw new RangeError(`[sol] minutos fora de 0..1440: ${minutos}`);
  return new Date(lerDataISO(dataISO) + (minutos - fusoHoras * 60) * 60_000);
}

export function posicaoSolLocal(dataISO, minutos, lat = MOC.lat, lng = MOC.lng) {
  return posicaoSol(dataLocalParaUTC(dataISO, minutos), lat, lng);
}

/**
 * Nascer, meio-dia solar e pôr do sol em minutos locais (fuso de MOC), arredondados ao minuto.
 * Sol que não cruza -0,833° no dia (só em latitude polar): nascer/porDoSol = null.
 */
export function nascerPorDoSol(dataISO, lat = MOC.lat, lng = MOC.lng) {
  exigirNumero(lat, 'lat'); exigirNumero(lng, 'lng');
  const meiaNoiteLocal = lerDataISO(dataISO) - MOC.fusoHoras * 3_600_000; // 00:00 local em ms UTC
  const latR = lat * RAD;
  const paraLocal = (msUTC) => (msUTC - meiaNoiteLocal) / 60_000;

  // meio-dia solar: ângulo horário 0. Itera recalculando a equação do tempo no próprio instante.
  let meio = meiaNoiteLocal + 12 * 3_600_000;
  for (let i = 0; i < 3; i++) {
    const { eqTempoMin } = termosSolares(meio);
    const minUTC = 720 - 4 * lng - eqTempoMin;
    meio = lerDataISO(dataISO) + minUTC * 60_000;
    // o dia UTC pode não coincidir com o dia local; corrige para ficar dentro do dia local
    if (meio < meiaNoiteLocal) meio += MS_DIA;
    if (meio >= meiaNoiteLocal + MS_DIA) meio -= MS_DIA;
  }

  const evento = (sinal) => {
    let t = meio;
    for (let i = 0; i < 4; i++) {
      const { decl, eqTempoMin } = termosSolares(t);
      const cosH = (Math.sin(ELEVACAO_NASCER * RAD) - Math.sin(latR) * Math.sin(decl)) / (Math.cos(latR) * Math.cos(decl));
      if (cosH < -1 || cosH > 1) return null;
      const H = Math.acos(cosH) / RAD; // graus
      const meioUTCmin = 720 - 4 * lng - eqTempoMin;
      const minUTC = meioUTCmin + sinal * 4 * H;
      t = lerDataISO(dataISO) + minUTC * 60_000;
      if (t < meiaNoiteLocal - MS_DIA / 2) t += MS_DIA;
      if (t > meiaNoiteLocal + MS_DIA * 1.5) t -= MS_DIA;
    }
    return Math.round(paraLocal(t));
  };

  return { nascer: evento(-1), meioDia: Math.round(paraLocal(meio)), porDoSol: evento(1) };
}

const difAngular = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Sol direto numa fachada: sol acima do horizonte (elevação geométrica > 0) E à frente da fachada
 * (|Δazimute| < 90°). Amostra a cada passoMin e refina as bordas por bisseção, então o resultado
 * quase não depende do passo. Não considera sombra de prédios vizinhos.
 * → { faixas: [[iniMin, fimMin], ...], minutos, inicio, fim } em minutos locais inteiros.
 */
export function janelaDeSol(dataISO, azimuteFachada, lat = MOC.lat, lng = MOC.lng, passoMin = 5) {
  exigirNumero(azimuteFachada, 'azimuteFachada'); exigirNumero(passoMin, 'passoMin');
  if (passoMin <= 0 || passoMin > 60) throw new RangeError(`[sol] passoMin fora de (0, 60]: ${passoMin}`);
  const base = lerDataISO(dataISO) - MOC.fusoHoras * 3_600_000;
  const iluminada = (min) => {
    const p = posicaoSol(new Date(base + min * 60_000), lat, lng);
    return p.elevacao > 0 && difAngular(p.azimute, azimuteFachada) < 90;
  };
  const borda = (a, b) => { // a e b com estados diferentes; devolve o instante da troca
    const ea = iluminada(a);
    while (b - a > PRECISAO_BORDA_MIN) {
      const m = (a + b) / 2;
      if (iluminada(m) === ea) a = m; else b = m;
    }
    return (a + b) / 2;
  };

  const faixas = [];
  let ini = iluminada(0) ? 0 : null;
  let antT = 0;
  let antE = ini !== null;
  for (let t = passoMin; ; t += passoMin) {
    const tt = Math.min(t, 1440);
    const e = iluminada(tt);
    if (e !== antE) {
      const x = borda(antT, tt);
      if (e) ini = x; else { faixas.push([ini, x]); ini = null; }
    }
    antT = tt; antE = e;
    if (tt >= 1440) break;
  }
  if (ini !== null) faixas.push([ini, 1440]);

  const arred = faixas.map(([a, b]) => [Math.round(a), Math.round(b)]).filter(([a, b]) => b > a);
  const minutos = arred.reduce((s, [a, b]) => s + (b - a), 0);
  return {
    faixas: arred,
    minutos,
    inicio: arred.length ? arred[0][0] : null,
    fim: arred.length ? arred[arred.length - 1][1] : null,
  };
}

/** 0 = noite, 1 = dia; smoothstep entre -6° e +8°. ÚNICA definição de dia/noite do app. */
export function fatorDia(elevacao) {
  exigirNumero(elevacao, 'elevacao');
  const [a, b] = FAIXA_CREPUSCULO;
  const t = clamp((elevacao - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function rotuloOrientacao(azimute) {
  exigirNumero(azimute, 'azimute');
  return DIRECOES[Math.round(norm360(azimute) / 45) % 8];
}

/** minutos (qualquer número finito; dá a volta em 24 h) → 'HH:MM', arredondando ao minuto. */
export function fmtHora(minutos) {
  exigirNumero(minutos, 'minutos');
  const m = ((Math.round(minutos) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Relógio atual no fuso de Montes Claros → { dataISO, minutos }. `agora` é opcional (testes). */
export function hojeMOC(agora = new Date()) {
  if (!(agora instanceof Date) || Number.isNaN(agora.getTime())) throw new TypeError(`[sol] data inválida: ${agora}`);
  const d = new Date(agora.getTime() + MOC.fusoHoras * 3_600_000); // campos UTC de d = relógio local
  const dataISO = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { dataISO, minutos: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
