"""S-expression reader."""

from __future__ import annotations

import re

from .types import Form, LispError, Symbol

_TOKEN = re.compile(
    r"""\s*(?:(;[^\n]*)|(,@|[()'`,])|("(?:\\.|[^\\"])*")|([^\s()'`,";]+))""",
    re.S,
)

QUOTE = Symbol("quote")
QUASIQUOTE = Symbol("quasiquote")
UNQUOTE = Symbol("unquote")
UNQUOTE_SPLICING = Symbol("unquote-splicing")

_INT = re.compile(r"^[+-]?\d+$")
_FLOAT = re.compile(r"^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$")


def tokenize(src: str):
    """Yield (token, line) pairs. Comments are dropped."""
    pos = 0
    line = 1
    n = len(src)
    while pos < n:
        m = _TOKEN.match(src, pos)
        if not m or m.end() == pos:
            rest = src[pos:].strip()
            if not rest:
                return
            raise LispError(f"line {line}: cannot read {rest[:20]!r}")
        group = 1 if m.group(1) is not None else 2 if m.group(2) is not None else 3 if m.group(3) is not None else 4
        tok_start = m.start(group)
        line += src.count("\n", pos, tok_start)
        if group != 1:
            yield m.group(group), line
        line += src.count("\n", tok_start, m.end())
        pos = m.end()


def atom(tok: str):
    if tok.startswith('"'):
        return _unescape(tok[1:-1])
    if _INT.match(tok):
        return int(tok)
    if _FLOAT.match(tok):
        return float(tok)
    if tok == "#t":
        return True
    if tok == "#f":
        return False
    return Symbol(tok)


def _unescape(s: str) -> str:
    out = []
    i = 0
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s):
            nxt = s[i + 1]
            out.append({"n": "\n", "t": "\t", '"': '"', "\\": "\\"}.get(nxt, nxt))
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


class _Reader:
    def __init__(self, src: str, file: str = ""):
        self.tokens = list(tokenize(src))
        self.i = 0
        self.file = file

    def peek(self):
        return self.tokens[self.i] if self.i < len(self.tokens) else (None, 0)

    def next(self):
        tok = self.peek()
        self.i += 1
        return tok

    def read(self):
        tok, line = self.next()
        if tok is None:
            raise LispError("unexpected end of input")
        if tok == "(":
            items = Form(line=line, file=self.file)
            while True:
                nxt, _ = self.peek()
                if nxt is None:
                    raise LispError(f"line {line}: missing ')'")
                if nxt == ")":
                    self.next()
                    return items
                if nxt == ".":
                    # dotted pair in a lambda list: (a . rest) -> (a &rest rest)
                    self.next()
                    items.append(Symbol("&rest"))
                    continue
                items.append(self.read())
        if tok == ")":
            raise LispError(f"line {line}: unexpected ')'")
        if tok == "'":
            return Form([QUOTE, self.read()], line=line, file=self.file)
        if tok == "`":
            return Form([QUASIQUOTE, self.read()], line=line, file=self.file)
        if tok == ",":
            return Form([UNQUOTE, self.read()], line=line, file=self.file)
        if tok == ",@":
            return Form([UNQUOTE_SPLICING, self.read()], line=line, file=self.file)
        return atom(tok)


def parse(src: str, file: str = ""):
    """Read a single form."""
    r = _Reader(src, file)
    form = r.read()
    if r.peek()[0] is not None:
        raise LispError("more than one form in input")
    return form


def parse_all(src: str, file: str = "") -> list:
    """Read every form in the source."""
    r = _Reader(src, file)
    forms = []
    while r.peek()[0] is not None:
        forms.append(r.read())
    return forms


def balanced(src: str) -> bool:
    """True when every '(' has a ')'. Used by the REPL for multi-line input."""
    depth = 0
    try:
        for tok, _ in tokenize(src):
            if tok == "(":
                depth += 1
            elif tok == ")":
                depth -= 1
    except LispError:
        return False
    return depth <= 0
