/**
 * Utility to fill form fields, simulating realistic user input.
 */
window.formFiller = {
  /**
   * Main entry point to fill a logical field with a value
   * @param {object} field - Field metadata parsed by dom-parser.js
   * @param {any} value - Value to fill (string, boolean, array, or Blob for files)
   * @returns {Promise<boolean>} True if filled successfully
   */
  async fill(field, value) {
    if (value === null || value === undefined) return false;

    // Check if field is already filled (except for files or buttons where we overwrite)
    if (field.type === 'text' || field.type === 'textarea') {
      const el = document.getElementById(field.elementIds[0]);
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
          
        case 'select':
          return this.fillSelect(field.elementIds[0], String(value), field.options);
          
        case 'radio':
          return this.fillRadio(field.optionElements, String(value));
          
        case 'checkbox':
          if (field.standalone) {
            return this.fillStandaloneCheckbox(field.elementIds[0], value);
          } else {
            return this.fillGroupCheckbox(field.optionElements, value);
          }
          
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
    const el = document.getElementById(elementId);
    if (!el) return false;

    el.focus();
    
    // Set value directly if empty, then trigger input events
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
   * Matches and selects option in dropdown
   */
  fillSelect(elementId, value, optionsList) {
    const el = document.getElementById(elementId);
    if (!el) return false;

    const matchedOption = this.findBestMatch(value, Array.from(el.options), opt => opt.text);
    if (matchedOption) {
      el.value = matchedOption.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.classList.add('autofill-success');
      el.classList.remove('autofill-failed');
      el.classList.remove('autofill-scanned');
      el.classList.add('autofilled-by-extension');
      return true;
    }
    
    return false;
  },

  /**
   * Clicks the correct radio option based on text matching
   */
  fillRadio(optionElements, value) {
    const matchedOption = this.findBestMatch(value, optionElements, opt => opt.text);
    if (matchedOption) {
      const radio = document.getElementById(matchedOption.elementId);
      if (radio) {
        radio.click();
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        radio.classList.add('autofill-success');
        radio.classList.remove('autofill-failed');
        radio.classList.remove('autofill-scanned');
        radio.classList.add('autofilled-by-extension');
        return true;
      }
    }
    return false;
  },

  /**
   * Checked standalone terms & conditions checkbox
   */
  fillStandaloneCheckbox(elementId, value) {
    const el = document.getElementById(elementId);
    if (!el) return false;

    // Evaluate truthiness
    const isTrue = value === true || 
                   value === 'true' || 
                   value === 1 || 
                   /^(sim|yes|ok|true|aceito|confirm|s)$/i.test(String(value).trim());

    if (isTrue) {
      if (!el.checked) {
        el.click();
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      el.classList.add('autofill-success');
      el.classList.remove('autofill-failed');
      el.classList.remove('autofill-scanned');
      el.classList.add('autofilled-by-extension');
      return true;
    }
    return false;
  },

  /**
   * Selects multiple options in checkbox group
   */
  fillGroupCheckbox(optionElements, value) {
    let selectedValues = [];
    if (Array.isArray(value)) {
      selectedValues = value;
    } else if (typeof value === 'string') {
      // Split by comma or semicolon
      selectedValues = value.split(/[;,]/).map(v => v.trim());
    } else {
      selectedValues = [String(value)];
    }

    let checkAny = false;
    selectedValues.forEach(val => {
      const matchedOption = this.findBestMatch(val, optionElements, opt => opt.text);
      if (matchedOption) {
        const checkbox = document.getElementById(matchedOption.elementId);
        if (checkbox) {
          if (!checkbox.checked) {
            checkbox.click();
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
          }
          checkbox.classList.add('autofill-success');
          checkbox.classList.remove('autofill-failed');
          checkbox.classList.remove('autofill-scanned');
          checkbox.classList.add('autofilled-by-extension');
          checkAny = true;
        }
      }
    });

    return checkAny;
  },

  /**
   * Injects Blob file data into an input[type="file"] element
   */
  async fillFile(elementId, fileBlob, questionText) {
    const el = document.getElementById(elementId);
    if (!el) return false;

    // Detect if we should use CV or Cover Letter
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
  },

  /**
   * Heuristic to find the best match in a list of options
   * @param {string} search - Value to look for
   * @param {Array} items - List of option items
   * @param {Function} textSelector - Function to extract text from item
   * @returns {any} Matched item or null
   */
  findBestMatch(search, items, textSelector) {
    if (!search || !items || items.length === 0) return null;
    const searchLower = search.toLowerCase().trim();

    // 1. Exact match
    const exact = items.find(item => textSelector(item).toLowerCase().trim() === searchLower);
    if (exact) return exact;

    // 2. Starts with / includes match
    const prefix = items.find(item => {
      const itemText = textSelector(item).toLowerCase().trim();
      return itemText.startsWith(searchLower) || searchLower.startsWith(itemText);
    });
    if (prefix) return prefix;

    const contains = items.find(item => {
      const itemText = textSelector(item).toLowerCase().trim();
      return itemText.includes(searchLower) || searchLower.includes(itemText);
    });
    if (contains) return contains;

    return null; // No reasonable match found
  }
};
