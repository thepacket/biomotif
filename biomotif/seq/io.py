"""FASTA and FASTQ reading and writing."""

from __future__ import annotations

from .record import Record


def parse_fasta(text: str, type: str | None = None) -> list[Record]:
    records = []
    name, desc, chunks = None, "", []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(";"):
            continue          # blank line, or a traditional FASTA comment
        if line.startswith(">"):
            if name is not None:
                records.append(Record(name, "".join(chunks), type, description=desc))
            header = line[1:].strip()
            parts = header.split(None, 1)
            name = parts[0] if parts else ""
            desc = parts[1] if len(parts) > 1 else ""
            chunks = []
        else:
            chunks.append(line.replace(" ", ""))
    if name is not None:
        records.append(Record(name, "".join(chunks), type, description=desc))
    return records


def read_fasta(path: str, type: str | None = None) -> list[Record]:
    with open(path, encoding="utf-8") as f:
        return parse_fasta(f.read(), type)


def format_fasta(records, width: int = 70) -> str:
    out = []
    for r in records:
        header = f">{r.name}" + (f" {r.description}" if r.description else "")
        out.append(header)
        for i in range(0, len(r.seq), width):
            out.append(r.seq[i:i + width])
    return "\n".join(out) + "\n"


def write_fasta(path: str, records, width: int = 70) -> str:
    with open(path, "w", encoding="utf-8") as f:
        f.write(format_fasta(records, width))
    return path


def read_fastq(path: str) -> list[Record]:
    records = []
    with open(path, encoding="utf-8") as f:
        lines = [line.rstrip("\n") for line in f]
    for i in range(0, len(lines) - 3, 4):
        header = lines[i][1:].split(None, 1)
        rec = Record(header[0], lines[i + 1], description=header[1] if len(header) > 1 else "")
        rec.annotations["quality"] = lines[i + 3]
        records.append(rec)
    return records
