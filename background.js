import { storageManager } from './utils/storage-manager.js';
import { HermesClient } from './utils/hermes-client.js';

// Configura o painel lateral para abrir ao clicar no ícone da extensão
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Erro ao configurar Side Panel:', error));

// Cache do cliente Hermes (reinstancia só se a URL mudar)
let cachedHermes = null;
let lastApiUrl = '';

async function getClient() {
  const keys = await storageManager.getKeys();
  const apiUrl = keys.apiUrl || 'http://127.0.0.1:8790';
  if (!cachedHermes || lastApiUrl !== apiUrl) {
    cachedHermes = new HermesClient(apiUrl);
    lastApiUrl = apiUrl;
  }
  // Lido a cada mensagem: o modelo salvo no painel vale já na próxima chamada
  cachedHermes.modelo = keys.aiModel || '';
  return cachedHermes;
}

// Log de auditoria compartilhado com página e painel (chrome.storage.local.auditLog)
const AUDIT_LOG_MAX = 300;
let auditQueue = Promise.resolve();

function auditLog(evento, dados = {}) {
  console.debug('[Autofill IA]', evento, dados);
  auditQueue = auditQueue.then(async () => {
    try {
      const { auditLog: atual = [] } = await chrome.storage.local.get('auditLog');
      atual.push({ ts: new Date().toISOString(), origem: 'background', evento, dados });
      await chrome.storage.local.set({ auditLog: atual.slice(-AUDIT_LOG_MAX) });
    } catch (e) {
      /* só console */
    }
  });
  return auditQueue;
}

/** Chave de comparação de URL: sem hash, sem barra final, minúscula. */
function chaveUrl(url) {
  return String(url || '').trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
}

/**
 * Registra vagas no banco pulando as que já existem. O POST /capture
 * sobrescreve o arquivo da vaga (e volta o status para "nova"), então a
 * checagem contra GET /vagas vem antes de cada envio. Quando a API passar a
 * devolver `duplicada`, ela também é respeitada.
 * @returns {Promise<{itens:Array, banco_total:number}>} um item por vaga,
 *   com estado "nova" | "duplicada" | "falha"
 */
