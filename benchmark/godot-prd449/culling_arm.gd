# Real-GPU timed arm for the pinned godot-benchmarks `culling.gd` family (PRD-449 Phase 4).
#
# Run WITHOUT `--headless`, so the Forward+ renderer uses the machine's GPU:
#   godot --path <staged project: pinned checkout with occlusion culling off> --resolution 1920x1080 \
#     --script <this file> -- <variant> --frames=600 --warmup=120 --fixture=<out.json> --captures=<dir>
# `pnpm bench:engines --cull-arm godot-desktop` stages it and passes that path.
#
# It never re-implements the workload: `benchmark_<variant>()` from the pinned source builds the
# scene, and this arm only drives, measures and reports it. Every upstream source file is SHA-256
# verified before the scene is built, so a number can name the bytes that produced it. The one
# exception is `project.godot`, which the harness stages with occlusion culling off — see
# `SOURCE_SHA256` — because upstream's own setting renders a different set of objects.
#
# Godot 4.7's RenderingServer has no getter for an instance transform and no getter for a light's
# type or parameters, so nothing here is observed by reading a flag the arm set itself: effective
# culling is the renderer's own per-frame visible-object count, effective light and shadow
# contribution is the frame's pixels, and per-frame workload state is the workload clock plus the
# transform the pinned source computes for the sampled objects at that clock.
extends SceneTree

const CULLING := [
	"basic_cull", "dynamic_cull", "dynamic_rotate_cull", "directional_light_cull",
	"static_omni_light_cull", "static_omni_light_cull_with_shadows",
	"dynamic_omni_light_cull", "dynamic_omni_light_cull_with_shadows",
	"static_spot_light_cull_with_shadows", "dynamic_spot_light_cull_with_shadows",
]
# `project.godot` is the one entry that is not upstream's own bytes: upstream ships
# `use_occlusion_culling=true`, and this fixture's object set measures 2005 visible objects with that
# on against 3549 with it off, so the harness stages a copy with the setting off and runs the arm
# against it. `stageGodotCullProject` in `scripts/engine-load-test/cli.ts` verifies the pinned
# project's hash (e942995c…) before it copies, and the staged project's hash below before every use,
# so the pinned checkout is never the one being patched.
const SOURCE_SHA256 := {
	"benchmarks/rendering/culling.gd": "b19d7f10b094f337be1b91864b835c22d975ce83d616d90cb9b1f5dc723e5a9b",
	"manager.gd": "c4bae1efea609a3f9f8ccf04dbeb69efe193e0faff09e2b301b8c966099dd535",
	"benchmark.gd": "ce20298bb7afd66cb3c42fea0320bac589cfeaf1bbce637a600de2ae1cd486b6",
	"project.godot": "66e3d418efa369aaceb6d781ba9d7ba1c3f74f588fd39c3d9b0d621188fa425c",
}
const SOURCE_COMMIT := "b059e38a81230a87293828bbf65ab247b6b2d2a8"
const MESH_BUFFER_VERSION := "threenative-cull-mesh-buffer/1"
# 2 carries the rendered buffers themselves; 1 carried counts only, which is what let the two arms
# tessellate their own primitives and compare different geometry.
const FIXTURE_SCHEMA := 2
const VIEWPORT := Vector2i(1920, 1080)
const FRAME_DELTA := 1.0 / 60.0
const STATE_FRAMES := [0, 1, 60, 120, 300, 599]
const PROBE_INDICES := [0, 4999, 9999]
const GRID_COLUMNS := 24
const GRID_ROWS := 15

