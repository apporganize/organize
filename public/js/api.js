'use strict';

/**
 * Funções compartilhadas por todas as telas:
 *   API  - chamadas fetch (AJAX) ao back-end PHP
 *   Auth - ações de autenticação
 *   UI   - pequenos ajudantes de interface
 */

class ApiError extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.name = 'ApiError';
    this.status = status;
  }
}

const API = {
  indoParaLogin: false,
  // Telas de login e cadastro têm o atributo data-publica no <body>.
  paginaPublica() {
    return document.body.hasAttribute('data-publica');
  },

  async requisitar(url, { metodo = 'GET', corpo } = {}) {
    const opcoes = {
      method: metodo,
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest', // exigido pelo back-end (proteção contra CSRF)
      },
    };
    if (corpo !== undefined) {
      opcoes.headers['Content-Type'] = 'application/json';
      opcoes.body = JSON.stringify(corpo);
    }

    let resposta;
    try {
      resposta = await fetch(url, opcoes);
    } catch (e) {
      throw new ApiError('Sem conexão com o servidor. Confira se ele está rodando e tente de novo.', 0);
    }

    let dados = null;
    try {
      dados = await resposta.json();
    } catch (e) {
      // resposta sem JSON (ex.: erro fatal do PHP)
    }

    if (!resposta.ok || (dados && dados.ok === false)) {
      // Sessão expirada em uma tela interna: volta para o login.
      if (resposta.status === 401 && !API.paginaPublica() && !API.indoParaLogin) {
        API.indoParaLogin = true; // várias chamadas em paralelo podem receber 401: redireciona uma vez só
        window.location.replace('login.html');
      }
      throw new ApiError((dados && dados.erro) || 'Erro inesperado. Tente novamente.', resposta.status);
    }
    return dados;
  },

  get(url) {
    return API.requisitar(url);
  },

  post(url, corpo = {}) {
    return API.requisitar(url, { metodo: 'POST', corpo });
  },

  put(url, corpo = {}) {
    return API.requisitar(url, { metodo: 'PUT', corpo });
  },

  excluir(url) {
    return API.requisitar(url, { metodo: 'DELETE' });
  },
};

const Auth = {
  // opcional = true: sem sessão responde { usuario: null } em vez de erro 401
  me(opcional = false)          { return API.get('api/auth.php?acao=me' + (opcional ? '&opcional=1' : '')); },
  entrar(email, senha)          { return API.post('api/auth.php?acao=entrar', { email, senha }); },
  cadastrar(nome, email, senha) { return API.post('api/auth.php?acao=cadastrar', { nome, email, senha }); },
  sair()                        { return API.post('api/auth.php?acao=sair'); },
};

const UI = {
  // tipo: 'erro' ou 'ok'
  mostrar(elemento, texto, tipo = 'erro') {
    elemento.textContent = texto;
    elemento.className = 'msg msg-' + tipo;
    elemento.hidden = false;
  },

  ocultar(elemento) {
    elemento.hidden = true;
    elemento.textContent = '';
  },

  carregando(botao, ativo, texto) {
    if (ativo) {
      botao.dataset.textoOriginal = botao.textContent;
      if (texto) botao.textContent = texto;
      botao.disabled = true;
    } else {
      botao.textContent = botao.dataset.textoOriginal || botao.textContent;
      botao.disabled = false;
    }
  },

  // Botão "Mostrar/Ocultar" dos campos de senha.
  // data-mostrar-senha="id1 id2" indica quais campos ele controla.
  iniciarMostrarSenha() {
    document.querySelectorAll('[data-mostrar-senha]').forEach((botao) => {
      const campos = botao.dataset.mostrarSenha
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean);

      botao.addEventListener('click', () => {
        const mostrar = campos[0].type === 'password';
        campos.forEach((campo) => { campo.type = mostrar ? 'text' : 'password'; });
        botao.textContent = mostrar ? 'Ocultar' : 'Mostrar';
        botao.setAttribute('aria-pressed', String(mostrar));
      });
    });
  },
};