// ============================================================
// Mini App — Painel Financeiro (dentro do Telegram)
// ============================================================

const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
}

const supabaseClient = window.supabase.createClient(
  window.SUPABASE_CONFIG.url,
  window.SUPABASE_CONFIG.anonKey
);

const CORES_CATEGORIA = ['#1b4332', '#2d6a4f', '#40916c', '#74c69d', '#b23a48', '#c77f5e', '#7c7c7c'];

let estado = {
  usuario: null,
  grupoId: null,
  categorias: [],
};

function formatarReais(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(dataStr) {
  const [ano, mes, dia] = dataStr.split('-');
  return `${dia}/${mes}/${ano}`;
}

function inicioDoMes() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------
// Autenticação: valida o initData do Telegram com o backend do
// bot (assinatura HMAC, ver bot/api.js) antes de confiar em quem
// está usando a Mini App. Se a API de validação não estiver
// configurada ainda, cai num modo simplificado (só busca pelo
// telegram_id direto no Supabase) para não travar quem está
// configurando o projeto pela primeira vez.
// ------------------------------------------------------------
async function carregarUsuario() {
  const telegramUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
  const initData = tg && tg.initData;

  if (!telegramUser) {
    document.getElementById('grupoNome').textContent = 'Abra pelo bot no Telegram';
    return false;
  }

  const apiBaseUrl = window.API_CONFIG && window.API_CONFIG.baseUrl;
  const apiConfigurada = apiBaseUrl && !apiBaseUrl.includes('seu-bot');

  if (apiConfigurada && initData) {
    try {
      const resposta = await fetch(`${apiBaseUrl}/validar-usuario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      });
      if (resposta.ok) {
        const { usuario } = await resposta.json();
        estado.usuario = { id: usuario.id, grupo_id: usuario.grupo_id };
        estado.grupoId = usuario.grupo_id;
        document.getElementById('grupoNome').textContent = usuario.grupo_nome;
        return true;
      }
      if (resposta.status === 401) {
        document.getElementById('grupoNome').textContent = 'Não foi possível confirmar sua identidade';
        return false;
      }
      // outros erros (404 = ainda não deu /start) caem no modo simplificado abaixo
    } catch (err) {
      console.warn('API de validação indisponível, usando modo simplificado.', err);
    }
  }

  // Modo simplificado (sem validação de assinatura) — usado quando a
  // API ainda não foi configurada em config.js.
  const { data: usuario, error } = await supabaseClient
    .from('usuarios')
    .select('*, grupos(*)')
    .eq('telegram_id', telegramUser.id)
    .maybeSingle();

  if (error || !usuario) {
    document.getElementById('grupoNome').textContent = 'Envie /start para o bot primeiro';
    return false;
  }

  estado.usuario = usuario;
  estado.grupoId = usuario.grupo_id;
  document.getElementById('grupoNome').textContent = usuario.grupos.nome;
  return true;
}

// ------------------------------------------------------------
// Navegação por abas
// ------------------------------------------------------------
document.querySelectorAll('.tab').forEach((botao) => {
  botao.addEventListener('click', () => {
    const view = botao.dataset.view;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('ativo', b === botao));
    document.querySelectorAll('.view').forEach((secao) => {
      secao.hidden = secao.dataset.view !== view;
    });
    if (view === 'painel') carregarPainel();
    if (view === 'lancamentos') carregarTransacoes();
    if (view === 'metas') { carregarMetas(); carregarMetaEconomiaLista(); }
    if (view === 'contas') carregarContas();
    if (view === 'categorias') carregarCategoriasView();
  });
});

// ------------------------------------------------------------
// Categorias (compartilhado entre abas)
// ------------------------------------------------------------
async function carregarCategorias() {
  const { data, error } = await supabaseClient
    .from('categorias')
    .select('*')
    .eq('grupo_id', estado.grupoId)
    .order('tipo')
    .order('nome');
  if (error) return;
  estado.categorias = data;
  preencherSelectsCategoria();
}

function preencherSelectsCategoria() {
  const selDespesaLancamento = document.getElementById('categoriaLancamento');
  const selMeta = document.getElementById('categoriaMeta');
  const tipoAtual = document.getElementById('tipoLancamento').value;

  const opcoes = (tipo) =>
    estado.categorias
      .filter((c) => c.tipo === tipo)
      .map((c) => `<option value="${c.id}">${c.icone} ${c.nome}</option>`)
      .join('');

  selDespesaLancamento.innerHTML = opcoes(tipoAtual);
  selMeta.innerHTML = opcoes('despesa');
}

// ------------------------------------------------------------
// PAINEL
// ------------------------------------------------------------
let graficoCategoria, graficoEvolucao;

async function carregarPainel() {
  const { data: transacoesMes } = await supabaseClient
    .from('transacoes')
    .select('valor, tipo, categoria_id, categorias(nome, cor, icone)')
    .eq('grupo_id', estado.grupoId)
    .gte('data', inicioDoMes());

  const receitas = (transacoesMes || []).filter((t) => t.tipo === 'receita').reduce((s, t) => s + Number(t.valor), 0);
  const despesas = (transacoesMes || []).filter((t) => t.tipo === 'despesa').reduce((s, t) => s + Number(t.valor), 0);

  document.getElementById('saldoMes').textContent = formatarReais(receitas - despesas);
  document.getElementById('totalReceitas').textContent = formatarReais(receitas);
  document.getElementById('totalDespesas').textContent = formatarReais(despesas);

  desenharGraficoCategoria(transacoesMes || []);
  await desenharGraficoEvolucao();
  await carregarMetasResumo();
  await carregarContasResumo();
  await carregarMetaEconomiaPainel(receitas - despesas);
}

// ------------------------------------------------------------
// META DE ECONOMIA (geral, não por categoria)
// ------------------------------------------------------------
async function carregarMetaEconomiaPainel(saldoAtual) {
  const { data: meta } = await supabaseClient
    .from('metas')
    .select('*')
    .eq('grupo_id', estado.grupoId)
    .eq('tipo', 'economia')
    .is('categoria_id', null)
    .maybeSingle();

  const cartao = document.getElementById('cartaoMetaEconomia');
  if (!meta) {
    cartao.hidden = true;
    return;
  }
  cartao.hidden = false;
  const percentual = Math.min((saldoAtual / Number(meta.valor_alvo)) * 100, 100);
  document.getElementById('economiaTexto').textContent = `${formatarReais(saldoAtual)} / ${formatarReais(meta.valor_alvo)}`;
  const barra = document.getElementById('economiaBarra');
  barra.style.width = `${Math.max(percentual, 0)}%`;
  barra.classList.toggle('estourou', percentual < 0);
}

document.getElementById('formMetaEconomia').addEventListener('submit', async (e) => {
  e.preventDefault();
  const valorAlvo = parseFloat(document.getElementById('valorMetaEconomia').value);

  const { data: existente } = await supabaseClient
    .from('metas')
    .select('id')
    .eq('grupo_id', estado.grupoId)
    .eq('tipo', 'economia')
    .is('categoria_id', null)
    .maybeSingle();

  if (existente) {
    await supabaseClient.from('metas').update({ valor_alvo: valorAlvo }).eq('id', existente.id);
  } else {
    await supabaseClient.from('metas').insert({ grupo_id: estado.grupoId, categoria_id: null, tipo: 'economia', valor_alvo: valorAlvo });
  }

  e.target.reset();
  carregarMetaEconomiaLista();
});

async function carregarMetaEconomiaLista() {
  const { data: meta } = await supabaseClient
    .from('metas')
    .select('*')
    .eq('grupo_id', estado.grupoId)
    .eq('tipo', 'economia')
    .is('categoria_id', null)
    .maybeSingle();

  const { receitas, despesas } = await (async () => {
    const { data } = await supabaseClient
      .from('transacoes')
      .select('valor, tipo')
      .eq('grupo_id', estado.grupoId)
      .gte('data', inicioDoMes());
    const r = (data || []).filter((t) => t.tipo === 'receita').reduce((s, t) => s + Number(t.valor), 0);
    const d = (data || []).filter((t) => t.tipo === 'despesa').reduce((s, t) => s + Number(t.valor), 0);
    return { receitas: r, despesas: d };
  })();

  const container = document.getElementById('listaMetaEconomia');
  if (!meta) {
    container.innerHTML = '<div class="vazio">Nenhuma meta de economia definida ainda.</div>';
    return;
  }
  const saldo = receitas - despesas;
  const percentual = Math.min((saldo / Number(meta.valor_alvo)) * 100, 100);
  container.innerHTML = `
    <div class="item meta-item">
      <div class="meta-topo">
        <span>🐖 Guardado este mês</span>
        <span>${formatarReais(saldo)} / ${formatarReais(meta.valor_alvo)}</span>
      </div>
      <div class="barra"><div class="barra-preenchida ${percentual < 100 && saldo < 0 ? 'estourou' : ''}" style="width:${Math.max(percentual, 0)}%"></div></div>
    </div>`;
}

// ------------------------------------------------------------
// EXPORTAR CSV
// ------------------------------------------------------------
document.getElementById('botaoExportarCsv').addEventListener('click', async () => {
  const { data: transacoes } = await supabaseClient
    .from('transacoes')
    .select('data, tipo, valor, descricao, categorias(nome)')
    .eq('grupo_id', estado.grupoId)
    .gte('data', inicioDoMes())
    .order('data');

  if (!transacoes || transacoes.length === 0) {
    if (tg) tg.showAlert ? tg.showAlert('Nenhum lançamento este mês para exportar.') : alert('Nenhum lançamento este mês para exportar.');
    return;
  }

  const linhas = [['Data', 'Tipo', 'Categoria', 'Descrição', 'Valor']];
  transacoes.forEach((t) => {
    linhas.push([
      formatarData(t.data),
      t.tipo,
      t.categorias ? t.categorias.nome : '',
      (t.descricao || '').replace(/;/g, ','),
      String(t.valor).replace('.', ','),
    ]);
  });
  const csv = linhas.map((linha) => linha.join(';')).join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `lancamentos-${new Date().toISOString().slice(0, 7)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

function desenharGraficoCategoria(transacoes) {
  const porCategoria = {};
  transacoes
    .filter((t) => t.tipo === 'despesa')
    .forEach((t) => {
      const nome = t.categorias ? t.categorias.nome : 'Sem categoria';
      porCategoria[nome] = (porCategoria[nome] || 0) + Number(t.valor);
    });

  const labels = Object.keys(porCategoria);
  const valores = Object.values(porCategoria);

  if (graficoCategoria) graficoCategoria.destroy();
  const ctx = document.getElementById('graficoCategoria').getContext('2d');

  if (labels.length === 0) {
    ctx.canvas.parentElement.querySelector('.vazio')?.remove();
    const vazio = document.createElement('div');
    vazio.className = 'vazio';
    vazio.textContent = 'Sem despesas este mês ainda.';
    ctx.canvas.parentElement.appendChild(vazio);
    return;
  }

  graficoCategoria = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: valores, backgroundColor: CORES_CATEGORIA, borderWidth: 0 }],
    },
    options: {
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
    },
  });
}

async function desenharGraficoEvolucao() {
  const meses = [];
  const hoje = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    meses.push(d);
  }
  const inicio = meses[0].toISOString().slice(0, 10);

  const { data: transacoes } = await supabaseClient
    .from('transacoes')
    .select('valor, tipo, data')
    .eq('grupo_id', estado.grupoId)
    .gte('data', inicio);

  const receitasPorMes = meses.map(() => 0);
  const despesasPorMes = meses.map(() => 0);

  (transacoes || []).forEach((t) => {
    const d = new Date(t.data);
    const idx = meses.findIndex((m) => m.getFullYear() === d.getFullYear() && m.getMonth() === d.getMonth());
    if (idx === -1) return;
    if (t.tipo === 'receita') receitasPorMes[idx] += Number(t.valor);
    else despesasPorMes[idx] += Number(t.valor);
  });

  const labels = meses.map((d) => d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''));

  if (graficoEvolucao) graficoEvolucao.destroy();
  const ctx = document.getElementById('graficoEvolucao').getContext('2d');
  graficoEvolucao = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Receitas', data: receitasPorMes, backgroundColor: '#2d6a4f' },
        { label: 'Despesas', data: despesasPorMes, backgroundColor: '#b23a48' },
      ],
    },
    options: {
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: { y: { ticks: { font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } },
    },
  });
}