var _args := {}
var _variant := ""
var _scene: Node3D
var _dynamic_rids: Array[RID] = []
var _dynamic_is_lights := false
var _directional: DirectionalLight3D = null
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


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--"):
			var parts := argument.substr(2).split("=", true, 1)
			_args[parts[0]] = parts[1] if parts.size() == 2 else "true"
		else:
			_variant = argument
	if not CULLING.has(_variant):
		fail("TN_BENCH_BAD_GODOT_VARIANT", "expected one pinned culling variant, got " + _variant)
		return
	for file in SOURCE_SHA256:
		if FileAccess.get_sha256("res://" + file) != SOURCE_SHA256[file]:
			fail("TN_BENCH_GODOT_SOURCE_HASH_MISMATCH", file)
			return
	var viewport_size := root.get_visible_rect().size
	if viewport_size != Vector2(VIEWPORT):
		# The upstream placement loop derives every position from the viewport, so a different size
		# is a different fixture, not a slower run.
		fail("TN_BENCH_GODOT_VIEWPORT_MISMATCH", str(viewport_size))
		return
	var frames := int(_args.get("frames", 600))
	var warmup := int(_args.get("warmup", 120))
	if frames < 1 or warmup < 0:
		fail("TN_BENCH_BAD_PARAM", "frames must be >= 1 and warmup >= 0")
		return
	RenderingServer.viewport_set_measure_render_time(root.get_viewport_rid(), true)

	# The pinned Manager seeds its global RNG to this exact value before every test, and the whole
	# fixture — five material colours and all 10,000 placements — is one draw from that stream.
	seed(0x60d07)
	var benchmark = load("res://benchmarks/rendering/culling.gd").new()
	# The window's World3D — and therefore the culling scenario the upstream source assigns every
	# instance to — does not exist until a frame has been presented, so a scene added before the
	# first frame is handed a null scenario and renders outside the culling this family measures.
	await process_frame
	_scene = benchmark.call("benchmark_" + _variant)
	root.add_child(_scene)
	await process_frame
	await process_frame
	# The engine must not also step the scene: the deterministic-throughput protocol advances the
	# workload a fixed 1/60 s per rendered frame, so the delta is ours, not the wall clock's.
	_scene.set_process(false)
	_dynamic_rids = [] as Array[RID]
	if _scene.dynamic_instances != null:
		_dynamic_rids = _scene.dynamic_instances
	# A static variant assigns `dynamic_instances_xforms` but leaves `dynamic_instances` empty, so
	# the light set has to be recognised without indexing it. Indexing an empty array raises an
	# unhandled error inside `_run`, and this SceneTree is then left running with nothing to quit
	# it: the run hangs until the harness gives up rather than reporting what went wrong.
	_dynamic_is_lights = (
		not _dynamic_rids.is_empty()
		and not _scene.light_instances.is_empty()
		and _dynamic_rids[0] == _scene.light_instances[0]
	)
	for child in _scene.get_children():
		if child is DirectionalLight3D:
			_directional = child

	var topology := _describe_topology()
	if topology.size() != 5:
		fail("TN_BENCH_GODOT_TOPOLOGY_UNREADABLE", str(topology.size()))
		return
	var lights := _describe_lights()
	var fixture_path: String = _args.get("fixture", "")
	var fixture_hash := ""
	if not fixture_path.is_empty():
		fixture_hash = _export_fixture(fixture_path, topology, lights)
		if fixture_hash.is_empty():
			return
	var captures_dir: String = _args.get("captures", "")
	if not captures_dir.is_empty():
		DirAccess.make_dir_recursive_absolute(captures_dir)
	await _measure(frames, warmup, captures_dir)
	var effective := await _effective_lighting(captures_dir)
	await _silhouette_diagnostic(captures_dir)

	var result := {
		"arm": "godot-desktop",
		"family": "godot-culling",
		"variant": _variant,
		"authoring": "rendering-server-rid",
		"authoringNote": "upstream culling.gd creates 10,000 low-level RenderingServer instance RIDs and up to 100 light RIDs, not one Node3D per rendered object, so this is a renderer-server workload and not each engine's ordinary scene-node API",
		"fixture": {
			"hash": fixture_hash,
			"path": fixture_path,
			"schemaVersion": FIXTURE_SCHEMA,
			"objects": _scene.objects.size(),
			"rngSeed": 0x60d07,
			"viewport": {"width": VIEWPORT.x, "height": VIEWPORT.y},
		},
		"topology": _identity_only(topology),
		"lights": lights,
		"effective": effective,
		"dynamic": {
			"enabled": not _dynamic_rids.is_empty(),
			"rids": _dynamic_rids.size(),
			"rotate": _scene.dynamic_instances_rotate,
			"target": "light-instances" if _dynamic_is_lights else "objects",
			"frameDelta": FRAME_DELTA,
		},
		"unshaded": _scene.unshaded,
		"motion": {"observed": _capture_motion() >= 0, "changedSampledPixels": _capture_motion()},
		"states": _states,
		"samples": {"wallMs": _wall_ms, "renderCpuMs": _render_cpu_ms, "renderGpuMs": _render_gpu_ms},
		"frameIntervalMs": _intervals(),
		"frameP50Ms": _summary(_wall_ms)["p50"],
		"frameP95Ms": _summary(_wall_ms)["p95"],
		"frameP99Ms": _summary(_wall_ms)["p99"],
		"meanMs": _completed_work_mean(),
		"rawSeries": _raw_series(),
		"renderCpuMeanMs": _mean(_render_cpu_ms),
		"renderGpuMeanMs": _mean(_render_gpu_ms),
		"work": _work_at_mid,
		"visibleObjectsInFrame": _visible_objects,
		"frames": frames,
		# The mean above spans the first scored boundary to the end of the one final `force_sync()`,
		# which is the same completed-work definition §7.4 requires and the counterpart arm reports.
		# `drainFinalWaitMs` is that wait on its own, and `drainBoundaryFrame` names where it was
		# taken, so a reader can see that the GPU tail is inside the mean and not averaged away.
		"drain": "measurement-boundary-completion",
		"drainBoundaryFrame": frames,
		"drainFinalWaitMs": float(_final_completion_us - _drain_boundary_us) / 1000.0,
		# `warmupMs` keeps the name every earlier raw published under it, and under that name it was
		# the clock reading taken when the warmup began, not an elapsed time. The elapsed warmup is
		# therefore published under its own field, so an intake can tell the two shapes apart and read
		# a duration only from a field that means one.
		"warmupDurationMs": float(_warmup_us) / 1000.0,
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
		"source": {"commit": SOURCE_COMMIT, "sha256": SOURCE_SHA256["benchmarks/rendering/culling.gd"]},
		"profile": "smoke",
	}
	_emit(result)
	var problems := _rejections()
	if not problems.is_empty():
		for problem in problems:
			push_error("TN_BENCH_GODOT_CULL_REJECTED: " + problem)
		quit(2)
		return
	quit(0)


