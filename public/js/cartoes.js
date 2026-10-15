'use strict';

(function () {
  const lista = document.getElementById('lista');
  const vazio = document.getElementById('vazio');
  const msg = document.getElementById('msg');
  const form = document.getElementById('form-cartao');
  const campoNome = document.getElementById('nome');
  const campoDigitos = document.getElementById('digitos');
  const btnAdicionar = document.getElementById('btn-adicionar');
  const dlgEditar = document.getElementById('dlg-editar');
  const formEditar = document.getElementById('form-editar');
  const editarNome = document.getElementById('editar-nome');
  const editarDigitos = document.getElementById('editar-digitos');
  const msgEditar = document.getElementById('msg-editar');

  let cartoes = [];
  let editandoId = null;

  const comparar = (a, b) =>
    a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }) ||
    a.ultimos_4_digitos.localeCompare(b.ultimos_4_digitos);

  const digitosValidos = (texto) => /^[0-9]{4}$/.test(texto);

  function mostrarErro(texto) {
    UI.mostrar(msg, texto);
    msg.scrollIntoView({ block: 'nearest' });
  }

  // Campo dos 4 dígitos: só aceita números e recusa um número de cartão completo colado.
  function prepararCampoDigitos(campo, aoRecusar) {
    campo.addEventListener('input', () => {
      campo.value = campo.value.replace(/\D/g, '').slice(0, 4);
    });
    campo.addEventListener('paste', (evento) => {
      const colado = (evento.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      if (colado.length > 4) {
        evento.preventDefault();
        aoRecusar('Digite só os 4 últimos dígitos do cartão, nunca o número completo.');
      }
    });
  }

  prepararCampoDigitos(campoDigitos, mostrarErro);
  prepararCampoDigitos(editarDigitos, (texto) => UI.mostrar(msgEditar, texto));

  function desenhar() {
    lista.replaceChildren(
      ...cartoes.map((cartao) =>
        h(
          'li',
          { class: 'item' },
          h(
            'div',
            { class: 'item-info' },
            h('span', { class: 'item-nome' }, cartao.nome),
            h('span', { class: 'item-detalhe' }, 'final ' + cartao.ultimos_4_digitos)
          ),
          h(
            'div',
            { class: 'item-acoes' },
            h('button', { type: 'button', class: 'btn-texto', 'aria-label': 'Editar ' + cartao.nome, onclick: () => abrirEdicao(cartao) }, 'Editar'),
            h('button', { type: 'button', class: 'btn-texto btn-texto-perigo', 'aria-label': 'Excluir ' + cartao.nome, onclick: () => excluir(cartao) }, 'Excluir')
          )
        )
      )
    );
    vazio.hidden = cartoes.length > 0;
    lista.hidden = cartoes.length === 0;
  }

  async function carregar() {
    try {
      const resposta = await API.get('api/cartoes');
      cartoes = resposta.cartoes.sort(comparar);
      desenhar();
    } catch (erro) {
      mostrarErro(erro.message);
    }
  }

  // ---- adicionar ----
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    UI.ocultar(msg);

    const nome = campoNome.value.trim();
    const digitos = campoDigitos.value.trim();
    if (!nome) {
      mostrarErro('Informe o nome do cartão.');
      campoNome.focus();
      return;
    }
    if (!digitosValidos(digitos)) {
      mostrarErro('Informe os 4 últimos dígitos do cartão.');
      campoDigitos.focus();
      return;
    }

    UI.carregando(btnAdicionar, true, 'Adicionando...');
    try {
      const resposta = await API.post('api/cartoes', { nome, ultimos_4_digitos: digitos });
      cartoes.push(resposta.cartao);
      cartoes.sort(comparar);
      desenhar();
      form.reset();
      campoNome.focus();
    } catch (erro) {
      mostrarErro(erro.message);
    } finally {
      UI.carregando(btnAdicionar, false);
    }
  });

  // ---- editar ----
  function abrirEdicao(cartao) {
    editandoId = cartao.id;
    editarNome.value = cartao.nome;
    editarDigitos.value = cartao.ultimos_4_digitos;
    UI.ocultar(msgEditar);
    dlgEditar.showModal();
    editarNome.select();
  }

  dlgEditar.querySelectorAll('[data-fechar]').forEach((botao) => {
    botao.addEventListener('click', () => dlgEditar.close());
  });

  formEditar.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    UI.ocultar(msgEditar);

    const nome = editarNome.value.trim();
    const digitos = editarDigitos.value.trim();
    if (!nome) {
      UI.mostrar(msgEditar, 'Informe o nome do cartão.');
      return;
    }
    if (!digitosValidos(digitos)) {
      UI.mostrar(msgEditar, 'Informe os 4 últimos dígitos do cartão.');
      return;
    }

    const botao = formEditar.querySelector('[type="submit"]');
    UI.carregando(botao, true, 'Salvando...');
    try {
      const resposta = await API.put('api/cartoes?id=' + encodeURIComponent(editandoId), {
        nome,
        ultimos_4_digitos: digitos,
      });
      cartoes = cartoes.map((cartao) => (cartao.id === editandoId ? resposta.cartao : cartao)).sort(comparar);
      desenhar();
      dlgEditar.close();
    } catch (erro) {
      UI.mostrar(msgEditar, erro.message);
    } finally {
      UI.carregando(botao, false);
    }
  });

  // ---- excluir ----
  async function excluir(cartao) {
    const confirmou = await Dialogo.confirmar({
      titulo: 'Excluir cartão',
      texto: 'Excluir "' + cartao.nome + '" (final ' + cartao.ultimos_4_digitos + ')? Essa ação não pode ser desfeita.',
      rotulo: 'Excluir',
      perigo: true,
    });
    if (!confirmou) return;

    try {
      await API.excluir('api/cartoes?id=' + encodeURIComponent(cartao.id));
      cartoes = cartoes.filter((item) => item.id !== cartao.id);
      desenhar();
    } catch (erro) {
      Dialogo.aviso({ titulo: 'Não foi possível excluir', texto: erro.message });
    }
  }

  App.iniciar();
  carregar();
})();