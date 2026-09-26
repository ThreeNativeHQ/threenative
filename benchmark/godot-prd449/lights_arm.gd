# Real-GPU timed arm for the pinned godot-benchmarks `lights_and_meshes.gd` family (PRD-449 Phase 4).
#
# Run WITHOUT `--headless`, so the Forward+ renderer uses the machine's GPU:
#   godot --path <pinned checkout> --resolution 1920x1080 --script <this file> -- \
#     --frames=600 --warmup=120 --fixture=<out.json> --captures=<dir>
#
# The cell is the composition of the pinned source's own named axes — box mesh, 100 objects, omni
# lights, 10 requested lights, `speed=1.0` — and it is built by calling the pinned `create_scene` with
# those settings. This arm never re-implements the workload: the upstream method authors the nodes,
# draws the RNG, builds the two grid hierarchies and owns the `Rotater`/`Lighter` update behaviour;
# this arm only stops the engine from stepping them, drives them at a fixed 1/60 s, measures and
# reports. `benchmark_box_100` is not this cell — it keeps the default spot light — so the arm calls
# `create_scene` directly rather than naming a `benchmark_*` function it is not.
#
# `create_scattered(count)` makes `round(sqrt(count))^2` nodes, so the requested 100 objects are 100
# and the requested 10 lights are nine. Both numbers are recorded as requested *and* actual.
#
# Every upstream source file is SHA-256 verified before the scene is built, so a number can name the
# bytes that produced it. Effective lighting is observed as pixels — the changed-sample count between
# a baseline frame and one rendered with the nine omni lights hidden — and never asserted from a flag
# the arm set itself.
extends SceneTree

const SOURCE_SHA256 := {
	"benchmarks/rendering/lights_and_meshes.gd": "2b1b4088876a6fac0332a14b27d004634360786c7746133360ba35cf9f003a6c",
	"manager.gd": "c4bae1efea609a3f9f8ccf04dbeb69efe193e0faff09e2b301b8c966099dd535",
	"benchmark.gd": "ce20298bb7afd66cb3c42fea0320bac589cfeaf1bbce637a600de2ae1cd486b6",
	"project.godot": "e942995c87024bfdc22c5fd9b599d4c8e4b653d2ab05f23787f74c16b197afb7",
}
const SOURCE_COMMIT := "b059e38a81230a87293828bbf65ab247b6b2d2a8"
const SOURCE_FILE := "benchmarks/rendering/lights_and_meshes.gd"
const CELL := "box-100-omni-10-slow"
# The same four-channel byte layout `threenative-cull-mesh-buffer/1` already versions: the version
# line, the primitive's class name, the vertex and index counts as two little-endian u32, then
# positions, normals, UVs and indices. Reused rather than forked, so one layout has one identity.
const MESH_BUFFER_VERSION := "threenative-cull-mesh-buffer/1"
const FIXTURE_SCHEMA := 1
const VIEWPORT := Vector2i(1920, 1080)
const FRAME_DELTA := 1.0 / 60.0
const STATE_FRAMES := [0, 1, 60, 120, 300, 599]
const MESH_PROBES := [0, 49, 99]
const LIGHT_PROBES := [0, 4, 8]
const GRID_COLUMNS := 24
const GRID_ROWS := 15
# The pinned Manager seeds its global RNG to this exact value before every test, and the whole fixture
# — the 100 mesh-cell placements, the nine light-cell placements and each `Lighter`'s opening `accum` —
# is one draw from that stream.
const RNG_SEED := 0x60d07
# The cell's requested axes, from the pinned `create_scene` signature's own defaults plus this cell's
# one change of light type. `objects=100` stays 100 and `lights=10` becomes nine nodes.
const REQUESTED_OBJECTS := 100
const REQUESTED_LIGHTS := 10
const SPEED := 1.0
const ENERGY_SCALE := 5.0

