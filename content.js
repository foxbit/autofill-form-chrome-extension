/**
 * Content Script running on the recruitment form page.
 * Collaborates with utils/dom-parser.js and utils/form-filler.js (which are loaded before this file).
 */

// Keep track of the form fields and their original values for delta learning
let parsedFields = [];
let originalValues = {};
let autofilledValues = {};

// Helper to convert base64 to Blob for file uploads
function base64ToBlob(base64, contentType = 'application/pdf') {
  const byteCharacters = atob(base64);
  const byteArrays = [];
  
  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }
  
  return new Blob(byteArrays, { type: contentType });
}

/**
 * Capture current values for all parsed fields
 */
function captureValues(fields) {
  const values = {};
  fields.forEach(field => {
    try {
      if (field.type === 'file') {
        const el = document.getElementById(field.elementIds[0]);
        values[field.id] = el && el.files && el.files.length > 0 ? el.files[0].name : '';
      } else {
        const el = document.getElementById(field.elementIds[0]);
        values[field.id] = el ? el.value : '';
      }
    } catch (err) {
      console.warn(`Error capturing value for field: ${field.question}`, err);
    }
  });
  return values;
}

/**
 * Scan DOM and capture initial state
 */
function scanForm() {
  parsedFields = window.domParser.parseForm();
  originalValues = captureValues(parsedFields);
  highlightScannedFields(parsedFields);
  injectUploadButtons(parsedFields);
  console.log(`[Autofill IA] Varredura concluída. ${parsedFields.length} campos detectados.`);
}

// Initial scan when page content finishes loading
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  scanForm();
} else {
  window.addEventListener('DOMContentLoaded', scanForm);
}

/**
 * Captura contexto da página (empresa/vaga) para a geração de respostas.
 */
function getPageContext() {
  const meta = (sel, attr) => {
    const el = document.querySelector(sel);
    return el ? (el.getAttribute(attr) || '').trim() : '';
  };
  return [
    document.title,
    meta('meta[name="description"]', 'content'),
    meta('meta[property="og:description"]', 'content'),
    meta('meta[property="og:site_name"]', 'content'),
  ].filter(Boolean).join(' | ').slice(0, 1200);
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'GET_FORM_FIELDS': {
          // Perform a fresh scan to capture dynamic elements (Gupy, GreenHouse can render fields late)
          scanForm();
          sendResponse({ success: true, fields: parsedFields, contexto: getPageContext() });
          break;
        }

        case 'RESCAN_FORM': {
          // Re-analisa a página inteira (útil para SPAs que trocam de formulário sem reload)
          scanForm();
          sendResponse({ success: true, fields: parsedFields.length, contexto: getPageContext() });
          break;
        }

        case 'AUTOFILL_FORM': {
          const { results } = message.payload;
          let filledCount = 0;

          // Fill sequentially to respect visual flow and prevent SPA lag
          for (const result of results) {
            const field = parsedFields.find(f => f.id === result.fieldId);
            if (!field) continue;

            let fillValue = result.value;

            // If it's a file, convert back from Base64
            if (result.type === 'file' && typeof fillValue === 'string') {
              try {
                fillValue = base64ToBlob(fillValue);
              } catch (blobErr) {
                console.error(`Erro ao converter base64 do arquivo: ${result.fileName}`, blobErr);
                continue;
              }
            }

            // Fill field
            const success = await window.formFiller.fill(field, fillValue);
            if (success) {
              filledCount++;
              // Save to autofilled values cache
              autofilledValues[field.id] = result.value;
            }
          }

          // Highlight any required fields that remain empty/unselected
          highlightEmptyRequiredFields(parsedFields);

          // Update upload button states for all fields
          parsedFields.forEach(field => {
            const btn = document.querySelector(`.autofill-upload-btn[data-field-id="${field.id}"]`);
            if (btn) {
              updateButtonState(btn, field);
            }
          });

          sendResponse({ success: true, filledCount });
          break;
        }

        case 'GET_MODIFIED_FIELDS': {
          // Perform fresh scan to capture DOM changes
          const currentFields = window.domParser.parseForm();
          const currentValues = captureValues(currentFields);
          
          const modifications = [];

          currentFields.forEach(field => {
            // Ignore files for standard Q&A learning
            if (field.type === 'file') return;

            const originalVal = originalValues[field.id];
            const currentVal = currentValues[field.id];

            // If current value is not empty and is different from the original value before autofilling
            if (
              currentVal && 
              String(currentVal).trim() !== '' && 
              String(currentVal).trim() !== String(originalVal).trim()
            ) {
              modifications.push({
                id: field.id,
                question: field.question,
                answer: String(currentVal).trim(),
                originalAnswer: originalVal ? String(originalVal).trim() : 'Vazio'
              });
            }
          });

          sendResponse({ success: true, modifications });
          break;
        }

        case 'EXTRACT_JOB_INFO': {
          const meta = (sel, attr) => {
            const el = document.querySelector(sel);
            return el ? (el.getAttribute(attr) || '').trim() : '';
          };
          const rawTitle = meta('meta[property="og:title"]', 'content') || document.title || '';
          const titulo = rawTitle.replace(/\s*[|\-–·]\s*[^|\-–·]*$/, '').trim();
          const empresa = meta('meta[property="og:site_name"]', 'content') ||
            new URL(location.href).hostname.replace(/^www\./, '');
          const observacoes = meta('meta[name="description"]', 'content').slice(0, 300);
          sendResponse({
            success: true,
            titulo: titulo || rawTitle,
            empresa,
            local: '',
            url: location.href,
            observacoes
          });
          break;
        }

        default:
          sendResponse({ success: false, error: 'Ação do script de conteúdo desconhecida' });
      }
    } catch (err) {
      console.error('[Autofill IA] Erro no listener de mensagens:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Keep message channel open
});

