# Comando: A2A Status

Mostra o estado atual do protocolo A2A e as últimas mudanças.

## Instruções
1. Ler `.claude/a2a-status.md`
2. Rodar `git log --oneline -10` para ver commits recentes
3. Rodar `git status --short` para ver mudanças pendentes
4. Verificar se há `.claude/a2a-handshake.md` com status "pendente"
5. Mostrar um resumo formatado para o usuário

## Formato de Saída
```
📋 A2A Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Branch: main
Último commit: <hash> <msg>
Mudanças pendentes: <lista ou "nenhuma">
Handshake: <pendente/resolvido/ausente>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<se há pendências, mostrar detalhes>
```
