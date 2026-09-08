/**
 * Painel de controle da extensão Máquina de Vagas.
 * Mostra a página em foco e registra cada etapa no terminal de atividade.
 */

const apiUrlInput = document.getElementById('apiUrl');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const resultNameEl = document.getElementById('resultName');
const pageTitleEl = document.getElementById('pageTitle');
const pageHostEl = document.getElementById('pageHost');
const targetCardEl = document.getElementById('targetCard');
const connectionBadgeEl = document.getElementById('connectionBadge');
const activityLogEl = document.getElementById('activityLog');
const terminalStateEl = document.getElementById('terminalState');
let lastCv = null;

/**
 * Paginação do PDF do currículo — enviada ao Hermes em POST /cv.
 * O servidor injeta essas regras no CSS de impressão do template, para que a
 * quebra de página caia entre os blocos (cards de experiência, formação,
 * idiomas) em vez de cortá-los ao meio.
 */
const CV_PAGINACAO = {
  formato: 'Letter',            // 'Letter' | 'A4'
  margem_topo: '0.35in',
  margem_lateral: '0.4in',
  margem_rodape: '0.35in',
  quebrar_blocos: true,         // false = corte livre (comportamento antigo)
  evitar_quebra_em: []          // seletores extras que não podem ser partidos
};

// ─── feedback de atividade ──────────────────────────────
function formatTime(date = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(date);
}

function setTerminalState(state = 'idle') {
  const labels = {
    idle: 'em espera',
    working: 'em andamento',
    success: 'concluído',
    error: 'atenção necessária'
  };
  terminalStateEl.dataset.state = state;
  terminalStateEl.textContent = labels[state] || labels.idle;
}

function addActivity(message, tone = 'info') {
  if (!message) return;

  const entry = document.createElement('div');
  entry.className = 'terminal-entry';
  entry.dataset.tone = tone;

  const time = document.createElement('time');
  time.dateTime = new Date().toISOString();
  time.textContent = formatTime();

  const text = document.createElement('span');
  text.textContent = String(message);
  entry.append(time, text);
  activityLogEl.appendChild(entry);

  while (activityLogEl.children.length > 30) {
    activityLogEl.firstElementChild.remove();
  }
  activityLogEl.scrollTop = activityLogEl.scrollHeight;
}

function setStatus(message, type = 'info') {
  statusEl.hidden = false;
  statusEl.className = `status status-${type}`;
  statusEl.textContent = message;
  addActivity(message, type);
  setTerminalState(type === 'info' ? 'working' : type);
}

function setConnectionState(state, label) {
  connectionBadgeEl.dataset.state = state;
  connectionBadgeEl.textContent = label;
}

function setActionBusy(button, busy) {
  const label = button.querySelector('.button-label');
  const buttons = document.querySelectorAll('[data-action]');

  if (busy) {
    buttons.forEach((actionButton) => { actionButton.disabled = true; });
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    if (label) {
      button.dataset.originalLabel = label.textContent;
      label.textContent = button.dataset.loadingLabel || 'Processando…';
    }
    targetCardEl.classList.add('is-analyzing');
    setTerminalState('working');
    return;
  }

  buttons.forEach((actionButton) => { actionButton.disabled = false; });
  button.classList.remove('is-loading');
  button.removeAttribute('aria-busy');
  if (label && button.dataset.originalLabel) {
    label.textContent = button.dataset.originalLabel;
    delete button.dataset.originalLabel;
  }
  targetCardEl.classList.remove('is-analyzing');
}

async function runAction(button, operation) {
  setActionBusy(button, true);
  try {
    await operation();
  } catch (err) {
    console.error('Falha no painel da extensão:', err);
    setStatus(`Não foi possível concluir a ação: ${err.message || 'erro inesperado'}.`, 'error');
  } finally {
    setActionBusy(button, false);
  }
}

// ─── página em foco ─────────────────────────────────────
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function getPageHost(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname || parsed.protocol.replace(':', '');
  } catch (_) {
    return 'Página sem URL disponível';
  }
}

async function refreshPageTarget({ announce = false } = {}) {
  const tab = await getActiveTab();
  if (!tab) {
    pageTitleEl.textContent = 'Nenhuma página em foco';
    pageHostEl.textContent = 'Selecione uma aba para continuar';
    return null;
  }

  const title = tab.title || 'Página sem título';
  const host = getPageHost(tab.url || '');
  pageTitleEl.textContent = title;
  pageHostEl.textContent = host;
  if (announce) addActivity(`Página em foco atualizada: ${title} (${host}).`, 'info');
  return tab;
}

