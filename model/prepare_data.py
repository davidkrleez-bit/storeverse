"""
Fetch the chain's records once and store them in a form the pipeline can load quickly.

Source: the public Complete Journey retail study, distributed as R data files. A year of
loyalty-card receipts from a US grocery chain, with the weekly in-store display position
and flyer position for every product in every store, which is what makes the promotion
effect measurable rather than guessable.

Run:  python model/prepare_data.py
"""
import pathlib, sys, urllib.request

import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = DATA / "raw"
BASE = "https://github.com/bradleyboehmke/completejourney/raw/master/data"
FILES = {
    "transactions.rds": "transactions",
    "promotions.rds": "promotions",
    "products.rda": "products",
    "demographics.rda": "demographics",
}


def fetch():
    CACHE.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        dest = CACHE / name
        if dest.exists() and dest.stat().st_size > 1000:
            print(f"  have {name} ({dest.stat().st_size/1e6:.1f} MB)")
            continue
        print(f"  downloading {name} ...", flush=True)
        urllib.request.urlretrieve(f"{BASE}/{name}", dest)
        print(f"  got {name} ({dest.stat().st_size/1e6:.1f} MB)")


def convert():
    import pyreadr
    DATA.mkdir(parents=True, exist_ok=True)
    for name, stem in FILES.items():
        out = DATA / f"{stem}.parquet"
        res = pyreadr.read_r(str(CACHE / name))
        df = next(iter(res.values()))
        # These arrive as character columns in the R files and must end up as one
        # numeric type everywhere, or the joins between tables silently return nothing.
        for c in ("product_id", "household_id", "store_id", "basket_id"):
            if c in df.columns:
                n = pd.to_numeric(df[c], errors="coerce")
                if n.notna().all():
                    df[c] = n.astype("int64")
                else:
                    raise ValueError(f"{stem}.{c} has {int(n.isna().sum())} non-numeric ids")
        if "week" in df.columns:
            df["week"] = df["week"].astype("int16")
        df.to_parquet(out, index=False)
        print(f"  wrote {out.name}  {len(df):,} rows x {len(df.columns)} cols")


if __name__ == "__main__":
    try:
        import pyreadr  # noqa: F401
    except ImportError:
        sys.exit("pyreadr is required:  python -m pip install --user pyreadr pyarrow")
    print("fetching source records")
    fetch()
    print("converting")
    convert()
    print("\ndone. next:  python model/pipeline.py")
