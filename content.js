/**
 * Content Script running on the recruitment form page.
 * Collaborates with utils/dom-parser.js and utils/form-filler.js (which are loaded before this file).
 */

// Keep track of the form fields and their original values for delta learning
let parsedFields = [];
let originalValues = {};
let autofilledValues = {};

// Toggle do painel: quando desligado, a extensão não injeta nada na página
// (sem botões ☁️/⚡ e sem destaque nos campos). O valor vive em
// chrome.storage.local, então o estado vale para todas as abas de uma vez.
let pageUiEnabled = true;

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
      values[field.id] = readFieldValue(field);
    } catch (err) {
      console.warn(`Error capturing value for field: ${field.question}`, err);
    }
  });
  return values;
}

/** Current answer of a field, whatever its control type. */
function readFieldValue(field) {
  const el = window.domParser.getElement(field.elementIds[0]);
  if (!el) return '';

  if (field.type === 'file') {
    return el.files && el.files.length > 0 ? el.files[0].name : '';
  }

  if (field.type === 'radio' || field.type === 'checkbox') {
    const marcadas = field.elementIds
      .map(id => window.domParser.getElement(id))
      .filter(item => item && item.checked)
      .map(item => window.domParser.getOptionLabel(item) || item.value);
    if (field.standalone) return el.checked ? 'sim' : '';
    return marcadas.join(', ');
  }

  if (field.type === 'select') {
    const selecionadas = [...(el.selectedOptions || [])]
      .map(option => (option.textContent || '').trim())
      .filter(Boolean);
    return selecionadas.join(', ');
  }

  return el.value || '';
}

/**
 * Scan DOM and capture initial state
 */
function scanForm() {
  parsedFields = window.domParser.parseForm();
  originalValues = captureValues(parsedFields);

  // Desligado: a varredura continua (o painel ainda preenche sob comando),
  // mas a página fica limpa — nenhum botão, nenhum destaque.
  if (!pageUiEnabled) {
    clearInjectedUi();
    console.log(`[Autofill IA] Varredura concluída (UI desligada). ${parsedFields.length} campos detectados.`);
    return;
  }

  highlightScannedFields(parsedFields);
  injectUploadButtons(parsedFields);
  console.log(`[Autofill IA] Varredura concluída. ${parsedFields.length} campos detectados.`);
}

/** Remove tudo que a extensão desenhou na página. */
function clearInjectedUi() {
  document.querySelectorAll('.autofill-upload-btn, .autofill-gen-btn').forEach(el => el.remove());
  document.querySelectorAll('.autofill-scanned, .autofill-success, .autofill-failed').forEach(el => {
    el.classList.remove('autofill-scanned', 'autofill-success', 'autofill-failed');
  });
}

/** Aplica o estado do toggle na página, sem esperar nova varredura. */
function applyPageUiState(enabled) {
  pageUiEnabled = enabled !== false;
  if (!pageUiEnabled) {
    clearInjectedUi();
    return;
  }
  if (parsedFields.length) {
    highlightScannedFields(parsedFields);
    injectUploadButtons(parsedFields);
  } else {
    scanForm();
  }
}

// Initial scan when page content finishes loading
function bootScan() {
  chrome.storage.local.get(['pageUiEnabled'], ({ pageUiEnabled: salvo }) => {
    pageUiEnabled = salvo !== false;   // ausente = ligado
    scanForm();
  });
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  bootScan();
} else {
  window.addEventListener('DOMContentLoaded', bootScan);
}

// O painel só grava no storage; cada aba reage por conta própria.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.pageUiEnabled) return;
  applyPageUiState(changes.pageUiEnabled.newValue);
});

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

/**
 * Extração da vaga em foco (título, empresa, requisitos e descrição completa).
 * Ordem de preferência: JSON-LD (schema.org/JobPosting) → container conhecido
 * do ATS → maior bloco de texto da página.
 */
const JOB_DESCRIPTION_SELECTORS = [
  '[data-automation-id="jobPostingDescription"]',   // Workday
  '[data-testid="job-description"]',                // Gupy
  '[data-testid="text-section"]',                   // Gupy (blocos de texto)
  '[class*="descriptionText"]',                     // Ashby
  '#jobDescriptionText',                            // Indeed
  '.jobs-description__content',                     // LinkedIn (logado)
  '.description__text',                             // LinkedIn (público)
  '.job__description',                              // Greenhouse (embed)
  '#content',                                       // Greenhouse
  '.section-wrapper',                               // Lever
  '[class*="job-description"]',
  '[class*="jobDescription"]',
  '[id*="job-description"]',
  'article',
  'main'
];

