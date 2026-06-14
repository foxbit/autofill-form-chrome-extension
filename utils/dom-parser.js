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

    // Query only text inputs, textareas and file inputs — skip select, radio, checkbox
    const elements = Array.from(document.querySelectorAll('input, textarea'));

    for (const el of elements) {
      if (!this.isVisible(el)) continue;

      // Skip non-text input types
      const skipTypes = ['hidden', 'submit', 'button', 'image', 'radio', 'checkbox'];
      if (skipTypes.includes(el.type)) continue;

      const id = el.id || `field-${Math.random().toString(36).substr(2, 9)}`;
      el.id = id; // Ensure element has id for reference

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