/**
 * Iterates through form fields to identify empty/unselected required fields,
 * highlighting them with the 'autofill-failed' class, and removing 'autofill-success'.
 */
function highlightEmptyRequiredFields(fields) {
  fields.forEach(field => {
    let isEmpty = false;

    try {
      if (field.type === 'file') {
        const el = document.getElementById(field.elementIds[0]);
        isEmpty = !el || !el.files || el.files.length === 0;
      } else {
        const el = document.getElementById(field.elementIds[0]);
        isEmpty = !el || !el.value || el.value.trim() === '';
      }
    } catch (err) {
      console.warn(`Erro ao checar se campo está vazio: ${field.question}`, err);
    }

    if (field.required && isEmpty) {
      field.elementIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.classList.add('autofill-failed');
          el.classList.remove('autofill-success');
          el.classList.remove('autofill-scanned');
        }
      });
    } else {
      field.elementIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('autofill-failed');
      });
    }
  });
}

// Remove highlights on user interaction to avoid cluttering the UI
function removeHighlight(e) {
  const target = e.target;
  if (target) {
    if (target.classList.contains('autofill-success')) {
      target.classList.remove('autofill-success');
    }
    if (target.classList.contains('autofill-failed')) {
      target.classList.remove('autofill-failed');
    }
    if (target.classList.contains('autofill-scanned')) {
      target.classList.remove('autofill-scanned');
    }
  }
}

/**
 * Highlights all scanned fields in the active page with the scanned class.
 */
function highlightScannedFields(fields) {
  // First clear scanned class from any previously highlighted fields
  document.querySelectorAll('.autofill-scanned').forEach(el => {
    el.classList.remove('autofill-scanned');
  });

  fields.forEach(field => {
    // Only apply scanned class if the field is not already highlighted as success
    field.elementIds.forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('autofill-success')) {
        el.classList.add('autofill-scanned');
      }
    });
  });
}

// Remove highlights on user interaction to avoid cluttering the UI and handle upload button states
function handleFieldChange(e) {
  const target = e.target;
  if (!target || !target.id) return;
  
  // Find which parsed field this element belongs to
  const field = parsedFields.find(f => f.elementIds.includes(target.id));
  if (!field) return;

  // Find the button
  const btn = document.querySelector(`.autofill-upload-btn[data-field-id="${field.id}"]`);
  if (btn) {
    updateButtonState(btn, field);
  }
}

document.addEventListener('focus', removeHighlight, true);
document.addEventListener('input', (e) => {
  removeHighlight(e);
  handleFieldChange(e);
}, true);
document.addEventListener('change', (e) => {
  removeHighlight(e);
  handleFieldChange(e);
}, true);

// ==========================================
// INLINE UPLOAD AND LEARNING FUNCTIONALITY
// ==========================================

function getFieldCurrentValue(field) {
  try {
    if (field.type === 'file') {
      return '';
    }
    const el = document.getElementById(field.elementIds[0]);
    return el ? el.value.trim() : '';
  } catch (err) {
    console.warn(`Error getting value for field: ${field.question}`, err);
    return '';
  }
}

