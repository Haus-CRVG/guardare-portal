// ---------- Conexão com o Supabase ----------
const SUPABASE_URL = 'https://kelbiyyxvbecukeelfrf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6pWRhZzU2D2QF74FsnYItA_4s9b--38';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let meuCliente = null;
let meusPerfis = [];
let chamadoAtualId = null;
let chamados = [];

// ---------- Utilitários ----------
function formatarData(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('pt-BR');
}
function formatarDataHora(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('pt-BR');
}
function calcularVencimento(referencia, dia) {
    if (!referencia) return '-';
    const [mes, ano] = referencia.split('/');
    const diaFmt = String(dia || 10).padStart(2, '0');
    return `${diaFmt}/${mes}/${ano}`;
}
function mostrarTela(id) {
    ['view-login', 'view-carregando', 'view-mensagem', 'tela-aceite', 'app-portal'].forEach(v => {
        document.getElementById(v).style.display = 'none';
    });
    const el = document.getElementById(id);
    el.style.display = (id === 'app-portal') ? 'flex' : (id === 'tela-aceite' ? 'block' : 'flex');
}

// ---------- Sessão / Login ----------
async function verificarSessao() {
    mostrarTela('view-carregando');
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
        mostrarTela('view-login');
        return;
    }
    await carregarMeuCliente(session.user.id);
}

async function fazerLogin() {
    const email = document.getElementById('login-email').value.trim();
    const senha = document.getElementById('login-senha').value;
    const erroEl = document.getElementById('login-erro');
    erroEl.style.display = 'none';

    if (!email || !senha) {
        erroEl.textContent = 'Preencha e-mail e senha.';
        erroEl.style.display = 'block';
        return;
    }

    const { error } = await db.auth.signInWithPassword({ email, password: senha });
    if (error) {
        erroEl.textContent = 'E-mail ou senha inválidos.';
        erroEl.style.display = 'block';
        return;
    }
    verificarSessao();
}

async function fazerLogout() {
    await db.auth.signOut();
    meuCliente = null;
    mostrarTela('view-login');
}

// ---------- Carregar dados do cliente logado ----------
async function carregarMeuCliente(userId) {
    const { data, error } = await db.from('clientes').select('*').eq('auth_user_id', userId).single();
    if (error || !data) {
        mostrarMensagem('Não encontramos um cadastro vinculado a este acesso. Entre em contato com o suporte.');
        return;
    }
    meuCliente = data;

    if (meuCliente.status === 'cancelado') {
        mostrarMensagem('Seu contrato está cancelado. Entre em contato com o suporte se isso não estiver correto.');
        return;
    }
    if (meuCliente.status === 'lead') {
        mostrarMensagem('Seu contrato ainda está em preparação. Em breve você receberá o link de aceite.');
        return;
    }

    const { data: perfisData } = await db.from('perfis_backup').select('*').eq('cliente_id', meuCliente.id).order('criado_em', { ascending: true });
    meusPerfis = perfisData || [];

    if (meuCliente.status === 'aguardando') {
        iniciarAceite();
        return;
    }

    // status === 'ativo'
    abrirPortal();
}

function mostrarMensagem(texto) {
    document.getElementById('mensagem-texto').textContent = texto;
    mostrarTela('view-mensagem');
}