async function capturarVagas(client, vagas, plataforma) {
  const origem = plataforma === 'linkedin' ? ['extensao', 'linkedin'] : ['extensao'];
  const existentes = new Map();   // job_id ou chave de url -> vaga do banco
  let bancoTotal = null;
  try {
    const banco = await client.listVagas();
    bancoTotal = banco.total;
    for (const v of banco.vagas || []) {
      if (v.job_id) existentes.set(String(v.job_id), v);
      if (v.url) existentes.set(chaveUrl(v.url), v);
    }
  } catch (e) {
    // Sem a lista não dá para garantir que nada será sobrescrito
    throw new Error(`não foi possível ler o banco de vagas para evitar duplicatas: ${e.message}`);
  }

  const itens = [];
  for (const vaga of vagas) {
    const existente = (vaga.job_id && existentes.get(String(vaga.job_id))) || existentes.get(chaveUrl(vaga.url));
    if (existente) {
      itens.push({ ...vaga, estado: 'duplicada', existente: { status: existente.status, arquivo: existente.arquivo } });
      continue;
    }
    try {
      const data = await client.captureVaga({
        titulo: vaga.titulo,
        empresa: vaga.empresa || '',
        local: vaga.local || '',
        url: vaga.url || '',
        job_id: vaga.job_id || '',
        origem,
        observacoes: vaga.observacoes || ''
      });
      if (typeof data.banco_total === 'number') bancoTotal = data.banco_total;
      if (data.duplicada) {
        itens.push({ ...vaga, estado: 'duplicada', existente: { arquivo: data.arquivo } });
        continue;
      }
      itens.push({ ...vaga, estado: 'nova', arquivo: data.arquivo });
      // Cadastrada agora: um card repetido na mesma página não pode regravar
      if (vaga.job_id) existentes.set(String(vaga.job_id), vaga);
      if (vaga.url) existentes.set(chaveUrl(vaga.url), vaga);
    } catch (e) {
      console.error(`Falha ao capturar "${vaga.titulo}":`, e);
      itens.push({ ...vaga, estado: 'falha', motivo: e.message });
    }
  }
  return { itens, banco_total: bancoTotal };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {

        case 'TEST_CONNECTIONS': {
          const { apiUrl } = message.payload || {};
          const client = new HermesClient(apiUrl);
          await client.testConnection();
          sendResponse({ success: true });
          break;
        }

        case 'GET_MODELS': {
          const { apiUrl } = message.payload || {};
          const client = apiUrl ? new HermesClient(apiUrl) : await getClient();
          const data = await client.listModels();
          sendResponse({
            success: true,
            modelos: Array.isArray(data && data.modelos) ? data.modelos : [],
            // efetivo = o que o servidor usa quando a chamada não traz modelo
            efetivo: (data && (data.efetivo || data.padrao)) || '',
            fonte: (data && data.fonte) || ''
          });
          break;
        }

        case 'SET_ACTIVE_MODEL': {
          const { modelo } = message.payload || {};
          const client = await getClient();
          const data = modelo
            ? await client.setActiveModel(modelo)
            : await client.clearActiveModel();
          sendResponse({
            success: true,
            ativo: (data && data.ativo) || '',
            efetivo: (data && data.efetivo) || ''
          });
          break;
        }

        case 'GET_STATUS': {
          const client = await getClient();
          await client.testConnection();
          sendResponse({ success: true, connected: true });
          break;
        }

        case 'AUTOFILL_FIELDS': {
          const { fields, contexto = '', idioma = 'pt' } = message.payload;
          const client = await getClient();

          // Mapeia o formato do content script (question) para o da API (label).
          // As opções vão junto: quem escolhe qual marcar é o Hermes.
          const apiFields = fields.map((f) => ({
            id: f.id,
            label: f.question || f.name || '',
            type: f.type,
            options: (f.options || []).map((o) => o.label).filter(Boolean),
            required: !!f.required,
            multiple: !!f.multiple,
            standalone: !!f.standalone,
            accept: f.accept || ''
          }));

          const res = await client.fill(apiFields);
          const debugLogs = [];
          const results = [];
          const arquivos = new Map();   // tipo -> {base64, fileName, mimeType}

          for (const f of res.filled || []) {
            // Campos de arquivo: a API devolve qual documento usar ("cv",
            // "cover-letter") e o service worker baixa o PDF do cofre.
            if (f.type === 'file') {
              const tipo = String(f.value || 'cv');
              try {
                if (!arquivos.has(tipo)) {
                  arquivos.set(tipo, await client.getArquivo(tipo, idioma));
                }
                const arquivo = arquivos.get(tipo);
                results.push({
                  fieldId: f.id,
                  type: 'file',
                  value: arquivo.base64,
                  fileName: arquivo.fileName,
                  mimeType: arquivo.mimeType,
                  source: `arquivo:${tipo}`
                });
              } catch (e) {
                debugLogs.push(`[arquivo] falha ao buscar "${tipo}": ${e.message}`);
              }
              continue;
            }

            results.push({ fieldId: f.id, type: f.type, value: f.value, source: f.source });
          }

          let unmatched = res.unmatched || [];

          // Campos de escolha que a regra não resolveu: a IA decide dentro da
          // lista de opções (POST /fill-match). Campo sensível não entra aqui —
          // a API já o separou para revisão manual.
          const comOpcoes = unmatched.filter((u) => (u.options || []).length && u.reason !== 'campo sensível — responder manualmente');
          if (comOpcoes.length) {
            try {
              const match = await client.fillMatch(comOpcoes, contexto);
              for (const f of match.filled || []) {
                results.push({ fieldId: f.id, type: f.type, value: f.value, source: f.source });
              }
              const resolvidos = new Set((match.filled || []).map((f) => f.id));
              unmatched = unmatched.filter((u) => !resolvidos.has(u.id));
              if (resolvidos.size) debugLogs.push(`IA escolheu opção em ${resolvidos.size} campo(s).`);
            } catch (e) {
              debugLogs.push(`[fill-match] ${e.message}`);
            }
          }

          debugLogs.unshift(
            `Máquina de Vagas API: ${results.length} campo(s) resolvido(s), ${unmatched.length} para revisão manual.`
          );

          // Campos abertos: a IA redige, mas a resposta NÃO entra no formulário
          // sozinha. Regra do Hermes: fato do cofre é automático, opinião do
          // candidato passa pelo Angelo. Voltam como sugestão para aprovação.
          const abertos = unmatched
            .filter((u) => u.type !== 'file' && !(u.options && u.options.length))
            .slice(0, 5);
          const geradas = await Promise.all(abertos.map(async (u) => {
            try {
              const g = await client.generateAnswer(u.label, contexto, '', idioma);
              return g && g.resposta
                ? { fieldId: u.id, question: u.label, type: u.type, value: g.resposta, source: 'ia' }
                : null;
            } catch (e) {
              debugLogs.push(`[IA] falha p/ "${u.label}": ${e.message}`);
              return null;
            }
          }));
          const suggestions = geradas.filter(Boolean);
          if (suggestions.length) {
            debugLogs.push(`IA redigiu ${suggestions.length} resposta(s) — aguardando sua aprovação.`);
          }

          sendResponse({ success: true, results, unmatched, suggestions, debugLogs });
          break;
        }

        case 'SAVE_ANSWERS': {
          const { answers } = message.payload;
          const client = await getClient();
          for (const item of answers) {
            await client.learn(item.question, item.answer, item.language || 'pt');
          }
          sendResponse({ success: true });
          break;
        }

        case 'SAVE_SINGLE_ANSWER': {
          const { question, answer } = message.payload;
          const client = await getClient();
          await client.learn(question, answer, 'pt');
          sendResponse({ success: true });
          break;
        }

        case 'CHECK_QUESTION': {
          const { question } = message.payload;
          const client = await getClient();
          const existingAnswer = await client.findAnswer(question);
          sendResponse({ success: true, exists: !!existingAnswer, existingAnswer });
          break;
        }

        case 'GENERATE_ANSWER': {
          const { pergunta, contexto, instrucao, idioma } = message.payload;
          const client = await getClient();
          const res = await client.generateAnswer(pergunta, contexto || '', instrucao || '', idioma || 'pt');
          sendResponse({ success: true, resposta: res.resposta });
          break;
        }

        case 'CAPTURE_VAGA': {
          const { plataforma, ...vaga } = message.payload;
          const client = await getClient();
          const lote = await capturarVagas(client, [vaga], plataforma);
          const [resultado] = lote.itens;
          auditLog('capture_vaga', {
            titulo: vaga.titulo, job_id: vaga.job_id, url: vaga.url, plataforma,
            estado: resultado.estado, motivo: resultado.motivo, arquivo: resultado.arquivo, banco_total: lote.banco_total
          });
          sendResponse({
            success: resultado.estado !== 'falha',
            error: resultado.estado === 'falha' ? resultado.motivo : undefined,
            duplicada: resultado.estado === 'duplicada',
            existente: resultado.existente,
            arquivo: resultado.arquivo,
            banco_total: lote.banco_total
          });
          break;
        }

        case 'CAPTURE_VAGAS': {
          const { vagas, plataforma } = message.payload;
          const client = await getClient();
          const lote = await capturarVagas(client, vagas || [], plataforma);
          auditLog('capture_vagas', {
            n: (vagas || []).length, plataforma, banco_total: lote.banco_total,
            itens: lote.itens.map((i) => ({ job_id: i.job_id, estado: i.estado, motivo: i.motivo }))
          });
          sendResponse({ success: true, ...lote });
          break;
        }

        case 'GENERATE_CV': {
          const client = await getClient();
          const data = await client.generateCv(message.payload);
          sendResponse({ success: true, data });
          break;
        }

        default:
          sendResponse({ success: false, error: 'Ação de mensagem desconhecida' });
      }
    } catch (err) {
      console.error('Service worker message handler error:', err);
      auditLog('erro_background', { type: message && message.type, error: err.message });
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Mantém o canal aberto para respostas assíncronas
});
