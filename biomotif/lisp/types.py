"""Core value types of the interpreter."""

from __future__ import annotations


class LispError(Exception):
    """Any error raised while reading or evaluating Lisp code."""


class Symbol:
    """An interned symbol. Keywords are symbols whose name starts with ':'."""

    __slots__ = ("name",)
    _table: dict[str, "Symbol"] = {}

    def __new__(cls, name: str) -> "Symbol":
        sym = cls._table.get(name)
        if sym is None:
            sym = object.__new__(cls)
            sym.name = name
            cls._table[name] = sym
        return sym

    @property
    def is_keyword(self) -> bool:
        return self.name.startswith(":") and len(self.name) > 1

    def __repr__(self) -> str:
        return self.name

    def __str__(self) -> str:
        return self.name


def sym(name: str) -> Symbol:
    return Symbol(name)


class Form(list):
    """A list read from source, remembering the line it started on."""

    __slots__ = ("line", "file")

    def __init__(self, items=(), line: int = 0, file: str = ""):
        super().__init__(items)
        self.line = line
        self.file = file


class Env:
    """A lexical environment: a dict of bindings with a parent."""

    __slots__ = ("vars", "parent")

    def __init__(self, vars: dict | None = None, parent: "Env | None" = None):
        self.vars = vars if vars is not None else {}
        self.parent = parent

    def find(self, name: Symbol) -> "Env | None":
        env: Env | None = self
        while env is not None:
            if name in env.vars:
                return env
            env = env.parent
        return None

    def lookup(self, name: Symbol):
        env = self.find(name)
        if env is None:
            raise LispError(f"unbound symbol: {name}")
        return env.vars[name]

    def define(self, name: Symbol, value) -> None:
        self.vars[name] = value

    def set(self, name: Symbol, value) -> None:
        env = self.find(name)
        if env is None:
            raise LispError(f"cannot set! unbound symbol: {name}")
        env.vars[name] = value


class Lambda:
    """A user-defined procedure."""

    __slots__ = ("params", "rest", "keys", "body", "env", "name", "doc")

    def __init__(self, params, rest, keys, body, env, name="lambda", doc=None):
        self.params = params      # list[Symbol]
        self.rest = rest          # Symbol | None
        self.keys = keys          # list[(Symbol, default_expr)] | None
        self.body = body          # list of forms
        self.env = env
        self.name = name
        self.doc = doc

    def __repr__(self) -> str:
        return f"#<procedure {self.name}>"


class Macro:
    __slots__ = ("proc",)

    def __init__(self, proc: Lambda):
        self.proc = proc

    def __repr__(self) -> str:
        return f"#<macro {self.proc.name}>"


class Builtin:
    """A procedure implemented in Python."""

    __slots__ = ("fn", "name", "doc", "kw")

    def __init__(self, fn, name: str, doc: str | None = None, kw: bool = False):
        self.fn = fn
        self.name = name
        self.doc = doc
        self.kw = kw   # accepts :keyword arguments

    def __repr__(self) -> str:
        return f"#<builtin {self.name}>"


def truthy(v) -> bool:
    """Only #f, nil and the empty list are false."""
    if v is False or v is None:
        return False
    if isinstance(v, list) and not v:
        return False
    return True
