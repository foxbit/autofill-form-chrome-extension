/**
 * Client for Google Gemini API using native fetch
 */
export class GeminiClient {
  constructor(apiKey, modelName = 'gemini-3.5-flash') {
    this.apiKey = apiKey;
    this.modelName = modelName || 'gemini-3.5-flash';
    this.embeddingModelName = 'gemini-embedding-2';
  }

  /**
   * Tests the connection to Google Gemini API
   */
  async testConnection() {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reponda apenas com a palavra OK se receber esta mensagem.' }] }]
        })
      });

      if (!res.ok) {
        throw new Error(`Erro na API Gemini: HTTP ${res.status}`);
      }
      return true;
    } catch (err) {
      console.error('Gemini connection test failed:', err);
      throw err;
    }
  }

  /**
   * Lists compatible text generation models from Gemini API
   * @returns {Promise<Array<{name: string, displayName: string, description: string}>>}
   */
  async listModels() {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Erro ao listar modelos: HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.models) return [];
      
      // Filter for gemini models that support generateContent
      return data.models
        .filter(m => m.supportedGenerationMethods.includes('generateContent') && m.name.includes('gemini'))
        .map(m => ({
          name: m.name.replace('models/', ''),
          displayName: m.displayName,
          description: m.description
        }));
    } catch (err) {
      console.warn('Failed to fetch live models from Gemini API, using fallbacks:', err);
      return [
        { name: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash (Recomendado)', description: 'Modelo padrão rápido com suporte a raciocínio.' },
        { name: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', description: 'Modelo rápido e de alta qualidade.' },
        { name: 'gemini-2.0-flash-lite-preview-02-05', displayName: 'Gemini 2.0 Flash Lite', description: 'Modelo ultra rápido e leve.' },
        { name: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', description: 'Modelo clássico equilibrado e eficiente.' },
        { name: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', description: 'Modelo de raciocínio avançado para perguntas complexas.' }
      ];
    }
  }

  /**
   * Generates embedding for a text (question)
   * @param {string} text - The question text
   * @returns {Promise<number[]>} 1536-dimension vector
   */
  async getEmbedding(text) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.embeddingModelName}:embedContent?key=${this.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: `models/${this.embeddingModelName}`,
          content: {
            parts: [{ text: text }]
          },
          outputDimensionality: 1536
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Erro de embedding: ${errText}`);
      }

      const data = await res.json();
      if (!data.embedding?.values) {
        throw new Error('Formato de resposta de embedding inválido');
      }

      return data.embedding.values;
    } catch (err) {
      console.error('Failed to get embedding:', err);
      throw err;
    }
  }

  /**
   * Generates a response based on the question and the user's professional profile
   * @param {string} question - The form question
   * @param {Array} profileItems - List of rows from perfil_profissional
   * @param {object} fieldDetails - Details like max length or select options
   * @returns {Promise<string>} Generated response
   */
  async generateAnswer(question, profileItems, fieldDetails = {}) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;
      
      // Format the profile items into a structured context
      const formattedContext = profileItems
        .map(item => `--- SEÇÃO: ${item.secao} (${item.titulo_bloco}) ---\n${item.conteudo}`)
        .join('\n\n');

      // Detect if the field is factual
      const factualKeywords = ['name', 'nome', 'email', 'phone', 'telef', 'celul', 'cidade', 'city', 'state', 'estado', 'zip', 'cep', 'country', 'país', 'pais', 'address', 'endereço', 'linkedin', 'portfolio', 'github', 'site', 'website', 'birth', 'nascimento'];
      const isFactual = factualKeywords.some(kw => question.toLowerCase().includes(kw)) && fieldDetails.type !== 'textarea';

      let inputTypeInstructions = '';
      let formatExamples = '';

      if (fieldDetails.type === 'select' || fieldDetails.type === 'radio') {
        const optionsStr = (fieldDetails.options || []).join(', ');
        inputTypeInstructions = `Esta é uma pergunta de MÚLTIPLA ESCOLHA.
As opções disponíveis no formulário são: [${optionsStr}].
Você DEVE escolher exatamente UMA dessas opções. Retorne APENAS o texto exato da opção selecionada, sem qualquer tipo de explicação, introdução, pontuação adicional ou aspas.`;
      } else if (fieldDetails.type === 'checkbox') {
        const optionsStr = (fieldDetails.options || []).join(', ');
        inputTypeInstructions = `Esta é uma pergunta de SELEÇÃO MÚLTIPLA (checkboxes).
As opções disponíveis no formulário são: [${optionsStr}].
Selecione as opções aplicáveis ao perfil. Retorne APENAS a lista de opções selecionadas separadas por vírgula.`;
      } else if (isFactual) {
        inputTypeInstructions = `Esta é uma pergunta FACTUAL CURTA.
Sua tarefa é encontrar o valor exato correspondente no perfil e retornar APENAS o valor limpo (ex: o e-mail, o nome próprio, o número de telefone, o CEP, a cidade, o país ou a URL).
Não use pronomes em primeira pessoa, não construa frases completas, não inclua explicações e não adicione pontuação final (como pontos finais).`;
        
        formatExamples = `EXEMPLOS DE RESPOSTAS FACTUAIS:
- Pergunta: "First Name" -> Resposta: "Angelo"
- Pergunta: "Email Address" -> Resposta: "angelorosa@gmail.com"
- Pergunta: "City" -> Resposta: "Curitiba"
- Pergunta: "State" -> Resposta: "Paraná"
- Pergunta: "LinkedIn URL" -> Resposta: "https://www.linkedin.com/in/angelowz"
- Pergunta: "Zip Code" -> Resposta: "80000-000"`;
      } else if (fieldDetails.type === 'textarea') {
        inputTypeInstructions = `Esta é uma pergunta ABERTA DE TEXTO LONGO.
Responda de forma profissional e detalhada em primeira pessoa (eu), citando projetos, responsabilidades, cases de sucesso, métricas (ex: redução de 40% no tempo de vendas) e resultados específicos do perfil do candidato.`;
        
        formatExamples = `EXEMPLOS DE RESPOSTAS ABERTAS:
- Pergunta: "Por que você quer trabalhar conosco?" -> Resposta: "Tenho grande interesse na vaga pois meu perfil de liderança de design de produto e experimentação se alinha perfeitamente com os objetivos de escala da empresa. Na Leany e Builders Venture Studio, estruturei e liderei equipes..."
- Pergunta: "Conte-me sobre um desafio técnico." -> Resposta: "No projeto SVA+ para o Carrefour Brasil, o desafio principal era digitalizar uma jornada de vendas física e analógica. Liderei o design da plataforma e os testes de usabilidade, resultando em uma redução de 40% no tempo médio de venda..."`;
      } else {
        inputTypeInstructions = `Esta é uma pergunta factual ou de texto curto.
Responda de forma direta e concisa (máximo de 1 frase).`;
      }

      const maxLengthInstruction = fieldDetails.maxLength
        ? `A resposta deve ter no MÁXIMO ${fieldDetails.maxLength} caracteres.`
        : '';

      const prompt = `Você é um assistente inteligente de recrutamento especializado em preenchimento de formulários de candidatura.
Sua tarefa é responder a uma pergunta de formulário baseando-se estritamente no perfil profissional do candidato fornecido abaixo.

--- INÍCIO DO PERFIL PROFISSIONAL DO CANDIDATO ---
${formattedContext}
--- FIM DO PERFIL PROFISSIONAL DO CANDIDATO ---

PERGUNTA A SER RESPONDIDA:
"${question}"

INSTRUÇÕES DE FORMATO:
1. Responda sempre no MESMO idioma em que a pergunta foi formulada (ex: se a pergunta estiver em inglês, responda em inglês).
2. Seja coerente com as informações do perfil. Não invente nenhuma informação falsa.
3. ${inputTypeInstructions}
4. ${maxLengthInstruction}

${formatExamples}

RESPOSTA:`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.15, // Low temperature for factual consistency
            maxOutputTokens: fieldDetails.type === 'textarea' ? 800 : 150
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Erro do Gemini: ${errText}`);
      }

      const data = await res.json();
      let answer = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      // Clean up whitespace
      answer = answer.trim();

      // If the field is a select/radio and the model returned quotes or a trailing period, clean it up
      if (fieldDetails.type === 'select' || fieldDetails.type === 'radio') {
        answer = answer.replace(/^["']|["']$/g, ''); // Remove wrapping quotes
        if (answer.endsWith('.')) {
          // If the selected option doesn't actually end with a dot, remove it
          const optionMatch = fieldDetails.options.find(opt => opt.toLowerCase() === answer.toLowerCase());
          if (!optionMatch && answer.endsWith('.')) {
            answer = answer.slice(0, -1);
          }
        }
      }

      // Respect limits
      if (fieldDetails.maxLength && answer.length > fieldDetails.maxLength) {
        answer = answer.slice(0, fieldDetails.maxLength);
      }

      return answer;
    } catch (err) {
      console.error('Failed to generate answer:', err);
      throw err;
    }
  }

  /**
   * Generates answers for multiple fields in a single API call to bypass 429 rate limits
   * @param {Array} fields - List of fields to generate answers for
   * @param {Array} profileItems - Candidate's professional profile
   * @returns {Promise<Array<{fieldId: string, value: string}>>} List of generated answers
   */
  async generateAnswersBatch(fields, profileItems) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;
      
      const formattedContext = profileItems
        .map(item => `--- SEÇÃO: ${item.secao} (${item.titulo_bloco}) ---\n${item.conteudo}`)
        .join('\n\n');

      const fieldsDescription = fields.map(f => {
        let details = `ID: ${f.id}, Tipo: ${f.type}, Pergunta: "${f.question}"`;
        if (f.options && f.options.length > 0) {
          details += `, Opções: [${f.options.join(', ')}]`;
        }
        if (f.maxLength) {
          details += `, Caracteres Máximos: ${f.maxLength}`;
        }
        return details;
      }).join('\n');

      const prompt = `Você é um assistente de recrutamento especializado em preenchimento de formulários de candidatura.
Sua tarefa é responder a uma lista de perguntas do formulário baseando-se estritamente no perfil profissional do candidato fornecido abaixo.

--- INÍCIO DO PERFIL PROFISSIONAL DO CANDIDATO ---
${formattedContext}
--- FIM DO PERFIL PROFISSIONAL DO CANDIDATO ---

LISTA DE CAMPOS A PREENCHER:
${fieldsDescription}

INSTRUÇÕES DE PREENCHIMENTO:
1. Responda sempre no mesmo idioma em que a pergunta do campo foi formulada (ex: pergunta em inglês -> resposta em inglês).
2. Seja coerente com o perfil do candidato. Não invente informações falsas.
3. Para campos 'text' ou 'textarea':
   - Se for um campo factual curto (nome, email, telefone, linkedin, localidade, CEP, etc.), retorne APENAS o valor limpo (ex: o e-mail, o nome próprio, o número de telefone, o CEP, a cidade, o país ou a URL). Não use pronomes em primeira pessoa, não construa frases completas, não inclua explicações e não adicione pontuação final (como pontos finais).
   - Se for um textarea ou pergunta aberta longa, responda detalhadamente em primeira pessoa ("eu"), citando conquistas e métricas do perfil.
4. Para campos 'select' ou 'radio' (MÚLTIPLA ESCOLHA):
   - Você DEVE escolher exatamente uma das opções fornecidas na lista 'Opções' de cada campo. Retorne o texto exato da opção selecionada.
5. Para campos 'checkbox' (SELEÇÃO MÚLTIPLA):
   - Escolha as opções aplicáveis e retorne-as separadas por vírgula.
6. Respeite o limite 'Caracteres Máximos' se especificado.

Você deve responder no formato JSON estruturado com uma lista de respostas correspondendo a cada ID de campo:
{
  "answers": [
    {
      "fieldId": "ID_DO_CAMPO",
      "value": "VALOR_DA_RESPOSTA"
    }
  ]
}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.15,
            responseMimeType: "application/json"
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Erro do Gemini Batch: ${errText}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      
      try {
        const parsed = JSON.parse(text);
        return parsed.answers || [];
      } catch (jsonErr) {
        console.error('Failed to parse Gemini batch response:', text, jsonErr);
        return [];
      }
    } catch (err) {
      console.error('Failed to generate answers batch:', err);
      throw err;
    }
  }
}
