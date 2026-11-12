"""Extract the supplied geospatial PDF; --check verifies the committed snapshot.

Only named geographic content groups are eligible. PDF paths are cartography,
not original GIS feature records. IDs describe reviewed extraction identities.
"""

import argparse
import json
import math
import shutil

import pymupdf
from pypdf import PdfReader
from pyproj import CRS, Transformer
from shapely import normalize, set_precision, transform
from shapely.geometry import LineString, Point, Polygon, box, mapping
from shapely.ops import unary_union
from PIL import Image, ImageDraw

from source_package import PACKAGE, ROOT, SOURCES, verify

OUTPUT = PACKAGE / "pdf-map.geojson"
REVIEW = PACKAGE / "pdf-map-review.json"
WORK = ROOT / ".work/gis-data"
GROUPS = {
    "Park Boundaries": "boundary",
    "Bodies of Water": "water",
    "Natural Areas": "natural_area",
    "Roads": "road",
    "Buildings": "building",
}
NAMES = {
    "boundary": "Preserve boundary",
    "water": "Water",
    "natural_area": "Natural area",
    "road": "Road footprint",
    "building": "Building footprint",
}
LIMITATION = "Recovered from map artwork; rounded registration anchors and cartographic displacement limit positioning."


class Registration:
    def __init__(self, path):
        page = PdfReader(path).pages[0]
        if len(page["/VP"]) != 1:
            raise ValueError("Expected one reviewed geographic viewport")
        vp = page["/VP"][0].get_object()
        measure = vp["/Measure"].get_object()
        if str(measure["/Subtype"]) != "/GEO" or list(measure["/LPTS"]) != [
            0,
            0,
            0,
            1,
            1,
            1,
            1,
            0,
        ]:
            raise ValueError("Changed registration; review required")
        self.crs = CRS.from_wkt(str(measure["/GCS"].get_object()["/WKT"]))
        expected = json.loads((PACKAGE / "inspection.json").read_text())["pdf"][
            "viewports"
        ][0]["projected_wkt"]
        if str(measure["/GCS"].get_object()["/WKT"]) != expected:
            raise ValueError("Expected embedded Web Mercator CRS")
        self.forward = Transformer.from_crs(4326, self.crs, always_xy=True)
        self.inverse = Transformer.from_crs(self.crs, 4326, always_xy=True)
        gpts = list(map(float, measure["/GPTS"]))
        self.anchors = [
            self.forward.transform(gpts[i + 1], gpts[i]) for i in range(0, 8, 2)
        ]
        (self.west, self.south), nw, (self.east, self.north), se = self.anchors
        if nw != (self.west, self.north) or se != (self.east, self.south):
            raise ValueError("Nonrectangular anchors require reviewed registration")
        x0, y0, x1, y1 = map(float, vp["/BBox"])
        h = float(page.mediabox.height)
        self.bounds = (x0, h - y1, x1, h - y0)  # PyMuPDF origin is upper left.

    def projected(self, x, y):
        x0, y0, x1, y1 = self.bounds
        return self.west + (x - x0) / (x1 - x0) * (
            self.east - self.west
        ), self.north - (y - y0) / (y1 - y0) * (self.north - self.south)

    def geographic(self, x, y):
        return tuple(
            round(v, 10) for v in self.inverse.transform(*self.projected(x, y))
        )

    def page(self, lon, lat):
        x, y = self.forward.transform(lon, lat)
        x0, y0, x1, y1 = self.bounds
        return x0 + (x - self.west) / (self.east - self.west) * (x1 - x0), y0 + (
            self.north - y
        ) / (self.north - self.south) * (y1 - y0)


def flatten_curve(points, tolerance=0.1):
    """Recursive de Casteljau; control-to-chord bound <=0.1 PDF point (~6cm)."""
    a, b, c, d = points
    chord = LineString([a, d])
    if max(chord.distance(Point(b)), chord.distance(Point(c))) <= tolerance:
        return [a, d]
    mid = lambda p, q: tuple((x + y) / 2 for x, y in zip(p, q))
    ab, bc, cd = mid(a, b), mid(b, c), mid(c, d)
    abc, bcd = mid(ab, bc), mid(bc, cd)
    m = mid(abc, bcd)
    return flatten_curve([a, ab, abc, m], tolerance)[:-1] + flatten_curve(
        [m, bcd, cd, d], tolerance
    )


