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
| **Autopreencher** | varre o formulário → `POST /fill` (perfil + QA histórico) → preenche os campos |
| **Capturar vaga** | extrai título/empresa/descrição da página → `POST /capture` → Banco de Vagas |
| **Gerar CV** | extrai a vaga → `POST /cv` (template + Chrome headless) → PDF personalizado |
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
