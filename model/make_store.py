"""Build the demo store: a floor plan whose zones map onto real modelled categories."""
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data"
surf = json.loads((OUT / "surface.json").read_text(encoding="utf-8"))
by_cat = {c["category"]: c for c in surf["categories"]}

# Shelf homes. Each zone is a real fixture with a real category behind it.
ZONES = [
    ("SOFT DRINKS",            "Soft drinks",     "gondola", 5.0, 12.0, 2.2, 13.0),
    ("BAG SNACKS",             "Bag snacks",      "gondola", 9.5, 12.0, 2.2, 13.0),
    ("CRACKERS/MISC BKD FD",   "Crackers",        "gondola", 14.0, 12.0, 2.2, 13.0),
    ("MEAT - SHELF STABLE",    "Shelf-stable meat", "gondola", 18.5, 12.0, 2.2, 13.0),
    ("ISOTONIC DRINKS",        "Sports drinks",   "gondola", 18.5, 27.0, 2.2, 5.0),
    ("FROZEN PIZZA",           "Frozen pizza",    "cooler",  22.6, 12.5, 1.6, 12.0),
    ("CHEESE",                 "Cheese",          "cooler",  22.6, 26.0, 1.6,  6.5),
    ("YOGURT",                 "Yogurt",          "cooler",   2.0, 20.0, 1.6, 10.0),
    ("BACON",                  "Bacon",           "cooler",   2.0, 30.0, 1.6,  5.0),
    ("BAKED BREAD/BUNS/ROLLS", "Bakery",          "wall",     9.0, 32.0, 7.0,  1.4),
]

# The scarce positions a merchandiser actually fights over.
SLOTS = [
    {"id": "endcap_front_left",  "kind": "display", "level": 2, "label": "Entrance endcap (left)",
     "x": 8.6,  "z": 7.4,  "w": 2.4, "d": 1.2},
    {"id": "endcap_front_right", "kind": "display", "level": 2, "label": "Entrance endcap (right)",
     "x": 15.4, "z": 7.4,  "w": 2.4, "d": 1.2},
    {"id": "island_mid",         "kind": "display", "level": 1, "label": "Mid-floor island",
     "x": 12.0, "z": 19.0, "w": 2.2, "d": 2.2},
    {"id": "island_rear",        "kind": "display", "level": 1, "label": "Rear island",
     "x": 6.2,  "z": 27.0, "w": 2.0, "d": 2.0},
    {"id": "checklane",          "kind": "display", "level": 1, "label": "Checklane stack",
     "x": 19.4, "z": 5.0,  "w": 1.6, "d": 1.6},
    {"id": "flyer_front_1", "kind": "mailer", "level": 2, "label": "Flyer front page, lead"},
    {"id": "flyer_front_2", "kind": "mailer", "level": 2, "label": "Flyer front page, second"},
    {"id": "flyer_in_1",    "kind": "mailer", "level": 1, "label": "Flyer interior A"},
    {"id": "flyer_in_2",    "kind": "mailer", "level": 1, "label": "Flyer interior B"},
    {"id": "flyer_in_3",    "kind": "mailer", "level": 1, "label": "Flyer interior C"},
]

zones = []
for cat, title, kind, x, z, w, d in ZONES:
    c = by_cat[cat]
    zones.append({"category": cat, "title": title, "kind": kind,
                  "x": x, "z": z, "w": w, "d": d,
                  "price": c["price"], "products": c["products"],
                  "surface": c["surface"], "base": c["surface"][0][0]})

store = {
    "name": "Northgate Market",
    "note": "A 8,800 sq ft neighbourhood supermarket.",
    # The floor archetype this plan belongs to. web/archetypes.js holds the rest of them,
    # and a photo may swap this store onto any of them.
    "archetype": "neighborhood_market",
    "size": {"w": 24.0, "d": 34.0, "h": 3.4},
    "visits_per_week": 12000,
    "entrance": {"x": 4.5, "z": 0.0, "w": 4.0},
    "checkouts": [{"x": 12.0 + i * 2.6, "z": 3.0, "w": 1.1, "d": 3.0} for i in range(4)],
    "palette": {"floor": "#e9e6e1", "wall": "#f4f2ef", "fixture": "#d8d4cd",
                "accent": "#111111", "produce": "#8a9a5b", "cool": "#b8c6cc"},
    "posters": [
        {"x": 11.0, "z": 10.4, "w": 1.5, "h": 1.0, "text": "THIS WEEK"},
        {"x": 2.0,  "z": 16.0, "w": 1.2, "h": 1.6, "text": "FRESH"},
        {"x": 23.4, "z": 20.0, "w": 1.2, "h": 1.6, "text": "SAVE"},
    ],
    "zones": zones,
    "slots": SLOTS,
    # Where things sit today: the prime positions go to the categories that sell most,
    # which is how these decisions are usually made. It is a reasonable-looking plan and it
    # is still wrong, because selling most and responding most are different things.
    "current": {"endcap_front_left": "CRACKERS/MISC BKD FD",
                "endcap_front_right": "SOFT DRINKS",
                "island_mid": "CHEESE", "island_rear": None,
                "checklane": "BAG SNACKS",
                "flyer_front_1": "CRACKERS/MISC BKD FD", "flyer_front_2": "SOFT DRINKS",
                "flyer_in_1": "CHEESE", "flyer_in_2": "MEAT - SHELF STABLE",
                "flyer_in_3": None},
    "display_labels": surf["display_labels"],
    "mailer_labels": surf["mailer_labels"],
    "levers": surf["levers"], "beta": surf["beta"], "auc": surf["auc"],
}
(OUT / "store.json").write_text(json.dumps(store, indent=1), encoding="utf-8")
print(f"wrote {OUT/'store.json'}  ({len(zones)} zones, {len(SLOTS)} contested slots)")
for z in zones:
    s = z["surface"]
    best = max(((d, m, s[d][m]) for d in range(3) for m in range(3)), key=lambda t: t[2])
    print(f"  {z['title']:<20} base {z['base']*1000:5.2f}/1k  ${z['price']:<5}  "
          f"best {surf['display_labels'][best[0]]} + {surf['mailer_labels'][best[1]]}  {best[2]/z['base']:.2f}x")
