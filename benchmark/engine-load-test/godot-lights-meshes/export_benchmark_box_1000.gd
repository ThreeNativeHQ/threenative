extends SceneTree

# PRD-449 Phase 1 — export the canonical fixture for the pinned `godot-lights-meshes` family,
# benchmark `benchmark_box_1000`, by asking Godot to build it.
#
# The scene here is NOT re-implemented: `res://benchmarks/rendering/lights_and_meshes.gd` is
# loaded out of the pinned checkout and its own `benchmark_box_1000()` constructs the nodes, so
# every position, jitter draw and count in the fixture is whatever upstream Godot produced. The
# only thing this script adds is a disclosed deterministic seed (upstream draws from the global
# RNG, which is otherwise seeded per process) and a byte-level dump of the result.
#
# Usage (see README.md for the exact command):
#   godot --headless --path <pinned godot-benchmarks src> \
#     --script benchmark/engine-load-test/godot-lights-meshes/export_benchmark_box_1000.gd \
#     -- --out <fixture path>

const UPSTREAM_REPO := "https://github.com/godotengine/godot-benchmarks"
const UPSTREAM_COMMIT := "b059e38a81230a87293828bbf65ab247b6b2d2a8"
const UPSTREAM_SCRIPT := "res://benchmarks/rendering/lights_and_meshes.gd"
const UPSTREAM_BLOB_SHA1 := "e9ded113e727529965fcc172d23062e0e13948a7"
const UPSTREAM_SCRIPT_SHA256 := "2b1b4088876a6fac0332a14b27d004634360786c7746133360ba35cf9f003a6c"
const UPSTREAM_SCRIPT_BYTES := 4366
const UPSTREAM_PROJECT := "res://project.godot"
const UPSTREAM_PROJECT_BLOB_SHA1 := "449426235f91f0c587381d0d28ebe6d90001c23c"

const GODOT_VERSION := "4.7.1.stable.official.a13da4feb"
const GODOT_ENGINE_COMMIT := "a13da4feb8d8aefc283c3763d33a2f170a18d541"

## The one adaptation. Upstream never seeds; this value is disclosed in the fixture's
## `rng.disclosedAdaptation` and in `deviations`.
const SEED := 20260927

## read by `benchmark_box_1000()` -> `create_scene({mesh=box_mesh, objects=1000})`; the other
## keys keep their upstream defaults (spot lights, 10 lights, speed 1.0).
const REQUESTED_OBJECTS := 1000
const REQUESTED_LIGHTS := 10

## `create_scattered(count)` returns `round(sqrt(count))^2` cells, so the actual counts are these
## two numbers, not the requested ones.
const EXPECTED_MESH_CELLS := 1024
const EXPECTED_LIGHT_CELLS := 9

const SIDECAR_SUFFIX := ".sha256"

var _errors: PackedStringArray = []
var _out_path := ""
var _scene: Node3D = null


## The pinned script runs here, before the tree exists, because upstream's constructors are what
## build the scene. Reading the transforms waits for `_process`, the first moment the tree is
## live — still before SceneTree dispatches any node's `_process`.
func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	for i in args.size():
		if args[i] == "--out" and i + 1 < args.size():
			_out_path = args[i + 1]
	if _out_path == "":
		_fail("`--out <path>` is required")
		_report()
		return
	_scene = _build_scene()
	if _errors.size() > 0:
		_report()


func _process(_delta: float) -> bool:
	if _scene == null:
		return true
	var fixture := _build_fixture(_scene)
	if _errors.size() == 0:
		_write(fixture)
	_report()
	return true


func _write(fixture: Dictionary) -> void:
	var text := JSON.stringify(fixture, "  ") + "\n"
	var file := FileAccess.open(_out_path, FileAccess.WRITE)
	if file == null:
		_fail("cannot write %s (error %d)" % [_out_path, FileAccess.get_open_error()])
		return
	file.store_string(text)
	file.close()

	var digest := text.sha256_text()
	var side := FileAccess.open(_out_path + SIDECAR_SUFFIX, FileAccess.WRITE)
	if side == null:
		_fail("cannot write %s%s" % [_out_path, SIDECAR_SUFFIX])
		return
	# `sha256sum -c` compatible: "<hex>  <basename>".
	side.store_string("%s  %s\n" % [digest, _out_path.get_file()])
	side.close()

	print("wrote %s (%d bytes) sha256=%s" % [_out_path, text.length(), digest])
	print("actual: %s" % JSON.stringify(fixture.get("counts", {}).get("actual", {})))


# --- construction --------------------------------------------------------------------------------