## Fail closed on what the arm claims, so a record that reached the collector already said yes.
func _rejections() -> Array:
	var problems := []
	var dynamic: bool = not _dynamic_rids.is_empty()
	if _occlusion_culling_enabled():
		problems.append("TN_BENCH_GODOT_OCCLUSION_CULLING_ENABLED")
	if _unshaded_expected() != _scene.unshaded:
		problems.append("TN_BENCH_GODOT_UNSHADED_MISMATCH")
	if _shadows_requested() and not bool(_effective["shadowPassRendered"]):
		problems.append("TN_BENCH_GODOT_SHADOW_PASS_NOT_OBSERVED")
	if _scene.light_instances.size() > 0 and not bool(_effective["lightsAffectFrame"]):
		problems.append("TN_BENCH_GODOT_LIGHTS_NOT_EFFECTIVE")
	if _directional != null and not bool(_effective["directionalAffectsFrame"]):
		problems.append("TN_BENCH_GODOT_DIRECTIONAL_NOT_EFFECTIVE")
	# A missing observation is recorded as missing, not as a scene that did not move.
	var motion := _capture_motion()
	if motion >= 0:
		if not dynamic and motion != 0:
			problems.append("TN_BENCH_GODOT_STATIC_SCENE_MOVED")
		if dynamic and motion <= 0:
			problems.append("TN_BENCH_GODOT_DYNAMIC_SCENE_FROZEN")
	# A sampled state that carries no probe is a frame the arm read nothing from, which is not the
	# same as a static one: the counterpart arm has a per-frame transform to check and would be
	# checking it against an absence. Named here so the record never leaves this arm unparseable.
	for state in _states:
		if (state as Dictionary).is_empty() or (state.get("probes", []) as Array).is_empty():
			problems.append("TN_BENCH_GODOT_STATE_UNOBSERVED")
			break
	return problems


