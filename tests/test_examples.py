"""Every example script and every CLI subcommand must run clean."""

import io
import pathlib
import subprocess
import sys

import pytest

from motif.cli import main
from motif.interpreter import make_interpreter

ROOT = pathlib.Path(__file__).resolve().parents[1]
EXAMPLES = sorted((ROOT / "examples").glob("*.mtf"))
DATA = sorted((ROOT / "data").glob("*.fa"))


def test_examples_exist():
    assert len(EXAMPLES) >= 10
    assert len(DATA) >= 6


@pytest.mark.parametrize("path", EXAMPLES, ids=lambda p: p.stem)
def test_example_runs(path, monkeypatch, capsys):
    """Run each example in-process from the repository root."""
    monkeypatch.chdir(ROOT)
    interp = make_interpreter()
    out = io.StringIO()
    interp.output = out.write
    interp.load_file(str(path))
    text = out.getvalue()
    assert len(text) > 500, f"{path.name} produced almost no output"
    assert "error" not in text.lower() or "no error" in text.lower()


@pytest.mark.parametrize("path", DATA, ids=lambda p: p.stem)
def test_data_file_parses(path):
    from motif.seq.io import read_fasta
    recs = read_fasta(str(path))
    assert recs
    for r in recs:
        assert r.seq
        assert set(r.seq.upper()) <= set("ACGTUNRYSWKMBDHV") or r.type == "protein"


def run_cli(monkeypatch, capsys, *args):
    monkeypatch.chdir(ROOT)
    code = main(list(args))
    return code, capsys.readouterr().out


def test_cli_library(monkeypatch, capsys):
    code, out = run_cli(monkeypatch, capsys, "library")
    assert code == 0
    assert "motifs" in out
    assert "EcoRI" in out


def test_cli_library_filtered(monkeypatch, capsys):
    code, out = run_cli(monkeypatch, capsys, "library", "--category", "crispr")
    assert code == 0
    assert "pam-spcas9" in out
    assert "EcoRI" not in out


def test_cli_describe(monkeypatch, capsys):
    code, out = run_cli(monkeypatch, capsys, "describe", "loxp")
    assert code == 0
    assert "34" in out or "Cre" in out


def test_cli_find_named_motif(monkeypatch, capsys):
    code, out = run_cli(monkeypatch, capsys, "find", "EcoRI", "data/plasmid.fa")
    assert code == 0
    assert "GAATTC" in out


def test_cli_find_expression(monkeypatch, capsys):
    code, out = run_cli(monkeypatch, capsys, "find",
                        '(seq "GAATTC" (gap 0 20) "GCGGCCGC")', "data/plasmid.fa")
    assert code == 0
    assert "GAATTC" in out


def test_cli_digest(monkeypatch, capsys):
    code, out = run_cli(monkeypatch, capsys, "digest", "data/plasmid.fa", "EcoRI", "HindIII")
    assert code == 0
    assert "fragments" in out


def test_cli_scan(monkeypatch, capsys):
    code, out = run_cli(monkeypatch, capsys, "scan", "data/promoters.fa", "--category", "core-promoter")
    assert code == 0
    assert "tata" in out.lower()


def test_cli_run(monkeypatch, capsys):
    code, out = run_cli(monkeypatch, capsys, "run", "examples/01-tour.mtf")
    assert code == 0
    assert "motifs" in out


def test_cli_reports_a_bad_file(monkeypatch, capsys):
    monkeypatch.chdir(ROOT)
    assert main(["run", "does-not-exist.mtf"]) == 1


def test_module_entry_point():
    r = subprocess.run([sys.executable, "-m", "motif", "--version"],
                       cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0
    assert "motif" in r.stdout
