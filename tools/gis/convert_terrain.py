"""Build bounded, offline-reproducible 2D terrain from supplied and USGS grids.

Two catalog layers each own elevation bands and one bundled hillshade footprint.
The unregistered supplied PNG is review evidence, never stretched to DTM bounds.
"""

import argparse
import hashlib
import json
import math
import shutil
import time

import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
import rasterio
from rasterio.features import geometry_mask, shapes
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling
from shapely import normalize, transform
from shapely.geometry import mapping, shape

from source_package import PACKAGE, ROOT, extract, file_record

WORK = ROOT / ".work/gis-data/terrain"
ASSETS = ROOT / "mobile/assets/terrain"
OUTPUT = PACKAGE / "terrain.geojson"
CONTROLS = PACKAGE / "terrain-controls.json"
NATIONAL = PACKAGE / "sources/usgs-3dep.tif"
NATIONAL_RECORD = PACKAGE / "sources/usgs-3dep.json"
FT_US_M = 1200 / 3937
WIDTH, HEIGHT = 512, 384
LIMIT_BYTES = 600_000
KINDS = ("supplied", "usgs")
FORWARD = Transformer.from_crs(4326, 3857, always_xy=True)
INVERSE = Transformer.from_crs(3857, 4326, always_xy=True)


def boundary():
    return next(
        f["geometry"] for f in json.loads((PACKAGE / "pdf-map.geojson").read_text())["features"]
        if f["id"] == "csnp-pdf-boundary-001"
    )


def geographic(geometry):
    return mapping(transform(geometry, lambda xy: [
        [round(v, 10) for v in INVERSE.transform(x, y)] for x, y in xy
    ]))


