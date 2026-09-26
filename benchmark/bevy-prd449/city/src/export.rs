//! PRD-449 `bevy-city`: the canonical fixture export, the run report and the render-thread drain.
//!
//! Everything the counterpart arm needs is written here as bytes, read from the scene this run
//! actually built: the per-node hierarchy in insertion order with every local transform, the roads
//! and the cars with the state `simulate_cars` keeps, each unique geometry as its own vertex, normal,
//! UV, tangent and index buffers, each texture as the vendored file's own bytes, and each material
//! with the bindings and numbers the counterpart must reproduce. Nothing is regenerated here from a
//! seed: `generate_city.rs` already ran, and re-deriving its output in another language is the trap
//! §6.1 exists to avoid.

use std::fs;

use std::sync::atomic::Ordering;

use bevy::{
    mesh::{Indices, VertexAttributeValues},
    prelude::*,
    render::{
        render_resource::PollType,
        renderer::{RenderAdapterInfo, RenderDevice},
    },
    window::PrimaryWindow,
};
use serde_json::json;

use crate::{
    num, refuse, triple, uv, Args, Car, CarRuns, Census, Measure, Profile, Road, Settings,
    ADAPTER_JSON,
    CAR_PROBES, CAR_SPEED, DRAIN_COMPLETED_MS, DRAIN_COUNT, DRAIN_REQUESTED, DRAIN_WAIT_MS,
    FRAME_DELTA, NODE_PROBES, SETTLE_FRAMES, STABLE_TICKS, UPSTREAM_COMMIT, UPSTREAM_PATH,
    WINDOW_RESOLUTION,
};