func _unshaded_expected() -> bool:
	return _variant == "basic_cull"


## How many sampled pixels changed between the last two captured frames of the same warmup pass. A
## static workload must show no change at all and a dynamic one must show some, which is what
## rejects a frozen animation and a silently static one.
func _capture_motion() -> int:
	var frames := _captures.filter(func(entry: Dictionary) -> bool: return entry["scored"] == true)
	if frames.size() < 2:
		return -1
	return int((frames[frames.size() - 1] as Dictionary)["changedPixels"])


func _measure(frames: int, warmup: int, captures_dir: String) -> void:
	var state_frames := STATE_FRAMES.duplicate()
	state_frames.append(frames - 1)
	# Captures belong to the untimed warmup, whose scene state at frame k is identical to the scored
	# frame k because the workload clock is deterministic and restarts from the same state.
	if not captures_dir.is_empty():
		for candidate in [0, 1, 60, 119, 300, 599]:
			if candidate < warmup:
				_capture_frames.append(candidate)
	_warmup_us = Time.get_ticks_usec()
	# The workload clock is a plain member of the pinned scene and nothing zeroes it, so it arrives at
	# the warmup already advanced by however long the window took to come up. It is zeroed here and
	# again after the warmup: the first reset makes captured warmup frame k the same workload state as
	# scored frame k, and the second makes the scored interval start from a declared initial state
	# instead of a count of however many frames the host had already drawn. The counterpart arm resets
	# the same way, so frame k is one workload state in both arms and the transform oracle means
	# something.
	_scene.time_accum = 0.0
	for index in warmup:
		_scene._process(FRAME_DELTA)
		await process_frame
		if _capture_frames.has(index):
			await _capture(captures_dir, index, _variant, true)
	_warmup_us = Time.get_ticks_usec() - _warmup_us
	_scene.time_accum = 0.0
	_boundary_us.append(Time.get_ticks_usec())
	for frame in frames:
		_scene._process(FRAME_DELTA)
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


## The transform the pinned workload has put on each sampled object at this frame's clock value, so
## the counterpart arm's independently computed value has something to be checked against.
func _sample_state(frame: int) -> Dictionary:
	var rids: Array[RID] = _scene.light_instances if _dynamic_is_lights else _scene.objects
	var stored: Array = _scene.light_instance_xforms if _dynamic_is_lights else _scene.object_xforms
	var probes := []
	for index in PROBE_INDICES:
		# A light variant's dynamic set is its hundred light instances, so an object-sized index has
		# no witness there and is not sampled rather than reported as something the source never made.
		if index >= stored.size():
			continue
		var expected := _expected_transform(stored[index], index, rids.size())
		probes.append({
			"index": index,
			"origin": _f3(expected.origin),
			"axisX": _f3(expected.basis.x),
			"displacedFromAuthored": (expected.origin - (stored[index] as Transform3D).origin).length() > 0.0,
		})
	return {
		"frameId": frame,
		"timeAccum": _scene.time_accum,
		"dynamicRids": _dynamic_rids.size(),
		"dynamicTarget": "light-instances" if _dynamic_is_lights else "objects",
		"rotate": _scene.dynamic_instances_rotate,
		"probes": probes,
		"objectsInFrame": _visible_objects[frame] if frame < _visible_objects.size() else -1,
		"directionalEnabled": _directional != null and _directional.light_enabled,
	}