var _args := {}
var _scene: Node3D
var _benchmark: Benchmark
var _mesh_rotater: Node3D
var _light_rotater: Node3D
var _mesh_cells: Array = []
var _light_cells: Array = []
var _lighters: Array = []
var _omni: Array = []
var _accum_seeds: Array = []
var _frame := -1
var _boundary_us: Array[int] = []
var _drain_boundary_us := 0
var _final_completion_us := 0
var _warmup_us := 0
var _wall_ms: Array[float] = []
var _render_cpu_ms: Array[float] = []
var _render_gpu_ms: Array[float] = []
var _visible_objects: Array = []
var _work_at_mid := {}
var _captures: Array = []
var _states: Array = []
var _capture_frames: Array[int] = []
var _latest_image: Image = null
var _previous_image: Image = null
var _effective := {}
var _census := {}


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--"):
			var parts := argument.substr(2).split("=", true, 1)
			_args[parts[0]] = parts[1] if parts.size() == 2 else "true"
	for file in SOURCE_SHA256:
		if FileAccess.get_sha256("res://" + file) != SOURCE_SHA256[file]:
			fail("TN_BENCH_GODOT_SOURCE_HASH_MISMATCH", file)
			return
	var viewport_size := root.get_visible_rect().size
	if viewport_size != Vector2(VIEWPORT):
		# The two arms must render the same size for the shared 240x135 sample lattice to describe the
		# same pixels, whatever the upstream source does or does not derive from the viewport.
		fail("TN_BENCH_GODOT_VIEWPORT_MISMATCH", str(viewport_size))
		return
	var frames := int(_args.get("frames", 600))
	var warmup := int(_args.get("warmup", 120))
	if frames < 1 or warmup < 0:
		fail("TN_BENCH_BAD_PARAM", "frames must be >= 1 and warmup >= 0")
		return
	RenderingServer.viewport_set_measure_render_time(root.get_viewport_rid(), true)

	seed(RNG_SEED)
	# The window's World3D does not exist until a frame has been presented, so a scene added before
	# the first frame is handed a null scenario and renders outside the project this family measures.
	await process_frame
	_benchmark = load("res://" + SOURCE_FILE).new()
	# Upstream's own `create_scene`, called with this cell's axes. The `mesh` and `create_light`
	# arguments are upstream's own member and method, not copies of them.
	_scene = _benchmark.call("create_scene", {
		"mesh": _benchmark.box_mesh,
		"objects": REQUESTED_OBJECTS,
		"create_light": _benchmark.create_omni_light,
		"lights": REQUESTED_LIGHTS,
		"speed": SPEED,
	})
	if _scene == null:
		fail("TN_BENCH_GODOT_SCENE_MISSING", "the pinned create_scene returned no scene")
		return
	_mesh_rotater = _scene.get_child(1)
	_light_rotater = _scene.get_child(2)
	_mesh_cells = _mesh_rotater.get_child(0).get_children()
	_light_cells = _light_rotater.get_child(0).get_children()
	for cell in _light_cells:
		var lighter: Node3D = cell.get_child(0)
		_lighters.append(lighter)
		_omni.append(lighter.light)
		# Read before any `_process` touches them: these are the pinned `randf() * 100` draws, and the
		# counterpart's oracle needs them to place each light's energy at the same frame.
		_accum_seeds.append(lighter.accum)
	root.add_child(_scene)
	# The engine must not also step the workload: the deterministic-throughput protocol advances it a
	# fixed 1/60 s per rendered frame, so the delta is ours, not the wall clock's. `Rotater` and
	# `Lighter` are the only nodes with `_process`, and both are switched to `PROCESS_MODE_DISABLED`
	# once they are in the tree — the tree is what owns process scheduling, and this survives being
	# added. `set_process(false)` before `add_child` did not: a 2-frame run then measured 5.4 rotations
	# and 1.064 light accums per frame instead of one, and the counterpart's oracle would have been
	# checking a workload state neither arm rendered. `_quiescent()` then proves it rather than
	# assuming it.
	for node in _process_nodes():
		node.process_mode = Node.PROCESS_MODE_DISABLED
	await process_frame
	if not await _quiescent():
		fail("TN_BENCH_GODOT_LIGHTS_WORKLOAD_NOT_QUIESCENT", "the engine advanced the workload itself")
		return
	if not _check_census():
		return
	_census = {
		"requestedObjects": REQUESTED_OBJECTS,
		"requestedLights": REQUESTED_LIGHTS,
		"actualMeshInstances": _scene.find_children("*", "MeshInstance3D", true, false).size(),
		"actualOmniLights": _omni.size(),
		"actualSpotLights": _scene.find_children("*", "SpotLight3D", true, false).size(),
		"meshGridSide": int(round(sqrt(float(REQUESTED_OBJECTS)))),
		"lightGridSide": int(round(sqrt(float(REQUESTED_LIGHTS)))),
		"meshRotaterSpeed": _mesh_rotater.speed,
		"lightRotaterSpeed": _light_rotater.speed,
	}
	var topology := _describe_mesh()
	if topology.is_empty():
		return
	var environment := _describe_environment()
	if environment.is_empty():
		return
	var fixture_path: String = _args.get("fixture", "")
	var fixture_hash := ""
	if not fixture_path.is_empty():
		fixture_hash = _export_fixture(fixture_path, topology, environment)
		if fixture_hash.is_empty():
			return
	var captures_dir: String = _args.get("captures", "")
	if not captures_dir.is_empty():
		DirAccess.make_dir_recursive_absolute(captures_dir)
	await _measure(frames, warmup, captures_dir)
	_effective = await _effective_lighting(captures_dir)

	_emit({
		"arm": "godot-desktop",
		"family": "godot-lights-meshes",
		"cell": CELL,
		"authoring": "scene-node-meshinstance3d",
		"authoringNote": "upstream lights_and_meshes.gd authors one Node3D per grid cell with a MeshInstance3D or an OmniLight3D under it, so unlike the culling family this is each engine's ordinary scene-node API",
		"fixture": {
			"hash": fixture_hash,
			"path": fixture_path,
			"schemaVersion": FIXTURE_SCHEMA,
			"rngSeed": RNG_SEED,
			"viewport": {"width": VIEWPORT.x, "height": VIEWPORT.y},
		},
		"census": _census,
		"mesh": _identity_only(topology)[0],
		"lights": _describe_lights(),
		"environment": environment,
		"updateSchedule": _describe_schedule(),
		"effective": _effective,
		"motion": {"observed": _capture_motion() >= 0, "changedSampledPixels": _capture_motion()},
		"states": _states,
		"samples": {"wallMs": _wall_ms, "renderCpuMs": _render_cpu_ms, "renderGpuMs": _render_gpu_ms},
		"frameIntervalMs": _intervals(),
		"frameP50Ms": _summary(_wall_ms)["p50"],
		"frameP95Ms": _summary(_wall_ms)["p95"],
		"frameP99Ms": _summary(_wall_ms)["p99"],
		"meanMs": _completed_work_mean(),
		"renderCpuMeanMs": _mean(_render_cpu_ms),
		"renderGpuMeanMs": _mean(_render_gpu_ms),
		"work": _work_at_mid,
		"visibleObjectsInFrame": _visible_objects,
		"frames": frames,
		# The mean above spans the first scored boundary to the end of the one final `force_sync()`,
		# which is the same completed-work definition §7.4 requires and the counterpart arm reports.
		"drain": "measurement-boundary-completion",
		"drainBoundaryFrame": frames,
		"drainFinalWaitMs": float(_final_completion_us - _drain_boundary_us) / 1000.0,
		"warmupFrames": warmup,
		"warmupMs": float(_warmup_us) / 1000.0,
		"captures": _captures,
		"adapter": _adapter(),
		"engine": {
			"version": "%d.%d.%d.%s" % [
				Engine.get_version_info().major,
				Engine.get_version_info().minor,
				Engine.get_version_info().patch,
				Engine.get_version_info().status,
			],
			"versionHash": Engine.get_version_info().hash,
		},
		"source": {"commit": SOURCE_COMMIT, "sha256": SOURCE_SHA256[SOURCE_FILE]},
		"profile": "smoke",
	})
	# Fail closed on what the arm claims, so a record that reached the collector already said yes.
	var problems := _rejections()
	if not problems.is_empty():
		for problem in problems:
			push_error("TN_BENCH_GODOT_LIGHTS_REJECTED: " + problem)
		quit(2)
		return
	quit(0)