def subpaths(drawing):
    paths = []
    current = []
    for item in drawing["items"]:
        if item[0] == "l":
            points = [tuple(p) for p in item[1:]]
        elif item[0] == "c":
            points = flatten_curve([tuple(p) for p in item[1:]])
        elif item[0] == "re":
            r = item[1]
            points = [tuple(r.tl), tuple(r.tr), tuple(r.br), tuple(r.bl), tuple(r.tl)]
        else:
            raise ValueError(f"Unreviewed PDF path operator {item[0]}")
        if current and math.dist(current[-1], points[0]) > 0.001:
            paths.append(current)
            current = []
        current.extend(points if not current else points[1:])
    if current:
        paths.append(current)
    return paths


def polygon(drawing):
    rings = []
    for points in subpaths(drawing):
        if math.dist(points[0], points[-1]) > 0.001:
            raise ValueError("Unexpected open geographic polygon")
        points[-1] = points[0]
        p = Polygon(points)
        if not p.is_valid:
            raise ValueError("Invalid PDF source ring")
        rings.append(p)
    # Even-odd paths preserve holes independent of traversal direction.
    # All reviewed filled paths use even-odd; boundary is a single closed ring.
    if len(rings) > 1 and not drawing.get("even_odd"):
        raise ValueError("Unreviewed nonzero compound fill")
    result = rings[0]
    for p in rings[1:]:
        result = result.symmetric_difference(p)
    return result


