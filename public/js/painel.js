'use strict';

/**
 * Painel: receitas x despesas dos últimos 6 meses (colunas) e totais por tipo no mês escolhido (barras).
 * Os gráficos são desenhados aqui mesmo (SVG e HTML), sem biblioteca externa: o app continua leve e offline.
 * Toda a conta (somas, porcentagens) vem pronta de api/painel.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';

  const msg = $('msg');
  const caixa = $('grafico-meses');
  const dica = $('grafico-dica');

  let mes = Util.mesDaUrl();
  let dados = null; // última resposta de api/painel
  let pedido = 0;
  let larguraDesenhada = 0;
  let toqueEm = 0; // quando foi o último toque no gráfico

  // ---------- SVG ----------

  function s(tag, atributos = {}, ...filhos) {
    const elemento = document.createElementNS(NS, tag);
    for (const [chave, valor] of Object.entries(atributos)) elemento.setAttribute(chave, String(valor));
    elemento.append(...filhos);
    return elemento;
  }

  // Coluna que sai da linha de base, com os 4px de cima arredondados.
  function coluna(x, base, topo, largura) {
    const altura = base - topo;
    if (altura <= 0) return null;
    const r = Math.min(4, largura / 2, altura);
    const d =
      'M' + x + ' ' + base + 'V' + (topo + r) + 'Q' + x + ' ' + topo + ' ' + (x + r) + ' ' + topo +
      'H' + (x + largura - r) + 'Q' + (x + largura) + ' ' + topo + ' ' + (x + largura) + ' ' + (topo + r) +
      'V' + base + 'Z';
    return s('path', { d });
  }

  // Escala "redonda" para o eixo: devolve o topo e o passo (em reais).
  function escala(maximo) {
    if (!(maximo > 0)) return { topo: 100, passo: 25 };
    const bruto = maximo / 4;
    const potencia = 10 ** Math.floor(Math.log10(bruto));
    const f = bruto / potencia;
    const passo = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * potencia;
    return { topo: Math.ceil(maximo / passo) * passo, passo };
  }

  const rotuloMes = (m, indice) => {
    const [a, mm] = m.split('-');
    const curto = Util.mesCurto(m);
    return indice === 0 || mm === '01' ? curto + '/' + a.slice(2) : curto;
  };

  // ---------- gráfico de colunas: receitas x despesas por mês ----------

  function desenharMeses() {
    const meses = dados.meses;
    const largura = Math.max(240, Math.floor(caixa.clientWidth));
    larguraDesenhada = largura;
    const altura = 230;
    const margem = { t: 12, r: 6, b: 28, l: 48 };
    const areaW = largura - margem.l - margem.r;
    const areaH = altura - margem.t - margem.b;
    const base = margem.t + areaH;

    const maximo = Math.max(0, ...meses.flatMap((m) => [Number(m.receitas), Number(m.despesas)]));
    const { topo, passo } = escala(maximo);
    const y = (v) => margem.t + areaH * (1 - v / topo);
    const faixa = areaW / meses.length;
    const larguraColuna = Math.max(4, Math.min(24, (faixa * 0.72 - 2) / 2));

    const grade = [];
    for (let v = 0; v <= topo + passo / 2; v += passo) {
      grade.push(
        s('line', { x1: margem.l, x2: largura - margem.r, y1: y(v), y2: y(v), class: v === 0 ? 'eixo-base' : 'eixo-grade' }),
        s('text', { x: margem.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'eixo-texto' }, Util.compacto(v))
      );
    }

    const grupos = meses.map((m, i) => {
      const centro = margem.l + faixa * i + faixa / 2;
      const ultimo = i === meses.length - 1;
      const rec = coluna(centro - larguraColuna - 1, base, y(Number(m.receitas)), larguraColuna);
      const desp = coluna(centro + 1, base, y(Number(m.despesas)), larguraColuna);
      if (rec) rec.setAttribute('class', 'col-receita');
      if (desp) desp.setAttribute('class', 'col-despesa');

      const rotulo =
        Util.nomeDoMes(m.mes) + ': receitas ' + Util.moeda.format(Number(m.receitas)) +
        ', despesas ' + Util.moeda.format(Number(m.despesas)) + ', saldo ' + Util.moeda.format(Number(m.saldo));
      const fundo = s('rect', { x: margem.l + faixa * i, y: margem.t, width: faixa, height: areaH, class: 'faixa-fundo' });
      const alvo = s('rect', {
        x: margem.l + faixa * i, y: margem.t, width: faixa, height: areaH + margem.b, class: 'faixa-alvo',
        tabindex: 0, role: 'img', 'aria-label': rotulo,
      });
      const grupo = s(
        'g',
        { 'data-indice': i },
        fundo,
        ...(rec ? [rec] : []),
        ...(desp ? [desp] : []),
        s('text', { x: centro, y: altura - 8, 'text-anchor': 'middle', class: 'eixo-texto' + (ultimo ? ' eixo-texto--atual' : '') }, rotuloMes(m.mes, i)),
        alvo
      );
      const mostrar = () => mostrarDica(i, centro, largura);
      alvo.addEventListener('mouseenter', mostrar);
      alvo.addEventListener('focus', mostrar);
      alvo.addEventListener('click', (evento) => {
        evento.stopPropagation();
        toqueEm = Date.now();
        mostrar();
      });
      // No celular, o navegador manda um "mouseleave" logo depois do toque: ignoramos, senão a dica sumiria na hora.
      const sair = () => { if (Date.now() - toqueEm > 600) esconderDica(); };
      alvo.addEventListener('mouseleave', sair);
      alvo.addEventListener('blur', sair);
      return grupo;
    });

    const svg = s('svg', { viewBox: '0 0 ' + largura + ' ' + altura, width: largura, height: altura, role: 'group', 'aria-label': 'Gráfico de colunas: receitas e despesas por mês' }, ...grade, ...grupos);
    caixa.querySelector('svg')?.remove();
    caixa.prepend(svg);
  }

  function mostrarDica(i, centro, largura) {
    const m = dados.meses[i];
    caixa.querySelectorAll('.faixa-fundo').forEach((f, n) => f.classList.toggle('ativa', n === i));
    const negativo = Util.centavos(m.saldo) < 0;
    dica.replaceChildren(
      h('strong', {}, Util.nomeDoMes(m.mes)),
      h('span', { class: 'dica-linha' }, h('span', { class: 'legenda-marca legenda-marca--receita' }), 'Receitas ', h('b', {}, Util.moeda.format(Number(m.receitas)))),
      h('span', { class: 'dica-linha' }, h('span', { class: 'legenda-marca legenda-marca--despesa' }), 'Despesas ', h('b', {}, Util.moeda.format(Number(m.despesas)))),
      h('span', { class: 'dica-linha' }, 'Saldo ', h('b', { class: negativo ? 'saldo-negativo' : '' }, Util.moeda.format(Number(m.saldo))))
    );
    dica.hidden = false;
    const largDica = dica.offsetWidth;
    const esquerda = Math.min(Math.max(centro - largDica / 2, 0), largura - largDica);
    dica.style.left = esquerda + 'px';
  }

  function esconderDica() {
    dica.hidden = true;
    caixa.querySelectorAll('.faixa-fundo.ativa').forEach((f) => f.classList.remove('ativa'));
  }

  document.addEventListener('click', (evento) => {
    if (!caixa.contains(evento.target)) esconderDica();
  });
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') esconderDica();
  });

  // ---------- tabela (a mesma informação em texto) ----------

  function desenharTabela() {
    $('tabela-meses').replaceChildren(
      ...dados.meses.map((m) =>
        h(
          'tr',
          {},
          h('th', { scope: 'row', title: Util.nomeDoMes(m.mes) }, Util.maiuscula(rotuloMes(m.mes, 1))),
          h('td', {}, Util.moeda.format(Number(m.receitas))),
          h('td', {}, Util.moeda.format(Number(m.despesas))),
          h('td', { class: Util.centavos(m.saldo) < 0 ? 'saldo-negativo' : '' }, Util.moeda.format(Number(m.saldo)))
        )
      )
    );
  }

  // ---------- barras por tipo ----------

  const MAX_TIPOS = 6;

  const porcento = (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';

  function desenharTipos(destino, subtitulo, itens, resumoTotal, classeCor, vazioTexto) {
    const totalCentavos = Util.centavos(resumoTotal);
    subtitulo.textContent = Util.nomeDoMes(mes) + (totalCentavos > 0 ? ' · total ' + Util.reais(totalCentavos) : '');

    if (itens.length === 0) {
      destino.replaceChildren(h('p', { class: 'grafico-vazio' }, vazioTexto));
      return;
    }

    const linhas = itens.slice(0, MAX_TIPOS).map((i) => ({ nome: i.nome, centavos: Util.centavos(i.total), percentual: i.percentual, resto: false }));
    const resto = itens.slice(MAX_TIPOS);
    if (resto.length > 0) {
      linhas.push({
        nome: 'Demais tipos (' + resto.length + ')',
        centavos: resto.reduce((soma, i) => soma + Util.centavos(i.total), 0),
        percentual: Math.round(resto.reduce((soma, i) => soma + i.percentual, 0) * 10) / 10,
        resto: true,
      });
    }
    const maior = Math.max(...linhas.map((l) => l.centavos));

    destino.replaceChildren(
      h(
        'ul',
        { class: 'tipos-barras' },
        ...linhas.map((l) =>
          h(
            'li',
            {},
            h('div', { class: 'tipo-linha' }, h('span', { class: 'tipo-nome' }, l.nome), h('span', { class: 'tipo-valor' }, Util.reais(l.centavos) + ' · ' + porcento(l.percentual))),
            h('div', { class: 'tipo-trilho' }, h('span', { class: 'tipo-barra ' + (l.resto ? 'tipo-barra--resto' : classeCor), style: 'width:' + Math.max(1.5, (l.centavos / maior) * 100) + '%' }))
          )
        )
      )
    );
  }

  // ---------- carregar ----------

  function desenharTudo() {
    Resumo.desenhar(dados.resumo);
    $('sub-meses').textContent = 'Últimos ' + dados.meses.length + ' meses, até ' + Util.nomeDoMes(mes).toLowerCase();
    desenharMeses();
    desenharTabela();
    desenharTipos($('tipos-despesas'), $('sub-desp-tipo'), dados.por_tipo.despesas, dados.resumo.despesas.total, 'tipo-barra--despesa', 'Nenhuma despesa vence neste mês.');
    desenharTipos($('tipos-receitas'), $('sub-rec-tipo'), dados.por_tipo.receitas, dados.resumo.receitas.total, 'tipo-barra--receita', 'Nenhuma receita neste mês.');
  }

  async function carregar() {
    const meu = ++pedido;
    $('mes-titulo').textContent = Util.nomeDoMes(mes);
    document.title = 'Painel · ' + Util.nomeDoMes(mes) + ' - organize!';
    UI.ocultar(msg);
    try {
      const resposta = await API.get('api/painel?mes=' + encodeURIComponent(mes) + '&meses=6');
      if (meu !== pedido) return;
      dados = resposta;
      desenharTudo();
    } catch (erro) {
      if (meu !== pedido) return;
      Resumo.esconderEsqueleto();
      UI.mostrar(msg, erro.message);
    }
  }

  function irParaMes(novo) {
    mes = novo;
    const url = new URL(window.location.href);
    url.searchParams.set('mes', mes);
    window.history.replaceState(null, '', url);
    carregar();
  }

  $('mes-anterior').addEventListener('click', () => irParaMes(Util.deslocarMes(mes, -1)));
  $('mes-seguinte').addEventListener('click', () => irParaMes(Util.deslocarMes(mes, 1)));

  // gira o celular / redimensiona a janela: o gráfico se ajusta à nova largura
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      if (dados && Math.abs(caixa.clientWidth - larguraDesenhada) > 1) desenharMeses();
    }).observe(caixa);
  }

  App.iniciar();
  carregar();
})();
