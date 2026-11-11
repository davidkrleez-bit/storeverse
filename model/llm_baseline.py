"""
Ask language models the question StoreVerse-1 answers, and score them the same way.

The claim StoreVerse exists to support is "we can estimate the effect of a merchandising change".
A language model is the obvious thing a planner would reach for instead, so it should have
to answer the same question on the same scale and be marked against the same measurement.

Each model is asked, for each lever, by what multiple weekly unit sales change. That number
goes straight into the same table as StoreVerse-1's recovered lift and is scored against the
stratified estimate from the holdout receipts.

Every model is asked several times. Run-to-run spread is reported, because a planner who
asks once gets one draw from that spread and has no way to know how wide it was.

Providers
  claude CLI       always used when `claude` is on PATH, no key needed
  OpenRouter       used when OPENROUTER_API_KEY is set, which is the only way to reach
                   TypeSafe's Jev decision model and the other hosted LLMs

Run:  python model/llm_baseline.py [--repeats 5]
"""
import argparse, json, os, pathlib, re, shutil, statistics, subprocess, sys, urllib.error, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data"
VALIDATION = OUT / "validation.json"

LEVER_KEYS = ["secondary_display", "front_endcap", "flyer_interior", "flyer_front"]

PROMPT = """You are estimating promotional response for a US supermarket chain, for a planning decision worth real money.

For a typical mid-selling grocery product (not a top-10 staple), estimate how its weekly unit sales change under each merchandising treatment below, compared with the same product sitting on its normal shelf with no promotion. Price is unchanged in every case. Report the multiple of baseline unit sales.

1. secondary_display: moved to a secondary in-aisle or in-shelf display, still no flyer
2. front_endcap: moved to a front-of-store endcap, still no flyer
3. flyer_interior: stays on its normal shelf, featured on an interior page of the weekly flyer
4. flyer_front: stays on its normal shelf, featured on the front page of the weekly flyer

Answer with ONLY a JSON object, no prose and no code fence:
{"secondary_display": <number>, "front_endcap": <number>, "flyer_interior": <number>, "flyer_front": <number>}

A multiple of 1.0 means no change. Give your single best point estimate for each."""

# Exact ids as OpenRouter serves them. Check /api/v1/models before changing these:
# guessing a version that does not exist fails validation rather than being coerced.
OPENROUTER_MODELS = [
    # Jev is not a language model: TypeSafe build it as a "System One" decision model that
    # returns typed answers with probabilities. It is in here because it is the closest
    # commercial thing to what StoreVerse-1 does, not as another chatbot.
    ("jev", "typesafe/jev-router", "TypeSafe's decision model, used as-is", "decision model"),
    ("gpt", "openai/gpt-5.6-luna-pro", "a general-purpose LLM asked to estimate", "LLM"),
    ("gemini", "google/gemini-2.5-pro", "a general-purpose LLM asked to estimate", "LLM"),
    ("llama", "meta-llama/llama-3.3-70b-instruct", "an open-weight LLM asked to estimate", "LLM"),
]


def parse(body):
    """Pull the JSON object out of whatever the model wrapped it in."""
    try:
        body = json.loads(body).get("result", body)
    except (json.JSONDecodeError, AttributeError):
        pass
    m = re.search(r"\{[^{}]*\}", body, re.S)
    if not m:
        raise ValueError("no JSON object in the reply")
    obj = json.loads(m.group(0))
    out = {}
    for k in LEVER_KEYS:
        if k not in obj:
            raise ValueError(f"missing {k}")
        out[k] = float(obj[k])
    return out


def ask_claude(timeout=180):
    exe = shutil.which("claude")
    if not exe:
        raise RuntimeError("claude CLI not on PATH")
    r = subprocess.run([exe, "-p", PROMPT, "--output-format", "json"],
                       capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "claude CLI failed").strip()[:200])
    return parse(r.stdout)


def ask_openrouter(model_id, key, timeout=180):
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps({"model": model_id,
                         "messages": [{"role": "user", "content": PROMPT}]}).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = json.loads(r.read())
    if "choices" not in body:
        raise RuntimeError(str(body.get("error", body))[:200])
    return parse(body["choices"][0]["message"]["content"])


