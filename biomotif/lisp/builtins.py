"""Core builtins: numbers, lists, strings, tables, control, I/O."""

from __future__ import annotations

import functools
import math
import random as _random
import re
import sys
import time

from .printer import to_string
from .types import Builtin, Lambda, LispError, Macro, Symbol, truthy


def _num(name, v):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise LispError(f"{name}: not a number: {to_string(v)}")
    return v


def install(interp):
    B = interp.builtin

    def call(f, *args):
        return interp.apply(f, args)

    # ---- numbers ---------------------------------------------------------
    def add(*a):
        return sum(_num("+", x) for x in a)

    def sub(*a):
        if not a:
            raise LispError("-: needs at least one argument")
        if len(a) == 1:
            return -_num("-", a[0])
        return functools.reduce(lambda x, y: x - _num("-", y), a[1:], _num("-", a[0]))

    def mul(*a):
        return functools.reduce(lambda x, y: x * _num("*", y), a, 1)

    def div(*a):
        if not a:
            raise LispError("/: needs at least one argument")
        nums = [_num("/", x) for x in a]
        if len(nums) == 1:
            nums = [1] + nums
        r = nums[0]
        for y in nums[1:]:
            if y == 0:
                raise LispError("/: division by zero")
            if isinstance(r, int) and isinstance(y, int) and r % y == 0:
                r = r // y
            else:
                r = r / y
        return r

    def compare(name, op):
        def f(*a):
            for x, y in zip(a, a[1:]):
                if not op(x, y):
                    return False
            return True
        return f

    B("+", add); B("-", sub); B("*", mul); B("/", div)
    B("<", compare("<", lambda x, y: x < y)); B(">", compare(">", lambda x, y: x > y))
    B("<=", compare("<=", lambda x, y: x <= y)); B(">=", compare(">=", lambda x, y: x >= y))
    B("=", compare("=", lambda x, y: x == y))
    B("mod", lambda a, b: a % b); B("remainder", lambda a, b: math.fmod(a, b) if isinstance(a, float) else int(math.fmod(a, b)))
    B("quotient", lambda a, b: int(a // b) if (a >= 0) == (b >= 0) else -int(abs(a) // abs(b)))
    B("abs", abs); B("min", min); B("max", max)
    B("floor", lambda x: int(math.floor(x))); B("ceiling", lambda x: int(math.ceil(x)))
    B("round", lambda x, d=0: round(x, d) if d else int(round(x)), kw=False)
    B("truncate", lambda x: int(x))
    B("sqrt", math.sqrt); B("exp", math.exp)
    B("log", lambda x, base=None: math.log(x) if base is None else math.log(x, base))
    B("log2", math.log2); B("log10", math.log10)
    B("expt", lambda a, b: a ** b); B("pow", lambda a, b: a ** b)
    B("sin", math.sin); B("cos", math.cos); B("tan", math.tan); B("atan", math.atan)
    B("pi", lambda: math.pi)
    interp.define("pi", math.pi)
    B("even?", lambda x: x % 2 == 0); B("odd?", lambda x: x % 2 == 1)
    B("zero?", lambda x: x == 0); B("positive?", lambda x: x > 0); B("negative?", lambda x: x < 0)
    B("number?", lambda x: isinstance(x, (int, float)) and not isinstance(x, bool))
    B("integer?", lambda x: isinstance(x, int) and not isinstance(x, bool))
    B("float?", lambda x: isinstance(x, float))
    B("1+", lambda x: x + 1); B("1-", lambda x: x - 1)
    B("sum", lambda xs: sum(xs))
    B("mean", lambda xs: sum(xs) / len(xs) if xs else 0)
    B("number->string", lambda x, digits=None: to_string(x) if digits is None else f"{x:.{digits}f}")
    B("string->number", lambda s: _to_number(s))

    _rng = _random.Random(0)

    def random(n=None, seed=None):
        if seed is not None:
            _rng.seed(seed)
        if n is None:
            return _rng.random()
        return _rng.randrange(n)

    B("random", random, "(random) -> float in [0,1); (random n) -> integer in [0,n); pass :seed to reseed.", kw=True)
    B("random-seed!", lambda s: _rng.seed(s))
    B("random-choice", lambda xs: _rng.choice(xs))
    B("shuffle", lambda xs: _rng.sample(list(xs), len(xs)))
    interp.rng = _rng

    # ---- predicates / equality --------------------------------------------
    B("not", lambda x: not truthy(x))
    B("null?", lambda x: isinstance(x, list) and not x)
    B("nil?", lambda x: x is None or (isinstance(x, list) and not x))
    B("list?", lambda x: isinstance(x, list))
    B("pair?", lambda x: isinstance(x, list) and bool(x))
    B("string?", lambda x: isinstance(x, str))
    B("symbol?", lambda x: isinstance(x, Symbol))
    B("keyword?", lambda x: isinstance(x, Symbol) and x.is_keyword)
    B("boolean?", lambda x: isinstance(x, bool))
    B("procedure?", lambda x: isinstance(x, (Lambda, Builtin)) or callable(x))
    B("table?", lambda x: isinstance(x, dict))
    B("equal?", lambda a, b: a == b)
    B("eq?", lambda a, b: a is b or (isinstance(a, (int, str)) and a == b))
    B("eqv?", lambda a, b: a is b or (isinstance(a, (int, float, str)) and a == b))

    # ---- lists ------------------------------------------------------------
    def car(x):
        if not isinstance(x, list) or not x:
            raise LispError(f"car: not a pair: {to_string(x)}")
        return x[0]

    def cdr(x):
        if not isinstance(x, list) or not x:
            raise LispError(f"cdr: not a pair: {to_string(x)}")
        return x[1:]

    B("list", lambda *a: list(a))
    B("cons", lambda a, b: [a] + (b if isinstance(b, list) else [b]))
    B("car", car); B("cdr", cdr); B("first", car); B("rest", cdr)
    B("cadr", lambda x: x[1]); B("cddr", lambda x: x[2:]); B("caddr", lambda x: x[2])
    B("second", lambda x: x[1]); B("third", lambda x: x[2])
    B("last", lambda x: x[-1] if x else None)
    B("nth", lambda x, i: x[i]); B("list-ref", lambda x, i: x[i])
    B("length", lambda x: len(x))
    B("append", lambda *ls: [y for l in ls for y in (l if isinstance(l, list) else [l])])
    B("reverse", lambda x: list(reversed(x)) if isinstance(x, list) else x[::-1])
    B("take", lambda x, n: x[:n]); B("drop", lambda x, n: x[n:])
    B("take-while", lambda f, xs: _take_while(call, f, xs))
    B("drop-while", lambda f, xs: _drop_while(call, f, xs))
    B("sublist", lambda x, a, b=None: x[a:b])
    B("range", lambda a, b=None, step=1: list(range(a) if b is None else range(a, b, step)))
    B("iota", lambda n, start=0, step=1: [start + i * step for i in range(n)])
    B("flatten", _flatten)
    B("member", lambda x, xs: xs[xs.index(x):] if x in xs else False)
    B("member?", lambda x, xs: x in xs)
    B("index-of", lambda x, xs: xs.index(x) if x in xs else -1)
    B("remove", lambda x, xs: [y for y in xs if y != x])
    B("unique", lambda xs: list(dict.fromkeys(xs)) if all(isinstance(x, (str, int, float, Symbol, bool)) for x in xs) else _unique(xs))
    B("zip", lambda *ls: [list(t) for t in zip(*ls)])
    B("assoc", lambda k, al: next((p for p in al if isinstance(p, list) and p and p[0] == k), False))
    B("alist-get", lambda k, al, default=None: next((p[1] if len(p) == 2 else p[1:] for p in al if isinstance(p, list) and p and p[0] == k), default))
    B("count", lambda f, xs: sum(1 for x in xs if truthy(call(f, x))))
    B("list-tail", lambda x, n: x[n:])
    B("make-list", lambda n, v=None: [v] * n)
    B("list-index", lambda f, xs: next((i for i, x in enumerate(xs) if truthy(call(f, x))), -1))
    B("interleave", lambda *ls: [x for t in zip(*ls) for x in t])
    B("chunk", lambda xs, n: [xs[i:i + n] for i in range(0, len(xs), n)])

    # ---- higher order -------------------------------------------------------
    def lmap(f, *ls):
        if len(ls) == 1:
            return [call(f, x) for x in ls[0]]
        return [call(f, *xs) for xs in zip(*ls)]

    def lfilter(f, xs):
        return [x for x in xs if truthy(call(f, x))]

    def lreduce(f, init, xs=None):
        if xs is None:
            xs = init
            if not xs:
                return None
            init, xs = xs[0], xs[1:]
        acc = init
        for x in xs:
            acc = call(f, acc, x)
        return acc

    def for_each(f, *ls):
        if len(ls) == 1:
            for x in ls[0]:
                call(f, x)
        else:
            for xs in zip(*ls):
                call(f, *xs)
        return None

    def lapply(f, *args):
        if not args:
            return call(f)
        last = args[-1]
        if not isinstance(last, list):
            raise LispError("apply: last argument must be a list")
        return call(f, *args[:-1], *last)

    def lsort(xs, key=None, by=None, reverse=False):
        keyf = (lambda x: call(key, x)) if key is not None else None
        if by is not None:
            return sorted(xs, key=functools.cmp_to_key(lambda a, b: -1 if truthy(call(by, a, b)) else (1 if truthy(call(by, b, a)) else 0)), reverse=truthy(reverse))
        try:
            return sorted(xs, key=keyf, reverse=truthy(reverse))
        except TypeError:
            return sorted(xs, key=lambda x: to_string(keyf(x) if keyf else x), reverse=truthy(reverse))

    def group_by(f, xs):
        groups: dict = {}
        order = []
        for x in xs:
            k = call(f, x)
            kk = k if isinstance(k, (str, int, float, Symbol, bool)) else to_string(k)
            if kk not in groups:
                groups[kk] = [k, []]
                order.append(kk)
            groups[kk][1].append(x)
        return [groups[k] for k in order]

    def partition(f, xs):
        yes, no = [], []
        for x in xs:
            (yes if truthy(call(f, x)) else no).append(x)
        return [yes, no]

    B("map", lmap); B("filter", lfilter); B("reduce", lreduce); B("fold", lreduce)
    B("for-each", for_each); B("apply", lapply)
    B("sort", lsort, "(sort list :key fn :by less-than :reverse #t)", kw=True)
    B("sort-by", lambda f, xs: lsort(xs, key=f))
    B("group-by", group_by, "(group-by fn list) -> list of (key items)")
    B("partition", partition)
    B("any?", lambda f, xs: any(truthy(call(f, x)) for x in xs))
    B("every?", lambda f, xs: all(truthy(call(f, x)) for x in xs))
    B("find", lambda f, xs: next((x for x in xs if truthy(call(f, x))), False))
    B("find-index", lambda f, xs: next((i for i, x in enumerate(xs) if truthy(call(f, x))), -1))
    B("mapcat", lambda f, xs: [y for x in xs for y in call(f, x)])
    B("identity", lambda x: x)
    B("compose", lambda *fs: Builtin(lambda *a: functools.reduce(lambda acc, f: call(f, acc), reversed(fs[:-1]), call(fs[-1], *a)), "composed"))
    B("partial", lambda f, *pre: Builtin(lambda *a: call(f, *pre, *a), "partial"))
    B("complement", lambda f: Builtin(lambda *a: not truthy(call(f, *a)), "complement"))
    B("max-by", lambda f, xs: max(xs, key=lambda x: call(f, x)) if xs else None)
    B("min-by", lambda f, xs: min(xs, key=lambda x: call(f, x)) if xs else None)
    B("sum-by", lambda f, xs: sum(call(f, x) for x in xs))

    # ---- strings ------------------------------------------------------------
    B("string-append", lambda *a: "".join(str(x) if not isinstance(x, str) else x for x in a))
    B("string-length", len)
    B("substring", lambda s, a, b=None: s[a:b])
    B("string-upcase", str.upper); B("string-downcase", str.lower)
    B("string-split", lambda s, sep=None: s.split(sep) if sep else s.split())
    B("string-join", lambda xs, sep="": sep.join(str(x) if not isinstance(x, str) else x for x in xs))
    B("string-contains?", lambda s, sub: sub in s)
    B("string-prefix?", lambda pre, s: s.startswith(pre))
    B("string-suffix?", lambda suf, s: s.endswith(suf))
    B("string-index", lambda s, sub, start=0: s.find(sub, start))
    B("string-replace", lambda s, old, new: s.replace(old, new))
    B("string-repeat", lambda s, n: s * n)
    B("string-reverse", lambda s: s[::-1])
    B("string-trim", lambda s, chars=None: s.strip(chars))
    B("string-pad-left", lambda s, n, ch=" ": str(s).rjust(n, ch))
    B("string-pad-right", lambda s, n, ch=" ": str(s).ljust(n, ch))
    B("string-count", lambda s, sub: s.count(sub))
    B("string-ref", lambda s, i: s[i])
    B("string->list", lambda s: list(s))
    B("list->string", lambda xs: "".join(xs))
    B("string->symbol", lambda s: Symbol(s))
    B("symbol->string", lambda s: s.name)
    B("keyword->string", lambda s: s.name[1:])
    B("string=?", lambda a, b: a == b)
    B("string<?", lambda a, b: a < b)
    B("string-empty?", lambda s: s == "")
    B("char-upcase", str.upper); B("char-downcase", str.lower)
    B("string", lambda *a: "".join(to_string(x, False) for x in a))
    B("->string", lambda x: to_string(x, False))
    B("write-string", lambda x: to_string(x, True))
    B("regex-match?", lambda pat, s: re.search(pat, s) is not None)
    B("regex-find-all", lambda pat, s: re.findall(pat, s))
    B("regex-replace", lambda pat, rep, s: re.sub(pat, rep, s))
    B("format", lambda fmt, *a: _format(fmt, a))
    B("gensym", lambda prefix="g": Symbol(f"{prefix}{next(_gensym)}"))

    # ---- tables (hash tables keyed by anything hashable) ---------------------
    def make_table(*pairs, **kw):
        t = {}
        for i in range(0, len(pairs) - 1, 2):
            t[_key(pairs[i])] = pairs[i + 1]
        for k, v in kw.items():
            t[Symbol(":" + k.replace("_", "-"))] = v
        return t

    B("make-table", make_table, "(make-table k1 v1 k2 v2 ...) -> a hash table", kw=False)
    B("table", make_table)
    B("table-get", lambda t, k, default=None: t.get(_key(k), default))
    B("table-ref", lambda t, k, default=None: t.get(_key(k), default))
    B("table-set!", lambda t, k, v: t.__setitem__(_key(k), v))
    B("table-update!", lambda t, k, f, default=None: t.__setitem__(_key(k), call(f, t.get(_key(k), default))))
    B("table-has?", lambda t, k: _key(k) in t)
    B("table-delete!", lambda t, k: t.pop(_key(k), None))
    B("table-keys", lambda t: list(t.keys()))
    B("table-values", lambda t: list(t.values()))
    B("table-count", lambda t: len(t))
    B("table->alist", lambda t: [[k, v] for k, v in t.items()])
    B("alist->table", lambda al: {_key(p[0]): (p[1] if len(p) == 2 else p[1:]) for p in al})
    B("table-copy", lambda t: dict(t))
    B("table-increment!", lambda t, k, n=1: t.__setitem__(_key(k), t.get(_key(k), 0) + n))

    def counts(xs):
        t: dict = {}
        for x in xs:
            t[_key(x)] = t.get(_key(x), 0) + 1
        return t

    B("frequencies", counts, "(frequencies list) -> table of item -> count")

    # ---- output ---------------------------------------------------------------
    def out(text):
        if interp.output is not None:
            interp.output(text)
        else:
            sys.stdout.write(text)

    def println(*a):
        out(" ".join(to_string(x, False) for x in a) + "\n")

    def display(*a):
        out("".join(to_string(x, False) for x in a))

    B("print", println); B("println", println); B("display", display)
    B("write", lambda *a: out(" ".join(to_string(x, True) for x in a)))
    B("newline", lambda: out("\n"))
    B("printf", lambda fmt, *a: out(_format(fmt, a)))
    B("error", lambda *a: _raise(" ".join(to_string(x, False) for x in a)))
    B("time-ms", lambda: time.time() * 1000)

    def doc(f):
        if isinstance(f, (Lambda, Builtin)):
            return f.doc or ""
        if isinstance(f, Macro):
            return f.proc.doc or ""
        d = getattr(f, "doc", None)
        return d or ""

    B("doc", doc, "(doc procedure-or-motif) -> its documentation string")

    def apropos(text):
        text = text.lower()
        return sorted(k.name for k in interp.global_env.vars if text in k.name.lower())

    B("apropos", apropos, "(apropos \"substring\") -> names of globals containing it")
    B("bound?", lambda s: interp.global_env.find(s) is not None)

    # ---- files ------------------------------------------------------------------
    def read_lines(path):
        with open(interp_path(path), encoding="utf-8") as f:
            return [line.rstrip("\n") for line in f]

    def read_text(path):
        with open(interp_path(path), encoding="utf-8") as f:
            return f.read()

    def write_lines(path, lines):
        with open(interp_path(path), "w", encoding="utf-8") as f:
            for line in lines:
                f.write(to_string(line, False) + "\n")
        return path

    def write_text(path, text):
        with open(interp_path(path), "w", encoding="utf-8") as f:
            f.write(text)
        return path

    def interp_path(path):
        return path

    B("read-lines", read_lines); B("read-text", read_text)
    B("write-lines", write_lines); B("write-text", write_text)
    B("load", lambda path: interp.load_file(_resolve(interp, path)))
    B("file-exists?", lambda p: __import__("os").path.exists(p))
    B("eval", lambda x: interp.eval(x, interp.global_env))
    B("parse", lambda s: __import__("motif.lisp.reader", fromlist=["parse"]).parse(s))
    B("macroexpand-1", lambda x: _expand1(interp, x))
    B("exit", lambda code=0: sys.exit(code))


def _resolve(interp, path):
    import os
    if os.path.isabs(path) or interp.current_file is None:
        return path
    candidate = os.path.join(os.path.dirname(interp.current_file), path)
    return candidate if os.path.exists(candidate) else path


def _expand1(interp, x):
    if isinstance(x, list) and x and isinstance(x[0], Symbol):
        op = interp.global_env.find(x[0])
        if op is not None and isinstance(op.vars[x[0]], Macro):
            return interp._apply(op.vars[x[0]].proc, x[1:], {})
    return x


def _key(k):
    if isinstance(k, list):
        return tuple(_key(x) for x in k)
    return k


def _raise(msg):
    raise LispError(msg)


def _to_number(s):
    try:
        return int(s)
    except ValueError:
        try:
            return float(s)
        except ValueError:
            return False


def _take_while(call, f, xs):
    out = []
    for x in xs:
        if not truthy(call(f, x)):
            break
        out.append(x)
    return out


def _drop_while(call, f, xs):
    i = 0
    while i < len(xs) and truthy(call(f, xs[i])):
        i += 1
    return xs[i:]


def _flatten(xs):
    out = []
    for x in xs:
        if isinstance(x, list):
            out.extend(_flatten(x))
        else:
            out.append(x)
    return out


def _unique(xs):
    out = []
    for x in xs:
        if x not in out:
            out.append(x)
    return out


_gensym = iter(range(1, 10**9))

_FMT = re.compile(r"~(?:(\d*),?(\d*)([aAsSdDfF%~]))")


def _format(fmt, args):
    """A small subset of Common Lisp format: ~a ~s ~d ~% ~~ ~,2f ~10a."""
    args = list(args)
    out = []
    pos = 0
    for m in _FMT.finditer(fmt):
        out.append(fmt[pos:m.start()])
        pos = m.end()
        width, prec, kind = m.group(1), m.group(2), m.group(3).lower()
        if kind == "%":
            out.append("\n")
            continue
        if kind == "~":
            out.append("~")
            continue
        if not args:
            raise LispError("format: not enough arguments")
        v = args.pop(0)
        if kind == "a":
            s = to_string(v, False)
        elif kind == "s":
            s = to_string(v, True)
        elif kind == "d":
            s = str(int(v)) if isinstance(v, (int, float)) else to_string(v, False)
        else:  # f
            s = f"{float(v):.{int(prec) if prec else 2}f}" if isinstance(v, (int, float)) else to_string(v, False)
        if width:
            s = s.rjust(int(width)) if kind in "df" else s.ljust(int(width))
        out.append(s)
    out.append(fmt[pos:])
    return "".join(out)
