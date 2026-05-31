/**
 * Custom lightweight Supabase client using native fetch to keep the extension tiny and CSP-compliant.
 */
export class SupabaseClient {
  constructor(url, anonKey, serviceRoleKey) {
    this.url = url.replace(/\/$/, ''); // Remove trailing slash if any
    this.anonKey = anonKey;
    this.serviceRoleKey = serviceRoleKey;
  }

  /**
   * Helper to build request headers
   * @param {boolean} useServiceKey - True to use the service role key (for writes/storage), false for anon key (reads)
   * @returns {object} Headers
   */
  _headers(useServiceKey = false) {
    const key = useServiceKey ? this.serviceRoleKey : this.anonKey;
    return {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    };
  }

  /**
   * Tests the connection to Supabase and ensures the storage bucket exists
   */
  async testConnection() {
    try {
      // Test 1: Query qa_historico (limit 1)
      const res = await fetch(`${this.url}/rest/v1/qa_historico?limit=1`, {
        headers: this._headers(false)
      });
      
      if (!res.ok) {
        throw new Error(`Erro na conexão: HTTP ${res.status}`);
      }

      // Test 2: Try creating the bucket "recruitment-files" if it doesn't exist
      await this.createBucketIfNotExists('recruitment-files');

      return true;
    } catch (err) {
      console.error('Supabase connection test failed:', err);
      throw err;
    }
  }

  /**
   * Creates a storage bucket if it doesn't already exist
   */
  async createBucketIfNotExists(bucketId) {
    try {
      const res = await fetch(`${this.url}/storage/v1/bucket`, {
        method: 'POST',
        headers: {
          ...this._headers(true),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: bucketId,
          name: bucketId,
          public: false
        })
      });
      
      // 200/201 means created, 409 means already exists, which is fine
      if (!res.ok && res.status !== 409) {
        console.warn(`Aviso ao criar bucket: ${res.status}`);
      }
    } catch (err) {
      console.warn('Erro ao verificar/criar bucket de storage:', err);
    }
  }

  /**
   * Retrieves all professional profiles to build Gemini context
   */
  async getProfile() {
    const res = await fetch(`${this.url}/rest/v1/perfil_profissional?select=*`, {
      headers: this._headers(false)
    });
    if (!res.ok) throw new Error(`Falha ao ler perfil: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Exact match search on pregunta
   */
  async findExactAnswer(question) {
    const query = encodeURIComponent(question);
    const res = await fetch(`${this.url}/rest/v1/qa_historico?pergunta=eq.${query}&select=*`, {
      headers: this._headers(false)
    });
    if (!res.ok) throw new Error(`Falha na busca exata: ${res.statusText}`);
    const data = await res.json();
    return data.length > 0 ? data[0] : null;
  }

  /**
   * Semantic search using pgvector function match_questions
   */
  async findSemanticAnswer(embedding, threshold = 0.8) {
    const res = await fetch(`${this.url}/rest/v1/rpc/match_questions`, {
      method: 'POST',
      headers: {
        ...this._headers(false),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query_embedding: embedding,
        match_threshold: threshold,
        match_count: 1
      })
    });
    
    if (!res.ok) {
      console.warn(`Busca semântica falhou (RPC match_questions): ${res.statusText}`);
      return null;
    }
    
    const data = await res.json();
    return data.length > 0 ? data[0] : null;
  }

  /**
   * Upsert a question-answer pair with optional embedding
   */
  async saveAnswer(question, answer, language = 'pt', embedding = null) {
    const body = {
      pergunta: question,
      resposta: answer,
      idioma: language,
      updated_at: new Date().toISOString()
    };
    if (embedding) {
      body.embedding = embedding;
    }

    const res = await fetch(`${this.url}/rest/v1/qa_historico`, {
      method: 'POST',
      headers: {
        ...this._headers(true),
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Falha ao salvar resposta: ${errText}`);
    }
    return true;
  }

  /**
   * Upload file to Storage (CV or Cover Letter)
   * @param {string} fileName - Destination name (e.g. cv.pdf)
   * @param {ArrayBuffer|Blob} fileData - The raw file contents
   * @param {string} contentType - e.g. application/pdf
   */
  async uploadFile(fileName, fileData, contentType) {
    const res = await fetch(`${this.url}/storage/v1/object/recruitment-files/${fileName}`, {
      method: 'POST',
      headers: {
        ...this._headers(true),
        'Content-Type': contentType,
        'x-upsert': 'true'
      },
      body: fileData
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Falha no upload do arquivo ${fileName}: ${errText}`);
    }
    return true;
  }

  /**
   * Download file from Storage
   * @param {string} fileName - Name of the file to download
   * @returns {Promise<Blob>} The file as a Blob
   */
  async downloadFile(fileName) {
    const res = await fetch(`${this.url}/storage/v1/object/authenticated/recruitment-files/${fileName}`, {
      headers: this._headers(false)
    });

    if (!res.ok) {
      throw new Error(`Falha no download do arquivo ${fileName}: HTTP ${res.status}`);
    }
    return await res.blob();
  }
}
