"""Command line: motif [run] file.mtf | motif repl | motif find | motif library | motif describe | motif digest | motif scan"""

from __future__ import annotations

import argparse
import os
import sys

from . import __version__
from .interpreter import make_interpreter
from .lisp.printer import to_string
from .lisp.reader import balanced, parse_all
from .lisp.types import LispError, Symbol


def repl(interp) -> int:
    try:
        import readline  # noqa: F401  (line editing when available)
    except ImportError:
        pass
    print(f"Biomotif {__version__}. A Lisp for sequence patterns. (use-library 'all) loads the motif library; Ctrl-D exits.")
    buffer = ""
    while True:
        try:
            line = input("biomotif> " if not buffer else "      ... ")
        except EOFError:
            print()
            return 0
        except KeyboardInterrupt:
            print()
            buffer = ""
            continue
        buffer += line + "\n"
        if not balanced(buffer):
            continue
        src, buffer = buffer, ""
        if not src.strip():
            continue
        try:
            result = None
            for form in parse_all(src, "<repl>"):
                result = interp.eval(form, interp.global_env)
            if result is not None:
                print(to_string(result))
        except LispError as e:
            print(f"error: {e}")
        except SystemExit:
            return 0


def run_file(interp, path: str, args: list[str]) -> int:
    interp.define("*args*", args)
    try:
        interp.load_file(path)
    except LispError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    except FileNotFoundError:
        print(f"error: no such file: {path}", file=sys.stderr)
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0].endswith(".mtf") and os.path.exists(argv[0]):
        argv = ["run"] + argv
    parser = argparse.ArgumentParser(prog="biomotif", description="A Lisp for DNA, RNA and protein motifs.")
    parser.add_argument("--version", action="version", version=f"biomotif {__version__}")
    sub = parser.add_subparsers(dest="command")
    p_run = sub.add_parser("run", help="run a .mtf script")
    p_run.add_argument("file")
    p_run.add_argument("args", nargs="*")
    sub.add_parser("repl", help="interactive session")
    p_find = sub.add_parser("find", help="find a library motif or an s-expression in a FASTA file")
    p_find.add_argument("motif", help="library name (EcoRI, tata-box) or an expression like '(seq \"TATA\" (gap 20 30) \"ATG\")'")
    p_find.add_argument("fasta")
    p_find.add_argument("--strand", default="both", choices=["both", "+", "-"])
    p_lib = sub.add_parser("library", help="list library motifs")
    p_lib.add_argument("--category")
    p_lib.add_argument("--alphabet")
    p_lib.add_argument("--search")
    p_desc = sub.add_parser("describe", help="describe a library motif")
    p_desc.add_argument("name")
    p_dig = sub.add_parser("digest", help="restriction digest of a FASTA file")
    p_dig.add_argument("fasta")
    p_dig.add_argument("enzymes", nargs="+")
    p_dig.add_argument("--circular", action="store_true")
    p_scan = sub.add_parser("scan", help="scan a FASTA file with every library motif")
    p_scan.add_argument("fasta")
    p_scan.add_argument("--category")
    p_scan.add_argument("--exclude", default="restriction", help="comma separated categories to skip")
    ns = parser.parse_args(argv)

    interp = make_interpreter()
    if ns.command in (None, "repl"):
        return repl(interp)
    if ns.command == "run":
        return run_file(interp, ns.file, ns.args)
    try:
        interp.eval_source("(use-library 'all)")
        if ns.command == "library":
            src = f"(library {':category ' + quote(ns.category) if ns.category else ''} {':alphabet ' + quote(ns.alphabet) if ns.alphabet else ''} {':search ' + s(ns.search) if ns.search else ''})"
            names = interp.eval_source(src)
            for n in names:
                e = interp.eval_source(f"(motif-doc '{n})")
                print(f"{n.name:<28} {e[:90]}")
            print(f"\n{len(names)} motifs")
            return 0
        if ns.command == "describe":
            interp.eval_source(f"(describe '{ns.name})")
            return 0
        if ns.command == "find":
            m = ns.motif.strip()
            expr = m if m.startswith("(") else f"'{m}"
            interp.eval_source(f'(show-matches (find-all {expr} (read-fasta {s(ns.fasta)}) :strand {quote(ns.strand)}))')
            return 0
        if ns.command == "digest":
            enz = " ".join(f"'{e}" for e in ns.enzymes)
            interp.eval_source(f"(for-each (lambda (r) (println (record-name r)) (show-digest (digest r {enz} :circular {'#t' if ns.circular else '#f'}))) (read-fasta {s(ns.fasta)}))")
            return 0
        if ns.command == "scan":
            excl = " ".join(f"'{e.strip()}" for e in ns.exclude.split(",") if e.strip())
            cat = f":category {quote(ns.category)}" if ns.category else ""
            interp.eval_source(f"(show-matches (scan (read-fasta {s(ns.fasta)}) {cat} :exclude (list {excl})))")
            return 0
    except LispError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


def quote(x: str) -> str:
    return f"'{x}"


def s(x: str) -> str:
    return '"' + x.replace("\\", "\\\\").replace('"', '\\"') + '"'


if __name__ == "__main__":
    sys.exit(main())
