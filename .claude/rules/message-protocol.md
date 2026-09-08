# Regra: Message Protocol

Todas as mensagens Chrome seguem este contrato.

## Formato de Request
```js
{
  type: 'ACTION_NAME',        // UPPER_SNAKE_CASE, único
  payload: { ... }            // dados específicos da ação
}
```

## Formato de Response
```js
// Sucesso:
{ success: true, ...dados }

// Erro:
{ success: false, error: 'mensagem descritiva' }
```

## Regras
1. **Todo** handler retorna `true` no listener (manter canal aberto)
2. **Todo** handler tem try/catch que retorna `{ success: false, error }`
3. **Nenhum** handler silencia erros — sempre log no console
4. **Novos types** devem ser documentados no CLAUDE.md (seção API)
5. **Tipos duplicados** entre content.js e background.js = bug

## Lista de Types (canônica)

### Content Script (content.js)
- `PING` — health check do content script
- `GET_FORM_FIELDS` — scan + retorna campos + contexto
- `RESCAN_FORM` — re-scana a página inteira
- `AUTOFILL_FORM` — preenche campos com resultados da API
- `GET_MODIFIED_FIELDS` — detecta campos modificados pelo usuário
- `EXTRACT_JOB_INFO` — extrai metadados da vaga da página

### Background (background.js)
- `TEST_CONNECTIONS` — testa conexão com API
- `GET_STATUS` — verifica se API está ok
- `AUTOFILL_FIELDS` — envia campos para API /fill
- `SAVE_ANSWERS` — salva múltiplas respostas via /learn
- `SAVE_SINGLE_ANSWER` — salva uma resposta via /learn
- `CHECK_QUESTION` — busca resposta existente via /qa
- `GENERATE_ANSWER` — gera resposta via IA /generate
- `CAPTURE_VAGA` — registra vaga via /capture
- `GENERATE_CV` — gera CV via /cv
