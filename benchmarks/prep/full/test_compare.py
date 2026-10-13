"""Regression checks for the streaming benchmark's output oracle."""

import copy
import json
import unittest

from benchmarks.prep.full.compare import Client
from benchmarks.prep.full.verify import SourceDecimal, lossless


class FixtureClient(Client):
    def __init__(self, pages):
        self.pages = iter(copy.deepcopy(pages))

    def request(self, path, body=None):
        return next(self.pages), 100


def page(next_block, blocks, *, done=False, epoch="0"):
    return {"epoch": epoch, "to_block": 4, "next_block": next_block,
            "cursor": None if done else "cursor", "data": {
                "blocks": blocks, "transactions": [],
            }}


class ComparisonOracleTests(unittest.TestCase):
    request = {"from_block": 1, "to_block": 4, "limit": 128}
    records = [{"height": n, "amount": "0.12345678901234567890"} for n in range(1, 4)]

    def test_equivalence_ignores_page_boundaries_and_keeps_exact_values(self):
        first = FixtureClient([page(4, self.records, done=True)]).scan(self.request)
        second = FixtureClient([
            page(2, self.records[:1]), page(4, self.records[1:], done=True),
        ]).scan(self.request)
        self.assertEqual(first[0], second[0])
        self.assertEqual(first[0]["blocks"], 3)
        self.assertEqual((first[1], second[1]), (1, 2))
        changed = copy.deepcopy(self.records)
        changed[1]["amount"] = "0.12345678901234567891"
        self.assertNotEqual(first[0], FixtureClient([page(4, changed, done=True)]).scan(self.request)[0])

    def test_record_order_is_part_of_oracle(self):
        first = FixtureClient([page(4, self.records, done=True)]).scan(self.request)[0]
        reverse = FixtureClient([page(4, list(reversed(self.records)), done=True)]).scan(self.request)[0]
        self.assertNotEqual(first, reverse)

    def test_epoch_change_truncation_and_nonprogress_are_rejected(self):
        for pages in (
            [page(2, []), page(4, [], done=True, epoch="1")],
            [page(2, [], done=True)],
            [page(1, [])],
        ):
            with self.subTest(pages=pages), self.assertRaises(ValueError):
                FixtureClient(pages).scan(self.request)

    def test_source_oracle_preserves_scientific_notation_without_rounding(self):
        source = json.loads(
            '{"vpub_old":1e-6,"precise":0.12345678901234567890123456789,"zero":0.0000,"height":2909,"text":"1E-6","bool":true}',
            parse_float=SourceDecimal,
        )
        self.assertEqual(lossless(source), {
            "vpub_old": "1e-6", "precise": "0.12345678901234567890123456789",
            "zero": "0.0000", "height": "2909", "text": "1E-6", "bool": True,
        })


if __name__ == "__main__":
    unittest.main()