function isFieldEmpty(field) {
  const val = getFieldCurrentValue(field);
  return val === '' || val === null || val === undefined;
}

function updateButtonState(btn, field) {
  if (!btn) return;
  const empty = isFieldEmpty(field);
  btn.disabled = empty;
  if (empty) {
    btn.setAttribute('title', 'Preencha este campo para salvar a resposta');
  } else {
    btn.setAttribute('title', 'Enviar resposta para aprendizado na nuvem');
  }
}

function getUploadButtonInsertionPoint(field) {
  const firstEl = document.getElementById(field.elementIds[0]);
  if (!firstEl) return null;

  if (field.type === 'file') return null;

  const fieldset = firstEl.closest('fieldset');
  if (fieldset) {
    const legend = fieldset.querySelector('legend');
    if (legend) return { element: legend, position: 'beforeend' };
  }

  if (firstEl.id) {
    const label = document.querySelector(`label[for="${CSS.escape(firstEl.id)}"]`);
    if (label) return { element: label, position: 'beforeend' };
  }

  if (field.type !== 'radio' && !(field.type === 'checkbox' && !field.standalone)) {
    const parentLabel = firstEl.closest('label');
    if (parentLabel) return { element: parentLabel, position: 'beforeend' };
  }

  if (field.type === 'radio' || (field.type === 'checkbox' && !field.standalone)) {
    const lastElId = field.elementIds[field.elementIds.length - 1];
    const lastEl = document.getElementById(lastElId);
    if (lastEl) {
      const lastLabel = lastEl.closest('label') || document.querySelector(`label[for="${CSS.escape(lastEl.id)}"]`);
      if (lastLabel) return { element: lastLabel, position: 'afterend' };
      return { element: lastEl, position: 'afterend' };
    }
  }

  return { element: firstEl, position: 'afterend' };
}

function injectUploadButtons(fields) {
  document.querySelectorAll('.autofill-upload-btn, .autofill-gen-btn').forEach(el => el.remove());

  fields.forEach(field => {
    if (field.type === 'file') return;

    const insertion = getUploadButtonInsertionPoint(field);
    if (!insertion) return;

    const btn = document.createElement('button');
    btn.className = 'autofill-upload-btn';
    btn.setAttribute('data-field-id', field.id);
    btn.setAttribute('type', 'button');
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="autofill-upload-svg">
        <path d="M12 13v8M12 13l-4 4M12 13l4 4"/>
        <path d="M20.38 12.04A9 9 0 0 0 12 3a9 9 0 0 0-8.38 9.04A4.5 4.5 0 0 0 4.5 21h15A4.5 4.5 0 0 0 20.38 12.04z"/>
      </svg>
    `;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleUploadClick(field);
    });

    updateButtonState(btn, field);

    try {
      if (insertion.position === 'beforeend') {
        insertion.element.appendChild(btn);
      } else if (insertion.position === 'afterend') {
        insertion.element.parentNode.insertBefore(btn, insertion.element.nextSibling);
      }
    } catch (err) {
      console.warn(`Erro ao inserir botão de upload para o campo: ${field.question}`, err);
    }

    // Botão de geração IA (⚡) ao lado do de aprendizado
    const genBtn = document.createElement('button');
    genBtn.className = 'autofill-upload-btn autofill-gen-btn';
    genBtn.setAttribute('data-field-id', field.id);
    genBtn.setAttribute('type', 'button');
    genBtn.title = 'Gerar resposta com IA';
    genBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="autofill-upload-svg">
        <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
    `;
    genBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleGenerateClick(field);
    });
    try {
      if (insertion.position === 'beforeend') {
        insertion.element.appendChild(genBtn);
      } else if (insertion.position === 'afterend') {
        insertion.element.parentNode.insertBefore(genBtn, btn.nextSibling);
      }
    } catch (err) {
      console.warn(`Erro ao inserir botão de geração: ${field.question}`, err);
    }
  });
}

