/**
 * Configuração local da extensão — URL da API do Hermes, idioma e o modelo de
 * IA escolhido no painel (vazio = padrão do servidor).
 */
export const storageManager = {
  async getKeys() {
    return await chrome.storage.local.get(['apiUrl', 'targetLanguage', 'aiModel']);
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
