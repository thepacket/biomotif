"""The motif library registry."""

from __future__ import annotations

from .combinators import Matcher, Tagged, coerce


class Entry:
    __slots__ = ("name", "matcher", "doc", "ref", "category", "alphabet", "example", "meta", "source",
                 "scan")

    def __init__(self, name, matcher, doc="", ref="", category="misc", alphabet="dna", example=None,
                 meta=None, source=None, scan=True):
        self.name = name
        self.matcher = matcher
        self.doc = doc
        self.ref = ref
        self.category = category
        self.alphabet = alphabet
        self.example = example
        self.meta = meta or {}
        self.source = source
        # False for templates and scaffolds that match almost anywhere. They stay
        # in the library and can be searched for by name, but `scan` skips them.
        self.scan = scan

    def lisp_repr(self):
        return f"#<entry {self.name}>"


REGISTRY: dict[str, Entry] = {}


def register(name: str, matcher, **kw) -> Tagged:
    m = coerce(matcher)
    tagged = m if isinstance(m, Tagged) and m.name == name else Tagged(m, name)
    REGISTRY[name] = Entry(name, tagged, **kw)
    return tagged


def get(name: str) -> Entry:
    if name not in REGISTRY:
        raise KeyError(f"no motif named {name!r} in the library (did you (use-library 'all)?)")
    return REGISTRY[name]


def entries(category: str | None = None, alphabet: str | None = None, text: str | None = None) -> list[Entry]:
    out = []
    for e in REGISTRY.values():
        if category and e.category != category:
            continue
        if alphabet and e.alphabet != alphabet:
            continue
        if text:
            t = text.lower()
            if t not in e.name.lower() and t not in e.doc.lower() and t not in e.category.lower():
                continue
        out.append(e)
    return out


def categories() -> list[str]:
    return sorted({e.category for e in REGISTRY.values()})
