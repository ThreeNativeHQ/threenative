# SPDX-License-Identifier: GPL-2.0-or-later
#
# Copyright (C) 2026 ThreeNative contributors
#
# This program is free software; you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation; either version 2 of the
# License, or (at your option) any later version. See ../LICENSE.GPL.
#
# Export a Blender-authored world as a ThreeNative world package v1: world.json, a raw uint16
# heightmap, one GLB per referenced asset (plus a decimated LOD1), cell-split chunk GLBs and a
# placements.bin of instance transforms. The package format is binding and defined in
# packages/core/src/world-package.ts; this recipe only writes it.
#
# It never picks a look: materials, colours, lights and curves come from the .blend untouched.
#
#   blender -b world.blend --python export_world.py -- --out /tmp/world --cell 64
#   blender --background --factory-startup --python export_world.py -- \
#     '{"source":"/abs/world.blend","out":"/abs/world","cell":64,"spacing":2}'
#
# Conventions, all custom properties: `tn_world_terrain` marks the heightmap mesh, `tn_asset_id`
# names a scatter source (the object name is the warned fallback), `tn_max_distance` is an asset's
# cull distance, `tn_lod_distance` overrides the default 60 m LOD1 range, and a collection marked
# `tn_world_chunk` exports as per-cell chunk GLBs. Hidden, excluded and `_`-prefixed collections are
# skipped. Adapt it: the cell size, the LOD ratio and the asset conventions are the parts a game
# usually wants to change.

import array
import json
import math
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Matrix  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

from _common import collapse_decimate, emit, fail, load, meshes  # noqa: E402

RESULT_RECORD_FLOATS = 8
HEIGHTMAP_MAX = 65535
LOD_RATIO_DEFAULT = 0.25
LOD_DISTANCE_DEFAULT = 60.0
CAPTURE_ENGINE = "TN_WORLD_EXPORT_CAPTURE"


def parse_request():
    """Accept the JSON request the recipe runner sends, or plain `--key value` flags.

    `blender -b world.blend --python export_world.py -- --out <dir> --cell <m>` opens the .blend
    first; the same script through `blender_run_python` gets one JSON argument instead.
    """
    tail = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(tail) == 1:
        try:
            value = json.loads(tail[0])
        except ValueError:
            value = None
        if isinstance(value, dict):
            return value
    payload = {}
    index = 0
    while index < len(tail):
        token = tail[index]
        if token.startswith("--"):
            key = token[2:]
            if "=" in key:
                key, value = key.split("=", 1)
            else:
                index += 1
                if index >= len(tail):
                    fail("'--%s' needs a value" % key)
                value = tail[index]
            payload[key] = value
        index += 1
    return payload


def number(payload, key, default=None):
    raw = payload.get(key, default)
    if raw is None:
        fail("export_world requires a '%s' argument" % key)
    try:
        value = float(raw)
    except (TypeError, ValueError):
        fail("'%s' must be a number, got %r" % (key, raw))
    if not math.isfinite(value) or value <= 0:
        fail("'%s' must be greater than zero, got %r" % (key, raw))
    return value


def object_bounds_gltf(obj):
    vertices = obj.data.vertices
    if len(vertices) == 0:
        fail("asset '%s' has no vertices to export" % obj.name)
    xs = [vertex.co.x for vertex in vertices]
    ys = [vertex.co.z for vertex in vertices]
    zs = [-vertex.co.y for vertex in vertices]
    return {"max": [max(xs), max(ys), max(zs)], "min": [min(xs), min(ys), min(zs)]}


