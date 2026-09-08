# Comando: A2A Sync

Sincroniza o estado do trabalho com o protocolo A2A.

## Instruções
1. Rodar `git log --oneline -10` e `git status --short`
2. Ler `.claude/a2a-status.md` atual
3. Atualizar `.claude/a2a-status.md` com:
   - Último commit
   - Mudanças pendentes (se houver)
   - Data/hora da atualização
   - Qual agente está atualizando (claude)
4. Se houver mudanças que afetam a API: criar `.claude/a2a-handshake.md` para Hermes
5. Commitar a atualização do status

## Regra
- Sempre atualizar o campo "Por:" com o agente atual
- Não apagar notas existentes — adicionar novas abaixo
