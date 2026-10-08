// Verificação em Chrome headless (protocolo DevTools): iPad retrato/paisagem e celular, modo demonstração e real.
// Pré-requisito: app servido em ATLAS_URL (padrão http://localhost:8794/). Rodar: node tests/e2e-mobile.mjs
// Salva prints em tests/prints/ e imprime um relatório; sai com código 1 se algo falhar.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'prints');
mkdirSync(SHOTS, { recursive: true });
const BASE = process.env.ATLAS_URL || 'http://localhost:8794/';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'atlas-e2e-'))}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

let ws, seq = 0;
const pending = new Map();
let erros = [];
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
          if (m.method === 'Runtime.exceptionThrown') erros.push('EXCECAO: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
          if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') erros.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
        };
        return;
      }
    } catch { /* subindo */ }
    await sleep(200);
  }
  throw new Error('Chrome headless não respondeu');
}
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function esperar(expr, ms = 20000) {
  for (let t = 0; t < ms; t += 250) { try { if (await js(expr)) return true; } catch { /* ainda não */ } await sleep(250); }
  return false;
}
async function go(url) {
  console.log('...', url);
  await send('Page.navigate', { url });
  await esperar('document.readyState === "complete"');
}
async function tocar(sel) {
  const b = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; })()`);
  if (!b || !b.w) throw new Error('não achei: ' + sel);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
}
async function shot(nome) {
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
  writeFileSync(join(SHOTS, nome + '.jpg'), Buffer.from(r.data, 'base64'));
}
async function aparelho(w, h, { ipad = false } = {}) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setUserAgentOverride', { userAgent: ipad ? UA_IPAD : 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
}

// Mede layout: estouro horizontal, elementos fixos fora da tela e sobreposições entre controles.
const MEDIR = `(() => {
  const W = innerWidth, H = innerHeight;
  const vis = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && r.width > 0 && r.height > 0; };
  const caixa = (sel) => { const e = document.querySelector(sel); if (!e || !vis(e)) return null; const r = e.getBoundingClientRect(); const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top), x1 = Math.min(W, r.right), y1 = Math.min(H, r.bottom); if (x1 <= x0 || y1 <= y0) return null; return { sel, x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) }; }; // só a parte dentro da tela
  const alvos = ['.topo', '#painel-lista', '#painel-espelho', '.barra-cidade', '.barra-predio', '#painel-sol', '#gaveta', '.legenda-mapa', '.bussola', '#bussola', '.medidor'].map(caixa).filter(Boolean);
  const sobre = [];
  for (let i = 0; i < alvos.length; i++) for (let j = i + 1; j < alvos.length; j++) {
    const a = alvos[i], b = alvos[j];
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    if (ix * iy > 400) sobre.push(a.sel + ' x ' + b.sel + ' (' + ix + 'x' + iy + ')');
  }
  const fora = [];
  document.querySelectorAll('button, a[href], input, select, [role=switch]').forEach((e) => { if (!vis(e)) return; const r = e.getBoundingClientRect(); if (r.right > W + 1 && r.left < W && !e.closest('.barra-flutuante, .chips, .lista, .grade, .pop-corpo, .det, .galeria, .esp-sec')) fora.push((e.getAttribute('aria-label') || e.textContent.trim() || e.tagName).slice(0, 30)); });
  return { W, H, scrollW: document.documentElement.scrollWidth, alvos, sobreposicoes: sobre, foraDaTela: fora.slice(0, 10) };
})()`;

const rel = { push: (l) => console.log(l) };
let falhas = 0;
const ok = (cond, msg, extra) => { rel.push(`${cond ? 'ok   ' : 'FALHA'} ${msg}${extra ? ' · ' + extra : ''}`); if (!cond) falhas++; };

try {
  await connect();
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  // ---------- iPad retrato, demonstração
  await aparelho(820, 1180, { ipad: true });
  erros = [];
  const t0 = Date.now();
  await go(BASE + '#/cidade');
  const pronto = await esperar('window.__atlas?.cidade?.map?.loaded?.() && !document.querySelector("#carregando:not(.saindo)")', 30000);
  ok(pronto, 'iPad retrato: mapa carregou', `${Date.now() - t0} ms`);
  await sleep(2500);
  const nav = await js(`(() => { const n = performance.getEntriesByType('navigation')[0]; const rs = performance.getEntriesByType('resource'); const kb = (f) => Math.round(rs.filter(f).reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0) / 1024); return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), req: rs.length, kbJsCss: kb((r) => /\\.(m?js|css)(\\?|$)/.test(r.name)), kbDados: kb((r) => r.name.includes('/dados/')), kbTiles: kb((r) => r.name.includes('openfreemap')) }; })()`);
  rel.push(`info  carga iPad: DOMContentLoaded ${nav.dcl} ms · load ${nav.load} ms · ${nav.req} requisições · JS/CSS ${nav.kbJsCss} KB · dados ${nav.kbDados} KB · tiles ${nav.kbTiles} KB`);
  let m = await js(MEDIR);
  ok(m.scrollW <= m.W, 'iPad retrato: sem rolagem horizontal', `${m.scrollW}/${m.W}`);
  ok(!m.sobreposicoes.length, 'iPad retrato: controles sem sobreposição', m.sobreposicoes.join('; '));
  ok(!m.foraDaTela.length, 'iPad retrato: nada fora da tela', m.foraDaTela.join(', '));
  const diag = await js('window.__atlas.cidade.diagnostico()');
  rel.push(`info  camada de ícones: ${diag.drawCalls} draw calls, ${diag.instancias} instâncias, modo ${diag.modoRender}`);
  await shot('ipad-retrato-cidade');

  // painel de sol compacto
  await tocar('#b-sol');
  await sleep(700);
  const sol = await js(`(() => { const p = document.querySelector('#painel-sol'); const r = p.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), y: Math.round(r.top), vis: getComputedStyle(p).visibility }; })()`);
  ok(sol.vis === 'visible' && sol.h <= 110, 'iPad: painel de sol compacto', `${sol.w}x${sol.h} px, topo em ${sol.y}`);
  await shot('ipad-retrato-sol');
  await tocar('#b-sol');

  // ficha de um imóvel (toque no card da lista)
  await js(`location.hash = '#/imovel/MC-1029'`);
  await sleep(1500);
  m = await js(MEDIR);
  ok(m.scrollW <= m.W, 'iPad: ficha sem rolagem horizontal', `${m.scrollW}/${m.W}`);
  await shot('ipad-retrato-ficha');

  // prédio
  await js(`location.hash = '#/predio/serra-azul'`);
  const predioOk = await esperar('window.__atlas?.predio?.diagnostico?.().quadros > 0', 30000);
  ok(predioOk, 'iPad: prédio 3D renderizou');
  await sleep(1500);
  const dp = predioOk ? await js('window.__atlas.predio.diagnostico()') : {};
  rel.push(`info  prédio iPad: qualidade ${dp.qualidade}, pixelRatio ${dp.pixelRatio}, sombras ${dp.sombras}, ${dp.drawCalls} draw calls, ${dp.triangulos} triângulos`);
  m = await js(MEDIR);
  ok(m.scrollW <= m.W, 'iPad: prédio sem rolagem horizontal', `${m.scrollW}/${m.W}`);
  ok(!m.sobreposicoes.length, 'iPad: prédio sem sobreposição', m.sobreposicoes.join('; '));
  await shot('ipad-retrato-predio');

  // ---------- iPad paisagem
  await aparelho(1180, 820, { ipad: true });
  await go(BASE + '#/predio/serra-azul/1203');
  await esperar('window.__atlas?.predio?.diagnostico?.().quadros > 0', 30000);
  await sleep(2000);
  m = await js(MEDIR);
  ok(m.scrollW <= m.W, 'iPad paisagem: sem rolagem horizontal', `${m.scrollW}/${m.W}`);
  ok(!m.sobreposicoes.length, 'iPad paisagem: sem sobreposição', m.sobreposicoes.join('; '));
  await shot('ipad-paisagem-predio-ficha');

  // ---------- modo real no iPad paisagem
  erros = [];
  await go(BASE + '?dados=real#/cidade');
  const realOk = await esperar('window.__atlas?.cidade?.map?.loaded?.() && (window.__atlas?.itens?.length || 0) > 50', 30000);
  const nReal = await js('window.__atlas?.itens?.length || 0');
  ok(realOk, 'modo real: carregou', `${nReal} itens no mapa`);
  await sleep(2500);
  const id1 = await js(`(window.__atlas.itens.find(i => (i.ref.fotos || []).length > 2) || window.__atlas.itens[0]).id`);
  await js(`location.hash = '#/imovel/${id1}'`);
  await sleep(4000);
  const fotos = await js(`(() => { const im = [...document.querySelectorAll('#gaveta img')]; return { total: im.length, carregadas: im.filter(i => i.complete && i.naturalWidth > 0).length, quebradas: im.filter(i => i.complete && i.naturalWidth === 0).length, texto: document.querySelector('#gaveta').textContent.replace(/\\s+/g, ' ').slice(0, 160) }; })()`);
  ok(fotos.total > 0 && fotos.carregadas > 0, 'modo real: ficha com fotos carregando', `${fotos.carregadas}/${fotos.total} carregadas, ${fotos.quebradas} quebradas (as outras são lazy)`);
  const lixo = await js(`/\\b(null|undefined|NaN)\\b|R\\$ ?0(,00)?\\b/.test(document.querySelector('#gaveta').textContent)`);
  ok(!lixo, 'modo real: ficha sem null/undefined/NaN/R$ 0');
  m = await js(MEDIR);
  ok(m.scrollW <= m.W, 'modo real: sem rolagem horizontal', `${m.scrollW}/${m.W}`);
  await shot('ipad-paisagem-real-ficha');

  // ---------- celular
  await aparelho(390, 844);
  await go(BASE + '?dados=real#/cidade');
  await esperar('window.__atlas?.cidade?.map?.loaded?.()', 30000);
  await sleep(2000);
  m = await js(MEDIR);
  ok(m.scrollW <= m.W, 'celular: sem rolagem horizontal', `${m.scrollW}/${m.W}`);
  ok(!m.foraDaTela.length, 'celular: nada fora da tela', m.foraDaTela.join(', '));
  await shot('celular-real-cidade');

  ok(!erros.length, 'sem erro de console nas telas reais', erros.slice(0, 5).join(' | '));
} catch (e) {
  rel.push('FALHA execução: ' + e.message);
  falhas++;
} finally {
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK');
  try { ws?.close(); } catch { /* */ }
  chrome.kill();
  process.exit(falhas ? 1 : 0);
}
