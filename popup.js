import { storageManager } from './utils/storage-manager.js';

// Default values matching APIs.txt for easy onboarding
const DEFAULT_SUPABASE_URL = 'https://nqnuqzwmekektcmmwcur.supabase.co';
const DEFAULT_SUPABASE_ANON = 'sb_publishable_tX2mNpBG-S2-7G5ZPKhEEA_HGblmKrY';

// Active scanned fields
let scannedFields = [];
let detectedModifications = [];

document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  await loadCredentials();
  await checkConnectionStatus();
  
  // Setup listeners
  document.getElementById('btn-scan').addEventListener('click', scanActiveTabFields);
  document.getElementById('btn-autofill').addEventListener('click', runAutofill);
  document.getElementById('settings-form').addEventListener('submit', saveSettings);
  
  document.getElementById('input-cv').addEventListener('change', (e) => handleFileUpload(e, 'cv.pdf', 'cv-status'));
  document.getElementById('input-cl').addEventListener('change', (e) => handleFileUpload(e, 'carta_apresentacao.pdf', 'cl-status'));

  // Also query if file states exist on load
  await checkFileStatuses();
});

/**
 * Switch tabs in popup
 */
function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active from all tabs
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      
      // Activate selected
      tab.classList.add('active');
      const panelId = tab.getAttribute('data-tab');
      document.getElementById(panelId).classList.add('active');
    });
  });
}

/**
 * Load saved credentials or pre-fill defaults
 */
async function loadCredentials() {
  const keys = await storageManager.getKeys();
  
  document.getElementById('set-supabase-url').value = keys.supabaseUrl || DEFAULT_SUPABASE_URL;
  document.getElementById('set-supabase-anon').value = keys.supabaseAnonKey || DEFAULT_SUPABASE_ANON;
  document.getElementById('set-supabase-service').value = keys.supabaseServiceKey || '';
  document.getElementById('set-gemini-key').value = keys.geminiApiKey || '';
  
  const selectedModel = keys.geminiModelName || 'gemini-3.5-flash';
  document.getElementById('set-gemini-model').value = selectedModel;

  if (keys.geminiApiKey) {
    await refreshModelDropdown(keys.geminiApiKey, selectedModel);
  }
}

/**
 * Checks connection to APIs in background and updates status badges
 */
async function checkConnectionStatus() {
  const sbBadge = document.getElementById('supabase-status');
  const geminiBadge = document.getElementById('gemini-status');
  
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (response && response.connected) {
      sbBadge.className = 'status-badge online';
      geminiBadge.className = 'status-badge online';
      sbBadge.title = 'Supabase Conectado';
      geminiBadge.title = 'Gemini Conectado';
      return true;
    } else {
      sbBadge.className = 'status-badge offline';
      geminiBadge.className = 'status-badge offline';
      sbBadge.title = 'Supabase Desconectado';
      geminiBadge.title = 'Gemini Desconectado';
      return false;
    }
  } catch (err) {
    sbBadge.className = 'status-badge offline';
    geminiBadge.className = 'status-badge offline';
    return false;
  }
}

/**
 * Checks if PDF files exist in Supabase storage
 */
async function checkFileStatuses() {
  // Since we require keys to query storage, do a try check
  const keys = await storageManager.getKeys();
  if (!keys.supabaseUrl || !keys.supabaseAnonKey) return;

  const cvStatus = document.getElementById('cv-status');
  const clStatus = document.getElementById('cl-status');

  // Helper to check file existence
  const checkFile = async (name, el) => {
    try {
      const url = `${keys.supabaseUrl}/storage/v1/object/authenticated/recruitment-files/${name}`;
      const res = await fetch(url, {
        headers: {
          'apikey': keys.supabaseAnonKey,
          'Authorization': `Bearer ${keys.supabaseAnonKey}`
        }
      });
      if (res.ok) {
        el.innerText = 'Enviado para o Supabase';
        el.className = 'file-meta active';
      } else {
        el.innerText = 'Não enviado';
        el.className = 'file-meta';
      }
    } catch (e) {
      el.innerText = 'Não enviado';
      el.className = 'file-meta';
    }
  };

  await checkFile('cv.pdf', cvStatus);
  await checkFile('carta_apresentacao.pdf', clStatus);
}