## Nothing but the pinned `benchmark_box_1000()` builds nodes here; the seed is the one addition.
func _build_scene() -> Node3D:
	if _file_sha256(UPSTREAM_SCRIPT) != UPSTREAM_SCRIPT_SHA256:
		_fail("the upstream script differs from the pinned SHA-256")
		return null
	# Seeded immediately before the pinned script draws, so nothing this exporter does can shift
	# the sequence and the fixture is reproducible from a clean process.
	seed(SEED)
	var upstream: GDScript = load(UPSTREAM_SCRIPT)
	if upstream == null:
		_fail("cannot load the pinned upstream script at %s" % UPSTREAM_SCRIPT)
		return null
	var benchmark: Object = upstream.new()
	if benchmark == null:
		_fail("the pinned upstream script did not instantiate")
		return null
	var scene: Node3D = benchmark.benchmark_box_1000()
	if scene == null or not (scene is Node3D):
		_fail("benchmark_box_1000() did not return a Node3D")
		return null
	return scene


## Fails closed unless nothing has animated yet: a dispatched `_process` would have rotated both
## grids and replaced every light's energy with sin(accum) * 5.0.
func _require_initial_state(scene: Node3D) -> void:
	for i in [1, 2]:
		if (scene.get_child(i) as Node3D).rotation != Vector3.ZERO:
			_fail("grid rotater %d has already rotated; the scene is not in its initial state" % i)
	var light_grid: Node = scene.get_child(2).get_child(0)
	for i in light_grid.get_child_count():
		var light: SpotLight3D = light_grid.get_child(i).get_child(0).get_child(0)
		if light.light_energy != 5.0 or not light.visible:
			_fail("light %d has already pulsed (energy %f, visible %s)" % [i, light.light_energy, light.visible])


func _build_fixture(scene: Node3D) -> Dictionary:
	# World transforms only exist inside the tree, so the root is entered here and the values are
	# read before SceneTree dispatches this frame's node `_process`: initial state, not a baked pose.
	get_root().add_child(scene)
	if not scene.is_inside_tree():
		_fail("the scene did not enter the tree")
		return {}
	_require_initial_state(scene)

	var census := _census(scene)
	var meshes := int(census.get("MeshInstance3D", 0))
	var lights := int(census.get("SpotLight3D", 0))
	if meshes != EXPECTED_MESH_CELLS:
		_fail("actual MeshInstance3D is %d, expected %d" % [meshes, EXPECTED_MESH_CELLS])
	if lights != EXPECTED_LIGHT_CELLS:
		_fail("actual SpotLight3D is %d, expected %d" % [lights, EXPECTED_LIGHT_CELLS])
	for native_class in census.keys():
		if native_class not in ["MeshInstance3D", "SpotLight3D", "Node3D", "Camera3D", "WorldEnvironment"]:
			_fail("unexpected node class %s in the scene" % native_class)
	if not _hierarchy_is_the_pinned_one(scene):
		return {}

	return {
		"schema": "threenative.godot-lights-meshes.fixture",
		"schemaVersion": 1,
		"fixtureId": "godot-lights-meshes-box-1000",
		"produced": {
			"producer": "the pinned upstream script constructed this scene inside Godot; this file only serialised it",
			"godotVersion": GODOT_VERSION,
			"godotEngineCommit": GODOT_ENGINE_COMMIT,
			"godotBuild": "official linux.x86_64 editor build, --headless (dummy renderer)",
			"command": "godot --headless --path <pinned godot-benchmarks src> --script benchmark/engine-load-test/godot-lights-meshes/export_benchmark_box_1000.gd -- --out benchmark/engine-load-test/godot-lights-meshes/benchmark_box_1000.json",
		},
		"source": {
			"repo": UPSTREAM_REPO,
			"commit": UPSTREAM_COMMIT,
			"script": UPSTREAM_SCRIPT,
			"scriptGitBlobSha1": UPSTREAM_BLOB_SHA1,
			"scriptBytes": UPSTREAM_SCRIPT_BYTES,
			"scriptSha256": _file_sha256(UPSTREAM_SCRIPT),
			"projectGodot": UPSTREAM_PROJECT,
			"projectGodotGitBlobSha1": UPSTREAM_PROJECT_BLOB_SHA1,
			"entryPoint": "benchmark_box_1000() -> create_scene({mesh=box_mesh, objects=1000})",
			"family": "godot-lights-meshes",
		},
		"encoding": _encoding(),
		"rng": _rng(),
		"counts": _counts(census, meshes, lights),
		"census": _census_record(census),
		"resources": _resources(scene),
		"nodes": _nodes(scene),
		"behavior": _behavior(scene),
		"upstreamBehavior": _upstream_behavior(),
		"deviations": _deviations(),
		"notClaimed": _not_claimed(),
	}


