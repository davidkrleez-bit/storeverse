"""
StoreVerse's demo server.

Serves web/ and turns photographs of a real store into the same store spec the
simulator already understands. Vision runs through the local `claude` CLI, so no
API key lives in this repo.

Reading a store happens in two passes, on two endpoints:

  POST /api/vision/look   photos in, a plain-prose reading out, plus a session id.
                          This pass only looks. No schema, no category list, so it
                          is free to notice small details on the shelves.
  POST /api/vision/map    session id in, a structured store spec out. This pass is
                          given the reading, the photos again, the categories the
                          model was actually trained on, and the floor archetypes.
                          Its whole job is to match what was seen onto what we can
                          score, and to say plainly when nothing fits.

Splitting them keeps the fine-grained looking away from the schema-filling, and it
gives the browser something true to put on screen during the wait.

Everything else in the app is static: the floor, the scoring and the 1,000-scenario
search all run in the browser against the exported response surface. If vision is
unavailable the walkthrough still works end to end on the demo floor.

Run:  python server.py        then open http://localhost:8000
"""
import base64, json, pathlib, re, shutil, subprocess, sys, tempfile, threading, time, uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent
WEB = ROOT / "web"
PORT = 8000
VISION_TIMEOUT = 180
MAX_PHOTOS = 4
SESSION_TTL = 1800

_SESSIONS = {}
_LOCK = threading.Lock()


# --------------------------------------------------------------- pass 1: look
LOOK_PROMPT = """You are looking at photograph(s) of a retail store interior, to describe
the space for someone who cannot see it.

Write 150-250 words of plain prose. No JSON, no headings, no bullet points.

Say what you actually see, in this order:

1. What kind of store this is, and how big it looks. Corner shop or bodega, a small
   neighbourhood market, a full supermarket, or something else entirely.
2. The fixtures. Shelf runs, refrigerated cases, open islands, perimeter wall units,
   checkouts. Roughly how many, and where they sit relative to each other.
3. The products, in as much detail as you can actually make out. Read labels and
   shelf tags if they are legible. Name specific things: "two-litre cola bottles",
   "bagged tortilla chips", "sliced sandwich cheese", "a three-door cooler of
   sports drinks". This is the most useful part of your answer, so spend most of
   your words here and go shelf by shelf if the photo allows it.
4. Signage and the dominant colours of the floor, walls and fixtures.

Describe only what is visible. If something is cut off, blurred or ambiguous, say so
rather than filling it in. Do not guess at products you cannot see."""


# ---------------------------------------------------------------- pass 2: map
MAP_PROMPT = """You are turning a description of a real store into a spec that a sales
simulator can score.

Here is the reading of the photograph(s):
---
__READING__
---

The photographs themselves are attached again, so check the reading against them.

The simulator can only score these categories, because these are the only ones it was
trained on. This list is closed:
__CATEGORIES__

The simulator supports these floor archetypes. Each one carries a different set of
contested positions, because a corner shop does not have a weekly circular and a
supermarket has several:
__ARCHETYPES__

Return ONLY a JSON object, no prose and no code fence, with exactly these keys:

{
  "store_type": "<one archetype key from the list above>",
  "store_type_confidence": <0.0-1.0>,
  "store_type_reason": "<one short clause, max 15 words>",
  "name": "<a short plausible name for this store>",
  "summary": "<one sentence, max 20 words, on the fixtures and look>",
  "size": {"w": <metres across>, "d": <metres deep>, "h": <ceiling metres>},
  "palette": {"floor": "#rrggbb", "wall": "#rrggbb", "fixture": "#rrggbb",
              "cool": "#rrggbb", "produce": "#rrggbb"},
  "posters": [{"x": <m>, "z": <m>, "w": <m>, "h": <m>, "text": "WORD"}],
  "observations": [
    {"seen": "<what you saw, concrete, max 12 words>",
     "match": "<one CATEGORY exactly, or null>",
     "confidence": <0.0-1.0>,
     "reason": "<why this category is the closest, or why nothing fits. max 15 words>",
     "fixture": "gondola|cooler|island|wall",
     "x": <centre m>, "z": <centre m>, "w": <m>, "d": <m>}
  ],
  "current": {"<slot id from the chosen archetype>": "<CATEGORY or null>"}
}

Rules for matching, which matter more than anything else here:

- One observation per distinct product group you saw. Include the ones that match
  nothing: they are the honest part of the answer.
- "match" must be a category from the closed list above, spelled exactly, or null.
- Match on what the product IS, not on the word used. Bagged crisps or tortilla
  chips are BAG SNACKS. Bottled cola or lemonade is SOFT DRINKS. A sports or
  electrolyte drink is ISOTONIC DRINKS.
- Use null when nothing in the list is a reasonable home for what you saw. Cigarettes,
  lottery, beer, cleaning supplies, fresh produce and hot food have no category here.
  Say so in "reason". Do NOT stretch to the nearest survivor: a wrong match is worse
  than an honest gap, because the simulator will go on to score it.
- "confidence" is how sure you are of the MATCH, not of seeing something. Below 0.5
  means you are guessing, and that is fine to report.
- Only emit an observation for a product group you could actually see. Do not add
  categories from the list just because a store of this type usually carries them.

Rules for the rest:

- The coordinate origin is the front-left corner of the sales floor. x runs across the
  storefront, z runs from the entrance toward the back wall. Keep every zone inside
  "size", and do not overlap them.
- "fixture" should reflect the real thing: gondola for shelf runs, cooler for
  refrigerated cases, island for low open tables, wall for perimeter units.
- "current" is what is sitting on each contested position in the photo TODAY. Use the
  slot ids of the archetype you chose. A slot you cannot see, or that is empty, is null.
  This is the store as found, so report it as found even if it looks like a poor choice.
- Take the palette from the dominant colours in the photo.
- Take poster "text" from signage you can read, upper case, one or two words.
- If you cannot tell a dimension, give a sensible estimate for a store of this type."""