/**
 * Scans active tab for form fields
 */
async function scanActiveTabFields() {
  const btnScan = document.getElementById('btn-scan');
  const btnAutofill = document.getElementById('btn-autofill');
  const warningBox = document.getElementById('no-active-tab-warning');

  scannedFields = [];
  btnAutofill.disabled = true;
  document.getElementById('fields-count').innerText = '-';
  document.getElementById('required-count').innerText = '-';
  document.getElementById('autofill-log-container').classList.add('hidden');
  document.getElementById('autofill-log').innerHTML = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
      warningBox.classList.remove('hidden');
      return;
    }
    warningBox.classList.add('hidden');

    // Send scan request to content script
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_FORM_FIELDS' });
    
    if (response && response.success) {
      scannedFields = response.fields;
      document.getElementById('fields-count').innerText = scannedFields.length;
      
      const reqCount = scannedFields.filter(f => f.required).length;
      document.getElementById('required-count').innerText = reqCount;
      
      if (scannedFields.length > 0) {
        btnAutofill.disabled = false;
        showToast('Sucesso', `${scannedFields.length} campos de formulário detectados.`, 'success');
      } else {
        showToast('Aviso', 'Nenhum campo de formulário detectado nesta página.', 'error');
      }
    } else {
      showToast('Erro', 'Certifique-se de que a página está totalmente carregada.', 'error');
    }
  } catch (err) {
    console.error('Scan fields failed:', err);
    showToast('Erro', 'Não foi possível ler a página. Tente recarregá-la.', 'error');
  }
}

/**
 * Executes the Autofill process
 */
async function runAutofill() {
  if (scannedFields.length === 0) return;
  
  const btnAutofill = document.getElementById('btn-autofill');
  const btnText = btnAutofill.querySelector('.btn-text');
  const spinner = btnAutofill.querySelector('.spinner');
  const logContainer = document.getElementById('autofill-log-container');
  const logList = document.getElementById('autofill-log');

  // Loading state
  btnAutofill.disabled = true;
  btnText.classList.add('hidden');
  spinner.classList.remove('hidden');
  logContainer.classList.remove('hidden');
  logList.innerHTML = '<div class="log-item"><span class="log-tag info">[Info]</span><span>Consultando banco de dados e IA...</span></div>';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // 1. Get answers from background service worker
    const response = await chrome.runtime.sendMessage({
      type: 'AUTOFILL_FIELDS',
      payload: { fields: scannedFields }
    });

    logList.innerHTML = ''; // Clear previous initial log

    if (response) {
      // If we received debugLogs, render them first
      if (response.debugLogs && response.debugLogs.length > 0) {
        response.debugLogs.forEach(logLine => {
          const logItem = document.createElement('div');
          logItem.className = 'log-item';
          
          let tagClass = 'info';
          let tagText = '[Etapa]';
          
          if (logLine.startsWith('[Arquivo]')) {
            tagClass = 'success';
            tagText = '[Arquivo]';
            logLine = logLine.replace('[Arquivo] ', '');
          } else if (logLine.startsWith('[Histórico Exato]')) {
            tagClass = 'success';
            tagText = '[Exato]';
            logLine = logLine.replace('[Histórico Exato] ', '');
          } else if (logLine.startsWith('[Busca Semântica]')) {
            tagClass = 'success';
            tagText = '[Semântico]';
            logLine = logLine.replace('[Busca Semântica] ', '');
          } else if (logLine.startsWith('[IA]')) {
            tagClass = 'success';
            tagText = '[IA]';
            logLine = logLine.replace('[IA] ', '');
          } else if (logLine.startsWith('[Erro]')) {
            tagClass = 'error';
            tagText = '[Erro]';
            logLine = logLine.replace('[Erro] ', '');
          } else if (logLine.startsWith('[Erro IA]')) {
            tagClass = 'error';
            tagText = '[Erro IA]';
            logLine = logLine.replace('[Erro IA] ', '');
          }
          
          logItem.innerHTML = `<span class="log-tag ${tagClass}">${tagText}</span><span>${logLine}</span>`;
          logList.appendChild(logItem);
        });
      }

      if (response.success) {
        const results = response.results;
        
        if (results.length === 0) {
          const logItem = document.createElement('div');
          logItem.className = 'log-item';
          logItem.innerHTML = '<span class="log-tag warn">[Aviso]</span><span>Nenhum campo compatível encontrado para preencher.</span>';
          logList.appendChild(logItem);
          showToast('Concluído', 'Nenhum campo correspondente encontrado.', 'error');
        } else {
          // 2. Inject answers in tab DOM
          const autofillRes = await chrome.tabs.sendMessage(tab.id, {
            type: 'AUTOFILL_FORM',
            payload: { results }
          });

          if (autofillRes && autofillRes.success) {
            showToast('Concluído', `${autofillRes.filledCount} campos preenchidos com sucesso!`, 'success');
          } else {
            showToast('Erro', 'Falha ao preencher os campos na página.', 'error');
          }
        }
      } else {
        const logItem = document.createElement('div');
        logItem.className = 'log-item';
        logItem.innerHTML = `<span class="log-tag error">[Erro Geral]</span><span>${response.error || 'Erro ao processar preenchimento.'}</span>`;
        logList.appendChild(logItem);
        showToast('Erro', response.error || 'Erro ao gerar respostas.', 'error');
      }
    } else {
      showToast('Erro', 'Nenhuma resposta recebida do background worker.', 'error');
    }
  } catch (err) {
    console.error('Autofill execution failed:', err);
    const logItem = document.createElement('div');
    logItem.className = 'log-item';
    logItem.innerHTML = `<span class="log-tag error">[Erro Conexão]</span><span>Falha de comunicação: ${err.message}</span>`;
    logList.appendChild(logItem);
    showToast('Erro', 'Erro durante o autopreenchimento.', 'error');
  } finally {
    btnAutofill.disabled = false;
    btnText.classList.remove('hidden');
    spinner.classList.add('hidden');
  }
}