async function handleUploadClick(field) {
  const currentValue = getFieldCurrentValue(field);
  if (!currentValue) return;

  const btn = document.querySelector(`.autofill-upload-btn[data-field-id="${field.id}"]`);
  let originalHtml = '';
  if (btn) {
    originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `
      <svg class="autofill-upload-svg autofill-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
      </svg>
    `;
  }

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'CHECK_QUESTION', payload: { question: field.question } },
        resolve
      );
    });

    if (btn) {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
    }

    if (!response || !response.success) {
      throw new Error((response && response.error) || 'Erro ao verificar pergunta no banco.');
    }

    const { exists, existingAnswer } = response;

    if (exists) {
      showOverwriteConfirmationModal(field.question, existingAnswer, currentValue, async (confirmed) => {
        if (!confirmed) return;
        await saveAnswerToServer(field, field.question, currentValue);
      });
    } else {
      showValidationModal(field.question, currentValue, async (validatedQuestion, validatedAnswer) => {
        if (validatedQuestion === null || validatedAnswer === null) return;
        await saveAnswerToServer(field, validatedQuestion, validatedAnswer);
      });
    }
  } catch (err) {
    if (btn) {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
    }
    console.error('Erro ao processar clique no upload:', err);
    showToast(`Erro: ${err.message}`, 'error');
  }
}

async function saveAnswerToServer(field, question, answer) {
  const btn = document.querySelector(`.autofill-upload-btn[data-field-id="${field.id}"]`);
  const originalHtml = btn ? btn.innerHTML : null;
  
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <svg class="autofill-upload-svg autofill-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
      </svg>
    `;
  }

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'SAVE_SINGLE_ANSWER', payload: { question, answer } },
        resolve
      );
    });

    if (!response || !response.success) {
      throw new Error((response && response.error) || 'Erro desconhecido ao salvar.');
    }

    showToast('Resposta salva com sucesso!', 'success');
    
    if (btn) {
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      `;
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        updateButtonState(btn, field);
      }, 2000);
    }
  } catch (err) {
    console.error('Erro ao salvar resposta:', err);
    showToast(`Erro ao salvar: ${err.message}`, 'error');
    if (btn) {
      btn.innerHTML = originalHtml;
      updateButtonState(btn, field);
    }
  }
}

function handleGenerateClick(field) {
  showGenerateModal(field);
}

