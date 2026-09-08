/**
 * Utility to parse the DOM and identify form fields and their associated questions.
 */
window.domParser = {
  fieldAttribute: 'data-autofill-field-id',

  /**
   * Returns the root that owns an element. Labels and controls inside an open
   * Shadow DOM are not visible to document.querySelector().
   */
  getRoot(el) {
    const root = el && el.getRootNode ? el.getRootNode() : document;
    return root && typeof root.querySelector === 'function' ? root : document;
  },

  /**
   * Finds inputs in the document and in every open Shadow DOM tree. Dialog
   * libraries commonly render their content in those trees.
   */
  getFormControls() {
    const controls = [];
    const roots = [document];
    const visited = new Set();

    while (roots.length) {
      const root = roots.pop();
      if (!root || visited.has(root)) continue;
      visited.add(root);

      controls.push(...root.querySelectorAll('input, textarea'));
      root.querySelectorAll('*').forEach((node) => {
        if (node.shadowRoot && node.shadowRoot.mode === 'open') {
          roots.push(node.shadowRoot);
        }
      });
    }

    return controls;
  },

  /** Finds a parsed field even when it lives inside an open Shadow DOM. */
  getElement(fieldId) {
    if (!fieldId) return null;
    const selector = `[${this.fieldAttribute}="${CSS.escape(fieldId)}"]`;
    const roots = [document];
    const visited = new Set();

    while (roots.length) {
      const root = roots.pop();
      if (!root || visited.has(root)) continue;
      visited.add(root);

      const match = root.querySelector(selector);
      if (match) return match;
      root.querySelectorAll('*').forEach((node) => {
        if (node.shadowRoot && node.shadowRoot.mode === 'open') {
          roots.push(node.shadowRoot);
        }
      });
    }

    return null;
  },

  getOrCreateFieldId(el) {
    let id = el.getAttribute(this.fieldAttribute);
    if (!id) {
      id = `autofill-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
      el.setAttribute(this.fieldAttribute, id);
    }
    return id;
  },

  /**
   * Cleans question text by removing required marks (*), colons, and excess whitespace
   * @param {string} text - Raw label text
   * @returns {string} Cleaned question text
   */
  cleanQuestion(text) {
    if (!text) return '';
    return text
      .replace(/\s*\*\s*$/, '') // Remove trailing asterisks (required field indicators)
      .replace(/\s*:\s*$/, '')  // Remove trailing colons
      .replace(/\s*\(\s*opcional\s*\)\s*$/i, '') // Remove (opcional) in PT
      .replace(/\s*\(\s*optional\s*\)\s*$/i, '')  // Remove (optional) in EN
      .replace(/\s+/g, ' ')     // Normalize spaces
      .trim();
  },

  /**
   * Checks if an element is visible on the page
   * @param {HTMLElement} el - Element to check
   * @returns {boolean} True if visible
   */
  isVisible(el) {
    if (!el) return false;
    let current = el;

    // Walk the composed tree so a hidden host also hides controls rendered in
    // its Shadow DOM. Do not reject opacity: 0: many modal/file components
    // keep the real editable input transparent and render a custom UI above it.
    while (current) {
      const style = window.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
      if (current.getAttribute && current.getAttribute('aria-hidden') === 'true') {
        return false;
      }

      if (current.parentElement) {
        current = current.parentElement;
      } else {
        const root = current.getRootNode && current.getRootNode();
        current = root && root.host ? root.host : null;
      }
    }
    
    return true;
  },

  /**
   * Finds the question text associated with an input element
   * @param {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} input - The input element
   * @returns {string} Associated question text
   */
  getQuestion(input) {
    const root = this.getRoot(input);

    // 1. Check for explicit label with 'for' attribute
    if (input.id) {
      const label = root.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label && label.innerText.trim()) {
        return this.cleanQuestion(label.innerText);
      }
    }

    // 2. Check if wrapped in a label
    const parentLabel = input.closest('label');
    if (parentLabel && parentLabel.innerText.trim()) {
      // Extract only text nodes that are not the input itself
      let text = '';
      for (const node of parentLabel.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE && node !== input && node.tagName !== 'SELECT' && node.tagName !== 'TEXTAREA') {
          text += ' ' + node.innerText;
        }
      }
      text = text.trim();
      if (text) {
        return this.cleanQuestion(text);
      }
      return this.cleanQuestion(parentLabel.innerText);
    }

    // 3. Aria attributes
    if (input.getAttribute('aria-label')) {
      return this.cleanQuestion(input.getAttribute('aria-label'));
    }
    const ariaLabelledBy = input.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      for (const labelId of ariaLabelledBy.split(/\s+/)) {
        const labelEl = root.querySelector(`#${CSS.escape(labelId)}`);
        if (labelEl && labelEl.innerText.trim()) {
          return this.cleanQuestion(labelEl.innerText);
        }
      }
    }

    // 4. Input placeholders or title
    if (input.placeholder && input.placeholder.trim()) {
      return this.cleanQuestion(input.placeholder);
    }
    if (input.title && input.title.trim()) {
      return this.cleanQuestion(input.title);
    }

    // 5. Walk up parents to find label text (heuristics for complex forms like Gupy/Workday)
    let parent = input.parentElement;
    let depth = 0;
    while (parent && depth < 4) {
      // Look for elements commonly containing label text
      const potentialLabels = parent.querySelectorAll('label, p, span, div, h3, h4, legend');
      for (const el of potentialLabels) {
        // Ensure it's not containing the input directly (to avoid double match) or if it does, it has distinct text
        if (el !== input && !el.contains(input) && this.isVisible(el)) {
          const classStr = el.className ? String(el.className).toLowerCase() : '';
          const idStr = el.id ? String(el.id).toLowerCase() : '';
          
          if (
            classStr.includes('label') ||
            classStr.includes('title') ||
            classStr.includes('question') ||
            classStr.includes('header') ||
            idStr.includes('label') ||
            idStr.includes('question')
          ) {
            const text = el.innerText.trim();
            if (text && text.length > 2 && text.length < 300) {
              return this.cleanQuestion(text);
            }
          }
        }
      }
      
      // Fallback: if there's a clear preceding sibling text block
      const sibling = parent.previousElementSibling;
      if (sibling && this.isVisible(sibling)) {
        const text = sibling.innerText.trim();
        if (text && text.length > 2 && text.length < 300) {
          return this.cleanQuestion(text);
        }
      }

      parent = parent.parentElement;
      depth++;
    }

    // 6. Name attribute fallback
    if (input.name) {
      // Convert camelCase or snake_case name to readable text
      const nameText = input.name
        .replace(/[-_]/g, ' ')
        .replace(/([A-Z])/g, ' $1')
        .trim();
      return this.cleanQuestion(nameText);
    }

    return '';
  },

  /**
   * Detects if an input is a combobox / autocomplete that opens a dropdown.
   * These should be ignored — filling them triggers dropdown UI and we cannot reliably select an option.
   * @param {HTMLElement} el
   * @returns {boolean}
   */
  isCombobox(el) {
    // Explicit ARIA role
    if (el.getAttribute('role') === 'combobox') return true;

    // aria-haspopup signals that typing opens a popup list
    const haspopup = el.getAttribute('aria-haspopup');
    if (haspopup && haspopup !== 'false') return true;

    // aria-autocomplete="list" or "both" — opens suggestion list
    const autocomplete = el.getAttribute('aria-autocomplete');
    if (autocomplete === 'list' || autocomplete === 'both') return true;

    // HTML datalist attached via list= attribute
    if (el.getAttribute('list')) return true;

    // Parent element has role="combobox" (common pattern in custom components)
    const parentCombo = el.closest('[role="combobox"]');
    if (parentCombo && parentCombo !== el) return true;

    // autocomplete attribute set to a specific named list (not on/off/name/email etc.)
    // Some platforms use this to link server-side autocomplete
    const nativeAC = (el.getAttribute('autocomplete') || '').toLowerCase();
    // Skip if class/id hints combobox (common in Greenhouse, Lever, Workday)
    const classStr = (el.className || '').toLowerCase();
    const idStr = (el.id || '').toLowerCase();
    if (
      classStr.includes('combobox') ||
      classStr.includes('autocomplete') ||
      classStr.includes('typeahead') ||
      idStr.includes('combobox') ||
      idStr.includes('autocomplete')
    ) return true;

    return false;
  },

  /**
   * Scrapes all visible inputs and groups them as logical questions
   * @returns {object[]} List of identified form fields
   */
  parseForm() {
    const fields = [];

    // Query only text inputs, textareas and file inputs — skip select, radio, checkbox
    const elements = this.getFormControls();

    for (const el of elements) {
      if (!this.isVisible(el)) continue;

      // Skip non-text input types
      const skipTypes = ['hidden', 'submit', 'button', 'image', 'radio', 'checkbox'];
      if (skipTypes.includes(el.type)) continue;

      // Skip comboboxes / autocomplete inputs — filling them opens dropdown UI
      if (el.tagName === 'INPUT' && this.isCombobox(el)) continue;

      const id = this.getOrCreateFieldId(el);

      const isRequired = el.hasAttribute('required') ||
                         el.getAttribute('aria-required') === 'true' ||
                         el.className.includes('required') ||
                         !!el.closest('.required');

      const maxLength = el.maxLength > 0 ? el.maxLength : null;

      // Handle File Uploads
      if (el.type === 'file') {
        const question = this.getQuestion(el);
        fields.push({
          id: id,
          type: 'file',
          question: question,
          required: isRequired,
          elementIds: [id]
        });
        continue;
      }

      // Handle standard inputs (text, email, tel, url, number, etc.) and textareas
      const type = el.tagName === 'TEXTAREA' ? 'textarea' : 'text';
      const question = this.getQuestion(el);
      if (question) {
        fields.push({
          id: id,
          type: type,
          question: question,
          maxLength: maxLength,
          required: isRequired,
          elementIds: [id]
        });
      }
    }

    return fields;
  },

  /**
   * Helper to find label text for a specific checkbox or radio option
   * @param {HTMLInputElement} input - The radio/checkbox element
   * @returns {string} Label option text
   */
  getOptionLabel(input) {
    const root = this.getRoot(input);
    if (input.id) {
      const label = root.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label && label.innerText.trim()) return label.innerText.trim();
    }
    const parentLabel = input.closest('label');
    if (parentLabel && parentLabel.innerText.trim()) {
      return parentLabel.innerText.trim();
    }
    // Check siblings
    let sibling = input.nextElementSibling;
    while (sibling) {
      if (sibling.tagName === 'LABEL' || sibling.tagName === 'SPAN') {
        return sibling.innerText.trim();
      }
      sibling = sibling.nextElementSibling;
    }
    return '';
  }
};
