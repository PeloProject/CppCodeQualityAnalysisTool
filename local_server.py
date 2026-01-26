import http.server
import json
import os
import subprocess
import urllib.parse

ROOT = os.path.abspath(os.getcwd())

EDITOR_COMMANDS = {
    "notepad": ["notepad.exe", "{file}"],
    "vscode": ["code", "-g", "{file}:{line}"],
    "sakura": ["sakura", "-L", "{line}", "{file}"],
    "hidemaru": ["hidemaru", "/j{line}", "{file}"],
}


def safe_path(path):
    normalized = os.path.abspath(os.path.normpath(path))
    return normalized


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/open":
            self.handle_open(parsed)
            return
        super().do_GET()

    def handle_open(self, parsed):
        params = urllib.parse.parse_qs(parsed.query)
        file_param = params.get("file", [None])[0]
        line_param = params.get("line", ["1"])[0]
        editor = params.get("editor", ["notepad"])[0]

        if not file_param:
            self.send_error(400, "file is required")
            return

        file_param = file_param.strip().strip("\"")
        if os.path.isabs(file_param):
            file_path = file_param
        else:
            file_path = os.path.join(ROOT, file_param)

        file_path = safe_path(file_path)
        if not file_path or not os.path.exists(file_path):
            self.send_error(400, "file not found")
            return

        try:
            line = max(1, int(line_param))
        except ValueError:
            line = 1

        cmd_template = EDITOR_COMMANDS.get(editor)
        if not cmd_template:
            self.send_error(400, "unsupported editor")
            return

        cmd = [part.format(file=file_path, line=line) for part in cmd_template]
        try:
            subprocess.Popen(cmd, cwd=ROOT)
        except Exception as exc:
            self.send_error(500, f"failed to launch editor: {exc}")
            return

        payload = {"ok": True, "editor": editor, "file": file_path, "line": line}
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("localhost", 8000), Handler)
    print("Server running at http://localhost:8000")
    server.serve_forever()