## Every node class present, counted. Keys are Godot's own native class names.
func _census(root: Node) -> Dictionary:
	var counts := {}
	var stack: Array = [root]
	while stack.size() > 0:
		var node: Node = stack.pop_back()
		counts[node.get_class()] = int(counts.get(node.get_class(), 0)) + 1
		for child in node.get_children():
			stack.push_back(child)
	return counts


## The four children upstream adds, in order, and the classes their children must have. A
## reordered or reshaped tree is a different scene and must not be exported as this fixture.
func _hierarchy_is_the_pinned_one(scene: Node3D) -> bool:
	var root_children := scene.get_children()
	if root_children.size() != 4:
		_fail("the scene root has %d children, expected 4" % root_children.size())
		return false
	var classes := ["Camera3D", "Node3D", "Node3D", "WorldEnvironment"]
	for i in root_children.size():
		if root_children[i].get_class() != classes[i]:
			_fail("scene root child %d is %s, expected %s" % [i, root_children[i].get_class(), classes[i]])
			return false
	var mesh_grid: Node = root_children[1].get_child(0)
	var light_grid: Node = root_children[2].get_child(0)
	if mesh_grid.get_child_count() != EXPECTED_MESH_CELLS:
		_fail("mesh grid has %d cells, expected %d" % [mesh_grid.get_child_count(), EXPECTED_MESH_CELLS])
		return false
	if light_grid.get_child_count() != EXPECTED_LIGHT_CELLS:
		_fail("light grid has %d cells, expected %d" % [light_grid.get_child_count(), EXPECTED_LIGHT_CELLS])
		return false
	for i in mesh_grid.get_child_count():
		var model := mesh_grid.get_child(i)
		if model.get_child_count() != 1 or model.get_child(0).get_class() != "MeshInstance3D":
			_fail("mesh cell %d does not hold exactly one MeshInstance3D" % i)
			return false
	for i in light_grid.get_child_count():
		var cell := light_grid.get_child(i)
		if cell.get_child_count() != 1 or cell.get_child(0).get_child_count() != 1:
			_fail("light cell %d is not a Lighter wrapping one light" % i)
			return false
		if cell.get_child(0).get_child(0).get_class() != "SpotLight3D":
			_fail("light cell %d does not hold a SpotLight3D" % i)
			return false
	if _script_properties(root_children[1]) != ["speed"]:
		_fail("the mesh grid's parent is not a Rotater (script properties %s)" % [_script_properties(root_children[1])])
		return false
	if _script_properties(root_children[2]) != ["speed"]:
		_fail("the light grid's parent is not a Rotater (script properties %s)" % [_script_properties(root_children[2])])
		return false
	if _script_properties(light_grid.get_child(0).get_child(0)) != ["accum", "light", "speed"]:
		_fail("light cell 0 is not a Lighter (script properties %s)" % [_script_properties(light_grid.get_child(0).get_child(0))])
		return false
	return true


## The script variables an inner class of the pinned file declares. `get_script()` on an inner
## class has no resource path, so the property names are what distinguishes Lighter from Rotater.
func _script_properties(node: Node) -> Array:
	var out: Array = []
	for property in node.get_property_list():
		if int(property.get("usage", 0)) & PROPERTY_USAGE_SCRIPT_VARIABLE:
			out.append(String(property.get("name", "")))
	out.sort()
	return out


# --- records -------------------------------------------------------------------------------------


func _encoding() -> Dictionary:
	return {
		"scalars": "every real number is a JSON string, never a JSON number: the exact IEEE-754 binary64 value written with \"%.17f\" (17 decimal places, at least 17 significant digits at this scene's magnitudes) and read back with strtod. The export rejects any non-finite value and any string that does not read back as a finite number, and scripts/__tests__/godot-lights-meshes-fixture.spec.ts proves with a correctly-rounded parse (JS Number and toFixed(17)) that every string is the exact 17-decimal form of the binary64 a consumer gets. Godot's own float formatter keeps about 6 significant digits, which is why a JSON number is never used, and Godot's String::to_float accumulates, which is why the exporter does not use it to prove exactness.",
		"integers": "JSON numbers, exact (Godot ints are 64-bit signed).",
		"byteOrder": "little-endian, for the base64 mesh buffers and for any future binary payload",
		"floatPrecision": "mesh buffers are float32 exactly as Godot stores them. Godot 4 Node3D math is float32 (real_t), so every transform component here is an exact float32 value widened to binary64; GDScript doubles such as the Lighter's accum keep double precision; light, camera and environment properties keep whatever precision the property declares. All of them are written as \"%.17f\" strings.",
		"buffers": "base64 of the exact little-endian bytes Godot holds: PackedVector3Array = 3 x float32 per element, PackedVector2Array = 2 x float32, PackedFloat32Array = 1 x float32, PackedInt32Array = 1 x int32. Each buffer also carries its own SHA-256 over those bytes.",
		"transform": "Godot Transform3D as {origin:[x,y,z], basis:{x:[..],y:[..],z:[..]}}} where basis.x/y/z are the three column vectors; the equivalent column-major 4x4 matrix puts origin in the fourth column and w=1. `local` is Node3D.transform, `world` is Node3D.global_transform read inside the tree with zero frames processed.",
		"objectIds": "the child-index path from the scene root, root = \"\", its children \"0\"..\"3\", nested \"1/0/5/0\". Godot's auto-generated node names (@MeshInstance3D@412) depend on a per-process counter and are deliberately not recorded.",
		"nodeOrder": "depth-first in child order, parents before children",
		"file": "UTF-8, LF line endings, no BOM, 2-space indent, exactly one trailing LF. The fixture's identity is the SHA-256 of these bytes, recorded next to it in benchmark_box_1000.json.sha256 (sha256sum -c compatible).",
	}


