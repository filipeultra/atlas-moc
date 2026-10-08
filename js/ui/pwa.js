// PWA: registro do service worker (com estado visível) e convite de instalação.
import { aviso } from './util.js';

const ESPERA_ESTADO_SW_MS = 4000;

/** aoEstado({ instalar, sw }) é chamado a cada mudança, para a seção App das configurações. */
export function iniciarPWA({ aoEstado }) {
  const estado = { instalar: 'indisponivel', sw: { estado: 'verificando', detalhe: 'Verificando…' } };
  let convite = null;
  const emitir = () => aoEstado?.({ ...estado });

  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (standalone) estado.instalar = 'instalado';
  else if (ios) estado.instalar = 'ios';

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // o convite sai pelo menu de configurações, não por banner
    convite = e;
    estado.instalar = 'pronto';
    emitir();
  });
  addEventListener('appinstalled', () => {
    convite = null;
    estado.instalar = 'instalado';
    aviso('App instalado. Ele abre direto da tela inicial.', 'ok');
    emitir();
  });

  // ---------- service worker
  // pergunta ao SW o que entrou no precache (protocolo do sw.js: { tipo: 'estado-sw' } por MessageChannel)
  function consultarPrecache(sw) {
    if (!sw) return;
    const canal = new MessageChannel();
    const limite = setTimeout(() => {
      console.error('[pwa]', new Error('o service worker não respondeu ao pedido de estado em 4 s'));
      estado.sw = { estado: 'parcial', detalhe: 'Ativo, mas o service worker não informou em 4 s o que está guardado para uso offline.' };
      emitir();
    }, ESPERA_ESTADO_SW_MS);
    canal.port1.onmessage = ({ data }) => {
      clearTimeout(limite);
      if (data?.erro) {
        console.error('[pwa]', new Error(data.erro));
        estado.sw = { estado: 'falhou', detalhe: `Ativo, mas sem estado do cache: ${data.erro}` };
      } else if (data?.precache) {
        const { total, ok, faltando } = data.precache;
        estado.sw = faltando?.length
          ? { estado: 'parcial', detalhe: `Ativo (v${data.versao}), com ${ok} de ${total} arquivos guardados. Fora: ${faltando.map((f) => f.url.split('/').pop()).join(', ')}.` }
          : { estado: 'ativo', detalhe: `Ativo (v${data.versao}): ${ok} arquivos guardados; o app abre sem internet.` };
      }
      emitir();
    };
    sw.postMessage({ tipo: 'estado-sw' }, [canal.port2]);
  }

  if (!/^https?:$/.test(location.protocol)) {
    estado.sw = { estado: 'indisponivel', detalhe: `Indisponível: a página foi aberta como ${location.protocol.replace(':', '')}, e o modo offline exige http ou https.` };
  } else if (!('serviceWorker' in navigator)) {
    estado.sw = { estado: 'indisponivel', detalhe: 'Indisponível: este navegador não tem service worker.' };
  } else {
    estado.sw = { estado: 'registrando', detalhe: 'Ativando o modo offline…' };
    // versão nova do SW assumiu a página (skipWaiting + clients.claim): reconsulta o cache e,
    // se já havia uma versão antes, avisa que o código desta aba é o antigo até recarregar
    const tinhaControle = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      consultarPrecache(navigator.serviceWorker.controller);
      if (tinhaControle) aviso('O app foi atualizado. Recarregue para usar a versão nova.', 'info', { acao: { rotulo: 'Recarregar', fn: () => location.reload() }, ms: 15000 });
    });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      const pronto = () => {
        estado.sw = { estado: 'ativo', detalhe: 'Ativo: o app abre sem internet com os dados já vistos.' };
        emitir();
        consultarPrecache(reg.active);
      };
      if (reg.active) pronto();
      else {
        const novo = reg.installing || reg.waiting;
        novo?.addEventListener('statechange', () => {
          if (novo.state === 'activated') pronto();
          if (novo.state === 'redundant') {
            const msg = 'o service worker foi descartado durante a instalação (falha no precache?)';
            console.error('[pwa]', new Error(msg));
            estado.sw = { estado: 'falhou', detalhe: `Falhou: ${msg}.` };
            emitir();
          }
        });
      }
    }).catch((err) => {
      console.error('[pwa]', err);
      estado.sw = { estado: 'falhou', detalhe: `Falhou: ${err.message}` };
      aviso(`Modo offline não ativou: ${err.message}`, 'erro');
      emitir();
    });
  }

  addEventListener('offline', () => aviso('Sem internet. O app segue com o que já está em cache; o mapa pode ficar incompleto.', 'info', { ms: 7000 }));
  addEventListener('online', () => aviso('Conexão de volta.', 'ok'));

  emitir();

  return {
    async instalar() {
      if (!convite) {
        aviso(estado.instalar === 'ios' ? 'No iPhone: toque em Compartilhar e depois em Adicionar à Tela de Início.' : 'Este navegador não ofereceu a instalação agora.', 'info');
        return;
      }
      try {
        await convite.prompt();
        const { outcome } = await convite.userChoice;
        if (outcome !== 'accepted') aviso('Instalação cancelada.', 'info');
      } catch (err) {
        console.error('[pwa]', err);
        aviso(`Não consegui abrir o convite de instalação: ${err.message}`, 'erro');
      } finally {
        convite = null;
        if (estado.instalar === 'pronto') estado.instalar = 'indisponivel';
        emitir();
      }
    },
  };
}