def components(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    return [p for g in geometry.geoms for p in components(g)] if hasattr(geometry, "geoms") else []


def fit_controls(review, ring):
    """Fit in projected meters, reporting held-out errors in ground meters."""
    rows = review["controls"]
    if len({r["vertex"] for r in rows}) != len(rows):
        raise ValueError("Duplicate terrain control")
    a = np.array([[*r["pixel"], 1] for r in rows if r["use"] == "fit"])
    b = np.array([FORWARD.transform(*ring[r["vertex"]]) for r in rows if r["use"] == "fit"])
    if np.linalg.matrix_rank(a) != 3:
        raise ValueError("Terrain controls must span a 2D image")
    matrix = np.linalg.lstsq(a, b, rcond=None)[0]
    residuals = []
    for r in rows:
        expected = np.array(FORWARD.transform(*ring[r["vertex"]]))
        actual = np.array([*r["pixel"], 1]) @ matrix
        residuals.append({**r, "target_lon_lat": ring[r["vertex"]],
            "residual_ground_m": round(float(np.linalg.norm(actual - expected)) * math.cos(math.radians(33.717)), 3)})
    if not any(r["use"] == "validation" for r in rows):
        raise ValueError("Independent validation corners required")
    if max(r["residual_ground_m"] for r in residuals) > 3:
        raise ValueError("Hillshade boundary registration exceeds 3m review threshold")
    return matrix, residuals


def read_warp(path, bounds, width, height, multiplier=1):
    """GDAL reads the source band; only bounded destination arrays enter Python."""
    affine = from_bounds(*bounds, width, height)
    cells = np.full((height, width), np.nan, dtype="float32")
    with rasterio.Env(GDAL_CACHEMAX=16 * 1024 * 1024), rasterio.open(path) as source:
        reproject(
            source=rasterio.band(source, 1), destination=cells,
            src_transform=source.transform, src_crs=source.crs, src_nodata=source.nodata,
            dst_transform=affine, dst_crs="EPSG:3857", dst_nodata=np.nan,
            resampling=Resampling.bilinear, num_threads=1, warp_mem_limit=16,
        )
    return cells * multiplier, affine


def shade(cells_m, valid, affine):
    """45° azimuth, 45° altitude; missing cells and neighbors are transparent.

    Array dy points south, so the north-facing normal component is +dy;
    the east-facing normal is -dx. The sun vector is (0.5, 0.5, sqrt(0.5)).
    """
    # Web Mercator distances corrected to approximate ground spacing at the site.
    spacing = math.cos(math.radians(33.717))
    dy, dx = np.gradient(cells_m, abs(affine.e) * spacing, affine.a * spacing)
    light = (-dx + dy + math.sqrt(2)) / (2 * np.sqrt(dx * dx + dy * dy + 1))
    safe = valid & np.isfinite(light)
    value = np.uint8(np.clip(np.nan_to_num(light, nan=0), 0, 1) * 255)
    rgba = np.stack([value, value, value, np.where(safe, 255, 0).astype("uint8")], axis=-1)
    return Image.fromarray(rgba)


def bands(cells_m, valid, affine, preserve):
    feet = cells_m / FT_US_M
    quantized = np.floor(np.where(valid, feet, 0) / 20).astype("int16")
    results = []
    for geometry, level in shapes(quantized, mask=valid, transform=affine):
        # 2m projected simplification (~1.7m ground); preserve topology and holes.
        clipped = shape(geometry).simplify(2, preserve_topology=True).intersection(preserve)
        for p in components(clipped):
            if p.area >= 16:  # Omit sub-display fragments; never invent nodata values.
                results.append((int(level) * 20, normalize(p)))
    return sorted(results, key=lambda entry: (entry[0], entry[1].bounds))


def diagnose(directory, bounds, affine, matrix, residuals, images, cells, preserve):
    original = Image.open(directory / "HillshadeCSNP.png").convert("RGB")
    # PIL needs destination pixel -> original pixel, not the fitted forward map.
    homogeneous = np.vstack([matrix.T, [0, 0, 1]])
    inverse = np.linalg.inv(homogeneous)
    dest = np.array([[affine.a, 0, affine.c], [0, affine.e, affine.f], [0, 0, 1]])
    coefficients = (inverse @ dest)[:2].reshape(-1)
    registered = original.transform((WIDTH, HEIGHT), Image.Transform.AFFINE, coefficients, Image.Resampling.BILINEAR)
    canvas = Image.new("RGB", (WIDTH * 3, HEIGHT + 40), "white")
    for i, (label, image) in enumerate([
        ("Supplied PNG: boundary-registered", registered),
        ("Supplied DTM: no datum shift assumed", images["supplied"]),
        ("USGS 3DEP: service subset", images["usgs"]),
    ]):
        pane = Image.new("RGBA", (WIDTH, HEIGHT), "white")
        pane.alpha_composite(image.convert("RGBA"))
        draw = ImageDraw.Draw(pane)
        def pixel(x, y):
            return ((x - bounds[0]) / affine.a, (y - bounds[3]) / affine.e)
        draw.line([pixel(x, y) for x, y in preserve.exterior.coords], fill="#ff00ff", width=2)
        trails = json.loads((PACKAGE / "trails.geojson").read_text())["features"]
        for f in trails:
            draw.line([pixel(*FORWARD.transform(*p)) for p in f["geometry"]["coordinates"]], fill="#ff8000", width=1)
        canvas.paste(pane.convert("RGB"), (i * WIDTH, 40))
        ImageDraw.Draw(canvas).text((i * WIDTH + 8, 12), label, fill="black")
    canvas.save(WORK / "terrain-comparison.png")
    controls_image = original.copy()
    d = ImageDraw.Draw(controls_image)
    for r in residuals:
        x, y = r["pixel"]
        color = "red" if r["use"] == "fit" else "blue"
        d.ellipse((x-5, y-5, x+5, y+5), outline=color, width=2)
        d.text((x+6, y), str(r["vertex"]), fill=color)
    controls_image.save(WORK / "hillshade-controls.png")
    common = np.isfinite(cells["supplied"]) & np.isfinite(cells["usgs"]) & geometry_mask([mapping(preserve)], (HEIGHT, WIDTH), affine, invert=True)
    delta = cells["supplied"][common] - cells["usgs"][common]
    report = {
        "schema_version": 1,
        "hillshade_pixel_to_3857_affine": matrix.T.tolist(),
        "controls": residuals,
        "registration_limitations": "Same cartographic boundary is not an independent land survey. Boundary fit does not establish DTM horizontal datum. DTM projection uses GRS80 and US survey feet with a ballpark/no-datum-shift assumption; no EPSG datum assigned. Visual terrain/drainage comparison checks gross alignment only.",
        "dtm_minus_usgs_m": {"common_cells": int(common.sum()), "median": round(float(np.median(delta)), 3), "p05": round(float(np.percentile(delta, 5)), 3), "p95": round(float(np.percentile(delta, 95)), 3)},
        "comparison_limitations": "Different resolution, acquisition, interpolation and unknown supplied horizontal datum; differences are not measured terrain change or accuracy.",
    }
    (WORK / "terrain-alignment.json").write_text(json.dumps(report, indent=2) + "\n")


def convert():
    started = time.perf_counter()
    directory = extract()
    inspected = json.loads((PACKAGE / "inspection.json").read_text())["terrain"]
    if (directory / "csnp_dtm_2015/prj.adf").read_text().strip() != inspected["projection_evidence"].strip():
        raise ValueError("Supplied projection/vertical units changed; review before conversion")
    with rasterio.open(directory / "csnp_dtm_2015") as source:
        if (source.driver != "AIG" or [source.width, source.height] != inspected["size_cells"]
            or not math.isclose(source.crs.linear_units_factor[1], FT_US_M, abs_tol=1e-12)):
            raise ValueError("Expected the reviewed AIG grid in US survey feet")
    national = json.loads(NATIONAL_RECORD.read_text())
    if file_record(NATIONAL) != {k: national["raster"][k] for k in ("bytes", "sha256")}:
        raise ValueError("USGS subset bytes differ from acquisition record")
    with rasterio.open(NATIONAL) as g:
        if g.crs.to_epsg() != 3857 or g.count != 1 or g.dtypes != ("float32",) or g.width > 1024 or g.height > 1024:
            raise ValueError("Unexpected national elevation subset")
    preserve = transform(shape(boundary()), lambda xy: [FORWARD.transform(x, y) for x, y in xy])
    minx, miny, maxx, maxy = preserve.bounds
    bounds = (minx-8, miny-8, maxx+8, maxy+8)
    review = json.loads(CONTROLS.read_text())
    matrix, residuals = fit_controls(review, boundary()["coordinates"][0])
    version_input = {
        "pipeline": 1, "size": [WIDTH, HEIGHT], "bounds": bounds,
        "source_archive": file_record(PACKAGE / "sources/CSNP_GISfiles.zip"),
        "national": national["raster"], "controls": review,
        "boundary": boundary(),
    }
    dataset_version = hashlib.sha256(json.dumps(version_input, sort_keys=True).encode()).hexdigest()[:16]
    WORK.mkdir(parents=True, exist_ok=True)
    features, assets, images, sampled = [], {}, {}, {}
    for key, path, factor, source, datum in [
        ("supplied", directory / "csnp_dtm_2015", FT_US_M, "Supplied csnp_dtm_2015 (date inferred from filename)", "NAVD88 (source ftUS)"),
        ("usgs", NATIONAL, 1, "USGS National Map 3DEP; bounded service export", "NAVD88 (CONUS 3DEP; source meters)"),
    ]:
        cells, affine = read_warp(path, bounds, WIDTH, HEIGHT, factor)
        valid = np.isfinite(cells) & geometry_mask([mapping(preserve)], cells.shape, affine, invert=True)
        if not valid.any():
            raise ValueError(f"No valid terrain in preserve: {key}")
        image = shade(cells, valid, affine)
        image.save(WORK / f"{key}-hillshade.png", optimize=True)
        images[key], sampled[key] = image, cells
        coords = [[round(v, 10) for v in INVERSE.transform(x, y)] for x, y in [
            (bounds[0], bounds[3]), (bounds[2], bounds[3]), (bounds[2], bounds[1]), (bounds[0], bounds[1]),
        ]]
        source_sha = version_input["source_archive"]["sha256"] if key == "supplied" else national["raster"]["sha256"]
        assets[key] = {"dataset_version": dataset_version, "source_sha256": source_sha, "coordinates": coords, "width": WIDTH, "height": HEIGHT, **file_record(WORK / f"{key}-hillshade.png")}
        common = {"isDemo": False, "source_dataset": f"csnp-terrain-{key}", "dataset_version": dataset_version,
            "source": source, "vertical_datum": datum,
            "horizontal_registration": "GRS80 projection; unknown datum; no datum shift assumed" if key == "supplied" else "EPSG:3857 georeferenced USGS export",
            "source_sha256": source_sha}
        title = "Supplied DTM" if key == "supplied" else "USGS 3DEP"
        features.append({"type": "Feature", "id": f"csnp-terrain-{key}-hillshade", "geometry": {"type": "Polygon", "coordinates": [[*coords, coords[0]]]},
            "properties": {**common, "feature_kind": "hillshade", "name": f"{title} hillshade", "raster_key": key, "raster_sha256": assets[key]["sha256"]}})
        band_cells, band_affine = read_warp(path, bounds, WIDTH//2, HEIGHT//2, factor)
        band_valid = np.isfinite(band_cells) & geometry_mask([mapping(preserve)], band_cells.shape, band_affine, invert=True)
        for index, (feet, polygon) in enumerate(bands(band_cells, band_valid, band_affine, preserve), 1):
            features.append({"type": "Feature", "id": f"csnp-terrain-{key}-band-{index:04}", "geometry": geographic(polygon),
                "properties": {**common, "feature_kind": "elevation_band", "name": f"{title}: {feet}–{feet+20} ftUS", "elevation_min_ft_us": feet, "elevation_max_ft_us": feet+20}})
    result = {"type": "FeatureCollection", "features": features}
    if len(json.dumps(result).encode()) > LIMIT_BYTES or sum(a["bytes"] for a in assets.values()) > 300_000:
        raise ValueError("Terrain exceeds the documented asset budget")
    diagnose(directory, bounds, affine, matrix, residuals, images, sampled, preserve)
    (WORK / "terrain-performance.json").write_text(json.dumps({"conversion_seconds": round(time.perf_counter()-started, 3), "rgba_bytes_per_image": WIDTH*HEIGHT*4, "features": len(features), "assets": assets}, indent=2)+"\n")
    # Normalize tuples to JSON arrays for exact snapshot comparisons.
    return json.loads(json.dumps(result, allow_nan=False)), assets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--evidence", action="store_true")
    args = parser.parse_args()
    try:
        data, assets = convert()
        descriptor = ASSETS / "terrain-assets.json"
        if args.check:
            if data != json.loads(OUTPUT.read_text()) or assets != json.loads(descriptor.read_text()):
                raise ValueError("Terrain snapshot differs; regenerate and review")
            for key in KINDS:
                if file_record(ASSETS / f"{key}-hillshade.png") != file_record(WORK / f"{key}-hillshade.png"):
                    raise ValueError(f"Bundled {key} hillshade differs")
        else:
            ASSETS.mkdir(parents=True, exist_ok=True)
            OUTPUT.write_text(json.dumps(data, indent=2) + "\n")
            descriptor.write_text(json.dumps(assets, indent=2) + "\n")
            for key in KINDS:
                shutil.copyfile(WORK / f"{key}-hillshade.png", ASSETS / f"{key}-hillshade.png")
        if args.evidence:
            for name in ("terrain-comparison.png", "hillshade-controls.png", "terrain-alignment.json"):
                shutil.copyfile(WORK / name, PACKAGE / "review" / name)
        print(f"Verified terrain: {len(data['features'])} features; two bounded images; diagnostics in {WORK.relative_to(ROOT)}")
    except (OSError, ValueError, KeyError) as error:
        raise SystemExit(f"Terrain conversion failed: {error}")


if __name__ == "__main__":
    main()
