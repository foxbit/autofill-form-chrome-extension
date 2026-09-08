/**
 * Popup — painel de controle da extensão Máquina de Vagas.
 * Ações: testar conexão, autopreencher formulário, capturar vaga e gerar CV.
 */

const apiUrlInput = document.getElementById('apiUrl');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const resultNameEl = document.getElementById('resultName');
let lastCv = null;

// ─── helpers ─────────────────────────────────────────────
function setStatus(message, type = 'info') {
  statusEl.hidden = false;
  statusEl.className = `status status-${type}`;
  statusEl.textContent = message;
}

function setStatusHtml(html, type = 'info') {
  statusEl.hidden = false;
  statusEl.className = `status status-${type}`;
  statusEl.innerHTML = html;
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
    payload: { fields: fieldsRes.fields, contexto: fieldsRes.contexto || '' }
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
    const apiUrl = apiUrlInput.value.trim().replace(/\/$/, '');
    const filename = res.data.pdf.split('/').pop();
    const fileUrl = `${apiUrl}/cvs/${encodeURIComponent(filename)}`;
    lastCv = { fileUrl, filename };
    resultNameEl.textContent = filename;
    resultEl.hidden = false;
    setStatus('✅ CV gerado. Use os botões abaixo para abrir ou baixar.', 'success');
    // tentativa best-effort de download automático (sem diálogo)
    try {
      await chrome.downloads.download({ url: fileUrl, filename, saveAs: false });
    } catch (dlErr) {
      console.warn('Download automático falhou (use os botões):', dlErr);
    }
  } else {
    setStatus(`❌ ${(res && res.error) || 'Falha ao gerar CV'}`, 'error');
  }
});

document.getElementById('btnOpenCv').addEventListener('click', () => {
  if (!lastCv) return;
  chrome.tabs.create({ url: lastCv.fileUrl });
});

document.getElementById('btnDownloadCv').addEventListener('click', async () => {
  if (!lastCv) return;
  try {
    await chrome.downloads.download({ url: lastCv.fileUrl, filename: lastCv.filename, saveAs: true });
  } catch (err) {
    setStatus(`❌ Download falhou: ${err.message}`, 'error');
  }
});

loadConfig();
