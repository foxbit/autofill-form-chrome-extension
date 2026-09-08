/**
 * HermesClient — cliente leve (fetch nativo) para a API da Máquina de Vagas.
 * Substitui Supabase + LLM direto: perfil, QA, preenchimento, captura e CV
 * passam a ser servidos pela API do Hermes (FastAPI no servidor interno).
 */
export class HermesClient {
  constructor(apiUrl) {
    this.apiUrl = (apiUrl || 'http://127.0.0.1:8790').replace(/\/$/, '');
  }

  async _get(path) {
    const res = await fetch(`${this.apiUrl}${path}`);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Hermes API ${res.status}: ${txt.slice(0, 200)}`);
    }
    return await res.json();
  }

  async _post(path, body) {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Hermes API ${res.status}: ${txt.slice(0, 200)}`);
    }
    return await res.json();
  }

  /** Testa a conexão com a API (GET /health). */
  async testConnection() {
    const d = await this._get('/health');
    if (!d || !d.ok) throw new Error('Resposta inesperada de /health');
    return true;
  }

  /** Perfil canônico do cofre (GET /profile). */
  async getProfile() {
    return await this._get('/profile');
  }

  /**
   * Preenche campos do formulário (POST /fill).
   * @param {Array<{id:string,label:string,type:string}>} fields
   * @returns {Promise<{filled:Array, unmatched:Array}>}
   */
  async fill(fields) {
    return await this._post('/fill', { fields });
  }

  /** Grava/atualiza uma resposta aprendida (POST /learn). */
  async learn(pergunta, resposta, idioma = 'pt') {
    return await this._post('/learn', { pergunta, resposta, idioma });
  }

  /** Busca resposta já aprendida para uma pergunta (GET /qa). */
  async findAnswer(question) {
    const d = await this._get(`/qa?q=${encodeURIComponent(question)}&limit=1`);
    const r = d && d.resultados && d.resultados[0];
    return r ? r.resposta : null;
  }

  /** Gera resposta para uma pergunta aberta via IA (POST /generate). */
  async generateAnswer(pergunta, contexto = '', instrucao = '', idioma = 'pt') {
    return await this._post('/generate', { pergunta, contexto, instrucao, idioma });
  }

  /** Registra uma vaga capturada manualmente (POST /capture). */
  async captureVaga(payload) {
    return await this._post('/capture', payload);
  }

  /** Gera currículo personalizado em PDF (POST /cv). */
  async generateCv(payload) {
    return await this._post('/cv', payload);
  }
}
