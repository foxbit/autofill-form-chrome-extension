#!/bin/bash
# a2a.sh — Helper de comunicação A2A para Claude Code
# Uso: ./a2a.sh <comando> [argumentos]
#
# Comandos:
#   send <msg>        — Envia mensagem para Hermes
#   poll [timeout]    — Espera mensagem de Hermes (default: 30s)
#   inbox             — Mostra mensagens pendentes
#   ask <pergunta>    — Envia pergunta e espera resposta (poll)
#   health            — Verifica se o relay está rodando

RELAY="http://192.168.0.33:8791"
AGENT="claude"

case "$1" in
  send)
    shift
    MSG="$*"
    curl -s -X POST "$RELAY/send" \
      -H "Content-Type: application/json" \
      -d "{\"from\":\"$AGENT\",\"to\":\"hermes\",\"msg\":\"$MSG\"}"
    ;;
  poll)
    TIMEOUT="${2:-30}"
    curl -s "$RELAY/poll/$AGENT?timeout=$TIMEOUT"
    ;;
  inbox)
    curl -s "$RELAY/inbox/$AGENT"
    ;;
  ask)
    shift
    PERGUNTA="$*"
    # Envia a pergunta
    curl -s -X POST "$RELAY/send" \
      -H "Content-Type: application/json" \
      -d "{\"from\":\"$AGENT\",\"to\":\"hermes\",\"msg\":\"$PERGUNTA\"}" > /dev/null
    # Espera resposta (até 60s)
    curl -s "$RELAY/poll/$AGENT?timeout=60"
    ;;
  health)
    curl -s "$RELAY/health"
    ;;
  *)
    echo "Uso: $0 {send|poll|inbox|ask|health} [args]"
    echo "  send <msg>      — Envia mensagem para Hermes"
    echo "  poll [timeout]  — Espera mensagem (default 30s)"
    echo "  inbox           — Mensagens pendentes"
    echo "  ask <pergunta>  — Pergunta e espera resposta"
    echo "  health          — Status do relay"
    exit 1
    ;;
esac
