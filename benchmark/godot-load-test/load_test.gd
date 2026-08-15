# PRD-117 Godot control arm. A line-for-line port of
# `examples/engine-load-test/src/workload.ts` plus `game.ts`; the two are held together by
# `position_hash`, which the scorer's equivalence gate compares before publishing any comparison.
extends Node3D

const LCG_SEED := 1337
const CUBE_SPACING := 2.5
const VIEWPORT_WIDTH := 1280
const VIEWPORT_HEIGHT := 720

var _lcg_state: int = LCG_SEED

var _frames: int = 600
var _warmup: int = 120
var _repeats: int = 3
var _ladder: Array[int] = [256, 1024, 4096, 16384]
var _modes: Array[String] = ["L1", "L2"]
var _refresh_hz: int = 60

var _material: StandardMaterial3D
var _cube_mesh: BoxMesh
var _cubes: Array[MeshInstance3D] = []
var _multimesh_instance: MultiMeshInstance3D = null
var _placements: PackedVector3Array = PackedVector3Array()
var _camera: Camera3D

var _plan: Array = []
var _plan_index: int = 0
var _frame_index: int = 0
var _mode: String = "L1"
var _object_count: int = 0
var _repeat: int = 0
var _samples: PackedFloat64Array = PackedFloat64Array()
var _draw_calls: int = 0
var _triangles: int = 0
var _visible_objects: int = 0
var _last_usec: int = 0
var _rungs: Array = []
var _finished := false


func _lcg_reset() -> void:
	_lcg_state = LCG_SEED


# state = (state * 1664525 + 1013904223) mod 2^32 — PRD-117 §3.3, verbatim.
func _lcg_next() -> float:
	_lcg_state = (_lcg_state * 1664525 + 1013904223) % 4294967296
	return float(_lcg_state) / 4294967296.0


func _lattice_side(object_count: int) -> int:
	return maxi(1, int(ceil(sqrt(float(object_count)))))


func _lattice_extent(object_count: int) -> float:
	return float(_lattice_side(object_count)) * CUBE_SPACING


func _create_placements(object_count: int) -> PackedVector3Array:
	_lcg_reset()
	var side := _lattice_side(object_count)
	var half := float(side - 1) / 2.0
	var out := PackedVector3Array()
	out.resize(object_count)
	for index in object_count:
		var grid_x := index % side
		var grid_z := index / side
		var jitter_x := _lcg_next()
		var jitter_z := _lcg_next()
		var jitter_y := _lcg_next()
		out[index] = Vector3(
			(float(grid_x) - half) * CUBE_SPACING + (jitter_x - 0.5) * CUBE_SPACING * 0.6,
			0.5 + jitter_y * 3.0,
			(float(grid_z) - half) * CUBE_SPACING + (jitter_z - 0.5) * CUBE_SPACING * 0.6
		)
	return out


# Quantised to millimetres before hashing, and kept to 32 bits throughout, so the integers agree
# with the TypeScript arm exactly rather than agreeing on how each language prints a float.
func _position_hash(placements: PackedVector3Array) -> String:
	var parts: Array[String] = []
	for index in mini(8, placements.size()):
		var placement := placements[index]
		parts.append(
			"%d,%d,%d" % [
				int(round(placement.x * 1000.0)),
				int(round(placement.y * 1000.0)),
				int(round(placement.z * 1000.0))
			]
		)
	var text := "|".join(parts)
	var value := 2166136261
	for index in text.length():
		value = (value ^ text.unicode_at(index)) & 0xFFFFFFFF
		value = (value * 16777619) & 0xFFFFFFFF
	return "%08x" % value


func _camera_pose(frame_index: int, object_count: int) -> Array:
	var extent := _lattice_extent(object_count)
	var angle := float(frame_index) * 0.0045
	var radius := extent * 0.34
	var position := Vector3(cos(angle) * radius, extent * 0.09 + 4.0, sin(angle) * radius)
	var target := Vector3(
		cos(angle + PI) * extent * 0.12, 1.5, sin(angle + PI) * extent * 0.12
	)
	return [position, target]


func _cube_rotation_x(index: int, frame_index: int) -> float:
	return float(index) * 0.011 + float(frame_index) * 0.013


func _cube_rotation_y(index: int, frame_index: int) -> float:
	return float(index) * 0.017 + float(frame_index) * 0.02