func _expected_transform(xf: Transform3D, index: int, total: int) -> Transform3D:
	if _dynamic_rids.is_empty():
		return xf
	var angle: float = index * TAU / float(total)
	if _scene.dynamic_instances_rotate:
		return xf.rotated_local(Vector3.RIGHT, angle * sin(_scene.time_accum) * 2.0)
	var out := xf
	out.origin += Vector3(sin(angle), cos(angle), 0.0) * sin(_scene.time_accum) * 2.0
	return out


func _describe_topology() -> Array:
	var out := []
	for index in _scene.meshes.size():
		var primitive: PrimitiveMesh = _scene.meshes[index]
		# `get_mesh_arrays()` is one surface's channels indexed by `Mesh.ARRAY_*`, not a list of
		# surfaces; the surface count comes from the renderer's mesh RID.
		var arrays: Array = primitive.get_mesh_arrays()
		var kind: String = primitive.get_class()
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
		var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV]
		var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
		# The counterpart arm builds its geometry from these bytes, so a primitive it cannot decode is
		# a fixture it cannot render rather than a silently regenerated sphere.
		if vertices.is_empty() or normals.size() != vertices.size() or uvs.size() != vertices.size():
			fail("TN_BENCH_GODOT_MESH_CHANNELS_INCOMPLETE", kind)
			return []
		if indices.is_empty() or indices.size() % 3 != 0:
			fail("TN_BENCH_GODOT_MESH_INDICES_MALFORMED", kind)
			return []
		var bytes := _mesh_buffer_bytes(kind, vertices, normals, uvs, indices)
		var mins := Vector3(INF, INF, INF)
		var maxs := Vector3(-INF, -INF, -INF)
		for point in vertices:
			mins = mins.min(point)
			maxs = maxs.max(point)
		var aabb: AABB = primitive.get_aabb()
		out.append({
			"kind": kind,
			"surfaces": RenderingServer.mesh_get_surface_count(primitive.get_rid()),
			"vertices": vertices.size(),
			"indices": indices.size(),
			"triangles": indices.size() / 3,
			"indexed": true,
			"aabb": {"min": _f3(aabb.position), "size": _f3(aabb.size)},
			"vertexBounds": {"min": _f3(mins), "max": _f3(maxs)},
			"albedo": _albedo(primitive),
			# Raw little-endian buffers, so the fixture carries the bytes the scene rendered rather
			# than a decimal approximation of them, plus the SHA-256 of the canonical stream both
			# arms hash. `PackedVector3Array` is three binary32 and `PackedInt32Array` two's-complement
			# 32-bit, so a channel is exactly `count * stride` bytes on the wire.
			"bufferSha256": _sha256(bytes),
			"buffers": {
				"positions": Marshalls.raw_to_base64(vertices.to_byte_array()),
				"normals": Marshalls.raw_to_base64(normals.to_byte_array()),
				"uvs": Marshalls.raw_to_base64(uvs.to_byte_array()),
				"indices": Marshalls.raw_to_base64(indices.to_byte_array()),
			},
		})
	return out


## The one byte stream a primitive's identity is a SHA-256 over, byte-for-byte the layout
## `cullMeshBufferBytes` writes on the counterpart side: version line, class name, the vertex and
## index counts as two little-endian u32, then positions, normals, UVs and indices in that order.
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
## record already names by path and hash. Duplicating a third of a megabyte of base64 into every run
## record would make the retained evidence bigger without making it more true.
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


