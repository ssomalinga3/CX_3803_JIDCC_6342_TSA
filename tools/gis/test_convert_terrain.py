"""Terrain unit conversion, nodata, registration, bounded output and provenance."""

from collections import Counter
from copy import deepcopy
import json
import tempfile
import unittest

import numpy as np
from PIL import Image
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import box, mapping, shape

from convert_terrain import (
    ASSETS, CONTROLS, FT_US_M, OUTPUT, WORK, bands, boundary, convert,
    fit_controls, read_warp, shade,
    compare_pixels, verify_snapshot,
)
from source_package import PACKAGE, file_record


class TerrainTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data, cls.assets = convert()

    def test_reproduces_two_distinct_source_snapshots_and_bundled_assets(self):
        verify_snapshot(self.data, self.assets)
        self.assertEqual(Counter(f["properties"]["feature_kind"] for f in self.data["features"]), {"elevation_band": 60, "hillshade": 2})
        self.assertEqual(len({f["id"] for f in self.data["features"]}), 62)
        for key, asset in self.assets.items():
            self.assertLess(asset["bytes"], 180_000)
            with Image.open(ASSETS / f"{key}-hillshade.png") as image:
                self.assertEqual(image.size, (512, 384))
        self.assertLess(len(json.dumps(self.data).encode()), 600_000)

    def test_platform_verification_never_accepts_new_properties_or_displaced_geometry(self):
        for kind in ("properties", "geometry"):
            candidate = deepcopy(self.data)
            feature = candidate["features"][1]
            if kind == "properties":
                feature["properties"]["elevation_max_ft_us"] += 20
            else:
                feature["geometry"]["coordinates"][0][0][0] += 0.00001
            with self.assertRaises(ValueError):
                verify_snapshot(candidate, self.assets)

    def test_pixel_verification_keeps_alpha_and_shading_exact(self):
        expected = np.full((4, 4, 4), 100, dtype="uint8")
        candidate = expected.copy()
        compare_pixels(candidate, expected)
        candidate[0, 0, 0] += 1
        with self.assertRaisesRegex(ValueError, "shading"):
            compare_pixels(candidate, expected)
        candidate = expected.copy()
        candidate[0, 0, 3] += 1
        with self.assertRaisesRegex(ValueError, "transparency"):
            compare_pixels(candidate, expected)

    def test_bands_preserve_geometry_units_and_source_evidence_without_ascent(self):
        extent = shape(boundary()).buffer(2e-9)
        for feature in self.data["features"]:
            p, g = feature["properties"], shape(feature["geometry"])
            self.assertTrue(g.is_valid and not g.is_empty)
            self.assertNotIn("ELEV_GAIN", p)
            self.assertNotIn("elevation_gain", p)
            self.assertIn("NAVD88", p["vertical_datum"])
            if p["feature_kind"] == "elevation_band":
                self.assertTrue(extent.covers(g))
                self.assertEqual(p["elevation_max_ft_us"] - p["elevation_min_ft_us"], 20)
        self.assertAlmostEqual(1000 * FT_US_M, 304.8006096012192)
        national = json.loads((PACKAGE / "sources/usgs-3dep.json").read_text())
        self.assertEqual(file_record(PACKAGE / "sources/usgs-3dep.tif")["sha256"], national["raster"]["sha256"])
        self.assertFalse(national["intersecting_catalog"].get("exceededTransferLimit", False))

    def test_held_out_boundary_controls_and_rejects_bad_registration(self):
        review = json.loads(CONTROLS.read_text())
        _, residuals = fit_controls(review, boundary()["coordinates"][0])
        self.assertEqual(sum(r["use"] == "validation" for r in residuals), 7)
        self.assertLess(max(r["residual_ground_m"] for r in residuals), 1.2)
        review["controls"][-1]["pixel"][0] += 50
        with self.assertRaisesRegex(ValueError, "registration"):
            fit_controls(review, boundary()["coordinates"][0])

    def test_nodata_remains_missing_through_warp_bands_and_alpha(self):
        # Synthetic planar raster, including a missing region and a real zero.
        with tempfile.TemporaryDirectory() as directory:
            path = directory + "/nodata.tif"
            cells = np.full((16, 16), 300, dtype="float32")
            cells[4:12, 4:12] = -9999
            cells[1, 1] = 0
            affine = from_origin(0, 16, 1, 1)
            with rasterio.open(path, "w", driver="GTiff", width=16, height=16, count=1,
                dtype="float32", crs="EPSG:3857", transform=affine, nodata=-9999) as output:
                output.write(cells, 1)
            result, affine = read_warp(path, (0, 0, 16, 16), 16, 16)
            valid = np.isfinite(result)
            self.assertTrue(np.isnan(result[8, 8]))
            self.assertEqual(result[1, 1], 0)
            alpha = np.asarray(shade(result, valid, affine))[:, :, 3]
            self.assertEqual(alpha[8, 8], 0)
            self.assertEqual(alpha[1, 1], 255)
            polygons = bands(result, valid, affine, box(0, 0, 16, 16))
            missing = box(5, 5, 11, 11)
            self.assertTrue(all(shape(mapping(p)).intersection(missing).area == 0 for _, p in polygons))

    def test_runtime_images_are_transparent_outside_preserve(self):
        for key in self.assets:
            with Image.open(ASSETS / f"{key}-hillshade.png") as image:
                alpha = np.asarray(image)[:, :, 3]
            self.assertEqual(alpha[0, 0], 0)
            self.assertTrue((alpha == 255).any())
            self.assertTrue((alpha == 0).any())

    def test_relief_uses_ground_spacing_and_documented_northeast_light(self):
        affine = from_origin(0, 8, 1, 1)
        valid = np.ones((8, 8), dtype=bool)
        flat = np.full((8, 8), 300, dtype="float32")
        east_rising = flat + np.arange(8, dtype="float32")[None, :]
        south_rising = flat + np.arange(8, dtype="float32")[:, None]
        level = np.asarray(shade(flat, valid, affine))[4, 4, 0]
        self.assertLess(np.asarray(shade(east_rising, valid, affine))[4, 4, 0], level)
        self.assertGreater(np.asarray(shade(south_rising, valid, affine))[4, 4, 0], level)


if __name__ == "__main__":
    unittest.main()