func _rng() -> Dictionary:
	return {
		"generator": "Godot's global RandomNumberGenerator, as upstream draws it with the unqualified randf()",
		"seedCall": "seed(%d) called by the exporter immediately before benchmark_box_1000(), with no other randf() call in between" % SEED,
		"seed": SEED,
		"drawsPerMeshCell": "3 (position.x jitter, position.z jitter, position.y jitter)",
		"drawsPerLightCell": "2 (create_spot_light's rotation.y = randf() * 999999, then the Lighter's accum = randf() * 100)",
		"totalDraws": 3 * EXPECTED_MESH_CELLS + 2 * EXPECTED_LIGHT_CELLS,
		"totalDrawsBasis": "counted from the pinned source's structure, not measured: this exporter cannot intercept the unqualified randf() calls the pinned script makes",
	}


func _counts(census: Dictionary, meshes: int, lights: int) -> Dictionary:
	return {
		"requested": {"objects": REQUESTED_OBJECTS, "lights": REQUESTED_LIGHTS},
		"actual": {
			"meshInstances": meshes,
			"spotLights": lights,
			"meshCells": int(census.get("MeshInstance3D", 0)),
			"lightCells": lights,
		},
		"rule": "create_scattered(count) builds round(sqrt(count))^2 cells in a z-major grid (z outer, x inner), so the requested counts are not the built counts. Upstream requests 1000 objects and 10 lights and gets 1024 and 9; correcting the count is a separate experiment, not this fixture.",
		"gridSide": {
			"meshCells": 32,
			"lightCells": 3,
			"formula": "round(sqrt(count))",
		},
		"censusNote": "labels in any chart of this fixture must use the actual counts above",
	}


func _census_record(census: Dictionary) -> Dictionary:
	var by_class := {}
	var keys: Array = census.keys()
	keys.sort()
	for native_class in keys:
		by_class[native_class] = int(census[native_class])
	var total := 0
	for native_class in keys:
		total += int(census[native_class])
	return {
		"byNativeClass": by_class,
		"nodesIncludingRoot": total,
		"note": "inner classes of the pinned file report their native class, so Rotater and Lighter count as Node3D; their script variables are in each node's `scriptProperties`",
	}


func _resources(scene: Node3D) -> Array:
	var camera: Camera3D = scene.get_child(0)
	var environment: Environment = (scene.get_child(3) as WorldEnvironment).environment
	var light: SpotLight3D = (scene.get_child(2).get_child(0).get_child(0).get_child(0) as Node3D).get_child(0)
	var model: MeshInstance3D = scene.get_child(1).get_child(0).get_child(0).get_child(0)

	return [
		_mesh_resource((model.mesh as BoxMesh), (model.material_override)),
		_mesh_instance_defaults(model),
		_spot_light_resource(light),
		_camera_resource(camera),
		_environment_resource(environment),
	]


