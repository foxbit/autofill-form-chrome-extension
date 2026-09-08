# A2A Status

## Última atualização: 2026-09-08T16:30:00-03:00
## Por: hermes

## Estado
- **Branch:** main
- **Último commit:** a522677 fix: injeção programática do content script
- **Em andamento:** Protocolo A2A criado, Claude pode iniciar trabalho
- **Blocking:** nenhum

## Versão da Extensão
- **v2.0.0** — refatorada para API do Hermes (fonte única)

## Contexto para Claude Code
- A extensão consome API FastAPI na porta 8790
- Backend: `cd ~/mega/Obsidian-cofres/cofre-pessoal/vagas/03_automatizacao/api && python3 -m uvicorn main:app --host 0.0.0.0 --port 8790`
- Não há build step — carregar pasta diretamente no Chrome
- Testar em: Gupy, GreenHouse, Workday (formulários reais)

## Últimas Mudanças Significativas
1. `a522677` — fix: injeção programática do content script (encerra "Receiving end does not exist")
2. `f7b8e28` — feat: botão Reanalisar no popup
3. `5eb8fff` — feat: geração de resposta por IA (opencode) — botão ⚡ por campo
4. `fbda465` — feat: botões Abrir/Baixar CV no popup
5. `76b9e22` — refactor: Máquina de Vagas v2 (consome API do Hermes)

## Notas para Claude
- O content.js injeta botões inline (☁️ learn + ⚡ generate) ao lado de cada campo
- dom-parser.js tem heurísticas especiais para Gupy/Workday/GreenHouse
- form-filler.js simula digitação character-by-character (2ms delay) para SPAs
- O manifest já tem `side_panel` configurado — popup.html serve como side panel
- Não adicionar frameworks UI — vanilla JS + CSS puro
