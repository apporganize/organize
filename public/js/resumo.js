'use strict';

/**
 * Resumo do mês na tela de Lançamentos: receitas, despesas, saldo e limite de gastos.
 * Busca api/resumo sempre que o mês muda ou alguma receita/despesa muda
 * (eventos "mes:mudou" e "lancamentos:alterados", disparados por index.js e receitas.js).
 */
(function () {
  const $ = (id) => document.getElementById(id);

  const msg = $('msg-resumo');
  const btnLimite = $('btn-limite');

  const dlg = $('dlg-limite');
  const form = $('form-limite');
  const campoLimite = $('l-valor');
  const campoPercentual = $('l-percentual');
  const blocoValor = $('l-campo-valor');
  const blocoPercentual = $('l-campo-percentual');
  const previa = $('l-previa');
  const sugestoes = Array.from(dlg.querySelectorAll('.sugestao'));
  const modos = Array.from(dlg.querySelectorAll('input[name="lmodo"]'));
  const msgLimite = $('msg-limite');
  const btnSalvar = $('btn-salvar-limite');
  const btnRemover = $('btn-remover-limite');

  let configAtual = null; // { modo: 'valor'|'percentual', valor, percentual } ou null (sem limite)
  let rendaCentavos = 0; // receitas do mês (previstas): base da porcentagem
  let mesAtual = '';
  let pedido = 0;
  let agendado = null;

  // ---------- carregar ----------

  async function carregar() {
    const meu = ++pedido;
    try {
      const r = await API.get('api/resumo?mes=' + encodeURIComponent(window.OrganizeMes.atual));
      if (meu !== pedido) return;
      UI.ocultar(msg);
      configAtual = r.limite_config || null;
      rendaCentavos = Util.centavos(r.receitas.total);
      mesAtual = r.mes;
      Resumo.desenhar(r);
    } catch (erro) {
      if (meu !== pedido) return;
      Resumo.esconderEsqueleto();
      UI.mostrar(msg, erro.message);
    }
  }

  // Trocar de mês busca na hora. Avisos de "lançamento alterado" podem vir em sequência
  // (despesa e receita mexendo juntas): esses viram uma busca só.
  function agendar() {
    clearTimeout(agendado);
    agendado = setTimeout(carregar, 120);
  }

  document.addEventListener('mes:mudou', () => {
    clearTimeout(agendado);
    carregar();
  });
  document.addEventListener('lancamentos:alterados', agendar);

  // ---------- limite ----------

  const modoEscolhido = () => (modos.find((m) => m.checked) || {}).value || 'percentual';

  // Lê a porcentagem do campo: inteiro de 1 a 100, ou null.
  function lerPercentual() {
    const t = campoPercentual.value.trim();
    if (!/^\d{1,3}$/.test(t)) return null;
    const n = Number(t);
    return n >= 1 && n <= 100 ? n : null;
  }

  // Texto de apoio abaixo do campo: quanto a porcentagem dá em reais (ou quanto o valor é da renda).
  function atualizarPrevia() {
    const renda = Util.reais(rendaCentavos);
    const mesTexto = mesAtual ? Util.nomeDoMes(mesAtual).toLocaleLowerCase('pt-BR') : 'este mês';
    let texto = '';

    if (modoEscolhido() === 'percentual') {
      const pct = lerPercentual();
      if (rendaCentavos <= 0) {
        texto = 'Ainda não há receitas em ' + mesTexto + '. Cadastre suas receitas para o app calcular o valor do limite.';
      } else if (pct !== null) {
        const limite = Math.floor((rendaCentavos * pct) / 100);
        texto = pct + '% de ' + renda + ' (receitas de ' + mesTexto + ') = ' + Util.reais(limite);
      }
    } else {
      const valor = Util.lerValor(campoLimite.value);
      if (valor !== null && rendaCentavos > 0) {
        const pct = Math.round((Util.centavos(valor) * 100) / rendaCentavos);
        texto = 'Isso equivale a ' + pct + '% das receitas de ' + mesTexto + ' (' + renda + ').';
      }
    }
    previa.textContent = texto;

    const atual = lerPercentual();
    sugestoes.forEach((botao) => botao.setAttribute('aria-pressed', String(modoEscolhido() === 'percentual' && atual === Number(botao.dataset.pct))));
  }

  function aplicarModo() {
    const porcentagem = modoEscolhido() === 'percentual';
    blocoPercentual.hidden = !porcentagem;
    blocoValor.hidden = porcentagem;
    UI.ocultar(msgLimite);
    atualizarPrevia();
  }

  function definirModo(modo) {
    modos.forEach((m) => { m.checked = m.value === modo; });
    aplicarModo();
  }

  function abrirLimite() {
    UI.ocultar(msgLimite);
    campoPercentual.value = configAtual && configAtual.modo === 'percentual' ? String(configAtual.percentual) : '';
    campoLimite.value = configAtual && configAtual.modo === 'valor' ? Util.valorParaCampo(configAtual.valor) : '';
    btnRemover.hidden = !configAtual;
    definirModo(configAtual ? configAtual.modo : 'percentual');
    Dialogo.abrir(dlg, null);
    if (!window.matchMedia('(pointer: coarse)').matches) (modoEscolhido() === 'percentual' ? campoPercentual : campoLimite).select();
  }

  btnLimite.addEventListener('click', abrirLimite);
  dlg.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', () => dlg.close()));

  modos.forEach((m) => m.addEventListener('change', () => {
    aplicarModo();
    (modoEscolhido() === 'percentual' ? campoPercentual : campoLimite).focus();
  }));

  campoLimite.addEventListener('input', () => {
    campoLimite.value = campoLimite.value.replace(/[^\d.,]/g, '');
    atualizarPrevia();
  });

  campoPercentual.addEventListener('input', () => {
    campoPercentual.value = campoPercentual.value.replace(/\D/g, '').slice(0, 3);
    atualizarPrevia();
  });

  sugestoes.forEach((botao) => botao.addEventListener('click', () => {
    campoPercentual.value = botao.dataset.pct;
    definirModo('percentual');
    UI.ocultar(msgLimite);
  }));

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    UI.ocultar(msgLimite);

    let corpo;
    if (modoEscolhido() === 'percentual') {
      const pct = lerPercentual();
      if (pct === null) {
        UI.mostrar(msgLimite, 'Informe uma porcentagem de 1 a 100, como 80.');
        campoPercentual.focus();
        return;
      }
      corpo = { percentual: pct };
    } else {
      const valor = Util.lerValor(campoLimite.value);
      if (valor === null) {
        UI.mostrar(msgLimite, 'Informe um valor válido, como 3000,00.');
        campoLimite.focus();
        return;
      }
      corpo = { limite: valor };
    }

    UI.carregando(btnSalvar, true, 'Salvando...');
    try {
      await API.put('api/limite', corpo);
      dlg.close();
      await carregar();
    } catch (erro) {
      UI.mostrar(msgLimite, erro.message);
    } finally {
      UI.carregando(btnSalvar, false);
    }
  });

  btnRemover.addEventListener('click', async () => {
    const confirmou = await Dialogo.confirmar({
      titulo: 'Remover limite',
      texto: 'Remover o limite de gastos? O app deixa de avisar sobre o valor gasto no mês.',
      rotulo: 'Remover',
      perigo: true,
    });
    if (!confirmou) return;
    try {
      await API.excluir('api/limite');
      dlg.close();
      await carregar();
    } catch (erro) {
      UI.mostrar(msgLimite, erro.message);
    }
  });

  carregar();
})();
