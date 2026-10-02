from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
from fractions import Fraction
import itertools
import math
import random
import sys
import unittest

from write.pdf_report import _ROW_TOLERANCE, _Span, _rows


def _baseline_rows(spans: list[_Span]) -> list[list[_Span]]:
    """Unchanged oracle from 3dd272aaeffc5feb42ab63ce8507357f3baae965."""
    rows: list[list[_Span]] = []
    for span in sorted(spans, key=lambda value: (value.page_index, value.rect[1], value.rect[0])):
        existing = next(
            (
                row
                for row in reversed(rows)
                if row[0].page_index == span.page_index
                and abs(row[0].rect[1] - span.rect[1]) <= _ROW_TOLERANCE
            ),
            None,
        )
        if existing is None:
            rows.append([span])
        else:
            existing.append(span)
    for row in rows:
        row.sort(key=lambda value: value.rect[0])
    return rows


def _span(index: int, *, page: int = 0, x: float = 0.0, y: float = 0.0) -> _Span:
    return _Span(page, (x, y, 200.0, 500.0), f"span-{index}", 10.0, "Helvetica", 0, 0, 0, index)


def row_fixture(name: str, size: int) -> list[_Span]:
    """Deterministic synthetic input shared with the local benchmark."""
    rng = random.Random(1729 + size)
    if name in ("sparse", "shuffled"):
        spans = [_span(index, x=float(index % 7), y=float(index * 4)) for index in range(size)]
    elif name == "dense":
        spans = [_span(index, x=float(size - index), y=0.0) for index in range(size)]
    elif name == "boundaries":
        offsets = (0.0, 1.75, 1.7501, 3.5)
        spans = [_span(index, x=float(index % 3), y=float(index // 4) * 8 + offsets[index % 4])
                 for index in range(size)]
    elif name == "overlap":
        spans = [_span(index, x=float(index % 2), y=float(index // 4) * 4) for index in range(size)]
    elif name == "pages":
        page_size = max(1, size // 8)
        spans = [_span(index, page=index // page_size, x=float(index % 3),
                       y=float(index % page_size) * 4) for index in range(size)]
    elif name == "ties":
        spans = [_span(index, page=index // 16, x=0.0, y=float(index % 16 // 4) * 4)
                 for index in range(size)]
    elif name == "nonfinite":
        spans = row_fixture("sparse", size)
        spans[-1] = replace(spans[-1], rect=(0.0, math.nan, 200.0, 500.0))
    else:
        raise ValueError(name)
    if name in ("shuffled", "boundaries", "overlap", "pages", "ties"):
        rng.shuffle(spans)
    return spans


class PdfReportRowsTest(unittest.TestCase):
    def assert_matches_baseline(self, spans: list[_Span]) -> list[list[_Span]] | None:
        original = list(spans)
        try:
            expected = _baseline_rows(spans)
        except Exception as error:
            with self.assertRaises(type(error)) as caught:
                _rows(spans)
            self.assertIs(type(caught.exception), type(error))
            self.assertEqual(caught.exception.args, error.args)
            actual = None
        else:
            actual = _rows(spans)
            self.assertEqual(actual, expected)
            self.assertEqual([[id(span) for span in row] for row in actual],
                             [[id(span) for span in row] for row in expected])
        self.assertEqual([id(span) for span in spans], [id(span) for span in original])
        return actual

    def test_empty_and_single_span(self) -> None:
        self.assertEqual(self.assert_matches_baseline([]), [])
        value = _span(0)
        self.assertEqual(self.assert_matches_baseline([value]), [[value]])

    def test_sizes_and_layouts(self) -> None:
        for size in (128, 256, 512, 1024, 2048, 4096, 8192):
            for name in ("sparse", "dense", "boundaries", "overlap", "pages", "shuffled", "ties", "nonfinite"):
                with self.subTest(size=size, layout=name):
                    self.assert_matches_baseline(row_fixture(name, size))

    def test_inclusive_positive_and_negative_boundaries(self) -> None:
        for sign in (-1, 1):
            for distance, row_count in ((math.nextafter(1.75, 0.0), 1),
                                        (1.75, 1), (math.nextafter(1.75, math.inf), 2)):
                for reverse in (False, True):
                    with self.subTest(sign=sign, distance=distance, reverse=reverse):
                        values = [_span(0, y=0.0), _span(1, y=sign * distance)]
                        if reverse:
                            values.reverse()
                        actual = self.assert_matches_baseline(values)
                        self.assertEqual(len(actual), row_count)

    def test_anchor_does_not_move_when_a_span_is_added(self) -> None:
        values = [_span(0, x=10.0, y=0.0), _span(1, x=-10.0, y=1.75), _span(2, y=3.5)]
        actual = self.assert_matches_baseline(values)
        self.assertEqual([[span.span_index for span in row] for row in actual], [[1, 0], [2]])

    def test_stable_keys_equal_objects_and_repeated_identity(self) -> None:
        first = _span(0)
        equal = replace(first)
        values = [equal, first, equal, replace(first), first]
        actual = self.assert_matches_baseline(values)
        self.assertEqual([[id(span) for span in row] for row in actual], [[id(span) for span in values]])

    def test_finite_float_extremes_and_integer_page_values(self) -> None:
        ys = [-sys.float_info.max, -1e20, -1.75, -0.0, 0.0, math.ulp(0.0),
              1.75, 1e20, math.nextafter(1e20, math.inf), sys.float_info.max]
        for page in (-10**1000, -1, 0, 10**1000):
            with self.subTest(page_sign=(page > 0) - (page < 0)):
                self.assert_matches_baseline([_span(index, page=page, y=y) for index, y in enumerate(ys)])
        values = [_span(index, page=page, y=y) for index, (page, y) in enumerate(
            ((10**1000, 0.0), (-10**1000, 2.0), (0, 0.0), (10**1000, 1.0), (-10**1000, 0.0)))]
        self.assert_matches_baseline(values)

    def test_nonfinite_coordinate_positions_and_orders(self) -> None:
        for axis in range(4):
            for value in (math.nan, math.inf, -math.inf):
                spans = [_span(0, y=0.0), _span(1, y=100.0), _span(2, y=1.0)]
                rect = list(spans[1].rect)
                rect[axis] = value
                spans[1] = replace(spans[1], rect=tuple(rect))
                for order in itertools.permutations(spans):
                    with self.subTest(axis=axis, value=value, order=[span.span_index for span in order]):
                        self.assert_matches_baseline(list(order))
        # A NaN between two close, finite y values invalidates a latest-row-only scan.
        values = [_span(0, y=0.0), _span(1, y=math.nan), _span(2, y=1.0)]
        actual = self.assert_matches_baseline(values)
        self.assertEqual([[span.span_index for span in row] for row in actual], [[0, 2], [1]])

    def test_unvalidated_coordinate_types_keep_baseline_results_and_errors(self) -> None:
        for value in (0, True, 10**1000, Decimal("1.5"), Decimal("NaN"), Decimal("Infinity"),
                      Fraction(3, 2), "1.5", None, complex(1, 0)):
            for axis in range(4):
                with self.subTest(value_type=type(value).__name__, axis=axis):
                    spans = [_span(0), _span(1, y=4.0), _span(2, y=1.0)]
                    rect = list(spans[1].rect)
                    rect[axis] = value
                    spans[1] = replace(spans[1], rect=tuple(rect))
                    self.assert_matches_baseline(spans)
        for ys in ((10**1000, 10**1000 + 1, 10**1000 + 4), (True, False, True),
                   (0, 1.0, 3), (Decimal("0"), Decimal("1.75"), Decimal("4")),
                   ("0", "1", "4"), (None,), (0.0, 10**1000)):
            self.assert_matches_baseline([_span(index, y=y) for index, y in enumerate(ys)])
        # Huge integer coordinates on another page need no float subtraction or conversion.
        self.assert_matches_baseline([_span(0), _span(1, page=1, y=10**1000)])

    def test_unvalidated_pages_keep_baseline_results_and_errors(self) -> None:
        for pages in ((True, False, True), (0, 0.0, 1), ("b", "a", "a"),
                      (None, None), (math.nan, 0, 0), (math.inf, 0, -math.inf),
                      (0, "0"), (Decimal("NaN"), 0), (Fraction(1, 2), Fraction(1, 2))):
            with self.subTest(pages=pages):
                spans = [_span(index, page=page, y=float(index % 2)) for index, page in enumerate(pages)]
                self.assert_matches_baseline(spans)

    def test_malformed_rectangles_and_span_types(self) -> None:
        for rect in ((), (0.0,), (0.0, 1.0), [0.0, 1.0, 2.0, 3.0], None):
            with self.subTest(rect=rect):
                self.assert_matches_baseline([replace(_span(0), rect=rect), _span(1, y=4.0)])
        self.assert_matches_baseline([None])
        for missing in ("page_index", "rect"):
            incomplete = _span(0)
            object.__delattr__(incomplete, missing)
            self.assert_matches_baseline([incomplete, _span(1)])

        class SpanSubclass(_Span):
            pass

        original = _span(0)
        subclass = SpanSubclass(**vars(original))
        self.assert_matches_baseline([subclass, _span(1, y=1.0), _span(2, y=4.0)])

    def test_custom_operations_and_exception_timing_are_unchanged(self) -> None:
        def run(function, mode):
            events = []

            class Number(float):
                def __lt__(self, other):
                    events.append(("lt", float(self), float(other)))
                    return super().__lt__(other)

                def __eq__(self, other):
                    events.append(("eq", float(self), float(other)))
                    return super().__eq__(other)

                def __sub__(self, other):
                    events.append(("sub", float(self), float(other)))
                    if mode == "exception":
                        raise RuntimeError("coordinate subtraction")
                    return super().__sub__(other)

            class Rect(tuple):
                def __getitem__(self, index):
                    events.append(("rect", index))
                    return super().__getitem__(index)

                def __len__(self):
                    raise AssertionError("new rectangle validation")

            class SpanSubclass(_Span):
                def __getattribute__(self, name):
                    if name in ("rect", "page_index"):
                        events.append(("span", name))
                    return super().__getattribute__(name)

            class SpanList(list):
                def __iter__(self):
                    events.append(("iterate",))
                    return super().__iter__()

            spans = [_span(0), _span(1, y=4.0), _span(2, y=1.0)]
            if mode == "rect":
                spans = [replace(span, rect=Rect(span.rect)) for span in spans]
            elif mode == "span":
                spans = [SpanSubclass(**vars(span)) for span in spans]
            elif mode == "page":
                spans = [replace(span, page_index=Number(span.page_index)) for span in spans]
            elif mode == "input":
                spans = SpanList(spans)
            else:
                spans = [replace(span, rect=(span.rect[0], Number(span.rect[1]), *span.rect[2:]))
                         for span in spans]
            try:
                result = function(spans)
                outcome = [[span.span_index for span in row] for row in result]
            except Exception as error:
                outcome = (type(error).__name__, error.args)
            return outcome, events

        for mode in ("number", "exception", "rect", "span", "page", "input"):
            with self.subTest(mode=mode):
                self.assertEqual(run(_rows, mode), run(_baseline_rows, mode))

    def test_sort_key_side_effects_cannot_enable_the_fast_path(self) -> None:
        def run(function):
            spans = []

            class Coordinate(float):
                def __lt__(self, other):
                    # The captured keys have a custom ordering even after their spans
                    # have been rewritten to plain floats during the sort.
                    for span in spans:
                        x, y, right, bottom = span.rect
                        object.__setattr__(span, "rect", (x, float(y), right, bottom))
                    return False

            spans = [_span(index, y=Coordinate(y)) for index, y in enumerate((0.0, 10.0, 1.0))]
            rows = function(spans)
            for row in rows:
                for span in row:
                    self.assertIs(span, spans[span.span_index])
            return [[span.span_index for span in row] for row in rows]

        self.assertEqual(run(_baseline_rows), [[0, 2], [1]])
        self.assertEqual(run(_rows), run(_baseline_rows))

    def test_seeded_generated_layouts(self) -> None:
        rng = random.Random(20261002)
        for trial in range(500):
            spans = [_span(index, page=rng.choice((-1, 0, 1, 10**1000)),
                           x=float(rng.randrange(-4, 5)),
                           y=rng.choice((-sys.float_info.max, -0.0, 0.0, 1.75,
                                         math.nextafter(1.75, math.inf), sys.float_info.max,
                                         float(rng.randrange(-20, 20)) * 1.75)))
                     for index in range(rng.randrange(129))]
            rng.shuffle(spans)
            with self.subTest(trial=trial):
                self.assert_matches_baseline(spans)


if __name__ == "__main__":
    unittest.main()
