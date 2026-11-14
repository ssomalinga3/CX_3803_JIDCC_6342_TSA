"""Signal registration, conservative recovery, exclusions and source-only semantics."""

from collections import Counter
from copy import deepcopy
import json
import unittest

from PIL import Image, ImageDraw

from convert_signal import CLASSES, COLORS, OUTPUT, REVIEW, convert, fit_controls, observations


class SignalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data, cls.report = convert()

    def test_exact_snapshot_and_class_counts_are_reproducible(self):
        self.assertEqual(self.data, json.loads(OUTPUT.read_text()))
        self.assertEqual(self.report, json.loads((OUTPUT.parent / "review/signal-extraction.json").read_text()))
        self.assertEqual(self.report["counts_by_class"], dict(zip(CLASSES, [217, 90, 116, 92, 162])))
        self.assertEqual(len(self.data["features"]), 677)
        self.assertEqual(len({f["id"] for f in self.data["features"]}), 677)

    def test_recovers_each_class_without_legend_stars_or_text_fragments(self):
        image = Image.new("RGB", (160, 60), "white")
        draw = ImageDraw.Draw(image)
        for i, color in enumerate(COLORS):
            x = 10 + 25*i
            draw.ellipse((x-3,17,x+3,23), fill=color, outline="#343434")
            draw.ellipse((x-3,42,x+3,48), fill=color, outline="#343434")
        # Tiny colored fragments cannot become samples.
        draw.rectangle((148,20,149,25), fill=COLORS[0])
        recovered, _ = observations(image, [{"bbox": [0, 35, 159, 59]}])
        self.assertEqual(Counter(p["class"] for p in recovered), dict.fromkeys(CLASSES, 1))
        self.assertTrue(all(p["pixel"][1] == 20 for p in recovered))

    def test_merged_or_exclusion_clipped_cores_are_omitted_instead_of_inventing_centers(self):
        image = Image.new("RGB", (40, 30), "white")
        draw = ImageDraw.Draw(image)
        draw.ellipse((5,5,11,11), fill=COLORS[0])
        draw.ellipse((10,5,16,11), fill=COLORS[0])
        draw.ellipse((25,5,31,11), fill=COLORS[1])
        recovered, rejected = observations(image, [{"bbox": [29,0,39,29]}])
        self.assertEqual(recovered, [])
        self.assertGreater(len(rejected), 0)

    def test_registration_has_independent_checks_and_rejects_displaced_controls(self):
        review = json.loads(REVIEW.read_text())
        _, _, residuals, _ = fit_controls(review)
        self.assertEqual(Counter(c["use"] for c in residuals), {"fit": 6, "validation": 4, "annotation": 2})
        self.assertLess(max(c["residual_ground_m"] for c in residuals if c["use"] == "validation"), 28)
        broken = deepcopy(review)
        next(c for c in broken["controls"] if c["id"] == "V2")["pixel"][0] += 100
        with self.assertRaisesRegex(ValueError, "registration"):
            fit_controls(broken)
        broken["controls"] = [c for c in review["controls"] if c["use"] == "fit"]
        with self.assertRaisesRegex(ValueError, "withheld"):
            fit_controls(broken)

    def test_published_points_preserve_pixels_and_do_not_invent_measurements(self):
        review = json.loads(REVIEW.read_text())
        geographic, _, _, _ = fit_controls(review)
        for f in self.data["features"]:
            p = f["properties"]
            self.assertEqual(f["geometry"]["coordinates"], geographic(*p["source_pixel"]))
            self.assertEqual(f["geometry"]["type"], "Point")
            lon, lat = f["geometry"]["coordinates"]
            self.assertTrue(-84.485 < lon < -84.474 and 33.714 < lat < 33.721)
            self.assertEqual(set(p), {"name","feature_kind","isDemo","source_dataset","source_file","source_sha256","extraction_version","source_pixel","signal_class","positioning"})
            x,y = p["source_pixel"]
            for e in review["exclusions"]:
                x0,y0,x1,y1=e["bbox"]
                self.assertFalse(x0 <= x <= x1 and y0 <= y <= y1)


if __name__ == "__main__":
    unittest.main()
