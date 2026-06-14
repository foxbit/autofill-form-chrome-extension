/**
 * Unified LLM Client — supports Gemini, OpenRouter and Ollama (local)
 *
 * Provider: 'gemini' | 'openrouter' | 'ollama'
 *
 * Config shape:
 *  - gemini:      { apiKey, model }
 *  - openrouter:  { apiKey, model }
 *  - ollama:      { ollamaUrl, model }
 */
export class LLMClient {
  constructor(provider, config = {}) {
    this.provider = provider || 'gemini';
    this.config = config;
    this.modelName = config.model || this._defaultModel();
  }

  _defaultModel() {
    switch (this.provider) {
      case 'openrouter': return 'openai/gpt-4o-mini';
      case 'ollama':     return 'llama3.2';
      default:           return 'gemini-2.0-flash';
    }
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────

  /**
   * Tests the connection to the configured LLM provider.
   * Throws on failure.
   */
  async testConnection() {
    switch (this.provider) {
      case 'gemini':      return this._geminiTest();
      case 'openrouter':  return this._openrouterTest();
      case 'ollama':      return this._ollamaTest();
      default:            throw new Error(`Provedor desconhecido: ${this.provider}`);
    }
  }

  /**
   * Lists available models for the configured provider.
   * @returns {Promise<Array<{name: string, displayName: string, description: string}>>}
   */
  async listModels() {
    switch (this.provider) {
      case 'gemini':      return this._geminiListModels();
      case 'openrouter':  return this._openrouterListModels();
      case 'ollama':      return this._ollamaListModels();
      default:            return [];
    }
  }

  /**
   * Generates embedding vector for a text.
   * Only available for Gemini. Returns null for other providers.
   * @param {string} text
   * @returns {Promise<number[]|null>}
   */
  async getEmbedding(text) {
    if (this.provider !== 'gemini') return null;
    return this._geminiGetEmbedding(text);
  }

  /**
   * Generates answers for multiple fields in a single API call.
   * @param {Array} fields
   * @param {Array} profileItems
   * @param {string} [targetLanguage='pt'] - 'pt' | 'en' | 'es'
   * @returns {Promise<Array<{fieldId: string, value: string}>>}
   */
  async generateAnswersBatch(fields, profileItems, targetLanguage = 'pt') {
    switch (this.provider) {
      case 'gemini':      return this._geminiGenerateBatch(fields, profileItems, targetLanguage);
      case 'openrouter':  return this._openrouterGenerateBatch(fields, profileItems, targetLanguage);
      case 'ollama':      return this._ollamaGenerateBatch(fields, profileItems, targetLanguage);
      default:            throw new Error(`Provedor desconhecido: ${this.provider}`);
    }
  }

  // ─────────────────────────────────────────────
  // SHARED PROMPT BUILDER
  // ─────────────────────────────────────────────

  /**
   * Builds the batch prompt for all providers.
   * @param {Array} fields
   * @param {Array} profileItems
   * @param {string} targetLanguage - 'pt' | 'en' | 'es'
   */
  _buildBatchPrompt(fields, profileItems, targetLanguage = 'pt') {
    const languageNames = { pt: 'Português (PT-BR)', en: 'English', es: 'Español' };
    const languageName = languageNames[targetLanguage] || 'Português (PT-BR)';

    const formattedContext = profileItems
      .map(item => `--- SEÇÃO: ${item.secao} (${item.titulo_bloco}) ---\n${item.conteudo}`)
      .join('\n\n');

    const fieldsDescription = fields.map(f => {
      let details = `ID: ${f.id}, Tipo: ${f.type}, Pergunta: "${f.question}"`;
      if (f.maxLength) details += `, Caracteres Máximos: ${f.maxLength}`;
      return details;
    }).join('\n');

    return `Você é um assistente de recrutamento especializado em preenchimento de formulários de candidatura.
Sua tarefa é responder a uma lista de perguntas de texto do formulário baseando-se estritamente no perfil profissional do candidato fornecido abaixo.

--- INÍCIO DO PERFIL PROFISSIONAL DO CANDIDATO ---
${formattedContext}
--- FIM DO PERFIL PROFISSIONAL DO CANDIDATO ---

LISTA DE CAMPOS A PREENCHER:
${fieldsDescription}

INSTRUÇÕES DE PREENCHIMENTO:
1. **IDIOMA OBRIGATÓRIO**: Responda SEMPRE em ${languageName}. Não use nenhum outro idioma, independentemente do idioma da pergunta.
2. Seja coerente com o perfil do candidato. Não invente informações falsas.
3. Para campos 'text' (texto curto):
   - Se for um campo factual (nome, email, telefone, linkedin, localidade, CEP, etc.), retorne APENAS o valor limpo. Não use pronomes em primeira pessoa, não construa frases completas e não adicione pontuação final.
   - Se for uma pergunta aberta curta, responda de forma direta e concisa (máximo 1 frase).
4. Para campos 'textarea' (texto longo):
   - Responda detalhadamente em primeira pessoa ("eu"/"I"/"Yo" conforme o idioma), citando conquistas, projetos e métricas do perfil.
5. Respeite o limite 'Caracteres Máximos' se especificado.

Você deve responder SOMENTE com o JSON abaixo, sem texto adicional antes ou depois:
{
  "answers": [
    {
      "fieldId": "ID_DO_CAMPO",
      "value": "VALOR_DA_RESPOSTA"
    }
  ]
}`;
  }

  _parseBatchJSON(text) {
    try {
      // Strip markdown code fences if present
      const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(clean);
      return parsed.answers || [];
    } catch (err) {
      console.error('LLMClient: Falha ao parsear resposta JSON do batch:', text, err);
      return [];
    }
  }

  // ─────────────────────────────────────────────
  // GEMINI IMPLEMENTATION
  // ─────────────────────────────────────────────

  get _geminiBaseUrl() {
    return `https://generativelanguage.googleapis.com/v1beta`;
  }

  async _geminiTest() {
    const url = `${this._geminiBaseUrl}/models/${this.modelName}:generateContent?key=${this.config.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'OK' }] }] })
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    return true;
  }

  async _geminiListModels() {
    try {
      const url = `${this._geminiBaseUrl}/models?key=${this.config.apiKey}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.models) return [];
      return data.models
        .filter(m => m.supportedGenerationMethods.includes('generateContent') && m.name.includes('gemini'))
        .map(m => ({
          name: m.name.replace('models/', ''),
          displayName: m.displayName,
          description: m.description || ''
        }));
    } catch {
      return [
        { name: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash (Recomendado)', description: '' },
        { name: 'gemini-2.0-flash-lite-preview-02-05', displayName: 'Gemini 2.0 Flash Lite', description: '' },
        { name: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', description: '' },
        { name: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', description: '' }
      ];
    }
  }

  async _geminiGetEmbedding(text) {
    const embModel = 'gemini-embedding-2';
    const url = `${this._geminiBaseUrl}/models/${embModel}:embedContent?key=${this.config.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${embModel}`,
        content: { parts: [{ text }] },
        outputDimensionality: 1536
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini embedding error: ${errText}`);
    }
    const data = await res.json();
    if (!data.embedding?.values) throw new Error('Invalid embedding response');
    return data.embedding.values;
  }

  async _geminiGenerateBatch(fields, profileItems, targetLanguage = 'pt') {
    const url = `${this._geminiBaseUrl}/models/${this.modelName}:generateContent?key=${this.config.apiKey}`;
    const prompt = this._buildBatchPrompt(fields, profileItems, targetLanguage);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.15,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini Batch error: ${errText}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return this._parseBatchJSON(text);
  }

  // ─────────────────────────────────────────────
  // OPENROUTER IMPLEMENTATION
  // ─────────────────────────────────────────────

  get _openrouterBaseUrl() {
    return 'https://openrouter.ai/api/v1';
  }

  _openrouterHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      'HTTP-Referer': 'chrome-extension://autofill-ia',
      'X-Title': 'Autofill IA'
    };
  }

  async _openrouterTest() {
    const res = await fetch(`${this._openrouterBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: this._openrouterHeaders(),
      body: JSON.stringify({
        model: this.modelName,
        messages: [{ role: 'user', content: 'Responda apenas OK.' }],
        max_tokens: 10
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenRouter HTTP ${res.status}: ${errText}`);
    }
    return true;
  }

  async _openrouterListModels() {
    try {
      const res = await fetch(`${this._openrouterBaseUrl}/models`, {
        headers: this._openrouterHeaders()
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.data) return [];

      // Sort by name, prioritize free models
      return data.data
        .filter(m => m.id && m.name)
        .sort((a, b) => {
          const aFree = a.pricing?.prompt === '0';
          const bFree = b.pricing?.prompt === '0';
          if (aFree && !bFree) return -1;
          if (!aFree && bFree) return 1;
          return a.name.localeCompare(b.name);
        })
        .map(m => ({
          name: m.id,
          displayName: m.name + (m.pricing?.prompt === '0' ? ' (Grátis)' : ''),
          description: m.description || ''
        }));
    } catch (err) {
      console.warn('OpenRouter: falha ao listar modelos:', err);
      // Curated fallbacks
      return [
        { name: 'openai/gpt-4o-mini', displayName: 'GPT-4o Mini (Recomendado)', description: 'OpenAI - rápido e eficiente' },
        { name: 'openai/gpt-4o', displayName: 'GPT-4o', description: 'OpenAI - alta qualidade' },
        { name: 'anthropic/claude-3-haiku', displayName: 'Claude 3 Haiku', description: 'Anthropic - rápido' },
        { name: 'anthropic/claude-3.5-sonnet', displayName: 'Claude 3.5 Sonnet', description: 'Anthropic - alta qualidade' },
        { name: 'meta-llama/llama-3.2-3b-instruct:free', displayName: 'Llama 3.2 3B (Grátis)', description: 'Meta - grátis' },
        { name: 'mistralai/mistral-7b-instruct:free', displayName: 'Mistral 7B (Grátis)', description: 'Mistral - grátis' }
      ];
    }
  }

  async _openrouterGenerateBatch(fields, profileItems, targetLanguage = 'pt') {
    const prompt = this._buildBatchPrompt(fields, profileItems, targetLanguage);

    const res = await fetch(`${this._openrouterBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: this._openrouterHeaders(),
      body: JSON.stringify({
        model: this.modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.15,
        response_format: { type: 'json_object' }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenRouter Batch error: ${errText}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '{}';
    return this._parseBatchJSON(text);
  }

  // ─────────────────────────────────────────────
  // OLLAMA IMPLEMENTATION
  // ─────────────────────────────────────────────

  get _ollamaBaseUrl() {
    return (this.config.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
  }

  async _ollamaTest() {
    const res = await fetch(`${this._ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        messages: [{ role: 'user', content: 'Responda apenas OK.' }],
        stream: false
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama HTTP ${res.status}: ${errText}`);
    }
    return true;
  }

  async _ollamaListModels() {
    try {
      const res = await fetch(`${this._ollamaBaseUrl}/api/tags`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.models) return [];
      return data.models.map(m => ({
        name: m.name,
        displayName: m.name,
        description: `${(m.size / 1e9).toFixed(1)} GB`
      }));
    } catch (err) {
      console.warn('Ollama: falha ao listar modelos:', err);
      return [];
    }
  }

  async _ollamaGenerateBatch(fields, profileItems, targetLanguage = 'pt') {
    const prompt = this._buildBatchPrompt(fields, profileItems, targetLanguage);

    const res = await fetch(`${this._ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        format: 'json',
        options: { temperature: 0.15 }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama Batch error: ${errText}`);
    }

    const data = await res.json();
    const text = data.message?.content || '{}';
    return this._parseBatchJSON(text);
  }
}
