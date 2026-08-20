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

const ICONES_DISPONIVEIS = [
  '🏷️', '🍽️', '🚗', '🏠', '💊', '🎉', '📚', '📦', '💼', '🧾', '➕',
  '🐾', '👕', '💻', '🎮', '✈️', '⛽', '🎁', '📱', '🧾', '🏋️', '💇',
  '🍺', '☕', '🚕', '🚌', '🏥', '🎓', '🧸', '🛒', '💡', '💧', '📺',
  '🐶', '🐱', '🎵', '🛠️', '🧴', '🚬', '🍿', '💳',
];

let iconeSelecionado = '🏷️';

const CORES_PALETA = [
  '#1b4332', '#2d6a4f', '#40916c', '#74c69d', '#95d5b2',
  '#b23a48', '#e07a5f', '#f2994a', '#f2c94c', '#e8c1a0',
  '#2f80ed', '#56ccf2', '#6c63ff', '#9b51e0', '#bb6bd9',
  '#828282', '#4f4f4f', '#c77f5e', '#219653', '#eb5757',
];
let corSelecionada = CORES_PALETA[0];
let categoriaEditandoId = null;

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
        exibirNomeDoGrupo(usuario.grupo_nome);
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
  exibirNomeDoGrupo(usuario.grupos.nome);
  return true;
}

function exibirNomeDoGrupo(nome) {
  document.getElementById('grupoNome').innerHTML = `${nome} <span class="icone-editar">✎</span>`;
}

document.getElementById('grupoNome').addEventListener('click', async () => {
  if (!estado.grupoId) return;
  const novoNome = prompt('Novo nome do grupo:');
  if (!novoNome || !novoNome.trim()) return;

  await supabaseClient.from('grupos').update({ nome: novoNome.trim() }).eq('id', estado.grupoId);
  exibirNomeDoGrupo(novoNome.trim());
  if (tg) tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success');
});

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
    if (view === 'lancamentos') { carregarTransacoes(); carregarRecorrencias(); }
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
  const selRecorrencia = document.getElementById('categoriaRecorrencia');
  const selParcelamento = document.getElementById('categoriaParcelamento');
  const tipoAtual = document.getElementById('tipoLancamento').value;
  const tipoRecorrenciaAtual = document.getElementById('tipoRecorrencia').value;

  const opcoes = (tipo) =>
    estado.categorias
      .filter((c) => c.tipo === tipo)
      .map((c) => `<option value="${c.id}">${c.icone} ${c.nome}</option>`)
      .join('');

  selDespesaLancamento.innerHTML = opcoes(tipoAtual);
  selMeta.innerHTML = opcoes('despesa');
  selRecorrencia.innerHTML = opcoes(tipoRecorrenciaAtual);
  selParcelamento.innerHTML = opcoes('despesa');
}

// ------------------------------------------------------------
// PAINEL
// ------------------------------------------------------------
let graficoCategoria, graficoEvolucao, graficoAnel;

// Calcula o intervalo de datas (início/fim, "YYYY-MM-DD") a partir dos
// filtros de mês e semana selecionados no topo do painel.
function calcularIntervaloFiltro() {
  const mesInput = document.getElementById('filtroMes').value; // "YYYY-MM"
  const semana = document.getElementById('filtroSemana').value;
  const [ano, mes] = mesInput.split('-').map(Number);
  const ultimoDiaMes = new Date(ano, mes, 0).getDate();

  let diaInicio = 1;
  let diaFim = ultimoDiaMes;

  if (semana === '1') { diaInicio = 1; diaFim = Math.min(7, ultimoDiaMes); }
  else if (semana === '2') { diaInicio = 8; diaFim = Math.min(14, ultimoDiaMes); }
  else if (semana === '3') { diaInicio = 15; diaFim = Math.min(21, ultimoDiaMes); }
  else if (semana === '4') { diaInicio = 22; diaFim = ultimoDiaMes; }

  const pad = (n) => String(n).padStart(2, '0');
  return {
    inicio: `${ano}-${pad(mes)}-${pad(diaInicio)}`,
    fim: `${ano}-${pad(mes)}-${pad(diaFim)}`,
  };
}

document.getElementById('filtroMes').addEventListener('change', carregarPainel);
document.getElementById('filtroSemana').addEventListener('change', carregarPainel);
document.getElementById('filtroPeriodoEvolucao').addEventListener('change', desenharGraficoEvolucao);