// ─── comunicação com extensão ───────────────────────────
function sendToBackground(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function sendToTab(tabId, message, frameId) {
  return new Promise((resolve) => {
    const options = Number.isInteger(frameId) ? { frameId } : undefined;
    const callback = (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    };
    if (options) chrome.tabs.sendMessage(tabId, message, options, callback);
    else chrome.tabs.sendMessage(tabId, message, callback);
  });
}

async function getTabFrames(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    return frames && frames.length ? frames : [{ frameId: 0 }];
  } catch (err) {
    console.warn('Não foi possível listar os frames da aba:', err);
    return [{ frameId: 0 }];
  }
}

async function scanFormInAllFrames(tabId) {
  const frames = await getTabFrames(tabId);
  const scans = await Promise.all(frames.map(async ({ frameId }) => ({
    frameId,
    response: await sendToTab(tabId, { type: 'GET_FORM_FIELDS' }, frameId)
  })));

  const fields = [];
  let contexto = '';
  let idioma = 'pt';
  for (const { frameId, response } of scans) {
    if (!response || !response.success) continue;
    if (frameId === 0) {
      contexto = response.contexto || '';
      idioma = response.idioma || 'pt';
    }
    for (const field of response.fields || []) {
      fields.push({
        ...field,
        id: `frame-${frameId}--${field.id}`,
        elementId: field.id,
        frameId
      });
    }
  }

  return { fields, contexto, idioma };
}

async function ensureContentScript(tabId) {
  const frames = await getTabFrames(tabId);
  const pings = await Promise.all(frames.map(async ({ frameId }) => ({
    frameId,
    response: await sendToTab(tabId, { type: 'PING' }, frameId)
  })));
  const missingFrames = pings.filter(({ response }) => !(response && response.success));

  await Promise.all(missingFrames.map(async ({ frameId }) => {
    try {
      const target = { tabId, frameIds: [frameId] };
      await chrome.scripting.executeScript({
        target,
        files: ['utils/dom-parser.js', 'utils/form-filler.js', 'content.js']
      });
      await chrome.scripting.insertCSS({ target, files: ['styles/content.css'] });
    } catch (err) {
      console.warn(`Falha ao injetar content script no frame ${frameId}:`, err);
    }
  }));

  const topFrame = await sendToTab(tabId, { type: 'PING' }, 0);
  return !!(topFrame && topFrame.success);
}

async function extractJobInfo(tabId) {
  await ensureContentScript(tabId);
  const res = await sendToTab(tabId, { type: 'EXTRACT_JOB_INFO' });
  if (res && res.success) return res;
  const tab = await chrome.tabs.get(tabId);
  return {
    success: true, titulo: tab.title, empresa: '', local: '', url: tab.url,
    observacoes: '', descricao: '', requisitos: '', pagina: '', skills: [],
    fonte: 'título da aba'
  };
}

/**
 * Texto da vaga enviado ao Hermes em POST /cv — é ele que o cvgen usa para
 * ranquear skills e bullets, então vai a descrição inteira, não só o resumo.
 */
function buildVagaTexto(info) {
  const partes = [
    info.titulo && `Cargo: ${info.titulo}`,
    info.empresa && `Empresa: ${info.empresa}`,
    info.local && `Local: ${info.local}`,
    info.url && `URL: ${info.url}`,
    info.skills && info.skills.length && `Skills exigidas: ${info.skills.join(', ')}`,
    info.requisitos && `Requisitos e responsabilidades:\n${info.requisitos}`,
    info.descricao && `Descrição da vaga:\n${info.descricao}`,
    !info.descricao && info.observacoes
  ].filter(Boolean);
  return partes.join('\n\n').slice(0, 24000);
}

// ─── configurações ──────────────────────────────────────
async function loadConfig() {
  const { apiUrl } = await chrome.storage.local.get(['apiUrl']);
  apiUrlInput.value = apiUrl || 'http://127.0.0.1:8790';
}

apiUrlInput.addEventListener('change', async () => {
  await chrome.storage.local.set({ apiUrl: apiUrlInput.value.trim() });
  setConnectionState('idle', 'API não testada');
  addActivity('Endereço do servidor Hermes atualizado.', 'info');
});

// ─── ações ──────────────────────────────────────────────
document.getElementById('btnRefreshPage').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await refreshPageTarget({ announce: true });
  } finally {
    button.disabled = false;
  }
});