/**
 * Uploads a file (CV or cover letter) to Supabase Storage via background worker
 */
async function handleFileUpload(event, fileName, statusElId) {
  const file = event.target.files[0];
  if (!file) return;

  const feedback = document.getElementById('upload-feedback');
  const statusEl = document.getElementById(statusElId);
  
  feedback.classList.remove('hidden');
  feedback.className = 'feedback-box';
  feedback.innerText = `Fazendo upload de ${file.name}...`;
  
  statusEl.innerText = 'Enviando...';
  statusEl.className = 'file-meta';

  const reader = new FileReader();
  
  reader.onload = async (e) => {
    const arrayBuffer = e.target.result;
    
    // Convert ArrayBuffer to Base64 in popup to send via messaging
    const binary = new Uint8Array(arrayBuffer);
    let binaryStr = '';
    for (let i = 0; i < binary.byteLength; i++) {
      binaryStr += String.fromCharCode(binary[i]);
    }
    const base64 = btoa(binaryStr);

    try {
      const keys = await storageManager.getKeys();
      if (!keys.supabaseUrl || !keys.supabaseServiceKey) {
        throw new Error('Configuração incompleta. Configure a URL e a Service Role Key no painel Ajustes.');
      }

      const client = new (await import('./utils/supabase-client.js')).SupabaseClient(
        keys.supabaseUrl, 
        keys.supabaseAnonKey, 
        keys.supabaseServiceKey
      );

      // Convert base64 back to Blob in client or pass arrayBuffer if node/fetch supported
      const blob = new Blob([arrayBuffer], { type: file.type });
      
      await client.uploadFile(fileName, blob, file.type);

      feedback.innerText = `Upload de ${file.name} concluído com sucesso!`;
      feedback.className = 'feedback-box success';
      
      statusEl.innerText = 'Enviado para o Supabase';
      statusEl.className = 'file-meta active';
      
      showToast('Sucesso', `Arquivo ${file.name} salvo.`, 'success');
    } catch (err) {
      console.error(err);
      feedback.innerText = `Erro no upload: ${err.message}`;
      feedback.className = 'feedback-box error';
      statusEl.innerText = 'Erro';
      statusEl.className = 'file-meta';
      showToast('Erro no Upload', err.message, 'error');
    }
  };

  reader.onerror = () => {
    feedback.innerText = 'Erro ao ler arquivo local.';
    feedback.className = 'feedback-box error';
    statusEl.innerText = 'Não enviado';
  };

  reader.readAsArrayBuffer(file);
}

