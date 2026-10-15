'use strict';

/**
 * Base das telas internas (depois do login):
 *   h()      - cria elementos HTML de forma segura (texto vira texto, nunca HTML)
 *   Dialogo  - janelas de confirmação e de aviso
 *   App      - carrega o usuário e liga o botão Sair
 */

function h(tag, props = {}, ...filhos) {
  const elemento = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props)) {
    if (valor === false || valor == null) continue;
    if (chave === 'class') {
      elemento.className = valor;
    } else if (chave.startsWith('on')) {
      elemento.addEventListener(chave.slice(2), valor);
    } else {
      elemento.setAttribute(chave, valor === true ? '' : valor);
    }
  }
  elemento.append(...filhos);
  return elemento;
}

function criarDialogo(titulo, texto) {
  const idTitulo = 'dlg-titulo-' + Math.random().toString(36).slice(2, 8);
  const acoes = h('div', { class: 'dialogo-acoes' });
  const dialogo = h(
    'dialog',
    { class: 'dialogo', 'aria-labelledby': idTitulo },
    h(
      'form',
      { method: 'dialog' },
      h('h2', { class: 'dialogo-titulo', id: idTitulo }, titulo),
      h('p', { class: 'dialogo-texto' }, texto),
      acoes
    )
  );
  return { dialogo, acoes };
}

const Dialogo = {
  // Abre uma janela de formulário. Em tela de toque o teclado NÃO abre sozinho (ele cobriria a janela);
  // o foco vai para o título e o teclado sobe quando a pessoa toca num campo. No computador, foca o campo.
  abrir(dlg, campo) {
    const toque = window.matchMedia('(pointer: coarse)').matches;
    const titulo = dlg.querySelector('.dialogo-titulo');
    if (toque && titulo) {
      titulo.setAttribute('tabindex', '-1');
      titulo.setAttribute('autofocus', '');
    }
    dlg.showModal();
    if (toque) {
      if (titulo) titulo.focus({ preventScroll: true });
    } else if (campo) {
      campo.focus();
    }
    Teclado.ajustar();
  },

  // Resolve true se a pessoa confirmou, false se cancelou (ou apertou Esc).
  confirmar({ titulo, texto, rotulo = 'Confirmar', perigo = false }) {
    return new Promise((resolver) => {
      const { dialogo, acoes } = criarDialogo(titulo, texto);
      const cancelar = h('button', { type: 'submit', value: 'cancelar', class: 'btn btn-secundario' }, 'Cancelar');
      const confirmar = h(
        'button',
        { type: 'submit', value: 'ok', class: 'btn ' + (perigo ? 'btn-perigo' : 'btn-primario') },
        rotulo
      );
      acoes.append(cancelar, confirmar);

      dialogo.addEventListener('close', () => {
        resolver(dialogo.returnValue === 'ok');
        dialogo.remove();
      });

      document.body.append(dialogo);
      dialogo.showModal();
      cancelar.focus(); // o foco começa no botão seguro
    });
  },

  // Várias opções em colunas (ex.: "Só esta" / "Esta e as próximas" / "Todas").
  // opcoes: [{ valor, rotulo, perigo }]. Resolve o valor escolhido, ou null se cancelou (ou Esc).
  escolher({ titulo, texto, opcoes }) {
    return new Promise((resolver) => {
      const { dialogo, acoes } = criarDialogo(titulo, texto);
      acoes.classList.add('dialogo-acoes--coluna');
      const valores = opcoes.map((opcao) => opcao.valor);
      acoes.append(
        ...opcoes.map((opcao) =>
          h(
            'button',
            { type: 'submit', value: opcao.valor, class: 'btn ' + (opcao.perigo ? 'btn-perigo' : 'btn-secundario') },
            opcao.rotulo
          )
        ),
        h('button', { type: 'submit', value: 'cancelar', class: 'btn btn-secundario' }, 'Cancelar')
      );

      dialogo.addEventListener('close', () => {
        resolver(valores.includes(dialogo.returnValue) ? dialogo.returnValue : null);
        dialogo.remove();
      });

      document.body.append(dialogo);
      dialogo.showModal();
      acoes.lastElementChild.focus(); // o foco começa em Cancelar
    });
  },

  aviso({ titulo, texto, rotulo = 'Entendi' }) {
    return new Promise((resolver) => {
      const { dialogo, acoes } = criarDialogo(titulo, texto);
      acoes.append(h('button', { type: 'submit', value: 'ok', class: 'btn btn-primario' }, rotulo));

      dialogo.addEventListener('close', () => {
        resolver();
        dialogo.remove();
      });

      document.body.append(dialogo);
      dialogo.showModal();
    });
  },
};