async function carregarMetasResumo() {
  const container = document.getElementById('listaMetasPainel');
  const metas = await buscarMetasComProgresso();
  container.innerHTML = metas.length
    ? metas.map(renderMetaItem).join('')
    : '<div class="vazio">Nenhuma meta definida ainda. Configure na aba Metas.</div>';
}

async function carregarContasResumo() {
  const container = document.getElementById('listaContasPainel');
  const hoje = new Date().toISOString().slice(0, 10);
  const limite = new Date();
  limite.setDate(limite.getDate() + 14);

  const { data: contas } = await supabaseClient
    .from('contas_a_pagar')
    .select('*')
    .eq('grupo_id', estado.grupoId)
    .eq('status', 'pendente')
    .gte('vencimento', hoje)
    .lte('vencimento', limite.toISOString().slice(0, 10))
    .order('vencimento');

  container.innerHTML = (contas || []).length
    ? contas.map((c) => `
        <div class="item">
          <div class="item-principal">
            <div class="item-titulo">${c.descricao}</div>
            <div class="item-sub">vence em ${formatarData(c.vencimento)}</div>
          </div>
          <div class="item-valor">${formatarReais(c.valor)}</div>
        </div>`).join('')
    : '<div class="vazio">Nenhuma conta nos próximos 14 dias.</div>';
}

