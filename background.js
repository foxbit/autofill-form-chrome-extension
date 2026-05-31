import { storageManager } from './utils/storage-manager.js';
import { SupabaseClient } from './utils/supabase-client.js';
import { GeminiClient } from './utils/gemini-client.js';

// Configura o painel lateral para abrir ao clicar no ícone da extensão
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Erro ao configurar Side Panel:', error));

// Cache active clients to avoid instantiating on every message if keys didn't change
let cachedSupabase = null;
let cachedGemini = null;
let lastKeysHash = '';

/**
 * Generates a simple hash string for comparing configurations
 */
function getKeysHash(keys) {
  return `${keys.supabaseUrl}-${keys.supabaseAnonKey}-${keys.supabaseServiceKey}-${keys.geminiApiKey}`;
}

/**
 * Retrieves or initializes Supabase and Gemini clients
 */
async function getClients() {
  const keys = await storageManager.getKeys();
  
  if (!keys.supabaseUrl || !keys.supabaseAnonKey || !keys.supabaseServiceKey || !keys.geminiApiKey) {
    throw new Error('Configuração incompleta. Abra a extensão e insira as chaves.');
  }

  const currentHash = getKeysHash(keys);
  if (cachedSupabase && cachedGemini && lastKeysHash === currentHash) {
    return { supabase: cachedSupabase, gemini: cachedGemini };
  }

  cachedSupabase = new SupabaseClient(keys.supabaseUrl, keys.supabaseAnonKey, keys.supabaseServiceKey);
  cachedGemini = new GeminiClient(keys.geminiApiKey, keys.geminiModelName);
  lastKeysHash = currentHash;

  return { supabase: cachedSupabase, gemini: cachedGemini };
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
  // Execute async block
  (async () => {
    try {
      switch (message.type) {
        case 'TEST_CONNECTIONS': {
          const { supabaseUrl, supabaseAnonKey, supabaseServiceKey, geminiApiKey, geminiModelName } = message.payload;
          
          // Instantiate temp clients
          const tempSupabase = new SupabaseClient(supabaseUrl, supabaseAnonKey, supabaseServiceKey);
          const tempGemini = new GeminiClient(geminiApiKey, geminiModelName);

          // Test Gemini
          await tempGemini.testConnection();
          
          // Test Supabase
          await tempSupabase.testConnection();

          sendResponse({ success: true });
          break;
        }

        case 'LIST_MODELS': {
          const { geminiApiKey } = message.payload;
          const tempGemini = new GeminiClient(geminiApiKey);
          const models = await tempGemini.listModels();
          sendResponse({ success: true, models });
          break;
        }

        case 'GET_STATUS': {
          try {
            const { supabase, gemini } = await getClients();
            // Try connecting to verify active status
            await supabase.testConnection();
            await gemini.testConnection();
            sendResponse({ success: true, connected: true });
          } catch (err) {
            sendResponse({ success: false, connected: false, error: err.message });
          }
          break;
        }

        case 'AUTOFILL_FIELDS': {
          const { fields } = message.payload;
          const debugLogs = [];
          
          try {
            const { supabase, gemini } = await getClients();
            debugLogs.push(`Iniciando preenchimento usando o modelo: ${gemini.modelName}`);

            // Fetch profile
            debugLogs.push(`Buscando dados do perfil profissional no Supabase...`);
            const profile = await supabase.getProfile();
            debugLogs.push(`Perfil profissional carregado (${profile.length} blocos de informação encontrados).`);

            const results = [];
            const fieldsToGenerate = [];
            const fieldEmbeddings = {}; // Map of fieldId -> embedding

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
                    
                    results.push({
                      fieldId: field.id,
                      type: 'file',
                      value: base64,
                      fileName: fileName,
                      source: 'supabase_storage'
                    });
                    debugLogs.push(`[Arquivo] Campo "${field.question}" mapeado usando ${fileName} do Storage.`);
                  } catch (fileErr) {
                    debugLogs.push(`[Arquivo] Campo "${field.question}" ignorado (arquivo ${fileName} ausente no Storage).`);
                  }
                  continue;
                }

                // 2. Exact Match in history
                const exactMatch = await supabase.findExactAnswer(field.question);
                if (exactMatch) {
                  results.push({
                    fieldId: field.id,
                    type: field.type,
                    value: exactMatch.resposta,
                    source: 'exact_match'
                  });
                  debugLogs.push(`[Histórico Exato] Campo "${field.question}" resolvido.`);
                  continue;
                }

                // 3. Semantic match (pgvector)
                let semanticMatch = null;
                let embedding = null;
                
                try {
                  // Generate embedding of the question
                  embedding = await gemini.getEmbedding(field.question);
                  fieldEmbeddings[field.id] = embedding;
                  semanticMatch = await supabase.findSemanticAnswer(embedding, 0.8);
                } catch (embedErr) {
                  console.warn('Falha ao gerar embedding ou busca semântica:', embedErr);
                }

                if (semanticMatch) {
                  results.push({
                    fieldId: field.id,
                    type: field.type,
                    value: semanticMatch.resposta,
                    source: 'semantic_match'
                  });
                  debugLogs.push(`[Busca Semântica] Campo "${field.question}" resolvido.`);
                  continue;
                }

                // Collect for batch generation
                fieldsToGenerate.push(field);
              } catch (fieldErr) {
                console.error(`Falha ao pré-processar campo: ${field.question}`, fieldErr);
                debugLogs.push(`[Erro] Erro no pré-processamento do campo "${field.question}": ${fieldErr.message}`);
              }
            }

            // 4. Batch generate answers using Gemini
            if (fieldsToGenerate.length > 0) {
              debugLogs.push(`Solicitando resposta da IA para ${fieldsToGenerate.length} campos...`);
              try {
                const batchResults = await gemini.generateAnswersBatch(fieldsToGenerate, profile);
                debugLogs.push(`IA respondeu com sucesso para os campos pendentes.`);
                
                batchResults.forEach(res => {
                  const field = fieldsToGenerate.find(f => f.id === res.fieldId);
                  if (field) {
                    // Check language of question
                    const isEnglish = /[a-zA-Z]/g.test(field.question) && 
                                      (field.question.toLowerCase().includes('why') || 
                                       field.question.toLowerCase().includes('what') || 
                                       field.question.toLowerCase().includes('resume') ||
                                       field.question.toLowerCase().includes('salary') ||
                                       field.question.toLowerCase().includes('experience'));
                    
                    const language = isEnglish ? 'en' : 'pt';

                    results.push({
                      fieldId: field.id,
                      type: field.type,
                      value: res.value,
                      source: 'gemini_generation',
                      language: language,
                      embedding: fieldEmbeddings[field.id] || null // Keep embedding in case user saves it later
                    });
                    debugLogs.push(`[IA] Campo "${field.question}" preenchido.`);
                  }
                });
              } catch (batchErr) {
                console.error('Falha na geração em lote do Gemini:', batchErr);
                debugLogs.push(`[Erro IA] Falha na API Gemini (${gemini.modelName}): ${batchErr.message}`);
                throw new Error(`Falha na API Gemini (${gemini.modelName}): ${batchErr.message}`);
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
          const { supabase, gemini } = await getClients();

          for (const item of answers) {
            try {
              // 1. Generate embedding if not provided
              let embedding = item.embedding;
              if (!embedding) {
                embedding = await gemini.getEmbedding(item.question);
              }

              // 2. Detect language if not provided
              let language = item.language;
              if (!language) {
                const isEnglish = /[a-zA-Z]/g.test(item.question) && 
                                 (item.question.toLowerCase().includes('why') || 
                                  item.question.toLowerCase().includes('what') || 
                                  item.question.toLowerCase().includes('resume') ||
                                  item.question.toLowerCase().includes('experience'));
                language = isEnglish ? 'en' : 'pt';
              }

              // 3. Save to Supabase
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
          const { supabase, gemini } = await getClients();

          // 1. Search for exact match
          const exactMatch = await supabase.findExactAnswer(question);
          if (exactMatch) {
            sendResponse({ success: true, exists: true, existingAnswer: exactMatch.resposta });
            break;
          }

          // 2. Search for semantic match (vector distance <= 0.2 / cosine similarity >= 0.8)
          let semanticMatch = null;
          try {
            const embedding = await gemini.getEmbedding(question);
            semanticMatch = await supabase.findSemanticAnswer(embedding, 0.8);
          } catch (embedErr) {
            console.warn('Falha ao gerar embedding para verificação semântica:', embedErr);
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
          const { supabase, gemini } = await getClients();

          // 1. Generate embedding for the question
          const embedding = await gemini.getEmbedding(question);

          // 2. Detect language
          const isEnglish = /[a-zA-Z]/g.test(question) && 
                           (question.toLowerCase().includes('why') || 
                            question.toLowerCase().includes('what') || 
                            question.toLowerCase().includes('resume') ||
                            question.toLowerCase().includes('experience'));
          const language = isEnglish ? 'en' : 'pt';

          // 3. Save / Upsert to Supabase
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
