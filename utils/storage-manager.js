/**
 * Configuração local da extensão — agora só a URL da API do Hermes e o idioma.
 */
export const storageManager = {
  async getKeys() {
    return await chrome.storage.local.get(['apiUrl', 'targetLanguage']);
  },

  async setKeys(keys) {
    await chrome.storage.local.set({
      apiUrl: (keys.apiUrl || 'http://127.0.0.1:8790').trim(),
      targetLanguage: keys.targetLanguage || 'pt'
    });
  },

  async clearKeys() {
    await chrome.storage.local.remove(['apiUrl', 'targetLanguage']);
  }
};