document.getElementById('btnTest').addEventListener('click', (event) => runAction(event.currentTarget, async () => {
  setStatus('Testando a conexão com o servidor Hermes…', 'info');
  const res = await sendToBackground({
    type: 'TEST_CONNECTIONS',
    payload: { apiUrl: apiUrlInput.value.trim() }
  });
  if (res && res.success) {
    setConnectionState('success', 'API conectada');
    setStatus('Conexão com o Hermes confirmada.', 'success');
  } else {
    setConnectionState('error', 'Falha na API');
    setStatus((res && res.error) || 'Não foi possível conectar ao Hermes. Verifique o endereço do servidor.', 'error');
  }
}));

document.getElementById('btnAutofill').addEventListener('click', (event) => runAction(event.currentTarget, async () => {
  const tab = await refreshPageTarget();
  if (!tab) return setStatus('Nenhuma aba ativa foi encontrada.', 'error');

  setStatus(`Preparando a análise de “${tab.title || 'página em foco'}”…`, 'info');
  if (!(await ensureContentScript(tab.id))) {
    return setStatus('Não foi possível acessar esta página. Tente recarregá-la e execute novamente.', 'error');
  }

  setStatus('Reanalisando a página, modais abertos e frames acessíveis…', 'info');
  const fieldsRes = await scanFormInAllFrames(tab.id);
  if (!fieldsRes.fields.length) {
    return setStatus('Nenhum campo preenchível foi encontrado nesta página ou modal aberto.', 'error');
  }

  const porTipo = fieldsRes.fields.reduce((acc, field) => {
    acc[field.type] = (acc[field.type] || 0) + 1;
    return acc;
  }, {});
  const resumoTipos = Object.entries(porTipo).map(([tipo, total]) => `${total} ${tipo}`).join(', ');
  addActivity(`${fieldsRes.fields.length} campo(s) encontrado(s) (${resumoTipos}); consultando respostas salvas.`, 'info');
  setStatus('Consultando o Hermes e preparando as respostas…', 'info');
  const fillRes = await sendToBackground({
    type: 'AUTOFILL_FIELDS',
    payload: {
      fields: fieldsRes.fields,
      contexto: fieldsRes.contexto || '',
      idioma: fieldsRes.idioma || 'pt'
    }
  });
  if (!fillRes || !fillRes.success) {
    return setStatus((fillRes && fillRes.error) || 'Falha ao preparar o preenchimento.', 'error');
  }

  const targets = new Map(fieldsRes.fields.map((field) => [field.id, field]));
  const resultsByFrame = new Map();
  for (const result of fillRes.results || []) {
    const target = targets.get(result.fieldId);
    if (!target) continue;
    const frameResults = resultsByFrame.get(target.frameId) || [];
    frameResults.push({ ...result, fieldId: target.elementId });
    resultsByFrame.set(target.frameId, frameResults);
  }

  setStatus('Aplicando respostas nos campos encontrados…', 'info');
  const frameResponses = await Promise.all([...resultsByFrame.entries()].map(([frameId, results]) =>
    sendToTab(tab.id, { type: 'AUTOFILL_FORM', payload: { results } }, frameId)
  ));
  const filledCount = frameResponses.reduce((total, response) => total + (response && response.filledCount || 0), 0);
  const falhas = frameResponses.flatMap((response) => (response && response.failed) || []);
  const apiLog = (fillRes.debugLogs || []).join(' ');
  if (apiLog) addActivity(apiLog, 'info');

  for (const falha of falhas.slice(0, 8)) {
    addActivity(`Não aplicado — ${falha.question || 'campo'}: ${falha.reason}.`, 'info');
  }
  if (falhas.length > 8) {
    addActivity(`…e mais ${falhas.length - 8} campo(s) para revisar manualmente.`, 'info');
  }

  if (!resultsByFrame.size) {
    return setStatus('Análise concluída, mas não há respostas disponíveis para estes campos.', 'success');
  }
  setStatus(
    `Preenchimento concluído: ${filledCount} campo(s) aplicado(s)` +
    `${falhas.length ? `, ${falhas.length} para revisar` : ''}.`,
    falhas.length && !filledCount ? 'error' : 'success'
  );
}));