// ---------- Fluxo de aceite ----------
function iniciarAceite() {
    document.getElementById('aceite-dados-grid').innerHTML = `
        <div class="info-item"><label>Contratante</label><div>${meuCliente.razao_social}</div></div>
        <div class="info-item"><label>CNPJ</label><div>${meuCliente.cnpj_cpf}</div></div>
        <div class="info-item"><label>Plano</label><div>${meuCliente.plano_nome || '-'}</div></div>
        <div class="info-item"><label>Recorrência</label><div>R$ ${(parseFloat(meuCliente.plano_valor) || 0).toFixed(2)} / ${meuCliente.plano_ciclo}</div></div>
        <div class="info-item"><label>Responsável</label><div>${meuCliente.nome_proprietario || '-'}</div></div>
        <div class="info-item"><label>E-mail</label><div>${meuCliente.email}</div></div>
    `;

    document.getElementById('aceite-perfis-lista').innerHTML = meusPerfis.map(p => `
        <div class="backup-card">
            <strong>${p.nome}</strong>
            <div class="meta">${p.nome_maquina} · ${p.sistema_operacional} · ${p.tipo_backup === 'banco' ? 'Banco de Dados (' + (p.banco_dados || '') + ')' : 'Arquivos/Pastas'} · Retenção ${p.dias_retencao}</div>
        </div>
    `).join('') || '<p style="color:var(--muted); font-size:14px;">Nenhum perfil de backup cadastrado ainda.</p>';

    document.getElementById('prog-1').classList.remove('done');
    document.getElementById('prog-2').classList.remove('done');
    document.getElementById('prog-3').classList.remove('done');
    document.getElementById('aceite-passo-1').style.display = 'block';
    document.getElementById('aceite-passo-2').style.display = 'none';
    document.getElementById('aceite-passo-3').style.display = 'none';

    mostrarTela('tela-aceite');
}

function avancarAceite(passoAtual) {
    if (passoAtual === 1 && !document.getElementById('chk-termos').checked) {
        alert("Você precisa aceitar os termos para continuar.");
        return;
    }
    if (passoAtual === 2 && !document.getElementById('chk-tecnicos').checked) {
        alert("Confirme os dados técnicos para continuar.");
        return;
    }
    document.getElementById('aceite-passo-' + passoAtual).style.display = 'none';
    document.getElementById('aceite-passo-' + (passoAtual + 1)).style.display = 'block';
    document.getElementById('prog-' + passoAtual).classList.add('done');
}

async function concluirAceite() {
    const senha = document.getElementById('nova-senha').value;
    const confirma = document.getElementById('confirma-senha').value;
    const erroEl = document.getElementById('aceite-erro');
    erroEl.style.display = 'none';

    if (!senha || senha.length < 6) {
        erroEl.textContent = 'A senha deve ter pelo menos 6 caracteres.';
        erroEl.style.display = 'block';
        return;
    }
    if (senha !== confirma) {
        erroEl.textContent = 'As senhas não coincidem.';
        erroEl.style.display = 'block';
        return;
    }

    const { error: e1 } = await db.auth.updateUser({ password: senha });
    if (e1) {
        erroEl.textContent = 'Erro ao definir senha: ' + e1.message;
        erroEl.style.display = 'block';
        return;
    }

    const { error: e2 } = await db.from('clientes').update({ status: 'ativo' }).eq('id', meuCliente.id);
    if (e2) {
        erroEl.textContent = 'Senha definida, mas houve um erro ao ativar o contrato: ' + e2.message;
        erroEl.style.display = 'block';
        return;
    }

    document.getElementById('prog-3').classList.add('done');
    meuCliente.status = 'ativo';
    abrirPortal();
}

// ---------- Portal principal ----------
function abrirPortal() {
    document.getElementById('user-box-email').textContent = meuCliente.email;
    renderContrato();
    renderBackups();
    renderFinanceiro();
    carregarBadgeChamadosInicial();
    mudarPagina('contrato');
    mostrarTela('app-portal');
}

async function carregarBadgeChamadosInicial() {
    const { data } = await db.from('chamados').select('*, mensagens_chamado(*)').eq('cliente_id', meuCliente.id);
    const badge = document.getElementById('badge-chamados-cliente');
    const qtd = (data || []).filter(chamadoClienteTemNaoLida).length;
    if (qtd > 0) { badge.textContent = qtd; badge.style.display = 'inline-block'; }
}

function mudarPagina(tab) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.tab === tab));
    ['contrato', 'backups', 'chamados', 'financeiro', 'alertas'].forEach(t => {
        document.getElementById('pagina-' + t).style.display = (t === tab) ? 'block' : 'none';
    });
    if (tab === 'chamados') { voltarListaChamados(); carregarChamados(); }
    fecharMenuMobile();
}

