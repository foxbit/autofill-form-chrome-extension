/**
 * Utility to fill form fields, simulating realistic user input.
 * Only handles text inputs (text, textarea) and file inputs.
 */
window.formFiller = {
  /**
   * Main entry point to fill a logical field with a value
   * @param {object} field - Field metadata parsed by dom-parser.js
   * @param {any} value - Value to fill (string or Blob for files)
   * @returns {Promise<boolean>} True if filled successfully
   */
  async fill(field, value) {
    if (value === null || value === undefined) return false;

    // Skip already-filled text fields
    if (field.type === 'text' || field.type === 'textarea') {
      const el = window.domParser.getElement(field.elementIds[0]);
      if (el && el.value && el.value.trim() !== '') {
        console.log(`Pular campo preenchido: ${field.question}`);
        return false;
      }
    }

    try {
      switch (field.type) {
        case 'text':
        case 'textarea':
          return await this.fillText(field.elementIds[0], String(value));

        case 'file':
          if (value instanceof Blob) {
            return await this.fillFile(field.elementIds[0], value, field.question);
          }
          console.warn('Para preencher arquivos, é necessário passar um objeto Blob.');
          return false;

        default:
          return false;
      }
    } catch (err) {
      console.error(`Erro ao preencher campo ${field.question}:`, err);
      return false;
    }
  },

  /**
   * Simulates typing character-by-character to satisfy SPAs (React, Vue, Angular)
   */
  async fillText(elementId, text) {
    const el = window.domParser.getElement(elementId);
    if (!el) return false;

    el.focus();

    el.value = '';
    let currentVal = '';

    // Type with a tiny delay (2ms) so it's both fast and triggers event handlers
    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));

      currentVal += char;
      el.value = currentVal;

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));

      await new Promise(resolve => setTimeout(resolve, 2));
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();

    el.classList.add('autofill-success');
    el.classList.remove('autofill-failed');
    el.classList.remove('autofill-scanned');
    el.classList.add('autofilled-by-extension');
    return true;
  },

  /**
   * Injects Blob file data into an input[type="file"] element
   */
  async fillFile(elementId, fileBlob, questionText) {
    const el = window.domParser.getElement(elementId);
    if (!el) return false;

    let fileName = 'cv.pdf';
    const qLower = questionText.toLowerCase();
    if (qLower.includes('carta') || qLower.includes('cover') || qLower.includes('apresentacao') || qLower.includes('apresentação')) {
      fileName = 'carta_apresentacao.pdf';
    }

    try {
      const file = new File([fileBlob], fileName, { type: 'application/pdf' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      el.files = dataTransfer.files;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.classList.add('autofill-success');
      el.classList.remove('autofill-failed');
      el.classList.remove('autofill-scanned');
      el.classList.add('autofilled-by-extension');

      console.log(`Injetado com sucesso arquivo: ${fileName} no campo: ${questionText}`);
      return true;
    } catch (err) {
      console.error('Failed to inject file via DataTransfer API:', err);
      return false;
    }
  }
};
