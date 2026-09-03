import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from biomotif.interpreter import make_interpreter  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture()
def interp():
    return make_interpreter()


@pytest.fixture()
def ev(interp):
    def run(src):
        return interp.eval_source(src)
    return run


@pytest.fixture()
def lib(interp):
    interp.eval_source("(use-library 'all)")

    def run(src):
        return interp.eval_source(src)
    return run


@pytest.fixture()
def root():
    return ROOT