func _albedo(primitive: PrimitiveMesh) -> Array:
	# The pinned source hard-codes ALBEDO into a generated shader as `vec3(r, g, b)`, so the value
	# is read back out of those bytes instead of re-derived from an RNG that would have to match
	# Godot's PCG stream to the digit.
	var material := primitive.material
	if not material is ShaderMaterial:
		return []
	var code: String = (material as ShaderMaterial).shader.code
	var start := code.find("vec3(")
	if start < 0:
		return []
	var body := code.substr(start + 5, code.find(")", start) - start - 5)
	var out := []
	for part in body.split(","):
		out.append(float(part.strip_edges()))
	return out


func _describe_lights() -> Dictionary:
	# The source creates exactly one light RID and instances it 100 times, and 4.7 exposes no
	# renderer getter for a light's type or shadow mode, so the kind is identified by the branch the
	# pinned variant takes — `do_fill_with_omni_lights` calls `light_omni_set_shadow_mode` and
	# `do_fill_with_spot_lights` calls `spot_light_create` — not by a read-back that cannot exist.
	var is_omni: bool = not _scene.lights.is_empty() and _variant.contains("omni")
	return {
		"requested": 100 if not _scene.lights.is_empty() else (1 if _directional != null else 0),
		"lightRids": _scene.lights.size(),
		"lightInstances": _scene.light_instances.size(),
		"omni": _scene.light_instances.size() if is_omni else 0,
		"spot": 0 if is_omni else _scene.light_instances.size(),
		"directional": 1 if _directional != null else 0,
		"shadowsRequested": _scene.use_shadows,
		"directionalShadow": _directional.shadow_enabled if _directional != null else null,
		"omniShadowMode": "dual-paraboloid" if is_omni else null,
		"lightRange": 10.0 if not _scene.lights.is_empty() else null,
	}


func _shadows_requested() -> bool:
	return _scene.use_shadows or (_directional != null and _directional.shadow_enabled)


## Effective lighting is observed as pixels, never asserted from a flag: the light contribution is
## the luma that disappears when the lights are hidden, and the shadow pass is the luma that appears
## when it is switched off. Untimed, after the measured frames, on the same scene and binaries.
func _effective_lighting(captures_dir: String) -> Dictionary:
	_effective = {
		"shadowsRequested": _shadows_requested(),
		"shadowPassRendered": false,
		"lightsAffectFrame": true,
		"directionalAffectsFrame": _directional == null,
		"shadowLumaDelta": 0.0,
		"lightLumaDelta": 0.0,
		"directionalLumaDelta": 0.0,
	}
	if captures_dir.is_empty():
		return _effective
	var baseline := await _luma_of(captures_dir, "effective-baseline")
	if _scene.light_instances.size() > 0:
		for light in _scene.light_instances:
			RenderingServer.instance_set_visible(light, false)
		var without := await _luma_of(captures_dir, "effective-no-lights")
		for light in _scene.light_instances:
			RenderingServer.instance_set_visible(light, true)
		_effective["lightLumaDelta"] = absf(baseline - without)
		_effective["lightsAffectFrame"] = _effective["lightLumaDelta"] > 0.001
	if _directional != null:
		_directional.visible = false
		var without := await _luma_of(captures_dir, "effective-no-directional")
		_directional.visible = true
		_effective["directionalLumaDelta"] = absf(baseline - without)
		_effective["directionalAffectsFrame"] = _effective["directionalLumaDelta"] > 0.001
	if _shadows_requested():
		for light in _scene.lights:
			RenderingServer.light_set_shadow(light, false)
		if _directional != null:
			_directional.shadow_enabled = false
		var without := await _luma_of(captures_dir, "effective-no-shadows")
		for light in _scene.lights:
			RenderingServer.light_set_shadow(light, true)
		if _directional != null:
			_directional.shadow_enabled = true
		_effective["shadowLumaDelta"] = absf(baseline - without)
		_effective["shadowPassRendered"] = _effective["shadowLumaDelta"] > 0.001
	# The probes are evidence about the frame, not part of it, so only the baseline is retained.
	_captures = _captures.filter(func(entry: Dictionary) -> bool: return entry["name"] == _variant)
	return _effective