document.getElementById('btnCapture').addEventListener('click', (event) => runAction(event.currentTarget, async () => {
  const tab = await refreshPageTarget();
  if (!tab) return setStatus('Nenhuma aba ativa foi encontrada.', 'error');

  setStatus('Lendo os dados da vaga na página em foco…', 'info');
  const info = await extractJobInfo(tab.id);
  addActivity(`Vaga identificada: ${info.titulo || 'sem título informado'}.`, 'info');
  setStatus('Registrando a vaga no banco…', 'info');
  const res = await sendToBackground({
    type: 'CAPTURE_VAGA',
    payload: {
      titulo: info.titulo,
      empresa: info.empresa,
      local: info.local,
      url: info.url,
      observacoes: info.observacoes
    }
  });
  if (res && res.success) {
    setStatus(`Vaga registrada no banco. Total atual: ${res.data.banco_total}.`, 'success');
  } else {
    setStatus((res && res.error) || 'Não foi possível registrar esta vaga.', 'error');
  }
}));

document.getElementById('btnCv').addEventListener('click', (event) => runAction(event.currentTarget, async () => {
  const tab = await refreshPageTarget();
  if (!tab) return setStatus('Nenhuma aba ativa foi encontrada.', 'error');

  setStatus('Lendo os requisitos da vaga para gerar o currículo…', 'info');
  const info = await extractJobInfo(tab.id);
  const vagaTexto = buildVagaTexto(info);
  const totalTexto = vagaTexto.length + (info.pagina || '').length;
  addActivity(
    `Conteúdo enviado ao Hermes: ${totalTexto} caracteres ` +
    `(trecho principal via ${info.fonte || 'metadados'}` +
    `${info.skills && info.skills.length ? `, ${info.skills.length} skill(s) declarada(s)` : ''}).`,
    totalTexto < 600 ? 'info' : 'success'
  );
  if (totalTexto < 600) {
    addActivity('Pouco texto na página — a personalização tende a ficar genérica. Abra a descrição completa da vaga e reanalise.', 'info');
  }
  setStatus('Gerando um currículo personalizado…', 'info');
  const res = await sendToBackground({
    type: 'GENERATE_CV',
    payload: {
      vaga: vagaTexto,
      idioma: 'pt',
      empresa: info.empresa,
      cargo: info.titulo,
      url: info.url,
      descricao: info.descricao,
      requisitos: info.requisitos,
      skills: info.skills || [],
      pagina: info.pagina,        // texto integral da página, qualquer que seja o site
      paginacao: CV_PAGINACAO
    }
  });
  if (res && res.success && res.data.pdf) {
    const apiUrl = apiUrlInput.value.trim().replace(/\/$/, '');
    const filename = res.data.pdf.split('/').pop();
    const fileUrl = `${apiUrl}/cvs/${encodeURIComponent(filename)}`;
    lastCv = { fileUrl, filename };
    resultNameEl.textContent = filename;
    resultEl.hidden = false;
    setStatus('Currículo gerado e pronto para abrir ou baixar.', 'success');
    try {
      await chrome.downloads.download({ url: fileUrl, filename, saveAs: false });
      addActivity('Download do currículo iniciado.', 'success');
    } catch (downloadError) {
      console.warn('Download automático falhou:', downloadError);
      addActivity('Download automático indisponível; use o botão Baixar.', 'info');
    }
  } else {
    setStatus((res && res.error) || 'Não foi possível gerar o currículo.', 'error');
  }
}));

document.getElementById('btnOpenCv').addEventListener('click', () => {
  if (!lastCv) return;
  chrome.tabs.create({ url: lastCv.fileUrl });
  addActivity('Currículo aberto em uma nova aba.', 'success');
});

document.getElementById('btnDownloadCv').addEventListener('click', async () => {
  if (!lastCv) return;
  try {
    await chrome.downloads.download({ url: lastCv.fileUrl, filename: lastCv.filename, saveAs: true });
    addActivity('Escolha onde salvar o currículo.', 'success');
  } catch (err) {
    setStatus(`Não foi possível baixar o currículo: ${err.message}`, 'error');
  }
});

document.getElementById('btnClearActivity').addEventListener('click', () => {
  activityLogEl.replaceChildren();
  setTerminalState('idle');
  addActivity('Registro de atividade limpo.', 'info');
});

chrome.tabs.onActivated.addListener(() => { refreshPageTarget(); });
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.title && changeInfo.status !== 'complete') return;
  const activeTab = await getActiveTab();
  if (activeTab && activeTab.id === tabId) refreshPageTarget();
});

async function initialize() {
  await loadConfig();
  await refreshPageTarget();
  addActivity('Painel pronto. Escolha uma ação para iniciar.', 'info');
}

initialize();
