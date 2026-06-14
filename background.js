import { storageManager } from './utils/storage-manager.js';
import { SupabaseClient } from './utils/supabase-client.js';
import { LLMClient } from './utils/llm-client.js';

// Configura o painel lateral para abrir ao clicar no ícone da extensão
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Erro ao configurar Side Panel:', error));

// Cache active clients to avoid instantiating on every message if keys didn't change
let cachedSupabase = null;
let cachedLLM = null;
let lastKeysHash = '';

/**
 * Generates a simple hash string for comparing configurations
 */
function getKeysHash(keys) {
  return `${keys.supabaseUrl}-${keys.supabaseAnonKey}-${keys.supabaseServiceKey}-${keys.llmProvider}-${keys.geminiApiKey}-${keys.geminiModelName}-${keys.openrouterApiKey}-${keys.openrouterModel}-${keys.ollamaUrl}-${keys.ollamaModel}`;
}

/**
 * Builds an LLMClient from saved keys
 */
function buildLLMClient(keys) {
  const provider = keys.llmProvider || 'gemini';

  switch (provider) {
    case 'openrouter':
      return new LLMClient('openrouter', {
        apiKey: keys.openrouterApiKey,
        model: keys.openrouterModel || 'openai/gpt-4o-mini'
      });
    case 'ollama':
      return new LLMClient('ollama', {
        ollamaUrl: keys.ollamaUrl || 'http://localhost:11434',
        model: keys.ollamaModel || 'llama3.2'
      });
    default: // 'gemini'
      return new LLMClient('gemini', {
        apiKey: keys.geminiApiKey,
        model: keys.geminiModelName || 'gemini-2.0-flash'
      });
  }
}

/**
 * Validates that the required keys for the active provider are present
 */
function validateLLMKeys(keys) {
  const provider = keys.llmProvider || 'gemini';
  if (!keys.supabaseUrl || !keys.supabaseAnonKey || !keys.supabaseServiceKey) {
    throw new Error('Configuração de Supabase incompleta. Abra a extensão e insira as chaves.');
  }
  if (provider === 'gemini' && !keys.geminiApiKey) {
    throw new Error('Chave do Gemini não configurada. Abra a extensão e insira a chave.');
  }
  if (provider === 'openrouter' && !keys.openrouterApiKey) {
    throw new Error('Chave do OpenRouter não configurada. Abra a extensão e insira a chave.');
  }
  if (provider === 'ollama' && !keys.ollamaUrl) {
    throw new Error('URL do Ollama não configurada. Abra a extensão e insira a URL do servidor.');
  }
}

/**
 * Retrieves or initializes Supabase and LLM clients
 */
async function getClients() {
  const keys = await storageManager.getKeys();
  validateLLMKeys(keys);

  const currentHash = getKeysHash(keys);
  if (cachedSupabase && cachedLLM && lastKeysHash === currentHash) {
    return { supabase: cachedSupabase, llm: cachedLLM };
  }

  cachedSupabase = new SupabaseClient(keys.supabaseUrl, keys.supabaseAnonKey, keys.supabaseServiceKey);
  cachedLLM = buildLLMClient(keys);
  lastKeysHash = currentHash;

  return { supabase: cachedSupabase, llm: cachedLLM };
}