## Fail closed on a workload that is not the one the cell names, before a single frame is compared.
func _check_census() -> bool:
	var meshes := _scene.find_children("*", "MeshInstance3D", true, false).size()
	var spots := _scene.find_children("*", "SpotLight3D", true, false).size()
	var expected_meshes := int(round(sqrt(float(REQUESTED_OBJECTS)))) ** 2
	var expected_lights := int(round(sqrt(float(REQUESTED_LIGHTS)))) ** 2
	if meshes != expected_meshes or _mesh_cells.size() != expected_meshes:
		fail("TN_BENCH_GODOT_LIGHTS_MESH_CENSUS_MISMATCH", "%d/%d" % [meshes, expected_meshes])
		return false
	if _omni.size() != expected_lights or _lighters.size() != expected_lights or spots != 0:
		fail("TN_BENCH_GODOT_LIGHTS_LIGHT_CENSUS_MISMATCH", "%d omni, %d spot" % [_omni.size(), spots])
		return false
	# The two grids rotate in opposite directions so light-to-mesh pairings change over time; a
	# same-direction pair would measure a different scene under the same name.
	if (
		not is_equal_approx(_mesh_rotater.speed, -0.1 * SPEED)
		or not is_equal_approx(_light_rotater.speed, 0.1 * SPEED)
	):
		fail("TN_BENCH_GODOT_LIGHTS_ROTATION_SCHEDULE_MISMATCH", "%f/%f" % [_mesh_rotater.speed, _light_rotater.speed])
		return false
	return true


func _process_nodes() -> Array:
	var out := []
	for node in _scene.find_children("*", "Node3D", true, false):
		if node.has_method("_process"):
			out.append(node)
	return out


## Whether the workload is standing still with nothing driving it, which is what "the arm owns the
## clock" has to mean. Read across one presented frame with no `_advance`, so an engine step of any
## size shows up as a moved rotation or a moved `accum`.
func _quiescent() -> bool:
	var before := _workload_signature()
	for _index in 3:
		await process_frame
	return _workload_signature() == before


func _workload_signature() -> String:
	return "%f|%f|%s" % [
		_mesh_rotater.rotation.y,
		_light_rotater.rotation.y,
		str(_lighters.map(func(lighter: Node3D) -> float: return lighter.accum)),
	]


