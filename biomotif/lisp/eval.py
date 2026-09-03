"""The evaluator: special forms, macro expansion, procedure application."""

from __future__ import annotations

import os

from .reader import QUASIQUOTE, QUOTE, UNQUOTE, UNQUOTE_SPLICING, parse_all
from .types import Builtin, Env, Form, Lambda, LispError, Macro, Symbol, truthy

S = Symbol
IF, COND, ELSE, DEFINE, SET, LAMBDA, LET, LETSTAR, BEGIN, AND, OR, WHEN, UNLESS = (
    S("if"), S("cond"), S("else"), S("define"), S("set!"), S("lambda"), S("let"),
    S("let*"), S("begin"), S("and"), S("or"), S("when"), S("unless"))
DEFMACRO, WHILE, DO, ARROW = S("defmacro"), S("while"), S("do"), S("=>")
REST, KEY, OPTIONAL = S("&rest"), S("&key"), S("&optional")


class TailCall:
    __slots__ = ("proc", "args", "kwargs")

    def __init__(self, proc, args, kwargs):
        self.proc, self.args, self.kwargs = proc, args, kwargs


class Interpreter:
    def __init__(self):
        self.global_env = Env()
        self.loaded_files: set[str] = set()
        self.current_file: str | None = None
        self.output = None  # optional callable used by print builtins

    # -- loading -----------------------------------------------------------

    def eval_source(self, src: str, file: str = "<string>", env: Env | None = None):
        env = env or self.global_env
        result = None
        for form in parse_all(src, file):
            result = self.eval(form, env)
        return result

    def load_file(self, path: str, env: Env | None = None, once: bool = False):
        path = os.path.abspath(path)
        if once and path in self.loaded_files:
            return None
        with open(path, encoding="utf-8") as f:
            src = f.read()
        prev = self.current_file
        self.current_file = path
        self.loaded_files.add(path)
        try:
            return self.eval_source(src, path, env)
        finally:
            self.current_file = prev

    # -- evaluation --------------------------------------------------------

    def eval(self, x, env: Env):
        try:
            return self._eval(x, env)
        except LispError as e:
            if isinstance(x, Form) and x.line and "line " not in str(e):
                where = os.path.basename(x.file) if x.file else ""
                raise LispError(f"{e} (at {where + ':' if where else 'line '}{x.line})") from None
            raise
        except RecursionError:
            raise LispError("recursion too deep") from None

    def _eval(self, x, env: Env):
        while True:
            if isinstance(x, Symbol):
                if x.is_keyword:
                    return x
                return env.lookup(x)
            if not isinstance(x, list):
                return x
            if not x:
                return []
            head = x[0]
            if isinstance(head, Symbol):
                # --- special forms ---
                if head is QUOTE:
                    return x[1]
                if head is QUASIQUOTE:
                    return self._quasi(x[1], env, 1)
                if head is IF:
                    if len(x) < 3:
                        raise LispError("if needs a test and a consequent")
                    if truthy(self.eval(x[1], env)):
                        x = x[2]
                    elif len(x) > 3:
                        x = x[3]
                    else:
                        return None
                    continue
                if head is COND:
                    x = self._cond(x, env)
                    if x is _NOTHING:
                        return None
                    continue
                if head is DEFINE:
                    return self._define(x, env)
                if head is SET:
                    env.set(x[1], self.eval(x[2], env))
                    return None
                if head is LAMBDA:
                    return self._lambda(x[1], x[2:], env)
                if head is DEFMACRO:
                    proc = self._lambda(x[1][1:] if isinstance(x[1], list) else x[2], x[2:] if isinstance(x[1], list) else x[3:], env)
                    name = x[1][0] if isinstance(x[1], list) else x[1]
                    proc.name = name.name
                    env.define(name, Macro(proc))
                    return name
                if head is LET or head is LETSTAR:
                    if isinstance(x[1], Symbol):
                        # named let: (let loop ((i 0)) body)
                        name, bindings, body = x[1], x[2], x[3:]
                        params = [b[0] if isinstance(b, list) else b for b in bindings]
                        args = [self.eval(b[1], env) if isinstance(b, list) else None for b in bindings]
                        loop_env = Env({}, env)
                        proc = Lambda(params, None, None, body, loop_env, name.name)
                        loop_env.define(name, proc)
                        env = Env(dict(zip(params, args)), loop_env)
                        x = self._body(body, env)
                        continue
                    new = Env({}, env)
                    scope = new if head is LETSTAR else env
                    for b in x[1]:
                        if isinstance(b, list):
                            new.define(b[0], self.eval(b[1], scope))
                        else:
                            new.define(b, None)
                    env = new
                    x = self._body(x[2:], env)
                    continue
                if head is BEGIN:
                    if len(x) == 1:
                        return None
                    x = self._body(x[1:], env)
                    continue
                if head is AND:
                    v = True
                    for e in x[1:-1]:
                        v = self.eval(e, env)
                        if not truthy(v):
                            return v
                    if len(x) > 1:
                        x = x[-1]
                        continue
                    return v
                if head is OR:
                    for e in x[1:-1]:
                        v = self.eval(e, env)
                        if truthy(v):
                            return v
                    if len(x) > 1:
                        x = x[-1]
                        continue
                    return False
                if head is WHEN or head is UNLESS:
                    t = truthy(self.eval(x[1], env))
                    if t == (head is WHEN):
                        x = self._body(x[2:], env)
                        continue
                    return None
                if head is WHILE:
                    while truthy(self.eval(x[1], env)):
                        for e in x[2:]:
                            self.eval(e, env)
                    return None
                if head is DO:
                    return self._do(x, env)
                # --- macros ---
                op_env = env.find(head)
                op = op_env.vars[head] if op_env is not None else None
                if isinstance(op, Macro):
                    x = self._apply(op.proc, x[1:], {})
                    continue
                if op is None:
                    raise LispError(f"unbound symbol: {head}")
            else:
                op = self.eval(head, env)
            # --- application ---
            args = []
            kwargs = {}
            accepts_kw = (isinstance(op, Builtin) and op.kw) or (isinstance(op, Lambda) and op.keys is not None)
            items = x[1:]
            i = 0
            while i < len(items):
                a = items[i]
                if accepts_kw and isinstance(a, Symbol) and a.is_keyword and i + 1 < len(items):
                    kwargs[a.name[1:].replace("-", "_")] = self.eval(items[i + 1], env)
                    i += 2
                    continue
                args.append(self.eval(a, env))
                i += 1
            if isinstance(op, Lambda):
                env = self._bind(op, args, kwargs)
                x = self._body(op.body, env)
                continue
            return self._call(op, args, kwargs)

    def _body(self, body, env):
        """Evaluate all but the last form, return the last for tail evaluation."""
        if not body:
            return None
        for e in body[:-1]:
            self.eval(e, env)
        return body[-1]

    def _cond(self, x, env):
        for clause in x[1:]:
            if not isinstance(clause, list) or not clause:
                raise LispError("bad cond clause")
            if clause[0] is ELSE:
                return self._body(clause[1:], env)
            v = self.eval(clause[0], env)
            if truthy(v):
                if len(clause) == 1:
                    return [QUOTE, v]
                if len(clause) == 3 and clause[1] is ARROW:
                    f = self.eval(clause[2], env)
                    return [QUOTE, self.apply(f, [v])]
                return self._body(clause[1:], env)
        return _NOTHING

    def _do(self, x, env):
        # (do ((var init step)...) (test result...) body...)
        specs, test = x[1], x[2]
        new = Env({}, env)
        for spec in specs:
            new.define(spec[0], self.eval(spec[1], env))
        while not truthy(self.eval(test[0], new)):
            for e in x[3:]:
                self.eval(e, new)
            steps = [(spec[0], self.eval(spec[2], new)) for spec in specs if len(spec) > 2]
            for name, val in steps:
                new.define(name, val)
        result = None
        for e in test[1:]:
            result = self.eval(e, new)
        return result

    def _define(self, x, env):
        target = x[1]
        if isinstance(target, list):
            name = target[0]
            proc = self._lambda(target[1:], x[2:], env)
            proc.name = name.name
            env.define(name, proc)
            return name
        if len(x) < 3:
            env.define(target, None)
            return target
        value = self.eval(x[2], env)
        if isinstance(value, Lambda) and value.name == "lambda":
            value.name = target.name
        env.define(target, value)
        return target

    def _lambda(self, params, body, env) -> Lambda:
        doc = None
        if len(body) > 1 and isinstance(body[0], str):
            doc, body = body[0], body[1:]
        if isinstance(params, Symbol):
            return Lambda([], params, None, body, env, doc=doc)
        positional, rest, keys = [], None, None
        mode = "pos"
        it = iter(params)
        for p in it:
            if p is REST:
                rest = next(it)
                continue
            if p is KEY:
                mode = "key"
                keys = []
                continue
            if p is OPTIONAL:
                mode = "opt"
                keys = keys or []
                continue
            if mode == "pos":
                positional.append(p)
            elif mode == "opt":
                positional.append(p[0] if isinstance(p, list) else p)
                keys.append((S("&opt"), p[1] if isinstance(p, list) else None))
            else:
                keys.append((p[0], p[1]) if isinstance(p, list) else (p, None))
        return Lambda(positional, rest, keys, body, env, doc=doc)

    def _bind(self, proc: Lambda, args, kwargs) -> Env:
        vars = {}
        n = len(proc.params)
        optional = sum(1 for k, _ in (proc.keys or []) if k is S("&opt"))
        if len(args) < n - optional or (len(args) > n and proc.rest is None):
            raise LispError(f"{proc.name}: expected {n - optional}{'+' if proc.rest else ''} arguments, got {len(args)}")
        for i, p in enumerate(proc.params):
            if i < len(args):
                vars[p] = args[i]
            else:
                default = proc.keys[i - (n - optional)][1]
                vars[p] = self.eval(default, proc.env) if default is not None else None
        if proc.rest is not None:
            vars[proc.rest] = list(args[n:])
        env = Env(vars, proc.env)
        if proc.keys:
            for k, default in proc.keys:
                if k is S("&opt"):
                    continue
                key = k.name.replace("-", "_")
                if key in kwargs:
                    env.define(k, kwargs.pop(key))
                else:
                    env.define(k, self.eval(default, env) if default is not None else None)
            if kwargs:
                raise LispError(f"{proc.name}: unknown keyword(s) {', '.join(':' + k for k in kwargs)}")
        return env

    def _call(self, op, args, kwargs):
        if isinstance(op, Builtin):
            try:
                return op.fn(*args, **kwargs) if op.kw else op.fn(*args)
            except LispError:
                raise
            except TypeError as e:
                msg = str(e)
                if "positional argument" in msg or "unexpected keyword" in msg or "required" in msg:
                    raise LispError(f"{op.name}: {msg.split(')', 1)[-1].strip() or msg}") from None
                raise LispError(f"{op.name}: {msg}") from None
            except (ValueError, KeyError, IndexError, ZeroDivisionError, AttributeError) as e:
                raise LispError(f"{op.name}: {e}") from None
        if isinstance(op, Lambda):
            return self._apply(op, args, kwargs)
        if callable(op):
            return op(*args, **kwargs)
        raise LispError(f"not a procedure: {op!r}")

    def _apply(self, proc: Lambda, args, kwargs):
        env = self._bind(proc, list(args), dict(kwargs))
        x = self._body(proc.body, env)
        return self.eval(x, env)

    def apply(self, op, args, kwargs=None):
        """Call any procedure from Python."""
        return self._call(op, list(args), kwargs or {})

    def _quasi(self, x, env, depth):
        if not isinstance(x, list) or not x:
            return x
        head = x[0]
        if head is UNQUOTE:
            if depth == 1:
                return self.eval(x[1], env)
            return [UNQUOTE, self._quasi(x[1], env, depth - 1)]
        if head is QUASIQUOTE:
            return [QUASIQUOTE, self._quasi(x[1], env, depth + 1)]
        out = []
        for item in x:
            if isinstance(item, list) and item and item[0] is UNQUOTE_SPLICING and depth == 1:
                spliced = self.eval(item[1], env)
                if not isinstance(spliced, list):
                    raise LispError("unquote-splicing needs a list")
                out.extend(spliced)
            else:
                out.append(self._quasi(item, env, depth))
        return out

    # -- convenience --------------------------------------------------------

    def define(self, name: str, value):
        self.global_env.define(Symbol(name), value)

    def builtin(self, name: str, fn, doc: str | None = None, kw: bool = False):
        self.define(name, Builtin(fn, name, doc, kw))


_NOTHING = object()
