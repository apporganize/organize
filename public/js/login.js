'use strict';

(function () {
  const form = document.getElementById('form-login');
  const msg = document.getElementById('msg');
  const botao = document.getElementById('btn-entrar');

  UI.iniciarMostrarSenha();

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    UI.ocultar(msg);

    const email = document.getElementById('email').value.trim();
    const senha = document.getElementById('senha').value;

    if (!email || !senha) {
      UI.mostrar(msg, 'Informe seu e-mail e sua senha.');
      return;
    }

    UI.carregando(botao, true, 'Entrando...');
    try {
      await Auth.entrar(email, senha);
      window.location.href = 'index.html';
    } catch (erro) {
      UI.mostrar(msg, erro.message);
      UI.carregando(botao, false);
    }
  });

  // Quem já está logado vai direto para o app.
  Auth.me(true)
    .then((resposta) => {
      if (resposta.usuario) window.location.replace('index.html');
    })
    .catch(() => { /* sem resposta do servidor: continua no login */ });
})();