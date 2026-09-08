#!/usr/bin/env python3
"""
A2A Monitor — Monitora inbox do Hermes em tempo real
Roda em background, faz polling a cada 2 segundos.
Quando recebe mensagem, imprime no stdout.
"""

import json
import time
import sys
import urllib.request

RELAY = "http://127.0.0.1:8791"
AGENT = "hermes"
POLL_INTERVAL = 2  # segundos

def check_inbox():
    try:
        req = urllib.request.Request(f"{RELAY}/inbox/{AGENT}")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            return data.get("messages", [])
    except Exception:
        return []

def main():
    print(f"[A2A Monitor] Monitorando inbox de '{AGENT}' a cada {POLL_INTERVAL}s...", flush=True)
    print(f"[A2A Monitor] Relay: {RELAY}", flush=True)
    
    while True:
        msgs = check_inbox()
        for m in msgs:
            print(f"\n{'='*60}", flush=True)
            print(f"[A2A] NOVA MENSAGEM DE: {m['from']}", flush=True)
            print(f"[A2A] ID: {m['id']}", flush=True)
            print(f"[A2A] HORA: {m['time_str']}", flush=True)
            print(f"[A2A] MENSAGEM:", flush=True)
            print(m['msg'], flush=True)
            print(f"{'='*60}\n", flush=True)
        
        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    main()