/**
 * Util - valores, datas e meses usados pelas telas de receitas, resumo e painel.
 * Dinheiro vive em CENTAVOS (inteiros) dentro do JavaScript, para não acumular erro de arredondamento.
 */
const Util = {
  moeda: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }),

  // "1234.56" | 1234.56 -> 123456
  centavos(valor) {
    return Math.round(Number(valor) * 100);
  },

  // 123456 -> "R$ 1.234,56"
  reais(centavos) {
    return Util.moeda.format(centavos / 100);
  },

  // Valor curto para eixos e rótulos: 950 -> "950", 1500 -> "1,5 mil", 2300000 -> "2,3 mi"
  compacto(valor) {
    const n = Math.abs(valor);
    const f = (x) => x.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    if (n >= 1000000) return f(valor / 1000000) + ' mi';
    if (n >= 1000) return f(valor / 1000) + ' mil';
    return f(valor);
  },

  // "1.234,56" | "1234,5" | "12.50" | "12" -> "1234.56" (ou null se não for um valor válido)
  lerValor(texto) {
    let t = String(texto).replace(/\s|R\$/g, '');
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
  },

  // "1500.00" -> "1500,00" (para mostrar dentro de um campo de texto)
  valorParaCampo(valor) {
    return Number(valor).toFixed(2).replace('.', ',');
  },

  dois: (n) => String(n).padStart(2, '0'),
  dataIso: (d) => d.getFullYear() + '-' + Util.dois(d.getMonth() + 1) + '-' + Util.dois(d.getDate()),
  mesIso: (d) => d.getFullYear() + '-' + Util.dois(d.getMonth() + 1),
  maiuscula: (t) => t.charAt(0).toUpperCase() + t.slice(1),
  dataBr: (iso) => iso.split('-').reverse().join('/'),

  // "2026-10-14" -> Date local (sem deslocar o dia por fuso horário)
  dataLocal(iso) {
    const [a, m, d] = iso.split('-').map(Number);
    return new Date(a, m - 1, d);
  },

  // Soma meses a partir da data original: 31/01 + 1 = 28/02, mas 31/01 + 2 = 31/03.
  somarMeses(iso, n) {
    const [a, m, d] = iso.split('-').map(Number);
    const indice = a * 12 + (m - 1) + n;
    const ano = Math.floor(indice / 12);
    const mes = indice % 12;
    const ultimoDia = new Date(ano, mes + 1, 0).getDate();
    return ano + '-' + Util.dois(mes + 1) + '-' + Util.dois(Math.min(d, ultimoDia));
  },

  // "2026-10" -> "Outubro de 2026"
  nomeDoMes(mes) {
    const [a, m] = mes.split('-').map(Number);
    return Util.maiuscula(new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
  },

  // "2026-10" -> "out" (mês abreviado, sem ponto)
  mesCurto(mes) {
    const [a, m] = mes.split('-').map(Number);
    return new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  },

  // "2026-10" deslocado em n meses
  deslocarMes(mes, n) {
    const [a, m] = mes.split('-').map(Number);
    return Util.mesIso(new Date(a, m - 1 + n, 1));
  },

  // Lê ?mes=AAAA-MM da URL (ou o mês atual)
  mesDaUrl() {
    const valor = new URLSearchParams(window.location.search).get('mes') || '';
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(valor) ? valor : Util.mesIso(new Date());
  },
};

/**
 * Resumo do mês (receitas, despesas, saldo) e limite de gastos: desenho compartilhado entre a tela
 * de Lançamentos e o Painel. Os dois usam os mesmos ids no HTML (res-*, limite-*).
 */
