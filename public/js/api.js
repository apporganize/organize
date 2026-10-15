'use strict';

/**
 * Funções compartilhadas por todas as telas:
 *   API  - chamadas ao backend (backend.js), que conversa com o Supabase
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
    // Não há servidor próprio: o backend.js (JavaScript) valida, faz as contas e fala com o Supabase.
    const { status, dados } = await Backend.tratar(metodo, url, corpo);

    if (status >= 400 || !dados || dados.ok === false) {
      // Sessão expirada em uma tela interna: volta para o login.
      if (status === 401 && !API.paginaPublica() && !API.indoParaLogin) {
        try { sessionStorage.removeItem('organize.avatar'); } catch (e) { /* ok */ }
        API.indoParaLogin = true; // várias chamadas em paralelo podem receber 401: redireciona uma vez só
        window.location.replace('login.html');
      }
      throw new ApiError((dados && dados.erro) || 'Erro inesperado. Tente novamente.', status);
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

// Ao entrar numa conta, esquece o círculo (foto/inicial) guardado de quem usou antes neste navegador.
function esquecerAvatar() {
  try { sessionStorage.removeItem('organize.avatar'); } catch (e) { /* ok */ }
}

const Auth = {
  // opcional = true: sem sessão responde { usuario: null } em vez de erro 401
  me(opcional = false)          { return API.get('api/auth?acao=me' + (opcional ? '&opcional=1' : '')); },
  entrar(email, senha)          { esquecerAvatar(); return API.post('api/auth?acao=entrar', { email, senha }); },
  cadastrar(nome, email, senha) { esquecerAvatar(); return API.post('api/auth?acao=cadastrar', { nome, email, senha }); },
  sair()                        { return API.post('api/auth?acao=sair'); },
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