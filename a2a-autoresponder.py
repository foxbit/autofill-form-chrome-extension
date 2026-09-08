#!/usr/bin/env python3
"""
A2A Auto-Responder — Hermes responde APENAS confirmações simples
Mensagens complexas ficam salvas em /tmp/a2a-pending.txt para Hermes processar manualmente.
NÃO envia "estou analisando" — fica em silêncio até Hermes responder de verdade.
"""

import json
import time
import urllib.request
from datetime import datetime

RELAY = "http://127.0.0.1:8791"
AGENT = "hermes"
POLL_INTERVAL = 3
PENDING_FILE = "/tmp/a2a-pending.txt"
LOG_FILE = "/tmp/a2a-monitor.log"

def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

def check_inbox():
    try:
        req = urllib.request.Request(f"{RELAY}/inbox/{AGENT}")
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
            return data.get("messages", [])
    except Exception:
        return []

def send_to_claude(msg):
    try:
        data = json.dumps({"from": "hermes", "to": "claude", "msg": msg}).encode()
        req = urllib.request.Request(
            f"{RELAY}/send",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            result = json.loads(resp.read())
            log(f"Resposta enviada (id: {result.get('id', '?')})")
            return True
    except Exception as e:
        log(f"Erro ao enviar resposta: {e}")
        return False

def save_for_hermes(msg_data):
    """Salva mensagem complexa para Hermes processar manualmente."""
    with open(PENDING_FILE, "a") as f:
        f.write(f"\n{'='*60}\n")
        f.write(f"DE: {msg_data['from']} | ID: {msg_data['id']} | HORA: {msg_data['time_str']}\n")
        f.write(f"MENSAGEM:\n{msg_data['msg']}\n")
    log(f"Salva em {PENDING_FILE} (Hermes vai processar)")

def is_simple_confirmation(msg):
    """Detecta mensagens que posso responder automaticamente."""
    lower = msg.lower().strip()
    confirmations = [
        "ok", "ok!", "entendido", "recebido", "confirmado",
        "conexão ok", "conexao ok", "testado", "funcionou",
        "estou online", "claude online", "pronto",
        "ack", "confirmed", "received", "got it"
    ]
    return any(lower.startswith(c) or lower == c for c in confirmations)

def main():
    log(f"═══ A2A Auto-Responder v2 iniciado ═══")
    log(f"Monitorando inbox de '{AGENT}' a cada {POLL_INTERVAL}s")
    log(f"REGRAS: responde APENAS confirmações curtas. Mensagens complexas ficam silenciosas.")
    
    while True:
        msgs = check_inbox()
        for m in msgs:
            msg = m["msg"].strip()
            log(f"Mensagem de {m['from']}: {msg[:80]}...")
            
            if is_simple_confirmation(msg):
                send_to_claude(f"Recebido, Claude! ({m['time_str']}) Pode continuar.")
                log(f"→ Respondida automaticamente (confirmação)")
            else:
                # Mensagem complexa: salva e NÃO responde
                save_for_hermes(m)
                log(f"→ Salva silenciosamente (Hermes vai processar)")
        
        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    main()
