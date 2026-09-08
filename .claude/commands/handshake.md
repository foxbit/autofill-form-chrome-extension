# Comando: Handshake

Cria uma mensagem de handshake para Hermes (ou responde a uma existente.

## Instruções

### Se NÃO existe handshake pendente:
1. Perguntar ao usuário (ou deduzir do contexto) a mensagem
2. Criar/atualizar `.claude/a2a-handshake.md` com:
   ```markdown
   # A2A Handshake

   ## Status: pendente
   ## De: claude
   ## Para: hermes
   ## Data: <ISO timestamp>

   ### Mensagem
   <descrição da mudança ou necessidade>

   ### Ação requerida
   - <o que Hermes deve fazer>

   ### Prioridade: alta|media|baixa
   ```
3. Commitar o handshake

### Se EXISTE handshake pendente de Hermes:
1. Ler `.claude/a2a-handshake.md`
2. Processar a mensagem
3. Executar a ação requerida (se aplicável)
4. Atualizar `Status: resolvido` e commitar

## Regra
- Handshakes são descartados após resolvidos
- Nunca ter mais de 1 handshake pendente por vez
