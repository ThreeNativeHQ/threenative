# Runs against the pinned godot-benchmarks checkout via `godot --path <checkout> --script <this file>`.
# This is a scene-census probe. Headless Godot uses a dummy renderer, so it never publishes timing.
extends SceneTree

const CULLING := [
	"basic_cull", "dynamic_cull", "dynamic_rotate_cull", "directional_light_cull",
	"static_omni_light_cull", "static_omni_light_cull_with_shadows",
	"dynamic_omni_light_cull", "dynamic_omni_light_cull_with_shadows",
	"static_spot_light_cull_with_shadows", "dynamic_spot_light_cull_with_shadows",
]
const LIGHTS := [
	"box-100", "box-1000", "box-10000", "sphere-100", "sphere-1000", "sphere-10000",
	"omni-10", "omni-100", "spot-10", "spot-100", "speed-fast", "speed-slow", "stress",
]
const SOURCE_SHA256 := {
	"benchmarks/rendering/culling.gd": "b19d7f10b094f337be1b91864b835c22d975ce83d616d90cb9b1f5dc723e5a9b",
	"benchmarks/rendering/lights_and_meshes.gd": "2b1b4088876a6fac0332a14b27d004634360786c7746133360ba35cf9f003a6c",
	"manager.gd": "c4bae1efea609a3f9f8ccf04dbeb69efe193e0faff09e2b301b8c966099dd535",
	"benchmark.gd": "ce20298bb7afd66cb3c42fea0320bac589cfeaf1bbce637a600de2ae1cd486b6",
	"project.godot": "e942995c87024bfdc22c5fd9b599d4c8e4b653d2ab05f23787f74c16b197afb7",
}

func _initialize() -> void:
	call_deferred("_probe")

func _probe() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() != 1 or not CULLING.has(args[0]) and not LIGHTS.has(args[0]):
		push_error("TN_BENCH_BAD_GODOT_VARIANT: pass one pinned culling or lights variant")
		quit(2)
		return
	for file in SOURCE_SHA256:
		if FileAccess.get_sha256("res://" + file) != SOURCE_SHA256[file]:
			push_error("TN_BENCH_GODOT_SOURCE_HASH_MISMATCH: " + file)
			quit(2)
			return
	seed(0x60d07) # pinned upstream Manager.RANDOM_SEED
	var variant: String = args[0]
	var family := "culling" if CULLING.has(variant) else "lights_and_meshes"
	var benchmark_script := load("res://benchmarks/rendering/" + family + ".gd")
	if benchmark_script == null:
		push_error("TN_BENCH_GODOT_SOURCE_MISSING")
		quit(2)
		return
	var benchmark = benchmark_script.new()
	var scene: Node3D = benchmark.call("benchmark_" + variant.replace("-", "_"))
	root.add_child(scene)
	await process_frame
	var passed := _probe_lights(variant, scene) if family == "lights_and_meshes" else _probe_culling(variant, scene)
	scene.queue_free()
	quit(0 if passed else 2)