const JOB_KEYWORDS = /requisit|qualifica|responsabilidad|atividad|experiênc|experienc|desejáve|diferenci|benefíc|requirement|responsibilit|qualification|skills|about the role|what you/i;

const MAX_DESCRICAO = 20000;
const MAX_PAGINA = 60000;

// Plataformas de recrutamento: quando o og:site_name/hostname cai numa delas,
// o nome que interessa é o da empresa contratante, não o do ATS.
const ATS_HOSTS = /gupy|greenhouse|lever|workable|ashby|indeed|linkedin|workday|breezy|recruitee|jobvite|smartrecruiters|glassdoor|vagas\.com|infojobs|catho|solides|kenoby|abler|inhire|remotive|wellfound|angel\.co|myworkdayjobs|careers?$/i;

// Prefixos de portal que sujam o nome do cargo ("Vaga: Product Designer").
const TITULO_PREFIXOS = /^(vagas?|oportunidade|job|jobs|carreiras?|careers?|apply|candidatura)\s*[:\-–—]\s*/i;

/** Segmentos de um <title> do tipo "Cargo | Empresa | Plataforma". */
function titleSegments(rawTitle) {
  return String(rawTitle || '')
    .split(/\s*[|·–—]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function guessEmpresa(rawTitle, atual) {
  if (atual && !ATS_HOSTS.test(atual)) return atual;
  const candidatos = titleSegments(rawTitle).slice(1)
    .filter((s) => !ATS_HOSTS.test(s) && s.length < 60);
  return candidatos[0] || atual;
}

function normalizeJobText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Converte um trecho de HTML (JSON-LD) em texto, sem executar nada. */
function jobHtmlToText(html) {
  const marked = String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h[1-6]|tr|ul|ol)\s*>/gi, '\n');
  const doc = new DOMParser().parseFromString(marked, 'text/html');
  return normalizeJobText(doc.body ? doc.body.textContent : marked);
}

function jsonLdJobPostings() {
  const found = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const type = node['@type'];
    const isJob = type === 'JobPosting' ||
      (Array.isArray(type) && type.includes('JobPosting'));
    if (isJob) found.push(node);
    Object.values(node).forEach(visit);
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      visit(JSON.parse(script.textContent));
    } catch (err) {
      /* JSON-LD malformado: ignora e segue para o próximo */
    }
  });
  return found;
}

function flattenJobValue(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(flattenJobValue).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    return flattenJobValue(value.name || value.value || value.description || '');
  }
  return jobHtmlToText(value);
}

/** Melhor bloco de texto da página, pontuado por tamanho + palavras da vaga. */
function bestDescriptionBlock() {
  let best = { texto: '', score: 0, seletor: '' };
  for (const selector of JOB_DESCRIPTION_SELECTORS) {
    let elements = [];
    try {
      elements = [...document.querySelectorAll(selector)];
    } catch (err) {
      continue;
    }
    const texto = normalizeJobText(
      elements.map((el) => el.innerText || el.textContent || '').join('\n\n')
    );
    if (texto.length < 200) continue;
    const score = texto.length + (JOB_KEYWORDS.test(texto) ? 5000 : 0);
    if (score > best.score) best = { texto, score, seletor: selector };
  }
  return best;
}

/**
 * Todo o texto visível da página (inclusive iframes de mesma origem, usados por
 * Greenhouse/Lever embutidos). É o que vai para o Hermes analisar — os
 * seletores de ATS abaixo servem só para destacar o trecho principal.
 */
function fullPageText() {
  const partes = [document.body ? document.body.innerText || document.body.textContent : ''];
  for (const frame of document.querySelectorAll('iframe')) {
    try {
      const doc = frame.contentDocument;
      if (doc && doc.body) partes.push(doc.body.innerText || doc.body.textContent);
    } catch (err) {
      /* iframe de outra origem: inacessível, segue o jogo */
    }
  }
  const linhas = normalizeJobText(partes.filter(Boolean).join('\n\n')).split('\n');
  const vistas = new Set();
  return linhas
    .filter((linha) => {
      const chave = linha.trim();
      if (!chave) return true;
      if (chave.length < 40 && vistas.has(chave)) return false;  // menus repetidos
      vistas.add(chave);
      return true;
    })
    .join('\n')
    .slice(0, MAX_PAGINA);
}

