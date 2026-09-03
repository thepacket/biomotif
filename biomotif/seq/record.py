"""A sequence record: name, sequence, type and annotations."""

from __future__ import annotations

from .alphabet import guess_type


class Record:
    __slots__ = ("name", "seq", "type", "annotations", "offset", "description")

    def __init__(self, name: str, seq: str, type: str | None = None, annotations: dict | None = None,
                 offset: int = 0, description: str = ""):
        self.name = name
        self.seq = seq
        self.type = type or guess_type(seq)
        self.annotations = annotations or {}
        self.offset = offset      # position of seq[0] in the parent sequence (for windows)
        self.description = description

    def __len__(self) -> int:
        return len(self.seq)

    def sub(self, start: int, end: int, name: str | None = None) -> "Record":
        return Record(name or f"{self.name}:{self.offset + start}-{self.offset + end}", self.seq[start:end],
                      self.type, dict(self.annotations), self.offset + start, self.description)

    def lisp_repr(self) -> str:
        preview = self.seq if len(self.seq) <= 20 else self.seq[:17] + "..."
        return f'#<record {self.name} {self.type} {len(self.seq)}bp "{preview}">' if self.type != "protein" \
            else f'#<record {self.name} protein {len(self.seq)}aa "{preview}">'

    def __repr__(self) -> str:
        return self.lisp_repr()
