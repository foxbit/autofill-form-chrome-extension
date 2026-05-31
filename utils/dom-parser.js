/**
 * Utility to parse the DOM and identify form fields and their associated questions.
 */
window.domParser = {
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
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    
    const style = window.getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    
    // Check if any parent is hidden
    let parent = el.parentElement;
    while (parent) {
      const parentStyle = window.getComputedStyle(parent);
      if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden') {
        return false;
      }
      parent = parent.parentElement;
    }
    
    return true;
  },

  /**
   * Finds the question text associated with an input element
   * @param {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} input - The input element
   * @returns {string} Associated question text
   */
  getQuestion(input) {
    // 1. Check for explicit label with 'for' attribute
    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
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
      const labelEl = document.getElementById(ariaLabelledBy);
      if (labelEl && labelEl.innerText.trim()) {
        return this.cleanQuestion(labelEl.innerText);
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
   * Scrapes all visible inputs and groups them as logical questions
   * @returns {object[]} List of identified form fields
   */
  parseForm() {
    const fields = [];
    const processedRadioNames = new Set();
    const processedCheckboxNames = new Set();

    // Query all standard input elements
    const elements = Array.from(document.querySelectorAll('input, textarea, select'));

    for (const el of elements) {
      if (!this.isVisible(el)) continue;
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'image') continue;

      const id = el.id || `field-${Math.random().toString(36).substr(2, 9)}`;
      el.id = id; // Ensure element has id for reference

      const isRequired = el.hasAttribute('required') || 
                         el.getAttribute('aria-required') === 'true' || 
                         el.className.includes('required') ||
                         !!el.closest('.required');

      const maxLength = el.maxLength > 0 ? el.maxLength : null;

      // Handle Radio Buttons
      if (el.type === 'radio') {
        const name = el.name;
        if (!name) continue;
        if (processedRadioNames.has(name)) continue;
        processedRadioNames.add(name);

        // Find all radio elements in this group
        const group = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`));
        const options = [];
        
        // Find group question (usually legend or parent label)
        let question = '';
        const fieldset = el.closest('fieldset');
        if (fieldset) {
          const legend = fieldset.querySelector('legend');
          if (legend) question = legend.innerText;
        }
        if (!question) {
          question = this.getQuestion(el);
        }

        // Gather options and map to elements
        group.forEach(radio => {
          const optionLabel = this.getOptionLabel(radio);
          if (optionLabel) {
            options.push({
              text: optionLabel,
              elementId: radio.id
            });
          }
        });

        if (options.length > 0) {
          fields.push({
            id: name,
            type: 'radio',
            question: this.cleanQuestion(question),
            options: options.map(o => o.text),
            optionElements: options, // Array of { text, elementId }
            required: isRequired,
            elementIds: group.map(r => r.id)
          });
        }
        continue;
      }

      // Handle Checkboxes (can be standalone or grouped)
      if (el.type === 'checkbox') {
        const name = el.name;
        
        // Standalone checkbox (e.g. Accept terms)
        if (!name) {
          const question = this.getQuestion(el);
          fields.push({
            id: id,
            type: 'checkbox',
            question: this.cleanQuestion(question),
            required: isRequired,
            elementIds: [id],
            standalone: true
          });
          continue;
        }

        if (processedCheckboxNames.has(name)) continue;
        processedCheckboxNames.add(name);

        const group = Array.from(document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(name)}"]`));
        
        if (group.length === 1) {
          // Single named checkbox
          const question = this.getQuestion(el);
          fields.push({
            id: id,
            type: 'checkbox',
            question: this.cleanQuestion(question),
            required: isRequired,
            elementIds: [id],
            standalone: true
          });
        } else {
          // Multiple choice checkbox group
          let question = '';
          const fieldset = el.closest('fieldset');
          if (fieldset) {
            const legend = fieldset.querySelector('legend');
            if (legend) question = legend.innerText;
          }
          if (!question) {
            question = this.getQuestion(el);
          }

          const options = [];
          group.forEach(checkbox => {
            const optionLabel = this.getOptionLabel(checkbox);
            if (optionLabel) {
              options.push({
                text: optionLabel,
                elementId: checkbox.id
              });
            }
          });

          fields.push({
            id: name,
            type: 'checkbox',
            question: this.cleanQuestion(question),
            options: options.map(o => o.text),
            optionElements: options,
            required: isRequired,
            elementIds: group.map(c => c.id),
            standalone: false
          });
        }
        continue;
      }

      // Handle Select Dropdowns
      if (el.tagName === 'SELECT') {
        const question = this.getQuestion(el);
        const options = Array.from(el.options)
          .map(opt => opt.text.trim())
          .filter(txt => txt && !txt.includes('selecione') && !txt.includes('select') && txt !== '---' && txt !== '');

        fields.push({
          id: id,
          type: 'select',
          question: question,
          options: options,
          required: isRequired,
          elementIds: [id]
        });
        continue;
      }

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
    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
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