func _mesh_resource(mesh: BoxMesh, material_override: Material) -> Dictionary:
	if mesh == null or not (mesh is BoxMesh):
		_fail("the mesh nodes do not bind a BoxMesh")
		return {}
	var arrays := mesh.surface_get_arrays(0)
	var expected_layout := [TYPE_PACKED_VECTOR3_ARRAY, TYPE_PACKED_VECTOR3_ARRAY, TYPE_PACKED_FLOAT32_ARRAY, TYPE_NIL, TYPE_PACKED_VECTOR2_ARRAY, TYPE_NIL, TYPE_NIL, TYPE_NIL, TYPE_NIL, TYPE_NIL, TYPE_NIL, TYPE_NIL, TYPE_PACKED_INT32_ARRAY]
	if arrays.size() != expected_layout.size():
		_fail("BoxMesh surface 0 has %d array slots, expected %d" % [arrays.size(), expected_layout.size()])
	for i in mini(arrays.size(), expected_layout.size()):
		if typeof(arrays[i]) != expected_layout[i]:
			_fail("BoxMesh surface 0 array %d is type %d, expected %d" % [i, typeof(arrays[i]), expected_layout[i]])
	var aabb := mesh.get_aabb()
	return {
		"id": "mesh:box-1k",
		"class": mesh.get_class(),
		"shared": "one BoxMesh instance is bound to all %d MeshInstance3D nodes" % EXPECTED_MESH_CELLS,
		"parameters": _properties(mesh, [
			"size", "subdivide_width", "subdivide_height", "subdivide_depth", "flip_faces",
		]),
		"surfaceCount": mesh.get_surface_count(),
		"surface0": {
			"primitive": "triangles",
			"primitiveNote": "Godot 4.7 does not expose Mesh.surface_get_primitive_type to scripts; one BoxMesh surface is %d vertices over %d indices, so it is a %d-triangle list" % [(arrays[0] as PackedVector3Array).size(), (arrays[12] as PackedInt32Array).size(), (arrays[12] as PackedInt32Array).size() / 3],
			"vertexCount": (arrays[0] as PackedVector3Array).size(),
			"indexCount": (arrays[12] as PackedInt32Array).size(),
			"bounds": {"position": _vec(aabb.position), "size": _vec(aabb.size)},
			"buffers": {
				"vertexPositions": _buffer(arrays[0]),
				"normals": _buffer(arrays[1]),
				"tangents": _buffer(arrays[2]),
				"uv": _buffer(arrays[4]),
				"indices": _buffer(arrays[12]),
			},
			"materialBinding": {
				"surfaceMaterial": null if mesh.surface_get_material(0) == null else str(mesh.surface_get_material(0)),
				"kind": "unassigned-default" if mesh.surface_get_material(0) == null else "explicit",
				"note": "the pinned source assigns no material and no texture; Godot's per-surface default material is bound at draw time, so an arm that binds its own material is not this fixture",
			},
		},
		"instanceMaterialOverride": null if material_override == null else str(material_override),
	}


func _mesh_instance_defaults(model: MeshInstance3D) -> Dictionary:
	return {
		"id": "node:mesh-instance-defaults",
		"class": "MeshInstance3D",
		"note": "identical on all %d mesh nodes; upstream sets only scale.y and position.y" % EXPECTED_MESH_CELLS,
		"properties": _properties(model, [
			"cast_shadow", "gi_mode", "extra_cull_margin", "lod_bias", "visibility_range_begin",
			"visibility_range_end", "visibility_range_fade_mode", "layers", "transparency",
			"sorting_offset", "ignore_occlusion_culling", "visible",
		]),
	}


func _spot_light_resource(light: SpotLight3D) -> Dictionary:
	var record := {
		"id": "light:spot-9",
		"class": light.get_class(),
		"shared": "one setting set for all %d lights; per-light rotation.y is randf() * 999999 and lives in each node's transform" % EXPECTED_LIGHT_CELLS,
		"initialEnergy": _real(5.0),
		"initialEnergyNote": "the value the pinned source assigns; the Lighter's _process overwrites light_energy every frame, and this fixture records no post-frame pose",
		"properties": _properties(light, [
			"light_color", "light_energy", "light_indirect_energy", "light_size", "light_specular",
			"spot_range", "spot_angle", "spot_angle_attenuation", "spot_attenuation",
			"shadow_enabled", "shadow_bias", "shadow_normal_bias", "shadow_blur",
			"shadow_caster_mask", "shadow_opacity", "distance_fade_enabled", "distance_fade_begin",
			"distance_fade_length", "distance_fade_shadow", "light_cull_mask", "layers",
			"light_bake_mode", "light_negative", "light_volumetric_fog_energy",
		]),
		"setByPinnedSource": [
			"position.y = 0.01", "spot_attenuation = 0.2", "spot_angle = 25", "spot_range = 0.4",
			"light_energy = 5.0", "rotation.y = randf() * 999999", "light_size = 0.1",
		],
		"engineDefaultsNotSetBySource": [
			"shadow_enabled", "light_color", "light_specular", "light_cull_mask",
			"distance_fade_enabled", "shadow_bias", "shadow_blur", "light_bake_mode",
		],
		"shadowNote": "the source never mentions shadows; the recorded shadow_enabled is the value the engine constructed, not an inference from the source (PRD-449 line 94)",
	}
	return record


