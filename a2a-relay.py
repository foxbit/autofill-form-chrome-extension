#!/usr/bin/env python3
"""
A2A Relay Server — Hermes ↔ Claude Code
Servidor HTTP leve que permite comunicação direta em tempo real
entre Hermes Agent (servidor) e Claude Code (máquina local).

Porta: 8791
Protocolo: HTTP REST simples

Endpoints:
  POST /send        — Envia mensagem para o outro agente
  GET  /poll/{agente} — Espera mensagem destinada ao agente (long-poll)
  GET  /inbox/{agente} — Retorna mensagens pendentes (non-blocking)
  GET  /health      — Health check
  DELETE /inbox/{agente} — Limpa inbox do agente

Fluxo:
  Claude → POST /send {from:"claude", to:"hermes", msg:"..."}
  Hermes → GET /poll/hermes (recebe a mensagem, processa)
  Hermes → POST /send {from:"hermes", to:"claude", msg:"resposta"}
  Claude → GET /poll/claude (recebe a resposta)
"""

import json
import time
import threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from collections import defaultdict
import uuid

# ── State ──────────────────────────────────────────────────────
inboxes = defaultdict(list)        # agente → [mensagens]
waiters = defaultdict(list)        # agente → [Event objects]
lock = threading.Lock()


def _notify(agente):
    """Acorda todos os pollers esperando por este agente."""
    with lock:
        evs = list(waiters.get(agente, []))
        waiters[agente] = []
    for ev in evs:
        ev.set()

# ── Handlers ───────────────────────────────────────────────────
class RelayHandler(BaseHTTPRequestHandler):

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")

        # GET /health
        if parts[0] == "health":
            return self._json({"ok": True, "agents": list(inboxes.keys()), "ts": time.time()})

        # GET /inbox/{agente}
        if parts[0] == "inbox" and len(parts) == 2:
            agente = parts[1]
            with lock:
                msgs = list(inboxes[agente])
                inboxes[agente].clear()
            return self._json({"agent": agente, "messages": msgs, "count": len(msgs)})

        # GET /poll/{agente}?timeout=30
        if parts[0] == "poll" and len(parts) == 2:
            agente = parts[1]
            qs = parse_qs(parsed.query)
            timeout = float(qs.get("timeout", ["30"])[0])

            # Lock-free fast path: se já tem mensagem, retorna na hora
            with lock:
                if inboxes[agente]:
                    msgs = list(inboxes[agente])
                    inboxes[agente].clear()
                    return self._json({"agent": agente, "messages": msgs, "count": len(msgs)})

            # Sem mensagem: registrar no waiter e bloquear até chegar algo
            ev = threading.Event()
            with lock:
                if inboxes[agente]:
                    msgs = list(inboxes[agente])
                    inboxes[agente].clear()
                    return self._json({"agent": agente, "messages": msgs, "count": len(msgs)})
                waiters[agente].append(ev)
            ev.wait(timeout)

            with lock:
                if inboxes[agente]:
                    msgs = list(inboxes[agente])
                    inboxes[agente].clear()
                    return self._json({"agent": agente, "messages": msgs, "count": len(msgs)})

            return self._json({"agent": agente, "messages": [], "count": 0, "timeout": True})

        self._json({"error": "not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")

        # POST /send
        if parts[0] == "send":
            body = self._read_body()
            fr = body.get("from", "unknown")
            to = body.get("to", "hermes")
            msg = body.get("msg", body.get("message", ""))
            msg_id = str(uuid.uuid4())[:8]
            timestamp = time.time()

            entry = {
                "id": msg_id,
                "from": fr,
                "to": to,
                "msg": msg,
                "ts": timestamp,
                "time_str": time.strftime("%H:%M:%S", time.localtime(timestamp))
            }

            with lock:
                inboxes[to].append(entry)

            _notify(to)  # acorda qualquer poller esperando por este destinatário
            print(f"[A2A] {fr} → {to}: {msg[:80]}...")
            return self._json({"ok": True, "id": msg_id, "queued_to": to})

        self._json({"error": "not found"}, 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")

        # DELETE /inbox/{agente}
        if parts[0] == "inbox" and len(parts) == 2:
            agente = parts[1]
            with lock:
                count = len(inboxes[agente])
                inboxes[agente].clear()
            return self._json({"ok": True, "cleared": count})

        self._json({"error": "not found"}, 404)

    def log_message(self, format, *args):
        # Silencia logs de request normais, só loga erros
        if args and "404" in str(args[0]):
            super().log_message(format, *args)

# ── Main ───────────────────────────────────────────────────────
if __name__ == "__main__":
    PORT = 8791
    server = ThreadingHTTPServer(("0.0.0.0", PORT), RelayHandler)
    print(f"═══ A2A Relay Server rodando na porta {PORT} ═══")
    print(f"    POST http://192.168.0.33:{PORT}/send      — enviar mensagem")
    print(f"    GET  http://192.168.0.33:{PORT}/poll/hermes — polling")
    print(f"    GET  http://192.168.0.33:{PORT}/inbox/claude — inbox")
    print(f"    GET  http://192.168.0.33:{PORT}/health     — health")
    server.serve_forever()