func _measure(frames: int, warmup: int, captures_dir: String) -> void:
	var state_frames := STATE_FRAMES.duplicate()
	state_frames.append(frames - 1)
	# Captures belong to the untimed warmup, whose scene state at frame k is identical to the scored
	# frame k because the workload is deterministic and restarts from the same state.
	if not captures_dir.is_empty():
		for candidate in [0, 1, 60, 119, 300, 599]:
			if candidate < warmup:
				_capture_frames.append(candidate)
	_warmup_us = Time.get_ticks_usec()
	_restore_initial_state()
	for index in warmup:
		_advance()
		await process_frame
		if _capture_frames.has(index):
			await _capture(captures_dir, index, "frame", true)
	# The pinned `_process(delta)` methods take their advance as an argument and keep no clock of their
	# own, so the scored interval must restart from a declared initial state rather than from whatever
	# the warmup left: the rotations and every `accum` are put back, and the warmup's frames are
	# replayed from the same start. That is what makes captured warmup frame k the same workload state
	# as scored frame k, which is the contract the counterpart arm also keeps.
	_restore_initial_state()
	await process_frame
	_boundary_us.append(Time.get_ticks_usec())
	for frame in frames:
		_advance()
		await process_frame
		_boundary_us.append(Time.get_ticks_usec())
		_wall_ms.append(float(_boundary_us[frame + 1] - _boundary_us[frame]) / 1000.0)
		# Godot reports the CPU and GPU time of the frame it has just finished, which is why the read
		# follows the frame instead of preceding it.
		_render_cpu_ms.append(
			RenderingServer.viewport_get_measured_render_time_cpu(root.get_viewport_rid())
			+ RenderingServer.get_frame_setup_time_cpu()
		)
		_render_gpu_ms.append(
			RenderingServer.viewport_get_measured_render_time_gpu(root.get_viewport_rid())
		)
		var visible: int = Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)
		_visible_objects.append(visible)
		if frame == int(frames / 2):
			_work_at_mid = {
				"frameId": frame,
				"drawCalls": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
				"primitives": Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
				"objectsInFrame": visible,
				"lightsVisible": _lights_visible(),
				"videoMemUsed": Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED),
			}
		if state_frames.has(frame):
			_states.append(_sample_state(frame))
	# One synchronisation, at the one boundary the primary metric is defined at: after the scored
	# workload, not per frame. `force_sync()` is Godot's documented "synchronize the CPU and the GPU,
	# blocking the CPU until the GPU is done", so the wait it costs is the asynchronous tail of the
	# last frames, and it belongs in the completed-work mean exactly as the counterpart's
	# `onSubmittedWorkDone` before `finalCompletionMs` belongs in that arm's mean. Per-frame fences
	# would serialize submission and completion and measure neither engine's pipeline.
	_drain_boundary_us = Time.get_ticks_usec()
	RenderingServer.force_sync()
	_final_completion_us = Time.get_ticks_usec()


## One rendered frame of the pinned workload: the two grid `Rotater`s and the nine `Lighter`s, each
## called with the same fixed delta the engine would have passed.
func _advance() -> void:
	_frame += 1
	_mesh_rotater._process(FRAME_DELTA)
	_light_rotater._process(FRAME_DELTA)
	for lighter in _lighters:
		lighter._process(FRAME_DELTA)


## The state the pinned source builds before any `_process`: zero rotations and every `accum` at the
## value its `randf() * 100` draw produced. `Lighter._init` sets no visibility, so the lights start at
## the `create_omni_light` opening energy and the first `_process` is what first toggles one.
func _restore_initial_state() -> void:
	_frame = -1
	_mesh_rotater.rotation.y = 0.0
	_light_rotater.rotation.y = 0.0
	for index in _lighters.size():
		_restore_light(index)


## Exactly what `Lighter._process` does at the current `accum`: the flag from the sine, and the energy
## only while the light is on — the pinned source never writes an energy to a light it has hidden.
func _restore_light(index: int) -> void:
	var lighter: Node3D = _lighters[index]
	# The accum is the workload clock, so it is the one member that has to be put back by hand: a
	# restore that reset the rotations and the light flags but left the accums accumulating is what
	# made the first counterpart run see frame 0 three advances in on the lights and one on the grids.
	lighter.accum = float(_accum_seeds[index])
	var light: Light3D = _omni[index]
	var energy := sin(lighter.accum) * ENERGY_SCALE
	light.visible = energy > 0.0
	if light.visible:
		light.light_energy = energy


## The workload state the pinned source has produced at this frame, so the counterpart arm's
## independently computed value has something to be checked against: the two grid rotations, each
## sampled mesh's and light's world transform, and the light energy and visibility the `Lighter` set.
func _sample_state(frame: int) -> Dictionary:
	var mesh_probes := []
	for index in MESH_PROBES:
		if index >= _mesh_cells.size():
			continue
		# The rendered `MeshInstance3D`, not the grid cell above it: the probe is the object the
		# renderer submits, so the counterpart arm samples the same node in its own graph.
		var model := (_mesh_cells[index] as Node3D).get_child(0) as Node3D
		var xf := model.global_transform
		mesh_probes.append({
			"index": index,
			"origin": _f3(xf.origin),
			"axisX": _f3(xf.basis.x),
		})
	var light_probes := []
	for index in LIGHT_PROBES:
		if index >= _lighters.size():
			continue
		var light: OmniLight3D = _omni[index]
		var xf := light.global_transform
		light_probes.append({
			"index": index,
			"origin": _f3(xf.origin),
			"axisX": _f3(xf.basis.x),
			"accum": (_lighters[index] as Node3D).accum,
			"energy": light.light_energy,
			"visible": light.visible,
		})
	return {
		"frameId": frame,
		# Advances applied, not the loop counter: frame 0 is one advance in, because the pinned source
		# advances before it renders and the counterpart arm has to place the same workload state.
		"elapsedFrames": _frame + 1,
		"meshRotationY": _mesh_rotater.rotation.y,
		"lightRotationY": _light_rotater.rotation.y,
		"lightsVisible": _lights_visible(),
		"meshProbes": mesh_probes,
		"lightProbes": light_probes,
		"objectsInFrame": _visible_objects[frame] if frame < _visible_objects.size() else -1,
	}