func _camera_resource(camera: Camera3D) -> Dictionary:
	return {
		"id": "camera:main",
		"class": camera.get_class(),
		"note": "upstream sets position.y, position.z and rotate_x(-0.8) only; the transform is on the node",
		"properties": _properties(camera, [
			"fov", "size", "near", "far", "keep_aspect", "projection", "current",
			"frustum_offset", "h_offset", "v_offset", "cull_mask", "doppler_tracking",
		]),
		"projectionNote": "projection 0 is PERSPECTIVE, keep_aspect 1 is KEEP_HEIGHT; near/far are the engine defaults 0.05/4000, not set by the source",
	}


func _environment_resource(environment: Environment) -> Dictionary:
	return {
		"id": "env:background-color",
		"class": environment.get_class(),
		"note": "upstream creates a fresh Environment and sets only the background and the ambient source; everything else is the engine default and is recorded so a rendering arm cannot silently differ",
		"properties": _properties(environment, [
			"background_mode", "background_color", "background_energy_multiplier",
			"ambient_light_source", "ambient_light_color", "ambient_light_energy",
			"ambient_light_sky_contribution", "reflected_light_source", "tonemap_mode",
			"tonemap_exposure", "tonemap_white", "ssao_enabled", "sdfgi_enabled",
			"glow_enabled", "fog_enabled", "fog_light_color", "fog_light_energy",
			"volumetric_fog_enabled", "adjustment_enabled",
		]),
		"setByPinnedSource": [
			"background_mode = BG_COLOR", "background_color = Color(\"#fff\")",
			"ambient_light_source = AMBIENT_SOURCE_COLOR",
		],
	}


func _buffer(value: Variant) -> Dictionary:
	var bytes: PackedByteArray = value.to_byte_array()
	return {
		"encoding": "base64",
		"bytes": bytes.size(),
		"sha256": _sha256(bytes),
		"data": Marshalls.raw_to_base64(bytes),
	}


func _sha256(bytes: PackedByteArray) -> String:
	var context := HashingContext.new()
	context.start(HashingContext.HASH_SHA256)
	context.update(bytes)
	return context.finish().hex_encode()


# --- nodes ---------------------------------------------------------------------------------------


func _nodes(scene: Node3D) -> Array:
	var out: Array = []
	var mesh_grid: Node = scene.get_child(1).get_child(0)
	var light_grid: Node = scene.get_child(2).get_child(0)
	out.append(_node("", null, scene, "sceneRoot"))
	out.append(_node("0", "", scene.get_child(0), "camera", {"cameraRef": "camera:main"}))
	out.append(_rotater("1", "", scene.get_child(1), mesh_grid, "meshGridRotater"))
	out.append(_node("1/0", "1", mesh_grid, "meshGrid"))
	for i in mesh_grid.get_child_count():
		var cell: Node3D = mesh_grid.get_child(i)
		var cell_id := "1/0/%d" % i
		out.append(_node(cell_id, "1/0", cell, "meshCell"))
		var model: Node3D = cell.get_child(0)
		out.append(_node("%s/0" % cell_id, cell_id, model, "meshModel", {
			"meshRef": "mesh:box-1k",
			"instanceDefaultsRef": "node:mesh-instance-defaults",
		}))
	out.append(_rotater("2", "", scene.get_child(2), light_grid, "lightGridRotater"))
	out.append(_node("2/0", "2", light_grid, "lightGrid"))
	for i in light_grid.get_child_count():
		var light_cell: Node3D = light_grid.get_child(i)
		var holder: Node3D = light_cell.get_child(0)
		var light: Node3D = holder.get_child(0)
		var cell_id := "2/0/%d" % i
		out.append(_node(cell_id, "2/0", light_cell, "lightCell"))
		out.append(_node("%s/0" % cell_id, cell_id, holder, "lightHolder", {
			"behaviorRef": "behavior.lighters[%d]" % i,
		}))
		out.append(_node("%s/0/0" % cell_id, "%s/0" % cell_id, light, "light", {
			"lightRef": "light:spot-9",
		}))
	# A WorldEnvironment is not a Node3D: it carries no transform, only the environment binding.
	out.append({
		"id": "3",
		"parent": "",
		"role": "worldEnvironment",
		"class": scene.get_child(3).get_class(),
		"scriptProperties": [],
		"environmentRef": "env:background-color",
	})
	return out


func _rotater(id: String, parent: String, rotater: Node3D, grid: Node, role: String) -> Dictionary:
	var record := _node(id, parent, rotater, role)
	record["rotates"] = "%s/0" % id
	record["behaviorRef"] = "behavior.gridRotaters"
	record["grid"] = "%s/0" % id
	record["cellCount"] = grid.get_child_count()
	return record