// Utility to convert Blob to Base64 in Service Worker
async function blobToBase64(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Event listener for runtime messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {

        case 'TEST_CONNECTIONS': {
          const {
            supabaseUrl, supabaseAnonKey, supabaseServiceKey,
            llmProvider,
            geminiApiKey, geminiModelName,
            openrouterApiKey, openrouterModel,
            ollamaUrl, ollamaModel
          } = message.payload;

          // Build temp Supabase client
          const tempSupabase = new SupabaseClient(supabaseUrl, supabaseAnonKey, supabaseServiceKey);

          // Build temp LLM client based on provider
          const tempLLM = buildLLMClient({
            llmProvider,
            geminiApiKey, geminiModelName,
            openrouterApiKey, openrouterModel,
            ollamaUrl, ollamaModel
          });

          // Test LLM first (more likely to fail with wrong keys)
          await tempLLM.testConnection();

          // Test Supabase
          await tempSupabase.testConnection();

          sendResponse({ success: true });
          break;
        }

        case 'LIST_MODELS': {
          const { provider, geminiApiKey, openrouterApiKey, ollamaUrl } = message.payload;

          const tempLLM = buildLLMClient({
            llmProvider: provider,
            geminiApiKey,
            openrouterApiKey,
            ollamaUrl: ollamaUrl || 'http://localhost:11434'
          });

          const models = await tempLLM.listModels();
          sendResponse({ success: true, models });
          break;
        }

        case 'GET_STATUS': {
          try {
            const { supabase, llm } = await getClients();
            await supabase.testConnection();
            await llm.testConnection();
            sendResponse({ success: true, connected: true });
          } catch (err) {
            sendResponse({ success: false, connected: false, error: err.message });
          }
          break;
        }

        case 'AUTOFILL_FIELDS': {
          const { fields, targetLanguage = 'pt' } = message.payload;
          const debugLogs = [];

          try {
            const { supabase, llm } = await getClients();
            debugLogs.push(`Iniciando preenchimento usando [${llm.provider.toUpperCase()}] ${llm.modelName}`);

            debugLogs.push(`Buscando dados do perfil profissional no Supabase...`);
            const profile = await supabase.getProfile();
            debugLogs.push(`Perfil profissional carregado (${profile.length} blocos de informação encontrados).`);

            const results = [];
            const fieldsToGenerate = [];
            const fieldEmbeddings = {};

            // Process each field
            for (const field of fields) {
              try {
                // 1. File field handling
                if (field.type === 'file') {
                  let fileName = 'cv.pdf';
                  const qLower = field.question.toLowerCase();
                  if (qLower.includes('carta') || qLower.includes('cover') || qLower.includes('apresentacao') || qLower.includes('apresentação')) {
                    fileName = 'carta_apresentacao.pdf';
                  }
                  try {
                    const blob = await supabase.downloadFile(fileName);
                    const base64 = await blobToBase64(blob);
                    results.push({ fieldId: field.id, type: 'file', value: base64, fileName, source: 'supabase_storage' });
                    debugLogs.push(`[Arquivo] Campo "${field.question}" mapeado usando ${fileName} do Storage.`);
                  } catch (fileErr) {
                    debugLogs.push(`[Arquivo] Campo "${field.question}" ignorado (arquivo ${fileName} ausente no Storage).`);
                  }
                  continue;
                }

                // 2. Exact Match in history
                const exactMatch = await supabase.findExactAnswer(field.question);
                if (exactMatch) {
                  results.push({ fieldId: field.id, type: field.type, value: exactMatch.resposta, source: 'exact_match' });
                  debugLogs.push(`[Histórico Exato] Campo "${field.question}" resolvido.`);
                  continue;
                }

                // 3. Semantic match — only available when provider is 'gemini'
                if (llm.provider === 'gemini') {
                  let semanticMatch = null;
                  let embedding = null;

                  try {
                    embedding = await llm.getEmbedding(field.question);
                    fieldEmbeddings[field.id] = embedding;
                    semanticMatch = await supabase.findSemanticAnswer(embedding, 0.8);
                  } catch (embedErr) {
                    console.warn('Falha ao gerar embedding ou busca semântica:', embedErr);
                  }

                  if (semanticMatch) {
                    results.push({ fieldId: field.id, type: field.type, value: semanticMatch.resposta, source: 'semantic_match' });
                    debugLogs.push(`[Busca Semântica] Campo "${field.question}" resolvido.`);
                    continue;
                  }
                }

                // Collect for batch generation
                fieldsToGenerate.push(field);
              } catch (fieldErr) {
                console.error(`Falha ao pré-processar campo: ${field.question}`, fieldErr);
                debugLogs.push(`[Erro] Erro no pré-processamento do campo "${field.question}": ${fieldErr.message}`);
              }
            }

            // 4. Batch generate answers using the LLM
            if (fieldsToGenerate.length > 0) {
              debugLogs.push(`Solicitando resposta da IA para ${fieldsToGenerate.length} campos... [Idioma: ${targetLanguage.toUpperCase()}]`);
              try {
                const batchResults = await llm.generateAnswersBatch(fieldsToGenerate, profile, targetLanguage);
                debugLogs.push(`IA respondeu com sucesso para os campos pendentes.`);

                batchResults.forEach(res => {
                  const field = fieldsToGenerate.find(f => f.id === res.fieldId);
                  if (field) {
                    results.push({
                      fieldId: field.id,
                      type: field.type,
                      value: res.value,
                      source: `${llm.provider}_generation`,
                      language: targetLanguage,
                      embedding: fieldEmbeddings[field.id] || null
                    });
                    debugLogs.push(`[IA] Campo "${field.question}" preenchido.`);
                  }
                });
              } catch (batchErr) {
                console.error('Falha na geração em lote:', batchErr);
                debugLogs.push(`[Erro IA] Falha na API ${llm.provider} (${llm.modelName}): ${batchErr.message}`);
                throw new Error(`Falha na API ${llm.provider} (${llm.modelName}): ${batchErr.message}`);
              }
            }

            sendResponse({ success: true, results, debugLogs });
          } catch (err) {
            console.error('Autofill fields failed:', err);
            sendResponse({ success: false, error: err.message, debugLogs });
          }
          break;
        }

        case 'SAVE_ANSWERS': {
          const { answers } = message.payload;
          const { supabase, llm } = await getClients();

          for (const item of answers) {
            try {
              let embedding = item.embedding;
              // Embeddings only supported on Gemini
              if (!embedding && llm.provider === 'gemini') {
                embedding = await llm.getEmbedding(item.question);
              }

              let language = item.language;
              if (!language) {
                const isEnglish = /[a-zA-Z]/g.test(item.question) &&
                  (item.question.toLowerCase().includes('why') ||
                   item.question.toLowerCase().includes('what') ||
                   item.question.toLowerCase().includes('resume') ||
                   item.question.toLowerCase().includes('experience'));
                language = isEnglish ? 'en' : 'pt';
              }

              await supabase.saveAnswer(item.question, item.answer, language, embedding);
            } catch (saveErr) {
              console.error(`Falha ao salvar Q&A no Supabase: ${item.question}`, saveErr);
            }
          }

          sendResponse({ success: true });
          break;
        }

        case 'CHECK_QUESTION': {
          const { question } = message.payload;
          const { supabase, llm } = await getClients();

          const exactMatch = await supabase.findExactAnswer(question);
          if (exactMatch) {
            sendResponse({ success: true, exists: true, existingAnswer: exactMatch.resposta });
            break;
          }

          let semanticMatch = null;
          if (llm.provider === 'gemini') {
            try {
              const embedding = await llm.getEmbedding(question);
              semanticMatch = await supabase.findSemanticAnswer(embedding, 0.8);
            } catch (embedErr) {
              console.warn('Falha ao gerar embedding para verificação semântica:', embedErr);
            }
          }

          if (semanticMatch) {
            sendResponse({ success: true, exists: true, existingAnswer: semanticMatch.resposta });
          } else {
            sendResponse({ success: true, exists: false });
          }
          break;
        }

        case 'SAVE_SINGLE_ANSWER': {
          const { question, answer } = message.payload;
          const { supabase, llm } = await getClients();

          let embedding = null;
          if (llm.provider === 'gemini') {
            embedding = await llm.getEmbedding(question);
          }

          const isEnglish = /[a-zA-Z]/g.test(question) &&
            (question.toLowerCase().includes('why') ||
             question.toLowerCase().includes('what') ||
             question.toLowerCase().includes('resume') ||
             question.toLowerCase().includes('experience'));
          const language = isEnglish ? 'en' : 'pt';

          await supabase.saveAnswer(question, answer, language, embedding);

          sendResponse({ success: true });
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

  return true; // Keep message channel open for asynchronous responses
});
