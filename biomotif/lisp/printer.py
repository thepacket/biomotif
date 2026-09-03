"""Printing values back as s-expressions."""

from __future__ import annotations

from .types import Symbol


def to_string(v, write: bool = True) -> str:
    """Render a value. With write=True strings are quoted (like `write`),
    otherwise shown raw (like `display`)."""
    if v is True:
        return "#t"
    if v is False:
        return "#f"
    if v is None:
        return "nil"
    if isinstance(v, Symbol):
        return v.name
    if isinstance(v, str):
        if write:
            return '"' + v.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'
        return v
    if isinstance(v, float):
        if v == int(v) and abs(v) < 1e15:
            return repr(v)
        return f"{v:.6g}"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, list):
        return "(" + " ".join(to_string(x, write) for x in v) + ")"
    if isinstance(v, tuple):
        return "#(" + " ".join(to_string(x, write) for x in v) + ")"
    if isinstance(v, dict):
        inner = " ".join(f"({to_string(k, write)} . {to_string(x, write)})" for k, x in v.items())
        return "#table(" + inner + ")"
    if hasattr(v, "lisp_repr"):
        return v.lisp_repr()
    return repr(v)
