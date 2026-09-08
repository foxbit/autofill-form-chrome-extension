# Regra: Sem Dependências Externas

A extensão é **vanilla JS + Chrome APIs**. Nada de npm, bundlers, frameworks.

## O que NÃO adicionar
- React, Vue, Angular, Svelte
- lodash, moment, axios
- webpack, vite, rollup
- Qualquer `package.json` com `dependencies`

## O que USAR
- `fetch()` nativo para HTTP
- `chrome.*` APIs para mensagens, storage, tabs, scripting
- CSS vanilla (sem preprocessadores)
- ES modules (`import`/`export`) via `<script type="module">` no service worker

## Por que
- Extensões Chrome são auto-contidas — o Chrome carrega direto da pasta
- Adicionar build step complica debug e deploy
- Manuel = menos superfície de ataque = mais confiável
