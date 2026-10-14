'use strict';

(function () {
  const SENHA_MIN = 8;
  const form = document.getElementById('form-cadastro');
  const msg = document.getElementById('msg');
  const botao = document.getElementById('btn-cadastrar');

  UI.iniciarMostrarSenha();

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    UI.ocultar(msg);

    const nome = document.getElementById('nome').value.trim();
    const email = document.getElementById('email').value.trim();
    const senha = document.getElementById('senha').value;
    const confirmar = document.getElementById('confirmar').value;

    if (!nome) {
      UI.mostrar(msg, 'Informe seu nome.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      UI.mostrar(msg, 'Informe um e-mail válido.');
      return;
    }
    if (senha.length < SENHA_MIN) {
      UI.mostrar(msg, 'A senha deve ter pelo menos ' + SENHA_MIN + ' caracteres.');
      return;
    }
    if (senha !== confirmar) {
      UI.mostrar(msg, 'As senhas não são iguais.');
      return;
    }

    UI.carregando(botao, true, 'Criando conta...');
    try {
      const resultado = await Auth.cadastrar(nome, email, senha);

      if (resultado.logado) {
        window.location.href = 'index.html';
        return;
      }

      // Projeto com "Confirm email" ligado no Supabase
      UI.mostrar(
        msg,
        'Conta criada. Enviamos um link de confirmação para o seu e-mail. Depois de confirmar, entre.',
        'ok'
      );
      botao.textContent = 'Conta criada';
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
    .catch(() => { /* sem resposta do servidor: continua no cadastro */ });
})();