function extractJobPosting() {
  const meta = (sel, attr) => {
    const el = document.querySelector(sel);
    return el ? (el.getAttribute(attr) || '').trim() : '';
  };

  const rawTitle = meta('meta[property="og:title"]', 'content') || document.title || '';
  let titulo = (titleSegments(rawTitle)[0] || rawTitle).replace(TITULO_PREFIXOS, '').trim();
  let empresa = guessEmpresa(
    document.title || rawTitle,
    meta('meta[property="og:site_name"]', 'content') ||
      new URL(location.href).hostname.replace(/^www\./, '')
  );
  let local = '';
  let descricao = '';
  let requisitos = '';
  let skills = [];
  let fonte = '';

  const [posting] = jsonLdJobPostings();
  if (posting) {
    titulo = flattenJobValue(posting.title) || titulo;
    empresa = flattenJobValue(posting.hiringOrganization) || empresa;
    local = flattenJobValue(posting.jobLocation) ||
      (posting.jobLocationType ? String(posting.jobLocationType) : '');
    descricao = flattenJobValue(posting.description);
    requisitos = [
      flattenJobValue(posting.qualifications),
      flattenJobValue(posting.experienceRequirements),
      flattenJobValue(posting.educationRequirements),
      flattenJobValue(posting.responsibilities)
    ].filter(Boolean).join('\n\n');
    const rawSkills = posting.skills || posting.occupationalCategory || '';
    skills = (Array.isArray(rawSkills) ? rawSkills : String(rawSkills).split(/[,;•|]/))
      .map((s) => flattenJobValue(s).trim())
      .filter(Boolean);
    if (descricao) fonte = 'json-ld';
  }

  // LinkedIn: <title> e metas descrevem a busca ("Product Designer jobs in…"),
  // não a vaga em foco. O extrator dedicado lê o painel da vaga.
  let jobId = '';
  let variante = '';
  const plataforma = isLinkedIn() ? 'linkedin' : '';
  if (plataforma === 'linkedin') {
    const vaga = linkedInFocusedJob();
    if (vaga) {
      titulo = vaga.titulo || titulo;
      empresa = vaga.empresa || empresa;
      local = vaga.local || local;
      jobId = vaga.job_id;
      variante = vaga.variante;
      if (vaga.descricao.length > descricao.length) {
        descricao = vaga.descricao;
        fonte = 'linkedin';
      }
    }
  }

  if (descricao.length < 400) {
    const bloco = bestDescriptionBlock();
    if (bloco.texto.length > descricao.length) {
      descricao = bloco.texto;
      fonte = `seletor:${bloco.seletor}`;
    }
  }

  const pagina = fullPageText();

  if (!descricao) {
    descricao = pagina;
    fonte = 'corpo da página';
  }

  descricao = descricao.slice(0, MAX_DESCRICAO);
  requisitos = requisitos.slice(0, MAX_DESCRICAO);

  const resumo = meta('meta[name="description"]', 'content') ||
    meta('meta[property="og:description"]', 'content');

  return {
    titulo,
    empresa,
    local,
    // URL canônica: é dela que o Hermes tira o id e o nome do arquivo da vaga
    url: jobId ? linkedInJobUrl(jobId) : location.href,
    job_id: jobId,
    plataforma,
    variante,
    observacoes: (resumo || descricao).slice(0, 300),
    descricao,
    requisitos,
    pagina,
    skills: skills.slice(0, 40),
    fonte
  };
}

// ─── log de auditoria ───────────────────────────────────
// Registro leve em chrome.storage.local (`auditLog`, últimas entradas) para
// diagnosticar captura e preenchimento sem DevTools: página, background e
// painel escrevem na mesma lista; o painel copia tudo com "Copiar log".
const AUDIT_LOG_MAX = 300;
let auditQueue = Promise.resolve();

function auditLog(evento, dados = {}) {
  console.debug('[Autofill IA]', evento, dados);
  const entrada = {
    ts: new Date().toISOString(),
    origem: 'pagina',
    frame: window === window.top ? 'top' : 'iframe',
    url: location.href.slice(0, 300),
    evento,
    dados
  };
  // Fila local: leituras e gravações em sequência para não perder entradas
  auditQueue = auditQueue.then(async () => {
    try {
      const { auditLog: atual = [] } = await chrome.storage.local.get('auditLog');
      atual.push(entrada);
      await chrome.storage.local.set({ auditLog: atual.slice(-AUDIT_LOG_MAX) });
    } catch (err) {
      /* storage indisponível (página descarregada): fica só no console */
    }
  });
  return auditQueue;
}

// ─── LinkedIn ───────────────────────────────────────────
// Três DOMs convivem em produção: a interface nova (2026, classes ofuscadas,
// ancorada em `componentkey`), a clássica logada e a pública (deslogada).
// Cada extrator tenta as três, nessa ordem.

