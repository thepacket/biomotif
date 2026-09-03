"""The interpreter core: reader, evaluator, builtins, macros."""

import pytest

from motif.lisp import parse, parse_all, to_string
from motif.lisp.reader import balanced
from motif.lisp.types import LispError, Symbol


def test_reader_atoms():
    assert parse("42") == 42
    assert parse("-3.5") == -3.5
    assert parse('"hi"') == "hi"
    assert parse("#t") is True
    assert parse("#f") is False
    assert parse("foo") is Symbol("foo")


def test_reader_lists_and_quote():
    assert parse("(1 2 (3 4))") == [1, 2, [3, 4]]
    assert parse("'x") == [Symbol("quote"), Symbol("x")]
    assert parse("`(a ,b ,@c)") == [Symbol("quasiquote"),
                                    [Symbol("a"),
                                     [Symbol("unquote"), Symbol("b")],
                                     [Symbol("unquote-splicing"), Symbol("c")]]]


def test_reader_comments_and_strings():
    assert parse_all("; a comment\n(1 2) ; another\n(3)") == [[1, 2], [3]]
    assert parse('"a;b"') == "a;b"
    assert parse(r'"a\nb"') == "a\nb"


def test_reader_errors():
    with pytest.raises(LispError):
        parse("(1 2")
    with pytest.raises(LispError):
        parse(")")


def test_balanced():
    assert balanced("(a b)")
    assert not balanced("(a b")
    assert balanced('(a ")")')


def test_arithmetic(ev):
    assert ev("(+ 1 2 3)") == 6
    assert ev("(- 10 3 2)") == 5
    assert ev("(- 5)") == -5
    assert ev("(* 2 3 4)") == 24
    assert ev("(/ 12 3)") == 4
    assert ev("(/ 1 2)") == 0.5
    assert ev("(< 1 2 3)") is True
    assert ev("(< 1 3 2)") is False


def test_division_by_zero(ev):
    with pytest.raises(LispError):
        ev("(/ 1 0)")


def test_define_and_lambda(ev):
    assert ev("(define (sq x) (* x x)) (sq 7)") == 49
    assert ev("((lambda (a b) (+ a b)) 3 4)") == 7
    assert ev("(define f (lambda (x . rest) (cons x rest))) (f 1 2 3)") == [1, 2, 3]


def test_keyword_arguments(ev):
    assert ev("(define (f x &key (k 2) (j 3)) (list x k j)) (f 1)") == [1, 2, 3]
    assert ev("(define (f x &key (k 2)) (* x k)) (f 5 :k 10)") == 50
    with pytest.raises(LispError):
        ev("(define (f x &key (k 2)) x) (f 1 :nope 3)")


def test_optional_arguments(ev):
    assert ev("(define (f a &optional (b 9)) (list a b)) (list (f 1) (f 1 2))") == [[1, 9], [1, 2]]


def test_closures(ev):
    assert ev("(define (counter) (let ((n 0)) (lambda () (set! n (+ n 1)) n)))"
              "(define c (counter)) (c) (c) (c)") == 3


def test_tail_calls_do_not_overflow(ev):
    assert ev("(let loop ((i 0)) (if (= i 100000) i (loop (+ i 1))))") == 100000
    assert ev("(define (down n) (if (= n 0) 'done (down (- n 1)))) (down 200000)") is Symbol("done")


def test_conditionals(ev):
    assert ev("(if #t 1 2)") == 1
    assert ev("(if '() 1 2)") == 2, "the empty list is false"
    assert ev("(cond ((= 1 2) 'a) ((= 1 1) 'b) (else 'c))") is Symbol("b")
    assert ev("(cond (#f 'a) (else 'c))") is Symbol("c")
    assert ev("(and 1 2 3)") == 3
    assert ev("(and 1 #f 3)") is False
    assert ev("(or #f #f 7)") == 7
    assert ev("(when #t 1 2 3)") == 3
    assert ev("(unless #f 'yes)") is Symbol("yes")


def test_let_forms(ev):
    assert ev("(let ((a 1) (b 2)) (+ a b))") == 3
    assert ev("(let* ((a 1) (b (+ a 1))) b)") == 2
    assert ev("(let loop ((i 0) (acc 1)) (if (> i 4) acc (loop (+ i 1) (* acc 2))))") == 32


def test_do_and_while(ev):
    assert ev("(do ((i 0 (+ i 1)) (s 0 (+ s i))) ((= i 5) s))") == 10
    assert ev("(define n 0) (while (< n 4) (set! n (+ n 1))) n") == 4