// ------------------------------------------------------------
// LANÇAMENTOS
// ------------------------------------------------------------
document.getElementById('segmentoTipo').addEventListener('click', (e) => {
  const botao = e.target.closest('.segment-btn');
  if (!botao) return;
  document.querySelectorAll('#segmentoTipo .segment-btn').forEach((b) => b.classList.toggle('ativo', b === botao));
  document.getElementById('tipoLancamento').value = botao.dataset.tipo;
  preencherSelectsCategoria();
});

document.getElementById('formLancamento').addEventListener('submit', async (e) => {
  e.preventDefault();
  const tipo = document.getElementById('tipoLancamento').value;
  const valor = parseFloat(document.getElementById('valorLancamento').value);
  const categoriaId = document.getElementById('categoriaLancamento').value;
  const descricao = document.getElementById('descricaoLancamento').value || null;

  await supabaseClient.from('transacoes').insert({
    grupo_id: estado.grupoId,
    usuario_id: estado.usuario.id,
    categoria_id: categoriaId,
    tipo,
    valor,
    descricao,
    origem: 'miniapp',
  });

  e.target.reset();
  document.getElementById('tipoLancamento').value = 'despesa';
  document.querySelectorAll('#segmentoTipo .segment-btn').forEach((b, i) => b.classList.toggle('ativo', i === 0));
  preencherSelectsCategoria();
  if (tg) tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success');
  carregarTransacoes();
});

