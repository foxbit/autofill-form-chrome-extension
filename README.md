# Máquina de Vagas — Extensão Chrome (Autofill + Captura)

Extensão **Manifest V3** que consome a **API da Máquina de Vagas** (FastAPI no servidor interno do Hermes)
para preencher formulários de candidatura, capturar vagas manualmente e gerar currículos personalizados.

> **v2.0.0** — refatorada para a fonte única (cofre) via API do Hermes. Substitui a integração direta com
> Supabase + Gemini/OpenRouter/Ollama da v1.

## Arquitetura

```
content.js (formulário) ──► background.js (service worker) ──► HermesClient ──► API Máquina de Vagas
        ▲                              ▲                                          │
        └── dom-parser/form-filler ────┘                                          ▼
                                                                    cofre-pessoal/vagas/ (fonte única)
```

- **`utils/hermes-client.js`** — cliente HTTP para a API (`/health`, `/profile`, `/fill`, `/learn`, `/qa`, `/capture`, `/cv`).
- **`utils/dom-parser.js`** — descoberta de campos (labels, aria, placeholders, heurísticas Gupy/Workday).
- **`utils/form-filler.js`** — preenchimento com simulação de digitação (SPAs).
- **`background.js`** — orquestra as mensagens e chama a API.
- **`content.js`** — varre formulários, injeta botões de aprendizado e extrai info da vaga.

## Funcionalidades

| Ação | Fluxo |
|---|---|
| **Autopreencher** | reanalisa a aba ativa e seus modais/iframes → `POST /fill` (perfil + QA histórico) → preenche os campos |
| **Capturar vaga** | extrai título/empresa/descrição da página → `POST /capture` → Banco de Vagas |
| **Gerar CV** | extrai o texto da vaga → `POST /cv` (template + Chrome headless) → PDF personalizado |

### O que a extensão envia da vaga

`EXTRACT_JOB_INFO` (em `content.js`) não depende de nenhum portal específico: manda **todo o texto
visível da página** (mais iframes de mesma origem) e, quando consegue isolá-los, os recortes que
pesam mais no ranking do Hermes.

| Campo | Origem | Peso no `cvgen` |
|---|---|---|
| `pagina` | `body.innerText` inteiro, sem menus repetidos (até 60 000 caracteres) | 1 |
| `descricao` | JSON-LD `JobPosting.description` → container do ATS → corpo da página | 2 |
| `requisitos` | JSON-LD (`qualifications`, `experienceRequirements`, `responsibilities`) | 3 |
| `skills[]` | JSON-LD `JobPosting.skills` | 4 |
| `titulo` / `empresa` / `local` | JSON-LD, `og:*` ou `<title>` (ignora o nome do ATS) | — |

Os seletores de ATS (Gupy, Greenhouse, Lever, Ashby, Workday, LinkedIn, Indeed…) só servem para
**destacar** o trecho principal; num site desconhecido a extração cai no corpo da página e o CV
continua sendo personalizado.

### Paginação do CV

O `POST /cv` leva o objeto `paginacao` definido em `popup.js` (`CV_PAGINACAO`); o Hermes usa
esses valores para montar o CSS de impressão do template — a quebra de página cai **entre**
os blocos (experiência, formação, idiomas) em vez de cortá-los ao meio.

| Campo | Padrão | Descrição |
|---|---|---|
| `formato` | `Letter` | tamanho da folha (`Letter`, `A4`…) |
| `margem_topo` / `margem_lateral` / `margem_rodape` | `0.35in` / `0.4in` / `0.35in` | margens do `@page` |
| `quebrar_blocos` | `true` | `false` volta ao corte livre |
| `evitar_quebra_em` | `[]` | seletores extras que não podem ser partidos |
| **Aprender** | ícone ☁️ por campo: salva correção → `POST /learn` (refina o QA no cofre) |

## Configuração

1. `chrome://extensions` → **Modo do desenvolvedor** → **Carregar sem compactação** → esta pasta.
2. Abra a extensão e defina a **URL da API** (padrão `http://127.0.0.1:8790`).
3. Clique em **Testar conexão**.

## Requisitos

- API da Máquina de Vagas rodando: `cd vagas/03_automatizacao/api && python3 -m uvicorn main:app --host 0.0.0.0 --port 8790`.

## Estrutura

```
manifest.json · background.js · content.js · popup.{html,js,css}
utils/{hermes-client,dom-parser,form-filler,storage-manager}.js
styles/content.css · icons/
```