const LINKEDIN_HOST = /(^|\.)linkedin\.com$/i;

// Linhas de card que não são localização (data, candidatos, selos)
const LINKEDIN_LINHA_EXTRA = /^(posted|publicad|há \d|\d+\s*(h|d|w|mo|y|min)\b|.*\bago$|.*applicant|.*candidat|easy apply|candidatura simplificada|promoted|promovid|·|be an early|.*alumni|.*ex-alun|viewed|visualizad|verified|verificad)/i;

function isLinkedIn() {
  return LINKEDIN_HOST.test(location.hostname);
}

function linkedInJobUrl(id) {
  return `https://www.linkedin.com/jobs/view/${id}/`;
}

/** Id da vaga numa URL do LinkedIn: /jobs/view/<slug>-<id> ou ?currentJobId=<id>. */
function linkedInIdFromUrl(href) {
  try {
    const url = new URL(href, location.href);
    const match = url.pathname.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})(?=[/?#]|$)/);
    if (match) return match[1];
    return url.searchParams.get('currentJobId') || '';
  } catch (err) {
    return '';
  }
}

function linkedInLines(el) {
  const texto = el ? (el.innerText !== undefined ? el.innerText : el.textContent) : '';
  return String(texto || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

function linkedInText(sel, root = document) {
  const el = root.querySelector(sel);
  return el ? normalizeJobText(el.innerText || el.textContent) : '';
}

/** "Company, Foundey." → "Foundey" */
function linkedInCompanyFromAria(label) {
  return String(label || '').replace(/^(company|empresa),\s*/i, '').replace(/\.$/, '').trim();
}

/** "Brazil · 3 days ago · Over 100 applicants" → "Brazil" */
function linkedInFirstSegment(texto) {
  return String(texto || '').split('·')[0].trim();
}

/**
 * Vagas listadas na página (busca, coleções, "vagas recomendadas").
 * Só o que está renderizado nesta página de resultados — sem paginação.
 */
function linkedInListJobs() {
  const vagas = [];
  const vistos = new Set();
  const add = (vaga) => {
    if (!vaga.job_id || !vaga.titulo || vistos.has(vaga.job_id)) return;
    vistos.add(vaga.job_id);
    vagas.push({ ...vaga, url: linkedInJobUrl(vaga.job_id) });
  };

  // 1) Interface nova: card = div[role=button] com componentkey="job-card-component-ref-<id>"
  document.querySelectorAll('[componentkey^="job-card-component-ref-"]').forEach((card) => {
    if (card.getAttribute('role') !== 'button') return;
    const job_id = card.getAttribute('componentkey').replace('job-card-component-ref-', '');
    const linhas = linkedInLines(card);
    const titulo = linhas[0] || '';
    // O título pode vir duplicado (texto visível + versão para leitor de tela)
    const idx = linhas[1] === titulo ? 2 : 1;
    const empresaEl = card.querySelector('[aria-label^="Company, " i], [aria-label^="Empresa, " i]');
    const empresa = linkedInCompanyFromAria(empresaEl && empresaEl.getAttribute('aria-label')) || linhas[idx] || '';
    const proxima = linhas[idx + 1] || '';
    add({ job_id, titulo, empresa, local: LINKEDIN_LINHA_EXTRA.test(proxima) ? '' : proxima });
  });
  if (vagas.length) return { vagas, fonte: 'linkedin:nova' };

  // 2) Clássica logada
  document.querySelectorAll('li[data-occludable-job-id], .job-card-container[data-job-id]').forEach((card) => {
    const job_id = card.getAttribute('data-occludable-job-id') ||
      card.getAttribute('data-job-id') ||
      linkedInIdFromUrl((card.querySelector('a[href*="/jobs/view/"]') || {}).href || '');
    add({
      job_id,
      titulo: linkedInText('.job-card-list__title--link, .job-card-list__title, .artdeco-entity-lockup__title', card).split('\n')[0],
      empresa: linkedInText('.artdeco-entity-lockup__subtitle, .job-card-container__primary-description, .job-card-container__company-name', card),
      local: linkedInFirstSegment(linkedInText('.artdeco-entity-lockup__caption, .job-card-container__metadata-item, .job-card-container__metadata-wrapper', card))
    });
  });
  if (vagas.length) return { vagas, fonte: 'linkedin:classica' };

  // 3) Pública (deslogada)
  document.querySelectorAll('.base-card[data-entity-urn], ul.jobs-search__results-list > li').forEach((card) => {
    const urnEl = card.hasAttribute('data-entity-urn') ? card : card.querySelector('[data-entity-urn]');
    const urn = urnEl ? urnEl.getAttribute('data-entity-urn') || '' : '';
    const job_id = (urn.match(/(\d{6,})$/) || [])[1] ||
      linkedInIdFromUrl((card.querySelector('a[href*="/jobs/view/"]') || {}).href || '');
    add({
      job_id,
      titulo: linkedInText('.base-search-card__title', card),
      empresa: linkedInText('.base-search-card__subtitle', card),
      local: linkedInText('.job-search-card__location', card)
    });
  });
  return { vagas, fonte: vagas.length ? 'linkedin:publica' : '' };
}

/**
 * A vaga em foco: a página /jobs/view/<id> ou o painel de detalhe aberto numa
 * busca (?currentJobId=<id>). Null quando a página não tem vaga em foco.
 */
function linkedInFocusedJob() {
  const job_id = linkedInIdFromUrl(location.href);
  if (!job_id) return null;

  const foraDeCard = (el) => !el.closest(
    '[componentkey^="job-card-component-ref-"], li[data-occludable-job-id], .job-card-container, .base-card'
  );
  let titulo = '';
  let empresa = '';
  let local = '';
  let descricao = '';
  let variante = 'nova';

  if (document.querySelector('.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title')) {
    // Clássica logada
    variante = 'classica';
    titulo = linkedInText('.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title').split('\n')[0];
    empresa = linkedInText('.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name');
    local = linkedInFirstSegment(linkedInText(
      '.job-details-jobs-unified-top-card__primary-description-container, .job-details-jobs-unified-top-card__tertiary-description-container, .jobs-unified-top-card__primary-description'
    ));
    descricao = linkedInText('#job-details, .jobs-description__content');
  } else if (document.querySelector('.top-card-layout__title, .topcard__title')) {
    // Pública
    variante = 'publica';
    titulo = linkedInText('.top-card-layout__title, .topcard__title');
    empresa = linkedInText('.topcard__org-name-link, .topcard__flavor a');
    local = linkedInText('.topcard__flavor--bullet');
    descricao = linkedInText('.description__text, .show-more-less-html__markup');
  } else {
    // Interface nova: empresa em aria-label; título no link canônico da vaga
    // ou na linha seguinte à empresa no bloco do topo
    const empresaEl = [...document.querySelectorAll('[aria-label^="Company, " i], [aria-label^="Empresa, " i]')].find(foraDeCard);
    empresa = linkedInCompanyFromAria(empresaEl && empresaEl.getAttribute('aria-label'));
    const link = [...document.querySelectorAll('a[href*="/jobs/view/"]')]
      .find((a) => foraDeCard(a) && linkedInIdFromUrl(a.href) === job_id);
    titulo = link ? linkedInLines(link)[0] || '' : '';

    let bloco = empresaEl;
    while (bloco && bloco !== document.body && linkedInLines(bloco).length < 3) bloco = bloco.parentElement;
    const linhas = bloco && bloco !== document.body && linkedInLines(bloco).length <= 40 ? linkedInLines(bloco) : [];
    if (!titulo && empresa) titulo = linhas[linhas.indexOf(empresa) + 1] || '';
    const meta = linhas.find((l) => /\S\s*·\s*\S/.test(l) && !/^(promoted|promovid)/i.test(l));
    local = meta ? linkedInFirstSegment(meta) : '';

    const h2 = [...document.querySelectorAll('h2')].find((h) => /about the job|sobre a vaga/i.test(h.textContent));
    if (h2) {
      let secao = h2.parentElement;
      while (secao && secao !== document.body && normalizeJobText(secao.innerText).length < 400) secao = secao.parentElement;
      if (secao && secao !== document.body) descricao = normalizeJobText(secao.innerText);
    }
  }

  // <title> "Cargo | Empresa | LinkedIn" cobre o que os seletores não acharam.
  // O cargo pode conter "|" ("Senior UI | UX Designer"), então a empresa é o
  // último segmento e o cargo é o que sobra antes dela.
  const semSufixo = document.title.replace(/\s*\|\s*LinkedIn.*$/i, '').trim();
  const segmentos = titleSegments(semSufixo);
  if (!empresa && segmentos.length >= 2) empresa = segmentos[segmentos.length - 1];
  if (!titulo && semSufixo && !/\bjobs?\b|\bvagas?\b/i.test(segmentos[0] || '')) {
    const sufixoEmpresa = empresa && semSufixo.endsWith(empresa) ? semSufixo.slice(0, -empresa.length) : semSufixo;
    titulo = sufixoEmpresa.replace(/\s*\|\s*$/, '').trim();
  }

  return { job_id, titulo, empresa, local, descricao, variante, url: linkedInJobUrl(job_id) };
}

/** Lista de vagas da página, quando a página é uma lista. */
function extractJobList() {
  if (isLinkedIn()) {
    const { vagas, fonte } = linkedInListJobs();
    return { vagas, fonte, plataforma: 'linkedin', focoJobId: linkedInIdFromUrl(location.href) };
  }
  return { vagas: [], fonte: '', plataforma: '', focoJobId: '' };
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'PING': {
          sendResponse({ success: true });
          break;
        }

        case 'GET_FORM_FIELDS': {
          // Perform a fresh scan to capture dynamic elements (Gupy, GreenHouse can render fields late)
          scanForm();
          sendResponse({
            success: true,
            fields: parsedFields,
            contexto: getPageContext(),
            idioma: (document.documentElement.lang || '').slice(0, 2).toLowerCase() || 'pt'
          });
          break;
        }

        case 'AUTOFILL_FORM': {
          const { results } = message.payload;
          const applied = [];
          const failed = [];

          // Fill sequentially to respect visual flow and prevent SPA lag
          for (const result of results) {
            const field = parsedFields.find(f => f.id === result.fieldId);
            if (!field) {
              failed.push({ question: result.fieldId, reason: 'campo saiu da página desde a varredura' });
              continue;
            }

            let fillValue = result.value;

            // Files travel as Base64 through the message channel
            if (result.type === 'file') {
              field.fileName = result.fileName || 'curriculo.pdf';
              field.mimeType = result.mimeType || 'application/pdf';
              if (typeof fillValue === 'string') {
                try {
                  fillValue = base64ToBlob(fillValue, field.mimeType);
                } catch (blobErr) {
                  console.error(`Erro ao converter base64 do arquivo: ${field.fileName}`, blobErr);
                  failed.push({ question: field.question, reason: 'arquivo inválido' });
                  continue;
                }
              }
            }

            const outcome = await window.formFiller.fill(field, fillValue);
            if (outcome && outcome.ok) {
              applied.push({ question: field.question, type: field.type, value: outcome.applied });
              // Save to autofilled values cache
              autofilledValues[field.id] = outcome.applied;
            } else {
              failed.push({ question: field.question, type: field.type, reason: (outcome && outcome.reason) || 'falhou' });
            }
          }
          const filledCount = applied.length;

          // Highlight any required fields that remain empty/unselected
          highlightEmptyRequiredFields(parsedFields);

          // Update upload button states for all fields
          parsedFields.forEach(field => {
            const btn = document.querySelector(`.autofill-upload-btn[data-field-id="${field.id}"]`);
            if (btn) {
              updateButtonState(btn, field);
            }
          });

          sendResponse({ success: true, filledCount, applied, failed });
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
          const info = extractJobPosting();
          auditLog('extract_job_info', {
            titulo: info.titulo, empresa: info.empresa, local: info.local, job_id: info.job_id,
            plataforma: info.plataforma, variante: info.variante, fonte: info.fonte,
            descricao: info.descricao.length, urlCanonica: info.url
          });
          sendResponse({ success: true, ...info });
          break;
        }

        case 'EXTRACT_JOB_LIST': {
          const lista = extractJobList();
          auditLog('extract_job_list', { n: lista.vagas.length, fonte: lista.fonte, focoJobId: lista.focoJobId });
          sendResponse({ success: true, ...lista });
          break;
        }

        default:
          sendResponse({ success: false, error: 'Ação do script de conteúdo desconhecida' });
      }
    } catch (err) {
      console.error('[Autofill IA] Erro no listener de mensagens:', err);
      auditLog('erro_pagina', { type: message && message.type, error: err.message });
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
      isEmpty = !String(readFieldValue(field) || '').trim();
    } catch (err) {
      console.warn(`Erro ao checar se campo está vazio: ${field.question}`, err);
    }

    if (field.required && isEmpty) {
      field.elementIds.forEach(id => {
        const el = window.domParser.getElement(id);
        if (el) {
          el.classList.add('autofill-failed');
          el.classList.remove('autofill-success');
          el.classList.remove('autofill-scanned');
        }
      });
    } else {
      field.elementIds.forEach(id => {
        const el = window.domParser.getElement(id);
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
      const el = window.domParser.getElement(id);
      if (el && !el.classList.contains('autofill-success')) {
        el.classList.add('autofill-scanned');
      }
    });
  });
}