func _node(id: String, parent: Variant, node: Node3D, role: String, extra: Dictionary = {}) -> Dictionary:
	var properties := _script_properties(node)
	var record := {
		"id": id,
		"parent": parent,
		"role": role,
		"class": node.get_class(),
		"scriptProperties": properties,
		"local": _xform(node.transform),
		"world": _xform(node.global_transform),
	}
	if properties.has("speed"):
		record["speed"] = _real(node.get("speed"))
	if properties.has("accum"):
		record["phase"] = _real(node.get("accum"))
	for key in extra.keys():
		record[key] = extra[key]
	return record


# --- behaviour -----------------------------------------------------------------------------------


func _behavior(scene: Node3D) -> Dictionary:
	var mesh_rotater: Node3D = scene.get_child(1)
	var light_rotater: Node3D = scene.get_child(2)
	var light_grid: Node = scene.get_child(2).get_child(0)
	var lighters: Array = []
	for i in light_grid.get_child_count():
		var holder: Node3D = light_grid.get_child(i).get_child(0)
		lighters.append({
			"nodeId": "2/0/%d/0" % i,
			"lightNodeId": "2/0/%d/0/0" % i,
			"speed": _real(holder.get("speed")),
			"phase": _real(holder.get("accum")),
		})
	return {
		"gridRotaters": [
			{
				"nodeId": "1",
				"role": "meshGridRotater",
				"speed": _real(mesh_rotater.get("speed")),
				"perFrame": "rotate_y(delta * speed)",
				"direction": "negative",
			},
			{
				"nodeId": "2",
				"role": "lightGridRotater",
				"speed": _real(light_rotater.get("speed")),
				"perFrame": "rotate_y(delta * speed)",
				"direction": "positive",
			},
		],
		"oppositeRotation": "the two grids rotate in opposite directions at the same magnitude (0.1 * speed), so a light's pairing with the meshes changes over time; an arm that rotates both the same way is not this scene",
		"lighters": lighters,
		"lighterPerFrame": [
			"accum += delta * speed * 2.0",
			"energy = sin(accum) * 5.0",
			"light.visible = energy > 0",
			"if light.visible: light.light_energy = energy",
		],
		"sceneSpeed": _real(1.0),
		"sceneSpeedNote": "the settings.speed upstream passes to create_scene, from which the rotater speeds are -0.1 * speed and +0.1 * speed and every Lighter's speed is speed",
		"frameSchedule": {
			"upstream": "manager.gd awaits 3 process frames after adding the benchmark node, then runs frames until benchmark_time (5e6 us) has elapsed",
			"warmupFrames": 3,
			"timedUntilMicroseconds": 5000000,
			"frameCountIsMachineDependent": true,
			"bakedFinalPoses": false,
			"note": "the fixture supplies initial state, per-frame inputs and speeds; a timed arm performs the rotation and pulse itself. No post-frame transform, energy or visibility is recorded here, so nothing can be precomputed past the work under test (PRD-449 6.1).",
		},
		"verificationOracle": {
			"object10Rejection": "any arm that changes MeshInstance3D node 1/0/10/0 must be rejected: its local origin, its world origin and the fixture SHA-256 all cover it, while a first-eight-placement hash cannot see it",
		},
	}


func _upstream_behavior() -> Dictionary:
	return {
		"cellPlacement": "for z in round(sqrt(count)): for x in round(sqrt(count)): position.x = (randf() * 0.1 + x + 0.5) * 2 / s - 1; position.z = (randf() * 0.1 + z + 0.5) * 2 / s - 1; position.y = -randf() * 0.1 / s; scale.x *= 2 / s; scale.z *= 2 / s",
		"cellPlacementNote": "the random jitter, the z-major iteration order and the non-uniform 2/s cell scale are upstream behaviour and are preserved exactly; nothing is rounded or de-jittered",
		"modelPlacement": "each MeshInstance3D gets scale.y = 0.05 and position.y = -0.025 and binds the shared BoxMesh",
		"lightPlacement": "each light cell holds a Lighter that adds the light as a child, with accum = randf() * 100; create_spot_light sets position.y = 0.01 and rotation.y = randf() * 999999",
		"oppositeGrids": "see behavior.gridRotaters",
		"pulsingLights": "see behavior.lighterPerFrame: energy oscillates as sin(accum) * 5.0 and a light is visible only while that energy is positive",
	}