func _lights_visible() -> int:
	var visible := 0
	for light in _omni:
		if (light as Light3D).visible:
			visible += 1
	return visible


func _describe_mesh() -> Array:
	var primitive: PrimitiveMesh = _benchmark.box_mesh
	# `get_mesh_arrays()` is one surface's channels indexed by `Mesh.ARRAY_*`, not a list of surfaces.
	var arrays: Array = primitive.get_mesh_arrays()
	var kind: String = primitive.get_class()
	var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
	var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV]
	var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	# The counterpart arm builds its geometry from these bytes, so a primitive it cannot decode is a
	# fixture it cannot render rather than a silently regenerated box.
	if vertices.is_empty() or normals.size() != vertices.size() or uvs.size() != vertices.size():
		fail("TN_BENCH_GODOT_MESH_CHANNELS_INCOMPLETE", kind)
		return []
	if indices.is_empty() or indices.size() % 3 != 0:
		fail("TN_BENCH_GODOT_MESH_INDICES_MALFORMED", kind)
		return []
	var aabb: AABB = primitive.get_aabb()
	return [{
		"kind": kind,
		"surfaces": RenderingServer.mesh_get_surface_count(primitive.get_rid()),
		"vertices": vertices.size(),
		"indices": indices.size(),
		"triangles": indices.size() / 3,
		"indexed": true,
		"aabb": {"min": _f3(aabb.position), "size": _f3(aabb.size)},
		"bufferSha256": _sha256(_mesh_buffer_bytes(kind, vertices, normals, uvs, indices)),
		"buffers": {
			"positions": Marshalls.raw_to_base64(vertices.to_byte_array()),
			"normals": Marshalls.raw_to_base64(normals.to_byte_array()),
			"uvs": Marshalls.raw_to_base64(uvs.to_byte_array()),
			"indices": Marshalls.raw_to_base64(indices.to_byte_array()),
		},
	}]


## The one byte stream a primitive's identity is a SHA-256 over, byte-for-byte the layout
## `cullMeshBufferBytes` writes on the counterpart side.
func _mesh_buffer_bytes(
	kind: String,
	vertices: PackedVector3Array,
	normals: PackedVector3Array,
	uvs: PackedVector2Array,
	indices: PackedInt32Array
) -> PackedByteArray:
	var bytes := PackedByteArray()
	bytes.append_array((MESH_BUFFER_VERSION + "\n").to_utf8_buffer())
	bytes.append_array((kind + "\n").to_utf8_buffer())
	bytes.append_array(PackedInt32Array([vertices.size(), indices.size()]).to_byte_array())
	bytes.append_array(vertices.to_byte_array())
	bytes.append_array(normals.to_byte_array())
	bytes.append_array(uvs.to_byte_array())
	bytes.append_array(indices.to_byte_array())
	return bytes


## The record keeps each primitive's identity; the bytes themselves live once, in the fixture file the
## record already names by path and hash.
func _identity_only(topology: Array) -> Array:
	var out := []
	for entry in topology:
		var copy: Dictionary = (entry as Dictionary).duplicate(true)
		copy.erase("buffers")
		out.append(copy)
	return out


func _sha256(bytes: PackedByteArray) -> String:
	var context := HashingContext.new()
	context.start(HashingContext.HASH_SHA256)
	context.update(bytes)
	return context.finish().hex_encode()


## Every light parameter the counterpart needs to author the same light, read from the pinned source's
## own node rather than re-derived from a name. `omni_attenuation` maps onto three's punctual-light
## `decay` exponent and `omni_range` onto its `distance`, which are the same
## `pow(clamp(1 - d/range, 0, 1), k)` curve; the energy-to-intensity mapping is direct.
func _describe_lights() -> Dictionary:
	# Read the parameters off a *fresh* light from the pinned factory rather than off a live one: a
	# `Lighter` has already written this scene's energies by the time the record is built, so the live
	# node reports the last energy it was given, not the value `create_omni_light` authored.
	var light := _benchmark.call("create_omni_light") as OmniLight3D
	return {
		"kind": "omni",
		"requested": REQUESTED_LIGHTS,
		"actual": _omni.size(),
		"color": _rgb(light.light_color),
		"attenuation": light.omni_attenuation,
		"range": light.omni_range,
		"openingEnergy": light.light_energy,
		"lightSize": light.light_size,
		"shadowEnabled": light.shadow_enabled,
		"localPosition": _f3(light.position),
	}