def extract(depsgraph, data):
    """Read everything that needs the render-mode depsgraph into plain Python values.

    The depsgraph handed to `render()` is only valid for the duration of that call, so nothing
    that outlives it (objects, meshes) is kept — only tuples and numbers.
    """
    terrain = next(
        (
            obj
            for obj in bpy.data.objects
            if obj.type == "MESH" and obj.get("tn_world_terrain") is not None
        ),
        None,
    )
    if terrain is None:
        fail("no mesh carries the 'tn_world_terrain' custom property")

    evaluated = terrain.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    world = evaluated.matrix_world
    blender_vertices = [world @ vertex.co for vertex in mesh.vertices]
    polygons = [tuple(polygon.vertices) for polygon in mesh.polygons]
    bvh = BVHTree.FromPolygons(
        [tuple(vertex) for vertex in blender_vertices], polygons, all_triangles=False
    )
    evaluated.to_mesh_clear()

    min_x = min(vertex.x for vertex in blender_vertices)
    max_x = max(vertex.x for vertex in blender_vertices)
    max_z = max(-vertex.y for vertex in blender_vertices)
    min_z = min(-vertex.y for vertex in blender_vertices)
    max_blender_z = max(vertex.z for vertex in blender_vertices)
    min_blender_z = min(vertex.z for vertex in blender_vertices)

    spacing = data["spacing"]
    span_x = max_x - min_x
    span_z = max_z - min_z
    columns = max(2, int(math.ceil(span_x / spacing)) + 1)
    rows = max(2, int(math.ceil(span_z / spacing)) + 1)
    size_x = (columns - 1) * spacing
    size_z = (rows - 1) * spacing

    origin_z = max_blender_z + max(1.0, (max_blender_z - min_blender_z) * 0.01)
    reach = origin_z - min_blender_z + spacing * 2.0 + 1.0
    # A ray exactly on the boundary can miss a mesh that ends there; nudge the outermost samples
    # inward by a thousandth of a cell so edge vertices read the edge height instead of the floor.
    epsilon = spacing * 1e-3
    heights = []
    misses = 0
    for row in range(rows):
        gltf_z = min(max(min_z + row * spacing, min_z + epsilon), max_z - epsilon)
        blender_y = -gltf_z
        for column in range(columns):
            gltf_x = min(max(min_x + column * spacing, min_x + epsilon), max_x - epsilon)
            location = bvh.ray_cast((gltf_x, blender_y, origin_z), (0.0, 0.0, -1.0), reach)[0]
            if location is None:
                misses += 1
                heights.append(min_blender_z)
            else:
                heights.append(location.z)
    if misses:
        sys.stderr.write(
            "TN_BLENDER_WARNING: %d terrain grid samples missed the mesh; clamped to its floor\n"
            % misses
        )

    height_min = min(heights)
    height_max = max(heights)
    if height_max - height_min < 1e-6:
        height_max = height_min + 1.0

    cell_size = data["cell"]
    max_cell_x = max(1, int(math.ceil(size_x / cell_size)))
    max_cell_z = max(1, int(math.ceil(size_z / cell_size)))

    asset_objects = {}
    by_asset = {}
    cell_records = {}
    warned_missing = set()
    warned_scale = set()
    for instance in depsgraph.object_instances:
        if not instance.is_instance:
            continue
        source = instance.instance_object
        if source is None:
            continue
        original = getattr(source, "original", None) or source
        asset_id = original.get("tn_asset_id")
        if asset_id is None:
            asset_id = source.name
            if asset_id not in warned_missing:
                warned_missing.add(asset_id)
                sys.stderr.write(
                    "TN_BLENDER_WARNING: instanced object '%s' has no tn_asset_id; using its name\n"
                    % asset_id
                )
        if not isinstance(asset_id, str) or not asset_id:
            fail("an instance resolved to an empty asset id")
        asset_objects.setdefault(asset_id, source.name)

        matrix = instance.matrix_world
        translation = matrix.translation
        gltf_x, gltf_y, gltf_z = translation.x, translation.z, -translation.y
        rotation = matrix.to_quaternion()
        quaternion = (rotation.x, rotation.z, -rotation.y, rotation.w)
        axis_scale = matrix.to_scale()
        uniform = (axis_scale.x + axis_scale.y + axis_scale.z) / 3.0
        if uniform > 0:
            deviation = max(
                abs(axis_scale.x - uniform),
                abs(axis_scale.y - uniform),
                abs(axis_scale.z - uniform),
            )
            if deviation / uniform > 0.01 and asset_id not in warned_scale:
                warned_scale.add(asset_id)
                sys.stderr.write(
                    "TN_BLENDER_WARNING: asset '%s' has a non-uniform instance scale; using the mean\n"
                    % asset_id
                )
        cell_x = min(max_cell_x - 1, max(0, int(math.floor((gltf_x - min_x) / cell_size))))
        cell_z = min(max_cell_z - 1, max(0, int(math.floor((gltf_z - min_z) / cell_size))))
        record = (
            gltf_x,
            gltf_y,
            gltf_z,
            quaternion[0],
            quaternion[1],
            quaternion[2],
            quaternion[3],
            uniform,
        )
        cell_records.setdefault((cell_x, cell_z), {}).setdefault(asset_id, []).append(record)
        by_asset[asset_id] = by_asset.get(asset_id, 0) + 1

    data.update(
        {
            "asset_objects": asset_objects,
            "by_asset": by_asset,
            "cell_records": cell_records,
            "columns": columns,
            "extent": {"minX": min_x, "minZ": min_z, "sizeX": size_x, "sizeZ": size_z},
            "height_max": height_max,
            "height_min": height_min,
            "heights": heights,
            "max_cell_x": max_cell_x,
            "max_cell_z": max_cell_z,
            "rows": rows,
        }
    )