const Resumo = {
  colorirSaldo(elemento, valor) {
    const c = Util.centavos(valor);
    elemento.classList.toggle('saldo-negativo', c < 0);
    elemento.classList.toggle('saldo-positivo', c > 0);
  },

  fraseDoLimite(l) {
    const restante = Util.reais(Util.centavos(l.restante));
    if (l.nivel === 'estourou') return 'Você passou ' + Util.reais(-Util.centavos(l.restante)) + ' do limite deste mês.';
    if (l.nivel === 'perto') {
      return Util.centavos(l.restante) === 0
        ? 'Você chegou ao limite do mês.'
        : 'Atenção: você já usou ' + l.percentual + '% do limite. Restam ' + restante + '.';
    }
    return 'Você usou ' + l.percentual + '% do limite. Restam ' + restante + '.';
  },

  desenharLimite(l, config) {
    const $ = (id) => document.getElementById(id);
    // Limite em % mas o mês ainda não tem receitas: não dá para calcular, então explica o que falta.
    const semRenda = !l && !!config && config.modo === 'percentual';
    $('limite').dataset.nivel = l ? l.nivel : semRenda ? 'sem-renda' : 'nenhum';
    $('btn-limite').textContent = l || semRenda ? 'Alterar limite' : 'Definir limite';
    $('limite-valores').hidden = !l;
    $('limite-barra').hidden = !l;

    const origem = $('limite-origem');
    if (origem) {
      origem.hidden = !(l && l.modo === 'percentual');
      if (!origem.hidden) {
        origem.textContent = 'Limite de ' + l.definido + '% da renda do mês (' + Util.reais(Util.centavos(l.renda)) + ').';
      }
    }

    if (!l) {
      $('limite-texto').textContent = semRenda
        ? 'Seu limite é de ' + config.percentual + '% da renda do mês, mas ainda não há receitas neste mês. Cadastre uma receita para o app calcular o valor.'
        : 'Defina um limite mensal para ser avisado quando os gastos chegarem perto dele.';
      return;
    }
    $('limite-valores').textContent = Util.reais(Util.centavos(l.usado)) + ' de ' + Util.reais(Util.centavos(l.limite));
    $('limite-barra-cheia').style.width = Math.min(100, l.percentual) + '%';
    $('limite-texto').textContent = Resumo.fraseDoLimite(l);
  },

  // r = resposta de api/resumo (ou o campo "resumo" de api/painel)
  desenhar(r) {
    const $ = (id) => document.getElementById(id);
    $('res-receitas').textContent = Util.reais(Util.centavos(r.receitas.total));
    $('res-despesas').textContent = Util.reais(Util.centavos(r.despesas.total));
    $('res-saldo').textContent = Util.reais(Util.centavos(r.saldo.previsto));
    $('res-saldo-atual').textContent = Util.reais(Util.centavos(r.saldo.atual));
    Resumo.colorirSaldo($('res-saldo'), r.saldo.previsto);
    Resumo.colorirSaldo($('res-saldo-atual'), r.saldo.atual);
    Resumo.desenharLimite(r.limite, r.limite_config);
    Resumo.esconderEsqueleto();
    $('mes-resumo').hidden = false;
  },

  // O esqueleto (barras cinza) ocupa o lugar do card enquanto o resumo ainda não chegou.
  esconderEsqueleto() {
    const e = document.getElementById('mes-resumo-esqueleto');
    if (e) e.hidden = true;
  },
};

/**
 * Avatar - o círculo com a foto (ou a inicial do nome) no topo de todas as telas e na tela de perfil.
 * Todo elemento com data-avatar tem <span class="avatar-letra"> e <img class="avatar-img">.
 * A foto (imagem em texto, data URL) vem de api/foto e fica guardada na aba (sessionStorage) junto do número da versão;
 * o número muda quando a foto muda, então só baixamos de novo quando preciso.
 * Os últimos dados ficam na sessão da aba (sessionStorage) só para o círculo não "piscar" ao trocar de tela.
 */
const Avatar = {
  chave: 'organize.avatar',
  atual: { nome: '', foto_v: null, foto: null },
  carregando: null, // versão da foto que está sendo baixada agora (evita pedir duas vezes)

  lembrar() {
    try { sessionStorage.setItem(Avatar.chave, JSON.stringify(Avatar.atual)); } catch (e) { /* sem armazenamento (ou cheio): segue sem */ }
  },

  esquecer() {
    try { sessionStorage.removeItem(Avatar.chave); } catch (e) { /* ok */ }
  },

  recuperar() {
    try {
      const guardado = JSON.parse(sessionStorage.getItem(Avatar.chave) || 'null');
      if (guardado && typeof guardado.nome === 'string') Avatar.atualizar(guardado, false);
    } catch (e) { /* ok */ }
  },

  // dados: { nome?, foto_v?, foto? } (foto_v nulo = sem foto; foto = data URL da versão foto_v)
  atualizar(dados, guardar = true) {
    const versaoAnterior = Avatar.atual.foto_v;
    Object.assign(Avatar.atual, dados);
    const { nome, foto_v: versao } = Avatar.atual;
    if (!versao || versao !== versaoAnterior && !('foto' in dados)) Avatar.atual.foto = null;
    const letra = (nome || '').trim().charAt(0).toLocaleUpperCase('pt-BR') || '?';

    document.querySelectorAll('[data-avatar]').forEach((el) => {
      const texto = el.querySelector('.avatar-letra');
      const imagem = el.querySelector('.avatar-img');
      texto.textContent = letra;
      if (el.tagName === 'A') el.setAttribute('aria-label', nome ? 'Meu perfil, ' + nome : 'Meu perfil');

      const origem = versao ? Avatar.atual.foto : null;
      if (!origem) {
        imagem.hidden = true;
        imagem.removeAttribute('src');
        texto.hidden = false;
        return;
      }
      imagem.onload = () => { imagem.hidden = false; texto.hidden = true; };
      imagem.onerror = () => { imagem.hidden = true; texto.hidden = false; };
      if (imagem.getAttribute('src') !== origem) imagem.src = origem;
      else if (imagem.complete && imagem.naturalWidth > 0) imagem.onload();
    });

    if (guardar) Avatar.lembrar();
    if (versao && !Avatar.atual.foto) Avatar.baixarFoto(versao);
  },

  // Baixa a foto da versão pedida (uma vez) e desenha. Se a foto mudou no meio do caminho, descarta.
  async baixarFoto(versao) {
    if (Avatar.carregando === versao) return;
    Avatar.carregando = versao;
    try {
      const { foto } = await API.get('api/foto');
      if (Avatar.atual.foto_v === versao && typeof foto === 'string') Avatar.atualizar({ foto });
    } catch (e) {
      /* sem foto por enquanto: fica a inicial do nome */
    } finally {
      if (Avatar.carregando === versao) Avatar.carregando = null;
    }
  },
};