def test_lists(ev):
    assert ev("(map (lambda (x) (* x x)) '(1 2 3))") == [1, 4, 9]
    assert ev("(map + '(1 2) '(10 20))") == [11, 22]
    assert ev("(filter odd? '(1 2 3 4 5))") == [1, 3, 5]
    assert ev("(reduce + 0 '(1 2 3 4))") == 10
    assert ev("(reduce + '(1 2 3 4))") == 10
    assert ev("(append '(1 2) '(3) '(4 5))") == [1, 2, 3, 4, 5]
    assert ev("(reverse '(1 2 3))") == [3, 2, 1]
    assert ev("(apply + 1 '(2 3))") == 6
    assert ev("(unique '(1 2 1 3 2))") == [1, 2, 3]
    assert ev("(flatten '(1 (2 (3 4)) 5))") == [1, 2, 3, 4, 5]
    assert ev("(chunk '(1 2 3 4 5) 2)") == [[1, 2], [3, 4], [5]]
    assert ev("(zip '(1 2) '(a b))") == [[1, Symbol("a")], [2, Symbol("b")]]


def test_sort_and_group(ev):
    assert ev("(sort '(3 1 2))") == [1, 2, 3]
    assert ev("(sort '(3 1 2) :reverse #t)") == [3, 2, 1]
    assert ev('(sort (list "bbb" "a" "cc") :key string-length)') == ["a", "cc", "bbb"]
    assert ev("(group-by even? '(1 2 3 4))") == [[False, [1, 3]], [True, [2, 4]]]
    assert ev("(partition odd? '(1 2 3 4))") == [[1, 3], [2, 4]]
    assert ev("(max-by string-length (list \"a\" \"bbb\" \"cc\"))") == "bbb"


def test_strings(ev):
    assert ev('(string-append "a" "b" "c")') == "abc"
    assert ev('(string-split "a,b,c" ",")') == ["a", "b", "c"]
    assert ev('(string-join (list "a" "b") "-")') == "a-b"
    assert ev('(string-upcase "abc")') == "ABC"
    assert ev('(substring "abcdef" 1 3)') == "bc"
    assert ev('(string-contains? "hello" "ell")') is True
    assert ev('(string-pad-left "7" 3 "0")') == "007"


def test_tables(ev):
    assert ev("(define t (make-table 'a 1 'b 2)) (table-get t 'a)") == 1
    assert ev("(define t (make-table)) (table-set! t 'x 5) (table-get t 'x)") == 5
    assert ev("(table-get (frequencies '(a b a c a)) 'a)") == 3
    assert ev("(sort (table-keys (frequencies '(b a))) :key ->string)") == [Symbol("a"), Symbol("b")]
    assert ev("(define t (make-table 'a 1)) (table-increment! t 'a 4) (table-get t 'a)") == 5


def test_macros(ev):
    assert ev("(defmacro twice (x) `(+ ,x ,x)) (twice 21)") == 42
    assert ev("(defmacro my-list (. xs) `(list ,@xs)) (my-list 1 2 3)") == [1, 2, 3]


def test_prelude_threading(ev):
    assert ev("(->> '(1 2 3 4) (filter even?) (map (lambda (x) (* x 10))))") == [20, 40]
    assert ev("(-> 10 (- 3) (- 2))") == 5


def test_prelude_helpers(ev):
    assert ev("(define n 1) (inc! n 5) n") == 6
    assert ev("(define xs '()) (push! 3 xs) (push! 4 xs) xs") == [4, 3]
    assert ev("(percent 0.5)") == "50.0%"


def test_format(ev):
    assert ev('(format "~a-~a" 1 2)') == "1-2"
    assert ev('(format "~,2f" 3.14159)') == "3.14"
    assert ev('(format "~s" "x")') == '"x"'
    assert ev('(format "~a~%" 1)') == "1\n"


def test_printer():
    assert to_string([1, Symbol("a"), "b"]) == '(1 a "b")'
    assert to_string("b", write=False) == "b"
    assert to_string(True) == "#t"


def test_errors_report_a_line(ev):
    with pytest.raises(LispError) as e:
        ev("(+ 1 2)\n(undefined-thing)")
    assert "undefined-thing" in str(e.value)
    assert "2" in str(e.value)


def test_error_builtin(ev):
    with pytest.raises(LispError, match="boom"):
        ev('(error "boom")')


def test_assert_macro(ev):
    ev("(assert (= 1 1))")
    with pytest.raises(LispError):
        ev("(assert (= 1 2))")