function showGenerateModal(field) {
  const overlay = document.createElement('div');
  overlay.className = 'autofill-modal-overlay';
  overlay.innerHTML = `
    <div class="autofill-modal">
      <div class="autofill-modal-header">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        <span>Gerar resposta com IA</span>
      </div>
      <div class="autofill-modal-body">
        <div class="autofill-modal-label">Pergunta</div>
        <div class="autofill-modal-text" style="font-weight: 500;">${escapeHtml(field.question)}</div>
        <div class="autofill-modal-group">
          <label class="autofill-modal-label">Instrução (opcional)</label>
          <textarea class="autofill-modal-textarea autofill-instrucao-input" rows="3" placeholder="Ex.: mencionar minha experiência com fintech e design systems"></textarea>
        </div>
        <div id="autofill-gen-result" hidden>
          <label class="autofill-modal-label">Resposta gerada</label>
          <textarea class="autofill-modal-textarea autofill-gen-answer" rows="5"></textarea>
        </div>
      </div>
      <div class="autofill-modal-footer">
        <button class="autofill-modal-btn autofill-modal-btn-cancel">Cancelar</button>
        <button class="autofill-modal-btn autofill-modal-btn-confirm autofill-gen-submit">Gerar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  const cancelBtn = overlay.querySelector('.autofill-modal-btn-cancel');
  const submitBtn = overlay.querySelector('.autofill-gen-submit');
  const instrucaoEl = overlay.querySelector('.autofill-instrucao-input');
  const resultEl = overlay.querySelector('#autofill-gen-result');
  const answerEl = overlay.querySelector('.autofill-gen-answer');
  let generated = '';

  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  submitBtn.addEventListener('click', async () => {
    if (!generated) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Gerando...';
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'GENERATE_ANSWER',
          payload: {
            pergunta: field.question,
            contexto: getPageContext(),
            instrucao: instrucaoEl.value.trim(),
            idioma: /[a-zA-Z]/.test(field.question) && !/[áéíóúâêôãõç]/.test(field.question) ? 'en' : 'pt'
          }
        }, resolve);
      });
      submitBtn.disabled = false;
      if (!resp || !resp.success) {
        showToast(`Erro: ${(resp && resp.error) || 'falha ao gerar'}`, 'error');
        submitBtn.textContent = 'Gerar';
        return;
      }
      generated = resp.resposta;
      answerEl.value = generated;
      resultEl.hidden = false;
      submitBtn.textContent = 'Aprovar e preencher';
    } else {
      close();
      await window.formFiller.fill(field, generated);
      showToast('Resposta preenchida.', 'success');
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function createOverlay(htmlString, onConfirm, onCancel) {
  const overlay = document.createElement('div');
  overlay.className = 'autofill-modal-overlay';
  overlay.innerHTML = htmlString;
  
  const close = () => {
    overlay.remove();
  };
  
  const cancelBtn = overlay.querySelector('.autofill-modal-btn-cancel');
  const confirmBtn = overlay.querySelector('.autofill-modal-btn-confirm');
  
  cancelBtn.addEventListener('click', () => {
    close();
    if (onCancel) onCancel();
  });
  
  confirmBtn.addEventListener('click', () => {
    const questionInput = overlay.querySelector('.autofill-question-input');
    const answerInput = overlay.querySelector('.autofill-answer-input');
    
    if (questionInput || answerInput) {
      const qVal = questionInput ? questionInput.value.trim() : null;
      const aVal = answerInput ? answerInput.value.trim() : null;
      if (questionInput && !qVal) {
        showToast('A pergunta não pode ficar vazia.', 'error');
        return;
      }
      if (answerInput && !aVal) {
        showToast('A resposta não pode ficar vazia.', 'error');
        return;
      }
      close();
      onConfirm(qVal, aVal);
    } else {
      close();
      onConfirm();
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      close();
      if (onCancel) onCancel();
    }
  });

  document.body.appendChild(overlay);
}

function showOverwriteConfirmationModal(question, existingAnswer, newAnswer, callback) {
  const html = `
    <div class="autofill-modal">
      <div class="autofill-modal-header">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span>Sobrescrever Resposta?</span>
      </div>
      <div class="autofill-modal-body">
        <div style="color: #94a3b8; font-size: 13px; line-height: 1.4;">
          Já existe uma resposta para esta pergunta no banco de dados. Deseja substituí-la?
        </div>
        <div class="autofill-modal-group">
          <div class="autofill-modal-label">Pergunta</div>
          <div class="autofill-modal-text" style="font-weight: 500;">${escapeHtml(question)}</div>
        </div>
        <div class="autofill-modal-group">
          <div class="autofill-modal-label">Resposta Salva Antes</div>
          <div class="autofill-modal-text" style="color: #94a3b8; background-color: rgba(15, 23, 42, 0.4);">${escapeHtml(existingAnswer)}</div>
        </div>
        <div class="autofill-modal-group">
          <div class="autofill-modal-label">Nova Resposta</div>
          <div class="autofill-modal-text" style="color: #10b981; border-color: rgba(16, 185, 129, 0.3);">${escapeHtml(newAnswer)}</div>
        </div>
      </div>
      <div class="autofill-modal-footer">
        <button class="autofill-modal-btn autofill-modal-btn-cancel">Cancelar</button>
        <button class="autofill-modal-btn autofill-modal-btn-confirm">Sobrescrever</button>
      </div>
    </div>
  `;

  createOverlay(html, () => callback(true), () => callback(false));
}

function showValidationModal(question, answer, callback) {
  const html = `
    <div class="autofill-modal">
      <div class="autofill-modal-header">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <span>Validar Nova Resposta</span>
      </div>
      <div class="autofill-modal-body">
        <div style="color: #94a3b8; font-size: 13px; line-height: 1.4;">
          Revise a pergunta identificada e sua resposta antes de salvá-las no banco de dados.
        </div>
        <div class="autofill-modal-group">
          <label class="autofill-modal-label">Pergunta</label>
          <textarea class="autofill-modal-textarea autofill-question-input" rows="2">${escapeHtml(question)}</textarea>
        </div>
        <div class="autofill-modal-group">
          <label class="autofill-modal-label">Resposta</label>
          <textarea class="autofill-modal-textarea autofill-answer-input" rows="4">${escapeHtml(answer)}</textarea>
        </div>
      </div>
      <div class="autofill-modal-footer">
        <button class="autofill-modal-btn autofill-modal-btn-cancel">Cancelar</button>
        <button class="autofill-modal-btn autofill-modal-btn-confirm">Salvar no Banco</button>
      </div>
    </div>
  `;

  createOverlay(html, (q, a) => callback(q, a), () => callback(null, null));
}

function showToast(message, type = 'success') {
  const oldToast = document.querySelector('.autofill-toast');
  if (oldToast) oldToast.remove();

  const toast = document.createElement('div');
  toast.className = `autofill-toast autofill-toast-${type}`;
  
  let icon = '';
  if (type === 'success') {
    icon = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    `;
  } else {
    icon = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    `;
  }

  toast.innerHTML = `${icon}<span>${escapeHtml(message)}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

