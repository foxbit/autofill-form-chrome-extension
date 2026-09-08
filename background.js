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
