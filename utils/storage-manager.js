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
      'geminiApiKey',
      'geminiModelName'
    ]);
  },

  /**
   * Saves API keys
   * @param {object} keys - Object containing keys to save
   */
  async setKeys(keys) {
    await chrome.storage.local.set({
      supabaseUrl: keys.supabaseUrl || '',
      supabaseAnonKey: keys.supabaseAnonKey || '',
      supabaseServiceKey: keys.supabaseServiceKey || '',
      geminiApiKey: keys.geminiApiKey || '',
      geminiModelName: keys.geminiModelName || 'gemini-3.5-flash'
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
      'geminiApiKey',
      'geminiModelName'
    ]);
  }
};
