// Medidor de desempenho: FPS do navegador + diagnostico() da vista ativa.
// Só roda enquanto está ligado (o próprio laço de medição custaria bateria).
import { esc } from './util.js';

const INTERVALO_MS = 500;

/** obterVista() → { nome, diagnostico() } | null */
export function criarMedidor({ el, obterVista }) {
  let raf = 0, ligado = false, quadrosTela = 0, t0 = 0, ultimo = null;

  function laco(agora) {
    if (!ligado) return;
    if (!t0) t0 = agora; // relógio do próprio rAF (mesma origem dos timestamps seguintes)
    quadrosTela++;
    if (agora - t0 >= INTERVALO_MS) {
      const dt = (agora - t0) / 1000;
      const fps = quadrosTela / dt;
      let linhas = [`<b>${fps.toFixed(0)}</b> fps tela`];
      const v = obterVista();
      if (v) {
        try {
          const d = v.diagnostico();
          const qps = ultimo && ultimo.nome === v.nome ? (d.quadros - ultimo.quadros) / dt : null;
          ultimo = { nome: v.nome, quadros: d.quadros };
          linhas.push(`${esc(v.nome)}: <b>${qps === null ? '…' : qps.toFixed(0)}</b> quadros/s`);
          linhas.push(`draw calls <b>${d.drawCalls ?? '?'}</b>`);
          if (d.instancias !== undefined) linhas.push(`instâncias <b>${d.instancias}</b>`);
          if (d.triangulos !== undefined) linhas.push(`triângulos <b>${Number(d.triangulos).toLocaleString('pt-BR')}</b>`);
          if (d.sombras !== undefined) linhas.push(`sombras <b>${d.sombras ? esc(String(d.sombras)) : 'desligadas'}</b>`);
          if (d.qualidade !== undefined) linhas.push(`qualidade <b>${esc(d.qualidade)}</b>`);
          linhas.push(`render <b>${esc(d.modoRender ?? '?')}</b>`);
        } catch (err) {
          console.error('[medidor]', err);
          linhas = [...linhas, `<span class="erro">diagnóstico falhou: ${esc(err.message)}</span>`];
        }
      }
      el.innerHTML = linhas.map((l) => `<span>${l}</span>`).join('');
      quadrosTela = 0;
      t0 = agora;
    }
    raf = requestAnimationFrame(laco);
  }

  return {
    ligar(sim) {
      if (sim === ligado) return;
      ligado = sim;
      el.hidden = !sim;
      if (sim) { t0 = 0; quadrosTela = 0; ultimo = null; el.textContent = 'medindo…'; raf = requestAnimationFrame(laco); }
      else cancelAnimationFrame(raf);
    },
  };
}
