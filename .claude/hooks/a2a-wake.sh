#!/bin/bash
# A2A Wake hook (Claude Code "Stop") — acorda o Claude automaticamente
# quando o Hermes respondeu algo no bridge enquanto ele trabalhava.
#
# Como funciona:
#   1. Dispara toda vez que o Claude termina uma resposta.
#   2. Consulta o inbox dele no bridge (non-blocking).
#   3. Se houver mensagens do Hermes → decision:block + reason → o Claude
#      CONTINUA sozinho, lê e responde. Sem intervenção humana.
#
# Instalação (user-level, vale para qualquer projeto):
#   ~/.claude/settings.json → hooks.Stop → este script
#
# Config: A2A_BRIDGE e A2A_AGENT podem ser sobrescritos por env.

BRIDGE="${A2A_BRIDGE:-http://192.168.0.33:8791}"
AGENT="${A2A_AGENT:-claude}"

RESP=$(curl -s -m 5 "$BRIDGE/inbox/$AGENT" 2>/dev/null)
if [ -z "$RESP" ]; then
  exit 0
fi

COUNT=$(printf '%s' "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))" 2>/dev/null)
if [ -z "$COUNT" ] || [ "$COUNT" = "0" ]; then
  exit 0
fi

MSGS=$(printf '%s' "$RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for m in d.get('messages', []):
    print(f\"[{m.get('time_str','')}] HERMES: {m.get('msg','')}\")
" 2>/dev/null)

if [ -z "$MSGS" ]; then
  exit 0
fi

# decision:block → Claude Code continua o turno com este reason como feedback
printf '%s' "$MSGS" | python3 -c "
import json, sys
msgs = sys.stdin.read()
print(json.dumps({
    'decision': 'block',
    'reason': 'MENSAGENS A2A DO HERMES chegaram no bridge. Leia e responda pelo bridge:\n  curl -s -X POST $BRIDGE/send -H \"Content-Type: application/json\" -d \'{\"from\":\"$AGENT\",\"to\":\"hermes\",\"msg\":\"SUA RESPOSTA\"}\'\n\n' + msgs
}, ensure_ascii=False))
"
