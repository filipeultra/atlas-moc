// Utilidades de DOM do shell: seletores, escape, avisos, copiar e compartilhar.
import { icone } from '../icones-ui.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const semAcento = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const LARGURA_MOBILE = 860; // px: abaixo disso painéis viram folhas inferiores
const mqMobile = matchMedia(`(max-width: ${LARGURA_MOBILE}px)`);
export const ehMobile = () => mqMobile.matches;
export function aoMudarMobile(fn) { mqMobile.addEventListener('change', () => fn(mqMobile.matches)); }

const DURACAO_AVISO = { info: 4500, ok: 3500, erro: 10000 };
const DURACAO_AVISO_COM_ACAO = 12000; // 'Desfazer' precisa de tempo para ser alcançado por Tab ou leitor de tela
const ICONE_AVISO = { info: 'info', ok: 'check', erro: 'alerta' };

/**
 * Aviso visível (nunca falha silenciosa). tipo: 'info' | 'ok' | 'erro'.
 * acao opcional: { rotulo, fn } vira um botão no aviso (ex.: Desfazer).
 */
export function aviso(msg, tipo = 'info', { acao, ms } = {}) {
  const raiz = $('#avisos');
  if (!raiz) { console.error('[aviso] #avisos ausente:', msg); return; }
  const el = document.createElement('div');
  el.className = `aviso ${tipo}`;
  el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
  el.innerHTML = `${icone(ICONE_AVISO[tipo] || 'info', { tamanho: 18, classe: 'aviso-ic' })}
    <span class="aviso-txt">${tipo === 'erro' ? '<b>Erro.</b> ' : ''}${esc(msg)}</span>
    ${acao ? `<button class="aviso-acao" type="button">${esc(acao.rotulo)}</button>` : ''}
    <button class="aviso-fechar" type="button" aria-label="Dispensar aviso">${icone('fechar', { tamanho: 14 })}</button>`;
  let saiu = false, relogio = 0, restante = ms ?? (acao ? Math.max(DURACAO_AVISO_COM_ACAO, DURACAO_AVISO[tipo] ?? 0) : DURACAO_AVISO[tipo] ?? 5000), desde = 0;
  const sair = () => { saiu = true; clearTimeout(relogio); el.classList.add('saindo'); setTimeout(() => el.remove(), 220); };
  const contar = () => { desde = Date.now(); relogio = setTimeout(sair, restante); };
  // ponteiro em cima ou foco dentro (Tab até o Desfazer) pausam a contagem (WCAG 2.2.1)
  const pausar = () => { if (!relogio) return; clearTimeout(relogio); relogio = 0; restante = Math.max(1500, restante - (Date.now() - desde)); };
  let ponteiro = false;
  const retomar = () => { if (!saiu && !relogio && !ponteiro && !el.contains(document.activeElement) && el.isConnected) contar(); };
  el.addEventListener('mouseenter', () => { ponteiro = true; pausar(); });
  el.addEventListener('focusin', pausar);
  el.addEventListener('mouseleave', () => { ponteiro = false; retomar(); });
  el.addEventListener('focusout', () => setTimeout(retomar, 0)); // espera o foco chegar no próximo elemento
  el.querySelector('.aviso-fechar').addEventListener('click', sair);
  if (acao) el.querySelector('.aviso-acao').addEventListener('click', () => { sair(); acao.fn(); });
  raiz.appendChild(el);
  // no máximo 4 na tela: o mais antigo sai
  while (raiz.children.length > 4) raiz.firstElementChild.remove();
  contar();
}

export async function copiar(texto, ok) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('área de transferência indisponível (página sem HTTPS?)');
    await navigator.clipboard.writeText(texto);
    aviso(ok, 'ok');
    return true;
  } catch (err) {
    console.error('[copiar]', err);
    aviso(`Não consegui copiar para a área de transferência (${err.message}). Selecione e copie manualmente.`, 'erro');
    return false;
  }
}

export const temShareNativo = () => typeof navigator.share === 'function';

/**
 * Compartilhar nativo (folha do sistema). Devolve 'ok' | 'cancelado' | 'indisponivel' | 'erro'.
 * Cancelar a folha do sistema (AbortError) não é erro: é o usuário desistindo.
 */
export async function compartilharNativo({ title, text, url }) {
  if (!temShareNativo()) return 'indisponivel';
  try {
    await navigator.share({ title, text, url });
    return 'ok';
  } catch (err) {
    if (err?.name === 'AbortError') { console.info('[compartilhar] cancelado pelo usuário'); return 'cancelado'; }
    console.error('[compartilhar]', err);
    aviso(`Não consegui abrir o compartilhamento do aparelho (${err.message}). Use WhatsApp ou copiar.`, 'erro');
    return 'erro';
  }
}

export const linkWhatsApp = (texto) => `https://wa.me/?text=${encodeURIComponent(texto)}`;
// leva a query junto: ?dados=real faz o link compartilhado abrir no mesmo modo de dados
export const linkAbsoluto = (hash) => `${location.origin}${location.pathname}${location.search || ''}${hash}`;

/** Campo de texto com foco: atalhos de teclado não podem disparar. */
export function focoEmCampo(alvo = document.activeElement) {
  if (!alvo) return false;
  if (alvo.isContentEditable) return true;
  const tag = alvo.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const t = (alvo.type || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color'].includes(t);
  }
  return false;
}
