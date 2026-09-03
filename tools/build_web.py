"""Assemble the single-file web app from web/src/ and the .mtf library.

The library files are embedded verbatim and parsed in the browser, so they stay
the one source of truth: nothing here rewrites a motif."""

import json
import os
import re
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


def main() -> int:
    library = {f"{n}.mtf": read(ROOT, "biomotif", "lib", f"{n}.mtf") for n in LIB_FILES}
    demos = {k: read(ROOT, "data", v) for k, v in DEMO_FILES.items()}
    data_script = (
        "const BIOMOTIF_LIBRARY = " + json.dumps(library) + ";\n"
        "const BIOMOTIF_DATA = " + json.dumps(demos) + ";\n"
        "window.BIOMOTIF_LIBRARY = BIOMOTIF_LIBRARY;\nwindow.BIOMOTIF_DATA = BIOMOTIF_DATA;\n"
    )
    html = read(SRC, "index.html")
    html = html.replace("/*__CSS__*/", read(SRC, "app.css"))
    html = html.replace("/*__JS__*/", data_script + "\n" + bundle_modules())
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    size = os.path.getsize(OUT)
    print(f"{OUT}  {size / 1024:.0f} KB  ({len(library)} library files, {len(demos)} example sequences)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
