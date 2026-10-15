'use strict';

/**
 * Service worker do organize!
 *
 * - Páginas, CSS, JS e ícones: "rede primeiro", sempre revalidando. Busca a versão mais nova e só usa a cópia
 *   guardada quando não há internet. Assim, ao atualizar os arquivos, o app atualiza junto.
 * - Dados: vêm do Supabase (outro endereço), que este service worker nunca intercepta. Despesas, cartões
 *   e sessão não ficam guardados aqui.
 */

const VERSAO = 'organize-v5';
const PRE_CACHE = ['offline.html', 'icons/icon-192.png'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO)
      .then((cache) => cache.addAll(PRE_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((chave) => chave !== VERSAO).map((chave) => caches.delete(chave))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  const url = new URL(pedido.url);

  if (pedido.method !== 'GET' || url.origin !== self.location.origin) return;

  evento.respondWith(
    // cache: 'no-cache' faz o navegador confirmar com o servidor se o arquivo mudou (sem isso,
    // ele pode reaproveitar um CSS/JS antigo guardado e a tela fica "meio atualizada")
    fetch(pedido, { cache: 'no-cache' })
      .then((resposta) => {
        if (resposta.ok) {
          const copia = resposta.clone();
          caches.open(VERSAO).then((cache) => cache.put(pedido, copia));
        }
        return resposta;
      })
      .catch(() =>
        caches.match(pedido).then((guardada) => {
          if (guardada) return guardada;
          if (pedido.mode === 'navigate') return caches.match('offline.html');
          return Response.error();
        })
      )
  );
});
