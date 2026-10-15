'use strict';

/**
 * Backend do organize! em JavaScript (roda no navegador, sem servidor próprio).
 *
 * Faz o trabalho de "servidor": login, validação, contas (resumo, limite, painel)
 * e conversa com o Supabase. As telas continuam chamando API.get('api/despesas?...') etc.;
 * o api.js entrega a chamada para cá (Backend.tratar), que responde com o mesmo formato de antes.
 *
 * Segurança: quem protege os dados é o Supabase, não este arquivo. Cada pessoa só enxerga e altera
 * as próprias linhas (RLS no banco) e a chave usada aqui é a chave PÚBLICA (anon/publishable).
 * As validações abaixo existem para dar mensagens claras e manter os dados organizados.
 *
 * Seções: erros e valores · conexão com o Supabase · sessão e login · banco · contas (financas)
 *         · endpoints (auth, tipos, cartoes, despesas, receitas, limite, resumo, painel, perfil, foto, limpar)
 */
const Backend = (function () {
  // =====================================================================
  // Erros e leitura de valores
  // =====================================================================

  class Falha extends Error {
    constructor(mensagem, status = 400, detalhes = null) {
      super(mensagem);
      this.name = 'Falha';
      this.status = status;
      this.detalhes = detalhes; // corpo de erro do Postgres/Supabase, quando houver
    }
  }

  const erro = (mensagem, status = 400) => { throw new Falha(mensagem, status); };
  const ok = (dados = {}, status = 200) => ({ status, dados: Object.assign({ ok: true }, dados) });
  const codigoPg = (e) => (e && e.detalhes && typeof e.detalhes === 'object' ? String(e.detalhes.code || '') : '');

  const MESES_MAX = 60;
  const ESCOPOS = ['esta', 'proximas', 'todas'];
  const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const tamanho = (texto) => Array.from(texto).length; // conta letras (não bytes), como o mb_strlen

  function exigirMetodo(ctx, ...permitidos) {
    if (!permitidos.includes(ctx.metodo)) erro('Método não permitido.', 405);
  }

  /** Texto opcional do corpo, aparado e cortado em $max (nunca dá erro). */
  function campoTexto(dados, chave, max = 255) {
    const valor = dados[chave];
    return typeof valor === 'string' ? Array.from(valor.trim()).slice(0, max).join('') : '';
  }

  /** Texto obrigatório: erro 422 se vier vazio ou maior que $max. */
  function textoObrigatorio(dados, chave, max, msgVazio, msgLongo) {
    const valor = typeof dados[chave] === 'string' ? dados[chave].trim() : '';
    if (valor === '') erro(msgVazio, 422);
    if (tamanho(valor) > max) erro(msgLongo, 422);
    return valor;
  }

  /** ?id= da URL, confirmado como UUID (impede injetar filtros na consulta). */
  function uuidDaUrl(ctx, chave = 'id') {
    const valor = ctx.q.get(chave) || '';
    if (!RE_UUID.test(valor)) erro('Identificador inválido.', 422);
    return valor.toLowerCase();
  }

  function uuidValor(valor, mensagem) {
    if (typeof valor !== 'string' || !RE_UUID.test(valor)) erro(mensagem, 422);
    return valor.toLowerCase();
  }

  /** Valor em reais: número ou texto "187.40", no máximo 2 casas e maior que zero. Devolve "187.40". */
  function valorParam(valor) {
    const mensagem = 'Informe um valor maior que zero, com no máximo 2 casas decimais.';
    if (typeof valor === 'number') {
      if (!Number.isFinite(valor)) erro(mensagem, 422);
      valor = valor.toFixed(2);
    } else if (typeof valor !== 'string') {
      erro(mensagem, 422);
    }
    valor = valor.trim();
    if (!/^[0-9]{1,10}(\.[0-9]{1,2})?$/.test(valor) || parseFloat(valor) <= 0) erro(mensagem, 422);
    return parseFloat(valor).toFixed(2);
  }

  function dataParam(data, mensagem) {
    const m = typeof data === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(data) : null;
    if (!m) erro(mensagem, 422);
    const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const existe = new Date(Date.UTC(ano, mes - 1, dia));
    if (ano < 2000 || ano > 2100 || existe.getUTCFullYear() !== ano || existe.getUTCMonth() !== mes - 1 || existe.getUTCDate() !== dia) {
      erro(mensagem, 422);
    }
    return data;
  }

  /** Inteiro entre $min e $max (número inteiro ou texto só com dígitos). */
  function inteiroParam(valor, min, max, mensagem) {
    if (typeof valor === 'string' && /^[0-9]{1,3}$/.test(valor)) valor = Number(valor);
    if (!Number.isInteger(valor) || valor < min || valor > max) erro(mensagem, 422);
    return valor;
  }

  const dois = (n) => String(n).padStart(2, '0');

  /**
   * Soma meses a uma data AAAA-MM-DD sempre a partir da data original (31/01 + 1 mês = 28/02,
   * mas + 2 meses = 31/03). Se o dia não existir no mês, usa o último dia dele.
   */
  function somarMeses(data, meses) {
    const [ano, mes, dia] = data.split('-').map(Number);
    const indice = ano * 12 + (mes - 1) + meses;
    const anoFinal = Math.floor(indice / 12);
    const mesFinal = (indice % 12) + 1;
    const ultimoDia = new Date(Date.UTC(anoFinal, mesFinal, 0)).getUTCDate();
    return String(anoFinal).padStart(4, '0') + '-' + dois(mesFinal) + '-' + dois(Math.min(dia, ultimoDia));
  }

  function uuidV4() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    const b = window.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /** ?mes=AAAA-MM -> [primeiro dia do mês, primeiro dia do mês seguinte]. */
  function intervaloDoMes(ctx) {
    const mes = ctx.q.get('mes') || '';
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mes);
    if (!m || Number(m[1]) < 2000 || Number(m[1]) > 2100) erro('Mês inválido. Use o formato AAAA-MM.', 422);
    return [mes + '-01', somarMeses(mes + '-01', 1)];
  }

  // =====================================================================
  // Conexão com o Supabase
  // =====================================================================

  function configuracao() {
    const c = window.ORGANIZE_CONFIG || {};
    // aceita com ou sem "/" no fim e tira um "/rest/v1" ou "/auth/v1" colado sem querer
    const url = String(c.supabaseUrl || '').trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/i, '');
    const chave = String(c.supabaseAnonKey || '').trim();
    if (!url || !chave || /SEU-PROJETO|COLE-SUA|COLE_AQUI/i.test(url + chave)) {
      throw new Falha('Configuração do Supabase ausente. Preencha o arquivo js/config.js com a URL e a chave pública do seu projeto.', 500);
    }
    if (!/^https:\/\/[^\s/]+$/i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)) {
      throw new Falha('A URL do arquivo js/config.js está errada. Ela deve ser parecida com https://abcdefgh.supabase.co (a "Project URL" do Supabase).', 500);
    }
    if (/^sb_secret_/.test(chave) || chaveEhServiceRole(chave)) {
      throw new Falha('A chave do arquivo js/config.js é a chave SECRETA. Use só a chave pública (anon ou publishable).', 500);
    }
    return { url, chave };
  }

  // A chave service_role dá acesso total ao banco: o app se recusa a funcionar com ela.
  function chaveEhServiceRole(chave) {
    try {
      const corpo = chave.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(corpo)).role === 'service_role';
    } catch (e) {
      return false;
    }
  }

  async function pedir(metodo, caminho, { query, json, token, headers } = {}) {
    const cfg = configuracao();
    let url = cfg.url + caminho;
    if (query) {
      const parametros = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) parametros.append(k, String(v));
      const texto = parametros.toString();
      if (texto) url += '?' + texto;
    }

    // Chaves "publishable" não são JWT: nesse caso vão só no header apikey.
    const portador = token || (cfg.chave.startsWith('eyJ') ? cfg.chave : null);
    const cabecalhos = Object.assign({ apikey: cfg.chave, Accept: 'application/json' }, headers || {});
    if (portador) cabecalhos.Authorization = 'Bearer ' + portador;
    if (json !== undefined) cabecalhos['Content-Type'] = 'application/json';

    let resposta;
    try {
      resposta = await fetch(url, {
        method: metodo,
        headers: cabecalhos,
        body: json !== undefined ? JSON.stringify(json) : undefined,
      });
    } catch (e) {
      throw new Falha('Não foi possível conectar ao Supabase. Confira sua internet e tente de novo.', 502);
    }

    let texto;
    try {
      texto = await resposta.text();
    } catch (e) {
      throw new Falha('A conexão com o Supabase foi interrompida. Tente de novo.', 502);
    }
    let corpo = null;
    if (texto !== '') {
      try { corpo = JSON.parse(texto); } catch (e) { corpo = texto; }
    }
    return { status: resposta.status, corpo };
  }

  // =====================================================================
  // Sessão e login (Supabase Auth)
  // =====================================================================

  const CHAVE_SESSAO = 'organize.sessao';
  let sessaoEmMemoria = null; // reserva, caso o navegador não deixe guardar nada

  const agora = () => Math.floor(Date.now() / 1000);

  function lerSessao() {
    try {
      const texto = window.localStorage.getItem(CHAVE_SESSAO);
      if (texto) return JSON.parse(texto);
      if (window.localStorage.getItem(CHAVE_SESSAO) === null && sessaoEmMemoria === null) return null;
    } catch (e) { /* sem armazenamento: usa a memória */ }
    return sessaoEmMemoria;
  }

  function guardarSessao(sessao) {
    sessaoEmMemoria = sessao;
    try {
      if (sessao) window.localStorage.setItem(CHAVE_SESSAO, JSON.stringify(sessao));
      else window.localStorage.removeItem(CHAVE_SESSAO);
    } catch (e) { /* ok */ }
  }

  function sessaoDe(dados) {
    const u = dados.user || {};
    const meta = u.user_metadata || {};
    return {
      access_token: dados.access_token,
      refresh_token: dados.refresh_token,
      expires_at: agora() + (Number(dados.expires_in) || 3600),
      user: { id: u.id || null, email: u.email || null, nome: meta.nome != null ? meta.nome : null },
    };
  }

  function mensagemAuth(res) {
    const corpo = res.corpo && typeof res.corpo === 'object' ? res.corpo : {};
    const codigo = String(corpo.error_code || corpo.code || '');
    switch (codigo) {
      case 'invalid_credentials': return 'E-mail ou senha inválidos.';
      case 'user_already_exists':
      case 'email_exists': return 'Já existe uma conta com esse e-mail.';
      case 'weak_password': return 'Senha fraca. Use pelo menos 6 caracteres.';
      case 'email_not_confirmed': return 'Confirme seu e-mail antes de entrar.';
      case 'over_request_rate_limit':
      case 'over_email_send_rate_limit': return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
      case 'validation_failed':
      case 'email_address_invalid': return 'E-mail ou senha em formato inválido.';
      default: return 'Não foi possível concluir. Tente novamente.';
    }
  }

  const statusAuth = (res) => (res.status >= 400 && res.status < 500 ? res.status : 502);

  async function criarConta(nome, email, senha) {
    const res = await pedir('POST', '/auth/v1/signup', { json: { email, password: senha, data: { nome } } });
    if (res.status >= 400) throw new Falha(mensagemAuth(res), statusAuth(res));
    // Com "Confirm email" desligado, o Supabase já devolve a sessão.
    if (res.corpo && typeof res.corpo === 'object' && res.corpo.access_token) {
      guardarSessao(sessaoDe(res.corpo));
      return { logado: true, confirmar_email: false };
    }
    return { logado: false, confirmar_email: true };
  }

  async function entrarNaConta(email, senha) {
    const res = await pedir('POST', '/auth/v1/token', {
      query: { grant_type: 'password' },
      json: { email, password: senha },
    });
    if (res.status >= 400 || !res.corpo || !res.corpo.access_token) {
      throw new Falha(mensagemAuth(res), res.status === 400 ? 401 : statusAuth(res));
    }
    guardarSessao(sessaoDe(res.corpo));
  }

  // Várias chamadas ao mesmo tempo esperam UMA renovação (o token de renovação só vale uma vez).
  let renovacaoEmCurso = null;

  function renovarSessao() {
    if (renovacaoEmCurso) return renovacaoEmCurso;
    renovacaoEmCurso = (async () => {
      const atual = lerSessao();
      if (!atual || !atual.refresh_token) return false;
      const res = await pedir('POST', '/auth/v1/token', {
        query: { grant_type: 'refresh_token' },
        json: { refresh_token: atual.refresh_token },
      });
      if (res.status >= 400 || !res.corpo || !res.corpo.access_token) {
        guardarSessao(null);
        return false;
      }
      const nova = sessaoDe(res.corpo);
      const preenchido = Object.fromEntries(Object.entries(nova.user).filter(([, v]) => v !== null));
      nova.user = Object.assign({}, atual.user || {}, preenchido);
      guardarSessao(nova);
      return true;
    })().finally(() => { renovacaoEmCurso = null; });
    return renovacaoEmCurso;
  }

  /** Usuário logado (renova o token se estiver perto de expirar) ou null. */
  async function usuarioAtual() {
    const sessao = lerSessao();
    if (!sessao) return null;
    if ((sessao.expires_at || 0) - agora() < 60 && !(await renovarSessao())) return null;
    const depois = lerSessao();
    return depois ? depois.user : null;
  }

  async function exigirLogin() {
    const usuario = await usuarioAtual();
    if (!usuario) erro('Sessão expirada. Faça login novamente.', 401);
    return usuario;
  }

  async function sairDaConta() {
    const sessao = lerSessao();
    if (sessao && sessao.access_token) {
      try {
        // scope=local encerra só esta sessão, não as de outros dispositivos
        await pedir('POST', '/auth/v1/logout', { token: sessao.access_token, query: { scope: 'local' } });
      } catch (e) { /* mesmo que falhe, a sessão deste navegador é apagada abaixo */ }
    }
    guardarSessao(null);
  }

  // =====================================================================
  // Banco de dados (PostgREST) - sempre com o token do usuário logado
  // =====================================================================

  function mensagemBanco(corpo) {
    switch (String((corpo && corpo.code) || '')) {
      case '23503': return 'Este registro está em uso por outros dados e não pode ser alterado ou excluído.';
      case '23505': return 'Já existe um registro com esses dados.';
      case '23514': return 'Dados inválidos. Revise os campos informados.';
      case '23502': return 'Preencha todos os campos obrigatórios.';
      case '22P02': return 'Valor em formato inválido.';
      case '42501': return 'Sem permissão para esta operação.';
      default: return 'Erro ao acessar o banco de dados.';
    }
  }

  /**
   * db('GET', 'despesas', { query: { select: '*', order: 'data_despesa.desc' } })
   * db('POST', 'cartoes', { json: { nome: 'Nubank', ultimos_4_digitos: '1234' } })
   * Escritas devolvem as linhas afetadas (assim dá para saber se algo foi criado, alterado ou excluído).
   */
  async function db(metodo, tabela, { query, json, headers } = {}) {
    if (!(await usuarioAtual())) throw new Falha('Sessão expirada. Faça login novamente.', 401);

    const cabecalhos = Object.assign({}, headers || {});
    const temPrefer = Object.keys(cabecalhos).some((k) => k.toLowerCase() === 'prefer');
    if (!temPrefer && ['POST', 'PATCH', 'DELETE'].includes(metodo)) cabecalhos.Prefer = 'return=representation';

    let res = null;
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const sessao = lerSessao();
      if (!sessao) throw new Falha('Sessão expirada. Faça login novamente.', 401);
      res = await pedir(metodo, '/rest/v1/' + tabela, { query, json, token: sessao.access_token, headers: cabecalhos });
      if (res.status === 401 && tentativa === 0 && (await renovarSessao())) continue;
      break;
    }

    if (res.status === 401) throw new Falha('Sessão expirada. Faça login novamente.', 401);
    if (res.status >= 400) {
      throw new Falha(mensagemBanco(res.corpo), res.status < 500 ? res.status : 502, res.corpo);
    }
    return res.corpo;
  }

  // =====================================================================
  // Contas do resumo do mês e do painel (tudo em CENTAVOS, inteiros)
  // =====================================================================

  const LIMITE_ALERTA_PERCENTUAL = 80; // a partir daqui o app avisa que o limite está perto

  const emCentavos = (valor) => Math.round(parseFloat(valor) * 100);

  /** 123456 -> "1234.56" */
  function emReais(centavos) {
    const sinal = centavos < 0 ? '-' : '';
    const abs = Math.abs(centavos);
    return sinal + Math.trunc(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
  }

  /** Primeiro dia (AAAA-MM-DD) do mês $mes (AAAA-MM) deslocado em $delta meses. */
  function primeiroDiaDoMes(mes, delta = 0) {
    return somarMeses(mes + '-01', delta);
  }

  /** Todas as linhas de $tabela cuja $colunaData está em [$inicio, $fim), em páginas de 1000 (limite do Supabase). */
  async function linhasDoPeriodo(tabela, colunaData, colunas, inicio, fim) {
    let todas = [];
    const pagina = 1000;
    for (let deslocamento = 0; deslocamento < 20000; deslocamento += pagina) {
      const lote = await db('GET', tabela, {
        query: {
          select: colunas,
          and: '(' + colunaData + '.gte.' + inicio + ',' + colunaData + '.lt.' + fim + ')',
          order: colunaData + '.asc,id.asc',
          limit: pagina,
          offset: deslocamento,
        },
      });
      todas = todas.concat(lote);
      if (lote.length < pagina) break;
    }
    return todas;
  }

  /**
   * Configuração do limite: { valor: centavos|null, percentual: 1..100|null }. Só um dos dois vem preenchido.
   * Banco ainda sem a etapa 7 (sem a coluna limite_percentual): lê só o valor em reais, e o app segue funcionando.
   */
  async function lerConfiguracao() {
    let linhas;
    try {
      linhas = await db('GET', 'configuracoes', { query: { select: 'limite_mensal,limite_percentual' } });
    } catch (e) {
      if (!['42703', 'PGRST204'].includes(codigoPg(e))) throw e;
      linhas = await db('GET', 'configuracoes', { query: { select: 'limite_mensal' } });
    }
    const linha = linhas[0] || {};
    const semValor = linha.limite_mensal === null || linha.limite_mensal === undefined;
    const semPercentual = linha.limite_percentual === null || linha.limite_percentual === undefined;
    return {
      valor: semValor ? null : emCentavos(linha.limite_mensal),
      percentual: semPercentual ? null : Number(linha.limite_percentual),
    };
  }

  const temLimite = (config) => config.valor !== null || config.percentual !== null;

  /** Limite em centavos para um mês: o valor fixo, ou a porcentagem das receitas do mês (previstas). */
  function limiteDoMes(config, rendaCentavos) {
    if (config.percentual !== null) return Math.floor((rendaCentavos * config.percentual) / 100);
    return config.valor;
  }

  /** nivel: "ok" (abaixo de 80%), "perto" (de 80% até o limite) ou "estourou" (passou do limite). */
  function situacaoDoLimite(limite, usado) {
    if (limite === null || limite <= 0) return null;
    let nivel = 'ok';
    if (usado > limite) nivel = 'estourou';
    else if (usado * 100 >= limite * LIMITE_ALERTA_PERCENTUAL) nivel = 'perto';
    return {
      limite: emReais(limite),
      usado: emReais(usado),
      restante: emReais(limite - usado), // negativo quando passou
      percentual: Math.floor((usado * 100) / limite),
      nivel,
    };
  }

  /** Soma de $linhas por status: [total, do status "feito" (pago/recebida), do outro]. */
  function somarPorStatus(linhas, statusFeito) {
    let feito = 0;
    let aberto = 0;
    for (const linha of linhas) {
      if (linha.status === statusFeito) feito += emCentavos(linha.valor);
      else aberto += emCentavos(linha.valor);
    }
    return [feito + aberto, feito, aberto];
  }

  const doMes = (linhas, campo, mes) => linhas.filter((l) => String(l[campo]).startsWith(mes + '-'));

  function limiteMontado(config, recTotal, despTotal) {
    if (!temLimite(config)) return null;
    const situacao = situacaoDoLimite(limiteDoMes(config, recTotal), despTotal);
    if (situacao === null) return null;
    if (config.percentual === null) return Object.assign(situacao, { modo: 'valor', definido: null, renda: null });
    return Object.assign(situacao, { modo: 'percentual', definido: config.percentual, renda: emReais(recTotal) });
  }

  function montarResumo(mes, despesasDoMes, receitasDoMes, config) {
    const [despTotal, despPago, despPendente] = somarPorStatus(despesasDoMes, 'pago');
    const [recTotal, recRecebido, recAReceber] = somarPorStatus(receitasDoMes, 'recebida');
    return {
      mes,
      receitas: { total: emReais(recTotal), recebido: emReais(recRecebido), a_receber: emReais(recAReceber) },
      despesas: { total: emReais(despTotal), pago: emReais(despPago), pendente: emReais(despPendente) },
      saldo: {
        previsto: emReais(recTotal - despTotal), // tudo que entra - tudo que sai no mês
        atual: emReais(recRecebido - despPago), // só o que já aconteceu
      },
      // o limite olha o total de despesas do mês; em porcentagem, calcula sobre as receitas previstas do mês
      limite: limiteMontado(config, recTotal, despTotal),
      // o que o usuário escolheu (mesmo que ainda não dê para calcular, por falta de receitas no mês)
      limite_config: !temLimite(config) ? null : config.percentual !== null
        ? { modo: 'percentual', percentual: config.percentual, valor: null }
        : { modo: 'valor', percentual: null, valor: emReais(config.valor) },
    };
  }

  /** Totais por tipo (do maior para o menor), com o nome do tipo e a participação no total. */
  function totaisPorTipo(linhas, campoTipo, tipos) {
    const nomes = new Map(tipos.map((t) => [t.id, t.nome]));
    const somas = new Map();
    let geral = 0;
    for (const linha of linhas) {
      const id = String(linha[campoTipo]);
      const centavos = emCentavos(linha.valor);
      somas.set(id, (somas.get(id) || 0) + centavos);
      geral += centavos;
    }
    return Array.from(somas.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, total]) => ({
        tipo_id: id,
        nome: nomes.get(id) || 'Sem tipo',
        total: emReais(total),
        percentual: geral > 0 ? Math.round((total * 1000) / geral) / 10 : 0,
      }));
  }

  function erroSemEtapa5(e) {
    if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(codigoPg(e))) {
      erro('O banco de dados precisa da atualização da etapa 5. Rode o script migracao_etapa5.sql no Supabase.', 500);
    }
  }

  function erroSemEtapa6(e) {
    if (['42703', 'PGRST204', 'PGRST205', '42P01'].includes(codigoPg(e))) {
      erro('O banco de dados precisa da atualização da etapa 6. Rode o script migracao_etapa6.sql no Supabase.', 500);
    }
  }

  // =====================================================================
  // Endpoint: auth (login, cadastro, sair, quem sou eu)
  // =====================================================================

  const SENHA_MIN = 8;
  const SENHA_MAX = 72; // limite do bcrypt, usado pelo Supabase
  const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /** Só devolve às telas o que elas precisam (nunca tokens nem id). */
  function usuarioPublico(usuario) {
    const email = String((usuario && usuario.email) || '');
    let nome = String((usuario && usuario.nome) || '').trim();
    if (nome === '') nome = email.split('@')[0];
    return { nome, email };
  }

  const campoSenha = (dados) => (typeof dados.senha === 'string' ? dados.senha : '');

  async function auth(ctx) {
    const acao = ctx.q.get('acao') || '';

    if (acao === 'me') {
      exigirMetodo(ctx, 'GET');
      const usuario = await usuarioAtual();
      if (!usuario) {
        // Login e cadastro só perguntam "já existe sessão?": responde 200 para não gerar erro no console.
        if (ctx.q.get('opcional') === '1') return ok({ usuario: null });
        erro('Sessão expirada. Faça login novamente.', 401);
      }
      const publico = usuarioPublico(usuario);
      try {
        // nome e foto mais recentes vêm do perfil (se a etapa 6 ainda não foi aplicada, vale o da sessão)
        const perfil = perfilPublico(await perfilLinha(usuario), usuario);
        publico.nome = perfil.nome;
        publico.foto_v = perfil.foto_v;
      } catch (e) {
        if (!(e instanceof Falha) || e.status === 401) throw e;
        publico.foto_v = null;
      }
      return ok({ usuario: publico });
    }

    if (acao === 'cadastrar') {
      exigirMetodo(ctx, 'POST');
      const nome = campoTexto(ctx.corpo, 'nome', 80);
      const email = campoTexto(ctx.corpo, 'email', 254).toLowerCase();
      const senha = campoSenha(ctx.corpo);

      if (nome === '') erro('Informe seu nome.', 422);
      if (!RE_EMAIL.test(email)) erro('Informe um e-mail válido.', 422);
      if (tamanho(senha) < SENHA_MIN) erro('A senha deve ter pelo menos ' + SENHA_MIN + ' caracteres.', 422);
      if (new TextEncoder().encode(senha).length > SENHA_MAX) erro('A senha deve ter no máximo ' + SENHA_MAX + ' caracteres.', 422);

      const resultado = await criarConta(nome, email, senha);
      const resposta = Object.assign({}, resultado);
      if (resultado.logado) resposta.usuario = usuarioPublico((lerSessao() || {}).user);
      return ok(resposta, 201);
    }

    if (acao === 'entrar') {
      exigirMetodo(ctx, 'POST');
      const email = campoTexto(ctx.corpo, 'email', 254).toLowerCase();
      const senha = campoSenha(ctx.corpo);
      if (email === '' || senha === '') erro('Informe seu e-mail e sua senha.', 422);
      await entrarNaConta(email, senha);
      return ok({ usuario: usuarioPublico((lerSessao() || {}).user) });
    }

    if (acao === 'sair') {
      exigirMetodo(ctx, 'POST');
      await sairDaConta();
      return ok();
    }

    return erro('Ação inválida.', 404);
  }

  // =====================================================================
  // Endpoint: tipos (de despesa e de receita)
  // =====================================================================

  const TIPO_NOME_MAX = 60;
  // [nome, é conta com vencimento?]
  const SUGERIDOS = [
    ['Alimentação', false], ['Moradia', false], ['Transporte', false], ['Saúde', false],
    ['Lazer', false], ['Educação', false], ['Outros', false],
    ['Aluguel', true], ['Água', true], ['Luz', true], ['Internet', true], ['Condomínio', true],
  ];
  const SUGERIDOS_RECEITA = ['Salário', 'Freelance', 'Investimentos', 'Reembolso', 'Outros'];

  /** Campo so_vencimento do corpo: ausente -> null (não mexe); precisa ser verdadeiro/falso. */
  function soVencimentoDoCorpo(corpo) {
    if (!Object.prototype.hasOwnProperty.call(corpo, 'so_vencimento')) return null;
    if (typeof corpo.so_vencimento !== 'boolean') erro('Valor inválido para "conta com vencimento".', 422);
    return corpo.so_vencimento;
  }

  async function tipos(ctx) {
    await exigirLogin();
    exigirMetodo(ctx, 'GET', 'POST', 'PUT', 'DELETE');

    const receita = ctx.q.get('de') === 'receita';
    const tabela = receita ? 'tipos_receita' : 'tipos_despesa';
    const colunas = receita ? 'id,nome' : 'id,nome,so_vencimento';
    const nomeDoTipo = () => textoObrigatorio(
      ctx.corpo, 'nome', TIPO_NOME_MAX,
      'Informe o nome do tipo.',
      'O nome do tipo deve ter no máximo ' + TIPO_NOME_MAX + ' caracteres.'
    );

    try {
      if (ctx.metodo === 'GET') {
        return ok({ tipos: await db('GET', tabela, { query: { select: colunas, order: 'nome.asc' } }) });
      }

      if (ctx.metodo === 'POST' && ctx.q.get('acao') === 'sugeridos') {
        const linhas = receita
          ? SUGERIDOS_RECEITA.map((nome) => ({ nome }))
          : SUGERIDOS.map(([nome, so]) => ({ nome, so_vencimento: so }));
        const criados = await db('POST', tabela, {
          query: { on_conflict: 'user_id,nome', select: colunas },
          json: linhas,
          headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
        });
        return ok({ criados: criados.length }, 201);
      }

      if (ctx.metodo === 'POST') {
        const nome = nomeDoTipo();
        const json = receita ? { nome } : { nome, so_vencimento: soVencimentoDoCorpo(ctx.corpo) ?? false };
        const linhas = await db('POST', tabela, { query: { select: colunas }, json });
        return ok({ tipo: linhas[0] }, 201);
      }

      if (ctx.metodo === 'PUT') {
        const id = uuidDaUrl(ctx);
        const alteracoes = { nome: nomeDoTipo() };
        const contaComVencimento = receita ? null : soVencimentoDoCorpo(ctx.corpo);
        if (contaComVencimento !== null) alteracoes.so_vencimento = contaComVencimento;
        const linhas = await db('PATCH', tabela, { query: { id: 'eq.' + id, select: colunas }, json: alteracoes });
        if (!linhas.length) erro('Tipo não encontrado.', 404);
        return ok({ tipo: linhas[0] });
      }

      // DELETE
      const id = uuidDaUrl(ctx);
      const linhas = await db('DELETE', tabela, { query: { id: 'eq.' + id, select: 'id' } });
      if (!linhas.length) erro('Tipo não encontrado.', 404);
      return ok();
    } catch (e) {
      const codigo = codigoPg(e);
      if (codigo === '23505') erro('Já existe um tipo com esse nome.', 409);
      if (codigo === '23503') {
        erro('Este tipo está em uso por ' + (receita ? 'receitas' : 'despesas') + ' e não pode ser excluído.', 409);
      }
      // banco ainda sem a coluna nova (migração não rodada)
      if (codigo === '42703' || codigo === 'PGRST204') {
        erro('O banco de dados precisa da atualização. Rode o script ' + (receita ? 'migracao_etapa5.sql' : 'migracao_etapa4b.sql') + ' no Supabase.', 500);
      }
      throw e;
    }
  }

  // =====================================================================
  // Endpoint: cartoes (somente nome e 4 últimos dígitos)
  // =====================================================================

  const CARTAO_NOME_MAX = 40;
  const COLUNAS_CARTAO = 'id,nome,ultimos_4_digitos';

  function dadosDoCartao(corpo) {
    const nome = textoObrigatorio(
      corpo, 'nome', CARTAO_NOME_MAX,
      'Informe o nome do cartão.',
      'O nome do cartão deve ter no máximo ' + CARTAO_NOME_MAX + ' caracteres.'
    );
    const final = typeof corpo.ultimos_4_digitos === 'string' ? corpo.ultimos_4_digitos.trim() : '';
    if (!/^[0-9]{4}$/.test(final)) erro('Informe somente os 4 últimos dígitos do cartão (apenas números).', 422);
    return { nome, ultimos_4_digitos: final };
  }

  async function cartoes(ctx) {
    await exigirLogin();
    exigirMetodo(ctx, 'GET', 'POST', 'PUT', 'DELETE');

    try {
      if (ctx.metodo === 'GET') {
        return ok({ cartoes: await db('GET', 'cartoes', { query: { select: COLUNAS_CARTAO, order: 'nome.asc' } }) });
      }
      if (ctx.metodo === 'POST') {
        const linhas = await db('POST', 'cartoes', { query: { select: COLUNAS_CARTAO }, json: dadosDoCartao(ctx.corpo) });
        return ok({ cartao: linhas[0] }, 201);
      }
      if (ctx.metodo === 'PUT') {
        const id = uuidDaUrl(ctx);
        const linhas = await db('PATCH', 'cartoes', { query: { id: 'eq.' + id, select: COLUNAS_CARTAO }, json: dadosDoCartao(ctx.corpo) });
        if (!linhas.length) erro('Cartão não encontrado.', 404);
        return ok({ cartao: linhas[0] });
      }
      // DELETE
      const id = uuidDaUrl(ctx);
      const linhas = await db('DELETE', 'cartoes', { query: { id: 'eq.' + id, select: 'id' } });
      if (!linhas.length) erro('Cartão não encontrado.', 404);
      return ok();
    } catch (e) {
      if (codigoPg(e) === '23503') erro('Este cartão está em uso por despesas e não pode ser excluído.', 409);
      throw e;
    }
  }

  // =====================================================================
  // Endpoint: despesas (lançamentos)
  // =====================================================================

  const DESCRICAO_MAX = 100;
  const PARCELAS_MAX = 24;
  const COLUNAS_DESPESA = 'id,descricao,valor,data_despesa,data_vencimento,tipo_id,forma_pagamento,cartao_id,status,'
    + 'serie_id,serie_tipo,serie_numero,serie_total';
  const FORMAS = ['credito', 'debito', 'pix'];
  const STATUS_DESPESA = ['pago', 'pendente'];

  function statusDespesa(valor) {
    if (typeof valor !== 'string' || !STATUS_DESPESA.includes(valor)) erro('Informe se a despesa está paga ou pendente.', 422);
    return valor;
  }

  /** Divide o total em parcelas iguais (em centavos); a última absorve a diferença. */
  function dividirEmParcelas(total, quantidade) {
    const centavos = Math.round(parseFloat(total) * 100);
    const base = Math.floor(centavos / quantidade);
    if (base < 1) erro('O valor é pequeno demais para dividir em ' + quantidade + ' parcelas.', 422);
    const parcelas = new Array(quantidade).fill(base);
    parcelas[quantidade - 1] = centavos - base * (quantidade - 1);
    return parcelas.map((c) => (c / 100).toFixed(2));
  }

  /** O tipo é uma "conta com vencimento" (aluguel, água, luz...)? Tipo inexistente conta como não. */
  async function tipoSoVencimento(tipoId) {
    const linhas = await db('GET', 'tipos_despesa', { query: { id: 'eq.' + tipoId, select: 'so_vencimento' } });
    return Boolean(linhas[0] && linhas[0].so_vencimento);
  }

  /** Valida os campos de UM lançamento e devolve as colunas prontas para gravar. */
  async function validarDespesa(dados) {
    const descricao = textoObrigatorio(
      dados, 'descricao', DESCRICAO_MAX,
      'Informe a descrição da despesa.',
      'A descrição deve ter no máximo ' + DESCRICAO_MAX + ' caracteres.'
    );

    const forma = dados.forma_pagamento;
    if (typeof forma !== 'string' || !FORMAS.includes(forma)) erro('Escolha a forma de pagamento: crédito, débito ou pix.', 422);

    let cartao = null;
    if (forma === 'credito') cartao = uuidValor(dados.cartao_id, 'Escolha o cartão usado no crédito.');

    const valor = valorParam(dados.valor);
    const tipoId = uuidValor(dados.tipo_id, 'Escolha o tipo da despesa.');
    const vencimento = dataParam(dados.data_vencimento, 'Informe uma data de vencimento válida.');
    // conta com vencimento (aluguel, água, luz): não tem data da compra, usa o vencimento
    const compra = (await tipoSoVencimento(tipoId))
      ? vencimento
      : dataParam(dados.data_despesa, 'Informe uma data de compra válida.');

    return {
      descricao,
      valor,
      data_despesa: compra,
      data_vencimento: vencimento,
      tipo_id: tipoId,
      forma_pagamento: forma,
      cartao_id: cartao, // débito e pix nunca levam cartão
      status: statusDespesa(dados.status),
    };
  }

  /** Transforma o pedido de criação em uma ou mais linhas para o banco. */
  async function linhasParaCriarDespesa(dados) {
    const base = await validarDespesa(dados);

    const repeticao = dados.repeticao === undefined ? 'unica' : dados.repeticao;
    if (typeof repeticao !== 'string' || !['unica', 'parcelada', 'mensal'].includes(repeticao)) {
      erro('Repetição inválida. Use única, parcelada ou mensal.', 422);
    }
    if (repeticao === 'unica') return [base];

    let quantidade;
    let valores;
    if (repeticao === 'parcelada') {
      if (base.forma_pagamento !== 'credito') erro('Só é possível parcelar compras no crédito.', 422);
      quantidade = inteiroParam(dados.parcelas, 2, PARCELAS_MAX, 'Informe o número de parcelas, de 2 a ' + PARCELAS_MAX + '.');
      valores = dividirEmParcelas(base.valor, quantidade);
    } else {
      quantidade = inteiroParam(dados.meses, 2, MESES_MAX, 'Informe por quantos meses repetir, de 2 a ' + MESES_MAX + '.');
      valores = new Array(quantidade).fill(base.valor);
    }

    const serie = uuidV4();
    const linhas = [];
    for (let i = 0; i < quantidade; i++) {
      const linha = Object.assign({}, base);
      linha.valor = valores[i];
      linha.data_vencimento = somarMeses(base.data_vencimento, i);
      if (repeticao === 'mensal') linha.data_despesa = somarMeses(base.data_despesa, i);
      linha.status = i === 0 ? base.status : 'pendente';
      linha.serie_id = serie;
      linha.serie_tipo = repeticao;
      linha.serie_numero = i + 1;
      linha.serie_total = quantidade;
      linhas.push(linha);
    }
    return linhas;
  }

  /** Exclui conforme o escopo (despesas ou receitas); devolve quantos lançamentos foram removidos. */
  async function excluirLancamento(tabela, rotulo, id, escopo) {
    let filtro = { id: 'eq.' + id };

    if (escopo !== 'esta') {
      const atual = await db('GET', tabela, { query: { id: 'eq.' + id, select: 'serie_id,serie_numero' } });
      if (!atual.length) erro(rotulo + ' não encontrada.', 404);
      const serie = atual[0].serie_id;
      if (typeof serie === 'string' && RE_UUID.test(serie)) {
        filtro = { serie_id: 'eq.' + serie.toLowerCase() };
        if (escopo === 'proximas') filtro.serie_numero = 'gte.' + (parseInt(atual[0].serie_numero, 10) || 0);
      }
      // sem série, "próximas" e "todas" equivalem a "esta"
    }

    const linhas = await db('DELETE', tabela, { query: Object.assign({}, filtro, { select: 'id' }) });
    if (!linhas.length) erro(rotulo + ' não encontrada.', 404);
    return linhas.length;
  }

  function escopoDaUrl(ctx) {
    const escopo = ctx.q.get('escopo') === null ? 'esta' : ctx.q.get('escopo');
    if (!ESCOPOS.includes(escopo)) erro('Escopo inválido. Use esta, proximas ou todas.', 422);
    return escopo;
  }

  async function despesas(ctx) {
    await exigirLogin();
    exigirMetodo(ctx, 'GET', 'POST', 'PUT', 'PATCH', 'DELETE');

    try {
      if (ctx.metodo === 'GET') {
        const [inicio, fim] = intervaloDoMes(ctx);
        const lista = await db('GET', 'despesas', {
          query: {
            select: COLUNAS_DESPESA,
            and: '(data_vencimento.gte.' + inicio + ',data_vencimento.lt.' + fim + ')',
            order: 'data_vencimento.desc,criado_em.desc,serie_numero.asc',
          },
        });
        return ok({ despesas: lista });
      }

      if (ctx.metodo === 'POST') {
        const linhas = await db('POST', 'despesas', {
          query: { select: COLUNAS_DESPESA },
          json: await linhasParaCriarDespesa(ctx.corpo),
        });
        return ok({ despesa: linhas[0], criadas: linhas.length }, 201);
      }

      if (ctx.metodo === 'PUT' || ctx.metodo === 'PATCH') {
        const id = uuidDaUrl(ctx);
        const alteracoes = ctx.metodo === 'PUT'
          ? await validarDespesa(ctx.corpo) // só este lançamento; a série não muda
          : { status: statusDespesa(ctx.corpo.status) };
        const linhas = await db('PATCH', 'despesas', { query: { id: 'eq.' + id, select: COLUNAS_DESPESA }, json: alteracoes });
        if (!linhas.length) erro('Despesa não encontrada.', 404);
        return ok({ despesa: linhas[0] });
      }

      // DELETE
      const id = uuidDaUrl(ctx);
      const escopo = escopoDaUrl(ctx);
      return ok({ removidas: await excluirLancamento('despesas', 'Despesa', id, escopo) });
    } catch (e) {
      const codigo = codigoPg(e);
      // tipo ou cartão que não existem (ou não são do usuário) violam a chave estrangeira
      if (codigo === '23503' && ctx.metodo !== 'DELETE') {
        erro('O tipo ou o cartão escolhido não foi encontrado. Atualize a página e tente de novo.', 422);
      }
      // trocar uma parcela para débito/pix
      if (codigo === '23514' && e.detalhes && String(e.detalhes.message || '').includes('despesas_parcelada_so_no_credito')) {
        erro('Uma parcela de compra parcelada só pode ser no crédito.', 422);
      }
      // banco ainda sem as colunas novas (migração não rodada)
      if (codigo === '42703' || codigo === 'PGRST204') {
        erro('O banco de dados precisa da atualização da etapa 4. Rode os scripts migracao_etapa4.sql e migracao_etapa4b.sql no Supabase.', 500);
      }
      throw e;
    }
  }

  // =====================================================================
  // Endpoint: receitas (dinheiro que entra)
  // =====================================================================

  const COLUNAS_RECEITA = 'id,descricao,valor,data_recebimento,tipo_receita_id,status,serie_id,serie_tipo,serie_numero,serie_total';
  const STATUS_RECEITA = ['recebida', 'a_receber'];

  function statusReceita(valor) {
    if (typeof valor !== 'string' || !STATUS_RECEITA.includes(valor)) {
      erro('Informe se a receita foi recebida ou ainda está a receber.', 422);
    }
    return valor;
  }

  function validarReceita(dados) {
    return {
      descricao: textoObrigatorio(
        dados, 'descricao', DESCRICAO_MAX,
        'Informe a descrição da receita.',
        'A descrição deve ter no máximo ' + DESCRICAO_MAX + ' caracteres.'
      ),
      valor: valorParam(dados.valor),
      data_recebimento: dataParam(dados.data_recebimento, 'Informe uma data de recebimento válida.'),
      tipo_receita_id: uuidValor(dados.tipo_receita_id, 'Escolha o tipo da receita.'),
      status: statusReceita(dados.status),
    };
  }

  function linhasParaCriarReceita(dados) {
    const base = validarReceita(dados);

    const repeticao = dados.repeticao === undefined ? 'unica' : dados.repeticao;
    if (typeof repeticao !== 'string' || !['unica', 'mensal'].includes(repeticao)) {
      erro('Repetição inválida. Use única ou mensal.', 422);
    }
    if (repeticao === 'unica') return [base];

    const quantidade = inteiroParam(dados.meses, 2, MESES_MAX, 'Informe por quantos meses repetir, de 2 a ' + MESES_MAX + '.');
    const serie = uuidV4();
    const linhas = [];
    for (let i = 0; i < quantidade; i++) {
      const linha = Object.assign({}, base);
      linha.data_recebimento = somarMeses(base.data_recebimento, i);
      linha.status = i === 0 ? base.status : 'a_receber';
      linha.serie_id = serie;
      linha.serie_tipo = 'mensal';
      linha.serie_numero = i + 1;
      linha.serie_total = quantidade;
      linhas.push(linha);
    }
    return linhas;
  }

  async function receitas(ctx) {
    await exigirLogin();
    exigirMetodo(ctx, 'GET', 'POST', 'PUT', 'PATCH', 'DELETE');

    try {
      if (ctx.metodo === 'GET') {
        const [inicio, fim] = intervaloDoMes(ctx);
        const lista = await db('GET', 'receitas', {
          query: {
            select: COLUNAS_RECEITA,
            and: '(data_recebimento.gte.' + inicio + ',data_recebimento.lt.' + fim + ')',
            order: 'data_recebimento.desc,criado_em.desc,serie_numero.asc',
          },
        });
        return ok({ receitas: lista });
      }

      if (ctx.metodo === 'POST') {
        const linhas = await db('POST', 'receitas', {
          query: { select: COLUNAS_RECEITA },
          json: linhasParaCriarReceita(ctx.corpo),
        });
        return ok({ receita: linhas[0], criadas: linhas.length }, 201);
      }

      if (ctx.metodo === 'PUT' || ctx.metodo === 'PATCH') {
        const id = uuidDaUrl(ctx);
        const alteracoes = ctx.metodo === 'PUT'
          ? validarReceita(ctx.corpo) // só este lançamento; a série não muda
          : { status: statusReceita(ctx.corpo.status) };
        const linhas = await db('PATCH', 'receitas', { query: { id: 'eq.' + id, select: COLUNAS_RECEITA }, json: alteracoes });
        if (!linhas.length) erro('Receita não encontrada.', 404);
        return ok({ receita: linhas[0] });
      }

      // DELETE
      const id = uuidDaUrl(ctx);
      const escopo = escopoDaUrl(ctx);
      return ok({ removidas: await excluirLancamento('receitas', 'Receita', id, escopo) });
    } catch (e) {
      const codigo = codigoPg(e);
      // tipo que não existe (ou não é do usuário) viola a chave estrangeira
      if (codigo === '23503' && ctx.metodo !== 'DELETE') {
        erro('O tipo escolhido não foi encontrado. Atualize a página e tente de novo.', 422);
      }
      erroSemEtapa5(e);
      throw e;
    }
  }

  // =====================================================================
  // Endpoint: limite mensal de gastos
  // =====================================================================

  function erroSemEtapa7(e) {
    if (['42703', 'PGRST204'].includes(codigoPg(e))) {
      erro('O banco de dados precisa da atualização da etapa 7. Rode o script migracao_etapa7.sql no Supabase.', 500);
    }
  }

  /** Resposta do endpoint: modo "valor" ou "percentual" (ou null se não há limite). */
  function respostaDoLimite(config) {
    const modo = config.percentual !== null ? 'percentual' : config.valor !== null ? 'valor' : null;
    return ok({
      modo,
      limite: config.valor === null ? null : emReais(config.valor),
      percentual: config.percentual,
    });
  }

  async function limite(ctx) {
    const usuario = await exigirLogin();
    exigirMetodo(ctx, 'GET', 'PUT', 'DELETE');

    try {
      if (ctx.metodo === 'PUT') {
        const temValor = ctx.corpo.limite !== undefined && ctx.corpo.limite !== null;
        const temPercentual = ctx.corpo.percentual !== undefined && ctx.corpo.percentual !== null;
        if (temValor === temPercentual) erro('Informe o limite em reais ou em porcentagem (só um dos dois).', 422);

        const json = { user_id: usuario.id, limite_mensal: null, limite_percentual: null, atualizado_em: new Date().toISOString() };
        if (temValor) json.limite_mensal = valorParam(ctx.corpo.limite);
        else json.limite_percentual = inteiroParam(ctx.corpo.percentual, 1, 100, 'Informe uma porcentagem de 1 a 100.');

        const linhas = await db('POST', 'configuracoes', {
          query: { on_conflict: 'user_id', select: 'limite_mensal,limite_percentual' },
          json,
          headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
        });
        return respostaDoLimite({
          valor: linhas[0].limite_mensal === null ? null : emCentavos(linhas[0].limite_mensal),
          percentual: linhas[0].limite_percentual === null ? null : Number(linhas[0].limite_percentual),
        });
      }

      if (ctx.metodo === 'DELETE') {
        await db('DELETE', 'configuracoes', { query: { user_id: 'eq.' + usuario.id, select: 'user_id' } });
        return respostaDoLimite({ valor: null, percentual: null });
      }

      return respostaDoLimite(await lerConfiguracao());
    } catch (e) {
      erroSemEtapa7(e);
      erroSemEtapa5(e);
      throw e;
    }
  }

  // =====================================================================
  // Endpoints: resumo do mês e painel
  // =====================================================================

  async function resumo(ctx) {
    await exigirLogin();
    exigirMetodo(ctx, 'GET');

    const [inicio, fim] = intervaloDoMes(ctx);
    const mes = inicio.slice(0, 7);
    try {
      // As três consultas são independentes: saem juntas (1 ida e volta, não 3).
      const [listaDespesas, listaReceitas, config] = await Promise.all([
        linhasDoPeriodo('despesas', 'data_vencimento', 'valor,status,data_vencimento', inicio, fim),
        linhasDoPeriodo('receitas', 'data_recebimento', 'valor,status,data_recebimento', inicio, fim),
        lerConfiguracao(),
      ]);
      return ok(montarResumo(mes, listaDespesas, listaReceitas, config));
    } catch (e) {
      erroSemEtapa5(e);
      throw e;
    }
  }

  const MESES_PADRAO = 6;
  const MESES_MAXIMO = 12;

  async function painel(ctx) {
    await exigirLogin();
    exigirMetodo(ctx, 'GET');

    const [inicioDoMes, fimDoMes] = intervaloDoMes(ctx);
    const mes = inicioDoMes.slice(0, 7);

    const pedido = ctx.q.get('meses') === null ? String(MESES_PADRAO) : ctx.q.get('meses');
    if (!/^\d{1,2}$/.test(pedido) || Number(pedido) < 1 || Number(pedido) > MESES_MAXIMO) {
      erro('Informe de 1 a ' + MESES_MAXIMO + ' meses.', 422);
    }
    const quantos = Number(pedido);
    const inicioDoPeriodo = primeiroDiaDoMes(mes, -(quantos - 1));

    let listaDespesas;
    let listaReceitas;
    let tiposDespesa;
    let tiposReceita;
    let limiteMensal;
    try {
      // Consultas independentes: todas saem ao mesmo tempo.
      [listaDespesas, listaReceitas, tiposDespesa, tiposReceita, limiteMensal] = await Promise.all([
        linhasDoPeriodo('despesas', 'data_vencimento', 'valor,status,data_vencimento,tipo_id', inicioDoPeriodo, fimDoMes),
        linhasDoPeriodo('receitas', 'data_recebimento', 'valor,status,data_recebimento,tipo_receita_id', inicioDoPeriodo, fimDoMes),
        db('GET', 'tipos_despesa', { query: { select: 'id,nome' } }),
        db('GET', 'tipos_receita', { query: { select: 'id,nome' } }),
        lerConfiguracao(),
      ]);
    } catch (e) {
      erroSemEtapa5(e);
      throw e;
    }

    const serie = [];
    for (let i = quantos - 1; i >= 0; i--) {
      const m = primeiroDiaDoMes(mes, -i).slice(0, 7);
      const [recTotal] = somarPorStatus(doMes(listaReceitas, 'data_recebimento', m), 'recebida');
      const [despTotal] = somarPorStatus(doMes(listaDespesas, 'data_vencimento', m), 'pago');
      serie.push({
        mes: m,
        receitas: emReais(recTotal),
        despesas: emReais(despTotal),
        saldo: emReais(recTotal - despTotal),
      });
    }

    const despesasDoMes = doMes(listaDespesas, 'data_vencimento', mes);
    const receitasDoMes = doMes(listaReceitas, 'data_recebimento', mes);
    return ok({
      resumo: montarResumo(mes, despesasDoMes, receitasDoMes, limiteMensal),
      meses: serie,
      por_tipo: {
        despesas: totaisPorTipo(despesasDoMes, 'tipo_id', tiposDespesa),
        receitas: totaisPorTipo(receitasDoMes, 'tipo_receita_id', tiposReceita),
      },
    });
  }

  // =====================================================================
  // Endpoints: perfil (nome, endereço, foto), foto e limpar registros
  // =====================================================================

  const PERFIL_COLUNAS = 'nome,cep,rua,numero,complemento,bairro,cidade,uf,foto_atualizada_em';
  const FOTO_BYTES_MAX = 100000; // o app envia ~20 KB; isto só protege o banco
  const FOTO_LADO_MAX = 512;
  const UFS = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
    'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
  ];

  /** Linha de perfil do usuário logado, ou null se ainda não existir. */
  async function perfilLinha(usuario) {
    const linhas = await db('GET', 'perfis', { query: { id: 'eq.' + usuario.id, select: PERFIL_COLUNAS } });
    return linhas[0] || null;
  }

  /** O que as telas recebem: dados do perfil + "foto_v" (número que muda a cada foto nova, ou null). */
  function perfilPublico(linha, usuario) {
    linha = linha || {};
    const fotoEm = linha.foto_atualizada_em || null;
    let nome = String(linha.nome || '').trim();
    if (nome === '') nome = String((usuario && usuario.nome) || '').trim();
    if (nome === '') nome = String((usuario && usuario.email) || '').split('@')[0];
    const vazioParaNulo = (v) => (v === undefined ? null : v);
    return {
      nome,
      email: String((usuario && usuario.email) || ''),
      cep: vazioParaNulo(linha.cep),
      rua: vazioParaNulo(linha.rua),
      numero: vazioParaNulo(linha.numero),
      complemento: vazioParaNulo(linha.complemento),
      bairro: vazioParaNulo(linha.bairro),
      cidade: vazioParaNulo(linha.cidade),
      uf: vazioParaNulo(linha.uf),
      foto_v: fotoEm === null ? null : Math.floor(new Date(fotoEm).getTime() / 1000),
    };
  }

  /** Texto opcional: vazio vira null; maior que $max dá erro 422. */
  function textoOpcional(dados, chave, max, rotulo) {
    const valor = typeof dados[chave] === 'string' ? dados[chave].trim() : '';
    if (valor === '') return null;
    if (tamanho(valor) > max) erro(rotulo + ' deve ter no máximo ' + max + ' caracteres.', 422);
    return valor;
  }

  /** Valida nome e endereço e devolve as colunas prontas para gravar. */
  function validarPerfil(dados) {
    const nome = textoObrigatorio(dados, 'nome', 80, 'Informe seu nome.', 'O nome deve ter no máximo 80 caracteres.');

    const cepTexto = typeof dados.cep === 'string' ? dados.cep.trim() : '';
    const cep = cepTexto.replace(/\D/g, '');
    if (cepTexto !== '' && cep.length !== 8) erro('O CEP deve ter 8 números.', 422);

    const uf = typeof dados.uf === 'string' ? dados.uf.trim().toUpperCase() : '';
    if (uf !== '' && !UFS.includes(uf)) erro('Escolha um estado válido.', 422);

    return {
      nome,
      cep: cep === '' ? null : cep,
      rua: textoOpcional(dados, 'rua', 120, 'A rua'),
      numero: textoOpcional(dados, 'numero', 20, 'O número'),
      complemento: textoOpcional(dados, 'complemento', 60, 'O complemento'),
      bairro: textoOpcional(dados, 'bairro', 60, 'O bairro'),
      cidade: textoOpcional(dados, 'cidade', 80, 'A cidade'),
      uf: uf === '' ? null : uf,
    };
  }

  /** Largura e altura de um JPEG (lidas do cabeçalho), ou null se não for um JPEG válido. */
  function dimensoesJpeg(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marcador = bytes[i + 1];
      if (marcador === 0xff) { i++; continue; }
      if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) { i += 2; continue; }
      const comprimento = (bytes[i + 2] << 8) | bytes[i + 3];
      const ehQuadro = marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc;
      if (ehQuadro) return { altura: (bytes[i + 5] << 8) | bytes[i + 6], largura: (bytes[i + 7] << 8) | bytes[i + 8] };
      if (comprimento < 2) return null;
      i += 2 + comprimento;
    }
    return null;
  }

  /**
   * Valida a foto enviada pela tela ("data:image/jpeg;base64,...") e devolve só o texto base64.
   * Confere o conteúdo de verdade (é um JPEG? qual o tamanho?), não só o que a tela diz.
   */
  function validarFoto(entrada) {
    const mensagem = 'A foto não é válida. Escolha outra imagem.';
    const m = typeof entrada === 'string' ? /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/.exec(entrada) : null;
    if (!m) erro(mensagem, 422);

    let bruto;
    try {
      bruto = atob(m[1]);
    } catch (e) {
      return erro(mensagem, 422);
    }
    if (bruto.length === 0 || bruto.length > FOTO_BYTES_MAX) erro('A foto é grande demais. Escolha uma imagem menor.', 422);

    const bytes = Uint8Array.from(bruto, (c) => c.charCodeAt(0));
    const dim = dimensoesJpeg(bytes);
    if (!dim || dim.largura < 1 || dim.altura < 1 || dim.largura > FOTO_LADO_MAX || dim.altura > FOTO_LADO_MAX) erro(mensagem, 422);
    return m[1];
  }

  /** Grava campos no perfil do usuário; cria a linha se ela ainda não existir. */
  async function gravarPerfil(usuario, campos) {
    campos = Object.assign({}, campos, { atualizado_em: new Date().toISOString() });
    let linhas = await db('PATCH', 'perfis', { query: { id: 'eq.' + usuario.id, select: PERFIL_COLUNAS }, json: campos });
    if (!linhas.length) {
      linhas = await db('POST', 'perfis', {
        query: { select: PERFIL_COLUNAS },
        json: Object.assign({ id: usuario.id, nome: campos.nome || usuario.nome || 'Usuário' }, campos),
      });
    }
    return linhas[0];
  }

  async function perfil(ctx) {
    const usuario = await exigirLogin();
    exigirMetodo(ctx, 'GET', 'PUT', 'DELETE');
    const parte = ctx.q.get('parte') || '';
    if (parte !== '' && parte !== 'foto') erro('Parte inválida.', 422);

    try {
      if (ctx.metodo === 'GET') return ok({ perfil: perfilPublico(await perfilLinha(usuario), usuario) });

      if (parte === 'foto') {
        const campos = ctx.metodo === 'PUT'
          ? { foto: validarFoto(ctx.corpo.foto), foto_atualizada_em: new Date().toISOString() }
          : { foto: null, foto_atualizada_em: null };
        return ok({ perfil: perfilPublico(await gravarPerfil(usuario, campos), usuario) });
      }

      if (ctx.metodo !== 'PUT') erro('Método não permitido.', 405);
      const linha = await gravarPerfil(usuario, validarPerfil(ctx.corpo));
      const sessao = lerSessao();
      if (sessao) {
        sessao.user = Object.assign({}, sessao.user, { nome: linha.nome });
        guardarSessao(sessao);
      }
      return ok({ perfil: perfilPublico(linha, usuario) });
    } catch (e) {
      erroSemEtapa6(e);
      throw e;
    }
  }

  /** A foto do usuário como "data:image/jpeg;base64,..." (as telas guardam por versão). */
  async function foto(ctx) {
    const usuario = await exigirLogin();
    exigirMetodo(ctx, 'GET');
    const linhas = await db('GET', 'perfis', { query: { id: 'eq.' + usuario.id, select: 'foto' } });
    const base64 = linhas[0] && typeof linhas[0].foto === 'string' ? linhas[0].foto : '';
    if (base64 === '') erro('Sem foto.', 404);
    return ok({ foto: 'data:image/jpeg;base64,' + base64 });
  }

  /** Quantas linhas o usuário tem na tabela (conta em páginas de 1000, o limite do Supabase). */
  async function contarLinhas(tabela) {
    let total = 0;
    const pagina = 1000;
    for (let deslocamento = 0; deslocamento < 200000; deslocamento += pagina) {
      const lote = await db('GET', tabela, { query: { select: 'id', order: 'id.asc', limit: pagina, offset: deslocamento } });
      total += lote.length;
      if (lote.length < pagina) break;
    }
    return total;
  }

  /**
   * Limpar registros: apaga todas as despesas, receitas e o limite mensal do usuário.
   * Tipos, cartões, perfil e login continuam.
   */
  async function limpar(ctx) {
    const usuario = await exigirLogin();
    exigirMetodo(ctx, 'GET', 'POST');

    if (ctx.metodo === 'GET') {
      return ok({
        despesas: await contarLinhas('despesas'),
        receitas: await contarLinhas('receitas'),
        limite: temLimite(await lerConfiguracao()),
      });
    }

    const confirmacao = ctx.corpo.confirmacao;
    if (typeof confirmacao !== 'string' || confirmacao.trim().toUpperCase() !== 'LIMPAR') erro('Digite LIMPAR para confirmar.', 422);

    const removidas = {};
    try {
      for (const tabela of ['despesas', 'receitas']) {
        removidas[tabela] = (await db('DELETE', tabela, { query: { user_id: 'eq.' + usuario.id, select: 'id' } })).length;
      }
      removidas.limite = (await db('DELETE', 'configuracoes', { query: { user_id: 'eq.' + usuario.id, select: 'user_id' } })).length > 0;
    } catch (e) {
      erroSemEtapa5(e);
      if (Object.keys(removidas).length) erro('A limpeza foi interrompida no meio. Tente de novo para apagar o que sobrou.', 502);
      throw e;
    }
    return ok({ removidas });
  }

  // =====================================================================
  // Entrada: o api.js entrega "api/arquivo?..." para cá
  // =====================================================================

  const ROTAS = {
    'auth': auth,
    'tipos': tipos,
    'cartoes': cartoes,
    'despesas': despesas,
    'receitas': receitas,
    'limite': limite,
    'resumo': resumo,
    'painel': painel,
    'perfil': perfil,
    'foto': foto,
    'limpar': limpar,
  };

  /** Responde { status, dados } no mesmo formato dos antigos endpoints (dados = { ok, ... } ou { ok: false, erro }). */
  async function tratar(metodo, url, corpo) {
    const endereco = new URL(url, window.location.href);
    const nome = endereco.pathname.split('/').pop();
    const rota = Object.prototype.hasOwnProperty.call(ROTAS, nome) ? ROTAS[nome] : null;

    try {
      if (!rota) erro('Não encontrado.', 404);
      if (corpo !== undefined && corpo !== null && (typeof corpo !== 'object' || Array.isArray(corpo))) {
        erro('Corpo da requisição inválido (JSON esperado).', 400);
      }
      return await rota({
        metodo: String(metodo || 'GET').toUpperCase(),
        q: endereco.searchParams,
        corpo: corpo || {},
      });
    } catch (e) {
      if (e instanceof Falha) return { status: e.status, dados: { ok: false, erro: e.message } };
      console.error('[organize]', e);
      return { status: 500, dados: { ok: false, erro: 'Erro interno. Tente novamente.' } };
    }
  }

  return { tratar, Falha };
})();
