'use strict';

/**
 * Tela de Lançamentos: despesas que vencem no mês, totais, nova/editar/excluir e alternar pago/pendente.
 * Os valores são somados em centavos (inteiros) para não acumular erro de arredondamento.
 *
 * Cada despesa tem duas datas: a da compra e o vencimento. A lista do mês usa o vencimento.
 * No crédito dá para parcelar (2x a 24x) e qualquer despesa pode se repetir todo mês (2 a 60 meses).
 */
(function () {
  const $ = (id) => document.getElementById(id);

  const listaDias = $('lista-dias');
  const vazio = $('vazio');
  const vazioTitulo = $('vazio-titulo');
  const resumo = $('resumo');
  const msg = $('msg');
  const mesTitulo = $('mes-titulo');

  const dlg = $('dlg-despesa');
  const form = $('form-despesa');
  const dlgTitulo = $('dlg-despesa-titulo');
  const campoDescricao = $('d-descricao');
  const campoValor = $('d-valor');
  const rotuloValor = $('rotulo-valor');
  const campoData = $('d-data');
  const grupoCompra = $('grupo-compra');
  const camposDatas = $('campos-datas');
  const campoVenc = $('d-venc');
  const campoTipo = $('d-tipo');
  const campoCartao = $('d-cartao');
  const grupoCartao = $('grupo-cartao');
  const semCartao = $('sem-cartao');
  const grupoRepeticao = $('grupo-repeticao');
  const opcaoParcelada = $('opcao-parcelada');
  const grupoParcelas = $('grupo-parcelas');
  const campoParcelas = $('d-parcelas');
  const grupoMeses = $('grupo-meses');
  const campoMeses = $('d-meses');
  const previa = $('previa');
  const notaSerie = $('nota-serie');
  const dicaStatus = $('dica-status');
  const msgDespesa = $('msg-despesa');
  const btnSalvar = $('btn-salvar-despesa');
  const btnExcluir = $('btn-excluir-despesa');

  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const ROTULO_FORMA = { credito: 'Crédito', debito: 'Débito', pix: 'Pix' };
  const PARCELAS_MAX = 24;
  const MESES_MAX = 60;

  let tipos = [];
  let cartoes = [];
  let despesas = [];
  let editandoId = null;
  let vencimentoManual = false; // true depois que a pessoa mexe no vencimento: deixamos de sugerir
  let pedido = 0; // descarta respostas antigas quando o mês muda rápido

  campoParcelas.replaceChildren(
    ...Array.from({ length: PARCELAS_MAX - 1 }, (_, i) => h('option', { value: String(i + 2) }, i + 2 + 'x'))
  );
  campoParcelas.value = '3';

  // ---------- datas ----------

  const dois = (n) => String(n).padStart(2, '0');
  const dataIso = (d) => d.getFullYear() + '-' + dois(d.getMonth() + 1) + '-' + dois(d.getDate());
  const mesIso = (d) => d.getFullYear() + '-' + dois(d.getMonth() + 1);
  const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const dataBr = (iso) => iso.split('-').reverse().join('/');

  // "2026-10-14" -> Date local (sem deslocar o dia por fuso horário)
  function dataLocal(iso) {
    const [a, m, d] = iso.split('-').map(Number);
    return new Date(a, m - 1, d);
  }

  // Soma meses sempre a partir da data original: 31/01 + 1 = 28/02, mas 31/01 + 2 = 31/03.
  function somarMeses(iso, n) {
    const [a, m, d] = iso.split('-').map(Number);
    const indice = a * 12 + (m - 1) + n;
    const ano = Math.floor(indice / 12);
    const mes = indice % 12;
    const ultimoDia = new Date(ano, mes + 1, 0).getDate();
    return ano + '-' + dois(mes + 1) + '-' + dois(Math.min(d, ultimoDia));
  }

  function mesDaUrl() {
    const valor = new URLSearchParams(window.location.search).get('mes') || '';
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(valor) ? valor : mesIso(new Date());
  }

  let mes = mesDaUrl(); // "AAAA-MM"

  // As outras partes da tela (receitas, resumo) acompanham o mês daqui.
  window.OrganizeMes = { get atual() { return mes; }, irPara: (novo) => irParaMes(novo) };
  const avisar = (nome, detalhe) => document.dispatchEvent(new CustomEvent(nome, { detail: detalhe }));

  function deslocarMes(delta) {
    const [a, m] = mes.split('-').map(Number);
    return mesIso(new Date(a, m - 1 + delta, 1));
  }

  // ---------- valores ----------

  const centavos = (valor) => Math.round(Number(valor) * 100);

  // "1.234,56" | "1234,5" | "12.50" | "12" -> "1234.56" (ou null se não for um valor válido)
  function lerValor(texto) {
    let t = texto.replace(/\s|R\$/g, '');
    if (t === '') return null;
    if (t.includes(',')) {
      if (!/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(t)) return null;
      t = t.replace(/\./g, '').replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
      t = t.replace(/\./g, ''); // 1.500 = mil e quinhentos
    } else if (!/^\d+(\.\d{1,2})?$/.test(t)) {
      return null;
    }
    const numero = Number(t);
    if (!(numero > 0) || numero > 9999999999.99) return null;
    return numero.toFixed(2);
  }

  const valorParaCampo = (valor) => Number(valor).toFixed(2).replace('.', ',');

  // ---------- mensagens ----------

  function mostrarErro(texto) {
    $('carregando').hidden = true;
    UI.mostrar(msg, texto);
    msg.scrollIntoView({ block: 'nearest' });
  }

  // ---------- desenho da lista ----------

  const nomeDoTipo = (id) => (tipos.find((t) => t.id === id) || { nome: 'Sem tipo' }).nome;

  // "Conta com vencimento" (aluguel, água, luz): o lançamento não tem data da compra.
  const contaComVencimento = (id) => Boolean((tipos.find((t) => t.id === id) || {}).so_vencimento);

  const ehParcelada = (d) => d.serie_tipo === 'parcelada';
  const ehMensal = (d) => d.serie_tipo === 'mensal';

  function nomeExibido(despesa) {
    return ehParcelada(despesa) ? despesa.descricao + ' (' + despesa.serie_numero + '/' + despesa.serie_total + ')' : despesa.descricao;
  }

  function detalhe(despesa) {
    let texto = nomeDoTipo(despesa.tipo_id) + ' · ' + ROTULO_FORMA[despesa.forma_pagamento];
    if (despesa.forma_pagamento === 'credito') {
      const cartao = cartoes.find((c) => c.id === despesa.cartao_id);
      if (cartao) texto += ' · ' + cartao.nome + ' final ' + cartao.ultimos_4_digitos;
    }
    if (ehMensal(despesa)) texto += ' · Todo mês (' + despesa.serie_numero + '/' + despesa.serie_total + ')';
    if (despesa.data_despesa !== despesa.data_vencimento && !contaComVencimento(despesa.tipo_id)) {
      texto += ' · Compra em ' + despesa.data_despesa.split('-').reverse().slice(0, 2).join('/');
    }
    return texto;
  }

  function tituloDoDia(iso) {
    const d = dataLocal(iso);
    const semana = maiuscula(d.toLocaleDateString('pt-BR', { weekday: 'long' }).replace(/-feira$/, ''));
    return semana + ', ' + d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  }

  function linha(despesa) {
    const pago = despesa.status === 'pago';
    const nome = nomeExibido(despesa);
    return h(
      'li',
      { class: 'desp', 'data-id': despesa.id },
      h(
        'div',
        { class: 'desp-info' },
        h(
          'button',
          { type: 'button', class: 'desp-editar', 'aria-label': 'Editar ' + nome, onclick: () => abrirFormulario(despesa) },
          h('span', { class: 'desp-descricao' }, nome)
        ),
        h('span', { class: 'desp-detalhe' }, detalhe(despesa))
      ),
      h(
        'div',
        { class: 'desp-lado' },
        h('span', { class: 'desp-valor' }, moeda.format(Number(despesa.valor))),
        h(
          'button',
          {
            type: 'button',
            class: 'chip-botao',
            'aria-label': (pago ? 'Pago' : 'Pendente') + '. Tocar para marcar como ' + (pago ? 'pendente' : 'pago'),
            onclick: (evento) => alternarStatus(despesa, evento.currentTarget),
          },
          h('span', { class: 'chip ' + (pago ? 'chip-pago' : 'chip-pendente') }, pago ? 'Pago' : 'Pendente')
        )
      )
    );
  }

  function desenhar() {
    const dias = [];
    for (const despesa of despesas) {
      const ultimo = dias[dias.length - 1];
      if (ultimo && ultimo.data === despesa.data_vencimento) {
        ultimo.itens.push(despesa);
      } else {
        dias.push({ data: despesa.data_vencimento, itens: [despesa] });
      }
    }

    listaDias.replaceChildren(
      ...dias.map((dia) =>
        h(
          'section',
          { class: 'dia' },
          h('h2', { class: 'dia-titulo' }, tituloDoDia(dia.data)),
          h('ul', { class: 'lista' }, ...dia.itens.map(linha))
        )
      )
    );

    let pago = 0;
    let pendente = 0;
    for (const despesa of despesas) {
      if (despesa.status === 'pago') pago += centavos(despesa.valor);
      else pendente += centavos(despesa.valor);
    }
    $('total-pago').textContent = moeda.format(pago / 100);
    $('total-pendente').textContent = moeda.format(pendente / 100);

    $('carregando').hidden = true;
    resumo.hidden = despesas.length === 0;
    vazio.hidden = despesas.length > 0;
    avisar('lancamentos:alterados');
  }

  function desenharMes() {
    const [a, m] = mes.split('-').map(Number);
    const nome = maiuscula(new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
    mesTitulo.textContent = nome;
    vazioTitulo.textContent = 'Nenhuma despesa vence em ' + nome.charAt(0).toLowerCase() + nome.slice(1);
    document.title = nome + ' - organize!';
  }

  // ---------- carregar ----------

  async function carregarMes() {
    const meu = ++pedido;
    desenharMes();
    UI.ocultar(msg);
    try {
      const resposta = await API.get('api/despesas.php?mes=' + encodeURIComponent(mes));
      if (meu !== pedido) return;
      despesas = resposta.despesas;
      desenhar();
    } catch (erro) {
      if (meu !== pedido) return;
      mostrarErro(erro.message);
    }
  }

  function irParaMes(novo) {
    mes = novo;
    avisar('mes:mudou', { mes });
    const url = new URL(window.location.href);
    url.searchParams.set('mes', mes);
    window.history.replaceState(null, '', url);
    carregarMes();
  }

  $('mes-anterior').addEventListener('click', () => irParaMes(deslocarMes(-1)));
  $('mes-seguinte').addEventListener('click', () => irParaMes(deslocarMes(1)));

  // Tipos e cartões alimentam os nomes da lista e as opções do formulário.
  const base = Promise.all([API.get('api/tipos.php'), API.get('api/cartoes.php')])
    .then(([t, c]) => {
      tipos = t.tipos;
      cartoes = c.cartoes;
    })
    .catch((erro) => mostrarErro(erro.message));

  // ---------- formulário ----------

  const radio = (nome) => form.querySelector('input[name="' + nome + '"]:checked').value;
  const marcar = (nome, valor) => {
    form.querySelector('input[name="' + nome + '"][value="' + valor + '"]').checked = true;
  };

  function preencherOpcoes() {
    campoTipo.replaceChildren(
      h('option', { value: '' }, 'Escolha o tipo'),
      ...tipos.map((t) => h('option', { value: t.id }, t.nome))
    );
    campoCartao.replaceChildren(
      h('option', { value: '' }, 'Escolha o cartão'),
      ...cartoes.map((c) => h('option', { value: c.id }, c.nome + ' (final ' + c.ultimos_4_digitos + ')'))
    );
    semCartao.hidden = cartoes.length > 0;
  }

  // Sugere o vencimento: crédito vence no mês seguinte à compra; os demais, no mesmo dia.
  function sincronizarVencimento() {
    if (vencimentoManual || editandoId || !campoData.value || contaComVencimento(campoTipo.value)) return;
    campoVenc.value = radio('forma') === 'credito' ? somarMeses(campoData.value, 1) : campoData.value;
  }

  function atualizarPrevia() {
    const rep = radio('rep');
    if (editandoId || rep === 'unica') {
      previa.hidden = true;
      return;
    }

    const valor = lerValor(campoValor.value);
    const venc = campoVenc.value;
    let texto;

    if (valor === null || !venc) {
      texto = 'Informe o valor e o vencimento para ver como ficam os lançamentos.';
    } else if (rep === 'parcelada') {
      const n = Number(campoParcelas.value);
      const total = centavos(valor);
      const parcela = Math.floor(total / n);
      const ultima = total - parcela * (n - 1);
      if (parcela < 1) {
        texto = 'O valor é pequeno demais para dividir em ' + n + ' parcelas.';
      } else {
        texto =
          n + 'x de ' + moeda.format(parcela / 100) +
          (ultima !== parcela ? ' (a última de ' + moeda.format(ultima / 100) + ')' : '') +
          '. Vencem de ' + dataBr(venc) + ' a ' + dataBr(somarMeses(venc, n - 1)) + '.';
      }
    } else {
      const m = /^\d{1,2}$/.test(campoMeses.value) ? Number(campoMeses.value) : 0;
      if (m < 2 || m > MESES_MAX) {
        texto = 'Informe de 2 a ' + MESES_MAX + ' meses.';
      } else {
        texto =
          m + ' lançamentos de ' + moeda.format(Number(valor)) +
          ', com vencimento de ' + dataBr(venc) + ' a ' + dataBr(somarMeses(venc, m - 1)) + '.';
      }
    }
    previa.textContent = texto;
    previa.hidden = false;
  }

  // Mostra e esconde o que depende da forma de pagamento, da repetição e de estar criando ou editando.
  function atualizarCampos() {
    const soVencimento = contaComVencimento(campoTipo.value);
    grupoCompra.hidden = soVencimento;
    camposDatas.classList.toggle('campo-dupla--uma', soVencimento);

    const credito = radio('forma') === 'credito';
    grupoCartao.hidden = !credito;

    grupoRepeticao.hidden = Boolean(editandoId);
    opcaoParcelada.hidden = !credito;
    if (!credito && radio('rep') === 'parcelada') marcar('rep', 'unica');

    const rep = radio('rep');
    grupoParcelas.hidden = rep !== 'parcelada';
    grupoMeses.hidden = rep !== 'mensal';
    dicaStatus.hidden = Boolean(editandoId) || rep === 'unica';
    rotuloValor.textContent =
      rep === 'parcelada' ? 'Valor total da compra (R$)' : rep === 'mensal' ? 'Valor de cada mês (R$)' : 'Valor (R$)';

    atualizarPrevia();
  }

  form.querySelectorAll('input[name="forma"]').forEach((r) =>
    r.addEventListener('change', () => {
      sincronizarVencimento();
      atualizarCampos();
    })
  );
  campoTipo.addEventListener('change', () => {
    sincronizarVencimento();
    atualizarCampos();
  });
  form.querySelectorAll('input[name="rep"]').forEach((r) => r.addEventListener('change', atualizarCampos));

  campoData.addEventListener('input', () => {
    sincronizarVencimento();
    atualizarPrevia();
  });
  campoVenc.addEventListener('input', () => {
    vencimentoManual = true;
    atualizarPrevia();
  });
  campoParcelas.addEventListener('change', atualizarPrevia);

  // O valor só aceita números, vírgula e ponto; os meses, só números
  campoValor.addEventListener('input', () => {
    campoValor.value = campoValor.value.replace(/[^\d.,]/g, '');
    atualizarPrevia();
  });
  campoMeses.addEventListener('input', () => {
    campoMeses.value = campoMeses.value.replace(/\D/g, '').slice(0, 2);
    atualizarPrevia();
  });

  function abrirFormulario(despesa) {
    editandoId = despesa ? despesa.id : null;
    preencherOpcoes();
    UI.ocultar(msgDespesa);

    dlgTitulo.textContent = despesa ? 'Editar despesa' : 'Nova despesa';
    btnExcluir.hidden = !despesa;
    notaSerie.hidden = true;
    form.querySelectorAll('input[name="forma"]').forEach((r) => { r.disabled = false; });

    if (despesa) {
      vencimentoManual = true;
      campoDescricao.value = despesa.descricao;
      campoValor.value = valorParaCampo(despesa.valor);
      campoData.value = despesa.data_despesa;
      campoVenc.value = despesa.data_vencimento;
      campoTipo.value = despesa.tipo_id;
      marcar('forma', despesa.forma_pagamento);
      campoCartao.value = despesa.cartao_id || '';
      marcar('status', despesa.status);
      marcar('rep', 'unica');

      if (despesa.serie_tipo) {
        const posicao = despesa.serie_numero + ' de ' + despesa.serie_total;
        notaSerie.textContent = ehParcelada(despesa)
          ? 'Parcela ' + posicao + ' de uma compra parcelada. O que você alterar vale só para esta parcela.'
          : 'Lançamento ' + posicao + ' de uma despesa que se repete todo mês. O que você alterar vale só para este mês.';
        notaSerie.hidden = false;
        if (ehParcelada(despesa)) {
          // parcela só existe no crédito
          form.querySelectorAll('input[name="forma"]').forEach((r) => { r.disabled = r.value !== 'credito'; });
        }
      }
    } else {
      vencimentoManual = false;
      campoDescricao.value = '';
      campoValor.value = '';
      const hoje = new Date();
      campoData.value = dataIso(hoje);
      campoTipo.value = '';
      marcar('forma', 'pix');
      campoCartao.value = '';
      marcar('status', 'pendente');
      marcar('rep', 'unica');
      campoParcelas.value = '3';
      campoMeses.value = '12';
      sincronizarVencimento();
      // olhando um mês que não é o atual: o vencimento sugerido cai dentro do mês que está na tela
      if (mes !== mesIso(hoje)) {
        campoVenc.value = mes + '-' + dois(Math.min(hoje.getDate(), new Date(...mes.split('-').map(Number), 0).getDate()));
        vencimentoManual = true;
      }
    }
    atualizarCampos();
    dlg.showModal();
    if (!despesa) campoDescricao.focus();
  }

  async function abrirNova() {
    await base;
    if (tipos.length === 0) {
      const ir = await Dialogo.confirmar({
        titulo: 'Cadastre um tipo primeiro',
        texto: 'Para lançar uma despesa você precisa de pelo menos um tipo, como Mercado ou Transporte.',
        rotulo: 'Ir para Tipos',
      });
      if (ir) window.location.href = 'tipos.html';
      return;
    }
    abrirFormulario(null);
  }

  document.querySelectorAll('[data-nova-despesa]').forEach((b) => b.addEventListener('click', abrirNova));
  dlg.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', () => dlg.close()));

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    UI.ocultar(msgDespesa);

    const descricao = campoDescricao.value.trim();
    const valor = lerValor(campoValor.value);
    const forma = radio('forma');
    const rep = editandoId ? 'unica' : radio('rep');
    const meses = /^\d{1,2}$/.test(campoMeses.value) ? Number(campoMeses.value) : 0;

    let erro = null;
    let foco = null;
    if (!descricao) {
      erro = 'Informe a descrição da despesa.';
      foco = campoDescricao;
    } else if (valor === null) {
      erro = 'Informe um valor válido, como 25,90.';
      foco = campoValor;
    } else if (!campoTipo.value) {
      erro = 'Escolha o tipo da despesa.';
      foco = campoTipo;
    } else if (!campoData.value && !contaComVencimento(campoTipo.value)) {
      erro = 'Informe a data da compra.';
      foco = campoData;
    } else if (!campoVenc.value) {
      erro = 'Informe a data de vencimento.';
      foco = campoVenc;
    } else if (forma === 'credito' && !campoCartao.value) {
      erro = cartoes.length === 0 ? 'Cadastre um cartão para lançar no crédito.' : 'Escolha o cartão usado no crédito.';
      foco = campoCartao;
    } else if (rep === 'mensal' && (meses < 2 || meses > MESES_MAX)) {
      erro = 'Informe de 2 a ' + MESES_MAX + ' meses.';
      foco = campoMeses;
    } else if (rep === 'parcelada' && Math.floor(centavos(valor) / Number(campoParcelas.value)) < 1) {
      erro = 'O valor é pequeno demais para dividir em ' + campoParcelas.value + ' parcelas.';
      foco = campoValor;
    }
    if (erro) {
      UI.mostrar(msgDespesa, erro);
      foco.focus();
      return;
    }

    const corpo = {
      descricao,
      valor,
      data_despesa: contaComVencimento(campoTipo.value) ? campoVenc.value : campoData.value,
      data_vencimento: campoVenc.value,
      tipo_id: campoTipo.value,
      forma_pagamento: forma,
      cartao_id: forma === 'credito' ? campoCartao.value : null,
      status: radio('status'),
    };
    if (!editandoId) {
      corpo.repeticao = rep;
      if (rep === 'parcelada') corpo.parcelas = Number(campoParcelas.value);
      if (rep === 'mensal') corpo.meses = meses;
    }

    UI.carregando(btnSalvar, true, 'Salvando...');
    try {
      if (editandoId) {
        await API.put('api/despesas.php?id=' + encodeURIComponent(editandoId), corpo);
      } else {
        await API.post('api/despesas.php', corpo);
      }
      dlg.close();
      // se o vencimento caiu em outro mês, a tela acompanha a despesa
      const mesDoVencimento = corpo.data_vencimento.slice(0, 7);
      if (mesDoVencimento !== mes) irParaMes(mesDoVencimento);
      else await carregarMes();
    } catch (e) {
      UI.mostrar(msgDespesa, e.message);
    } finally {
      UI.carregando(btnSalvar, false);
    }
  });

  // ---------- excluir ----------

  // Pergunta o que excluir. Devolve 'esta' | 'proximas' | 'todas' | null (cancelou).
  async function perguntarEscopo(despesa) {
    const valor = moeda.format(Number(despesa.valor));

    if (!despesa.serie_id || despesa.serie_total < 2) {
      const confirmou = await Dialogo.confirmar({
        titulo: 'Excluir despesa',
        texto: 'Excluir "' + despesa.descricao + '" (' + valor + ')? Essa ação não pode ser desfeita.',
        rotulo: 'Excluir',
        perigo: true,
      });
      return confirmou ? 'esta' : null;
    }

    const parcelada = ehParcelada(despesa);
    const opcoes = [{ valor: 'esta', rotulo: parcelada ? 'Só esta parcela' : 'Só este mês' }];
    if (despesa.serie_numero > 1 && despesa.serie_numero < despesa.serie_total) {
      opcoes.push({ valor: 'proximas', rotulo: parcelada ? 'Esta e as próximas parcelas' : 'Este mês e os próximos' });
    }
    opcoes.push({ valor: 'todas', rotulo: parcelada ? 'Todas as parcelas' : 'Todos os meses', perigo: true });

    return Dialogo.escolher({
      titulo: 'Excluir despesa',
      texto:
        '"' + despesa.descricao + '" (' + despesa.serie_numero + ' de ' + despesa.serie_total + ') faz parte de ' +
        (parcelada ? 'uma compra parcelada' : 'uma despesa que se repete todo mês') +
        '. O que você quer excluir? Essa ação não pode ser desfeita.',
      opcoes,
    });
  }

  btnExcluir.addEventListener('click', async () => {
    const despesa = despesas.find((d) => d.id === editandoId);
    if (!despesa) return;

    const escopo = await perguntarEscopo(despesa);
    if (!escopo) return;

    try {
      await API.excluir('api/despesas.php?id=' + encodeURIComponent(despesa.id) + '&escopo=' + escopo);
      dlg.close();
      if (escopo === 'esta') {
        despesas = despesas.filter((d) => d.id !== despesa.id);
        desenhar();
      } else {
        await carregarMes();
      }
    } catch (erro) {
      Dialogo.aviso({ titulo: 'Não foi possível excluir', texto: erro.message });
    }
  });

  // ---------- pago / pendente ----------

  async function alternarStatus(despesa, botao) {
    const novo = despesa.status === 'pago' ? 'pendente' : 'pago';
    botao.disabled = true;
    try {
      const resposta = await API.requisitar('api/despesas.php?id=' + encodeURIComponent(despesa.id), {
        metodo: 'PATCH',
        corpo: { status: novo },
      });
      despesas = despesas.map((d) => (d.id === despesa.id ? resposta.despesa : d));
      desenhar();
      const atualizado = listaDias.querySelector('[data-id="' + despesa.id + '"] .chip-botao');
      if (atualizado) atualizado.focus(); // o teclado/leitor de tela não perde o lugar
    } catch (erro) {
      botao.disabled = false;
      Dialogo.aviso({ titulo: 'Não foi possível alterar', texto: erro.message });
    }
  }

  desenharMes();
  App.iniciar();
  base.then(carregarMes);
})();