def _claude(prompt, paths, cwd):
    """Run the local claude CLI over a prompt plus image paths, and return its text."""
    exe = shutil.which("claude")
    if not exe:
        raise RuntimeError("the claude CLI is not on PATH, so photo analysis is unavailable")
    full = prompt + "\n\nPhotographs to read:\n" + "\n".join(str(p) for p in paths)
    out = subprocess.run(
        [exe, "-p", full, "--output-format", "json"],
        capture_output=True, text=True, timeout=VISION_TIMEOUT, cwd=str(cwd),
        # Decode as UTF-8 rather than the console codepage. On Windows the default turns
        # an em dash into "a€"" and would mangle any shop sign that is not plain ASCII,
        # which is most of them outside the US.
        encoding="utf-8", errors="replace",
    )
    if out.returncode != 0:
        raise RuntimeError((out.stderr or "the vision call failed").strip()[:300])
    body = out.stdout
    try:  # the CLI wraps the answer; unwrap it when it does
        body = json.loads(body).get("result", body)
    except json.JSONDecodeError:
        pass
    return body


def _sweep():
    """Drop sessions whose photos have been sitting in temp long enough."""
    now = time.time()
    with _LOCK:
        stale = [k for k, v in _SESSIONS.items() if now - v["at"] > SESSION_TTL]
        for sid in stale:
            shutil.rmtree(_SESSIONS.pop(sid)["dir"], ignore_errors=True)


def look(images):
    """Pass 1. Save the uploaded photos, then describe them without any schema."""
    _sweep()
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="simon-photos-"))
    paths = []
    for i, data_url in enumerate(images[:MAX_PHOTOS]):
        m = re.match(r"data:image/(\w+);base64,(.*)$", data_url, re.S)
        if not m:
            continue
        p = tmp / f"photo{i}.{m.group(1).replace('jpeg', 'jpg')}"
        p.write_bytes(base64.b64decode(m.group(2)))
        paths.append(p)
    if not paths:
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError("no readable images were uploaded")

    reading = _claude(LOOK_PROMPT, paths, tmp).strip()
    if not reading:
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError("the vision model returned an empty reading")

    sid = uuid.uuid4().hex
    with _LOCK:
        _SESSIONS[sid] = {"dir": tmp, "paths": paths, "reading": reading, "at": time.time()}
    return {"session": sid, "reading": reading, "photos": len(paths)}


def mapping(sid, categories, archetypes):
    """Pass 2. Match the reading onto the categories the model was trained on."""
    with _LOCK:
        s = _SESSIONS.get(sid)
    if not s:
        raise RuntimeError("that photo session has expired, so upload the photos again")

    prompt = (MAP_PROMPT
              .replace("__READING__", s["reading"])
              .replace("__CATEGORIES__", "\n".join("  - " + c for c in categories))
              .replace("__ARCHETYPES__", json.dumps(archetypes, indent=2)))
    body = _claude(prompt, s["paths"], s["dir"])
    m = re.search(r"\{.*\}", body, re.S)
    if not m:
        raise RuntimeError("the vision model did not return a store spec")
    spec = json.loads(m.group(0))
    spec["reading"] = s["reading"]
    return spec


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
        routes = {"/api/vision/look": self._look, "/api/vision/map": self._map}
        fn = routes.get(self.path)
        if not fn:
            return self._json(404, {"error": "no such endpoint"})
        try:
            n = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(n) or b"{}")
            self._json(200, fn(req))
        except subprocess.TimeoutExpired:
            self._json(200, {"error": f"the vision model took longer than {VISION_TIMEOUT}s"})
        except Exception as e:
            self._json(200, {"error": str(e)[:300]})

    def _look(self, req):
        return look(req.get("photos", []))

    def _map(self, req):
        return mapping(req.get("session"), req.get("categories", []), req.get("archetypes", {}))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    for f in ("data/store.json", "data/validation.json", "data/surface.json"):
        if not (WEB / f).exists():
            sys.exit(f"missing {WEB/f}\nRun:  python model/pipeline.py && python model/make_store.py")
    print(f"StoreVerse is serving {WEB}")
    print(f"  http://localhost:{PORT}\n")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
