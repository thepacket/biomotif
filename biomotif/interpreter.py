"""Build an interpreter with the language core, the sequence bindings and the prelude."""

from __future__ import annotations

import os
import sys

from .bindings import LIB_DIR, install as install_bindings
from .lisp.builtins import install as install_core
from .lisp.eval import Interpreter
from .lisp.reader import parse_all

PRELUDE = os.path.join(LIB_DIR, "prelude.mtf")


def make_interpreter(prelude: bool = True) -> Interpreter:
    sys.setrecursionlimit(max(sys.getrecursionlimit(), 20000))
    interp = Interpreter()
    install_core(interp)
    install_bindings(interp)
    _install_macros(interp)
    if prelude:
        interp.load_file(PRELUDE, once=True)
    return interp


_MACROS = """
(defmacro defmotif (name . args)
  "(defmotif name \\"doc\\" motif :ref \\"...\\" :category 'promoter :alphabet 'dna :example \\"...\\")
   Define a named motif and register it in the library."
  `(define ,name (register-motif ',name ,@args)))

(defmacro defenzyme (name site . args)
  "(defenzyme EcoRI \\"G^AATTC\\" :ref \\"...\\") -- define a restriction enzyme."
  `(define ,name (register-enzyme ',name ,site ,@args)))
"""


def _install_macros(interp: Interpreter) -> None:
    for form in parse_all(_MACROS, "<macros>"):
        interp.eval(form, interp.global_env)