// Remove highlights on user interaction to avoid cluttering the UI and handle upload button states
function handleFieldChange(e) {
  const target = e.target;
  const fieldElementId = target && target.getAttribute &&
    target.getAttribute(window.domParser.fieldAttribute);
  if (!fieldElementId) return;
  
  // Find which parsed field this element belongs to
  const field = parsedFields.find(f => f.elementIds.includes(fieldElementId));
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
    const el = window.domParser.getElement(field.elementIds[0]);
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
  const firstEl = window.domParser.getElement(field.elementIds[0]);
  if (!firstEl) return null;

  if (field.type === 'file') return null;

  const fieldset = firstEl.closest('fieldset');
  if (fieldset) {
    const legend = fieldset.querySelector('legend');
    if (legend) return { element: legend, position: 'beforeend' };
  }

  if (firstEl.id) {
    const root = window.domParser.getRoot(firstEl);
    const label = root.querySelector(`label[for="${CSS.escape(firstEl.id)}"]`);
    if (label) return { element: label, position: 'beforeend' };
  }

  if (field.type !== 'radio' && !(field.type === 'checkbox' && !field.standalone)) {
    const parentLabel = firstEl.closest('label');
    if (parentLabel) return { element: parentLabel, position: 'beforeend' };
  }

  if (field.type === 'radio' || (field.type === 'checkbox' && !field.standalone)) {
    const lastElId = field.elementIds[field.elementIds.length - 1];
    const lastEl = window.domParser.getElement(lastElId);
    if (lastEl) {
      const root = window.domParser.getRoot(lastEl);
      const lastLabel = lastEl.closest('label') || root.querySelector(`label[for="${CSS.escape(lastEl.id)}"]`);
      if (lastLabel) return { element: lastLabel, position: 'afterend' };
      return { element: lastEl, position: 'afterend' };
    }
  }

  return { element: firstEl, position: 'afterend' };
}