func _cube_bob_y(index: int, frame_index: int, base_y: float) -> float:
	return base_y + sin(float(frame_index) * 0.05 + float(index) * 0.3) * 0.5


func _read_query() -> Dictionary:
	var query := {}
	var search := ""
	if OS.has_feature("web"):
		search = str(JavaScriptBridge.eval("window.location.search", true))
	else:
		for argument in OS.get_cmdline_user_args():
			if argument.begins_with("--query="):
				search = argument.substr(8)
	if search.begins_with("?"):
		search = search.substr(1)
	for pair in search.split("&", false):
		var halves := pair.split("=", true, 1)
		if halves.size() == 2:
			query[halves[0]] = halves[1]
	return query


func _ready() -> void:
	Engine.max_fps = 0
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)

	var query := _read_query()
	if query.has("frames"):
		_frames = int(query["frames"])
	if query.has("warmup"):
		_warmup = int(query["warmup"])
	if query.has("repeats"):
		_repeats = int(query["repeats"])
	if query.has("refreshHz"):
		_refresh_hz = int(query["refreshHz"])
	if query.has("ladder"):
		_ladder = []
		for part in str(query["ladder"]).split(",", false):
			_ladder.append(int(part))
	if query.has("modes"):
		_modes = []
		for part in str(query["modes"]).split(",", false):
			_modes.append(str(part))

	# One shared lit material for ground and cubes, one directional light, no shadows (§3.1).
	_material = StandardMaterial3D.new()
	_material.albedo_color = Color(0.722, 0.769, 0.800)
	_material.roughness = 0.75
	_material.metallic = 0.0
	_cube_mesh = BoxMesh.new()
	_cube_mesh.size = Vector3.ONE

	var ground := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(200, 200)
	ground.mesh = plane
	ground.material_override = _material
	add_child(ground)

	var light := DirectionalLight3D.new()
	light.light_energy = 2.4
	light.shadow_enabled = false
	light.look_at_from_position(Vector3(40, 80, 25), Vector3.ZERO, Vector3.UP)
	add_child(light)

	_camera = Camera3D.new()
	_camera.fov = 60.0
	_camera.near = 0.1
	_camera.far = 4000.0
	_camera.current = true
	add_child(_camera)

	for object_count in _ladder:
		for mode in _modes:
			for repeat in _repeats:
				_plan.append({"count": object_count, "mode": mode, "repeat": repeat})
	_begin_rung()


func _clear_rung() -> void:
	for cube in _cubes:
		remove_child(cube)
		cube.queue_free()
	_cubes.clear()
	if _multimesh_instance != null:
		remove_child(_multimesh_instance)
		_multimesh_instance.queue_free()
		_multimesh_instance = null


func _begin_rung() -> void:
	_clear_rung()
	var entry: Dictionary = _plan[_plan_index]
	_mode = str(entry["mode"])
	_object_count = int(entry["count"])
	_repeat = int(entry["repeat"])
	_placements = _create_placements(_object_count)
	_frame_index = 0
	_samples = PackedFloat64Array()
	_draw_calls = 0
	_triangles = 0
	_visible_objects = 0

	if _mode == "L1":
		for index in _object_count:
			var cube := MeshInstance3D.new()
			cube.mesh = _cube_mesh
			cube.material_override = _material
			cube.position = _placements[index]
			add_child(cube)
			_cubes.append(cube)
	elif _object_count > 0:
		var multimesh := MultiMesh.new()
		multimesh.transform_format = MultiMesh.TRANSFORM_3D
		multimesh.mesh = _cube_mesh
		multimesh.instance_count = _object_count
		_multimesh_instance = MultiMeshInstance3D.new()
		_multimesh_instance.multimesh = multimesh
		_multimesh_instance.material_override = _material
		# The batch is one cull unit on both engines; a derived bounding volume would make the
		# cull, not the batch, the thing being measured.
		var span := _lattice_extent(_object_count)
		_multimesh_instance.custom_aabb = AABB(
			Vector3(-span, -span, -span), Vector3(span * 2.0, span * 2.0, span * 2.0)
		)
		add_child(_multimesh_instance)
	_last_usec = Time.get_ticks_usec()


