"""Recover conservative cell-signal screenshot samples and independent registration evidence.

No OCR readings, units, GPS tracks, coverage interpolation or network calls.
"""

import argparse
from collections import Counter
import json
import math
import shutil

import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer

from source_package import PACKAGE, ROOT, SOURCES, file_record, verify

OUTPUT = PACKAGE / "signal.geojson"
REVIEW = PACKAGE / "signal-review.json"
WORK = ROOT / ".work/gis-data"
FORWARD = Transformer.from_crs(4326, 3857, always_xy=True)
INVERSE = Transformer.from_crs(3857, 4326, always_xy=True)
CLASSES = ["< -120", "-120–-117", "-117–-113", "-113–-108", "> -108"]
COLORS = [(255, 0, 0), (255, 154, 0), (248, 255, 0), (157, 255, 0), (11, 142, 0)]
POSITIONING = "Approximate screenshot registration; source positions and classification are uncertain."


def fit_controls(review):
    """North-up, independent x/y scales; do not fit cartographic stars or sample tracks."""
    controls = review["controls"]
    fitted = [c for c in controls if c["use"] == "fit"]
    if len(fitted) < 4 or not any(c["use"] == "validation" for c in controls):
        raise ValueError("Signal registration requires fit and withheld controls")
    pixels = np.array([c["pixel"] for c in fitted], dtype=float)
    projected = np.array([FORWARD.transform(*c["geographic"]) for c in fitted])
    # Center large Mercator offsets before least squares for platform stability.
    origin = projected.mean(axis=0)
    coefficients = []
    for axis in (0, 1):
        design = np.column_stack((pixels[:, axis], np.ones(len(pixels))))
        coefficient, _, rank, _ = np.linalg.lstsq(design, projected[:, axis] - origin[axis], rcond=None)
        if rank != 2:
            raise ValueError("Degenerate signal registration controls")
        coefficients.append(coefficient)
    sx, tx = coefficients[0]
    sy, ty = coefficients[1]
    if not (0.5 < sx < 2 and -2 < sy < -0.5):
        raise ValueError("Implausible north-up signal registration scale")

    def projected_at(x, y):
        return sx * x + tx + origin[0], sy * y + ty + origin[1]

    def geographic(x, y):
        return [round(v, 10) for v in INVERSE.transform(*projected_at(x, y))]

    def pixel(lon, lat):
        x, y = FORWARD.transform(lon, lat)
        return (x - tx - origin[0]) / sx, (y - ty - origin[1]) / sy

    residuals = []
    for c in controls:
        predicted = projected_at(*c["pixel"])
        target = FORWARD.transform(*c["geographic"])
        error = math.dist(predicted, target) * math.cos(math.radians(c["geographic"][1]))
        if error > review["maximum_residual_ground_m"][c["use"]]:
            raise ValueError(f"Signal registration exceeds reviewed tolerance at {c['id']}: {error:.2f}m")
        residuals.append({**c, "residual_ground_m": round(error, 3), "predicted_pixel": [round(v, 3) for v in pixel(*c["geographic"])]})
    affine = [
        [round(float(sx), 12), 0, round(float(tx + origin[0]), 6)],
        [0, round(float(sy), 12), round(float(ty + origin[1]), 6)],
    ]
    return geographic, pixel, residuals, affine


def observations(image, exclusions):
    """4-connected, near-literal color cores. Reject merged, tiny and narrow remnants.

    Bounding-box centers use half-pixels and are stable under antialiasing. This
    intentionally omits obscured/merged dots rather than guessing hidden centers.
    """
    pixels = np.asarray(image.convert("RGB"), dtype=np.int16)
    found, rejected = [], []
    for label, color in zip(CLASSES, COLORS):
        mask = np.max(abs(pixels - color), axis=2) <= 18
        for exclusion in exclusions:
            x0, y0, x1, y1 = exclusion["bbox"]
            mask[y0:y1 + 1, x0:x1 + 1] = False
        seen = set()
        for y, x in zip(*np.nonzero(mask)):
            x, y = int(x), int(y)
            if (x, y) in seen:
                continue
            pending, component = [(x, y)], []
            seen.add((x, y))
            while pending:
                xx, yy = pending.pop()
                component.append((xx, yy))
                for nx, ny in ((xx-1, yy), (xx+1, yy), (xx, yy-1), (xx, yy+1)):
                    if 0 <= nx < image.width and 0 <= ny < image.height and mask[ny, nx] and (nx, ny) not in seen:
                        seen.add((nx, ny))
                        pending.append((nx, ny))
            xs, ys = zip(*component)
            width, height = max(xs)-min(xs)+1, max(ys)-min(ys)+1
            center = [(max(xs)+min(xs))/2, (max(ys)+min(ys))/2]
            # Any component touching an exclusion edge may be a clipped star.
            touches = any(x0-1 <= xx <= x1+1 and y0-1 <= yy <= y1+1 for xx, yy in component for x0,y0,x1,y1 in [e["bbox"] for e in exclusions])
            if 7 <= len(component) <= 36 and 3 <= width <= 7 and 3 <= height <= 7 and not touches:
                found.append({"pixel": center, "class": label, "core_pixels": len(component)})
            else:
                rejected.append({"bbox": [min(xs), min(ys), max(xs), max(ys)], "class": label, "core_pixels": len(component)})
    found.sort(key=lambda p: (p["pixel"][1], p["pixel"][0], p["class"]))
    return found, rejected


