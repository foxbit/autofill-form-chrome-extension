/**
 * Popup — painel de controle da extensão Máquina de Vagas.
 * Ações: testar conexão, autopreencher formulário, capturar vaga e gerar CV.
 */

const apiUrlInput = document.getElementById('apiUrl');
const statusEl = document.getElementById('status');

// ─── helpers ─────────────────────────────────────────────
function setStatus(message, type = 'info') {
  statusEl.hidden = false;
  statusEl.className = `status status-${type}`;
  statusEl.textContent = message;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendToBackground(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    });
  });
}

// ─── carregar/salvar config ──────────────────────────────
async function loadConfig() {
  const { apiUrl } = await chrome.storage.local.get(['apiUrl']);
  apiUrlInput.value = apiUrl || 'http://127.0.0.1:8790';
}
apiUrlInput.addEventListener('change', async () => {
  await chrome.storage.local.set({ apiUrl: apiUrlInput.value.trim() });
});

// ─── extrair info da vaga da página (via content script) ──
async function extractJobInfo(tabId) {
  const res = await sendToTab(tabId, { type: 'EXTRACT_JOB_INFO' });
  if (res && res.success) return res;
  // fallback: usa URL e título da aba
  const tab = await chrome.tabs.get(tabId);
  return { success: true, titulo: tab.title, empresa: '', local: '', url: tab.url, observacoes: '' };
}

// ─── botões ──────────────────────────────────────────────
document.getElementById('btnTest').addEventListener('click', async () => {
  setStatus('Testando conexão...', 'info');
  const res = await sendToBackground({
    type: 'TEST_CONNECTIONS',
    payload: { apiUrl: apiUrlInput.value.trim() }
  });
  if (res && res.success) setStatus('✅ Conectado à API do Hermes.', 'success');
  else setStatus(`❌ ${(res && res.error) || 'Falha'}`, 'error');
});

document.getElementById('btnAutofill').addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) return setStatus('Nenhuma aba ativa.', 'error');

  setStatus('Varrendo formulário...', 'info');
  const fieldsRes = await sendToTab(tab.id, { type: 'GET_FORM_FIELDS' });
  if (!fieldsRes || !fieldsRes.success) {
    return setStatus(`❌ Nenhum formulário encontrado: ${(fieldsRes && fieldsRes.error) || ''}`, 'error');
  }

  setStatus(`Preenchendo ${fieldsRes.fields.length} campos via API...`, 'info');
  const fillRes = await sendToBackground({
    type: 'AUTOFILL_FIELDS',
    payload: { fields: fieldsRes.fields }
  });
  if (!fillRes || !fillRes.success) {
    return setStatus(`❌ ${(fillRes && fillRes.error) || 'Falha no preenchimento'}`, 'error');
  }

  await sendToTab(tab.id, { type: 'AUTOFILL_FORM', payload: { results: fillRes.results } });
  const log = (fillRes.debugLogs || []).join(' · ');
  setStatus(`✅ Preenchido. ${log}`, 'success');
});

document.getElementById('btnCapture').addEventListener('click', async () => {
  const tab = await getActiveTab();
  setStatus('Capturando vaga...', 'info');
  const info = await extractJobInfo(tab.id);
  const res = await sendToBackground({ type: 'CAPTURE_VAGA', payload: info });
  if (res && res.success) setStatus(`✅ Vaga registrada no banco (${res.data.banco_total} total).`, 'success');
  else setStatus(`❌ ${(res && res.error) || 'Falha ao capturar'}`, 'error');
});

document.getElementById('btnCv').addEventListener('click', async () => {
  const tab = await getActiveTab();
  setStatus('Gerando currículo personalizado...', 'info');
  const info = await extractJobInfo(tab.id);
  const vagaTexto = [info.titulo, info.observacoes].filter(Boolean).join('. ');
  const res = await sendToBackground({
    type: 'GENERATE_CV',
    payload: {
      vaga: vagaTexto,
      idioma: 'pt',
      empresa: info.empresa,
      cargo: info.titulo
    }
  });
  if (res && res.success && res.data.pdf) {
    setStatus(`✅ CV gerado: ${res.data.pdf.split('/').pop()}`, 'success');
  } else {
    setStatus(`❌ ${(res && res.error) || 'Falha ao gerar CV'}`, 'error');
  }
});

loadConfig();