function alternarMenuMobile() {
    document.getElementById('sidebar').classList.toggle('aberta');
    document.getElementById('sidebar-overlay').classList.toggle('ativo');
}

function fecharMenuMobile() {
    document.getElementById('sidebar').classList.remove('aberta');
    document.getElementById('sidebar-overlay').classList.remove('ativo');
}

// ---------- Meu Contrato ----------
function renderContrato() {
    const statusLabel = { ativo: 'Ativo', aguardando: 'Aguardando Aceite', cancelado: 'Cancelado', lead: 'Lead' };
    document.getElementById('contrato-status-linha').innerHTML = `Status: <strong>${statusLabel[meuCliente.status] || meuCliente.status}</strong>`;

    document.getElementById('contrato-servico-grid').innerHTML = `
        <div class="info-item"><label>Plano</label><div>${meuCliente.plano_nome || '-'}</div></div>
        <div class="info-item"><label>Ciclo</label><div>${meuCliente.plano_ciclo || '-'}</div></div>
        <div class="info-item"><label>Recorrência</label><div>R$ ${(parseFloat(meuCliente.plano_valor) || 0).toFixed(2)}</div></div>
        <div class="info-item"><label>Dia de Vencimento</label><div>${meuCliente.plano_dia_vencimento || '-'}</div></div>
    `;

    document.getElementById('contrato-contratante-grid').innerHTML = `
        <div class="info-item"><label>Razão Social</label><div>${meuCliente.razao_social}</div></div>
        <div class="info-item"><label>CNPJ</label><div>${meuCliente.cnpj_cpf}</div></div>
        <div class="info-item"><label>Endereço</label><div>${meuCliente.endereco || '-'}</div></div>
        <div class="info-item"><label>E-mail</label><div>${meuCliente.email}</div></div>
        <div class="info-item"><label>Telefone</label><div>${meuCliente.telefone || '-'}</div></div>
        <div class="info-item"><label>Celular</label><div>${meuCliente.celular || '-'}</div></div>
    `;

    document.getElementById('contrato-responsavel-grid').innerHTML = `
        <div class="info-item"><label>Nome</label><div>${meuCliente.nome_proprietario || '-'}</div></div>
        <div class="info-item"><label>Telefone do Responsável</label><div>${meuCliente.telefone_responsavel || '-'}</div></div>
    `;
}

// ---------- Meus Backups ----------
function renderBackups() {
    const lista = document.getElementById('backups-lista');
    if (meusPerfis.length === 0) {
        lista.innerHTML = '<div class="empty-state"><p>Nenhum perfil de backup cadastrado ainda.</p></div>';
        return;
    }
    lista.innerHTML = meusPerfis.map(p => `
        <div class="backup-card">
            <strong>${p.nome}</strong>
            <div class="meta">
                Máquina: ${p.nome_maquina} · SO: ${p.sistema_operacional} · Tipo: ${p.tipo_backup === 'banco' ? 'Banco de Dados (' + (p.banco_dados || '') + ')' : 'Arquivos/Pastas'}<br>
                Retenção: ${p.dias_retencao} · Dias: ${(p.dias_semana || []).join(', ')} · Horários: ${p.horarios_inicio}
            </div>
        </div>
    `).join('');
}

// ---------- Meu Financeiro ----------
async function renderFinanceiro() {
    const { data, error } = await db.from('faturas').select('*').eq('cliente_id', meuCliente.id).order('criado_em', { ascending: false });
    const tbody = document.getElementById('tbody-financeiro');
    if (error) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--muted); padding:30px;">Erro ao carregar faturas.</td></tr>`;
        console.error(error);
        return;
    }
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--muted); padding:30px;">Nenhuma fatura ainda.</td></tr>`;
        return;
    }
    const statusLabel = { aberto: 'Em Aberto', pago: 'Pago', atrasado: 'Atrasado' };
    const statusClass = { aberto: 'status-aberto', pago: 'status-pago', atrasado: 'status-atrasado' };
    tbody.innerHTML = data.map(f => `
        <tr>
            <td>${f.referencia}</td>
            <td>R$ ${parseFloat(f.valor).toFixed(2)}</td>
            <td>${calcularVencimento(f.referencia, meuCliente.plano_dia_vencimento)}</td>
            <td><span class="status ${statusClass[f.status] || ''}">${statusLabel[f.status] || f.status}</span></td>
            <td><button class="btn-secondary" onclick="alert('Em breve: baixar a 2ª via do boleto por aqui.')">📎 2ª via</button></td>
        </tr>
    `).join('');
}

