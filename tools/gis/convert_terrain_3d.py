"""Package the preserved USGS subset as bounded MapLibre RGB DEM tiles.

No network, new GIS import, or change to the existing 2D terrain contract.
"""
import argparse
import base64
import hashlib
import io
import json
import math

import numpy as np
from PIL import Image
from pyproj import Transformer
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_bounds

from source_package import PACKAGE, ROOT

OUTPUT = ROOT / "mobile/assets/terrain-3d/elevation.json"
METADATA_OUTPUT = OUTPUT.with_name("elevation-metadata.json")
ZOOM, MIN_ZOOM, SIZE = 15, 14, 256
LIMIT_BYTES, TILE_LIMIT = 4_000_000, 25
WORLD = 20037508.342789244


def png_data(pixels):
    stream = io.BytesIO()
    Image.fromarray(pixels).save(stream, format="PNG", optimize=False)
    return "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode("ascii")


def encode_dem(heights):
    value = np.rint((heights + 10000) * 10).astype("uint32")
    return np.stack([(value >> 16) & 255, (value >> 8) & 255, value & 255], -1).astype("uint8")


def generate():
    path = PACKAGE / "sources/usgs-3dep-3d.tif"
    record = json.loads((PACKAGE / "sources/usgs-3dep-3d.json").read_text())
    original = json.loads((PACKAGE / 'sources/usgs-3dep.json').read_text())
    if record.get('base_raster_sha256') != original['raster']['sha256'] or record.get('base_extent') != original['export']['extent']:
        raise ValueError('Expanded 3D extent must reference the unchanged original USGS subset')
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != record["raster"]["sha256"]:
        raise ValueError("USGS source checksum mismatch")
    with rasterio.open(path) as src:
        cells = src.read(1)
        if src.crs.to_epsg() != 3857 or not np.isfinite(cells).all() or (cells == src.nodata).any():
            raise ValueError("3D display requires a complete EPSG:3857 metre-height grid")
        west, south, east, north = src.bounds
        base = record['base_extent']
        if record.get('display_extent_scale') != 3 or not (
            math.isclose(east-west, 3*(base['xmax']-base['xmin']), abs_tol=.01) and
            math.isclose(north-south, 3*(base['ymax']-base['ymin']), abs_tol=.01)
        ):
            raise ValueError('3D elevation must cover exactly 3× width and height')
        inverse = Transformer.from_crs(3857, 4326, always_xy=True)
        bounds = [*inverse.transform(west, south), *inverse.transform(east, north)]
        coordinates = [list(inverse.transform(x, y)) for x, y in
                       [(west, north), (east, north), (east, south), (west, south)]]
        tiles = {}
        for zoom in range(MIN_ZOOM, ZOOM+1):
            span = 2 * WORLD / 2**zoom
            for x in range(math.floor((west + WORLD) / span), math.floor((east + WORLD) / span) + 1):
                for y in range(math.floor((WORLD - north) / span), math.floor((WORLD - south) / span) + 1):
                    left, top = x * span - WORLD, WORLD - y * span
                    target = from_bounds(left, top - span, left + span, top, SIZE, SIZE)
                    grid = np.full((SIZE, SIZE), np.nan, dtype="float32")
                    reproject(cells, grid, src_transform=src.transform, src_crs=src.crs,
                              dst_transform=target, dst_crs=src.crs, dst_nodata=np.nan,
                              resampling=Resampling.bilinear, num_threads=1)
                    # Padding prevents cliffs only outside the actual display footprint.
                    rows, cols = np.indices(grid.shape)
                    sample_x = left + (cols + .5) * span / SIZE
                    sample_y = top - (rows + .5) * span / SIZE
                    source_cols = np.clip(((sample_x - west) / src.transform.a).astype(int), 0, src.width - 1)
                    source_rows = np.clip(((north - sample_y) / -src.transform.e).astype(int), 0, src.height - 1)
                    grid = np.where(np.isfinite(grid), grid, cells[source_rows, source_cols])
                    tiles[f"{zoom}/{x}/{y}"] = png_data(encode_dem(grid))
        dy, dx = np.gradient(cells, -src.transform.e * math.cos(math.radians(33.717)),
                             src.transform.a * math.cos(math.radians(33.717)))
        light = np.clip((-dx + dy + math.sqrt(2)) / (2 * np.sqrt(dx*dx + dy*dy + 1)), .25, 1)
        height = (cells - cells.min()) / (cells.max() - cells.min())
        low, high = np.array([156, 186, 132]), np.array([218, 207, 166])
        rgb = (low + height[..., None] * (high - low)) * (.55 + .55 * light[..., None])
        surface = png_data(np.clip(rgb, 0, 255).astype("uint8"))
    result = {"version": 1, "sourceSha256": digest, "attribution": "Elevation: USGS 3DEP · NAVD88 metres",
              "bounds": bounds, "coordinates": coordinates, "zoom": ZOOM, "minZoom": MIN_ZOOM, "tileSize": SIZE,
              "extentScale": 3, "baseExtent": base,
              "rangeMetres": [round(float(cells.min()), 2), round(float(cells.max()), 2)],
              "tiles": tiles, "surface": surface}
    encoded = json.dumps(result, separators=(",", ":")) + "\n"
    if len(encoded) > LIMIT_BYTES or len(tiles) > TILE_LIMIT:
        raise ValueError("3D elevation asset exceeds bounded display budget")
    return encoded


def metadata(content):
    document = json.loads(content)
    return json.dumps({key: value for key, value in document.items()
                       if key not in ("tiles", "surface")}, separators=(",", ":")) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    content = generate()
    manifest = metadata(content)
    if args.check:
        if OUTPUT.read_text() != content or METADATA_OUTPUT.read_text() != manifest:
            raise SystemExit("3D terrain assets are stale")
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(content)
        METADATA_OUTPUT.write_text(manifest)
    print(f"3D elevation verified: {len(content)} bytes")
