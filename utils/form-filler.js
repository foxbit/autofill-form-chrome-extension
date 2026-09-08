/**
 * Utility to fill form fields, simulating realistic user input.
 * Handles text, textarea, select, radio, checkbox, combobox and file inputs.
 */
window.formFiller = {
  /**
   * Assigns a value through the prototype setter. React (and Vue) install a
   * value tracker on the node: assigning el.value directly updates that tracker
   * and the following input event is discarded as "no change", so the field
   * looks filled on screen while the app state stays empty.
   */
  setNativeValue(el, value) {
    const proto = el instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
  },

  /** Normalizes text for option matching: no accents, no punctuation, lowercase. */
  normalize(text) {
    return String(text == null ? '' : text)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  },

  /** Yes/no answers arrive in many shapes; map them to a single token. */
  asBoolean(value) {
    const v = this.normalize(value);
    if (['sim', 'yes', 'true', 'verdadeiro', 'y', 's', '1', 'concordo', 'aceito', 'agree'].includes(v)) return true;
    if (['nao', 'no', 'false', 'falso', 'n', '0', 'discordo', 'recuso'].includes(v)) return false;
    return null;
  },

  /**
   * Best option for a value: exact match, then containment, then token overlap.
   * @returns {object|null} The chosen option, or null when nothing is close enough
   */
  matchOption(options, value) {
    if (!options || !options.length) return null;
    const target = this.normalize(value);
    if (!target) return null;

    const scored = options.map((option) => {
      const label = this.normalize(option.label);
      const raw = this.normalize(option.value);
      if (label === target || raw === target) return { option, score: 100 };
      if (label.includes(target) || target.includes(label)) {
        return { option, score: 80 - Math.abs(label.length - target.length) / 10 };
      }
      const labelTokens = new Set(label.split(' ').filter(Boolean));
      const targetTokens = new Set(target.split(' ').filter(Boolean));
      const shared = [...targetTokens].filter((token) => labelTokens.has(token)).length;
      if (!shared) return { option, score: 0 };
      const union = new Set([...labelTokens, ...targetTokens]).size;
      return { option, score: (shared / union) * 60 };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].score >= 30 ? scored[0].option : null;
  },

  /** Visual state of a field after an attempt. */
  markState(el, state) {
    if (!el) return;
    el.classList.remove('autofill-success', 'autofill-failed', 'autofill-scanned');
    if (state === 'success') {
      el.classList.add('autofill-success', 'autofilled-by-extension');
    } else if (state === 'failed') {
      el.classList.add('autofill-failed');
    }
  },

  dispatch(el, events) {
    for (const type of events) {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    }
  },

  /**
   * Main entry point to fill a logical field with a value
   * @param {object} field - Field metadata parsed by dom-parser.js
   * @param {any} value - Value to fill (string, or Blob for files)
   * @returns {Promise<{ok: boolean, reason?: string, applied?: string}>}
   */
  async fill(field, value) {
    if (value === null || value === undefined || value === '') {
      return { ok: false, reason: 'sem valor' };
    }

    const el = window.domParser.getElement(field.elementIds[0]);
    if (!el) return { ok: false, reason: 'campo não está mais na página' };

    // Never overwrite what the person already answered
    if (['text', 'textarea', 'combobox'].includes(field.type) && el.value && el.value.trim() !== '') {
      return { ok: false, reason: 'já preenchido' };
    }
    if (field.type === 'file' && el.files && el.files.length > 0) {
      return { ok: false, reason: 'já preenchido' };
    }

    try {
      switch (field.type) {
        case 'text':
        case 'textarea':
          return await this.fillText(field, String(value));

        case 'select':
          return this.fillSelect(field, value);

        case 'radio':
        case 'checkbox':
          return this.fillChoice(field, value);

        case 'combobox':
          return await this.fillCombobox(field, String(value));

        case 'file':
          if (value instanceof Blob) {
            return await this.fillFile(field, value);
          }
          return { ok: false, reason: 'arquivo precisa ser um Blob' };

        default:
          return { ok: false, reason: `tipo não suportado: ${field.type}` };
      }
    } catch (err) {
      console.error(`Erro ao preencher campo ${field.question}:`, err);
      this.markState(el, 'failed');
      return { ok: false, reason: err.message };
    }
  },

  /**
   * Writes text through the native setter and confirms the field kept it.
   */
  async fillText(field, text) {
    const el = window.domParser.getElement(field.elementIds[0]);
    if (!el) return { ok: false, reason: 'campo não está mais na página' };

    const limit = field.maxLength || el.maxLength;
    const value = limit > 0 ? text.slice(0, limit) : text;

    el.focus();
    this.setNativeValue(el, '');
    this.dispatch(el, ['input']);
    this.setNativeValue(el, value);

    // Some widgets only react to keyboard activity; one key round-trip is enough
    const lastChar = value.slice(-1) || ' ';
    el.dispatchEvent(new KeyboardEvent('keydown', { key: lastChar, bubbles: true }));
    this.dispatch(el, ['input']);
    el.dispatchEvent(new KeyboardEvent('keyup', { key: lastChar, bubbles: true }));
    this.dispatch(el, ['change']);
    el.blur();

    await new Promise((resolve) => setTimeout(resolve, 0));
    const applied = el.value;
    const ok = this.normalize(applied) === this.normalize(value);
    this.markState(el, ok ? 'success' : 'failed');
    return ok
      ? { ok: true, applied }
      : { ok: false, reason: 'o site não manteve o valor', applied };
  },

  /**
   * Picks the closest <option> and reports when no option matches the answer.
   */
  fillSelect(field, value) {
    const el = window.domParser.getElement(field.elementIds[0]);
    if (!el) return { ok: false, reason: 'campo não está mais na página' };

    const options = (field.options && field.options.length)
      ? field.options
      : window.domParser.getSelectOptions(el);
    const match = this.matchOption(options, value);
    if (!match) {
      this.markState(el, 'failed');
      return { ok: false, reason: `nenhuma opção corresponde a “${value}”` };
    }

    el.focus();
    const target = [...el.options].find((option) =>
      option.value === match.value || this.normalize(option.textContent) === this.normalize(match.label));
    if (!target) {
      this.markState(el, 'failed');
      return { ok: false, reason: 'opção sumiu do select' };
    }

    el.value = target.value;
    target.selected = true;
    this.dispatch(el, ['input', 'change']);
    el.blur();

    const ok = el.value === target.value;
    this.markState(el, ok ? 'success' : 'failed');
    return ok
      ? { ok: true, applied: match.label }
      : { ok: false, reason: 'o site não manteve a seleção' };
  },

  /**
   * Radio group, checkbox group or single yes/no checkbox. Clicking is what
   * frameworks listen to, so the option element gets a real click.
   */
  fillChoice(field, value) {
    const first = window.domParser.getElement(field.elementIds[0]);

    if (field.standalone) {
      const desired = this.asBoolean(value);
      if (desired === null) {
        this.markState(first, 'failed');
        return { ok: false, reason: `resposta “${value}” não é sim/não` };
      }
      if (first.checked !== desired) first.click();
      const ok = first.checked === desired;
      this.markState(first, ok ? 'success' : 'failed');
      return ok
        ? { ok: true, applied: desired ? 'marcado' : 'desmarcado' }
        : { ok: false, reason: 'o site não manteve a marcação' };
    }

    // Checkbox groups accept several answers separated by comma or semicolon
    const answers = field.multiple ? String(value).split(/[;,]/).map((v) => v.trim()).filter(Boolean) : [String(value)];
    const applied = [];

    for (const answer of answers) {
      const match = this.matchOption(field.options, answer);
      if (!match) continue;
      const el = window.domParser.getElement(match.elementId);
      if (!el) continue;
      if (!el.checked) el.click();
      if (el.checked) {
        applied.push(match.label);
        this.markState(el, 'success');
      }
    }

    if (!applied.length) {
      this.markState(first, 'failed');
      return { ok: false, reason: `nenhuma opção corresponde a “${value}”` };
    }
    return { ok: true, applied: applied.join(', ') };
  },

  /**
   * Types into an autocomplete and picks from the list it opens. Sites render
   * the listbox in a portal, so the options are searched in the whole document.
   */
  async fillCombobox(field, text) {
    const el = window.domParser.getElement(field.elementIds[0]);
    if (!el) return { ok: false, reason: 'campo não está mais na página' };

    el.focus();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    this.setNativeValue(el, text);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: text.slice(-1) || ' ', bubbles: true }));
    this.dispatch(el, ['input']);
    el.dispatchEvent(new KeyboardEvent('keyup', { key: text.slice(-1) || ' ', bubbles: true }));

    const optionEls = await this.waitForOptions();
    if (optionEls.length) {
      const options = optionEls.map((option, index) => ({
        value: String(index),
        label: (option.innerText || option.textContent || '').trim()
      })).filter((option) => option.label);
      const match = this.matchOption(options, text) || options[0];
      const chosen = optionEls[Number(match.value)];
      if (chosen) {
        chosen.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        chosen.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        chosen.click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        this.markState(el, 'success');
        return { ok: true, applied: match.label };
      }
    }

    // No list appeared: keep the typed value if the field accepted it
    this.dispatch(el, ['change']);
    const ok = !!el.value;
    this.markState(el, ok ? 'success' : 'failed');
    return ok
      ? { ok: true, applied: el.value, reason: 'lista não abriu; valor digitado' }
      : { ok: false, reason: 'a lista de opções não abriu' };
  },

  /** Waits briefly for a dropdown to render its options. */
  async waitForOptions(timeout = 1200) {
    const selector = '[role="option"], [role="listbox"] li, ul[class*="menu"] li, div[class*="option"]:not(:has(*))';
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = [];
      for (const root of window.domParser.getRoots()) {
        let matches = [];
        try {
          matches = [...root.querySelectorAll(selector)];
        } catch (err) {
          matches = [...root.querySelectorAll('[role="option"], [role="listbox"] li')];
        }
        found.push(...matches.filter((el) => window.domParser.isVisible(el)));
      }
      if (found.length) return found.slice(0, 50);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return [];
  },

  /**
   * Injects a file into an input[type="file"] through the DataTransfer API.
   */
  async fillFile(field, fileBlob) {
    const el = window.domParser.getElement(field.elementIds[0]);
    if (!el) return { ok: false, reason: 'campo não está mais na página' };

    const fileName = field.fileName || 'curriculo.pdf';
    const mimeType = field.mimeType || fileBlob.type || 'application/pdf';

    const accept = (el.getAttribute('accept') || '').toLowerCase();
    if (accept && !accept.includes('pdf') && !accept.includes('*')) {
      this.markState(el, 'failed');
      return { ok: false, reason: `o campo só aceita ${accept}` };
    }

    const file = new File([fileBlob], fileName, { type: mimeType });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    el.files = dataTransfer.files;
    this.dispatch(el, ['input', 'change']);

    const ok = el.files && el.files.length > 0 && el.files[0].name === fileName;
    this.markState(el, ok ? 'success' : 'failed');
    return ok
      ? { ok: true, applied: fileName }
      : { ok: false, reason: 'o site não aceitou o arquivo' };
  }
};
