'use strict';

(function () {
  const lista = document.getElementById('lista');
  const vazio = document.getElementById('vazio');
  const msg = document.getElementById('msg');
  const form = document.getElementById('form-tipo');
  const campoNome = document.getElementById('nome');
  const campoConta = document.getElementById('so-vencimento');
  const campoEditarConta = document.getElementById('editar-so-vencimento');
  const btnAdicionar = document.getElementById('btn-adicionar');
  const btnSugeridos = document.getElementById('btn-sugeridos');
  const dlgEditar = document.getElementById('dlg-editar');
  const formEditar = document.getElementById('form-editar');
  const campoEditar = document.getElementById('editar-nome');
  const msgEditar = document.getElementById('msg-editar');

  const abaDespesa = document.getElementById('aba-tipos-despesa');
  const abaReceita = document.getElementById('aba-tipos-receita');
  const textos = {
    despesa: {
      titulo: 'Tipos de despesa',
      intro: 'Agrupe seus gastos por tipo, como Mercado ou Transporte. Para contas que só têm vencimento, como aluguel, água e luz, marque “Conta com vencimento”.',
      novo: 'Novo tipo de despesa',
      vazio: 'Crie o seu primeiro tipo acima ou comece com os sugeridos: Alimentação, Moradia, Transporte, Saúde, Lazer, Educação, Outros e as contas Aluguel, Água, Luz, Internet e Condomínio.',
    },
    receita: {
      titulo: 'Tipos de receita',
      intro: 'Agrupe o dinheiro que entra por tipo, como Salário ou Freelance.',
      novo: 'Novo tipo de receita',
      vazio: 'Crie o seu primeiro tipo acima ou comece com os sugeridos: Salário, Freelance, Investimentos, Reembolso e Outros.',
    },
  };

  let de = new URLSearchParams(window.location.search).get('aba') === 'receitas' ? 'receita' : 'despesa';
  let tipos = [];
  let editandoId = null;
  let pedido = 0; // descarta respostas antigas quando a aba muda rápido

  // Mesmos endereços para os dois tipos; receita leva ?de=receita
  const endereco = (extra = '') => 'api/tipos.php?de=' + de + extra;

  // Ignora maiúsculas e acentos: "saude" e "Saúde" contam como o mesmo nome
  const mesmoNome = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }) === 0;
  const comparar = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });

  function mostrarErro(texto) {
    UI.mostrar(msg, texto);
    msg.scrollIntoView({ block: 'nearest' });
  }

  function desenhar() {
    lista.replaceChildren(
      ...tipos.map((tipo) =>
        h(
          'li',
          { class: 'item' },
          h(
            'div',
            { class: 'item-info' },
            h('span', { class: 'item-nome' }, tipo.nome),
            ...(de === 'despesa' && tipo.so_vencimento ? [h('span', { class: 'item-detalhe' }, 'Conta com vencimento')] : [])
          ),
          h(
            'div',
            { class: 'item-acoes' },
            h('button', { type: 'button', class: 'btn-texto', 'aria-label': 'Editar ' + tipo.nome, onclick: () => abrirEdicao(tipo) }, 'Editar'),
            h('button', { type: 'button', class: 'btn-texto btn-texto-perigo', 'aria-label': 'Excluir ' + tipo.nome, onclick: () => excluir(tipo) }, 'Excluir')
          )
        )
      )
    );
    vazio.hidden = tipos.length > 0;
    lista.hidden = tipos.length === 0;
  }

  async function carregar() {
    try {
      const meu = ++pedido;
      const resposta = await API.get(endereco());
      if (meu !== pedido) return;
      tipos = resposta.tipos.sort(comparar);
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
    if (!nome) {
      mostrarErro('Informe o nome do tipo.');
      campoNome.focus();
      return;
    }
    if (tipos.some((tipo) => mesmoNome(tipo.nome, nome))) {
      mostrarErro('Já existe um tipo com esse nome.');
      campoNome.focus();
      return;
    }

    UI.carregando(btnAdicionar, true, 'Adicionando...');
    try {
      const resposta = await API.post(endereco(), de === 'despesa' ? { nome, so_vencimento: campoConta.checked } : { nome });
      tipos.push(resposta.tipo);
      tipos.sort(comparar);
      desenhar();
      form.reset();
      campoNome.focus();
    } catch (erro) {
      mostrarErro(erro.message);
    } finally {
      UI.carregando(btnAdicionar, false);
    }
  });

  // ---- tipos sugeridos ----
  btnSugeridos.addEventListener('click', async () => {
    UI.ocultar(msg);
    UI.carregando(btnSugeridos, true, 'Adicionando...');
    try {
      await API.post(endereco('&acao=sugeridos'));
      await carregar();
    } catch (erro) {
      mostrarErro(erro.message);
    } finally {
      UI.carregando(btnSugeridos, false);
    }
  });

  // ---- editar ----
  function abrirEdicao(tipo) {
    editandoId = tipo.id;
    campoEditar.value = tipo.nome;
    campoEditarConta.checked = Boolean(tipo.so_vencimento);
    UI.ocultar(msgEditar);
    dlgEditar.showModal();
    campoEditar.select();
  }

  dlgEditar.querySelectorAll('[data-fechar]').forEach((botao) => {
    botao.addEventListener('click', () => dlgEditar.close());
  });

  formEditar.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    UI.ocultar(msgEditar);

    const nome = campoEditar.value.trim();
    if (!nome) {
      UI.mostrar(msgEditar, 'Informe o nome do tipo.');
      return;
    }
    if (tipos.some((tipo) => tipo.id !== editandoId && mesmoNome(tipo.nome, nome))) {
      UI.mostrar(msgEditar, 'Já existe um tipo com esse nome.');
      return;
    }

    const botao = formEditar.querySelector('[type="submit"]');
    UI.carregando(botao, true, 'Salvando...');
    try {
      const resposta = await API.put(endereco('&id=' + encodeURIComponent(editandoId)), de === 'despesa' ? { nome, so_vencimento: campoEditarConta.checked } : { nome });
      tipos = tipos.map((tipo) => (tipo.id === editandoId ? resposta.tipo : tipo)).sort(comparar);
      desenhar();
      dlgEditar.close();
    } catch (erro) {
      UI.mostrar(msgEditar, erro.message);
    } finally {
      UI.carregando(botao, false);
    }
  });

  // ---- excluir ----
  async function excluir(tipo) {
    const confirmou = await Dialogo.confirmar({
      titulo: 'Excluir tipo',
      texto: 'Excluir "' + tipo.nome + '"? Essa ação não pode ser desfeita.',
      rotulo: 'Excluir',
      perigo: true,
    });
    if (!confirmou) return;

    try {
      await API.excluir(endereco('&id=' + encodeURIComponent(tipo.id)));
      tipos = tipos.filter((item) => item.id !== tipo.id);
      desenhar();
    } catch (erro) {
      Dialogo.aviso({ titulo: 'Não foi possível excluir', texto: erro.message });
    }
  }

  // ---------- abas Despesas | Receitas ----------

  function aplicarAba() {
    const t = textos[de];
    abaDespesa.setAttribute('aria-selected', String(de === 'despesa'));
    abaDespesa.tabIndex = de === 'despesa' ? 0 : -1;
    abaReceita.setAttribute('aria-selected', String(de === 'receita'));
    abaReceita.tabIndex = de === 'receita' ? 0 : -1;
    document.getElementById('titulo').textContent = t.titulo;
    document.getElementById('texto-intro').textContent = t.intro;
    document.getElementById('rotulo-novo').textContent = t.novo;
    document.getElementById('vazio-texto').textContent = t.vazio;
    document.getElementById('opcao-nova').hidden = de !== 'despesa';
    document.getElementById('opcao-editar').hidden = de !== 'despesa';
    document.title = t.titulo + ' - organize!';

    const url = new URL(window.location.href);
    if (de === 'receita') url.searchParams.set('aba', 'receitas');
    else url.searchParams.delete('aba');
    window.history.replaceState(null, '', url);
  }

  function trocarAba(novo, foco = false) {
    if (novo === de) return;
    de = novo;
    tipos = [];
    UI.ocultar(msg);
    form.reset();
    lista.replaceChildren();
    lista.hidden = true;
    vazio.hidden = true;
    aplicarAba();
    if (foco) (de === 'despesa' ? abaDespesa : abaReceita).focus();
    carregar();
  }

  abaDespesa.addEventListener('click', () => trocarAba('despesa'));
  abaReceita.addEventListener('click', () => trocarAba('receita'));
  [abaDespesa, abaReceita].forEach((aba) =>
    aba.addEventListener('keydown', (evento) => {
      if (evento.key !== 'ArrowLeft' && evento.key !== 'ArrowRight') return;
      evento.preventDefault();
      trocarAba(de === 'despesa' ? 'receita' : 'despesa', true);
    })
  );

  App.iniciar();
  aplicarAba();
  carregar();
})();