def capture_render_depsgraph(data):
    """Run one render through a throwaway engine, whose `render(self, depsgraph)` receives the
    depsgraph built at render settings. `evaluated_depsgraph_get()` is viewport mode, and viewport
    "share" tricks would otherwise leak into an export that must use render density."""

    class RenderCapture(bpy.types.RenderEngine):
        bl_idname = CAPTURE_ENGINE
        bl_label = "TN World Export Capture"

        def render(self, depsgraph):
            extract(depsgraph, data)

    scene = bpy.context.scene
    temporary_camera = None
    if scene.camera is None:
        camera_data = bpy.data.cameras.new("TNWorldExportCamera")
        temporary_camera = bpy.data.objects.new("TNWorldExportCamera", camera_data)
        scene.collection.objects.link(temporary_camera)
        scene.camera = temporary_camera
    previous_engine = scene.render.engine
    bpy.utils.register_class(RenderCapture)
    try:
        scene.render.engine = CAPTURE_ENGINE
        try:
            bpy.ops.render.render(write_still=False)
        finally:
            scene.render.engine = previous_engine
    finally:
        bpy.utils.unregister_class(RenderCapture)
        if temporary_camera is not None:
            bpy.data.objects.remove(temporary_camera, do_unlink=True)
    if "extent" not in data:
        fail("could not obtain a render-mode depsgraph")


def glb_mesh_count(path):
    """Meshes in a written GLB, read from its JSON chunk. Zero means no geometry was exported."""
    with open(path, "rb") as handle:
        data = handle.read()
    offset = 12
    while offset + 8 <= len(data):
        length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        if chunk_type == 0x4E4F534A:
            chunk = data[offset : offset + length].rstrip(b"\x00 ")
            return len(json.loads(chunk.decode("utf-8")).get("meshes", []))
        offset += length
    return 0


