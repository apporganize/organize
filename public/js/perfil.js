'use strict';

/**
 * Tela de perfil: foto, nome, endereço e limpeza dos registros.
 * A foto é reduzida aqui no navegador (quadrado de 256x256, JPEG) antes de ser guardada.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  const LADO_FOTO = 256;
  const TAMANHO_MAX_ORIGINAL = 25 * 1024 * 1024; // só para não travar o navegador com arquivos enormes

  const campos = {
    nome: $('p-nome'),
    cep: $('p-cep'),
    uf: $('p-uf'),
    rua: $('p-rua'),
    numero: $('p-numero'),
    complemento: $('p-complemento'),
    bairro: $('p-bairro'),
    cidade: $('p-cidade'),
  };

  const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);

  // ---------- dados ----------

  function preencher(perfil) {
    for (const [nome, campo] of Object.entries(campos)) campo.value = perfil[nome] || '';
    campos.cep.value = mascaraCep(campos.cep.value);
    $('p-email').textContent = perfil.email || '';
    $('btn-remover-foto').hidden = !perfil.foto_v;
    Avatar.atualizar({ nome: perfil.nome, foto_v: perfil.foto_v || null });
    const topo = $('usuario-nome');
    if (topo) topo.textContent = perfil.nome;
  }

  async function carregar() {
    try {
      const { perfil } = await API.get('api/perfil');
      preencher(perfil);
    } catch (erro) {
      UI.mostrar($('msg-perfil'), erro.message);
    }
  }

  // CEP aparece como 00000-000, mas só os números vão para o servidor
  function mascaraCep(texto) {
    const n = texto.replace(/\D/g, '').slice(0, 8);
    return n.length > 5 ? n.slice(0, 5) + '-' + n.slice(5) : n;
  }
  campos.cep.addEventListener('input', () => { campos.cep.value = mascaraCep(campos.cep.value); });

  $('form-perfil').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const msg = $('msg-perfil');
    UI.ocultar(msg);

    const corpo = {};
    for (const [nome, campo] of Object.entries(campos)) corpo[nome] = campo.value.trim();
    if (!corpo.nome) {
      UI.mostrar(msg, 'Informe seu nome.');
      campos.nome.focus();
      return;
    }
    if (corpo.cep && corpo.cep.replace(/\D/g, '').length !== 8) {
      UI.mostrar(msg, 'O CEP deve ter 8 números.');
      campos.cep.focus();
      return;
    }

    const botao = $('btn-salvar-perfil');
    UI.carregando(botao, true, 'Salvando…');
    try {
      const { perfil } = await API.put('api/perfil', corpo);
      preencher(perfil);
      UI.mostrar(msg, 'Dados salvos.', 'ok');
    } catch (erro) {
      UI.mostrar(msg, erro.message);
    } finally {
      UI.carregando(botao, false);
    }
  });

  // ---------- foto ----------

  function abrirImagem(arquivo) {
    return new Promise((resolver, rejeitar) => {
      const endereco = URL.createObjectURL(arquivo);
      const imagem = new Image();
      imagem.onload = () => { URL.revokeObjectURL(endereco); resolver(imagem); };
      imagem.onerror = () => { URL.revokeObjectURL(endereco); rejeitar(new Error('abrir')); };
      imagem.src = endereco;
    });
  }

  // Recorta o centro em quadrado e reduz para LADO_FOTO x LADO_FOTO. Devolve "data:image/jpeg;base64,...".
  async function prepararFoto(arquivo) {
    const imagem = await abrirImagem(arquivo);
    const largura = imagem.naturalWidth;
    const altura = imagem.naturalHeight;
    if (!largura || !altura) throw new Error('abrir');

    const lado = Math.min(largura, altura);
    const canvas = document.createElement('canvas');
    canvas.width = LADO_FOTO;
    canvas.height = LADO_FOTO;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // PNG com fundo transparente vira fundo branco no JPEG
    ctx.fillRect(0, 0, LADO_FOTO, LADO_FOTO);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imagem, (largura - lado) / 2, (altura - lado) / 2, lado, lado, 0, 0, LADO_FOTO, LADO_FOTO);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  $('btn-foto').addEventListener('click', () => $('arquivo-foto').click());

  $('arquivo-foto').addEventListener('change', async (evento) => {
    const entrada = evento.target;
    const arquivo = entrada.files && entrada.files[0];
    entrada.value = ''; // permite escolher o mesmo arquivo de novo depois
    if (!arquivo) return;

    const msg = $('msg-foto');
    UI.ocultar(msg);
    if (!arquivo.type.startsWith('image/')) {
      UI.mostrar(msg, 'Escolha um arquivo de imagem (JPG ou PNG).');
      return;
    }
    if (arquivo.size > TAMANHO_MAX_ORIGINAL) {
      UI.mostrar(msg, 'Essa imagem é muito grande. Escolha uma de até 25 MB.');
      return;
    }

    const botao = $('btn-foto');
    UI.carregando(botao, true, 'Enviando…');
    try {
      let foto;
      try {
        foto = await prepararFoto(arquivo);
      } catch (erro) {
        UI.mostrar(msg, 'Não consegui abrir essa imagem. Tente uma foto em JPG ou PNG.');
        return;
      }
      const { perfil } = await API.put('api/perfil?parte=foto', { foto });
      Avatar.atualizar({ foto_v: perfil.foto_v, foto });
      $('btn-remover-foto').hidden = false;
      UI.mostrar(msg, 'Foto atualizada.', 'ok');
    } catch (erro) {
      UI.mostrar(msg, erro.message);
    } finally {
      UI.carregando(botao, false);
    }
  });

  $('btn-remover-foto').addEventListener('click', async () => {
    const msg = $('msg-foto');
    UI.ocultar(msg);
    const ok = await Dialogo.confirmar({
      titulo: 'Remover a foto?',
      texto: 'O círculo volta a mostrar a inicial do seu nome.',
      rotulo: 'Remover',
      perigo: true,
    });
    if (!ok) return;
    try {
      await API.excluir('api/perfil?parte=foto');
      Avatar.atualizar({ foto_v: null });
      $('btn-remover-foto').hidden = true;
      UI.mostrar(msg, 'Foto removida.', 'ok');
    } catch (erro) {
      UI.mostrar(msg, erro.message);
    }
  });

  // ---------- limpar registros ----------

  const dialogo = $('dlg-limpar');
  const confirmacao = $('limpar-confirmacao');
  const confirmar = $('btn-confirmar-limpar');
  const msgDialogo = $('msg-dlg-limpar');

  const digitouLimpar = () => confirmacao.value.trim().toLocaleUpperCase('pt-BR') === 'LIMPAR';
  confirmacao.addEventListener('input', () => { confirmar.disabled = !digitouLimpar(); });
  dialogo.querySelector('[data-fechar]').addEventListener('click', () => dialogo.close());

  $('btn-limpar').addEventListener('click', async () => {
    const msg = $('msg-limpar');
    const botao = $('btn-limpar');
    UI.ocultar(msg);
    UI.carregando(botao, true, 'Conferindo…');
    try {
      const c = await API.get('api/limpar');
      if (c.despesas === 0 && c.receitas === 0 && !c.limite) {
        await Dialogo.aviso({ titulo: 'Não há nada para limpar', texto: 'Você ainda não tem despesas, receitas nem limite mensal.' });
        return;
      }
      const partes = [plural(c.despesas, 'despesa', 'despesas'), plural(c.receitas, 'receita', 'receitas')];
      if (c.limite) partes.push('o limite mensal');
      $('limpar-texto').textContent =
        'Vamos apagar ' + partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1] + '. ' +
        'Seus tipos, cartões, perfil e login continuam. Não dá para desfazer.';
      confirmacao.value = '';
      confirmar.disabled = true;
      UI.ocultar(msgDialogo);
      dialogo.showModal();
      confirmacao.focus();
    } catch (erro) {
      UI.mostrar(msg, erro.message);
    } finally {
      UI.carregando(botao, false);
    }
  });

  $('form-limpar').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (!digitouLimpar()) return;
    UI.ocultar(msgDialogo);
    UI.carregando(confirmar, true, 'Apagando…');
    try {
      const { removidas } = await API.post('api/limpar', { confirmacao: confirmacao.value });
      dialogo.close();
      UI.mostrar(
        $('msg-limpar'),
        'Pronto! Apagamos ' + plural(removidas.despesas, 'despesa', 'despesas') + ' e ' +
          plural(removidas.receitas, 'receita', 'receitas') + (removidas.limite ? ' e o limite mensal' : '') + '.',
        'ok'
      );
    } catch (erro) {
      UI.mostrar(msgDialogo, erro.message);
    } finally {
      UI.carregando(confirmar, false);
      confirmar.disabled = !digitouLimpar();
    }
  });

  // ---------- começo ----------

  App.iniciar();
  carregar();
})();