def convert():
    verify()
    review = json.loads(REVIEW.read_text())
    source = SOURCES / "Cell Signal Strength.png"
    if file_record(source)["sha256"] != review["source_sha256"]:
        raise ValueError("Signal source changed; re-review colors, masks and controls")
    geographic, pixel, residuals, affine = fit_controls(review)
    with Image.open(source) as image:
        if list(image.size) != review["image_size"]:
            raise ValueError("Signal image dimensions changed")
        samples, rejected = observations(image, review["exclusions"])
        if not samples or Counter(p["class"] for p in samples).keys() != set(CLASSES):
            raise ValueError("Signal extraction did not recover all reviewed classes")
        features = []
        for sample in samples:
            x, y = sample["pixel"]
            features.append({
                "type": "Feature",
                "id": f"csnp-signal-v1-{int(x*2):04d}-{int(y*2):04d}",
                "geometry": {"type": "Point", "coordinates": geographic(x, y)},
                "properties": {
                    "name": "Cell-signal sample · " + sample["class"],
                    "feature_kind": "signal_observation",
                    "isDemo": False,
                    "source_dataset": "csnp-cell-signal",
                    "source_file": "data/cascade-springs-gis/sources/Cell Signal Strength.png",
                    "source_sha256": review["source_sha256"],
                    "extraction_version": 1,
                    "source_pixel": sample["pixel"],
                    "signal_class": sample["class"],
                    "positioning": POSITIONING,
                },
            })
        if len({f["id"] for f in features}) != len(features):
            raise ValueError("Duplicate recovered signal identity")
        WORK.mkdir(parents=True, exist_ok=True)
        overlay = image.convert("RGB")
        draw = ImageDraw.Draw(overlay)
        for sample in samples:
            x, y = sample["pixel"]
            draw.ellipse((x-4,y-4,x+4,y+4), outline="#ff00ff", width=1)
        for e in review["exclusions"]:
            draw.rectangle(e["bbox"], outline="#0000ff", width=1)
        overlay.save(WORK / "signal-extraction-overlay.png")
        alignment = image.convert("RGB")
        draw = ImageDraw.Draw(alignment)
        context = json.loads((PACKAGE / "pdf-map.geojson").read_text())
        trails = json.loads((PACKAGE / "trails.geojson").read_text())
        for f in context["features"] + trails["features"]:
            if f["properties"]["feature_kind"] == "boundary":
                for ring in f["geometry"]["coordinates"]:
                    draw.line([pixel(*p) for p in ring], fill="#e06c00", width=2)
            elif f["properties"]["feature_kind"] == "trail":
                draw.line([pixel(*p) for p in f["geometry"]["coordinates"]], fill="#ff00ff", width=1)
        for c in residuals:
            x, y = c["pixel"]
            px, py = c["predicted_pixel"]
            color = "#0033ff" if c["use"] == "fit" else "#000000"
            draw.line((x,y,px,py), fill=color, width=2)
            draw.ellipse((x-5,y-5,x+5,y+5), outline=color, width=2)
            draw.text((x+6,y+3), c["id"], fill=color)
        alignment.save(WORK / "signal-registration-overlay.png")
    report = {
        "model": review["model"],
        "pixel_to_epsg3857_affine": affine,
        "extraction": "RGB max-channel difference <=18; 4-connected cores; 7–36 core pixels; width/height 3–7px; bounding-box half-pixel centers; exclusion-touching cores rejected",
        "controls": residuals,
        "registration_limits": "Cartographic agreement only; source GPS/class accuracy, spatial drift, and survey date are unknown. Northern park cutout differs between basemaps; it is excluded from fitting.",
        "counts_by_class": dict(Counter(p["class"] for p in samples)),
        "recovered_count": len(samples),
        "rejected_component_count": len(rejected),
        "rejected_components": rejected,
        "omissions": "Excluded boxes may contain obscured samples. Tiny, narrow and merged color cores are omitted; rejected components are not a count of missing observations.",
    }
    (WORK / "signal-extraction.json").write_text(json.dumps(report, indent=2) + "\n")
    return {"type": "FeatureCollection", "features": features}, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--evidence", action="store_true", help="Refresh committed overlays and extraction/registration report")
    args = parser.parse_args()
    try:
        result, report = convert()
        if args.check:
            if result != json.loads(OUTPUT.read_text()):
                raise ValueError("Signal snapshot differs; regenerate and review")
            if report != json.loads((PACKAGE / "review/signal-extraction.json").read_text()):
                raise ValueError("Signal extraction evidence differs; regenerate and review")
        else:
            temporary = OUTPUT.with_suffix(".tmp")
            temporary.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
            temporary.replace(OUTPUT)
        if args.evidence:
            for name in ("signal-extraction-overlay.png", "signal-registration-overlay.png", "signal-extraction.json"):
                shutil.copyfile(WORK / name, PACKAGE / "review" / name)
        print(f"Recovered {len(result['features'])} approximate signal samples; diagnostics in .work/gis-data/")
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f"Signal conversion failed: {error}\n")


if __name__ == "__main__":
    main()
