'use strict';

/**
 * Resumo do mês na tela de Lançamentos: receitas, despesas, saldo e limite de gastos.
 * Busca api/resumo.php sempre que o mês muda ou alguma receita/despesa muda
 * (eventos "mes:mudou" e "lancamentos:alterados", disparados por index.js e receitas.js).
 */
(function () {
  const $ = (id) => document.getElementById(id);

  const msg = $('msg-resumo');
  const btnLimite = $('btn-limite');

  const dlg = $('dlg-limite');
  const form = $('form-limite');
  const campoLimite = $('l-valor');
  const msgLimite = $('msg-limite');
  const btnSalvar = $('btn-salvar-limite');
  const btnRemover = $('btn-remover-limite');

  let limiteAtual = null; // "3000.00" ou null
  let pedido = 0;
  let agendado = null;

  // ---------- carregar ----------

  async function carregar() {
    const meu = ++pedido;
    try {
      const r = await API.get('api/resumo.php?mes=' + encodeURIComponent(window.OrganizeMes.atual));
      if (meu !== pedido) return;
      UI.ocultar(msg);
      limiteAtual = r.limite ? r.limite.limite : null;
      Resumo.desenhar(r);
    } catch (erro) {
      if (meu !== pedido) return;
      UI.mostrar(msg, erro.message);
    }
  }

  // Vários avisos seguidos (despesas e receitas carregando juntas) viram uma busca só.
  function agendar() {
    clearTimeout(agendado);
    agendado = setTimeout(carregar, 120);
  }

  document.addEventListener('mes:mudou', agendar);
  document.addEventListener('lancamentos:alterados', agendar);

  // ---------- limite ----------

  function abrirLimite() {
    UI.ocultar(msgLimite);
    campoLimite.value = limiteAtual ? Util.valorParaCampo(limiteAtual) : '';
    btnRemover.hidden = !limiteAtual;
    dlg.showModal();
    campoLimite.select();
  }

  btnLimite.addEventListener('click', abrirLimite);
  dlg.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', () => dlg.close()));

  campoLimite.addEventListener('input', () => {
    campoLimite.value = campoLimite.value.replace(/[^\d.,]/g, '');
  });

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    UI.ocultar(msgLimite);
    const valor = Util.lerValor(campoLimite.value);
    if (valor === null) {
      UI.mostrar(msgLimite, 'Informe um valor válido, como 3000,00.');
      campoLimite.focus();
      return;
    }
    UI.carregando(btnSalvar, true, 'Salvando...');
    try {
      await API.put('api/limite.php', { limite: valor });
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
      await API.excluir('api/limite.php');
      dlg.close();
      await carregar();
    } catch (erro) {
      UI.mostrar(msgLimite, erro.message);
    }
  });

  agendar();
})();