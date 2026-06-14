/**
 * Utility to manage the extension's local configuration keys
 */
export const storageManager = {
  /**
   * Retrieves all stored API keys
   * @returns {Promise<object>} Stored credentials
   */
  async getKeys() {
    return await chrome.storage.local.get([
      'supabaseUrl',
      'supabaseAnonKey',
      'supabaseServiceKey',
      // LLM provider selection
      'llmProvider',      // 'gemini' | 'openrouter' | 'ollama'
      // Gemini
      'geminiApiKey',
      'geminiModelName',
      // OpenRouter
      'openrouterApiKey',
      'openrouterModel',
      // Ollama
      'ollamaUrl',
      'ollamaModel'
    ]);
  },

  /**
   * Saves API keys
   * @param {object} keys - Object containing keys to save
   */
  async setKeys(keys) {
    await chrome.storage.local.set({
      supabaseUrl:        keys.supabaseUrl        || '',
      supabaseAnonKey:    keys.supabaseAnonKey    || '',
      supabaseServiceKey: keys.supabaseServiceKey || '',
      // LLM provider
      llmProvider:        keys.llmProvider        || 'gemini',
      // Gemini
      geminiApiKey:       keys.geminiApiKey       || '',
      geminiModelName:    keys.geminiModelName    || 'gemini-2.0-flash',
      // OpenRouter
      openrouterApiKey:   keys.openrouterApiKey   || '',
      openrouterModel:    keys.openrouterModel    || 'openai/gpt-4o-mini',
      // Ollama
      ollamaUrl:          keys.ollamaUrl          || 'http://localhost:11434',
      ollamaModel:        keys.ollamaModel        || 'llama3.2'
    });
  },

  /**
   * Clears all stored keys
   */
  async clearKeys() {
    await chrome.storage.local.remove([
      'supabaseUrl',
      'supabaseAnonKey',
      'supabaseServiceKey',
      'llmProvider',
      'geminiApiKey',
      'geminiModelName',
      'openrouterApiKey',
      'openrouterModel',
      'ollamaUrl',
      'ollamaModel'
    ]);
  }
};