// ---------- Meus Chamados ----------
const statusChamadoLabel = { aberto: "Aberto", andamento: "Em Andamento", resolvido: "Resolvido" };
const statusChamadoClass = { aberto: "status-aberto", andamento: "status-andamento", resolvido: "status-resolvido" };
let filtroChamadoAtual = 'ativos';
let ultimoTotalNaoLidas = 0;

function tocarSom() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = 'sine';
        o.frequency.value = 740;
        g.gain.setValueAtTime(0.001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        o.start();
        o.stop(ctx.currentTime + 0.35);
    } catch (e) { /* navegador sem suporte a áudio, ignora */ }
}

function filtrarChamados(filtro) {
    filtroChamadoAtual = filtro;
    document.getElementById('filtro-ativos').classList.toggle('ativo', filtro === 'ativos');
    document.getElementById('filtro-concluidos').classList.toggle('ativo', filtro === 'concluidos');
    renderListaChamados();
}

function chamadoClienteTemNaoLida(ch) {
    const msgsSuporte = (ch.mensagens_chamado || []).filter(m => m.autor_tipo === 'suporte');
    if (msgsSuporte.length === 0) return false;
    const ultimaData = msgsSuporte.reduce((max, m) => m.criado_em > max ? m.criado_em : max, msgsSuporte[0].criado_em);
    if (!ch.cliente_visto_em) return true;
    return ultimaData > ch.cliente_visto_em;
}

async function carregarChamados() {
    const { data, error } = await db.from('chamados').select('*, mensagens_chamado(*)').eq('cliente_id', meuCliente.id).order('criado_em', { ascending: false });
    const tbody = document.getElementById('tbody-chamados');
    if (error) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--muted); padding:30px;">Erro ao carregar chamados.</td></tr>`;
        console.error(error);
        return;
    }
    chamados = data || [];

    const badge = document.getElementById('badge-chamados-cliente');
    const qtdNaoLidas = chamados.filter(chamadoClienteTemNaoLida).length;
    if (qtdNaoLidas > ultimoTotalNaoLidas) tocarSom();
    ultimoTotalNaoLidas = qtdNaoLidas;
    if (qtdNaoLidas > 0) {
        badge.textContent = qtdNaoLidas;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }

    renderListaChamados();
}

function renderListaChamados() {
    const tbody = document.getElementById('tbody-chamados');
    const filtrados = chamados.filter(ch => filtroChamadoAtual === 'concluidos' ? ch.status === 'resolvido' : ch.status !== 'resolvido');

    if (filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--muted); padding:30px;">Nenhum chamado ${filtroChamadoAtual === 'concluidos' ? 'concluído' : 'ativo'}.</td></tr>`;
        return;
    }
    tbody.innerHTML = filtrados.map(ch => `
        <tr class="chamado-row" onclick="abrirChamado('${ch.id}')">
            <td>${ch.assunto}${chamadoClienteTemNaoLida(ch) ? '<span class="dot-nao-lida"></span>' : ''}</td>
            <td>${ch.categoria}</td>
            <td><span class="status ${statusChamadoClass[ch.status]}">${statusChamadoLabel[ch.status]}</span></td>
            <td>${formatarData(ch.criado_em)}</td>
        </tr>
    `).join('');
}