## Read back, never assumed: the pinned source sets `background_mode` and `ambient_light_source` but
## leaves both colours at their defaults, and this cell's picture depends on the ambient colour being
## whatever those defaults are.
func _describe_environment() -> Dictionary:
	var world: WorldEnvironment = null
	for child in _scene.get_children():
		if child is WorldEnvironment:
			world = child
	if world == null:
		fail("TN_BENCH_GODOT_LIGHTS_ENVIRONMENT_MISSING", "no WorldEnvironment in the pinned scene")
		return {}
	var environment: Environment = world.environment
	return {
		"backgroundMode": "color" if environment.background_mode == Environment.BG_COLOR else "not-color",
		"backgroundColor": _rgb(environment.background_color),
		"ambientSource": str(environment.ambient_light_source),
		"ambientColor": _rgb(environment.ambient_light_color),
		"ambientEnergy": environment.ambient_light_energy,
		"tonemapWhite": environment.tonemap_white,
		"exposure": environment.tonemap_exposure,
		"defaultEnvironment": str(ProjectSettings.get_setting("rendering/environment/defaults/default_environment", "")),
	}


## The update schedule the fixture carries: the two rotater speeds, the speed the nine `Lighter`s use,
## and the fixed delta every rendered frame advances them by. The counterpart runs this same schedule,
## so its frame k is one workload state.
func _describe_schedule() -> Dictionary:
	var cell: Node3D = _mesh_cells[0]
	var model: Node3D = cell.get_child(0)
	return {
		"frameDelta": FRAME_DELTA,
		"rotaterSpeed": 0.1 * SPEED,
		"lightSpeed": SPEED,
		"energyScale": ENERGY_SCALE,
		# The two rotaters' own speeds, read from the nodes: the counterpart arm runs the same schedule,
		# so a same-direction pair here would be a different workload under this cell's name.
		"meshRotaterSpeed": _mesh_rotater.speed,
		"lightRotaterSpeed": _light_rotater.speed,
		"meshCellScale": _f3(cell.scale),
		"meshModelPosition": _f3(model.position),
		"meshModelScale": _f3(model.scale),
		"lightCellScale": _f3((_light_cells[0] as Node3D).scale),
		"advanceOrder": "advance-then-render",
	}


func _export_fixture(path: String, topology: Array, environment: Dictionary) -> String:
	var cam: Camera3D = _scene.get_child(0)
	var basis := cam.global_transform.basis
	var model: Node3D = (_mesh_cells[0] as Node3D).get_child(0)
	var fixture := {
		"schemaVersion": FIXTURE_SCHEMA,
		"generatedBy": "godot-desktop",
		"sourceCommit": SOURCE_COMMIT,
		"lightsAndMeshesSha256": SOURCE_SHA256[SOURCE_FILE],
		"rngSeed": RNG_SEED,
		"cell": CELL,
		"viewport": {"width": VIEWPORT.x, "height": VIEWPORT.y},
		# The camera's world basis travels as its three columns rather than as a look-at target, so the
		# counterpart orients an identical camera without re-deriving Godot's `rotate_x` convention.
		"camera": {
			"fovDegrees": cam.fov,
			"near": cam.near,
			"far": cam.far,
			"position": _f3(cam.global_transform.origin),
			"basisX": _f3(basis.x),
			"basisY": _f3(basis.y),
			"basisZ": _f3(basis.z),
		},
		"meshes": topology,
		"meshGrid": {
			"cells": _cell_transforms(_mesh_cells),
			"rotaterSpeed": _mesh_rotater.speed,
		},
		"lightGrid": {
			"cells": _cell_transforms(_light_cells),
			"rotaterSpeed": _light_rotater.speed,
			"accumSeeds": _accum_seeds,
		},
		"meshModel": {
			"position": _f3(model.position),
			"scale": _f3(model.scale),
		},
		"lights": _describe_lights(),
		"environment": environment,
		"schedule": _describe_schedule(),
	}
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		fail("TN_BENCH_GODOT_FIXTURE_UNWRITABLE", path)
		return ""
	# 17 significant digits round-trip an IEEE-754 binary64 exactly, so the exported transforms are the
	# values Godot used rather than a decimal approximation of them, and the file's own SHA-256 is the
	# identity both arms hash.
	file.store_string(JSON.stringify(fixture, "", true))
	file.close()
	return FileAccess.get_sha256(path)


## Each grid cell's authored local transform: the position and `2/s` x/z scale the pinned
## `create_scattered` produced, under the one rotater that moves them.
func _cell_transforms(cells: Array) -> Array:
	var out := []
	for cell in cells:
		var node: Node3D = cell
		out.append({"position": _f3(node.position), "scale": _f3(node.scale)})
	return out