func _step(frame_index: int) -> void:
	var pose := _camera_pose(frame_index, _object_count)
	_camera.position = pose[0]
	_camera.look_at(pose[1], Vector3.UP)
	# 100% dirty transforms every frame — the honest worst case a game with moving actors pays.
	if _mode == "L1":
		for index in _cubes.size():
			var placement := _placements[index]
			var basis := Basis.from_euler(
				Vector3(_cube_rotation_x(index, frame_index), _cube_rotation_y(index, frame_index), 0.0)
			)
			_cubes[index].transform = Transform3D(
				basis,
				Vector3(placement.x, _cube_bob_y(index, frame_index, placement.y), placement.z)
			)
		return
	if _multimesh_instance == null:
		return
	var multimesh := _multimesh_instance.multimesh
	for index in _placements.size():
		var placement := _placements[index]
		var basis := Basis.from_euler(
			Vector3(_cube_rotation_x(index, frame_index), _cube_rotation_y(index, frame_index), 0.0)
		)
		multimesh.set_instance_transform(
			index,
			Transform3D(
				basis,
				Vector3(placement.x, _cube_bob_y(index, frame_index, placement.y), placement.z)
			)
		)


func _process(_delta: float) -> void:
	if _finished:
		return
	var now := Time.get_ticks_usec()
	var interval_ms := float(now - _last_usec) / 1000.0
	_last_usec = now

	if _frame_index > 0 and _frame_index > _warmup:
		_samples.append(snappedf(interval_ms, 0.001))
		# `_process` reports the frame that just ended, so the sample lands one call later than
		# the TypeScript arm's mid-run index in order to describe the same frame.
		if _frame_index == (_frames + _warmup) / 2 + 1:
			_draw_calls = int(
				RenderingServer.get_rendering_info(
					RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME
				)
			)
			_triangles = int(
				RenderingServer.get_rendering_info(
					RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME
				)
			)
			_visible_objects = int(
				RenderingServer.get_rendering_info(
					RenderingServer.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME
				)
			)

	if _frame_index >= _frames:
		_finish_rung()
		return
	_step(_frame_index)
	_frame_index += 1


func _finish_rung() -> void:
	_rungs.append(
		{
			"drawCalls": _draw_calls,
			"frameMs": Array(_samples),
			"mode": _mode,
			"objectCount": _object_count,
			"positionHash": _position_hash(_placements),
			"repeat": _repeat,
			"triangles": _triangles,
			"visibleObjects": _visible_objects,
		}
	)
	_plan_index += 1
	if _plan_index >= _plan.size():
		_emit_report()
		return
	_begin_rung()


# The arm is read from the running platform, never passed in: a desktop binary labelled as the
# phone arm would be published as device evidence.
func _arm_name() -> String:
	if OS.has_feature("web"):
		return "godot-web"
	if OS.get_name() == "Android":
		return "godot-android"
	return "godot-desktop"


func _emit_report() -> void:
	_finished = true
	_clear_rung()
	var version: Dictionary = Engine.get_version_info()
	var report := {
		"arm": _arm_name(),
		"build": {
			"notes": "godot export, rendering method read from the engine at runtime",
			"type": "debug" if OS.is_debug_build() else "release",
		},
		"device": {"battery": null, "label": OS.get_name() + " " + OS.get_model_name()},
		"display": {
			"height": VIEWPORT_HEIGHT,
			"refreshHz": _refresh_hz,
			"vsync": false,
			"width": VIEWPORT_WIDTH,
		},
		"driver": {
			"adapter": (
				RenderingServer.get_video_adapter_name()
				+ " / "
				+ RenderingServer.get_video_adapter_api_version()
			),
			"renderer": (
				RenderingServer.get_current_rendering_method()
				+ " / "
				+ RenderingServer.get_current_rendering_driver_name()
			),
		},
		"engine": {"name": "godot", "version": str(version["string"])},
		"rungs": _rungs,
	}
	var payload := JSON.stringify(report)
	if OS.has_feature("web"):
		JavaScriptBridge.eval(
			"window.__ENGINE_LOAD_TEST__ = JSON.parse(" + JSON.stringify(payload) + ");", true
		)
	else:
		# Android's logcat truncates a line at ~1 KB, so the payload goes out in chunks the
		# collector rejoins. A single print looks fine on desktop and silently loses the phone run.
		print("ENGINE_LOAD_TEST_JSON_BEGIN")
		var offset := 0
		while offset < payload.length():
			print("TNJSON:", payload.substr(offset, 800))
			offset += 800
		print("ENGINE_LOAD_TEST_JSON_END")
		get_tree().quit()
