# Máquina de Vagas — Autofill Chrome Extension

> **Este arquivo é lido automaticamente pelo Claude Code toda vez que uma sessão inicia neste diretório.**
> Mantenha-o atualizado. Hermes e Claude usam este protocolo para coordenar trabalho.

## Visão Geral

Extensão Chrome Manifest V3 que consome a **API da Máquina de Vagas** (FastAPI, porta 8790)
para autopreencher formulários de candidatura, capturar vagas e gerar currículos personalizados.

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│  Chrome Extension                                                │
│                                                                  │
│  popup.html/js/css ──► background.js (service worker)            │
│        │                     │                                    │
│        │              HermesClient (fetch)                        │
│        │                     │                                    │
│        ▼                     ▼                                    │
│  Side Panel UI      API Máquina de Vagas (FastAPI :8790)         │
│                            │                                     │
│                     cofre-pessoal/vagas/ (fonte única)            │
│                                                                  │
│  content.js ──► dom-parser.js + form-filler.js                   │
│       │              (injetados no page DOM)                      │
│       ▼                                                          │
│  Formulário da página (Gupy, Greenhouse, Workday, etc.)          │
└─────────────────────────────────────────────────────────────────┘
```

## Arquivos e Responsabilidades

| Arquivo | Papel | Quem mantém |
|---------|-------|-------------|
| `manifest.json` | Permissões, entry points, content scripts | Claude (código) + Hermes (permissões) |
| `background.js` | Service worker: roteamento de mensagens, orquestração API | Claude |
| `content.js` | Injeção no DOM, scan de formulários, botões inline, modais | Claude |
| `popup.html/js/css` | Side panel UI (controles, status, CV) | Claude |
| `utils/hermes-client.js` | Cliente HTTP para a API (`/health`, `/fill`, `/learn`, `/generate`, `/capture`, `/cv`) | Claude |
| `utils/dom-parser.js` | Descoberta de campos (labels, aria, placeholders, heurísticas) | Claude |
| `utils/form-filler.js` | Preenchimento com simulação de digitação (SPAs) | Claude |
| `utils/storage-manager.js` | Chrome storage (apiUrl, idioma) | Claude |
| `styles/content.css` | Estilos injetados (highlight, modais, toast, botões) | Claude |
| `CLAUDE.md` | Contexto do projeto (este arquivo) | Hermes |

## Regras de Código (Obrigatórias)

### JavaScript
- **Zero dependências externas** — vanilla JS, fetch nativo, Chrome APIs
- **Modular** — `utils/` para lógica isolada, `export`/`import` ES modules
- **Nomenclatura**: camelCase para funções/variáveis, UPPER_SNAKE_CASE para constantes de mensagem
- **Sem `eval()`, sem `innerHTML` com dados do usuário** (exceto.escapeHtml em modais internos)
- **Async/await** — preferir sobre `.then()` encadeado
- **Tratamento de erros** — todo `chrome.runtime.sendMessage` deve ter fallback

### Mensagens Chrome
- Usar `switch` em listeners (não if/else encadeado)
- Retornar `true` no listener para manter canal aberto (respostas assíncronas)
- Validar `message.type` antes de processar
- Padrão de resposta: `{ success: boolean, ...data }` ou `{ success: false, error: string }`

### Content Script
- **Nunca poluir `window`** — exceto `window.domParser` e `window.formFiller` (já estabelecido)
- **Ids garantidos** — `dom-parser` atribui `id` a elementos sem id
- **Separadores visuais** — classes CSS com prefixo `autofill-`
- **Limpeza** — remover listeners e DOM antigos antes de reinjetar

### Formulários (Plataformas)
- **Gupy/Workday/GreenHouse** — heurísticas especiais no `dom-parser.js` (linhas 102-141)
- **Comboboxes** — detectar e **ignorar** (isCombobox no dom-parser)
- **SPAs** — simular digitação character-by-character com dispatch de eventos (form-filler)
- **Campos já preenchidos** — pular (form-filler linhas 16-21)

## API Endpoints (porta 8790)

| Método | Rota | Uso |
|--------|------|-----|
| GET | `/health` | Health check |
| GET | `/profile` | Perfil canônico do cofre |
| POST | `/fill` | Preenche campos (recebe `fields[]`, retorna `filled[]` + `unmatched[]`) |
| POST | `/learn` | Salva resposta aprendida (`pergunta`, `resposta`, `idioma`) |
| GET | `/qa` | Busca resposta (`q=`, `limit=`) |
| POST | `/generate` | Gera resposta via IA (`pergunta`, `contexto`, `instrucao`, `idioma`) |
| POST | `/capture` | Registra vaga no banco |
| POST | `/cv` | Gera currículo PDF personalizado |
| GET | `/cvs/{filename}` | Download de CV gerado |

## Fluxos Principais

### Autopreencher
```
popup → GET_FORM_FIELDS (content) → campos + contexto
popup → AUTOFILL_FIELDS (background) → API /fill → resultado
popup → AUTOFILL_FORM (content) → form-filler.fill() sequencial
```

### Gerar Resposta IA (por campo)
```
Botão ⚡ → modal com instrução opcional → GENERATE_ANSWER (background)
→ API /generate → resposta → modal de aprovação → form-filler.fill()
```

### Aprender (salvar correção)
```
Botão ☁️ → CHECK_QUESTION → se existe: modal sobrescrever
                           → se novo: modal validar pergunta+resposta
→ SAVE_SINGLE_ANSWER → API /learn
```

### Capturar Vaga
```
EXTRACT_JOB_INFO (content) → metadados da página
→ CAPTURE_VAGA (background) → API /capture → banco
```

### Gerar CV
```
EXTRACT_JOB_INFO → dados da vaga
→ GENERATE_CV (background) → API /cv → PDF → download automático
```

## Conexão com o Ecossistema Hermes

Esta extensão é um componente da **Máquina de Vagas**, que inclui:
- **API FastAPI** (porta 8790) — backend que serve dados do cofre
- **Cofre Pessoal** (`~/mega/Obsidian-cofres/cofre-pessoal/vagas/`) — fonte única de dados
- **Hermes Agent** — orquestra coleta de vagas, geração de CV, aprendizado

**IMPORTANTE**: Alterações na API (`hermes-client.js`) devem ser validadas contra os endpoints reais.
Se um endpoint mudar, o `CLAUDE.md` deve ser atualizado.

## Checklist de PR (Claude deve verificar)

- [ ] Todos os message types novos têm handler no background.js E content.js (se aplicável)
- [ ] Respostas seguem padrão `{ success, ... }` 
- [ ] Não há `eval()` ou innerHTML com dados não-escapados
- [ ] Content script não polui window exceto domParser/formFiller
- [ ] Botões inline usam classes `autofill-*`
- [ ] Form-filler trata campos já preenchidos (pula)
- [ ] dom-parser ignora comboboxes
- [ ] Testado em pelo menos uma plataforma (Gupy, Greenhouse, Workday)