## Effective lighting is observed as pixels, never asserted from a flag. A changed-sample count between
## the baseline frame and one rendered with the nine omni lights hidden is the evidence that they lit
## something; a mean-luma delta is too weak a detector on nine small-range lights. Untimed, after the
## measured frames, on the same scene and binaries.
func _effective_lighting(captures_dir: String) -> Dictionary:
	_effective = {
		"lightsAffectFrame": false,
		"lightsChangedSamples": 0,
		"latticeSamples": 0,
		"probe": "changed-sample-count",
	}
	if captures_dir.is_empty():
		return _effective
	await _luma_of(captures_dir, "effective-baseline")
	for light in _omni:
		(light as Light3D).visible = false
	await _luma_of(captures_dir, "effective-no-lights")
	_effective["lightsChangedSamples"] = _changed_samples()
	_effective["latticeSamples"] = int((_captures[_captures.size() - 1] as Dictionary)["sampledPixels"])
	for index in _omni.size():
		_restore_light(index)
	# The probes are evidence about the frame, not part of it, so only the frame captures are retained.
	_captures = _captures.filter(func(entry: Dictionary) -> bool: return entry["name"] == "frame")
	_effective["lightsAffectFrame"] = int(_effective["lightsChangedSamples"]) > 0
	return _effective


func _luma_of(captures_dir: String, capture_name: String) -> void:
	_previous_image = _latest_image
	await _capture(captures_dir, -1, capture_name, false)


## How many of the shared 240x135 sample lattice changed luma by more than the coverage threshold
## between the last two captures, which is the no-lights frame and the baseline.
func _changed_samples() -> int:
	if _latest_image == null or _previous_image == null:
		return 0
	if _latest_image.get_size() != _previous_image.get_size():
		return 0
	var changed := 0
	for y in range(0, _latest_image.get_height(), 8):
		for x in range(0, _latest_image.get_width(), 8):
			if absf(_luma(_latest_image.get_pixel(x, y)) - _luma(_previous_image.get_pixel(x, y))) > 0.02:
				changed += 1
	return changed


func _capture(captures_dir: String, frame: int, capture_name: String, scored: bool) -> void:
	await RenderingServer.frame_post_draw
	var image := root.get_texture().get_image()
	var path := captures_dir.path_join("lights-%s%s.png" % [capture_name, "" if frame < 0 else "-f%d" % frame])
	image.save_png(path)
	var background := _luma(image.get_pixel(0, 0))
	var previous: Image = _latest_image
	var covered := 0
	var total := 0.0
	var samples := 0
	var cells := PackedInt32Array()
	cells.resize(GRID_COLUMNS * GRID_ROWS)
	# One sample every 8 pixels (240x135 of them) folded into a 24x15 coverage grid, so the same
	# number is comparable with the counterpart arm's capture of its own resolution.
	for y in range(0, image.get_height(), 8):
		for x in range(0, image.get_width(), 8):
			var value := _luma(image.get_pixel(x, y))
			total += value
			samples += 1
			if absf(value - background) > 0.02:
				covered += 1
				cells[(y / 8) / (image.get_height() / 8 / GRID_ROWS) * GRID_COLUMNS + (x / 8) / (image.get_width() / 8 / GRID_COLUMNS)] += 1
	var changed := -1
	if previous != null and previous.get_size() == image.get_size():
		changed = 0
		for y in range(0, image.get_height(), 8):
			for x in range(0, image.get_width(), 8):
				if absf(_luma(image.get_pixel(x, y)) - _luma(previous.get_pixel(x, y))) > 0.02:
					changed += 1
	_latest_image = image
	_captures.append({
		"name": capture_name,
		"frameId": frame,
		"scored": scored,
		"path": path,
		"width": image.get_width(),
		"height": image.get_height(),
		"backgroundLuma": background,
		"sampledPixels": samples,
		"coveredSamples": covered,
		"coveredFraction": float(covered) / float(max(1, samples)),
		"meanLuma": total / float(max(1, samples)),
		"coverageCells": cells,
		"changedPixels": null if changed < 0 else changed,
	})


## How many sampled pixels changed between the last two captured scored frames. A frozen workload must
## show no change at all, which is what rejects a light that stopped toggling.
func _capture_motion() -> int:
	var frames := _captures.filter(func(entry: Dictionary) -> bool: return entry["scored"] == true)
	if frames.size() < 2:
		return -1
	return int((frames[frames.size() - 1] as Dictionary)["changedPixels"])