def write_glb(path, objects):
    directory = os.path.dirname(path)
    if directory and not os.path.isdir(directory):
        os.makedirs(directory, exist_ok=True)
    for candidate in bpy.context.view_layer.objects:
        candidate.select_set(False)
    # A scatter source can sit in an excluded collection, or in a visible collection nested under
    # a hidden one. The glTF exporter skips an object that is in neither a visible collection nor
    # an excluded-but-selected one, and Blender refuses to select an object outside the view
    # layer, so relink every object into a temporary visible collection for the export only and
    # put it back where it came from afterwards.
    staging = bpy.data.collections.new("_tn_export_staging")
    bpy.context.scene.collection.children.link(staging)
    previous = []
    for item in objects:
        previous.append((item, list(item.users_collection)))
        for collection in list(item.users_collection):
            collection.objects.unlink(item)
        staging.objects.link(item)
    bpy.context.view_layer.update()
    try:
        for item in objects:
            item.hide_set(False)
            item.hide_viewport = False
            item.hide_render = False
            item.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_apply=True,
            export_format="GLB",
            export_yup=True,
            use_selection=True,
        )
    finally:
        for item, collections in previous:
            for collection in collections:
                collection.objects.link(item)
        bpy.data.collections.remove(staging)
    if not os.path.isfile(path):
        fail("export wrote no file at '%s'" % path)
    if glb_mesh_count(path) < 1:
        fail("export of '%s' wrote no geometry; its source has no exportable mesh" % path)


def excluded_collections(layer):
    excluded = set()
    for child in layer.children:
        if child.exclude:
            excluded.add(child.collection.name)
        excluded |= excluded_collections(child)
    return excluded


def hidden_collection(collection, excluded):
    return (
        collection.name.startswith("_")
        or collection.hide_viewport
        or collection.hide_render
        or collection.name in excluded
    )


