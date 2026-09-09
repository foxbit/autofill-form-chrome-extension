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

  /**
   * Pede à IA que escolha entre as opções dos campos que o /fill não resolveu
   * (POST /fill-match). Rota separada por decisão do Hermes: /fill continua
   * síncrono e sem IA.
   * @param {Array<{id:string,label:string,type:string,options:string[]}>} fields
   * @param {string} contexto - descrição da vaga
   */
  async fillMatch(fields, contexto = '') {
    return await this._post('/fill-match', { fields, contexto });
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

  /**
   * Baixa um arquivo fixo do cofre (GET /arquivos/{tipo}) já em base64, porque
   * é assim que ele atravessa o canal de mensagens até o content script.
   * @param {'cv'|'cover-letter'} tipo
   * @param {string} idioma
   * @returns {Promise<{base64:string, fileName:string, mimeType:string}>}
   */
  async getArquivo(tipo, idioma = 'pt') {
    const res = await fetch(
      `${this.apiUrl}/arquivos/${encodeURIComponent(tipo)}?idioma=${encodeURIComponent(idioma)}`
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Hermes API ${res.status}: ${txt.slice(0, 200)}`);
    }

    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    const fileName = decodeURIComponent(match ? match[1] : `${tipo}.pdf`);
    const mimeType = res.headers.get('content-type') || 'application/pdf';
    const buffer = await res.arrayBuffer();

    // btoa em blocos: o service worker não tem FileReader e strings enormes
    // estouram o limite de argumentos de String.fromCharCode
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return { base64: btoa(binary), fileName, mimeType };
  }
}