async function carregarPainel() {
  const { inicio, fim } = calcularIntervaloFiltro();

  const { data: transacoesPeriodo } = await supabaseClient
    .from('transacoes')
    .select('valor, tipo, categoria_id, categorias(nome, cor, icone)')
    .eq('grupo_id', estado.grupoId)
    .gte('data', inicio)
    .lte('data', fim);

  const receitas = (transacoesPeriodo || []).filter((t) => t.tipo === 'receita').reduce((s, t) => s + Number(t.valor), 0);
  const despesas = (transacoesPeriodo || []).filter((t) => t.tipo === 'despesa').reduce((s, t) => s + Number(t.valor), 0);

  document.getElementById('saldoMes').textContent = formatarReais(receitas - despesas);
  document.getElementById('totalReceitas').textContent = formatarReais(receitas);
  document.getElementById('totalDespesas').textContent = formatarReais(despesas);

  desenharGraficoCategoria(transacoesPeriodo || []);
  await desenharGraficoAnel(receitas, despesas);
  await desenharGraficoEvolucao();
  await carregarMetasResumo(inicio, fim);
  await carregarContasResumo();
  await carregarMetasEconomiaPainel();
  await carregarSaldoTotalGeral();
}

// Saldo desde o início de uso do app (todas as transações, sem filtro de período).
async function carregarSaldoTotalGeral() {
  const { data: todas } = await supabaseClient
    .from('transacoes')
    .select('valor, tipo')
    .eq('grupo_id', estado.grupoId);

  const receitas = (todas || []).filter((t) => t.tipo === 'receita').reduce((s, t) => s + Number(t.valor), 0);
  const despesas = (todas || []).filter((t) => t.tipo === 'despesa').reduce((s, t) => s + Number(t.valor), 0);
  const saldo = receitas - despesas;

  const elemento = document.getElementById('saldoTotalGeral');
  elemento.textContent = formatarReais(saldo);
  elemento.classList.toggle('pos', saldo >= 0);
  elemento.classList.toggle('neg', saldo < 0);
}

// ------------------------------------------------------------
// METAS DE ECONOMIA (nomeadas, ex.: "Casamento", "Carro")
// ------------------------------------------------------------
function renderMetaEconomiaItem(m, comAcoes) {
  const percentual = Math.min((Number(m.valor_guardado) / Number(m.valor_alvo)) * 100, 100);
  const atingida = Number(m.valor_guardado) >= Number(m.valor_alvo);
  const acoes = comAcoes
    ? `<div class="item-acoes">
         <button class="botao-icone" onclick="pedirContribuicao('${m.id}', '${m.nome.replace(/'/g, "\\'")}')" title="Guardar mais">＋</button>
         <button class="botao-icone" onclick="excluirMetaEconomia('${m.id}')" title="Excluir">✕</button>
       </div>`
    : '';
  return `
    <div class="item meta-item">
      <div class="meta-topo">
        <span>${atingida ? '🎯' : '🐖'} ${m.nome}</span>
        <span>${formatarReais(m.valor_guardado)} / ${formatarReais(m.valor_alvo)}</span>
      </div>
      <div class="barra"><div class="barra-preenchida ${atingida ? '' : ''}" style="width:${percentual}%"></div></div>
      ${acoes}
    </div>`;
}

async function carregarMetasEconomiaPainel() {
  const { data: metas } = await supabaseClient
    .from('metas_economia')
    .select('*')
    .eq('grupo_id', estado.grupoId)
    .order('criado_em');

  const bloco = document.getElementById('blocoMetasEconomiaPainel');
  if (!metas || metas.length === 0) {
    bloco.hidden = true;
    return;
  }
  bloco.hidden = false;
  document.getElementById('listaMetasEconomiaPainel').innerHTML = metas.map((m) => renderMetaEconomiaItem(m, false)).join('');
}

document.getElementById('formMetaEconomia').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = document.getElementById('nomeMetaEconomia').value.trim();
  const valorAlvo = parseFloat(document.getElementById('valorMetaEconomia').value);

  await supabaseClient.from('metas_economia').insert({ grupo_id: estado.grupoId, nome, valor_alvo: valorAlvo, valor_guardado: 0 });

  e.target.reset();
  carregarMetaEconomiaLista();
});

async function carregarMetaEconomiaLista() {
  const { data: metas } = await supabaseClient
    .from('metas_economia')
    .select('*')
    .eq('grupo_id', estado.grupoId)
    .order('criado_em');

  const container = document.getElementById('listaMetaEconomia');
  container.innerHTML = (metas || []).length
    ? metas.map((m) => renderMetaEconomiaItem(m, true)).join('')
    : '<div class="vazio">Nenhuma meta de economia ainda. Crie uma acima.</div>';
}