func _deviations() -> Array:
	return [
		{
			"kind": "deterministicSeeding",
			"what": "the exporter calls seed(%d) before benchmark_box_1000()" % SEED,
			"why": "upstream draws from the global RNG, whose state Godot seeds per process, so the same source would produce a different scene on every run and could not be hashed",
			"scope": "the RNG state only: the sequence, the draw count, the draw order and the formulas are upstream's",
			"affects": "every jittered position, every light's rotation.y and every Lighter phase; nothing else",
		},
		{
			"kind": "treeEntryForWorldTransforms",
			"what": "the scene root is added to the SceneTree root before the transforms are read, from the main loop's first _process",
			"why": "Node3D.get_global_transform() returns an empty Transform3D outside the tree, so world transforms would be unobtainable",
			"scope": "every value is read before SceneTree dispatches this frame's node _process, and the export asserts it: both grid rotaters are still at zero rotation and all %d lights still carry their constructed energy 5.0 and are visible, which a dispatched _process could not leave intact" % EXPECTED_LIGHT_CELLS,
		},
		{
			"kind": "floatTextEncoding",
			"what": "reals are serialised as \"%.17f\" strings rather than JSON numbers",
			"why": "Godot's JSON writer formats floats with about 6 significant digits, which would silently truncate the values this fixture exists to freeze",
		},
	]


func _not_claimed() -> Array:
	return [
		"No cross-engine equivalence: this fixture is what the pinned Godot source builds, not a claim that any ThreeNative or plain-Three arm reproduces it. No arm has been compared to it yet.",
		"No speed, FPS, frame time or GPU result of any kind. Nothing here was rendered: Godot ran headless with the dummy renderer, so the recorded values are scene construction only.",
		"No completeness claim for the family. Only benchmark_box_1000 is exported here; the source's other 13 variants (sphere, omni, spot 10/100, speed slow/fast, stress) are not in this fixture.",
		"No baked animation: no post-frame transform, energy or visibility is recorded, so a timed arm still has to do the rotation and pulse work.",
		"shadow_enabled, light_cull_mask, distance_fade_enabled and the Environment effect switches are the values the engine constructed, not inferences about the source's intent.",
	]


# --- helpers -------------------------------------------------------------------------------------


func _xform(transform: Transform3D) -> Dictionary:
	return {"origin": _vec(transform.origin), "basis": {
		"x": _vec(transform.basis.x),
		"y": _vec(transform.basis.y),
		"z": _vec(transform.basis.z),
	}}


func _vec(value: Vector3) -> Array:
	return [_real(value.x), _real(value.y), _real(value.z)]


func _color(value: Color) -> Array:
	return [_real(value.r), _real(value.g), _real(value.b), _real(value.a)]


## A Vector3, Vector2, Color or float as an exact binary64 decimal string. Godot's `%` has no `%g`
## and its JSON writer keeps ~6 significant digits, so reals go out as `"%.17f"` (17 decimal places,
## which is at least 17 significant digits anywhere in this scene's range). The parse-back check
## here only proves the digits are a finite number: Godot's own `String::to_float` accumulates and
## can be a ULP off after 17 digits, so the exactness proof lives in the TypeScript fixture test,
## where `Number` is correctly rounded.
func _real(value: Variant) -> String:
	var number := float(value)
	if not is_finite(number):
		_fail("non-finite value %s in the scene" % str(value))
		return "NaN"
	var text := "%.17f" % number
	if not is_finite(float(text)):
		_fail("value %s does not read back as a finite number from \"%s\"" % [str(number), text])
		return "NaN"
	return text


## Reads a declared list of properties, failing closed if the engine has no such property, and
## serialising Vector3/Color/float/int values in the fixture's encodings.
func _properties(object: Object, names: Array) -> Dictionary:
	var available := {}
	for property in object.get_property_list():
		available[String(property.get("name", ""))] = true
	var out := {}
	for name in names:
		if not available.has(name):
			_fail("%s has no property %s; the exporter's declared property list is stale" % [object.get_class(), name])
			continue
		var value: Variant = object.get(name)
		if value is Vector2:
			out[name] = [_real(value.x), _real(value.y)]
		elif value is Vector3:
			out[name] = _vec(value)
		elif value is Color:
			out[name] = _color(value)
		elif value is float:
			out[name] = _real(value)
		elif value is bool:
			out[name] = value
		elif value is int:
			out[name] = value
		elif value == null:
			_fail("%s.%s read back as null" % [object.get_class(), name])
		else:
			_fail("%s.%s is an unsupported type (%s); the fixture schema does not carry it" % [object.get_class(), name, type_string(typeof(value))])
	return out


func _file_sha256(path: String) -> String:
	if not FileAccess.file_exists(path):
		_fail("the pinned source file %s is missing from the Godot project" % path)
		return ""
	return FileAccess.get_sha256(path)


func _fail(message: String) -> void:
	_errors.append(message)


func _report() -> void:
	if _errors.size() == 0:
		quit(0)
		return
	for message in _errors:
		printerr("FIXTURE_EXPORT_FAILED: %s" % message)
	quit(1)
