#!/usr/bin/env python3
"""Локальный сервер для разработки плагина: отдаёт animevost.js с CORS.

    python3 serve.py            # http://<ip-мака>:8099/animevost.js
"""
import http.server
import os
import socket

PORT = 8099
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    print(f"Плагин: http://{lan_ip()}:{PORT}/animevost.js")
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
