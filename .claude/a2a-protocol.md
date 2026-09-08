# Protocolo A2A: Hermes ↔ Claude Code
# Máquina de Vagas — Autofill Extension

> Versão: 1.0.0 | Criado: 2026-09-08
> Este protocolo define como Hermes Agent e Claude Code coordenam trabalho
> na extensão Autofill, quem faz o quê, e como se comunicam.

---

## 1. Princípios Fundamentais

### 1.1 Divisão de Trabalho

| Agente | Responsabilidade Primária | Escopo |
|--------|--------------------------|--------|
| **Hermes** | Contexto do ecossistema, coordination, validação | API server, cofre, deployment, memória, skills |
| **Claude Code** | Código da extensão, refactoring, features, testes | Todos os `.js`, `.html`, `.css`, `manifest.json` |

### 1.2 Regra de Ouro
> **Claude Code escreve código. Hermes decide arquitetura e integração.**
> Quando há dúvida, Claude pergunta via `.claude/a2a-handshake.md` antes de agir.

### 1.3 Canais de Comunicação

```
╔══════════════════════════════════════════════════════════╗
║  CANAL                ║  DIREÇÃO    ║  USO              ║
╠══════════════════════════════════════════════════════════╣
║  CLAUDE.md            ║  H → C      ║  Regras globais    ║
║  .claude/rules/*.md   ║  H → C      ║  Regras específicas║
║  .claude/a2a-*.md     ║  bidirec.   ║  Handshake/status  ║
║  Git commits          ║  C → H      ║  Relatório mudanças║
║  .claude/CLAUDE.local ║  C → self   ║  Notas pessoais    ║
╚══════════════════════════════════════════════════════════╝
```

**H → C** = Hermes escreve, Claude lê
**C → H** = Claude escreve, Hermes lê
**bidirec.** = ambos escrevem e leem

---

## 2. Handshake (Inicio de Sessão)

### 2.1 Claude Code — Ao Iniciar

Quando Claude Code inicia uma sessão neste repo, ele DEVE:

1. Ler `CLAUDE.md` (automático)
2. Ler `.claude/a2a-status.md` para ver estado atual
3. Verificar `git log --oneline -5` para ver últimas mudanças
4. Se houver `.claude/a2a-handshake.md` com `pending_from: "hermes"` → ler e responder

### 2.2 Hermes — Ao Iniciar Trabalho na Extensão

Quando Hermes vai trabalhar na extensão, ele DEVE:

1. Ler `git status` e `git log --oneline -5`
2. Verificar se Claude fez mudanças não-reportadas
3. Atualizar `CLAUDE.md` se a API ou arquitetura mudaram
4. Criar/atualizar `.claude/a2a-status.md` com contexto

---

## 3. Protocolo de Mudanças

### 3.1 Claude Code — Ao Fazer uma Mudança

**ANTES de mudar:**
- Ler `CLAUDE.md` para entender restrições
- Verificar `.claude/rules/` para regras específicas
- Se a mudança afeta a API ou arquitetura → escrever em `.claude/a2a-handshake.md`

**DEPOIS de mudar:**
- Commit com mensagem formatada (ver seção 4)
- Atualizar `.claude/a2a-status.md` com resumo

### 3.2 Hermes — Ao Fazer uma Mudança

**ANTES de mudar:**
- Verificar se há mudanças pendentes de Claude (`git status`)
- Se houver → processar primeiro, depois mudar

**DEPOIS de mudar:**
- Atualizar `CLAUDE.md` se regras mudaram
- Commit com mensagem formatada
- Notificar via `.claude/a2a-handshake.md` se afeta Claude

---

## 4. Formato de Commits

### 4.1 Padrão Commit Convention

```
tipo(escopo): descrição curta

Corpo opcional com detalhes.

---a2a---
agente: hermes|claude
impacto: baixo|medio|alto
arquivos: [lista de arquivos alterados]
api_mudou: true|false
breaking: true|false
---fim-a2a---
```

### 4.2 Tipos

| Tipo | Quando usar |
|------|-------------|
| `feat` | Nova funcionalidade |
| `fix` | Correção de bug |
| `refactor` | Reestruturação sem mudar comportamento |
| `docs` | Documentação (CLAUDE.md, README, etc.) |
| `chore` | Manutenção, limpeza, deps |
| `a2a` | Alteração específica no protocolo A2A |

### 4.3 Exemplos

```bash
# Claude adiciona botão de re-analisar
git commit -m "feat(content): botão Reanalisar para SPAs que trocam de form

Adiciona RESCAN_FORM handler no content.js e botão no popup.
---a2a---
agente: claude
impacto: baixo
arquivos: [content.js, popup.js]
api_mudou: false
breaking: false
---fim-a2a---"

# Hermes muda endpoint da API
git commit -m "docs: atualiza CLAUDE.md com novo endpoint /generate-v2

---a2a---
agente: hermes
impacto: alto
arquivos: [CLAUDE.md]
api_mudou: true
breaking: true
---fim-a2a---"
```

---

## 5. Handshake File (`.claude/a2a-handshake.md`)

Este arquivo é o "buzina" entre os agentes. Quando um precisa da atenção do outro:

```markdown
# A2A Handshake

## Status: pendente
## De: hermes (ou claude)
## Para: claude (ou hermes)
## Data: 2026-09-08T14:30:00-03:00

### Mensagem
Endpoints da API mudaram. /generate agora aceita campo `template_id`.
Atualizar hermes-client.js.

### Ação requerida
- Atualizar generateAnswer() em hermes-client.js
- Testar com API real

### Prioridade: alta|media|baixa
```

**Quem lê e processa:**
- Se `Para: claude` → Claude lê ao iniciar e age
- Se `Para: hermes` → Hermes lê ao iniciar e age
- Após processar → atualizar `Status: resolvido` e commitar

---

## 6. Status File (`.claude/a2a-status.md`)

Snapshot do estado atual do trabalho. Atualizado por quem estiver trabalhando:

```markdown
# A2A Status

## Última atualização: 2026-09-08T14:30:00-03:00
## Por: claude

## Estado
-分支: main
-Último commit: abc1234 feat(content): botão reanalisar
-Em andamento: refatoração do dom-parser para suportar Shadow DOM
-Blocking: nenhum

## Mudanças Recentes (desde último sync com Hermes)
1. feat(content): botão reanalisar — impacto baixo
2. fix(dom-parser): correção de visibility check — impacto baixo

## Notas para Hermes
- dom-parser.js agora detecta Shadow DOM (Gupy migrou)
- Testar com formulário Gupy real antes de merge
```

---

## 7. Regras de Conflito

### 7.1 Quem ganha?

| Cenário | Regra |
|---------|-------|
| Claude muda `hermes-client.js` | Hermes valida contra API real |
| Hermes muda `CLAUDE.md` | Claude aceita (Hermes tem contexto do ecossistema) |
| Ambos mudam o mesmo arquivo | Último commit vence; o outro integra manualmente |
| Claude muda `manifest.json` | Hermes revisa permissões |
| Mudança que quebra API | **BLOCKED** — precisa de handshake antes |

### 7.2 Escopo Protegido (Hermes decide, Claude não mexe sem ask)

- `manifest.json` — permissões e content_scripts
- Porta da API (8790) — não mudar sem coordination
- Endpoints da API — `hermes-client.js` reflete a API, não o contrário
- `CLAUDE.md` — apenas Hermes edita (mas Claude pode sugerir via handshake)

### 7.3 Escopo Livre (Claude pode mudar livremente)

- `content.js` — lógica de UI, modais, botões inline
- `popup.js/html/css` — side panel
- `utils/dom-parser.js` — detecção de campos
- `utils/form-filler.js` — preenchimento
- `styles/content.css` — estilos injetados

---

## 8. Validação

### 8.1 Checklist Rápido (Claude executa antes de commit)

```bash
# Verificar que não há erros de syntax
node --check content.js
node --check background.js
node --check popup.js
node --check utils/*.js

# Verificar que manifest.json é válido
python3 -c "import json; json.load(open('manifest.json'))"

# Verificar git status
git status --short
```

### 8.2 Teste Manual (após qualquer mudança significativa)

1. `chrome://extensions` → Recarregar extensão
2. Abrir formulário Gupy/GreenHouse/Workday
3. Verificar: scan detecta campos, botões aparecem, autofill funciona
4. Verificar: modal de geração IA abre, gera, aprova
5. Verificar: toast de sucesso/erro aparece

---

## 9. Fluxo de Trabalho Típico

### Claude Code — Feature Nova

```
1. Ler CLAUDE.md + .claude/a2a-status.md
2. Verificar git log (últimas mudanças)
3. Criar branch: feat/nome-da-feature
4. Implementar
5. Atualizar .claude/a2a-status.md
6. Commit com bloco ---a2a---
7. Se afeta API: criar .claude/a2a-handshake.md para Hermes
8. Notificar Angelo (humano) que está pronto para review
```

### Hermes — Mudança de Ecossistema

```
1. Ler git status + .claude/a2a-status.md
2. Verificar se Claude tem mudanças pendentes
3. Atualizar CLAUDE.md com nova informação
4. Se afeta código da extensão: criar .claude/a2a-handshake.md para Claude
5. Commit com bloco ---a2a---
6. Notificar Angelo que há mudança pendente
```

---

## 10. Comandos Customizados

Claude Code pode usar estes comandos slash (em `.claude/commands/`):

| Comando | Uso |
|---------|-----|
| `/a2a-status` | Mostra status atual do protocolo |
| `/a2a-sync` | Sincroniza com git log e prepara resumo |
| `/validate` | Roda checklist de validação |
| `/handshake` | Cria handshake para Hermes |

---

## 11. Anti-Padrões (NÃO FAÇA)

- ❌ Claude não muda `manifest.json` sem pedir
- ❌ Claude não hardcodar porta 8790 em novo local
- ❌ Claude não adicionar dependências npm (extensão é vanilla JS)
- ❌ Claude não usar `innerHTML` com dados do usuário sem escape
- ❌ Claude não criar novos `window.*` globals além de domParser/formFiller
- ❌ Hermes não muda `content.js` direto (usa Claude para código)
- ❌ Nenhum agente commita sem bloco `---a2a---`
- ❌ Nenhum agente ignora handshake pendente