## Fail closed on what the arm claims, so a record that reached the collector already said yes.
func _rejections() -> Array:
	var problems := []
	if not bool(_effective["lightsAffectFrame"]):
		problems.append("TN_BENCH_GODOT_LIGHTS_NOT_EFFECTIVE")
	# A missing observation is recorded as missing, not as a workload that did not move.
	var motion := _capture_motion()
	if motion >= 0 and motion <= 0:
		problems.append("TN_BENCH_GODOT_LIGHTS_FROZEN")
	# Sampled-frame evidence that the two grids turn opposite ways and that the lights really change
	# energy and visibility. Without it a static scene and a live one share every other field.
	if _states.size() < 2:
		problems.append("TN_BENCH_GODOT_LIGHTS_STATES_UNOBSERVED")
		return problems
	var mesh_delta := 0.0
	var light_delta := 0.0
	var energy_changed := false
	var visible_changed := false
	var span := 0
	for index in range(1, _states.size()):
		var before: Dictionary = _states[index - 1]
		var after: Dictionary = _states[index]
		span += int(after["elapsedFrames"]) - int(before["elapsedFrames"])
		mesh_delta += float(after["meshRotationY"]) - float(before["meshRotationY"])
		light_delta += float(after["lightRotationY"]) - float(before["lightRotationY"])
		if int(after["lightsVisible"]) != int(before["lightsVisible"]):
			visible_changed = true
		for probe in after["lightProbes"]:
			for earlier in before["lightProbes"]:
				if int(earlier["index"]) != int(probe["index"]):
					continue
				if absf(float(probe["energy"]) - float(earlier["energy"])) > 0.0:
					energy_changed = true
	if mesh_delta >= 0.0 or light_delta <= 0.0:
		problems.append("TN_BENCH_GODOT_LIGHTS_NOT_OPPOSITE")
	if not energy_changed:
		problems.append("TN_BENCH_GODOT_LIGHTS_ENERGY_FROZEN")
	# A toggle is a crossing of `sin(accum) * 5`, so the pinned `Lighter` flips one every pi/2 of
	# accum, which at `delta * speed * 2` is every 47 rendered frames. A sample set spanning at least
	# that twice cannot have missed one, and a shorter one is reported as unobserved rather than
	# accused of being frozen — a 2-frame validation has no room for a toggle and saying so is the
	# honest reading, not a passed check.
	if not visible_changed and span >= 2 * PI / 2.0 / (FRAME_DELTA * SPEED * 2.0):
		problems.append("TN_BENCH_GODOT_LIGHTS_VISIBILITY_FROZEN")
	for state in _states:
		if (state.get("meshProbes", []) as Array).is_empty() or (state.get("lightProbes", []) as Array).is_empty():
			problems.append("TN_BENCH_GODOT_LIGHTS_STATE_UNOBSERVED")
			break
	return problems


func _adapter() -> Dictionary:
	return {
		"name": RenderingServer.get_video_adapter_name(),
		"apiVersion": RenderingServer.get_video_adapter_api_version(),
		"driverInfo": OS.get_video_adapter_driver_info(),
		"renderingMethod": RenderingServer.get_current_rendering_method(),
		"renderingDriver": RenderingServer.get_current_rendering_driver_name(),
		"type": "hardware" if RenderingServer.get_rendering_device() != null else "software",
		"vsync": DisplayServer.window_get_vsync_mode(),
		"msaa3D": int(ProjectSettings.get_setting("rendering/anti_aliasing/quality/msaa_3d", 0)),
		"occlusionCulling": bool(ProjectSettings.get_setting("rendering/occlusion_culling/use_occlusion_culling", true)),
	}


func _intervals() -> Array:
	var out := []
	for i in range(1, _boundary_us.size()):
		out.append(float(_boundary_us[i] - _boundary_us[i - 1]) / 1000.0)
	return out


## The primary metric of §7.4: the whole measured span, every scored frame plus the single final
## drain, divided by the frame count. Not the mean of the per-frame intervals, which would leave the
## GPU tail of the last frame outside the number and quietly measure a different thing.
func _completed_work_mean() -> float:
	if _boundary_us.is_empty() or _final_completion_us == 0:
		return 0.0
	return float(_final_completion_us - _boundary_us[0]) / 1000.0 / float(_wall_ms.size())


func _mean(samples: Array) -> float:
	var total := 0.0
	for value in samples:
		total += value
	return total / float(max(1, samples.size()))


## Nearest-rank percentiles of the raw per-frame wall samples, as §7.4 of the PRD requires.
func _summary(samples: Array) -> Dictionary:
	if samples.is_empty():
		return {"p50": 0.0, "p95": 0.0, "p99": 0.0}
	var sorted := samples.duplicate()
	sorted.sort()
	var at := func(fraction: float) -> float:
		return float(sorted[clampi(int(ceil(fraction * sorted.size())) - 1, 0, sorted.size() - 1)])
	return {"p50": at.call(0.5), "p95": at.call(0.95), "p99": at.call(0.99)}


func _f3(value: Vector3) -> Array:
	return [value.x, value.y, value.z]


func _rgb(value: Color) -> Array:
	return [value.r, value.g, value.b]


func _luma(colour: Color) -> float:
	return 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b


func _emit(payload: Dictionary) -> void:
	var text := JSON.stringify(payload)
	print("ENGINE_LOAD_TEST_JSON_BEGIN")
	for offset in range(0, text.length(), 800):
		print("TNJSON:" + text.substr(offset, 800))
	print("ENGINE_LOAD_TEST_JSON_END")


func fail(code: String, detail: String) -> void:
	push_error(code + ": " + detail)
	quit(2)