async function abrirChamado(id) {
    chamadoAtualId = id;
    document.getElementById('chamados-lista-view').style.display = 'none';
    document.getElementById('chamado-detalhe-view').style.display = 'block';

    // Marca como visto e já atualiza o badge/lista em segundo plano
    await db.from('chamados').update({ cliente_visto_em: new Date().toISOString() }).eq('id', id);

    await renderChamadoDetalhe();
    await carregarChamados();
}

function voltarListaChamados() {
    chamadoAtualId = null;
    document.getElementById('chamado-detalhe-view').style.display = 'none';
    document.getElementById('chamados-lista-view').style.display = 'block';
}

async function renderChamadoDetalhe() {
    const ch = chamados.find(c => c.id === chamadoAtualId);
    document.getElementById('chamado-detalhe-titulo').textContent = ch.assunto;
    document.getElementById('chamado-detalhe-meta').innerHTML = ch.categoria + " · <span class='status " + statusChamadoClass[ch.status] + "'>" + statusChamadoLabel[ch.status] + "</span>";

    const inputEl = document.getElementById('chat-input-texto');
    const botaoEnviar = document.querySelector('#chamado-detalhe-view .chat-input .btn-primary');
    const resolvido = ch.status === 'resolvido';
    inputEl.disabled = resolvido;
    botaoEnviar.disabled = resolvido;
    inputEl.placeholder = resolvido ? 'Este chamado foi concluído. Abra um novo chamado se precisar de algo.' : 'Escreva uma mensagem...';

    const { data, error } = await db.from('mensagens_chamado').select('*').eq('chamado_id', chamadoAtualId).order('criado_em', { ascending: true });
    const thread = document.getElementById('chat-thread');
    if (error) {
        thread.innerHTML = '<p style="color:var(--muted);">Erro ao carregar mensagens.</p>';
        console.error(error);
        return;
    }
    thread.innerHTML = (data || []).map(m => `
        <div class="msg ${m.autor_tipo === 'cliente' ? 'msg-cliente' : 'msg-suporte'}">
            ${m.texto}
            <div class="msg-meta">${m.autor_tipo === 'cliente' ? 'Você' : (m.autor_nome || 'Suporte')} · ${formatarDataHora(m.criado_em)}</div>
        </div>
    `).join('');
    thread.scrollTop = thread.scrollHeight;
}

async function enviarMensagemChamado() {
    const texto = document.getElementById('chat-input-texto').value.trim();
    if (!texto) return;

    const { error } = await db.from('mensagens_chamado').insert({
        chamado_id: chamadoAtualId, autor_tipo: 'cliente', autor_nome: meuCliente.nome_proprietario || meuCliente.razao_social, texto
    });
    if (error) {
        alert('Erro ao enviar mensagem: ' + error.message);
        console.error(error);
        return;
    }
    document.getElementById('chat-input-texto').value = '';
    tocarSom();
    await renderChamadoDetalhe();
}

function abrirModalChamado() {
    document.getElementById('modal-chamado').style.display = 'flex';
}
function fecharModalChamado() {
    document.getElementById('modal-chamado').style.display = 'none';
}

async function criarChamado() {
    const categoria = document.getElementById('ch-categoria').value;
    const assunto = document.getElementById('ch-assunto').value.trim();
    const descricao = document.getElementById('ch-descricao').value.trim();
    if (!assunto || !descricao) {
        alert("Preencha o assunto e a descrição.");
        return;
    }

    const { data, error } = await db.from('chamados').insert({
        cliente_id: meuCliente.id, assunto, categoria, status: 'aberto'
    }).select().single();
    if (error) {
        alert('Erro ao abrir chamado: ' + error.message);
        console.error(error);
        return;
    }

    const { error: e2 } = await db.from('mensagens_chamado').insert({
        chamado_id: data.id, autor_tipo: 'cliente', autor_nome: meuCliente.nome_proprietario || meuCliente.razao_social, texto: descricao
    });
    if (e2) console.error(e2);

    document.getElementById('ch-assunto').value = '';
    document.getElementById('ch-descricao').value = '';
    fecharModalChamado();
    await carregarChamados();
}

// ---------- Init ----------
verificarSessao();
