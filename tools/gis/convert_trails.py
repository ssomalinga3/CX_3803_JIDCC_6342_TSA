"""Convert verified supplied trail segments to WGS84 without changing topology."""

import argparse
import copy
from importlib.metadata import version
import json
import math
from uuid import UUID

from pyproj import CRS, Geod, Transformer
import shapefile

from source_package import PACKAGE, extract, verify

CONTRACT = json.loads((PACKAGE / "trail-contract.json").read_text(encoding="utf-8"))
OUTPUT = PACKAGE / "trails.geojson"
GEOD = Geod(ellps="WGS84")
TRANSFORM = Transformer.from_crs(3857, 4326, always_xy=True)
COORDINATE_TOLERANCE = 2e-12


def matches_snapshot(actual, expected):
    """Allow only submicrometre projection rounding differences across GIS builds."""
    candidate = copy.deepcopy(expected)
    if len(actual["features"]) != len(candidate.get("features", [])):
        return False
    for feature, saved in zip(actual["features"], candidate["features"]):
        points = feature["geometry"]["coordinates"]
        previous = saved["geometry"]["coordinates"]
        if len(points) != len(previous):
            return False
        for point, old in zip(points, previous):
            if len(point) != len(old) or any(
                not math.isclose(x, y, rel_tol=0, abs_tol=COORDINATE_TOLERANCE)
                for x, y in zip(point, old)
            ):
                return False
        saved["geometry"]["coordinates"] = points
    # Everything except the tightly bounded coordinate rounding must match exactly.
    return actual == candidate


def segment(shape, row, archive_hash):
    """Return a public feature or None; validate identities separately across all rows."""
    if row["PublishTra"] not in ("TRUE", "FALSE"):
        raise ValueError("Unrecognized PublishTra; publication must be explicit")
    if row["PublishTra"] == "FALSE":
        return None
    name = row["TRL_NM"].strip()
    if name and name not in CONTRACT["routes"]:
        raise ValueError(f"Unmapped source trail name: {name}")
    if shape.shapeType != shapefile.POLYLINE or len(shape.parts) != 1:
        raise ValueError("Expected one supplied polyline part; review changed source topology")
    # Bound platform-specific libm variation; --check tolerates rounding ties.
    # Twelve decimal degrees are below a micrometre; keep every source vertex.
    points = [[round(v, 12) for v in TRANSFORM.transform(x, y)] for x, y in shape.points]
    west, south, east, north = CONTRACT["bounds"]
    if len(points) < 2 or any(
        not all(math.isfinite(v) for v in point)
        or not (west <= point[0] <= east and south <= point[1] <= north)
        for point in points
    ):
        raise ValueError("Invalid or out-of-preserve trail coordinates")
    length = GEOD.line_length([p[0] for p in points], [p[1] for p in points])
    if not math.isfinite(length) or length <= 0:
        raise ValueError("Trail segment has no measurable length")
    difficulty = row["Difficulty"].strip().lower()
    if difficulty and difficulty not in ("easy", "moderate", "difficult"):
        raise ValueError("Unrecognized source difficulty")
    width = row["AVG_WIDTH"]
    if width is not None and (not math.isfinite(width) or width < 0):
        raise ValueError("Invalid source tread width")
    properties = {
        "name": name or "Unnamed trail segment",
        "feature_kind": "trail",
        "name_assignment": "source" if name else "unassigned",
        "length_m": round(length, 3),
        "source_dataset": CONTRACT["dataset"],
        "source_file": "CSNP/OfficialTrailsCSNP.shp",
        "source_archive_sha256": archive_hash,
        "source_crs": "EPSG:3857",
        "source_feature_id": row["GlobalID"],
        "source_segment_id": row["SEGMENT_ID"],
        "source_properties": {key: row[key] for key in CONTRACT["raw_fields"]},
        "isDemo": False,
        "derived_values": {
            "length_m": {
                "method": "WGS84 ellipsoidal segment sum",
                "tool": "pyproj.Geod",
                "source_dataset": CONTRACT["dataset"],
            }
        },
    }
    if name:
        properties["trail_id"] = CONTRACT["routes"][name]
        properties["derived_values"]["trail_id"] = {
            "method": "explicit source-name route-family mapping",
            "contract_version": CONTRACT["version"],
        }
    for source, target in (
        ("SURFACE", "surface_type"),
        ("ROUGHNESS", "roughness"),
        ("NOTES", "description"),
    ):
        if row[source] and row[source].strip():
            properties[target] = row[source].strip()
    if difficulty:
        properties["difficulty"] = difficulty
    if width:
        properties["average_width_in"] = width
    return {
        "type": "Feature",
        "id": f"csnp-official-trail-{UUID(row['GlobalID'])}",
        "geometry": {"type": "LineString", "coordinates": points},
        "properties": properties,
    }


def convert(directory, archive_hash):
    base = directory / "OfficialTrailsCSNP"
    if CRS.from_wkt(base.with_suffix(".prj").read_text(encoding="utf-8")).to_epsg() != 3857:
        raise ValueError("Source CRS changed; expected EPSG:3857")
    features, uuids, segments = [], set(), set()
    with shapefile.Reader(str(base), encoding="utf-8") as reader:
        for item in reader.iterShapeRecords():
            row = item.record.as_dict()
            uuid = str(UUID(row["GlobalID"]))
            source_segment = row["SEGMENT_ID"]
            if not source_segment.strip() or uuid in uuids or source_segment in segments:
                raise ValueError("Duplicate or missing trail source identity")
            uuids.add(uuid)
            segments.add(source_segment)
            feature = segment(item.shape, row, archive_hash)
            if feature:
                features.append(feature)
    if not features:
        raise ValueError("No public trail segments; review before replacing the selected dataset")
    return {
        "type": "FeatureCollection",
        "conversion": {
            "contract_version": CONTRACT["version"],
            "source_archive_sha256": archive_hash,
            "tools": {name: version(name) for name in ("pyshp", "pyproj")},
            "coordinate_method": "EPSG:3857 to EPSG:4326, always_xy, 12 decimal degrees, no simplification",
        },
        "features": sorted(features, key=lambda f: f["id"]),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare with committed trails.geojson")
    args = parser.parse_args()
    try:
        manifest = verify()
        archive_hash = manifest["inventory"]["inputs"][0]["sha256"]
        collection = convert(extract(), archive_hash)
        if args.check:
            if not matches_snapshot(collection, json.loads(OUTPUT.read_text(encoding="utf-8"))):
                raise ValueError("trails.geojson differs; regenerate and review it")
        else:
            temporary = OUTPUT.with_suffix(".geojson.new")
            temporary.write_text(
                json.dumps(collection, indent=2, allow_nan=False) + "\n", encoding="utf-8"
            )
            temporary.replace(OUTPUT)
        action = "Verified" if args.check else "Converted"
        print(f"{action} {len(collection['features'])} supplied trail segments")
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"Trail conversion failed: {error}\n")


if __name__ == "__main__":
    main()
