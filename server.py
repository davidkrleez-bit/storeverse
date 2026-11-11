"""
Simon's demo server.

Serves web/ and exposes one endpoint, /api/vision, which turns photographs of a real
store into the same store spec the simulator already understands. Vision runs through
the local `claude` CLI, so no API key lives in this repo.

Everything else in the app is static: the floor, the scoring and the 1,000-scenario
search all run in the browser against the exported response surface. If vision is
unavailable the walkthrough still works end to end on the demo floor.

Run:  python server.py        then open http://localhost:8000
"""
import base64, json, pathlib, re, shutil, subprocess, sys, tempfile, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent
WEB = ROOT / "web"
PORT = 8000
VISION_TIMEOUT = 180

PROMPT = """Look at the attached photograph(s) of a retail store interior and describe the space as JSON.

Return ONLY a JSON object, no prose and no code fence, with exactly these keys:
{
  "name": "a short plausible name for this store",
  "summary": "one sentence, max 20 words, on the fixtures and look you can see",
  "size": {"w": <metres across, number>, "d": <metres deep, number>, "h": <ceiling metres>},
  "palette": {"floor": "#rrggbb", "wall": "#rrggbb", "fixture": "#rrggbb", "accent": "#rrggbb"},
  "posters": [{"x": <m>, "z": <m>, "w": <m>, "h": <m>, "text": "WORD"}],
  "zones": [{"category": "<one of the CATEGORIES below, exactly>", "kind": "gondola|cooler|island|wall",
             "x": <centre m>, "z": <centre m>, "w": <m>, "d": <m>}]
}

Rules:
- The coordinate origin is the front-left corner of the sales floor. x runs across the
  storefront, z runs from the entrance toward the back wall.
- Only use category names from this list, and only for product groups you can actually
  see or reasonably infer: CATEGORIES.
- "kind" should reflect the real fixture: gondola for shelf runs, cooler for refrigerated
  cases, island for low open tables, wall for perimeter units.
- Take the palette from the dominant colours in the photo.
- Take poster "text" from signage you can read, upper case, one or two words.
- If you cannot tell a dimension, give a sensible estimate for a store of this type.
"""


def vision(images, categories):
    """Hand the photos to the local claude CLI and parse the store spec it returns."""
    exe = shutil.which("claude")
    if not exe:
        raise RuntimeError("the claude CLI is not on PATH, so photo analysis is unavailable")

    tmp = pathlib.Path(tempfile.mkdtemp(prefix="simon-photos-"))
    paths = []
    for i, data_url in enumerate(images[:4]):
        m = re.match(r"data:image/(\w+);base64,(.*)$", data_url, re.S)
        if not m:
            continue
        p = tmp / f"photo{i}.{m.group(1).replace('jpeg', 'jpg')}"
        p.write_bytes(base64.b64decode(m.group(2)))
        paths.append(p)
    if not paths:
        raise RuntimeError("no readable images were uploaded")

    prompt = PROMPT.replace("CATEGORIES", ", ".join(categories))
    prompt += "\n\nPhotographs to read:\n" + "\n".join(str(p) for p in paths)

    out = subprocess.run(
        [exe, "-p", prompt, "--output-format", "json"],
        capture_output=True, text=True, timeout=VISION_TIMEOUT, cwd=str(tmp),
    )
    if out.returncode != 0:
        raise RuntimeError((out.stderr or "the vision call failed").strip()[:300])

    body = out.stdout
    try:  # the CLI wraps the answer; unwrap it when it does
        body = json.loads(body).get("result", body)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", body, re.S)
    if not m:
        raise RuntimeError("the vision model did not return a store spec")
    return json.loads(m.group(0))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(WEB), **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/api/vision":
            return self._json(404, {"error": "no such endpoint"})
        try:
            n = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(n) or b"{}")
            spec = vision(req.get("photos", []), req.get("categories", []))
            self._json(200, spec)
        except subprocess.TimeoutExpired:
            self._json(200, {"error": f"the vision model took longer than {VISION_TIMEOUT}s"})
        except Exception as e:
            self._json(200, {"error": str(e)[:300]})

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    for f in ("data/store.json", "data/validation.json", "data/surface.json"):
        if not (WEB / f).exists():
            sys.exit(f"missing {WEB/f}\nRun:  python model/pipeline.py && python model/make_store.py")
    print(f"Simon is serving {WEB}")
    print(f"  http://localhost:{PORT}\n")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
