"""Regression evidence for geographic extraction, registration and reconciliation."""

from collections import Counter
import json
import unittest

from shapely.geometry import Polygon, shape, box

from convert_pdf_map import Registration, convert, polygon, OUTPUT, REVIEW
from source_package import SOURCES, ROOT


class PdfMapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = convert()

    def test_reproducible_snapshot_and_physical_feature_counts(self):
        self.assertEqual(self.data, json.loads(OUTPUT.read_text()))
        self.assertEqual(
            Counter(f["properties"]["feature_kind"] for f in self.data["features"]),
            {
                "boundary": 1,
                "water": 2,
                "natural_area": 2,
                "road": 3,
                "building": 3,
                "landmark": 22,
            },
        )
        ids = [f["id"] for f in self.data["features"]]
        self.assertEqual(len(ids), len(set(ids)))
        # Counts describe connected polygons after union, not paint commands.
        water = [
            f
            for f in self.data["features"]
            if f["properties"]["feature_kind"] == "water"
        ]
        self.assertEqual(
            [f["properties"]["source_paths"] for f in water], [[383, 386], [385, 388]]
        )
        self.assertTrue(
            any(
                len(f["geometry"]["coordinates"]) > 1
                for f in self.data["features"]
                if f["geometry"]["type"] == "Polygon"
            )
        )

    def test_geometry_is_valid_bounded_and_symbols_exclude_legend(self):
        reg = Registration(SOURCES / "CSNP Trail Map.pdf")
        extent = box(-84.48438, 33.71162, -84.47411, 33.72052)
        symbols = []
        for f in self.data["features"]:
            g = shape(f["geometry"])
            self.assertTrue(g.is_valid and not g.is_empty)
            self.assertTrue(extent.covers(g))
            if "source_symbol" in f["properties"]:
                symbols.append(f)
                self.assertEqual(f["properties"]["source_group"], "Points of Interest")
                self.assertLess(f["properties"]["source_page_anchor"][1], 1500)
        self.assertEqual(len(symbols), 15)
        self.assertEqual(
            Counter(f["properties"]["landmark_kind"] for f in symbols),
            {
                "parking": 1,
                "bridge": 1,
                "picnic_area": 1,
                "outdoor_classroom": 2,
                "historical_site": 3,
                "cultural_feature": 1,
                "rock_outcrop": 3,
                "specimen_tree": 1,
                "wildlife_viewing_area": 1,
                "waterfall": 1,
            },
        )
        # Independent known geographic corners test axis order, vertical flip, projected interpolation.
        x0, y0, x1, y1 = reg.bounds
        self.assertEqual(reg.geographic(x0, y0), (-84.48437, 33.72051))
        self.assertEqual(reg.geographic(x1, y1), (-84.47412, 33.71163))
        for f in symbols:
            self.assertLess(
                max(
                    abs(a - b)
                    for a, b in zip(
                        reg.page(*f["geometry"]["coordinates"]),
                        f["properties"]["source_page_anchor"],
                    )
                ),
                0.001,
            )

    def test_all_eight_legacy_annotations_survive_without_duplicate_waterfall(self):
        originals = json.loads(
            (ROOT / "data/cascade-springs/features.geojson").read_text()
        )["features"][1:]
        review = json.loads(REVIEW.read_text())
        for old in originals:
            match = review["legacy_matches"][old["id"]]
            if match:
                f = next(
                    f
                    for f in self.data["features"]
                    if f["id"] == "csnp-pdf-poi-" + match
                )
                self.assertEqual(f["properties"]["source_annotations"], [old])
            else:
                f = next(f for f in self.data["features"] if f["id"] == old["id"])
                self.assertEqual(f["geometry"], old["geometry"])
                self.assertEqual(
                    f["properties"]["description_html"],
                    old["properties"]["description_html"],
                )
                self.assertEqual(
                    f["properties"]["source_name"], old["properties"]["name"]
                )
                self.assertIn("My Maps annotation", f["properties"]["name"])
        self.assertEqual(
            sum(
                f["properties"].get("landmark_kind") == "waterfall"
                for f in self.data["features"]
            ),
            1,
        )
        self.assertTrue(
            all("difficulty" not in f["properties"] for f in self.data["features"])
        )

    def test_alignment_to_every_shapefile_vertex_without_fitted_correction(self):
        report = json.loads(
            (ROOT / ".work/gis-data/pdf-map-alignment.json").read_text()
        )
        self.assertEqual(report["vertices"], 1901)
        self.assertLess(report["p95_m"], 0.5)
        self.assertLess(report["max_m"], 0.5)

    def test_compound_paths_preserve_holes_and_disconnected_parts(self):
        def lines(points):
            return [("l", a, b) for a, b in zip(points, points[1:])]

        shell = [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)]
        hole = [(2, 2), (3, 2), (3, 3), (2, 3), (2, 2)]
        island = [(20, 0), (21, 0), (21, 1), (20, 1), (20, 0)]
        result = polygon(
            {"items": lines(shell) + lines(hole) + lines(island), "even_odd": True}
        )
        self.assertTrue(result.is_valid)
        self.assertEqual(result.area, 100)
        self.assertEqual(result.geom_type, "MultiPolygon")
        self.assertEqual(sum(len(p.interiors) for p in result.geoms), 1)


if __name__ == "__main__":
    unittest.main()