function injectUploadButtons(fields) {
  document.querySelectorAll('.autofill-upload-btn, .autofill-gen-btn').forEach(el => el.remove());
  if (!pageUiEnabled) return;

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

// A última resposta gerada pelo ⚡ fica guardada por página + pergunta: reabrir
// o modal mostra essa versão em vez de gastar outra geração.
const GENERATED_ANSWER_PREFIX = 'generatedAnswer::';
const MAX_GENERATED_ANSWERS = 200;

function generatedAnswerKey(field) {
  const pergunta = window.formFiller.normalize(field.question);
  return `${GENERATED_ANSWER_PREFIX}${location.origin}${location.pathname}::${pergunta}`;
}

async function loadGeneratedAnswer(field) {
  try {
    const key = generatedAnswerKey(field);
    const data = await chrome.storage.local.get(key);
    return data[key] || null;
  } catch (err) {
    console.warn('[Autofill IA] Não foi possível ler a resposta gerada salva:', err);
    return null;
  }
}

async function saveGeneratedAnswer(field, resposta, instrucao) {
  try {
    await chrome.storage.local.set({
      [generatedAnswerKey(field)]: { resposta, instrucao, updatedAt: Date.now() }
    });
    await pruneGeneratedAnswers();
  } catch (err) {
    console.warn('[Autofill IA] Não foi possível salvar a resposta gerada:', err);
  }
}

/** Mantém só as respostas mais recentes, para o storage não crescer sem limite. */
async function pruneGeneratedAnswers() {
  const all = await chrome.storage.local.get(null);
  const excess = Object.entries(all)
    .filter(([key]) => key.startsWith(GENERATED_ANSWER_PREFIX))
    .sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(MAX_GENERATED_ANSWERS)
    .map(([key]) => key);
  if (excess.length) await chrome.storage.local.remove(excess);
}

/**
 * O campo guardado no clique do ⚡ pode ter sido recriado pelo site enquanto o
 * modal estava aberto (React/Vue remontam o nó e o atributo da extensão some).
 * Nesse caso reencontra o campo pela pergunta numa varredura nova.
 */
function resolveLiveField(field) {
  if (window.domParser.getElement(field.elementIds[0])) return field;
  const current = window.domParser.parseForm();
  return current.find(f => f.id === field.id) ||
    current.find(f => f.type === field.type && f.question === field.question) ||
    null;
}

async function handleGenerateClick(field) {
  const salva = await loadGeneratedAnswer(field);
  showGenerateModal(field, salva);
}

function showGenerateModal(field, salva) {
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
        <div class="autofill-modal-group autofill-gen-result" hidden>
          <label class="autofill-modal-label">Resposta gerada</label>
          <textarea class="autofill-modal-textarea autofill-gen-answer" rows="5"></textarea>
          <div class="autofill-modal-hint autofill-gen-hint" hidden></div>
        </div>
      </div>
      <div class="autofill-modal-footer">
        <button type="button" class="autofill-modal-btn autofill-modal-btn-cancel">Cancelar</button>
        <button type="button" class="autofill-modal-btn autofill-modal-btn-confirm autofill-gen-submit">Gerar</button>
        <button type="button" class="autofill-modal-btn autofill-modal-btn-confirm autofill-gen-apply" hidden>Aprovar e preencher</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const cancelBtn = overlay.querySelector('.autofill-modal-btn-cancel');
  const generateBtn = overlay.querySelector('.autofill-gen-submit');
  const applyBtn = overlay.querySelector('.autofill-gen-apply');
  const instrucaoEl = overlay.querySelector('.autofill-instrucao-input');
  const resultEl = overlay.querySelector('.autofill-gen-result');
  const answerEl = overlay.querySelector('.autofill-gen-answer');
  const hintEl = overlay.querySelector('.autofill-gen-hint');

  // Versão já gravada no storage; edições feitas no modal são guardadas ao fechar
  let savedAnswer = salva ? salva.resposta : '';
  let busy = false;

  const setBusy = (value) => {
    busy = value;
    generateBtn.disabled = value;
    applyBtn.disabled = value;
  };

  const showAnswer = (resposta, savedAt) => {
    answerEl.value = resposta;
    resultEl.hidden = false;
    applyBtn.hidden = false;
    generateBtn.textContent = 'Gerar novamente';
    generateBtn.classList.replace('autofill-modal-btn-confirm', 'autofill-modal-btn-secondary');

    const avisos = [];
    if (savedAt) {
      const quando = new Date(savedAt).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      avisos.push(`Resposta gerada em ${quando}.`);
    }
    if (['text', 'textarea', 'combobox'].includes(field.type) && !isFieldEmpty(field)) {
      avisos.push('O campo já tem texto; ao aprovar, ele será substituído.');
    }
    hintEl.textContent = avisos.join(' ');
    hintEl.hidden = !avisos.length;
  };

  if (salva && salva.resposta) {
    instrucaoEl.value = salva.instrucao || '';
    showAnswer(salva.resposta, salva.updatedAt);
  }

  const close = () => {
    const atual = answerEl.value.trim();
    if (atual && atual !== savedAnswer) {
      savedAnswer = atual;
      saveGeneratedAnswer(field, atual, instrucaoEl.value.trim());
    }
    overlay.remove();
  };

  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  generateBtn.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    const label = generateBtn.textContent;
    generateBtn.textContent = 'Gerando...';
    const instrucao = instrucaoEl.value.trim();

    const resp = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({
          type: 'GENERATE_ANSWER',
          payload: {
            pergunta: field.question,
            contexto: getPageContext(),
            instrucao,
            idioma: /[a-zA-Z]/.test(field.question) && !/[áéíóúâêôãõç]/.test(field.question) ? 'en' : 'pt'
          }
        }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response);
        });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    });

    setBusy(false);
    generateBtn.textContent = label;
    const resposta = resp && resp.success ? String(resp.resposta || '').trim() : '';
    if (!resposta) {
      console.error('[Autofill IA] Falha ao gerar resposta:', resp);
      showToast(`Erro: ${(resp && resp.error) || 'falha ao gerar'}`, 'error');
      return;
    }

    savedAnswer = resposta;
    showAnswer(resposta);
    await saveGeneratedAnswer(field, resposta, instrucao);
  });

  applyBtn.addEventListener('click', async () => {
    if (busy) return;
    // Vale o texto que está no modal, inclusive se a pessoa editou
    const resposta = answerEl.value.trim();
    if (!resposta) {
      showToast('A resposta não pode ficar vazia.', 'error');
      return;
    }

    setBusy(true);
    const alvo = resolveLiveField(field);
    // A pessoa aprovou esta resposta para este campo: substitui o que houver nele
    const outcome = alvo
      ? await window.formFiller.fill(alvo, resposta, { overwrite: true })
      : { ok: false, reason: 'campo não está mais na página' };
    setBusy(false);

    if (!outcome || !outcome.ok) {
      console.warn(`[Autofill IA] Não preencheu "${field.question}":`, outcome);
      showToast(`Não foi possível preencher: ${(outcome && outcome.reason) || 'falhou'}`, 'error');
      return;
    }

    close();
    showToast('Resposta preenchida.', 'success');
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
