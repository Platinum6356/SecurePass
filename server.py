"""Serve only SecurePass assets on the loopback interface. No vault data leaves the browser."""
import argparse
import http.client
import socket
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = 5000
ADDRESS = f"{HOST}:{PORT}"
ASSETS = Path(__file__).resolve().parent / "dist"
ROUTES = {"/": ("index.html", "text/html"), "/style.css": ("style.css", "text/css")}
for module in ("app", "vault", "generator"):
    ROUTES[f"/{module}.js"] = (f"{module}.js", "text/javascript")


class LocalServer(ThreadingHTTPServer):
    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.allow_reuse_address = False
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.headers.get("Host") != ADDRESS:
            self.send_error(403)
            return
        asset = ROUTES.get(self.path)
        if not asset:
            self.send_error(404)
            return
        name, mime = asset
        try:
            content = (ASSETS / name).read_bytes()
        except OSError:
            self.send_error(500)
            return
        self.send_response(200)
        self.send_header("Content-Type", f"{mime}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("X-SecurePass-App", "local-v1")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; "
                         "style-src 'self'; img-src 'self' data:; connect-src 'none'; "
                         "base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
        self.end_headers()
        self.wfile.write(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    url = f"http://{ADDRESS}/"
    try:
        server = LocalServer((HOST, PORT), Handler)
    except OSError:
        connection = http.client.HTTPConnection(HOST, PORT, timeout=2)
        try:
            connection.request("GET", "/")
            same_app = connection.getresponse().getheader("X-SecurePass-App") == "local-v1"
        except OSError:
            same_app = False
        finally:
            connection.close()
        if same_app:
            if not args.no_browser:
                webbrowser.open(url)
            return
        raise SystemExit(f"Порт {PORT} занят. Освободите его и повторите запуск.")
    with server:
        print(f"SecurePass: {url}\nДля остановки нажмите Ctrl+C.", flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
