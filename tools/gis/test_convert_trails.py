"""Verify source geometry preservation, publication filtering and missing values."""

import copy
import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import UUID

from pyproj import Transformer
import shapefile

from convert_trails import CONTRACT, OUTPUT, convert, matches_snapshot, segment
from source_package import extract, verify


class TrailConversionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = extract()
        cls.archive_hash = verify()["inventory"]["inputs"][0]["sha256"]
        with shapefile.Reader(str(cls.directory / "OfficialTrailsCSNP")) as reader:
            cls.records = list(reader.iterShapeRecords())

    def test_reproduces_snapshot_and_preserves_every_original_vertex(self):
        data = convert(self.directory, self.archive_hash)
        self.assertTrue(matches_snapshot(data, json.loads(OUTPUT.read_text(encoding="utf-8"))))
        self.assertEqual(len(data["features"]), 36)
        by_id = {f["id"]: f for f in data["features"]}
        inverse = Transformer.from_crs(4326, 3857, always_xy=True)
        vertices = 0
        for item in self.records:
            row = item.record.as_dict()
            feature = by_id[f"csnp-official-trail-{UUID(row['GlobalID'])}"]
            self.assertEqual(feature["properties"]["source_properties"], {k: row[k] for k in CONTRACT["raw_fields"]})
            self.assertEqual(len(feature["geometry"]["coordinates"]), len(item.shape.points))
            for original, projected in zip(item.shape.points, feature["geometry"]["coordinates"]):
                recovered = inverse.transform(*projected)
                self.assertAlmostEqual(original[0], recovered[0], places=6)
                self.assertAlmostEqual(original[1], recovered[1], places=6)
                vertices += 1
        self.assertEqual(vertices, 1901)

    def test_missing_values_stay_absent_and_source_identity_is_not_route_grouping(self):
        features = convert(self.directory, self.archive_hash)["features"]
        self.assertEqual(sum("difficulty" in f["properties"] for f in features), 1)
        self.assertEqual(sum("average_width_in" in f["properties"] for f in features), 33)
        self.assertEqual(sum("description" in f["properties"] for f in features), 14)
        unnamed = [f for f in features if f["properties"]["name_assignment"] == "unassigned"]
        self.assertEqual(len(unnamed), 1)
        self.assertNotIn("trail_id", unnamed[0]["properties"])
        names = {f["properties"]["name"] for f in features}
        self.assertIn("South Utoy Creek Trail", names)
        self.assertIn("Turkeyfoot Creek Trail", names)
        self.assertAlmostEqual(sum(f["properties"]["length_m"] for f in features), 4098.856, places=2)
        self.assertNotIn("CREATOR", json.dumps(features))
        self.assertNotIn("EDITOR", json.dumps(features))

    def test_reproducibility_tolerates_only_projection_last_digits(self):
        data = convert(self.directory, self.archive_hash)
        tiny = copy.deepcopy(data)
        tiny["features"][0]["geometry"]["coordinates"][0][0] += 1e-12
        self.assertTrue(matches_snapshot(data, tiny))
        moved = copy.deepcopy(data)
        moved["features"][0]["geometry"]["coordinates"][0][0] += 1e-8
        self.assertFalse(matches_snapshot(data, moved))
        changed = copy.deepcopy(data)
        changed["features"][0]["properties"]["length_m"] += 0.001
        self.assertFalse(matches_snapshot(data, changed))

    def test_publication_flags_are_not_defaulted(self):
        item = self.records[0]
        row = item.record.as_dict()
        row["PublishTra"] = "FALSE"
        self.assertIsNone(segment(item.shape, row, self.archive_hash))
        for flag in (None, "", "true", "unknown"):
            row["PublishTra"] = flag
            with self.subTest(flag=flag), self.assertRaisesRegex(ValueError, "PublishTra"):
                segment(item.shape, row, self.archive_hash)

    def test_unreviewed_name_difficulty_width_and_geometry_fail(self):
        item = self.records[0]
        for key, value in (("TRL_NM", "Guessed route"), ("Difficulty", "Very hard"), ("AVG_WIDTH", -1)):
            row = item.record.as_dict()
            row[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                segment(item.shape, row, self.archive_hash)
        shape = copy.deepcopy(item.shape)
        shape.points = [[0, 0], [1, 1]]
        with self.assertRaisesRegex(ValueError, "coordinates"):
            segment(shape, item.record.as_dict(), self.archive_hash)

    def test_duplicate_or_missing_source_ids_fail_even_before_publication(self):
        item = self.records[0]
        for change in ({}, {"GlobalID": ""}, {"SEGMENT_ID": " "}):
            row = {**item.record.as_dict(), **change}
            record = SimpleNamespace(shape=item.shape, record=SimpleNamespace(as_dict=lambda: row))
            reader = MagicMock()
            reader.__enter__.return_value = reader
            reader.iterShapeRecords.return_value = [record, record]
            with self.subTest(change=change), patch("convert_trails.shapefile.Reader", return_value=reader):
                with self.assertRaises(ValueError):
                    convert(self.directory, self.archive_hash)


if __name__ == "__main__":
    unittest.main()