async function carregarTransacoes() {
  const { data: transacoes } = await supabaseClient
    .from('transacoes')
    .select('*, categorias(nome, icone)')
    .eq('grupo_id', estado.grupoId)
    .order('data', { ascending: false })
    .order('criado_em', { ascending: false })
    .limit(30);

  const container = document.getElementById('listaTransacoes');
  container.innerHTML = (transacoes || []).length
    ? transacoes.map((t) => `
        <div class="item">
          <div class="item-principal">
            <div class="item-titulo">${t.categorias ? t.categorias.icone + ' ' + t.categorias.nome : 'Sem categoria'}${t.descricao ? ' · ' + t.descricao : ''}</div>
            <div class="item-sub">${formatarData(t.data)}</div>
          </div>
          <div class="item-valor ${t.tipo === 'receita' ? 'pos' : 'neg'}">${t.tipo === 'receita' ? '+' : '−'} ${formatarReais(t.valor)}</div>
          <div class="item-acoes">
            <button class="botao-icone" onclick="excluirTransacao('${t.id}')">✕</button>
          </div>
        </div>`).join('')
    : '<div class="vazio">Nenhum lançamento ainda.</div>';
}

async function excluirTransacao(id) {
  await supabaseClient.from('transacoes').delete().eq('id', id);
  carregarTransacoes();
}

// ------------------------------------------------------------
// METAS
// ------------------------------------------------------------
document.getElementById('formMeta').addEventListener('submit', async (e) => {
  e.preventDefault();
  const categoriaId = document.getElementById('categoriaMeta').value;
  const valorAlvo = parseFloat(document.getElementById('valorMeta').value);

  await supabaseClient
    .from('metas')
    .upsert(
      { grupo_id: estado.grupoId, categoria_id: categoriaId, valor_alvo: valorAlvo, tipo: 'orcamento' },
      { onConflict: 'grupo_id,categoria_id,tipo' }
    );

  e.target.reset();
  carregarMetas();
});

async function buscarMetasComProgresso() {
  const { data: metas } = await supabaseClient
    .from('metas')
    .select('*, categorias(nome, icone)')
    .eq('grupo_id', estado.grupoId)
    .eq('tipo', 'orcamento');

  const { data: transacoesMes } = await supabaseClient
    .from('transacoes')
    .select('valor, categoria_id')
    .eq('grupo_id', estado.grupoId)
    .eq('tipo', 'despesa')
    .gte('data', inicioDoMes());

  return (metas || []).map((m) => {
    const gasto = (transacoesMes || [])
      .filter((t) => t.categoria_id === m.categoria_id)
      .reduce((s, t) => s + Number(t.valor), 0);
    const percentual = Math.min((gasto / Number(m.valor_alvo)) * 100, 999);
    return { ...m, gasto, percentual };
  });
}