func _probe_lights(variant: String, scene: Node3D) -> bool:
	var requested_objects := 1000
	var requested_lights := 10
	if variant.begins_with("box-") or variant.begins_with("sphere-"):
		requested_objects = int(variant.get_slice("-", 1))
	elif variant == "stress":
		requested_objects = 10000
		requested_lights = 100
	elif variant.begins_with("omni-") or variant.begins_with("spot-"):
		requested_lights = int(variant.get_slice("-", 1))
	var expected_objects := int(round(sqrt(float(requested_objects)))) ** 2
	var expected_lights := int(round(sqrt(float(requested_lights)))) ** 2
	var objects := scene.find_children("*", "MeshInstance3D", true, false).size()
	var omni := scene.find_children("*", "OmniLight3D", true, false).size()
	var spot := scene.find_children("*", "SpotLight3D", true, false).size()
	var expected_omni := expected_lights if variant.begins_with("omni-") else 0
	if objects != expected_objects or omni != expected_omni or spot != expected_lights - expected_omni:
		push_error("TN_BENCH_GODOT_LIGHTS_CENSUS_MISMATCH")
		return false
	var speed := 5.0 if variant == "speed-fast" or variant == "stress" else 1.0
	var mesh_rotater: Node3D = scene.get_child(1)
	var light_rotater: Node3D = scene.get_child(2)
	var mesh_before := mesh_rotater.rotation.y
	var light_before := light_rotater.rotation.y
	mesh_rotater._process(0.25)
	light_rotater._process(0.25)
	if not is_equal_approx(mesh_rotater.rotation.y - mesh_before, -0.025 * speed) or not is_equal_approx(light_rotater.rotation.y - light_before, 0.025 * speed):
		push_error("TN_BENCH_GODOT_OPPOSITE_GRID_ROTATION_MISMATCH")
		return false
	var light_grid: Node3D = light_rotater.get_child(0)
	var checked_light_updates := 0
	for cell in light_grid.get_children():
		var lighter: Node3D = cell.get_child(0)
		var before: float = lighter.accum
		lighter._process(0.25)
		var expected_accum := before + 0.5 * speed
		var expected_energy := sin(expected_accum) * 5.0
		if not is_equal_approx(lighter.accum, expected_accum) or lighter.light.visible != (expected_energy > 0):
			push_error("TN_BENCH_GODOT_LIGHT_STATE_MISMATCH")
			return false
		if expected_energy > 0 and not is_equal_approx(lighter.light.light_energy, expected_energy):
			push_error("TN_BENCH_GODOT_LIGHT_ENERGY_MISMATCH")
			return false
		checked_light_updates += 1
	if checked_light_updates != expected_lights:
		push_error("TN_BENCH_GODOT_LIGHT_UPDATE_COUNT_MISMATCH")
		return false
	print("TN_GODOT_CENSUS:" + JSON.stringify({
		"variant": variant,
		"requested_objects": requested_objects,
		"mesh_instances": objects,
		"requested_lights": requested_lights,
		"omni_light_nodes": omni,
		"spot_light_nodes": spot,
		"checked_light_updates": checked_light_updates,
		"opposite_grid_rotation": true,
		"source_sha256": SOURCE_SHA256["benchmarks/rendering/lights_and_meshes.gd"],
	}))
	return true

func _probe_culling(variant: String, scene: Node3D) -> bool:
	var objects: int = scene.objects.size()
	var lights: int = scene.light_instances.size()
	var directional: int = 0
	for child in scene.get_children():
		if child is DirectionalLight3D:
			if not child.shadow_enabled:
				push_error("TN_BENCH_GODOT_DIRECTIONAL_SHADOW_MISMATCH")
				return false
			directional += 1
	var expected_lights: int = 100 if "omni" in variant or "spot" in variant else 0
	var expected_directional: int = 1 if "directional" in variant else 0
	var dynamic: bool = variant.begins_with("dynamic_")
	var expected_dynamic := (100 if expected_lights else 10000) if dynamic else 0
	var dynamic_rids: int = scene.dynamic_instances.size() if dynamic else 0
	if objects != 10000 or scene.meshes.size() != 5 or lights != expected_lights or directional != expected_directional or scene.lights.size() != (1 if expected_lights else 0):
		push_error("TN_BENCH_GODOT_CENSUS_MISMATCH")
		return false
	if scene.unshaded != (variant == "basic_cull") or scene.use_shadows != variant.contains("with_shadows") or scene.dynamic_instances_rotate != (variant == "dynamic_rotate_cull") or dynamic_rids != expected_dynamic:
		push_error("TN_BENCH_GODOT_CULLING_MODE_MISMATCH")
		return false
	if dynamic and scene.dynamic_instances_xforms.size() != expected_dynamic:
		push_error("TN_BENCH_GODOT_DYNAMIC_TRANSFORM_COUNT_MISMATCH")
		return false
	var before: float = scene.time_accum
	scene._process(0.25)
	if not is_equal_approx(scene.time_accum, before + (1.0 if dynamic else 0.0)):
		push_error("TN_BENCH_GODOT_DYNAMIC_STEP_MISMATCH")
		return false
	print("TN_GODOT_CENSUS:" + JSON.stringify({
		"variant": variant,
		"rendering_server_instances": objects,
		"primitive_meshes": scene.meshes.size(),
		"light_instances": lights,
		"directional_light_nodes": directional,
		"dynamic_rids": dynamic_rids,
		"dynamic_process_advanced": dynamic,
		"shadows_requested": scene.use_shadows or directional == 1,
		"source_sha256": SOURCE_SHA256["benchmarks/rendering/culling.gd"],
	}))
	return true