const App = {
  // Liga o botão Sair, mostra o nome no topo e devolve o usuário (ou null se algo falhar).
  async iniciar() {
    Avatar.recuperar();

    document.getElementById('btn-sair').addEventListener('click', async () => {
      Avatar.esquecer();
      try {
        await Auth.sair();
      } catch (erro) {
        // mesmo com erro, volta para o login
      }
      window.location.replace('login.html');
    });

    try {
      const { usuario } = await Auth.me();
      const nome = document.getElementById('usuario-nome');
      if (nome) nome.textContent = usuario.nome;
      Avatar.atualizar({ nome: usuario.nome, foto_v: usuario.foto_v || null });
      return usuario;
    } catch (erro) {
      return null; // 401 já leva ao login (api.js)
    }
  },
};

/**
 * Teclado - no iPhone o teclado não encolhe a página: ele cobre a parte de baixo. Como as janelas
 * (formulários) ficam coladas embaixo da tela, elas acabavam atrás do teclado. Aqui medimos a área
 * realmente visível (visualViewport) e encaixamos a janela logo acima do teclado, com altura máxima
 * igual ao que sobrou; o miolo do formulário rola por dentro e os botões continuam à vista.
 */
const Teclado = {
  observados: new WeakSet(),

  limpar(d) {
    ['top', 'bottom', 'margin-top', 'margin-bottom', 'max-height'].forEach((p) => d.style.removeProperty(p));
  },

  // Encaixa a janela na base da área visível (acima do teclado) e limita a altura ao que sobrou.
  // Usa só o visualViewport (altura e deslocamento), sem depender de innerHeight, que no iOS não muda com o teclado.
  ajustar() {
    const vv = window.visualViewport;
    const celular = window.matchMedia('(max-width: 39.99rem)').matches;
    document.querySelectorAll('dialog[open]').forEach((d) => {
      if (!vv || !celular) {
        Teclado.limpar(d);
        return;
      }
      if (!Teclado.observados.has(d)) {
        // se o formulário muda de altura (ex.: aparecem campos de parcelas), encaixa de novo
        Teclado.observados.add(d);
        if (window.ResizeObserver) new ResizeObserver(() => Teclado.ajustar()).observe(d);
      }
      d.style.maxHeight = Math.max(160, Math.round(vv.height - 12)) + 'px';
      d.style.marginTop = '0';
      d.style.marginBottom = '0';
      d.style.bottom = 'auto';
      const altura = d.getBoundingClientRect().height;
      d.style.top = Math.max(0, Math.round(vv.offsetTop + vv.height - altura)) + 'px';
    });
  },

  iniciar() {
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', Teclado.ajustar);
      window.visualViewport.addEventListener('scroll', Teclado.ajustar);
    }
    window.addEventListener('resize', Teclado.ajustar);
    window.addEventListener('orientationchange', () => setTimeout(Teclado.ajustar, 300));
    document.addEventListener('focusin', () => {
      setTimeout(Teclado.ajustar, 50);
      setTimeout(Teclado.ajustar, 350); // o teclado do iPhone leva um instante para terminar de subir
    });
    // um campo tocado fica à vista depois que o teclado terminou de subir
    document.addEventListener('focusin', (e) => {
      if (!e.target.closest || !e.target.closest('dialog[open]')) return;
      if (!/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 400);
    });
  },
};
Teclado.iniciar();