function renderMetaItem(m) {
  const estourou = m.percentual >= 100;
  return `
    <div class="item meta-item">
      <div class="meta-topo">
        <span>${m.categorias.icone} ${m.categorias.nome}</span>
        <span>${formatarReais(m.gasto)} / ${formatarReais(m.valor_alvo)}</span>
      </div>
      <div class="barra"><div class="barra-preenchida ${estourou ? 'estourou' : ''}" style="width:${Math.min(m.percentual, 100)}%"></div></div>
    </div>`;
}

async function carregarMetas() {
  const metas = await buscarMetasComProgresso();
  document.getElementById('listaMetas').innerHTML = metas.length
    ? metas.map(renderMetaItem).join('')
    : '<div class="vazio">Nenhuma meta cadastrada.</div>';
}

// ------------------------------------------------------------
// CONTAS A PAGAR
// ------------------------------------------------------------
document.getElementById('formConta').addEventListener('submit', async (e) => {
  e.preventDefault();
  const descricao = document.getElementById('descricaoConta').value;
  const valor = parseFloat(document.getElementById('valorConta').value);
  const vencimento = document.getElementById('vencimentoConta').value;
  const recorrente = document.getElementById('recorrenteConta').checked;

  await supabaseClient.from('contas_a_pagar').insert({
    grupo_id: estado.grupoId,
    descricao,
    valor,
    vencimento,
    recorrente,
  });

  e.target.reset();
  carregarContas();
});

async function carregarContas() {
  const { data: contas } = await supabaseClient
    .from('contas_a_pagar')
    .select('*')
    .eq('grupo_id', estado.grupoId)
    .order('vencimento');

  const container = document.getElementById('listaContas');
  container.innerHTML = (contas || []).length
    ? contas.map((c) => `
        <div class="item">
          <div class="item-principal">
            <div class="item-titulo">${c.descricao}${c.recorrente ? ' ↻' : ''}</div>
            <div class="item-sub">${formatarData(c.vencimento)} · ${c.status}</div>
          </div>
          <div class="item-valor">${formatarReais(c.valor)}</div>
          <div class="item-acoes">
            ${c.status === 'pendente' ? `<button class="botao-icone" onclick="marcarContaPaga('${c.id}')">✓</button>` : ''}
            <button class="botao-icone" onclick="excluirConta('${c.id}')">✕</button>
          </div>
        </div>`).join('')
    : '<div class="vazio">Nenhuma conta cadastrada.</div>';
}

async function marcarContaPaga(id) {
  await supabaseClient.from('contas_a_pagar').update({ status: 'paga' }).eq('id', id);
  carregarContas();
}

async function excluirConta(id) {
  await supabaseClient.from('contas_a_pagar').delete().eq('id', id);
  carregarContas();
}

// ------------------------------------------------------------
// CATEGORIAS
// ------------------------------------------------------------
document.getElementById('segmentoTipoCategoria').addEventListener('click', (e) => {
  const botao = e.target.closest('.segment-btn');
  if (!botao) return;
  document.querySelectorAll('#segmentoTipoCategoria .segment-btn').forEach((b) => b.classList.toggle('ativo', b === botao));
  document.getElementById('tipoCategoria').value = botao.dataset.tipo;
});

document.getElementById('formCategoria').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = document.getElementById('nomeCategoria').value;
  const tipo = document.getElementById('tipoCategoria').value;

  await supabaseClient.from('categorias').insert({ grupo_id: estado.grupoId, nome, tipo, cor: '#6C63FF', icone: '🏷️' });

  e.target.reset();
  await carregarCategorias();
  carregarCategoriasView();
});

function carregarCategoriasView() {
  const despesas = estado.categorias.filter((c) => c.tipo === 'despesa');
  const receitas = estado.categorias.filter((c) => c.tipo === 'receita');

  document.getElementById('listaCategoriasDespesa').innerHTML = despesas
    .map((c) => `<div class="chip">${c.icone} ${c.nome}</div>`).join('') || '<div class="vazio">Nenhuma.</div>';
  document.getElementById('listaCategoriasReceita').innerHTML = receitas
    .map((c) => `<div class="chip">${c.icone} ${c.nome}</div>`).join('') || '<div class="vazio">Nenhuma.</div>';
}

// ------------------------------------------------------------
// Inicialização
// ------------------------------------------------------------
(async function iniciar() {
  const ok = await carregarUsuario();
  if (!ok) return;
  await carregarCategorias();
  await carregarPainel();
})();