var _effective := {}


func _luma_of(captures_dir: String, capture_name: String) -> float:
	await _capture(captures_dir, -1, capture_name, false)
	return _mean_luma_of_latest_capture()


## One untimed diagnostic capture after the measured span: the same 10,000 object RIDs, the same
## camera and the same frozen workload clock for both captures at the final measured frame, with
## one shared white opaque unshaded material override, so the paired masks isolate shading. The
## pinned source puts its material on the mesh (`mesh.material`),
## never on an instance, so the only instance state this changes is the override it adds and then
## clears. Godot 4.7 has no `instance_geometry_get_material_override` (verified against 4.7.1), so a
## pre-existing per-instance override could not be read back before being replaced; the pinned bytes
## this arm hashes set none, and clearing restores exactly the "no override" state the mesh material
## already described. Recorded `scored: false` so the comparator's scored coverage is untouched.
func _silhouette_diagnostic(captures_dir: String) -> void:
	if captures_dir.is_empty():
		return
	await _capture(captures_dir, _wall_ms.size() - 1, "silhouette-shaded", false)
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(1.0, 1.0, 1.0, 1.0)
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
	var override := material.get_rid()
	for object_rid in _scene.objects:
		RenderingServer.instance_geometry_set_material_override(object_rid, override)
	# One untimed frame before the capture, so the new material's shader is compiled and the
	# diagnostic is not the frame the renderer had nothing new to draw for.
	await process_frame
	await _capture(captures_dir, _wall_ms.size() - 1, "silhouette", false)
	for object_rid in _scene.objects:
		RenderingServer.instance_geometry_set_material_override(object_rid, RID())


func _capture(captures_dir: String, frame: int, capture_name: String, scored: bool) -> void:
	await RenderingServer.frame_post_draw
	var image := root.get_texture().get_image()
	var path := captures_dir.path_join("%s-%s%s.png" % [_variant, capture_name, "" if frame < 0 else "-f%d" % frame])
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
			var luma := _luma(image.get_pixel(x, y))
			total += luma
			samples += 1
			if absf(luma - background) > 0.02:
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


var _latest_image: Image = null


func _mean_luma_of_latest_capture() -> float:
	if _captures.is_empty():
		return 0.0
	return float((_captures[_captures.size() - 1] as Dictionary)["meanLuma"])


func _luma(colour: Color) -> float:
	return 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b


func _export_fixture(path: String, topology: Array, lights: Dictionary) -> String:
	var fixture := {
		"schemaVersion": FIXTURE_SCHEMA,
		"generatedBy": "godot-desktop",
		"sourceCommit": SOURCE_COMMIT,
		"cullingSha256": SOURCE_SHA256["benchmarks/rendering/culling.gd"],
		"rngSeed": 0x60d07,
		"objects": _scene.objects.size(),
		"viewport": {"width": VIEWPORT.x, "height": VIEWPORT.y},
		"camera": {
			"fovDegrees": 75.0,
			"near": 0.05,
			"far": _scene.cam.far,
			"position": _f3(_scene.cam.transform.origin),
			"lookAt": [0.0, 0.0, -1.0],
		},
		"meshes": topology,
		"placements": _f3_array(_scene.object_xforms),
		"lights": {
			"instances": _scene.light_instances.size(),
			"omni": lights["omni"],
			"spot": lights["spot"],
			"range": lights["lightRange"],
			"omniShadowMode": lights["omniShadowMode"],
			"placements": _f3_array(_scene.light_instance_xforms),
		},
		"directional": {
			"present": _directional != null,
			"rotation": [_d(_directional.rotation.x), _d(_directional.rotation.y), _d(_directional.rotation.z)] if _directional != null else null,
			"positionX": _d(_directional.position.x) if _directional != null else null,
			"shadow": _directional.shadow_enabled if _directional != null else null,
		},
		"environment": {
			"backgroundMode": "clear-color",
			"clearColor": ProjectSettings.get_setting("rendering/environment/defaults/default_clear_color", Color(0, 0, 0)),
			"ambientSource": "sky",
			"skyTop": [1.0, 1.0, 1.0],
			"skyHorizon": [0.501961, 0.501961, 0.501961],
			"groundBottom": [0.0, 0.0, 0.0],
			"groundHorizon": [0.501961, 0.501961, 0.501961],
			"defaultEnvironment": "uid://du1js6r1lrlb7",
		},
	}
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		fail("TN_BENCH_GODOT_FIXTURE_UNWRITABLE", path)
		return ""
	# 17 significant digits round-trip an IEEE-754 binary64 exactly, so the exported placements are
	# the doubles Godot rendered rather than a decimal approximation of them, and the file's own
	# SHA-256 is the identity both arms hash.
	file.store_string(JSON.stringify(fixture, "", true))
	file.close()
	return FileAccess.get_sha256(path)


