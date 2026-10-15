'use strict';

/**
 * Receitas na tela de Lançamentos: abas Despesas | Receitas, lista do mês, nova/editar/excluir
 * e alternar recebida / a receber. O mês é o mesmo da tela (window.OrganizeMes, definido em index.js).
 * Os valores são somados em centavos para não acumular erro de arredondamento.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  // ---------- abas ----------

  const ABAS = {
    despesas: { aba: $('aba-despesas'), painel: $('painel-despesas') },
    receitas: { aba: $('aba-receitas'), painel: $('painel-receitas') },
  };

  function abaDaUrl() {
    return new URLSearchParams(window.location.search).get('aba') === 'receitas' ? 'receitas' : 'despesas';
  }

  function mostrarAba(nome, { foco = false } = {}) {
    for (const [chave, { aba, painel }] of Object.entries(ABAS)) {
      const ativa = chave === nome;
      aba.setAttribute('aria-selected', String(ativa));
      aba.tabIndex = ativa ? 0 : -1;
      painel.hidden = !ativa;
    }
    document.querySelectorAll('[data-nova-despesa]').forEach((b) => { b.hidden = nome !== 'despesas'; });
    document.querySelectorAll('[data-nova-receita]').forEach((b) => { b.hidden = nome !== 'receitas'; });
    if (foco) ABAS[nome].aba.focus();

    const url = new URL(window.location.href);
    if (nome === 'receitas') url.searchParams.set('aba', 'receitas');
    else url.searchParams.delete('aba');
    window.history.replaceState(null, '', url);
  }

  Object.entries(ABAS).forEach(([nome, { aba }]) => {
    aba.addEventListener('click', () => mostrarAba(nome));
    aba.addEventListener('keydown', (evento) => {
      if (evento.key !== 'ArrowLeft' && evento.key !== 'ArrowRight') return;
      evento.preventDefault();
      mostrarAba(nome === 'despesas' ? 'receitas' : 'despesas', { foco: true });
    });
  });

  // ---------- elementos da lista e do formulário ----------

  const lista = $('lista-receitas');
  const resumo = $('resumo-receitas');
  const vazio = $('vazio-receitas');
  const vazioTitulo = $('vazio-receitas-titulo');
  const msg = $('msg-receitas');

  const dlg = $('dlg-receita');
  const form = $('form-receita');
  const dlgTitulo = $('dlg-receita-titulo');
  const campoDescricao = $('r-descricao');
  const campoValor = $('r-valor');
  const rotuloValor = $('rotulo-valor-receita');
  const campoTipo = $('r-tipo');
  const campoData = $('r-data');
  const grupoRepeticao = $('grupo-repeticao-receita');
  const grupoMeses = $('grupo-meses-receita');
  const campoMeses = $('r-meses');
  const previa = $('previa-receita');
  const notaSerie = $('nota-serie-receita');
  const dicaStatus = $('dica-status-receita');
  const msgForm = $('msg-receita');
  const btnSalvar = $('btn-salvar-receita');
  const btnExcluir = $('btn-excluir-receita');

  const MESES_MAX = 60;

  let tipos = [];
  let receitas = [];
  let editandoId = null;
  let pedido = 0; // descarta respostas antigas quando o mês muda rápido

  const mesAtual = () => window.OrganizeMes.atual;
  const ehMensal = (r) => r.serie_tipo === 'mensal';
  const nomeDoTipo = (id) => (tipos.find((t) => t.id === id) || { nome: 'Sem tipo' }).nome;
  const radio = (nome) => form.querySelector('input[name="' + nome + '"]:checked').value;
  const marcar = (nome, valor) => {
    form.querySelector('input[name="' + nome + '"][value="' + valor + '"]').checked = true;
  };

  function mostrarErro(texto) {
    UI.mostrar(msg, texto);
    msg.scrollIntoView({ block: 'nearest' });
  }

  // ---------- desenho da lista ----------

  function detalhe(receita) {
    let texto = nomeDoTipo(receita.tipo_receita_id);
    if (ehMensal(receita)) texto += ' · Todo mês (' + receita.serie_numero + '/' + receita.serie_total + ')';
    return texto;
  }

  function tituloDoDia(iso) {
    const d = Util.dataLocal(iso);
    const semana = Util.maiuscula(d.toLocaleDateString('pt-BR', { weekday: 'long' }).replace(/-feira$/, ''));
    return semana + ', ' + d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  }

  function linha(receita) {
    const recebida = receita.status === 'recebida';
    return h(
      'li',
      { class: 'desp', 'data-id': receita.id },
      h(
        'div',
        { class: 'desp-info' },
        h(
          'button',
          { type: 'button', class: 'desp-editar', 'aria-label': 'Editar ' + receita.descricao, onclick: () => abrirFormulario(receita) },
          h('span', { class: 'desp-descricao' }, receita.descricao)
        ),
        h('span', { class: 'desp-detalhe' }, detalhe(receita))
      ),
      h(
        'div',
        { class: 'desp-lado' },
        h('span', { class: 'desp-valor desp-valor--receita' }, Util.moeda.format(Number(receita.valor))),
        h(
          'button',
          {
            type: 'button',
            class: 'chip-botao',
            'aria-label': (recebida ? 'Recebida' : 'A receber') + '. Tocar para marcar como ' + (recebida ? 'a receber' : 'recebida'),
            onclick: (evento) => alternarStatus(receita, evento.currentTarget),
          },
          h('span', { class: 'chip ' + (recebida ? 'chip-pago' : 'chip-pendente') }, recebida ? 'Recebida' : 'A receber')
        )
      )
    );
  }

  // avisarResumo: false na primeira carga e ao trocar de mês (o resumo já busca por conta própria).
  function desenhar(avisarResumo = true) {
    const dias = [];
    for (const receita of receitas) {
      const ultimo = dias[dias.length - 1];
      if (ultimo && ultimo.data === receita.data_recebimento) ultimo.itens.push(receita);
      else dias.push({ data: receita.data_recebimento, itens: [receita] });
    }

    lista.replaceChildren(
      ...dias.map((dia) =>
        h('section', { class: 'dia' }, h('h2', { class: 'dia-titulo' }, tituloDoDia(dia.data)), h('ul', { class: 'lista' }, ...dia.itens.map(linha)))
      )
    );

    let recebido = 0;
    let aReceber = 0;
    for (const receita of receitas) {
      if (receita.status === 'recebida') recebido += Util.centavos(receita.valor);
      else aReceber += Util.centavos(receita.valor);
    }
    $('total-recebido').textContent = Util.reais(recebido);
    $('total-a-receber').textContent = Util.reais(aReceber);

    resumo.hidden = receitas.length === 0;
    vazio.hidden = receitas.length > 0;
    if (avisarResumo) document.dispatchEvent(new CustomEvent('lancamentos:alterados'));
  }

  // ---------- carregar ----------

  async function carregarMes(avisarResumo = false) {
    const meu = ++pedido;
    const nome = Util.nomeDoMes(mesAtual());
    vazioTitulo.textContent = 'Nenhuma receita em ' + nome.charAt(0).toLowerCase() + nome.slice(1);
    UI.ocultar(msg);
    try {
      const [resposta] = await Promise.all([API.get('api/receitas?mes=' + encodeURIComponent(mesAtual())), base]);
      if (meu !== pedido) return;
      receitas = resposta.receitas;
      desenhar(avisarResumo === true);
    } catch (erro) {
      if (meu !== pedido) return;
      mostrarErro(erro.message);
    }
  }

  document.addEventListener('mes:mudou', () => carregarMes());

  const base = API.get('api/tipos?de=receita')
    .then((resposta) => { tipos = resposta.tipos; })
    .catch((erro) => mostrarErro(erro.message));

  // ---------- formulário ----------

  function preencherTipos() {
    campoTipo.replaceChildren(
      h('option', { value: '' }, 'Escolha o tipo'),
      ...tipos.map((t) => h('option', { value: t.id }, t.nome))
    );
  }

  function atualizarPrevia() {
    if (editandoId || radio('rrep') !== 'mensal') {
      previa.hidden = true;
      return;
    }
    const valor = Util.lerValor(campoValor.value);
    const data = campoData.value;
    const m = /^\d{1,2}$/.test(campoMeses.value) ? Number(campoMeses.value) : 0;
    let texto;
    if (valor === null || !data) {
      texto = 'Informe o valor e a data para ver como ficam os lançamentos.';
    } else if (m < 2 || m > MESES_MAX) {
      texto = 'Informe de 2 a ' + MESES_MAX + ' meses.';
    } else {
      texto =
        m + ' lançamentos de ' + Util.moeda.format(Number(valor)) +
        ', de ' + Util.dataBr(data) + ' a ' + Util.dataBr(Util.somarMeses(data, m - 1)) + '.';
    }
    previa.textContent = texto;
    previa.hidden = false;
  }

  function atualizarCampos() {
    const mensal = radio('rrep') === 'mensal';
    grupoRepeticao.hidden = Boolean(editandoId);
    grupoMeses.hidden = !mensal;
    dicaStatus.hidden = Boolean(editandoId) || !mensal;
    rotuloValor.textContent = mensal ? 'Valor de cada mês (R$)' : 'Valor (R$)';
    atualizarPrevia();
  }

  form.querySelectorAll('input[name="rrep"]').forEach((r) => r.addEventListener('change', atualizarCampos));
  campoData.addEventListener('input', atualizarPrevia);
  campoValor.addEventListener('input', () => {
    campoValor.value = campoValor.value.replace(/[^\d.,]/g, '');
    atualizarPrevia();
  });
  campoMeses.addEventListener('input', () => {
    campoMeses.value = campoMeses.value.replace(/\D/g, '').slice(0, 2);
    atualizarPrevia();
  });

  function abrirFormulario(receita) {
    editandoId = receita ? receita.id : null;
    preencherTipos();
    UI.ocultar(msgForm);

    dlgTitulo.textContent = receita ? 'Editar receita' : 'Nova receita';
    btnExcluir.hidden = !receita;
    notaSerie.hidden = true;

    if (receita) {
      campoDescricao.value = receita.descricao;
      campoValor.value = Util.valorParaCampo(receita.valor);
      campoTipo.value = receita.tipo_receita_id;
      campoData.value = receita.data_recebimento;
      marcar('rstatus', receita.status);
      marcar('rrep', 'unica');
      if (receita.serie_tipo) {
        notaSerie.textContent =
          'Lançamento ' + receita.serie_numero + ' de ' + receita.serie_total +
          ' de uma receita que se repete todo mês. O que você alterar vale só para este mês.';
        notaSerie.hidden = false;
      }
    } else {
      campoDescricao.value = '';
      campoValor.value = '';
      campoTipo.value = '';
      const hoje = new Date();
      // olhando outro mês: a data sugerida cai dentro do mês que está na tela
      const mes = mesAtual();
      campoData.value =
        mes === Util.mesIso(hoje)
          ? Util.dataIso(hoje)
          : mes + '-' + Util.dois(Math.min(hoje.getDate(), new Date(...mes.split('-').map(Number), 0).getDate()));
      marcar('rstatus', 'a_receber');
      marcar('rrep', 'unica');
      campoMeses.value = '12';
    }
    atualizarCampos();
    Dialogo.abrir(dlg, receita ? null : campoDescricao);
  }

  async function abrirNova() {
    await base;
    if (tipos.length === 0) {
      const ir = await Dialogo.confirmar({
        titulo: 'Cadastre um tipo de receita primeiro',
        texto: 'Para lançar uma receita você precisa de pelo menos um tipo, como Salário ou Freelance.',
        rotulo: 'Ir para Tipos',
      });
      if (ir) window.location.href = 'tipos.html?aba=receitas';
      return;
    }
    abrirFormulario(null);
  }

  document.querySelectorAll('[data-nova-receita]').forEach((b) => b.addEventListener('click', abrirNova));
  dlg.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', () => dlg.close()));

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    UI.ocultar(msgForm);

    const descricao = campoDescricao.value.trim();
    const valor = Util.lerValor(campoValor.value);
    const rep = editandoId ? 'unica' : radio('rrep');
    const meses = /^\d{1,2}$/.test(campoMeses.value) ? Number(campoMeses.value) : 0;

    let erro = null;
    let foco = null;
    if (!descricao) {
      erro = 'Informe a descrição da receita.';
      foco = campoDescricao;
    } else if (valor === null) {
      erro = 'Informe um valor válido, como 3500,00.';
      foco = campoValor;
    } else if (!campoTipo.value) {
      erro = 'Escolha o tipo da receita.';
      foco = campoTipo;
    } else if (!campoData.value) {
      erro = 'Informe a data de recebimento.';
      foco = campoData;
    } else if (rep === 'mensal' && (meses < 2 || meses > MESES_MAX)) {
      erro = 'Informe de 2 a ' + MESES_MAX + ' meses.';
      foco = campoMeses;
    }
    if (erro) {
      UI.mostrar(msgForm, erro);
      foco.focus();
      return;
    }

    const corpo = {
      descricao,
      valor,
      data_recebimento: campoData.value,
      tipo_receita_id: campoTipo.value,
      status: radio('rstatus'),
    };
    if (!editandoId) {
      corpo.repeticao = rep;
      if (rep === 'mensal') corpo.meses = meses;
    }

    UI.carregando(btnSalvar, true, 'Salvando...');
    try {
      if (editandoId) await API.put('api/receitas?id=' + encodeURIComponent(editandoId), corpo);
      else await API.post('api/receitas', corpo);
      dlg.close();
      // se a data caiu em outro mês, a tela acompanha a receita (index.js muda o mês e avisa)
      if (corpo.data_recebimento.slice(0, 7) !== mesAtual()) window.OrganizeMes.irPara(corpo.data_recebimento.slice(0, 7));
      else await carregarMes(true);
    } catch (e) {
      UI.mostrar(msgForm, e.message);
    } finally {
      UI.carregando(btnSalvar, false);
    }
  });

  // ---------- excluir ----------

  async function perguntarEscopo(receita) {
    if (!receita.serie_id || receita.serie_total < 2) {
      const confirmou = await Dialogo.confirmar({
        titulo: 'Excluir receita',
        texto: 'Excluir "' + receita.descricao + '" de ' + Util.moeda.format(Number(receita.valor)) + '? Essa ação não pode ser desfeita.',
        rotulo: 'Excluir',
        perigo: true,
      });
      return confirmou ? 'esta' : null;
    }

    const opcoes = [{ valor: 'esta', rotulo: 'Só este mês' }];
    if (receita.serie_numero > 1 && receita.serie_numero < receita.serie_total) {
      opcoes.push({ valor: 'proximas', rotulo: 'Este mês e os próximos' });
    }
    opcoes.push({ valor: 'todas', rotulo: 'Todos os meses', perigo: true });

    return Dialogo.escolher({
      titulo: 'Excluir receita',
      texto:
        '"' + receita.descricao + '" (' + receita.serie_numero + ' de ' + receita.serie_total +
        ') faz parte de uma receita que se repete todo mês. O que você quer excluir? Essa ação não pode ser desfeita.',
      opcoes,
    });
  }

  btnExcluir.addEventListener('click', async () => {
    const receita = receitas.find((r) => r.id === editandoId);
    if (!receita) return;

    const escopo = await perguntarEscopo(receita);
    if (!escopo) return;

    try {
      await API.excluir('api/receitas?id=' + encodeURIComponent(receita.id) + '&escopo=' + escopo);
      dlg.close();
      if (escopo === 'esta') {
        receitas = receitas.filter((r) => r.id !== receita.id);
        desenhar();
      } else {
        await carregarMes(true);
      }
    } catch (erro) {
      Dialogo.aviso({ titulo: 'Não foi possível excluir', texto: erro.message });
    }
  });

  // ---------- recebida / a receber ----------

  async function alternarStatus(receita, botao) {
    const novo = receita.status === 'recebida' ? 'a_receber' : 'recebida';
    botao.disabled = true;
    try {
      const resposta = await API.requisitar('api/receitas?id=' + encodeURIComponent(receita.id), {
        metodo: 'PATCH',
        corpo: { status: novo },
      });
      receitas = receitas.map((r) => (r.id === receita.id ? resposta.receita : r));
      desenhar();
      const atualizado = lista.querySelector('[data-id="' + receita.id + '"] .chip-botao');
      if (atualizado) atualizado.focus(); // o teclado/leitor de tela não perde o lugar
    } catch (erro) {
      botao.disabled = false;
      Dialogo.aviso({ titulo: 'Não foi possível alterar', texto: erro.message });
    }
  }

  // ---------- começo ----------

  mostrarAba(abaDaUrl());
  carregarMes();
})();
