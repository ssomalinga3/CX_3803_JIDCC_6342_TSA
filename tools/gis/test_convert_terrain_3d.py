import base64
import io
import json
import math
import unittest

import numpy as np
from PIL import Image

from convert_terrain_3d import OUTPUT, METADATA_OUTPUT, LIMIT_BYTES, TILE_LIMIT, encode_dem, generate, metadata


class Terrain3dTest(unittest.TestCase):
    def test_rgb_roundtrip_metres(self):
        heights = np.array([[248.76, 275.0, 315.66]], dtype="float32")
        rgb = encode_dem(heights).astype("float64")
        decoded = -10000 + (rgb[..., 0] * 65536 + rgb[..., 1] * 256 + rgb[..., 2]) * .1
        np.testing.assert_allclose(decoded, heights, atol=.051)

    def test_reproducible_bounded_assets(self):
        self.assertEqual(OUTPUT.read_text(), generate())
        document = json.loads(OUTPUT.read_text())
        self.assertEqual(METADATA_OUTPUT.read_text(), metadata(OUTPUT.read_text()))
        self.assertNotIn('tiles', json.loads(METADATA_OUTPUT.read_text()))
        self.assertNotIn('surface', json.loads(METADATA_OUTPUT.read_text()))
        self.assertLess(OUTPUT.stat().st_size, LIMIT_BYTES)
        self.assertLessEqual(len(document["tiles"]), TILE_LIMIT)
        self.assertEqual(document['extentScale'], 3)
        self.assertEqual({int(key.split('/')[0]) for key in document['tiles']}, {14,15})
        for uri in document["tiles"].values():
            image = Image.open(io.BytesIO(base64.b64decode(uri.split(",")[1])))
            self.assertEqual(image.size, (256, 256))
            rgb = np.array(image).astype("float64")
            heights = -10000 + (rgb[..., 0] * 65536 + rgb[..., 1] * 256 + rgb[..., 2]) * .1
            self.assertGreaterEqual(heights.min(), math.floor(document['rangeMetres'][0]))
            self.assertLessEqual(heights.max(), math.ceil(document['rangeMetres'][1]))
