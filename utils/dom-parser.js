/**
 * Utility to parse the DOM and identify form fields and their associated questions.
 */
window.domParser = {
  fieldAttribute: 'data-autofill-field-id',

  // fieldId -> WeakRef(element). getElement() is called several times per fill,
  // and walking every Shadow DOM tree each time is O(nodes) per call.
  elementCache: new Map(),

  /**
   * Returns the root that owns an element. Labels and controls inside an open
   * Shadow DOM are not visible to document.querySelector().
   */
  getRoot(el) {
    const root = el && el.getRootNode ? el.getRootNode() : document;
    return root && typeof root.querySelector === 'function' ? root : document;
  },

  /** Every root worth querying: the document plus each open Shadow DOM tree. */
  getRoots() {
    const roots = [];
    const pending = [document];
    const visited = new Set();

    while (pending.length) {
      const root = pending.pop();
      if (!root || visited.has(root)) continue;
      visited.add(root);
      roots.push(root);

      root.querySelectorAll('*').forEach((node) => {
        if (node.shadowRoot && node.shadowRoot.mode === 'open') {
          pending.push(node.shadowRoot);
        }
      });
    }

    return roots;
  },

  /**
   * Finds form controls in the document and in every open Shadow DOM tree.
   * Dialog libraries commonly render their content in those trees.
   */
  getFormControls() {
    const controls = new Set();
    for (const root of this.getRoots()) {
      root.querySelectorAll('input, textarea, select, [role="combobox"]').forEach((el) => controls.add(el));
    }
    return [...controls];
  },

  /** Finds a parsed field even when it lives inside an open Shadow DOM. */
  getElement(fieldId) {
    if (!fieldId) return null;

    const cached = this.elementCache.get(fieldId);
    const el = cached && cached.deref ? cached.deref() : cached;
    if (el && el.isConnected) return el;

    const selector = `[${this.fieldAttribute}="${CSS.escape(fieldId)}"]`;
    for (const root of this.getRoots()) {
      const match = root.querySelector(selector);
      if (match) {
        this.cacheElement(fieldId, match);
        return match;
      }
    }

    this.elementCache.delete(fieldId);
    return null;
  },

  cacheElement(fieldId, el) {
    this.elementCache.set(fieldId, typeof WeakRef === 'function' ? new WeakRef(el) : el);
  },

  getOrCreateFieldId(el) {
    let id = el.getAttribute(this.fieldAttribute);
    if (!id) {
      id = `autofill-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
      el.setAttribute(this.fieldAttribute, id);
    }
    this.cacheElement(id, el);
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
      .replace(/\s*\(\s*obrigat[óo]rio\s*\)\s*$/i, '')
      .replace(/\s*\(\s*required\s*\)\s*$/i, '')
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

  /** A control the user could type into or choose from. */
  isFillable(el) {
    if (el.disabled || el.readOnly) return false;
    const skipTypes = ['hidden', 'submit', 'button', 'image', 'reset'];
    if (skipTypes.includes(el.type)) return false;
    return this.isVisible(el);
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
   * Question of a radio/checkbox group: the option labels answer it, so the
   * text has to come from the fieldset legend, the group container or the
   * block right before the first option.
   * @param {HTMLInputElement[]} inputs - Options of the group
   * @returns {string} Group question
   */
  getGroupQuestion(inputs) {
    const first = inputs[0];
    const root = this.getRoot(first);

    const fieldset = first.closest('fieldset');
    const legend = fieldset && fieldset.querySelector('legend');
    if (legend && legend.innerText.trim()) return this.cleanQuestion(legend.innerText);

    const group = first.closest('[role="radiogroup"], [role="group"]');
    if (group) {
      const ariaLabel = group.getAttribute('aria-label');
      if (ariaLabel) return this.cleanQuestion(ariaLabel);
      const labelledBy = group.getAttribute('aria-labelledby');
      if (labelledBy) {
        const labelEl = root.querySelector(`#${CSS.escape(labelledBy.split(/\s+/)[0])}`);
        if (labelEl && labelEl.innerText.trim()) return this.cleanQuestion(labelEl.innerText);
      }
    }

    // Text block right before the options (very common in Gupy/Greenhouse)
    let node = first.closest('label') || first.parentElement;
    let depth = 0;
    while (node && depth < 4) {
      const sibling = node.previousElementSibling;
      if (sibling && this.isVisible(sibling) && !sibling.querySelector('input, select, textarea')) {
        const text = sibling.innerText.trim();
        if (text && text.length > 2 && text.length < 300) return this.cleanQuestion(text);
      }
      node = node.parentElement;
      depth++;
    }

    // Last resort: the name attribute, since the label belongs to the option
    if (first.name) {
      return this.cleanQuestion(first.name.replace(/[-_]/g, ' ').replace(/([A-Z])/g, ' $1'));
    }
    return '';
  },

  /**
   * Detects a combobox / autocomplete that opens a dropdown. It is filled by
   * typing and picking from the list, never by writing the value directly.
   * @param {HTMLElement} el
   * @returns {boolean}
   */
  isCombobox(el) {
    if (el.getAttribute('role') === 'combobox') return true;

    const haspopup = el.getAttribute('aria-haspopup');
    if (haspopup && haspopup !== 'false') return true;

    const autocomplete = el.getAttribute('aria-autocomplete');
    if (autocomplete === 'list' || autocomplete === 'both') return true;

    if (el.getAttribute('list')) return true;

    const parentCombo = el.closest('[role="combobox"]');
    if (parentCombo && parentCombo !== el) return true;

    // Class/id hints used by Greenhouse, Lever and Workday components
    const classStr = (typeof el.className === 'string' ? el.className : '').toLowerCase();
    const idStr = (el.id || '').toLowerCase();
    return (
      classStr.includes('combobox') ||
      classStr.includes('typeahead') ||
      classStr.includes('select2') ||
      idStr.includes('combobox')
    );
  },

  /** Options of a <select>, skipping the placeholder entry. */
  getSelectOptions(select) {
    return [...select.options]
      .filter((option, index) => {
        if (option.disabled) return false;
        const label = (option.textContent || '').trim();
        if (!label) return false;
        // First empty-valued entry is the "Selecione…" placeholder
        return !(index === 0 && !option.value);
      })
      .map((option) => ({ value: option.value, label: (option.textContent || '').trim() }));
  },

  /**
   * Options a combobox offers, when the listbox exists in the DOM even closed.
   * Returns an empty list when the site only renders them after typing.
   */
  getComboboxOptions(el) {
    const root = this.getRoot(el);
    const listId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    const list = listId ? root.getElementById ? root.getElementById(listId) : root.querySelector(`#${CSS.escape(listId)}`) : null;
    const source = list || (el.getAttribute('list') ? root.querySelector(`#${CSS.escape(el.getAttribute('list'))}`) : null);
    if (!source) return [];

    const options = [...source.querySelectorAll('[role="option"], option, li')]
      .map((option) => ({
        value: option.getAttribute('value') || (option.textContent || '').trim(),
        label: (option.textContent || '').trim()
      }))
      .filter((option) => option.label);
    return options.slice(0, 200);
  },

  /**
   * Scrapes all visible controls and groups them as logical questions.
   * Text, textarea, file, select, combobox and radio/checkbox groups.
   * @returns {object[]} List of identified form fields
   */
  parseForm() {
    const fields = [];
    const groups = new Map();   // name -> radio/checkbox options

    for (const el of this.getFormControls()) {
      if (!this.isFillable(el)) continue;

      // Radio and checkbox are grouped by name into a single logical question
      if (el.type === 'radio' || el.type === 'checkbox') {
        const key = `${el.type}:${el.name || this.getOrCreateFieldId(el)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(el);
        continue;
      }

      const id = this.getOrCreateFieldId(el);
      const isRequired = el.hasAttribute('required') ||
                         el.getAttribute('aria-required') === 'true' ||
                         String(el.className || '').includes('required') ||
                         !!el.closest('.required');
      const maxLength = el.maxLength > 0 ? el.maxLength : null;
      const question = this.getQuestion(el);

      if (el.type === 'file') {
        fields.push({
          id,
          type: 'file',
          question,
          accept: el.getAttribute('accept') || '',
          multiple: !!el.multiple,
          required: isRequired,
          elementIds: [id]
        });
        continue;
      }

      if (el.tagName === 'SELECT') {
        if (!question) continue;
        fields.push({
          id,
          type: 'select',
          question,
          options: this.getSelectOptions(el),
          multiple: !!el.multiple,
          required: isRequired,
          elementIds: [id]
        });
        continue;
      }

      if (this.isCombobox(el)) {
        if (!question) continue;
        fields.push({
          id,
          type: 'combobox',
          question,
          options: this.getComboboxOptions(el),
          required: isRequired,
          elementIds: [id]
        });
        continue;
      }

      const type = el.tagName === 'TEXTAREA' ? 'textarea' : 'text';
      if (question) {
        fields.push({
          id,
          type,
          question,
          inputType: (el.type || 'text').toLowerCase(),
          maxLength,
          required: isRequired,
          elementIds: [id]
        });
      }
    }

    for (const [key, inputs] of groups) {
      const [kind] = key.split(':');
      const ids = inputs.map((input) => this.getOrCreateFieldId(input));
      const options = inputs.map((input, index) => ({
        value: input.value && input.value !== 'on' ? input.value : this.getOptionLabel(input),
        label: this.getOptionLabel(input) || input.value,
        elementId: ids[index]
      })).filter((option) => option.label);

      // A lone checkbox is a yes/no question ("I agree", "PCD?")
      const standalone = kind === 'checkbox' && inputs.length === 1;
      const question = standalone
        ? (this.getQuestion(inputs[0]) || this.getGroupQuestion(inputs))
        : (this.getGroupQuestion(inputs) || this.getQuestion(inputs[0]));
      if (!question) continue;

      fields.push({
        id: ids[0],
        type: kind,
        question,
        options: standalone ? [] : options,
        standalone,
        multiple: kind === 'checkbox' && !standalone,
        required: inputs.some((input) => input.hasAttribute('required') || input.getAttribute('aria-required') === 'true'),
        elementIds: ids
      });
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
    const aria = input.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
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
