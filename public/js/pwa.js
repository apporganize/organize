'use strict';

/**
 * Instalação no celular (PWA):
 *  - registra o service worker;
 *  - mostra o botão "Instalar app" quando o navegador permite instalar (Android e computador)
 *    ou ensina o caminho no iPhone/iPad, que não tem botão de instalar.
 */
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {
        // sem service worker o app funciona normalmente, só não instala nem abre offline
      });
    });
  }

  const botao = document.getElementById('btn-instalar');
  if (!botao) return;

  const jaInstalado =
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (jaInstalado) return;

  const ehIos =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad pedindo "site para computador"

  let convite = null;

  window.addEventListener('beforeinstallprompt', (evento) => {
    evento.preventDefault();
    convite = evento;
    botao.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    convite = null;
    botao.hidden = true;
  });

  if (ehIos) botao.hidden = false;

  botao.addEventListener('click', async () => {
    if (convite) {
      convite.prompt();
      await convite.userChoice;
      convite = null;
      botao.hidden = true;
      return;
    }
    if (typeof Dialogo !== 'undefined') {
      Dialogo.aviso({
        titulo: 'Instalar no iPhone ou iPad',
        texto: 'No Safari, toque em Compartilhar e escolha "Adicionar à Tela de Início".',
      });
    }
  });
})();