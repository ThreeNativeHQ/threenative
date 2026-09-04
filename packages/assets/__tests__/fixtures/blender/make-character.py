# SPDX-License-Identifier: GPL-2.0-or-later
#
# Copyright (C) 2026 ThreeNative contributors
#
# This program is free software; you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation; either version 2 of the
# License, or (at your option) any later version. See packages/blender-mcp/gpl/LICENSE.GPL.
#
# Regenerates `character.fbx`, the rigged fixture `blender-import.spec.ts` converts. Committed so
# the fixture is reviewable and reproducible rather than an opaque binary:
#
#   blender --background --factory-startup --python make-character.py -- <out.fbx>
#
# Why this exists at all is recorded in README.md beside it: every rigged, multi-clip,
# multi-material .fbx reachable from this repository's asset sources is either behind an account or
# two orders of magnitude too large to commit, so the rigged proof subject is authored here while
# `flag_A_blue.fbx` beside it carries the untouched-third-party half of the proof.

import os
import sys

import bpy

out = sys.argv[sys.argv.index("--") + 1]

bpy.ops.wm.read_factory_settings(use_empty=True)

# Two meshes so the fixture has more than one material slot to lose, and enough geometry that a
# triangle count is a real comparison rather than a coincidence.
bpy.ops.mesh.primitive_cylinder_add(radius=0.3, depth=2.0, location=(0, 0, 1), vertices=24)
body = bpy.context.object
body.name = "Body"
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.35, location=(0, 0, 2.3), segments=24, ring_count=12)
head = bpy.context.object
head.name = "Head"

# A real image, generated rather than referenced, so the FBX carries an embedded texture and the
# conversion has something to pack into the GLB.
image = bpy.data.images.new("SkinTexture", width=64, height=64)
pixels = []
for y in range(64):
    for x in range(64):
        checker = ((x // 8) + (y // 8)) % 2
        pixels.extend([0.85, 0.62, 0.45, 1.0] if checker else [0.55, 0.35, 0.25, 1.0])
image.pixels = pixels
image.pack()

skin = bpy.data.materials.new("Skin")
skin.use_nodes = True
texture_node = skin.node_tree.nodes.new("ShaderNodeTexImage")
texture_node.image = image
skin.node_tree.links.new(
    texture_node.outputs["Color"], skin.node_tree.nodes["Principled BSDF"].inputs["Base Color"]
)

cloth = bpy.data.materials.new("Cloth")
cloth.use_nodes = True
cloth.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.2, 0.3, 0.8, 1.0)

body.data.materials.append(cloth)
head.data.materials.append(skin)
for mesh in (body, head):
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.uv.smart_project()
    bpy.ops.object.mode_set(mode="OBJECT")

bpy.ops.object.armature_add(location=(0, 0, 0))
rig = bpy.context.object
rig.name = "Rig"
bpy.ops.object.mode_set(mode="EDIT")
root = rig.data.edit_bones[0]
root.name = "root"
root.head = (0, 0, 0)
root.tail = (0, 0, 1)
spine = rig.data.edit_bones.new("spine")
spine.head = (0, 0, 1)
spine.tail = (0, 0, 2)
spine.parent = root
neck = rig.data.edit_bones.new("neck")
neck.head = (0, 0, 2)
neck.tail = (0, 0, 2.6)
neck.parent = spine
bpy.ops.object.mode_set(mode="OBJECT")

for mesh in (body, head):
    mesh.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")

bpy.ops.object.mode_set(mode="POSE")
rig.animation_data_create()
for clip, angle in (("Idle", 0.15), ("Wave", 0.9)):
    action = bpy.data.actions.new(clip)
    rig.animation_data.action = action
    bone = rig.pose.bones["spine"]
    bone.rotation_mode = "XYZ"
    for frame, value in ((1, 0.0), (12, angle), (24, 0.0)):
        bone.rotation_euler = (value, 0, 0)
        bone.keyframe_insert("rotation_euler", frame=frame)
    action.use_fake_user = True
bpy.ops.object.mode_set(mode="OBJECT")

bpy.ops.export_scene.fbx(
    filepath=out,
    bake_anim=True,
    add_leaf_bones=False,
    embed_textures=True,
    path_mode="COPY",
)
if not os.path.isfile(out):
    raise SystemExit("make-character.py wrote no file at %s" % out)
print("TN_FIXTURE_WROTE %s %d" % (out, os.path.getsize(out)))