def main():
    payload = parse_request()
    out = payload.get("out")
    if not isinstance(out, str) or not out:
        fail("export_world requires an 'out' directory")
    out = os.path.abspath(out)
    source = payload.get("source")
    if isinstance(source, str) and source:
        load(source)
    elif not bpy.data.filepath:
        fail("export_world needs a 'source' .blend or an already-open file")

    for directory in ("terrain", "assets", "chunks"):
        os.makedirs(os.path.join(out, directory), exist_ok=True)

    data = {"cell": number(payload, "cell"), "spacing": number(payload, "spacing", 2.0)}
    capture_render_depsgraph(data)

    spacing = data["spacing"]
    columns, rows = data["columns"], data["rows"]
    height_min, height_max = data["height_min"], data["height_max"]

    heightmap = array.array("H")
    for value in data["heights"]:
        heightmap.append(int(round((value - height_min) / (height_max - height_min) * HEIGHTMAP_MAX)))
    if sys.byteorder != "little":
        heightmap.byteswap()
    with open(os.path.join(out, "terrain", "heightmap.u16"), "wb") as handle:
        handle.write(heightmap.tobytes())

    asset_objects = data["asset_objects"]
    assets = {}
    for asset_id in sorted(asset_objects):
        obj = bpy.data.objects.get(asset_objects[asset_id])
        if obj is None or obj.type != "MESH":
            fail("asset '%s' resolves no mesh object" % asset_id)
        asset_bounds = object_bounds_gltf(obj)

        relative = "assets/%s.glb" % asset_id
        saved = obj.matrix_world.copy()
        obj.matrix_world = Matrix.Identity(4)
        bpy.context.view_layer.update()
        write_glb(os.path.join(out, relative), [obj])
        obj.matrix_world = saved
        bpy.context.view_layer.update()

        lod_object = obj.copy()
        lod_object.data = obj.data.copy()
        lod_object.name = "%s_lod1" % asset_id
        lod_object.data.name = "%s_lod1" % asset_id
        lod_object.matrix_world = Matrix.Identity(4)
        bpy.context.scene.collection.objects.link(lod_object)
        collapse_decimate(lod_object, obj.get("tn_lod_ratio", LOD_RATIO_DEFAULT))
        lod_relative = "assets/%s_lod1.glb" % asset_id
        write_glb(os.path.join(out, lod_relative), [lod_object])
        lod_mesh = lod_object.data
        bpy.data.objects.remove(lod_object, do_unlink=True)
        bpy.data.meshes.remove(lod_mesh)

        asset = {
            "bounds": asset_bounds,
            "glb": relative,
            "lods": [
                {
                    "distance": float(obj.get("tn_lod_distance", LOD_DISTANCE_DEFAULT)),
                    "glb": lod_relative,
                }
            ],
        }
        max_distance = obj.get("tn_max_distance")
        if max_distance is not None:
            asset["maxDistance"] = float(max_distance)
        assets[asset_id] = asset

    extent = data["extent"]
    cell_size = data["cell"]
    chunk_cells = {}
    excluded = excluded_collections(bpy.context.view_layer.layer_collection)
    for collection in bpy.data.collections:
        if collection.get("tn_world_chunk") is None or hidden_collection(collection, excluded):
            continue
        grouped = {}
        for obj in collection.objects:
            if obj.type != "MESH":
                continue
            translation = obj.matrix_world.translation
            gltf_x, gltf_z = translation.x, -translation.y
            cell_x = min(
                data["max_cell_x"] - 1,
                max(0, int(math.floor((gltf_x - extent["minX"]) / cell_size))),
            )
            cell_z = min(
                data["max_cell_z"] - 1,
                max(0, int(math.floor((gltf_z - extent["minZ"]) / cell_size))),
            )
            grouped.setdefault((cell_x, cell_z), []).append(obj)
        for (cell_x, cell_z), objects in grouped.items():
            # ponytail: a chunk is assigned whole to the cell holding its origin; no mesh is clipped
            # across a boundary. Add per-cell clipping when a game's chunk geometry straddles cells
            # at a scale where the overlap costs a visible draw.
            relative = "chunks/%s_%d_%d.glb" % (collection.name, cell_x, cell_z)
            write_glb(os.path.join(out, relative), objects)
            chunk_cells.setdefault((cell_x, cell_z), []).append(relative)

    placements = array.array("f")
    placement_records = []
    cells = []
    for cell in sorted(set(data["cell_records"]) | set(chunk_cells)):
        runs = []
        for asset_id in sorted(data["cell_records"].get(cell, {})):
            records = data["cell_records"][cell][asset_id]
            runs.append(
                {"asset": asset_id, "count": len(records), "offset": len(placement_records)}
            )
            placement_records.extend(records)
        entry = {"runs": runs, "x": cell[0], "z": cell[1]}
        if cell in chunk_cells:
            entry["chunks"] = sorted(chunk_cells[cell])
        cells.append(entry)
    for record in placement_records:
        placements.extend(record)
    if sys.byteorder != "little":
        placements.byteswap()
    with open(os.path.join(out, "placements.bin"), "wb") as handle:
        handle.write(placements.tobytes())

    manifest = {
        "assets": assets,
        "cellSize": cell_size,
        "cells": cells,
        "extent": extent,
        "placements": "placements.bin",
        "terrain": {
            "columns": columns,
            "heightMax": height_max,
            "heightMin": height_min,
            "heightmap": "terrain/heightmap.u16",
            "rows": rows,
            "spacing": spacing,
        },
        "version": 1,
    }
    with open(os.path.join(out, "world.json"), "w") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
        handle.write("\n")

    viewport_instances = 0
    for instance in bpy.context.evaluated_depsgraph_get().object_instances:
        if instance.is_instance and instance.instance_object is not None:
            viewport_instances += 1

    emit(
        {
            "assetsWritten": len(assets),
            "cells": len(cells),
            "instances": sum(data["by_asset"].values()),
            "instancesByAsset": data["by_asset"],
            "meshes": len(meshes()),
            "out": out,
            "placementsBytes": len(placements) * 4,
            "recipe": "export_world",
            "source": bpy.data.filepath or (source if isinstance(source, str) else ""),
            "viewportInstances": viewport_instances,
        }
    )


if __name__ == "__main__":
    main()