def run(name, fn, repeats):
    draws, errors = [], []
    for i in range(repeats):
        try:
            draws.append(fn())
            print(f"    {name} draw {i+1}/{repeats}: " +
                  " ".join(f"{k.split('_')[0]} {draws[-1][k]:.2f}" for k in LEVER_KEYS), flush=True)
        except Exception as e:
            errors.append(str(e)[:160])
            print(f"    {name} draw {i+1}/{repeats} failed: {errors[-1]}", flush=True)
    if not draws:
        return None, errors
    est = {k: statistics.mean(d[k] for d in draws) for k in LEVER_KEYS}
    spread = {k: (max(d[k] for d in draws) - min(d[k] for d in draws)) for k in LEVER_KEYS}
    return {"estimate": est, "spread": spread, "draws": len(draws),
            "raw": [{k: d[k] for k in LEVER_KEYS} for d in draws]}, errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeats", type=int, default=5)
    args = ap.parse_args()

    if not VALIDATION.exists():
        sys.exit(f"missing {VALIDATION}\nRun:  python model/pipeline.py")
    V = json.loads(VALIDATION.read_text(encoding="utf-8"))

    engines, notes = {}, []
    print("asking the language models")

    if shutil.which("claude"):
        res, errs = run("claude", ask_claude, args.repeats)
        if res:
            engines["claude"] = {**res, "label": "Claude", "kind": "LLM",
                                 "note": "a general-purpose LLM asked to estimate"}
        elif errs:
            notes.append(f"Claude could not be scored: {errs[-1]}")
    else:
        notes.append("The claude CLI is not on PATH, so Claude was not scored.")

    key = os.environ.get("OPENROUTER_API_KEY")
    if key:
        for name, model_id, note, kind in OPENROUTER_MODELS:
            res, errs = run(name, lambda m=model_id: ask_openrouter(m, key), args.repeats)
            if res:
                engines[name] = {**res, "label": model_id.split("/")[-1], "note": note,
                                 "kind": kind, "model_id": model_id}
            elif errs:
                notes.append(f"{model_id} could not be scored: {errs[-1]}")
    else:
        notes.append(
            "OPENROUTER_API_KEY is not set, so TypeSafe's Jev and the other hosted models "
            "were not scored. Jev has no free endpoint and no local weights, so there is no "
            "way to run it from here without a key. Set the key and re-run this script to "
            "fill the column in; nothing else needs to change.")

    # Score every model against the same stratified measurement StoreVerse-1 is scored on.
    measured = {k: V["effects"][k]["actual"] for k in LEVER_KEYS
                if V["effects"].get(k, {}).get("actual")}
    for e in engines.values():
        errs, inside = [], {}
        for k, a in measured.items():
            v = e["estimate"][k]
            errs.append(abs(v - a["lift"]))
            inside[k] = bool(a["lo"] <= v <= a["hi"])
        e["lift_mae"] = sum(errs) / len(errs) if errs else None
        e["in_range"] = inside
        e["in_range_count"] = sum(inside.values())

    V["llm"] = {"engines": engines, "notes": notes, "repeats": args.repeats,
                "prompt": PROMPT}
    VALIDATION.write_text(json.dumps(V, indent=1), encoding="utf-8")

    print("\nscored against the stratified measurement")
    print(f"  {'engine':<16}{'sec disp':>10}{'endcap':>9}{'flyer in':>10}{'flyer fr':>10}"
          f"{'lift MAE':>10}{'in CI':>7}")
    meas_row = "  " + f"{'measured':<16}" + "".join(
        f"{measured[k]['lift']:>10.2f}" if k in measured else f"{'-':>10}" for k in LEVER_KEYS)
    print(meas_row)
    print("  " + f"{'StoreVerse-1':<16}" + "".join(
        f"{V['effects'][k]['simulated']['simon1']:>10.2f}" for k in LEVER_KEYS) +
        f"{V['lift_mae']['simon1']:>10.3f}" +
        f"{sum(V['effects'][k]['in_range']['simon1'] for k in LEVER_KEYS):>7}")
    for name, e in engines.items():
        print("  " + f"{e['label']:<16}" +
              "".join(f"{e['estimate'][k]:>10.2f}" for k in LEVER_KEYS) +
              f"{e['lift_mae']:>10.3f}{e['in_range_count']:>7}")
    for n in notes:
        print(f"\n  note: {n}")
    print(f"\nwrote {VALIDATION}")


if __name__ == "__main__":
    main()