pub(super) fn b64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let a = chunk[0];
        let b = chunk[1.min(chunk.len() - 1)];
        let c = chunk[2.min(chunk.len() - 1)];
        out.push(ALPHABET[(a >> 2) as usize] as char);
        out.push(ALPHABET[(((a & 3) << 4) | (b >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(((b & 15) << 2) | (c >> 6)) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[(c & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

fn quat(value: Quat) -> serde_json::Value {
    json!([num(value.x), num(value.y), num(value.z), num(value.w)])
}

fn attribute_name(values: &VertexAttributeValues) -> &'static str {
    match values {
        VertexAttributeValues::Float32(_) => "float32",
        VertexAttributeValues::Float32x2(_) => "float32x2",
        VertexAttributeValues::Float32x3(_) => "float32x3",
        VertexAttributeValues::Float32x4(_) => "float32x4",
        VertexAttributeValues::Float64x3(_) => "float64x3",
        _ => "other",
    }
}

fn f32_bytes<const N: usize>(values: &[[f32; N]]) -> Vec<u8> {
    let mut out = Vec::with_capacity(values.len() * N * 4);
    for value in values {
        for component in value {
            out.extend_from_slice(&component.to_le_bytes());
        }
    }
    out
}

/// The mesh buffers this run handed to the renderer, as base64 of Bevy's own little-endian buffers.
/// §6.1 asks for the buffers themselves, not a name that hopes for a match somewhere else.
fn export_mesh(mesh: &Mesh) -> serde_json::Value {
    let positions = match mesh.attribute(Mesh::ATTRIBUTE_POSITION) {
        Some(VertexAttributeValues::Float32x3(entries)) => entries.clone(),
        Some(other) => refuse(&format!("UNSUPPORTED_POSITION:{}", attribute_name(other))),
        None => refuse("POSITION_ATTRIBUTE_ABSENT"),
    };
    let normals = match mesh.attribute(Mesh::ATTRIBUTE_NORMAL) {
        Some(VertexAttributeValues::Float32x3(entries)) => entries.clone(),
        _ => Vec::new(),
    };
    let uvs = match mesh.attribute(Mesh::ATTRIBUTE_UV_0) {
        Some(VertexAttributeValues::Float32x2(entries)) => entries.clone(),
        _ => Vec::new(),
    };
    let tangents = match mesh.attribute(Mesh::ATTRIBUTE_TANGENT) {
        Some(VertexAttributeValues::Float32x4(entries)) => entries.clone(),
        _ => Vec::new(),
    };
    let indices: Vec<u32> = match mesh.indices() {
        Some(Indices::U32(entries)) => entries.clone(),
        Some(Indices::U16(entries)) => entries.iter().map(|value| *value as u32).collect(),
        None => Vec::new(),
    };
    let index_bytes: Vec<u8> = indices.iter().flat_map(|value| value.to_le_bytes()).collect();
    json!({
        "indexCount": indices.len(),
        "indices": b64(&index_bytes),
        "normals": b64(&f32_bytes(&normals)),
        "positions": b64(&f32_bytes(&positions)),
        "tangents": b64(&f32_bytes(&tangents)),
        "triangles": indices.len() / 3,
        "uvs": b64(&f32_bytes(&uvs)),
        "vertices": positions.len(),
    })
}

/// The vendored file behind a texture handle, read from the checkout `BEVY_ASSET_ROOT` names, so the
/// counterpart arm decodes the same PNG bytes this run sampled rather than a re-encoded copy.
fn asset_file(asset_server: &AssetServer, handle: &Handle<Image>, relative: &str) -> std::path::PathBuf {
    let Some(path) = asset_server.get_path(handle) else {
        refuse("TEXTURE_PATH_ABSENT");
    };
    let root = std::env::var("BEVY_ASSET_ROOT").unwrap_or_else(|_| refuse("ASSET_ROOT_UNSET"));
    std::path::Path::new(&root)
        .join("assets")
        .join(path.path())
        .with_extension(relative)
}

type NodeRow = (
    Entity,
    i64,
    Option<Handle<Mesh>>,
    Option<Handle<StandardMaterial>>,
    Transform,
);

/// Walks the city from its root in `Children` order — Bevy's linked collection preserves insertion
/// order, so this is the same order `spawn_city` created the nodes in — and records every node's
/// local transform, geometry and material. Breadth-first: the order only has to be consistent
/// between the two arms, and the parent column is what carries the hierarchy.
fn walk_city(
    root: Entity,
    children: &Query<&Children>,
    meshes: &Query<&Mesh3d>,
    materials: &Query<&MeshMaterial3d<StandardMaterial>>,
    transforms: &Query<&Transform>,
) -> Vec<NodeRow> {
    let mut out: Vec<NodeRow> = Vec::new();
    let mut queue: Vec<(Entity, i64)> = vec![(root, -1)];
    let mut index = 0usize;
    while index < queue.len() {
        let (entity, parent) = queue[index];
        index += 1;
        let position = out.len() as i64;
        let Ok(transform) = transforms.get(entity) else {
            refuse("NODE_TRANSFORM_ABSENT");
        };
        out.push((
            entity,
            parent,
            meshes.get(entity).ok().map(|mesh| mesh.0.clone()),
            materials.get(entity).ok().map(|material| material.0.clone()),
            *transform,
        ));
        if let Ok(list) = children.get(entity) {
            queue.extend(list.iter().map(|child| (child, position)));
        }
    }
    out
}

/// Exports the canonical fixture. Runs once, in `Last`, after the census has been unchanged for
/// `STABLE_TICKS` consecutive ticks, so the city and every `WorldAssetRoot` scene are complete.
#[allow(clippy::too_many_arguments)]
pub(super) fn export(
    args: &Args,
    runs: CarRuns,
    census: &Census,
    root: Entity,
    children: &Query<&Children>,
    meshes_assets: &Assets<Mesh>,
    materials_assets: &Assets<StandardMaterial>,
    images_assets: &Assets<Image>,
    asset_server: &AssetServer,
    mesh_handles: &Query<&Mesh3d>,
    material_handles: &Query<&MeshMaterial3d<StandardMaterial>>,
    transforms: &Query<&Transform>,
    roads: &Query<&Road>,
    cars: &Query<&Car>,
    camera: &Query<(&Transform, &Projection), With<Camera>>,
    light: &Query<(&DirectionalLight, &Transform)>,
    _settings: &Settings,
    windows: &Query<&Window, With<PrimaryWindow>>,
) -> (serde_json::Value, Vec<(u32, Entity)>, Vec<(u32, Entity)>) {
    // Dense mesh and material indices, because the counterpart arm resolves them against the
    // exported arrays; the `AssetId` each came from is kept beside them as provenance.
    let mut mesh_ids: Vec<String> = Vec::new();
    let mut mesh_values: Vec<serde_json::Value> = Vec::new();
    // Dense mesh index, its `AssetId` as provenance, and its triangle count: the caller never reads
    // `mesh_values` while the resolver that borrows it is alive, so it gets what it needs back.
    let mut resolve_mesh = |handle: &Handle<Mesh>| -> (usize, String, u64) {
        let id = format!("mesh:{}", handle.id());
        if let Some(existing) = mesh_ids.iter().position(|value| value == &id) {
            let triangles = mesh_values[existing]["triangles"].as_u64().unwrap_or_default();
            return (existing, id, triangles);
        }
        let Some(mesh) = meshes_assets.get(handle) else {
            refuse("MESH_ASSET_MISSING");
        };
        let value = export_mesh(mesh);
        let triangles = value["triangles"].as_u64().unwrap_or_default();
        mesh_ids.push(id.clone());
        mesh_values.push(value);
        (mesh_values.len() - 1, id, triangles)
    };
    let mut material_ids: Vec<String> = Vec::new();
    let mut material_values: Vec<serde_json::Value> = Vec::new();
    let mut image_ids: Vec<String> = Vec::new();
    let mut image_values: Vec<serde_json::Value> = Vec::new();
    let mut resolve_image = |handle: &Handle<Image>| -> usize {
        let id = format!("image:{}", handle.id());
        if let Some(existing) = image_ids.iter().position(|value| value == &id) {
            return existing;
        }
        let Some(image) = images_assets.get(handle) else {
            refuse("IMAGE_ASSET_MISSING");
        };
        // The vendored file is the source of truth and this pack ships only PNGs, so the bytes are
        // the asset's own rather than a re-encoding; the reader decodes them with the same decoder.
        let path = asset_file(asset_server, handle, "png");
        let bytes = match fs::read(&path) {
            Ok(bytes) if !bytes.is_empty() => bytes,
            _ => refuse("TEXTURE_FILE_UNREADABLE"),
        };
        image_ids.push(id);
        image_values.push(json!({
            "bytes": b64(&bytes),
            "height": image.texture_descriptor.size.height,
            "path": path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default(),
            "width": image.texture_descriptor.size.width,
        }));
        image_values.len() - 1
    };
    let mut resolve_material =
        |handle: &Handle<StandardMaterial>| -> (usize, String, serde_json::Value) {
        let id = format!("material:{}", handle.id());
        if let Some(existing) = material_ids.iter().position(|value| value == &id) {
            return (existing, id, material_values[existing].clone());
        }
        let Some(material) = materials_assets.get(handle) else {
            refuse("MATERIAL_ASSET_MISSING");
        };
        let base = material.base_color.to_srgba();
        let uncarried = uncarried_fields(material);
        if !uncarried.is_empty() {
            // Fail closed: a material feature the counterpart cannot express is a named difference,
            // never a silently lower-quality substitute (§6.3).
            eprintln!("ENGINE_LOAD_TEST_FAILED TN_BENCH_CITY_MATERIAL_FIELD_UNCARRIED:{uncarried:?}");
            std::process::exit(1);
        }
        let mut slot = |handle: &Option<Handle<Image>>| -> serde_json::Value {
            match handle {
                Some(value) => json!(resolve_image(value)),
                None => serde_json::Value::Null,
            }
        };
        let emissive = material.emissive;
        let specular = material.specular_tint.to_srgba();
        let value = json!({
            "alphaMode": format!("{:?}", material.alpha_mode),
            "baseColor": [
                num(base.red), num(base.green), num(base.blue), num(base.alpha)
            ],
            "baseColorChannel": num(uv(&material.base_color_channel)),
            "baseColorTexture": slot(&material.base_color_texture),
            "cullMode": format!("{:?}", material.cull_mode),
            "emissive": [num(emissive.red), num(emissive.green), num(emissive.blue)],
            "emissiveChannel": num(uv(&material.emissive_channel)),
            "emissiveExposureWeight": num(material.emissive_exposure_weight),
            "emissiveTexture": slot(&material.emissive_texture),
            "metallic": num(material.metallic),
            "metallicRoughnessChannel": num(uv(&material.metallic_roughness_channel)),
            "metallicRoughnessTexture": slot(&material.metallic_roughness_texture),
            "normalChannel": num(uv(&material.normal_map_channel)),
            "normalTexture": slot(&material.normal_map_texture),
            "occlusionChannel": num(uv(&material.occlusion_channel)),
            "occlusionTexture": slot(&material.occlusion_texture),
            "perceptualRoughness": num(material.perceptual_roughness),
            "reflectance": num(material.reflectance),
            "specularTint": [
                num(specular.red), num(specular.green), num(specular.blue), num(specular.alpha)
            ],
            "unlit": material.unlit,
        });
        material_ids.push(id.clone());
        material_values.push(value.clone());
        (material_values.len() - 1, id, value)
    };

    let nodes = walk_city(root, children, mesh_handles, material_handles, transforms);
    // The gate that opened this phase saw the same city for STABLE_TICKS consecutive ticks; if the
    // walk disagrees with it the city changed under the gate and the census in the fixture would be
    // of a different scene than the one that is about to be measured.
    let mesh_nodes = nodes
        .iter()
        .filter(|entry| entry.2.is_some() && entry.3.is_some())
        .count() as u32;
    if nodes.len() as u32 != census.nodes || mesh_nodes != census.mesh_nodes {
        refuse(&format!(
            "CENSUS_MOVED:{} nodes / {} mesh nodes against the gate's {} / {}",
            nodes.len(),
            mesh_nodes,
            census.nodes,
            census.mesh_nodes
        ));
    }
    let index_of: std::collections::HashMap<Entity, u32> = nodes
        .iter()
        .enumerate()
        .map(|(index, (entity, ..))| (*entity, index as u32))
        .collect();
    let mut node_rows: Vec<serde_json::Value> = Vec::with_capacity(nodes.len());
    let mut triangles_in_census = 0u64;
    for (entity, parent, mesh, material, transform) in &nodes {
        let (geometry, geometry_asset, material_id, material_asset) = match (mesh, material) {
            (Some(mesh), Some(material)) => {
                let (geometry, asset, triangles) = resolve_mesh(mesh);
                let (material_id, material_asset, _material_value) = resolve_material(material);
                triangles_in_census += triangles;
                (json!(geometry), Some(asset), json!(material_id), Some(material_asset))
            }
            _ => (serde_json::Value::Null, None, serde_json::Value::Null, None),
        };
        let _ = entity;
        node_rows.push(json!([
            parent,
            geometry,
            material_id,
            triple(transform.translation),
            quat(transform.rotation),
            triple(transform.scale),
            geometry_asset,
            material_asset,
        ]));
    }

    // Roads in the same walk order, so a car can name the road it is a child of by index.
    let mut road_rows: Vec<serde_json::Value> = Vec::new();
    let mut road_index: std::collections::HashMap<Entity, u32> = std::collections::HashMap::new();
    for (entity, ..) in &nodes {
        let Some(road) = roads.get(*entity).ok() else {
            continue;
        };
        road_index.insert(*entity, road_rows.len() as u32);
        road_rows.push(json!([triple(road.start), triple(road.end)]));
    }
    let mut car_rows: Vec<serde_json::Value> = Vec::new();
    for (entity, parent_of, ..) in &nodes {
        let Some(car) = cars.get(*entity).ok() else {
            continue;
        };
        let Some(parent) = usize::try_from(*parent_of).ok().and_then(|index| nodes.get(index)) else {
            refuse("CAR_PARENT_ABSENT");
        };
        let Some(road) = road_index.get(&parent.0) else {
            refuse("CAR_ROAD_ABSENT");
        };
        let Some(position) = index_of.get(entity) else {
            refuse("CAR_INDEX_ABSENT");
        };
        let Ok(transform) = transforms.get(*entity) else {
            refuse("CAR_TRANSFORM_ABSENT");
        };
        // The lane `offset` the recurrence needs and the local translation the car was carrying when
        // the fixture was written, which on a static arm is the one it keeps for the whole run.
        car_rows.push(json!([
            position,
            road,
            num(car.dir),
            num(car.distance_traveled),
            triple(car.offset),
            triple(transform.translation),
            quat(transform.rotation),
            triple(transform.scale),
        ]));
    }

    // The probes: the first, two interior points and the last node, plus the first few cars of the
    // first two roads. The node probes are the hierarchy's own arithmetic — a flat authoring that
    // forgot the parent chain moves them — and the car probes are `simulate_cars`' arithmetic.
    let probe_nodes: Vec<u32> = if nodes.is_empty() {
        refuse("EMPTY_CITY");
    } else if nodes.len() <= NODE_PROBES {
        (0..nodes.len() as u32).collect()
    } else {
        vec![0, (nodes.len() / 4) as u32, (nodes.len() / 2) as u32, nodes.len() as u32 - 1]
    };
    let probe_cars: Vec<u32> = (0..CAR_PROBES.min(car_rows.len()) as u32).collect();
    let probes: Vec<(u32, Entity)> = probe_nodes
        .iter()
        .filter_map(|index| usize::try_from(*index).ok().and_then(|slot| nodes.get(slot)).map(|row| (*index, row.0)))
        .collect();
    let car_probes: Vec<(u32, Entity)> = probe_cars
        .iter()
        .filter_map(|index| {
            let row = car_rows.get(*index as usize)?;
            let node = row[0].as_u64()? as usize;
            nodes.get(node).map(|entry| (*index, entry.0))
        })
        .collect();
    if probes.len() != probe_nodes.len() || car_probes.len() != probe_cars.len() {
        refuse("PROBE_CENSUS");
    }

    let Ok((camera_transform, projection)) = camera.single() else {
        refuse("CAMERA_CENSUS");
    };
    let (fov_degrees, near, far) = match projection {
        Projection::Perspective(perspective) => (
            perspective.fov.to_degrees(),
            perspective.near,
            perspective.far,
        ),
        Projection::Orthographic(_) | Projection::Custom(_) => refuse("NON_PERSPECTIVE_CAMERA"),
    };
    let Ok((directional, light_transform)) = light.single() else {
        refuse("LIGHT_CENSUS");
    };
    let Ok(window) = windows.single() else {
        refuse("WINDOW_CENSUS");
    };
    let size = window.physical_size();
    let requested: (u32, u32) = (WINDOW_RESOLUTION.0 as u32, WINDOW_RESOLUTION.1 as u32);
    let deviation = if (size.x, size.y) == requested {
        serde_json::Value::Null
    } else {
        json!(format!(
            "requested {}x{}; this desktop's window-manager work area is 1920x1050, so both arms render {}x{}",
            requested.0, requested.1, size.x, size.y
        ))
    };

    let fixture = json!({
        "camera": {
            "far": num(far),
            "fovDegrees": num(fov_degrees),
            "near": num(near),
            "position": triple(camera_transform.translation),
            "rotation": quat(camera_transform.rotation),
        },
        "carFields": ["nodeIndex", "roadIndex", "dir", "distanceTraveled", "offset", "translation", "rotation", "scale"],
        "cars": car_rows,
        "census": {
            "cars": car_rows.len(),
            "groupNodes": nodes.len() as u32 - mesh_nodes,
            "meshes": mesh_values.len(),
            "meshNodes": mesh_nodes,
            "materials": material_values.len(),
            "images": image_values.len(),
            "nodes": nodes.len(),
            "roads": road_rows.len(),
            "trianglesInCensus": triangles_in_census,
        },
        "environment": {
            "atmosphere": match args.profile {
                Profile::Common => "none",
                Profile::Upstream => "bevy-earth-atmosphere-with-low-fog, scaled 1/20",
            },
            "background": "bevy-window-clear",
            "contactShadowsEnabled": directional.contact_shadows_enabled,
            "exposure": "Exposure::OVERCAST",
            "postProcess": match args.profile {
                Profile::Common => "none; Msaa::Off",
                Profile::Upstream => "Bloom::NATURAL, TemporalAntiAliasing, Msaa::Off",
            },
            "shadowMapsEnabled": directional.shadow_maps_enabled,
        },
        "family": "bevy-city",
        "frameSchedule": {
            "carSpeedPerSecond": CAR_SPEED,
            "frameDelta": FRAME_DELTA,
            "firstScoredFrameCarApplications": runs.applications,
            "measuredFrames": args.measured_frames,
            "settleFrames": SETTLE_FRAMES,
            "simulateCarsAtExport": runs.applications,
            "stableTicksBeforeExport": STABLE_TICKS,
            "warmupFrames": args.warmup_frames,
        },
        "images": image_values,
        "light": {
            "illuminanceLux": num(130_000.0),
            "rotation": quat(light_transform.rotation),
        },
        "licenses": [{
            "appliesTo": "every vendored Kenney asset in this fixture's images and geometry",
            "license": "CC0-1.0",
            "note": "retained separately from bevy's own MIT OR Apache-2.0 code license, as §4 requires",
            "source": "https://github.com/bevyengine/bevy_asset_files/raw/main/kenney",
        }],
        "materials": material_values,
        "meshes": mesh_values,
        "nodeFields": ["parent", "geometryId", "materialId", "translation", "rotation", "scale", "geometryAsset", "materialAsset"],
        "nodes": node_rows,
        "probeCars": probe_cars,
        "probeNodes": probe_nodes,
        "profile": match args.profile {
            Profile::Common => "common",
            Profile::Upstream => "upstream",
        },
        "roadFields": ["start", "end"],
        "roads": road_rows,
        "schedule": "bevy-city-fractional-frame-boundary/1",
        "schemaVersion": 1,
        "seed": args.seed,
        "settings": {
            "cpuCulling": _settings.cpu_culling,
            "contactShadowsEnabled": directional.contact_shadows_enabled,
            "shadowMapsEnabled": directional.shadow_maps_enabled,
            "simulateCars": _settings.simulate_cars,
            "wireframeEnabled": _settings.wireframe_enabled,
        },
        "size": args.size,
        "source": {
            "adapterSha256": crate::env_or_unrecorded("TN_BENCH_BEVY_ADAPTER_SHA256"),
            "commit": UPSTREAM_COMMIT,
            "patch": [
                "assets.rs: BASE_URL resolves the same 56 vendored Kenney files from the pinned checkout's assets/kenney instead of over HTTPS, so the run is offline and the bytes are hashable; BEVY_ASSET_ROOT must name the checkout",
                "TimeUpdateStrategy::ManualDuration(1/60) replaces Bevy's wall-clock Automatic strategy, so Time, Time<Real> and Time<Virtual> all advance exactly 1/60 s per frame and simulate_cars, which reads Res<Time>, runs on the fixture clock",
                "Args gains --variant, --profile, --warmup-frames, --measured-frames, --fixture-out and --arm; --seed is upstream's default 42 and --size defaults to 8 because this is the small fixture, upstream's 30 being the default-size cell",
                "Settings::simulate_cars is set from --variant, so static is upstream's own 'Simulate Cars' unchecked rather than an invented freeze, and Window.decorations is false so a decorating window manager cannot shrink the render attachment",
                "--profile common clears shadow flags, removes the camera's contact-shadow, atmosphere, HDR, bloom and TAA components, and omits the atmosphere entity; --profile upstream changes nothing",
                "prd449_* systems added: census-stability gate, fixture export, frame schedule, conformance probes, work counters, the simulate_cars application count, and one wgpu Device::poll(PollType::wait_indefinitely()) completion drain per boundary on the render thread; generate_city.rs and settings.rs are the pinned files byte for byte and the rest of main.rs is the pinned main.rs",
            ],
            "path": UPSTREAM_PATH,
            "upstreamSha256": crate::env_or_unrecorded("TN_BENCH_BEVY_UPSTREAM_SHA256"),
        },
        "variant": args.variant.as_str(),
        "viewport": {
            "deviation": deviation,
            "height": size.y as usize,
            "requestedHeight": requested.1 as usize,
            "requestedWidth": requested.0 as usize,
            "scaleFactor": num(window.scale_factor() as f32),
            "width": size.x as usize,
        },
    });
    (fixture, probes, car_probes)
}

/// The `StandardMaterial` fields the counterpart arm cannot express, listed by name when any of them
/// is non-default. The export refuses rather than rendering a different material and calling it
/// equivalent.
fn uncarried_fields(material: &StandardMaterial) -> Vec<&'static str> {
    let base = StandardMaterial::default();
    let mut out: Vec<&'static str> = Vec::new();
    let mut differs = |name: &'static str, value: bool| {
        if value {
            out.push(name);
        }
    };
    // A dormant feature's parameters cannot change a pixel, so each is only a difference when the
    // feature it belongs to is actually on. A glTF exporter that writes a clearcoat roughness with
    // clearcoat at zero is not asking for a clearcoat.
    let clearcoat_on = material.clearcoat != base.clearcoat;
    differs("clearcoat", clearcoat_on);
    if clearcoat_on {
        differs(
            "clearcoat_perceptual_roughness",
            material.clearcoat_perceptual_roughness != base.clearcoat_perceptual_roughness,
        );
    }
    let anisotropy_on = material.anisotropy_strength != base.anisotropy_strength;
    differs("anisotropy_strength", anisotropy_on);
    if anisotropy_on {
        differs(
            "anisotropy_rotation",
            material.anisotropy_rotation != base.anisotropy_rotation,
        );
    }
    differs(
        "diffuse_transmission",
        material.diffuse_transmission != base.diffuse_transmission,
    );
    differs(
        "specular_transmission",
        material.specular_transmission != base.specular_transmission,
    );
    differs("ior", material.ior != base.ior);
    differs(
        "attenuation_distance",
        material.attenuation_distance != base.attenuation_distance,
    );
    differs("thickness", material.thickness != base.thickness);
    differs(
        "parallax_depth_scale",
        material.parallax_depth_scale != base.parallax_depth_scale,
    );
    differs(
        "flip_normal_map_y",
        material.flip_normal_map_y != base.flip_normal_map_y,
    );
    differs("depth_bias", material.depth_bias != base.depth_bias);
    out
}

// ---------------------------------------------------------------------------------------------
// The run report and the render-thread drain.
// ---------------------------------------------------------------------------------------------

pub(super) fn finish(args: Res<Args>, measure: Res<Measure>, mut exits: MessageWriter<AppExit>) {
    if !measure.done {
        return;
    }
    let Some(fixture) = measure.fixture.clone() else {
        refuse("FIXTURE_ABSENT");
    };
    if measure.boundaries.len() != args.measured_frames as usize + 1 {
        refuse(&format!(
            "BOUNDARY_COUNT:{} expected {}",
            measure.boundaries.len(),
            args.measured_frames as usize + 1
        ));
    }
    let start = measure.boundaries[0].1;
    let last = measure.boundaries[measure.boundaries.len() - 1].1;
    let Some(final_completion) = measure.final_completion_ms.filter(|value| *value > 0.0) else {
        refuse("FINAL_COMPLETION_ABSENT");
    };
    if final_completion < last {
        refuse("FINAL_COMPLETION_BEFORE_LAST_BOUNDARY");
    }
    let adapter = ADAPTER_JSON
        .lock()
        .ok()
        .and_then(|value| value.clone())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .unwrap_or(serde_json::Value::Null);

    let report = json!({
        "adapter": adapter,
        "arm": args.arm.clone().unwrap_or_else(|| "bevy-desktop".to_string()),
        "boundarySemantics": "render-producing frame boundary at the end of the main schedule; each interval carries the previous frame's update, its render submission and any GPU wait",
        "build": {
            "binary": crate::env_or_unrecorded("TN_BENCH_BEVY_BINARY"),
            "features": crate::env_or_unrecorded("TN_BENCH_BEVY_FEATURES"),
            "profile": "release",
            "type": "rust",
        },
        "census": fixture["census"].clone(),
        "drain": {
            "boundaryFrame": args.measured_frames,
            "includesUntimedFrames": 1,
            "waitMs": measure.final_drain_wait_ms.unwrap_or_default(),
        },
        "engine": { "name": "bevy", "version": "0.19.0" },
        "family": "bevy-city",
        "fixture": {
            "nodes": fixture["census"]["nodes"].clone(),
            "path": args.fixture_out,
            "sourceCommit": UPSTREAM_COMMIT,
        },
        "frameSchedule": fixture["frameSchedule"].clone(),
        "meanMs": (final_completion - start) / args.measured_frames as f64,
        "profile": "smoke",
        "rawSeries": {
            "boundaries": measure.boundaries.iter().map(|(frame_id, stamp)| json!({
                "frameId": frame_id,
                "monotonicMs": *stamp,
            })).collect::<Vec<serde_json::Value>>(),
            "finalCompletionMs": final_completion,
            "schemaVersion": 1,
            "unit": "ms",
        },
        "settings": fixture["settings"].clone(),
        "simulateCarsApplications": {
            "atExport": fixture["frameSchedule"]["simulateCarsAtExport"].clone(),
            "atFirstScoredFrame": measure.car_runs_at_first_boundary,
            "atSampledFrames": measure.runs_at_sample.iter().map(|(frame_id, count)| json!({
                "frameId": frame_id,
                "simulateCarsApplications": count,
            })).collect::<Vec<serde_json::Value>>(),
            "note": "simulate_cars runs on every arm, including the static one where it early-returns, so this count is the system's own invocation count and the sampled car positions carry the evidence that it moved them",
        },
        "states": measure.states.clone(),
        "variant": fixture["variant"].clone(),
        "viewport": {
            "deviation": fixture["viewport"]["deviation"].clone(),
            "height": fixture["viewport"]["height"].clone(),
            "width": fixture["viewport"]["width"].clone(),
        },
        "warmupFrames": args.warmup_frames,
        "work": measure.work.clone().unwrap_or(serde_json::Value::Null),
    });
    let payload = serde_json::to_string(&report).unwrap_or_else(|_| "{}".to_string());
    println!("ENGINE_LOAD_TEST_JSON_BEGIN");
    for chunk in payload.as_bytes().chunks(800) {
        println!("TNJSON:{}", String::from_utf8_lossy(chunk));
    }
    println!("ENGINE_LOAD_TEST_JSON_END");
    exits.write(AppExit::Success);
}

/// The render-thread half. One atomic load per frame when there is nothing to do, and the only
/// place in this process that can wait on the GPU.
pub(super) fn render_boundary(device: Res<RenderDevice>, adapter: Res<RenderAdapterInfo>) {
    if ADAPTER_JSON
        .lock()
        .map(|value| value.is_none())
        .unwrap_or(false)
    {
        let info = &*adapter.0;
        let summary = json!({
            "backend": format!("{:?}", info.backend),
            "deviceType": format!("{:?}", info.device_type),
            "driver": info.driver.clone(),
            "driverInfo": info.driver_info.clone(),
            "name": info.name.clone(),
        });
        if let Ok(mut slot) = ADAPTER_JSON.lock() {
            *slot = Some(summary.to_string());
        }
    }
    if !DRAIN_REQUESTED.swap(false, Ordering::SeqCst) {
        return;
    }
    let requested = crate::now_ms();
    // The one completion wait of the run: every submission made up to this point, including the
    // last measured frame's, has completed when it returns.
    let _ = device.wgpu_device().poll(PollType::wait_indefinitely());
    let completed = crate::now_ms();
    DRAIN_WAIT_MS.store((completed - requested).to_bits(), Ordering::SeqCst);
    DRAIN_COMPLETED_MS.store(completed.to_bits(), Ordering::SeqCst);
    DRAIN_COUNT.fetch_add(1, Ordering::SeqCst);
}