/**
 * Saves and validates API credentials in form submit
 */
async function saveSettings(event) {
  event.preventDefault();
  
  const btnSave = document.getElementById('btn-save-settings');
  const btnText = btnSave.querySelector('.btn-text');
  const spinner = btnSave.querySelector('.spinner');
  const feedback = document.getElementById('settings-feedback');

  feedback.classList.add('hidden');
  btnSave.disabled = true;
  btnText.classList.add('hidden');
  spinner.classList.remove('hidden');

  const supabaseUrl = document.getElementById('set-supabase-url').value.trim();
  const supabaseAnonKey = document.getElementById('set-supabase-anon').value.trim();
  const supabaseServiceKey = document.getElementById('set-supabase-service').value.trim();
  const geminiApiKey = document.getElementById('set-gemini-key').value.trim();
  const geminiModelName = document.getElementById('set-gemini-model').value;

  try {
    // 1. Test connections in background worker
    const response = await chrome.runtime.sendMessage({
      type: 'TEST_CONNECTIONS',
      payload: { supabaseUrl, supabaseAnonKey, supabaseServiceKey, geminiApiKey, geminiModelName }
    });

    if (response && response.success) {
      // 2. If test passes, save credentials
      await storageManager.setKeys({ supabaseUrl, supabaseAnonKey, supabaseServiceKey, geminiApiKey, geminiModelName });
      
      feedback.innerText = 'Configuração salva e validada com sucesso!';
      feedback.className = 'feedback-box success';
      feedback.classList.remove('hidden');
      
      showToast('Sucesso', 'Configurações de API salvas e conectadas!', 'success');
      
      // Refresh live models dropdown
      await refreshModelDropdown(geminiApiKey, geminiModelName);
      
      // Update status badges
      await checkConnectionStatus();
      // Check file upload statuses too
      await checkFileStatuses();
    } else {
      feedback.innerText = `Falha na validação: ${response.error || 'Verifique as chaves e a conexão com a internet.'}`;
      feedback.className = 'feedback-box error';
      feedback.classList.remove('hidden');
      
      showToast('Erro de Conexão', 'Não foi possível validar as chaves.', 'error');
    }
  } catch (err) {
    feedback.innerText = `Erro de comunicação: ${err.message}`;
    feedback.className = 'feedback-box error';
    feedback.classList.remove('hidden');
    showToast('Erro', 'Erro ao testar chaves.', 'error');
  } finally {
    btnSave.disabled = false;
    btnText.classList.remove('hidden');
    spinner.classList.add('hidden');
  }
}

/**
 * Toast notifications helper
 */
function showToast(title, message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.innerText = `${title}: ${message}`;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  
  // Auto-hide after 3 seconds
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}

/**
 * Fetches available Gemini models and populates the model dropdown
 */
async function refreshModelDropdown(apiKey, selectedModel) {
  const selectEl = document.getElementById('set-gemini-model');
  if (!apiKey) return;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'LIST_MODELS',
      payload: { geminiApiKey: apiKey }
    });

    if (response && response.success && response.models && response.models.length > 0) {
      // Clear existing options
      selectEl.innerHTML = '';

      // Populate new options
      response.models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.name;
        
        let label = model.displayName;
        if (model.name === 'gemini-3.5-flash') {
          label += ' (Recomendado)';
        }
        option.innerText = label;
        option.title = model.description || '';
        selectEl.appendChild(option);
      });

      // Restore selection if in list, otherwise select first/default
      const hasSelected = Array.from(selectEl.options).some(opt => opt.value === selectedModel);
      if (hasSelected) {
        selectEl.value = selectedModel;
      } else {
        selectEl.value = response.models[0].name;
      }
    }
  } catch (err) {
    console.warn('Erro ao atualizar lista de modelos da API:', err);
  }
}
