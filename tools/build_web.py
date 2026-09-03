"""Assemble the web app from web/src/ and the .mtf library.

Two outputs, same code:
  (no args)        web/biomotif.html   one self-contained file, for the Artifact
  --dist web/dist  index.html + fingerprinted .css/.js, for the nginx deployment

The split build exists so the deployed page needs no 'unsafe-inline' in its
content security policy. The library files are embedded verbatim and parsed in
the browser either way, so they stay the one source of truth: nothing here
rewrites a motif."""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "web", "src")
OUT = os.path.join(ROOT, "web", "biomotif.html")
LIB_FILES = ["prokaryote", "eukaryote", "plant", "rna", "protein", "tags", "restriction"]
DEMO_FILES = {"operon": "operon.fa", "plasmid": "plasmid.fa", "gene": "gene.fa",
              "utr3": "utr3.fa", "proteins": "proteins.fa"}


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return f.read()


EXPORTED = re.compile(r"^export\s+(?:class|function\*?|const|let)\s+(\w+)", re.M)


def bundle_modules() -> str:
    """Concatenate the ES modules into one script: no bundler, no import maps.

    app.js reaches the engine through a namespace alias (`E.search`), so the
    bundle rebuilds that alias from engine.js's own export list."""
    parts = []
    engine_names = []
    for name in ("engine.js", "library.js", "app.js"):
        text = read(SRC, name)
        if name == "engine.js":
            engine_names = EXPORTED.findall(text)
        text = re.sub(r'^\s*import\s+\{[^}]*\}\s+from\s+"\./[^"]+";\s*$', "", text, flags=re.M)
        text = re.sub(r'^\s*import\s+\*\s+as\s+\w+\s+from\s+"\./[^"]+";\s*$', "", text, flags=re.M)
        text = re.sub(r"^export\s+", "", text, flags=re.M)
        parts.append(f"/* ==== {name} ==== */\n{text}")
        if name == "engine.js":
            parts.append("/* namespace alias the modules used before bundling */\n"
                         "const E = { " + ", ".join(sorted(set(engine_names))) + " };")
    return "\n\n".join(parts)


def build_script() -> tuple[str, str, int, int]:
    """Returns (css, js, motif file count, example count)."""
    library = {f"{n}.mtf": read(ROOT, "biomotif", "lib", f"{n}.mtf") for n in LIB_FILES}
    demos = {k: read(ROOT, "data", v) for k, v in DEMO_FILES.items()}
    data = (
        "const BIOMOTIF_LIBRARY = " + json.dumps(library) + ";\n"
        "const BIOMOTIF_DATA = " + json.dumps(demos) + ";\n"
        "window.BIOMOTIF_LIBRARY = BIOMOTIF_LIBRARY;\nwindow.BIOMOTIF_DATA = BIOMOTIF_DATA;\n"
    )
    return read(SRC, "app.css"), data + "\n" + bundle_modules(), len(library), len(demos)


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:8]


def build_single(css: str, js: str) -> str:
    html = read(SRC, "index.html")
    html = html.replace("/*__CSS__*/", css)
    html = html.replace("/*__JS__*/", js)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    return OUT


def build_dist(css: str, js: str, out_dir: str) -> str:
    """index.html plus fingerprinted assets, so nginx can cache them forever
    and the page can run under script-src 'self'."""
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    css_name = f"biomotif.{digest(css)}.css"
    js_name = f"biomotif.{digest(js)}.js"
    with open(os.path.join(out_dir, css_name), "w", encoding="utf-8") as f:
        f.write(css)
    with open(os.path.join(out_dir, js_name), "w", encoding="utf-8") as f:
        f.write(js)

    html = read(SRC, "index.html")
    html = html.replace("<style>/*__CSS__*/</style>", f'<link rel="stylesheet" href="/{css_name}">')
    html = html.replace('<script type="module">/*__JS__*/</script>',
                        f'<script type="module" src="/{js_name}"></script>')
    # The single-file build is a fragment the Artifact viewer wraps; a served
    # page has to carry its own document, including the head/body boundary.
    marker = '<header class="masthead">'
    if marker not in html:
        raise SystemExit("build_dist: cannot find the masthead to split head from body")
    head, body = html.split(marker, 1)
    html = ("<!doctype html>\n<html lang=\"en\">\n<head>\n"
            '<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            '<meta name="description" content="A workbench for DNA, RNA and protein '
            'sequence patterns, with 487 documented motifs.">\n'
            '<meta name="color-scheme" content="light dark">\n'
            + head.strip() + "\n</head>\n<body>\n" + marker + body + "\n</body>\n</html>\n")
    index = os.path.join(out_dir, "index.html")
    with open(index, "w", encoding="utf-8") as f:
        f.write(html)
    return out_dir


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Build the Biomotif web app.")
    ap.add_argument("--dist", metavar="DIR", help="also write a split build for nginx into DIR")
    ns = ap.parse_args(argv)

    css, js, n_lib, n_demo = build_script()
    path = build_single(css, js)
    print(f"{path}  {os.path.getsize(path) / 1024:.0f} KB  "
          f"({n_lib} library files, {n_demo} example sequences)")
    if ns.dist:
        out = ns.dist if os.path.isabs(ns.dist) else os.path.join(ROOT, ns.dist)
        build_dist(css, js, out)
        total = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out))
        print(f"{out}  {total / 1024:.0f} KB  " + ", ".join(sorted(os.listdir(out))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