def components(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    if geometry.geom_type in ("MultiPolygon", "GeometryCollection"):
        return [p for g in geometry.geoms for p in components(g)]
    raise ValueError(f"Unexpected nonpolygon geographic content: {geometry.geom_type}")


def feature(identity, kind, geometry, name, props=None):
    return {
        "type": "Feature",
        "id": identity,
        "geometry": geometry,
        "properties": {
            "name": name,
            "feature_kind": kind,
            "isDemo": False,
            "source_dataset": "csnp-pdf-map",
            "source_file": "data/cascade-springs-gis/sources/CSNP Trail Map.pdf",
            "source_sha256": "3c6a6014d6f3da8b9b635cba129a437dd990b45c742809b5d30293d0a5aa29e4",
            "positioning": LIMITATION,
            **(props or {}),
        },
    }


def convert():
    manifest = verify()
    expected_hash = "3c6a6014d6f3da8b9b635cba129a437dd990b45c742809b5d30293d0a5aa29e4"
    # The reviewed controls/path identities belong to this exact source version.
    record = next(
        r
        for r in manifest["inventory"]["inputs"]
        if r["path"].endswith("CSNP Trail Map.pdf")
    )
    if record["sha256"] != expected_hash:
        raise ValueError(
            "PDF source changed; review extraction identities and controls first"
        )
    path = SOURCES / "CSNP Trail Map.pdf"
    reg = Registration(path)
    review = json.loads(REVIEW.read_text())
    features = []
    page_shapes = []
    with pymupdf.open(path) as doc:
        page = doc[0]
        drawings = page.get_drawings()
        for group, kind in GROUPS.items():
            eligible = [
                (i, d)
                for i, d in enumerate(drawings)
                if d.get("layer") == group
                and (d["fill"] is not None or kind == "boundary")
            ]
            polygons = [
                (i, set_precision(polygon(d), 0.001).intersection(box(*reg.bounds)))
                for i, d in eligible
            ]
            # Union removes repeated fills, seams, and overlapping paint commands.
            merged = unary_union([p for _, p in polygons])
            for index, p in enumerate(
                sorted(components(merged), key=lambda p: p.bounds), 1
            ):
                if not p.is_valid:
                    raise ValueError("Invalid extracted polygon")
                p = normalize(p)
                identity = f"csnp-pdf-{kind}-{index:03}"
                refs = [i for i, g in polygons if g.intersection(p).area > 0.001]
                props = {"source_group": group, "source_paths": refs}
                if kind == "boundary":
                    props["boundary_kind"] = "preserve"
                if kind == "water":
                    props["water_kind"] = "stream"
                source_name = review.get("context_names", {}).get(identity, {})
                if source_name:
                    props["description"] = "PDF map label: " + source_name["name"]
                features.append(
                    feature(
                        identity,
                        kind,
                        mapping(
                            transform(
                                p,
                                lambda coordinates: [
                                    reg.geographic(x, y) for x, y in coordinates
                                ],
                            )
                        ),
                        source_name.get("name", NAMES[kind]),
                        props,
                    )
                )
                page_shapes.append((kind, p))
        images = [
            (bbox, layer)
            for typ, bbox, layer in page.get_bboxlog(layers=True)
            if typ == "fill-image" and layer == "Points of Interest"
        ]
        if len(images) != 14:
            raise ValueError("Expected 14 geographic raster symbols")
        for control in review["symbols"]:
            props = {
                "landmark_kind": control["kind"],
                "source_symbol": control["symbol"],
                "source_group": "Points of Interest",
            }
            if "image_index" in control:
                rect = pymupdf.Rect(images[control["image_index"]][0])
                anchor = ((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)
                props["source_page_bbox"] = list(rect)
            else:
                pieces = [d for d in drawings if d.get("layer") == "Points of Interest"]
                if len(pieces) != 6:
                    raise ValueError("Expected six vector pieces for one bridge")
                rect = pymupdf.Rect(pieces[0]["rect"])
                for d in pieces[1:]:
                    rect |= d["rect"]
                anchor = ((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)
                props["source_page_bbox"] = list(rect)
            props["source_page_anchor"] = list(anchor)
            props["description"] = control.get("label", "")
            features.append(
                feature(
                    "csnp-pdf-poi-" + control["symbol"],
                    "landmark",
                    {"type": "Point", "coordinates": reg.geographic(*anchor)},
                    control["name"],
                    props,
                )
            )
        # Match only explicit reviewed identities; proximity alone cannot merge landmarks.
        legacy = json.loads(
            (ROOT / "data/cascade-springs/features.geojson").read_text()
        )
        points = {
            f["id"]: f for f in legacy["features"] if f["geometry"]["type"] == "Point"
        }
        if set(points) != set(review["legacy_matches"]):
            raise ValueError("Legacy landmark reconciliation is incomplete")
        for old_id, symbol in review["legacy_matches"].items():
            old = points[old_id]
            if symbol:
                target = next(
                    f for f in features if f["id"] == "csnp-pdf-poi-" + symbol
                )
                target["properties"].setdefault("source_annotations", []).append(old)
            else:
                # Keep unmatched source information and source identity/position.
                old["properties"].update(
                    feature_kind="landmark",
                    landmark_kind="source_annotation",
                    source_name=old["properties"]["name"],
                    positioning="Original My Maps annotation; physical identity has not been matched to a PDF symbol.",
                )
                old["properties"]["name"] += " (My Maps annotation)"
                features.append(old)
        WORK.mkdir(parents=True, exist_ok=True)
        page.get_pixmap(matrix=pymupdf.Matrix(0.6, 0.6)).save(
            WORK / "pdf-map-source.png"
        )
        diagnostic(page, reg, features, page_shapes)
        # Preserve named geographic text as source evidence without guessing which
        # connected road footprint owns each offset/rotated cartographic label.
        labels = [
            {
                "source_group": span["layer"],
                "text": "".join(chr(c[0]) for c in span["chars"]),
                "source_page_bbox": list(span["bbox"]),
            }
            for span in page.get_texttrace()
            if span.get("layer")
            in (
                "Centerline_ATLDOT - Class 1",
                "ATL_Streams w name and source - Label Class 1",
                "Points of Interest - Class 1",
            )
        ]
        (WORK / "pdf-map-labels.json").write_text(json.dumps(labels, indent=2) + "\n")
        report = alignment(reg, drawings)
        (WORK / "pdf-map-alignment.json").write_text(
            json.dumps(report, indent=2) + "\n"
        )
    return json.loads(
        json.dumps(
            {
                "type": "FeatureCollection",
                "conversion": {
                    "version": 1,
                    "method": "embedded viewport; projected interpolation; WGS84; 0.1pt curve tolerance; 0.001pt precision grid; group union and viewport clip",
                },
                "features": features,
            }
        )
    )


def alignment(reg, drawings):
    trails = json.loads((PACKAGE / "trails.geojson").read_text())
    source = unary_union(
        [
            LineString(p)
            for d in drawings
            if d.get("layer") == "Trails"
            for p in subpaths(d)
        ]
    )
    distances = []
    sx = (reg.east - reg.west) / (reg.bounds[2] - reg.bounds[0])
    # Web Mercator scale corrected to approximate ground distance at preserve latitude.
    scale = sx * math.cos(math.radians(33.716))
    for f in trails["features"]:
        distances.extend(
            source.distance(Point(reg.page(*p))) * scale
            for p in f["geometry"]["coordinates"]
        )
    distances.sort()
    return {
        "comparison": "shapefile vertices to nearest PDF trail stroke; no fitted correction",
        "vertices": len(distances),
        "median_m": round(distances[len(distances) // 2], 3),
        "p95_m": round(distances[int(len(distances) * 0.95)], 3),
        "max_m": round(max(distances), 3),
        "anchor_precision_degrees": 0.00001,
        "curve_tolerance_pdf_points": 0.1,
        "not_a_survey_accuracy_estimate": True,
    }


def diagnostic(page, reg, features, polygons):
    image = Image.open(WORK / "pdf-map-source.png").convert("RGB")
    draw = ImageDraw.Draw(image)
    scale = image.width / page.rect.width
    colors = {
        "boundary": "#ff00ff",
        "water": "#00bfff",
        "natural_area": "#98fb98",
        "road": "#444444",
        "building": "#ff8000",
    }
    for kind, p in polygons:
        for ring in [p.exterior, *p.interiors]:
            draw.line(
                [(x * scale, y * scale) for x, y in ring.coords],
                fill=colors[kind],
                width=2,
            )
    trails = json.loads((PACKAGE / "trails.geojson").read_text())
    for f in trails["features"]:
        draw.line(
            [
                (x * scale, y * scale)
                for x, y in [reg.page(*p) for p in f["geometry"]["coordinates"]]
            ],
            fill="#ff00ff",
            width=2,
        )
    for f in features:
        if f["geometry"]["type"] == "Point":
            x, y = reg.page(*f["geometry"]["coordinates"])
            x *= scale
            y *= scale
            draw.ellipse((x - 4, y - 4, x + 4, y + 4), outline="red", width=2)
            draw.text((x + 5, y), f["id"].replace("csnp-pdf-poi-", ""), fill="red")
    image.save(WORK / "pdf-map-overlay.png")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument(
        "--evidence",
        action="store_true",
        help="Refresh committed review overlay and alignment evidence",
    )
    args = parser.parse_args()
    try:
        result = convert()
        if args.check:
            if result != json.loads(OUTPUT.read_text()):
                raise ValueError("Snapshot differs; regenerate and review")
        else:
            temporary = OUTPUT.with_suffix(".tmp")
            temporary.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
            temporary.replace(OUTPUT)
        if args.evidence:
            evidence = PACKAGE / "review"
            evidence.mkdir(exist_ok=True)
            for name in (
                "pdf-map-overlay.png",
                "pdf-map-alignment.json",
                "pdf-map-labels.json",
            ):
                shutil.copyfile(WORK / name, evidence / name)
        print(
            f"Verified PDF map: {len(result['features'])} features; diagnostics in .work/gis-data/"
        )
    except (ValueError, OSError, KeyError) as error:
        raise SystemExit(f"PDF map conversion failed: {error}")


if __name__ == "__main__":
    main()
