# Comando: Validate

Roda a validação completa da extensão.

## Instruções
1. **Syntax check** — rodar `node --check` em todos os `.js`:
   - `node --check content.js`
   - `node --check background.js`
   - `node --check popup.js`
   - `node --check utils/dom-parser.js`
   - `node --check utils/form-filler.js`
   - `node --check utils/hermes-client.js`
   - `node --check utils/storage-manager.js`
2. **Manifest check** — validar JSON:
   ```bash
   python3 -c "import json; json.load(open('manifest.json')); print('manifest.json OK')"
   ```
3. **Git status** — verificar se há arquivos não rastreados ou modificados
4. **CLAUDE.md check** — verificar se lista de endpoints está atualizada vs hermes-client.js

## Formato de Saída
```
🔍 Validation Results
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ content.js — syntax OK
✅ background.js — syntax OK
✅ manifest.json — valid JSON
✅ Todos os endpoints documentados
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ou
❌ content.js — syntax error na linha 42
```