async function pedirContribuicao(metaId, nomeMeta) {
  const valorTexto = prompt(`Quanto guardar em "${nomeMeta}"?`);
  if (!valorTexto) return;
  const valor = parseFloat(valorTexto.replace(',', '.'));
  if (isNaN(valor) || valor <= 0) return;

  const { data: meta } = await supabaseClient.from('metas_economia').select('valor_guardado').eq('id', metaId).single();
  await supabaseClient.from('metas_economia').update({ valor_guardado: Number(meta.valor_guardado) + valor }).eq('id', metaId);

  if (tg) tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success');
  carregarMetaEconomiaLista();
}

async function excluirMetaEconomia(id) {
  await supabaseClient.from('metas_economia').delete().eq('id', id);
  carregarMetaEconomiaLista();
}

// ------------------------------------------------------------
// EXPORTAR CSV
// ------------------------------------------------------------
// As exportações rodam no servidor do bot (não mais no navegador),
// porque a Mini App, quando aberta dentro do Telegram, não tem
// permissão pra baixar arquivos direto do quadro (iframe) restrito
// onde ela roda. Abrir o link com tg.openLink() usa o navegador de
// verdade por fora desse quadro, onde o download funciona normal.
async function abrirExportacao(tipo) {
  const { inicio, fim } = calcularIntervaloFiltro();
  const apiBaseUrl = window.API_CONFIG && window.API_CONFIG.baseUrl;
  const apiConfigurada = apiBaseUrl && !apiBaseUrl.includes('seu-bot');
  const initData = tg && tg.initData;

  if (!apiConfigurada || !initData) {
    // Sem a API configurada (ex.: testando fora do Telegram), cai no
    // método antigo, que baixa direto pelo navegador.
    if (tipo === 'csv') exportarCsvPeloNavegador(inicio, fim);
    else exportarPdfPeloNavegador(inicio, fim);
    return;
  }

  // Busca um token curto (o initData inteiro é grande demais pra ir
  // direto na URL — ver o comentário em bot/api.js sobre isso).
  let token;
  try {
    const resposta = await fetch(`${apiBaseUrl}/token-exportacao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    });
    if (!resposta.ok) throw new Error('token_invalido');
    ({ token } = await resposta.json());
  } catch (err) {
    console.warn('Não foi possível gerar o link de exportação, usando modo simplificado.', err);
    if (tipo === 'csv') exportarCsvPeloNavegador(inicio, fim);
    else exportarPdfPeloNavegador(inicio, fim);
    return;
  }

  const url = `${apiBaseUrl}/exportar/${tipo}?token=${encodeURIComponent(token)}&inicio=${inicio}&fim=${fim}`;
  if (tg && tg.openLink) {
    tg.openLink(url);
  } else {
    window.open(url, '_blank');
  }
}

document.getElementById('botaoExportarCsv').addEventListener('click', () => abrirExportacao('csv'));
document.getElementById('botaoExportarPdf').addEventListener('click', () => abrirExportacao('pdf'));

// --- Método antigo (gera o arquivo no próprio navegador) — só usado
// como reserva quando a API do bot ainda não está configurada. ---
async function exportarCsvPeloNavegador(inicio, fim) {
  const { data: transacoes } = await supabaseClient
    .from('transacoes')
    .select('data, tipo, valor, descricao, categorias(nome)')
    .eq('grupo_id', estado.grupoId)
    .gte('data', inicio)
    .lte('data', fim)
    .order('data');

  if (!transacoes || transacoes.length === 0) {
    if (tg) tg.showAlert ? tg.showAlert('Nenhum lançamento nesse período para exportar.') : alert('Nenhum lançamento nesse período para exportar.');
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
  link.download = `lancamentos-${inicio}-a-${fim}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function exportarPdfPeloNavegador(inicio, fim) {
  const { data: transacoes } = await supabaseClient
    .from('transacoes')
    .select('data, tipo, valor, descricao, categorias(nome), usuarios(nome)')
    .eq('grupo_id', estado.grupoId)
    .gte('data', inicio)
    .lte('data', fim)
    .order('data');

  if (!transacoes || transacoes.length === 0) {
    if (tg) tg.showAlert ? tg.showAlert('Nenhum lançamento nesse período para exportar.') : alert('Nenhum lançamento nesse período para exportar.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 18;

  doc.setFontSize(16);
  doc.text('Livro-Caixa — Relatório financeiro', 14, y);
  y += 8;
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Período: ${formatarData(inicio)} a ${formatarData(fim)}`, 14, y);
  y += 10;

  const receitas = transacoes.filter((t) => t.tipo === 'receita').reduce((s, t) => s + Number(t.valor), 0);
  const despesas = transacoes.filter((t) => t.tipo === 'despesa').reduce((s, t) => s + Number(t.valor), 0);

  doc.setTextColor(0);
  doc.setFontSize(11);
  doc.text(`Receitas: ${formatarReais(receitas)}`, 14, y);
  y += 6;
  doc.text(`Despesas: ${formatarReais(despesas)}`, 14, y);
  y += 6;
  doc.setFont(undefined, 'bold');
  doc.text(`Saldo do período: ${formatarReais(receitas - despesas)}`, 14, y);
  doc.setFont(undefined, 'normal');
  y += 12;

  doc.setFontSize(12);
  doc.text('Lançamentos', 14, y);
  y += 7;
  doc.setFontSize(9);

  transacoes.forEach((t) => {
    if (y > 280) {
      doc.addPage();
      y = 18;
    }
    const responsavel = t.usuarios ? t.usuarios.nome : 'Automático';
    const categoria = t.categorias ? t.categorias.nome : 'Sem categoria';
    const sinal = t.tipo === 'receita' ? '+' : '-';
    doc.text(`${formatarData(t.data)}  ${categoria}  ${sinal} ${formatarReais(t.valor)}  (${responsavel})`, 14, y);
    y += 5;
    if (t.descricao) {
      doc.setTextColor(120);
      doc.text(`   ${t.descricao}`, 14, y);
      doc.setTextColor(0);
      y += 5;
    }
  });

  doc.save(`relatorio-${inicio}-a-${fim}.pdf`);
}

// Gráfico de anel: verde = sobra depois da economia sugerida,
// azul = economia sugerida, vermelho = gastos do período.
async function desenharGraficoAnel(receitas, despesas) {
  if (estado.percentualEconomia === undefined) {
    const { data: grupo } = await supabaseClient
      .from('grupos')
      .select('percentual_economia_sugerida')
      .eq('id', estado.grupoId)
      .single();
    estado.percentualEconomia = grupo ? Number(grupo.percentual_economia_sugerida) : 20;
    document.getElementById('percentualEconomia').value = estado.percentualEconomia;
  }

  const sobra = Math.max(receitas - despesas, 0);
  const economiaSugerida = sobra * (estado.percentualEconomia / 100);
  const sobraFinal = Math.max(sobra - economiaSugerida, 0);

  let dados, cores;
  if (despesas >= receitas && receitas > 0) {
    dados = [0, 0, despesas];
    cores = ['#2d6a4f', '#2f80ed', '#b23a48'];
  } else if (receitas === 0) {
    dados = [0, 0, despesas || 0.0001];
    cores = ['#2d6a4f', '#2f80ed', '#b23a48'];
  } else {
    dados = [sobraFinal, economiaSugerida, despesas];
    cores = ['#2d6a4f', '#2f80ed', '#b23a48'];
  }

  if (graficoAnel) graficoAnel.destroy();
  const ctx = document.getElementById('graficoAnel').getContext('2d');
  graficoAnel = new Chart(ctx, {
    type: 'doughnut',
    data: { datasets: [{ data: dados, backgroundColor: cores, borderWidth: 0 }] },
    options: {
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => formatarReais(ctx.raw),
          },
        },
      },
    },
  });
}

document.getElementById('botaoSalvarPercentual').addEventListener('click', async () => {
  const valor = parseFloat(document.getElementById('percentualEconomia').value);
  if (isNaN(valor) || valor < 0 || valor > 100) return;

  await supabaseClient.from('grupos').update({ percentual_economia_sugerida: valor }).eq('id', estado.grupoId);
  estado.percentualEconomia = valor;
  if (tg) tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success');
  carregarPainel();
});


function desenharGraficoCategoria(transacoes) {
  const porCategoria = {};
  transacoes
    .filter((t) => t.tipo === 'despesa')
    .forEach((t) => {
      const nome = t.categorias ? t.categorias.nome : 'Sem categoria';
      const cor = t.categorias ? t.categorias.cor : '#828282';
      if (!porCategoria[nome]) porCategoria[nome] = { total: 0, cor };
      porCategoria[nome].total += Number(t.valor);
    });

  const labels = Object.keys(porCategoria);
  const valores = labels.map((nome) => porCategoria[nome].total);
  const cores = labels.map((nome) => porCategoria[nome].cor);

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
      datasets: [{ data: valores, backgroundColor: cores, borderWidth: 0 }],
    },
    options: {
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
    },
  });
}

async function desenharGraficoEvolucao() {
  const quantidadeMeses = parseInt(document.getElementById('filtroPeriodoEvolucao').value, 10) || 6;
  const meses = [];
  const hoje = new Date();
  for (let i = quantidadeMeses - 1; i >= 0; i--) {
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

  const labels = meses.map((d) => d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', ''));

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

async function carregarMetasResumo(inicio, fim) {
  const container = document.getElementById('listaMetasPainel');
  const metas = await buscarMetasComProgresso(inicio, fim);
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

let ultimasTransacoesCarregadas = [];

function renderItemTransacao(t, modoEdicao) {
  const responsavel = t.usuarios ? t.usuarios.nome : '🔁 Automático';

  if (!modoEdicao) {
    return `
      <div class="item item-transacao" id="item-${t.id}">
        <div class="item-linha-topo">
          <span class="item-categoria">${t.categorias ? t.categorias.icone + ' ' + t.categorias.nome : 'Sem categoria'}</span>
          <span class="item-valor ${t.tipo === 'receita' ? 'pos' : 'neg'}">${t.tipo === 'receita' ? '+' : '−'} ${formatarReais(t.valor)}</span>
        </div>
        ${t.descricao ? `<div class="item-descricao">${t.descricao}</div>` : ''}
        <div class="item-rodape">
          <span>${formatarData(t.data)} · ${responsavel}</span>
          <div class="item-acoes">
            <button class="botao-icone" onclick="editarTransacao('${t.id}')" title="Editar">✎</button>
            <button class="botao-icone" onclick="excluirTransacao('${t.id}')" title="Excluir">✕</button>
          </div>
        </div>
      </div>`;
  }

  const categoriasDoTipo = estado.categorias.filter((c) => c.tipo === t.tipo);
  const opcoesCategoria = categoriasDoTipo
    .map((c) => `<option value="${c.id}" ${c.id === t.categoria_id ? 'selected' : ''}>${c.icone} ${c.nome}</option>`)
    .join('');

  return `
    <div class="item item-transacao" id="item-${t.id}">
      <div class="item-linha-topo">
        <select id="editCategoria-${t.id}" class="select-inline">${opcoesCategoria}</select>
        <input type="number" step="0.01" min="0.01" id="editValor-${t.id}" class="input-inline-valor" value="${t.valor}" />
      </div>
      <input type="text" id="editDescricao-${t.id}" class="input-inline-descricao" placeholder="Descrição (opcional)" value="${(t.descricao || '').replace(/"/g, '&quot;')}" />
      <div class="item-rodape">
        <span>${formatarData(t.data)} · ${responsavel}</span>
        <div class="item-acoes">
          <button class="botao-icone" onclick="salvarEdicaoTransacao('${t.id}')" title="Salvar">✓</button>
          <button class="botao-icone" onclick="cancelarEdicaoTransacao('${t.id}')" title="Cancelar">⨯</button>
        </div>
      </div>
    </div>`;
}

async function carregarTransacoes() {
  const mesInput = document.getElementById('filtroMesTransacoes').value; // "YYYY-MM"
  const [ano, mes] = mesInput.split('-').map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const pad = (n) => String(n).padStart(2, '0');
  const inicio = `${ano}-${pad(mes)}-01`;
  const fim = `${ano}-${pad(mes)}-${pad(ultimoDia)}`;

  const { data: transacoes } = await supabaseClient
    .from('transacoes')
    .select('*, categorias(nome, icone), usuarios(nome)')
    .eq('grupo_id', estado.grupoId)
    .gte('data', inicio)
    .lte('data', fim)
    .order('data', { ascending: false })
    .order('criado_em', { ascending: false });

  ultimasTransacoesCarregadas = transacoes || [];

  const container = document.getElementById('listaTransacoes');
  container.innerHTML = ultimasTransacoesCarregadas.length
    ? ultimasTransacoesCarregadas.map((t) => renderItemTransacao(t, false)).join('')
    : '<div class="vazio">Nenhum lançamento nesse mês.</div>';
}

document.getElementById('filtroMesTransacoes').addEventListener('change', carregarTransacoes);

async function excluirTransacao(id) {
  await supabaseClient.from('transacoes').delete().eq('id', id);
  carregarTransacoes();
}

function editarTransacao(id) {
  const transacao = ultimasTransacoesCarregadas.find((t) => t.id === id);
  if (!transacao) return;
  const item = document.getElementById(`item-${id}`);
  item.outerHTML = renderItemTransacao(transacao, true);
  document.getElementById(`editValor-${id}`).focus();
}

function cancelarEdicaoTransacao(id) {
  const transacao = ultimasTransacoesCarregadas.find((t) => t.id === id);
  if (!transacao) return;
  const item = document.getElementById(`item-${id}`);
  item.outerHTML = renderItemTransacao(transacao, false);
}

async function salvarEdicaoTransacao(id) {
  const categoriaId = document.getElementById(`editCategoria-${id}`).value;
  const valor = parseFloat(document.getElementById(`editValor-${id}`).value);
  const descricao = document.getElementById(`editDescricao-${id}`).value || null;

  if (isNaN(valor) || valor <= 0) {
    if (tg && tg.showAlert) tg.showAlert('Valor inválido.'); else alert('Valor inválido.');
    return;
  }

  await supabaseClient.from('transacoes').update({ categoria_id: categoriaId, valor, descricao }).eq('id', id);
  if (tg) tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success');
  carregarTransacoes();
}

// ------------------------------------------------------------
// LANÇAMENTOS RECORRENTES
// ------------------------------------------------------------
let recorrenciaEditandoId = null;
let ultimasRecorrenciasCarregadas = [];

document.getElementById('segmentoTipoRecorrencia').addEventListener('click', (e) => {
  const botao = e.target.closest('.segment-btn');
  if (!botao) return;
  document.querySelectorAll('#segmentoTipoRecorrencia .segment-btn').forEach((b) => b.classList.toggle('ativo', b === botao));
  document.getElementById('tipoRecorrencia').value = botao.dataset.tipo;
  preencherSelectsCategoria();
});

document.getElementById('formRecorrencia').addEventListener('submit', async (e) => {
  e.preventDefault();
  const tipo = document.getElementById('tipoRecorrencia').value;
  const categoriaId = document.getElementById('categoriaRecorrencia').value;
  const valor = parseFloat(document.getElementById('valorRecorrencia').value);
  const diaDoMes = parseInt(document.getElementById('diaRecorrencia').value, 10);
  const descricao = document.getElementById('descricaoRecorrencia').value || null;

  if (recorrenciaEditandoId) {
    await supabaseClient
      .from('recorrencias')
      .update({ categoria_id: categoriaId, tipo, valor, dia_do_mes: diaDoMes, descricao })
      .eq('id', recorrenciaEditandoId);
  } else {
    await supabaseClient.from('recorrencias').insert({
      grupo_id: estado.grupoId,
      categoria_id: categoriaId,
      tipo,
      valor,
      dia_do_mes: diaDoMes,
      descricao,
    });
  }

  encerrarEdicaoRecorrencia();
  preencherSelectsCategoria();
  carregarRecorrencias();
});

document.getElementById('botaoCancelarEdicaoRecorrencia').addEventListener('click', () => {
  encerrarEdicaoRecorrencia();
});

function encerrarEdicaoRecorrencia() {
  recorrenciaEditandoId = null;
  document.getElementById('formRecorrencia').reset();
  document.getElementById('tipoRecorrencia').value = 'despesa';
  document.querySelectorAll('#segmentoTipoRecorrencia .segment-btn').forEach((b, i) => b.classList.toggle('ativo', i === 0));
  document.getElementById('botaoSubmitRecorrencia').textContent = 'Criar recorrência';
  document.getElementById('botaoCancelarEdicaoRecorrencia').hidden = true;
}

function editarRecorrencia(id) {
  const recorrencia = ultimasRecorrenciasCarregadas.find((r) => r.id === id);
  if (!recorrencia) return;

  recorrenciaEditandoId = id;
  document.getElementById('tipoRecorrencia').value = recorrencia.tipo;
  document.querySelectorAll('#segmentoTipoRecorrencia .segment-btn').forEach((b) => {
    b.classList.toggle('ativo', b.dataset.tipo === recorrencia.tipo);
  });
  preencherSelectsCategoria();
  document.getElementById('categoriaRecorrencia').value = recorrencia.categoria_id;
  document.getElementById('valorRecorrencia').value = recorrencia.valor;
  document.getElementById('diaRecorrencia').value = recorrencia.dia_do_mes;
  document.getElementById('descricaoRecorrencia').value = recorrencia.descricao || '';

  document.getElementById('botaoSubmitRecorrencia').textContent = 'Salvar alterações';
  document.getElementById('botaoCancelarEdicaoRecorrencia').hidden = false;
  document.getElementById('formRecorrencia').scrollIntoView({ behavior: 'smooth' });
}

async function carregarRecorrencias() {
  const { data: recorrencias } = await supabaseClient
    .from('recorrencias')
    .select('*, categorias(nome, icone)')
    .eq('grupo_id', estado.grupoId)
    .eq('ativo', true)
    .order('dia_do_mes');

  ultimasRecorrenciasCarregadas = recorrencias || [];

  const container = document.getElementById('listaRecorrencias');
  container.innerHTML = ultimasRecorrenciasCarregadas.length
    ? ultimasRecorrenciasCarregadas.map((r) => `
        <div class="item">
          <div class="item-principal">
            <div class="item-titulo">${r.categorias ? r.categorias.icone + ' ' + r.categorias.nome : ''}${r.descricao ? ' · ' + r.descricao : ''}</div>
            <div class="item-sub">todo dia ${r.dia_do_mes}</div>
          </div>
          <div class="item-valor ${r.tipo === 'receita' ? 'pos' : 'neg'}">${r.tipo === 'receita' ? '+' : '−'} ${formatarReais(r.valor)}</div>
          <div class="item-acoes">
            <button class="botao-icone" onclick="editarRecorrencia('${r.id}')" title="Editar">✎</button>
            <button class="botao-icone" onclick="excluirRecorrencia('${r.id}')" title="Excluir">✕</button>
          </div>
        </div>`).join('')
    : '<div class="vazio">Nenhum lançamento recorrente ainda.</div>';
}

async function excluirRecorrencia(id) {
  await supabaseClient.from('recorrencias').update({ ativo: false }).eq('id', id);
  if (recorrenciaEditandoId === id) encerrarEdicaoRecorrencia();
  carregarRecorrencias();
}

// ------------------------------------------------------------
// COMPRA PARCELADA
// ------------------------------------------------------------
document.getElementById('formParcelamento').addEventListener('submit', async (e) => {
  e.preventDefault();
  const categoriaId = document.getElementById('categoriaParcelamento').value;
  const valorTotal = parseFloat(document.getElementById('valorTotalParcelamento').value);
  const qtdParcelas = parseInt(document.getElementById('qtdParcelas').value, 10);
  const desconto = parseFloat(document.getElementById('descontoPrimeiraParcela').value) || 0;
  const descricaoBase = document.getElementById('descricaoParcelamento').value.trim();

  if (!valorTotal || !qtdParcelas || qtdParcelas < 1) return;

  const valorParcela = Math.round((valorTotal / qtdParcelas) * 100) / 100;
  const hoje = new Date();

  const linhas = [];
  for (let i = 0; i < qtdParcelas; i++) {
    const valor = i === 0 ? Math.max(Math.round((valorParcela - desconto) * 100) / 100, 0) : valorParcela;
    const data = new Date(hoje.getFullYear(), hoje.getMonth() + i, hoje.getDate());
    const descricaoParcela = `${descricaoBase ? descricaoBase + ' ' : ''}(parcela ${i + 1}/${qtdParcelas})`;

    linhas.push({
      grupo_id: estado.grupoId,
      usuario_id: estado.usuario.id,
      categoria_id: categoriaId,
      tipo: 'despesa',
      valor,
      descricao: descricaoParcela,
      data: data.toISOString().slice(0, 10),
      origem: 'miniapp',
    });
  }

  await supabaseClient.from('transacoes').insert(linhas);

  e.target.reset();
  if (tg) tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success');
  carregarTransacoes();
});

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

async function buscarMetasComProgresso(inicio, fim) {
  const inicioReal = inicio || inicioDoMes();
  const { data: metas } = await supabaseClient
    .from('metas')
    .select('*, categorias(nome, icone)')
    .eq('grupo_id', estado.grupoId)
    .eq('tipo', 'orcamento');

  let query = supabaseClient
    .from('transacoes')
    .select('valor, categoria_id')
    .eq('grupo_id', estado.grupoId)
    .eq('tipo', 'despesa')
    .gte('data', inicioReal);
  if (fim) query = query.lte('data', fim);
  const { data: transacoesMes } = await query;

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
function renderSeletorIcone() {
  const container = document.getElementById('seletorIcone');
  container.innerHTML = ICONES_DISPONIVEIS.map(
    (icone, i) => `<button type="button" class="icone-opcao${i === 0 ? ' selecionado' : ''}" data-icone="${icone}">${icone}</button>`
  ).join('');
}
renderSeletorIcone();

document.getElementById('seletorIcone').addEventListener('click', (e) => {
  const botao = e.target.closest('.icone-opcao');
  if (!botao) return;
  document.querySelectorAll('.icone-opcao').forEach((b) => b.classList.toggle('selecionado', b === botao));
  iconeSelecionado = botao.dataset.icone;
  document.getElementById('iconeCategoria').value = iconeSelecionado;
});

function renderSeletorCor() {
  const container = document.getElementById('seletorCor');
  container.innerHTML = CORES_PALETA.map(
    (cor, i) => `<button type="button" class="cor-opcao${i === 0 ? ' selecionado' : ''}" data-cor="${cor}" style="background:${cor}"></button>`
  ).join('');
}
renderSeletorCor();

document.getElementById('seletorCor').addEventListener('click', (e) => {
  const botao = e.target.closest('.cor-opcao');
  if (!botao) return;
  document.querySelectorAll('.cor-opcao').forEach((b) => b.classList.toggle('selecionado', b === botao));
  corSelecionada = botao.dataset.cor;
  document.getElementById('corCategoria').value = corSelecionada;
});

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
  const icone = document.getElementById('iconeCategoria').value || '🏷️';
  const cor = document.getElementById('corCategoria').value || CORES_PALETA[0];

  if (categoriaEditandoId) {
    await supabaseClient.from('categorias').update({ nome, tipo, cor, icone }).eq('id', categoriaEditandoId);
  } else {
    await supabaseClient.from('categorias').insert({ grupo_id: estado.grupoId, nome, tipo, cor, icone });
  }

  encerrarEdicaoCategoria();
  await carregarCategorias();
  carregarCategoriasView();
});

document.getElementById('botaoCancelarEdicaoCategoria').addEventListener('click', () => {
  encerrarEdicaoCategoria();
});

function encerrarEdicaoCategoria() {
  categoriaEditandoId = null;
  document.getElementById('formCategoria').reset();
  document.querySelectorAll('.icone-opcao').forEach((b, i) => b.classList.toggle('selecionado', i === 0));
  document.querySelectorAll('.cor-opcao').forEach((b, i) => b.classList.toggle('selecionado', i === 0));
  iconeSelecionado = ICONES_DISPONIVEIS[0];
  corSelecionada = CORES_PALETA[0];
  document.getElementById('iconeCategoria').value = iconeSelecionado;
  document.getElementById('corCategoria').value = corSelecionada;
  document.getElementById('botaoSubmitCategoria').textContent = 'Criar categoria';
  document.getElementById('botaoCancelarEdicaoCategoria').hidden = true;
}

function editarCategoria(id) {
  const categoria = estado.categorias.find((c) => c.id === id);
  if (!categoria) return;

  categoriaEditandoId = id;
  document.getElementById('nomeCategoria').value = categoria.nome;
  document.getElementById('tipoCategoria').value = categoria.tipo;
  document.querySelectorAll('#segmentoTipoCategoria .segment-btn').forEach((b) => {
    b.classList.toggle('ativo', b.dataset.tipo === categoria.tipo);
  });

  iconeSelecionado = categoria.icone;
  document.getElementById('iconeCategoria').value = categoria.icone;
  document.querySelectorAll('.icone-opcao').forEach((b) => b.classList.toggle('selecionado', b.dataset.icone === categoria.icone));

  corSelecionada = categoria.cor;
  document.getElementById('corCategoria').value = categoria.cor;
  document.querySelectorAll('.cor-opcao').forEach((b) => b.classList.toggle('selecionado', b.dataset.cor === categoria.cor));

  document.getElementById('botaoSubmitCategoria').textContent = 'Salvar alterações';
  document.getElementById('botaoCancelarEdicaoCategoria').hidden = false;
  document.getElementById('formCategoria').scrollIntoView({ behavior: 'smooth' });
}

function carregarCategoriasView() {
  const despesas = estado.categorias.filter((c) => c.tipo === 'despesa');
  const receitas = estado.categorias.filter((c) => c.tipo === 'receita');
  const chip = (c) => `
    <div class="chip" style="border-left:4px solid ${c.cor}">
      <span>${c.icone} ${c.nome}</span>
      <button type="button" class="chip-remover" onclick="editarCategoria('${c.id}')" title="Editar">✎</button>
      <button type="button" class="chip-remover" onclick="excluirCategoria('${c.id}')" title="Excluir">✕</button>
    </div>`;

  document.getElementById('listaCategoriasDespesa').innerHTML = despesas.map(chip).join('') || '<div class="vazio">Nenhuma.</div>';
  document.getElementById('listaCategoriasReceita').innerHTML = receitas.map(chip).join('') || '<div class="vazio">Nenhuma.</div>';
}

async function excluirCategoria(id) {
  await supabaseClient.from('categorias').delete().eq('id', id);
  if (categoriaEditandoId === id) encerrarEdicaoCategoria();
  await carregarCategorias();
  carregarCategoriasView();
}

// ------------------------------------------------------------
// Inicialização
// ------------------------------------------------------------
(async function iniciar() {
  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  document.getElementById('filtroMes').value = mesAtual;
  document.getElementById('filtroMesTransacoes').value = mesAtual;

  const ok = await carregarUsuario();
  if (!ok) return;
  await carregarCategorias();
  await carregarPainel();
})();