func _f3_array(transforms: Array) -> Array:
	var out := []
	for xf in transforms:
		out.append(_f3((xf as Transform3D).origin))
	return out


## The staged project's own setting, read back out of it rather than from a flag this arm set: with
## occlusion culling on, this fixture's visible object set is measurably smaller than the one the
## counterpart arm renders, and the pair would be comparing two different sets of objects.
func _occlusion_culling_enabled() -> bool:
	return bool(ProjectSettings.get_setting("rendering/occlusion_culling/use_occlusion_culling", true))


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
		"occlusionCulling": _occlusion_culling_enabled(),
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


## The boundaries this arm actually recorded, in the series shape a v2 intake reads, so every interval
## and the completed-work span can be re-derived from the microsecond stamps themselves instead of
## from the rounded `wallMs` samples. Boundary 0 starts scoring; boundary i+1 closes frame i, so
## the array is one longer than the frame count. `finalCompletionMs` is the `force_sync()` return.
func _raw_series() -> Dictionary:
	var boundaries := []
	for index in _boundary_us.size():
		boundaries.append({"frameId": index, "monotonicMs": float(_boundary_us[index]) / 1000.0})
	return {
		"schemaVersion": 1,
		"unit": "ms",
		"boundaries": boundaries,
		"finalCompletionMs": float(_final_completion_us) / 1000.0,
	}


func _mean(samples: Array) -> float:
	var total := 0.0
	for value in samples:
		total += value
	return total / float(max(1, samples.size()))


## Nearest-rank percentiles of the raw per-frame wall samples, as §7.4 of the PRD requires: the
## frame interval is its own metric and never the completed-work mean the counterpart arm reports.
func _summary(samples: Array) -> Dictionary:
	if samples.is_empty():
		return {"p50": 0.0, "p95": 0.0, "p99": 0.0}
	var sorted := samples.duplicate()
	sorted.sort()
	var at := func(fraction: float) -> float:
		return float(sorted[clampi(int(ceil(fraction * sorted.size())) - 1, 0, sorted.size() - 1)])
	return {"p50": at.call(0.5), "p95": at.call(0.95), "p99": at.call(0.99)}


## A float is already the exact binary64 Godot rendered; the reader, not this writer, is where a
## precision claim is checked.
func _d(value: float) -> float:
	return value


func _f3(value: Vector3) -> Array:
	return [value.x, value.y, value.z]


func _emit(payload: Dictionary) -> void:
	var text := JSON.stringify(payload)
	print("ENGINE_LOAD_TEST_JSON_BEGIN")
	for offset in range(0, text.length(), 800):
		print("TNJSON:" + text.substr(offset, 800))
	print("ENGINE_LOAD_TEST_JSON_END")


func fail(code: String, detail: String) -> void:
	push_error(code + ": " + detail)
	quit(2)
