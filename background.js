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
  if (cachedHermes && lastApiUrl === apiUrl) return cachedHermes;
  cachedHermes = new HermesClient(apiUrl);
  lastApiUrl = apiUrl;
  return cachedHermes;
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

        case 'GET_STATUS': {
          const client = await getClient();
          await client.testConnection();
          sendResponse({ success: true, connected: true });
          break;
        }

        case 'AUTOFILL_FIELDS': {
          const { fields, contexto = '' } = message.payload;
          const client = await getClient();

          // Mapeia o formato do content script (question) para o da API (label)
          const apiFields = fields.map((f) => ({
            id: f.id,
            label: f.question || f.name || '',
            type: f.type
          }));

          const res = await client.fill(apiFields);
          const results = (res.filled || []).map((f) => ({
            fieldId: f.id,
            type: f.type,
            value: f.value,
            source: f.source
          }));
          const unmatched = res.unmatched || [];
          const debugLogs = [
            `Máquina de Vagas API: ${results.length} campo(s) preenchido(s), ${unmatched.length} para revisão manual.`
          ];

          // Auto-gera respostas para campos abertos não resolvidos (máx. 5)
          let generated = 0;
          for (const u of unmatched.slice(0, 5)) {
            if (u.type === 'file') continue;
            const lang = /[a-zA-Z]/.test(u.label) && !/[áéíóúâêôãõç]/.test(u.label) ? 'en' : 'pt';
            try {
              const g = await client.generateAnswer(u.label, contexto, '', lang);
              if (g && g.resposta) {
                results.push({ fieldId: u.id, type: u.type, value: g.resposta, source: 'ia' });
                generated++;
              }
            } catch (e) {
              debugLogs.push(`[IA] falha p/ "${u.label}": ${e.message}`);
            }
          }
          if (generated) debugLogs.push(`IA gerou ${generated} resposta(s).`);

          sendResponse({ success: true, results, unmatched, debugLogs });
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
          const client = await getClient();
          const data = await client.captureVaga(message.payload);
          sendResponse({ success: true, data });
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
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Mantém o canal aberto para respostas assíncronas
});
