"""Inspect the verified sources without converting or publishing map features."""

import argparse
from collections import Counter
from importlib.metadata import version
import json
import sys
from zipfile import BadZipFile

from PIL import Image
import pymupdf
from pypdf import PdfReader
from pyproj import CRS, Geod, Transformer
import rasterio
import shapefile

from source_package import PACKAGE, ROOT, SOURCES, extract

OUTPUT = ROOT / ".work/gis-data"


def counts(values):
    return dict(sorted(Counter(str(v).strip() if v is not None else "" for v in values).items()))


def inspect_trails(directory):
    base = directory / "OfficialTrailsCSNP"
    crs = CRS.from_wkt(base.with_suffix(".prj").read_text(encoding="utf-8"))
    transform = Transformer.from_crs(crs, 4326, always_xy=True)
    geod = Geod(ellps="WGS84")
    positions = []
    length = 0
    parts = []
    with shapefile.Reader(str(base), encoding="utf-8") as reader:
        fields = [list(field) for field in reader.fields[1:]]
        rows = [record.as_dict() for record in reader.records()]
        for shape in reader.shapes():
            parts.append(len(shape.parts))
            points = [transform.transform(x, y) for x, y in shape.points]
            positions.extend(points)
            stops = list(shape.parts) + [len(points)]
            for start, end in zip(stops, stops[1:]):
                segment = points[start:end]
                length += geod.line_length([p[0] for p in segment], [p[1] for p in segment])
        shape_type = reader.shapeTypeName
    return {
        "source": "CSNP/OfficialTrailsCSNP.shp",
        "crs": crs.to_string(),
        "source_coordinate_unit": crs.axis_info[0].unit_name,
        "shape_type": shape_type,
        "segments": len(rows),
        "parts_per_segment": counts(parts),
        "vertices": len(positions),
        "wgs84_bounds": [
            round(f(p[i] for p in positions), 10)
            for f, i in ((min, 0), (min, 1), (max, 0), (max, 1))
        ],
        "geodesic_segment_sum_m": round(length, 3),
        "dbf_fields": fields,
        "values": {
            key: counts(row[key] for row in rows)
            for key in ("TRL_NM", "TrailColor", "SURFACE", "ROUGHNESS", "Difficulty", "PublishTra")
        },
        "identity": {
            key: {
                "missing": sum(not str(row[key] or "").strip() for row in rows),
                "distinct": len({str(row[key]) for row in rows}),
            }
            for key in ("SEGMENT_ID", "GlobalID", "TRL_ID")
        },
        "missing_or_placeholder": {
            key: {
                "blank": sum(row[key] is None or row[key] == "" for row in rows),
                "zero": sum(row[key] == 0 for row in rows),
            }
            for key in (
                "AVG_WIDTH", "ELEV_GAIN", "GRADE", "LENGTH_MI", "AvgSegment", "Shape__L_1", "USE_LEVEL"
            )
        },
        "notes_present": sum(bool(str(row["NOTES"] or "").strip()) for row in rows),
    }


def inspect_pdf():
    path = SOURCES / "CSNP Trail Map.pdf"
    reader = PdfReader(path)
    page = reader.pages[0]
    viewports = []
    for entry in page.get("/VP", []):
        vp = entry.get_object()
        measure = vp["/Measure"].get_object()
        viewports.append(
            {
                "bbox_pdf_points": list(map(float, vp["/BBox"])),
                "subtype": str(measure["/Subtype"]),
                "lpts": list(map(float, measure["/LPTS"])),
                "gpts_lat_lon": list(map(float, measure["/GPTS"])),
                "projected_wkt": str(measure["/GCS"].get_object().get("/WKT", "")),
            }
        )
    with pymupdf.open(path) as document:
        groups = sorted(group["name"] for group in document.get_ocgs().values())
        document[0].get_pixmap(matrix=pymupdf.Matrix(0.4, 0.4)).save(OUTPUT / "map-preview.png")
    return {
        "source": "data/cascade-springs-gis/sources/CSNP Trail Map.pdf",
        "pages": len(reader.pages),
        "page_size_points": [float(page.mediabox.width), float(page.mediabox.height)],
        "creation_date_metadata": reader.metadata.get("/CreationDate"),
        "creator_application": reader.metadata.get("/Creator"),
        "optional_content_groups": groups,
        "viewports": viewports,
    }


def inspect_grid(directory):
    with rasterio.open(directory / "csnp_dtm_2015") as grid:
        low, high, valid = float("inf"), float("-inf"), 0
        for _, window in grid.block_windows(1):
            cells = grid.read(1, window=window, masked=True)
            count = int(cells.count())
            if count:
                low, high = min(low, float(cells.min())), max(high, float(cells.max()))
                valid += count
        return {
            "source": "CSNP/csnp_dtm_2015/",
            "driver": grid.driver,
            "size_cells": [grid.width, grid.height],
            "dtype": grid.dtypes[0],
            "valid_cells": valid,
            "nodata_cells": grid.width * grid.height - valid,
            "nodata": grid.nodata,
            "range_source_units": [round(low, 6), round(high, 6)],
            "transform": list(grid.transform)[:6],
            "bounds_source_units": list(grid.bounds),
            "gdal_interpreted_wkt": grid.crs.to_wkt() if grid.crs else None,
            "projection_evidence": (directory / "csnp_dtm_2015/prj.adf").read_text(encoding="utf-8"),
            "horizontal_datum_confirmed": False,
        }


def inspect_image(path, source):
    with Image.open(path) as image:
        return {
            "source": source,
            "size_pixels": list(image.size),
            "mode": image.mode,
            "embedded_geographic_transform": False,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true",
        help="Compare portable observations with committed inspection.json",
    )
    args = parser.parse_args()
    try:
        directory = extract()
        report = {
            "schema_version": 1,
            "dependencies": {
                name: version(name)
                for name in ("pillow", "pymupdf", "pypdf", "pyproj", "pyshp", "rasterio")
            },
            "trails": inspect_trails(directory),
            "pdf": inspect_pdf(),
            "terrain": inspect_grid(directory),
            "hillshade": inspect_image(directory / "HillshadeCSNP.png", "CSNP/HillshadeCSNP.png"),
            "cell_signal": inspect_image(
                SOURCES / "Cell Signal Strength.png",
                "data/cascade-springs-gis/sources/Cell Signal Strength.png",
            ),
        }
        (OUTPUT / "inspection.json").write_text(
            json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8"
        )
        if args.check:
            expected = json.loads((PACKAGE / "inspection.json").read_text(encoding="utf-8"))
            for key in ("schema_version", "dependencies", "trails", "pdf", "hillshade", "cell_signal"):
                if report[key] != expected[key]:
                    raise ValueError(f"{key} differs from committed inspection.json; review the source/tool changes")
            # GDAL builds may format WKT/transforms differently. Compare measured cell data.
            for key in ("size_cells", "dtype", "valid_cells", "nodata_cells", "nodata", "range_source_units"):
                if report["terrain"][key] != expected["terrain"][key]:
                    raise ValueError(f"terrain.{key} differs from committed inspection.json")
        print("Verified sources; wrote .work/gis-data/inspection.json and map-preview.png (no published layers)")
    except (OSError, ValueError, KeyError, BadZipFile) as error:
        sys.exit(f"GIS inspection failed: {error}")


if __name__ == "__main__":
    main()
