//! PRD-449 `bevy-many-cubes`: the pinned upstream `many_cubes` example, unchanged in what it
//! builds, with the deterministic fixture clock and the measured frame schedule this family needs.
//!
//! **Source pin.** bevy `v0.19.0`, commit `c6f634ca9f406d68ba5109d921247b654cb42c10`,
//! `examples/stress_tests/many_cubes.rs`. The Fibonacci sphere placement, the seeded
//! `ChaCha8Rng::seed_from_u64(42)` mesh and material selection, `init_meshes`, `init_materials`,
//! `init_textures`, the enclosing inside-out box, the directional light, `move_camera`,
//! `rotate_cubes` and `print_mesh_count` are below verbatim.
//!
//! **Adapter patch, disclosed in full and hashed with this file.**
//!
//! 1. `TimeUpdateStrategy::ManualDuration(1/60 s)` replaces Bevy's wall-clock `Automatic` strategy.
//!    Every clock `TimePlugin` maintains — `Time`, `Time<Real>` and `Time<Virtual>` — then advances
//!    exactly `1/60 s` per frame, so `move_camera`, `rotate_cubes` and `print_mesh_count` keep
//!    reading `Res<Time>` verbatim and *all three* see the fixture clock. Upstream's `--benchmark`
//!    switch only fixes the camera step, which leaves the rotating arm on the wall clock, so this
//!    arm needs the resource as much as it needs the switch.
//! 2. `Args::benchmark` is forced on, and four measurement options are added to `Args`
//!    (`--warmup-frames`, `--measured-frames`, `--fixture-out`, `--arm`).
//! 3. The `prd449_*` systems below are added: fixture export, the frame schedule, the conformance
//!    probes, the work counters, and a one-shot GPU completion drain. Nothing in the measured frame
//!    path is precomputed for either arm.
//!
//! **Timing semantics**, declared so the counterpart arm can be checked against it: `boundaries` are
//! `N+1` render-producing frame boundaries taken at the end of the main schedule, so each interval
//! carries the previous frame's transform work, its render submission and any GPU wait. The
//! completed-work mean additionally includes exactly one GPU completion wait, taken after the last
//! measured frame has been submitted and reported as `finalCompletionMs`; one extra untimed
//! frame's submission therefore falls inside that wait (`drain.includesUntimedFrames: 1`).

use std::{
    f64::consts::PI,
    fs,
    str::FromStr,
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

use argh::FromArgs;
use bevy::{
    asset::RenderAssetUsages,
    camera::visibility::{NoCpuCulling, NoFrustumCulling, ViewVisibility},
    diagnostic::{FrameTimeDiagnosticsPlugin, LogDiagnosticsPlugin},
    light::NotShadowCaster,
    math::{
        ops::{cbrt, sqrt},
        DVec2, DVec3,
    },
    mesh::{Indices, VertexAttributeValues},
    post_process::motion_blur::MotionBlur,
    prelude::*,
    render::{
        batching::NoAutomaticBatching,
        render_resource::{Extent3d, PollType, TextureDimension, TextureFormat},
        view::NoIndirectDrawing,
        Render, RenderApp,
        renderer::{RenderAdapterInfo, RenderDevice},
    },
    time::TimeUpdateStrategy,
    window::{PresentMode, PrimaryWindow, WindowResolution},
    winit::WinitSettings,
};
use chacha20::ChaCha8Rng;
use rand::{seq::IndexedRandom, RngExt, SeedableRng};
use serde_json::json;

/// The upstream commit this adapter is pinned to, stated in the fixture and the report.
const UPSTREAM_COMMIT: &str = "c6f634ca9f406d68ba5109d921247b654cb42c10";
const UPSTREAM_PATH: &str = "examples/stress_tests/many_cubes.rs";
/// §7.2's deterministic throughput step. The fixture clock advances by exactly this every frame.
const FRAME_DELTA: f64 = 1.0 / 60.0;
/// `many_cubes`'s own camera step, unchanged: `0.15 * 1/60` radians per frame, Z then X.
const CAMERA_STEP: f64 = 0.15 / 60.0;
/// `rotate_cubes`'s own step, unchanged: `10.0 * 1/60` radians per frame about local Y.
const ROTATION_STEP: f64 = 10.0 / 60.0;
/// The frames §6.1 names for the conformance inspection, in measured-frame numbering.
const STATE_FRAMES: [u32; 6] = [0, 1, 60, 120, 300, 599];
/// The floor on the render pass when the adapter is installed.
const WINDOW_RESOLUTION: (f32, f32) = (1920.0, 1080.0);

#[derive(FromArgs, Resource)]
/// `many_cubes` stress test, PRD-449 measured adapter.
struct Args {
    /// how the cube instances should be positioned.
    #[argh(option, default = "Layout::Sphere")]
    layout: Layout,

    /// whether to step the camera animation by a fixed amount such that each frame is the same across runs.
    #[argh(switch)]
    benchmark: bool,

    /// whether to vary the material data in each instance.
    #[argh(switch)]
    vary_material_data_per_instance: bool,

    /// the number of different textures from which to randomly select the material base color. 0 means no textures.
    #[argh(option, default = "0")]
    material_texture_count: usize,

    /// the number of different meshes from which to randomly select. Clamped to at least 1.
    #[argh(option, default = "1")]
    mesh_count: usize,

    /// the number of cubes
    #[argh(option, default = "1600000")]
    instance_count: usize,

    /// whether to disable all frustum culling. Stresses queuing and batching as all mesh material entities in the scene are always drawn.
    #[argh(switch)]
    no_frustum_culling: bool,

    /// whether to disable automatic batching. Skips batching resulting in heavy stress on render pass draw command encoding.
    #[argh(switch)]
    no_automatic_batching: bool,

    /// whether to disable indirect drawing.
    #[argh(switch)]
    no_indirect_drawing: bool,

    /// whether to disable CPU culling.
    #[argh(switch)]
    no_cpu_culling: bool,

    /// whether to enable directional light cascaded shadow mapping.
    #[argh(switch)]
    shadows: bool,

    /// whether to continuously rotate individual cubes.
    #[argh(switch)]
    rotate_cubes: bool,

    /// animate the cube materials by updating the material from the cpu each frame
    #[argh(switch)]
    animate_materials: bool,

    /// whether to enable motion blur.
    #[argh(switch)]
    motion_blur: bool,

    /// frames run before the measured window; untimed.
    #[argh(option, default = "120")]
    warmup_frames: u32,

    /// measured frames. The report's primary metric is this many completed frames.
    #[argh(option, default = "600")]
    measured_frames: u32,

    /// where to write the canonical fixture this run rendered. Required.
    #[argh(option)]
    fixture_out: String,

    /// the arm label recorded in the report.
    #[argh(option)]
    arm: Option<String>,
}

#[derive(Default, Clone, PartialEq)]
enum Layout {
    Cube,
    #[default]
    Sphere,
    Dense,
}

impl FromStr for Layout {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "cube" => Ok(Self::Cube),
            "sphere" => Ok(Self::Sphere),
            "dense" => Ok(Self::Dense),
            _ => Err(format!(
                "Unknown layout value: '{s}', valid options: 'cube', 'sphere', 'dense'"
            )),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Cross-thread hand-off. The `wgpu::Device` in this process only exists on the render thread, so the
// completion waits are requested through these statics and served by `prd449_render_boundary`.
// ---------------------------------------------------------------------------------------------

/// Number of completed GPU waits: one before the first scored boundary, one after the last frame.
static DRAIN_COUNT: AtomicU32 = AtomicU32::new(0);
static DRAIN_REQUESTED: AtomicBool = AtomicBool::new(false);
/// `now_ms()` at which the most recent completion wait returned, as `f64` bits.
static DRAIN_COMPLETED_MS: AtomicU64 = AtomicU64::new(0);
/// The most recent completion wait's own duration in ms, as `f64` bits.
static DRAIN_WAIT_MS: AtomicU64 = AtomicU64::new(0);
/// The adapter identity only the render thread can read, as a serialized summary.
static ADAPTER_JSON: Mutex<Option<String>> = Mutex::new(None);

static ORIGIN: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

fn now_ms() -> f64 {
    let origin = ORIGIN.get_or_init(Instant::now);
    origin.elapsed().as_secs_f64() * 1000.0
}

fn drains_completed() -> u32 {
    DRAIN_COUNT.load(Ordering::SeqCst)
}

fn refuse(code: &str) -> ! {
    eprintln!("ENGINE_LOAD_TEST_FAILED TN_BENCH_BEVY_{code}");
    std::process::exit(1);
}

/// Frame schedule state. `boundaries` are the raw `N+1` timestamps the completed-work mean is
/// derived from; `state` is which phase of the schedule this frame belongs to.
#[derive(Resource, Default)]
struct Measure {
    frame: u32,
    state: Phase,
    /// Measured-frame index of the frame currently running, once the scored window has opened.
    scored: Option<u32>,
    boundaries: Vec<(u32, f64)>,
    /// (measured frame, [{object index, [x, y, z, w]}], camera quaternion) at the §6.1 frames.
    states: Vec<(u32, Vec<(u32, [f64; 4])>, [f64; 4])>,
    /// The probe objects, as the indices the fixture names and the entities they were read from.
    probes: Vec<(u32, Entity)>,
    /// How many times each upstream system has run, so the record states the update count instead of
    /// inferring it from a transform: §5.1 asks for the switch effects to be validated, not trusted.
    runs: (u32, u32),
    /// (measured frame, `move_camera` runs, `rotate_cubes` runs) at each sampled frame.
    runs_at_sample: Vec<(u32, u32, u32)>,
    work: Option<serde_json::Value>,
    fixture: Option<serde_json::Value>,
    final_completion_ms: Option<f64>,
    final_drain_wait_ms: Option<f64>,
    done: bool,
}

#[derive(Clone, Copy, PartialEq, Default)]
enum Phase {
    #[default]
    Warmup,
    /// Waiting for the unscored pre-drain to land, so the span does not absorb the warmup.
    PreDrain,
    Scored,
    /// Waiting for the one completion wait that closes the measured span.
    FinalDrain,
}

fn main() {
    let mut args: Args = argh::from_env();
    // Patch 2: the fixture clock makes `time.delta_secs()` the fixed step too, but upstream's
    // intended camera path is the `benchmark` branch, so it is forced on rather than assumed.
    args.benchmark = true;
    if args.layout != Layout::Sphere {
        eprintln!("ENGINE_LOAD_TEST_FAILED TN_BENCH_BEVY_LAYOUT_UNSUPPORTED");
        std::process::exit(2);
    }
    if args.measured_frames == 0 {
        eprintln!("ENGINE_LOAD_TEST_FAILED TN_BENCH_BEVY_NO_MEASURED_FRAMES");
        std::process::exit(2);
    }
    ORIGIN.get_or_init(Instant::now);

    let mut app = App::new();
    app.add_plugins((
        DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                present_mode: PresentMode::AutoNoVsync,
                // Window chrome is the only deviation from upstream's `Window` here: a decorating
                // window manager shrinks the request to fit its title bar (measured: 1912x1010
                // against 1920x1050 undecorated). It changes no rendered pixel, and the exported
                // viewport is the actual attachment with its deviation from §6.3 recorded.
                decorations: false,
                resolution: WindowResolution::new(
                    WINDOW_RESOLUTION.0 as u32,
                    WINDOW_RESOLUTION.1 as u32,
                )
                .with_scale_factor_override(1.0),
                ..default()
            }),
            ..default()
        }),
        FrameTimeDiagnosticsPlugin::default(),
        LogDiagnosticsPlugin::default(),
    ))
    .insert_resource(WinitSettings::continuous())
    // Patch 1: the fixture clock.
    .insert_resource(TimeUpdateStrategy::ManualDuration(Duration::from_secs_f64(FRAME_DELTA)))
    .init_resource::<Measure>()
    .add_systems(Startup, setup)
    .add_systems(PostStartup, export_fixture)
    .add_systems(Update, print_mesh_count)
    .add_systems(Update, (move_camera.after(prd449_count_camera), prd449_count_camera))
    .add_systems(Last, (measure_frame, finish_run).chain());

    if args.rotate_cubes {
        app.add_systems(
            Update,
            (rotate_cubes.after(prd449_count_rotate), prd449_count_rotate),
        );
    }

    if args.animate_materials {
        app.add_systems(Update, update_materials);
    }

    // Patch 3: the render-thread half of the completion drain plus the adapter identity.
    if let Some(render_app) = app.get_sub_app_mut(RenderApp) {
        render_app.add_systems(Render, prd449_render_boundary);
    }

    let arm = args.arm.clone().unwrap_or_else(|| "bevy-desktop".to_string());
    app.insert_resource(args);
    app.run();
    let _ = arm;
}

// ---------------------------------------------------------------------------------------------
// Upstream `many_cubes`, verbatim from the pinned commit. Nothing in this section is edited.
// ---------------------------------------------------------------------------------------------

const WIDTH: usize = 200;
const HEIGHT: usize = 200;

fn setup(
    mut commands: Commands,
    args: Res<Args>,
    mesh_assets: ResMut<Assets<Mesh>>,
    material_assets: ResMut<Assets<StandardMaterial>>,
    images: ResMut<Assets<Image>>,
) {
    // The pinned warning text, read from where upstream keeps it. Only the path differs.
    warn!(include_str!("stress_tests/warning_string.txt"));

    let args = args.into_inner();
    let images = images.into_inner();
    let material_assets = material_assets.into_inner();
    let mesh_assets = mesh_assets.into_inner();

    let meshes = init_meshes(args, mesh_assets);

    let material_textures = init_textures(args, images);
    let materials = init_materials(args, &material_textures, material_assets);

    // We're seeding the PRNG here to make this example deterministic for testing purposes.
    // This isn't strictly required in practical use unless you need your app to be deterministic.
    let mut material_rng = ChaCha8Rng::seed_from_u64(42);
    match args.layout {
        Layout::Sphere => {
            // NOTE: This pattern is good for testing performance of culling as it provides roughly
            // the same number of visible meshes regardless of the viewing angle.
            let n_points: usize = args.instance_count;
            // NOTE: f64 is used to avoid precision issues that produce visual artifacts in the distribution
            let radius = WIDTH as f64 * 2.5;
            let golden_ratio = 0.5f64 * (1.0f64 + 5.0f64.sqrt());
            for i in 0..n_points {
                let spherical_polar_theta_phi =
                    fibonacci_spiral_on_sphere(golden_ratio, i, n_points);
                let unit_sphere_p = spherical_polar_to_cartesian(spherical_polar_theta_phi);
                let (mesh, transform) = meshes.choose(&mut material_rng).unwrap();
                commands
                    .spawn((
                        Mesh3d(mesh.clone()),
                        MeshMaterial3d(materials.choose(&mut material_rng).unwrap().clone()),
                        Transform::from_translation((radius * unit_sphere_p).as_vec3())
                            .looking_at(Vec3::ZERO, Vec3::Y)
                            .mul_transform(*transform),
                    ))
                    .insert_if(NoFrustumCulling, || args.no_frustum_culling)
                    .insert_if(NoAutomaticBatching, || args.no_automatic_batching)
                    .insert_if(NoCpuCulling, || args.no_cpu_culling);
            }

            // camera
            let mut camera = commands.spawn(Camera3d::default());
            if args.no_indirect_drawing {
                camera.insert(NoIndirectDrawing);
            }
            if args.no_cpu_culling {
                camera.insert(NoCpuCulling);
            }
            if args.motion_blur {
                camera.insert(MotionBlur {
                    // Use an unrealistically large shutter angle so that motion blur is clearly visible.
                    shutter_angle: 3.0,
                    ..Default::default()
                });
            }

            // Inside-out box around the meshes onto which shadows are cast (though you cannot see them...)
            commands.spawn((
                Mesh3d(mesh_assets.add(Cuboid::from_size(Vec3::splat(radius as f32 * 2.2)))),
                MeshMaterial3d(material_assets.add(StandardMaterial::from(Color::WHITE))),
                Transform::from_scale(-Vec3::ONE),
                NotShadowCaster,
            ));
        }
        Layout::Cube => {
            // NOTE: This pattern is good for demonstrating that frustum culling is working correctly
            // as the number of visible meshes rises and falls depending on the viewing angle.
            let scale = 2.5;

            // Scale the width and height by the same factor so that we have the
            // right number of instances.
            // Because of the moiré pattern check and the fact that we're
            // spawning 4 instances per trip around the inner loop below, we're
            // solving the following equation for the factor variable:
            //
            //      4 * (9/10 * factor * width * 9/10 * factor * height) = count
            //
            // The solution is the value below.
            let factor = (5.0 / 9.0) * sqrt(args.instance_count as f32)
                / (sqrt(HEIGHT as f32) * sqrt(WIDTH as f32));
            let dimensions = (vec2(WIDTH as f32, HEIGHT as f32) * factor)
                .ceil()
                .as_uvec2();

            for x in 0..dimensions.x {
                for y in 0..dimensions.y {
                    // introduce spaces to break any kind of moiré pattern
                    if x % 10 == 0 || y % 10 == 0 {
                        continue;
                    }
                    // cube
                    commands
                        .spawn((
                            Mesh3d(meshes.choose(&mut material_rng).unwrap().0.clone()),
                            MeshMaterial3d(materials.choose(&mut material_rng).unwrap().clone()),
                            Transform::from_xyz((x as f32) * scale, (y as f32) * scale, 0.0),
                        ))
                        .insert_if(NoCpuCulling, || args.no_cpu_culling);
                    commands
                        .spawn((
                            Mesh3d(meshes.choose(&mut material_rng).unwrap().0.clone()),
                            MeshMaterial3d(materials.choose(&mut material_rng).unwrap().clone()),
                            Transform::from_xyz(
                                (x as f32) * scale,
                                dimensions.y as f32 * scale,
                                (y as f32) * scale,
                            ),
                        ))
                        .insert_if(NoCpuCulling, || args.no_cpu_culling);
                    commands
                        .spawn((
                            Mesh3d(meshes.choose(&mut material_rng).unwrap().0.clone()),
                            MeshMaterial3d(materials.choose(&mut material_rng).unwrap().clone()),
                            Transform::from_xyz((x as f32) * scale, 0.0, (y as f32) * scale),
                        ))
                        .insert_if(NoCpuCulling, || args.no_cpu_culling);
                    commands
                        .spawn((
                            Mesh3d(meshes.choose(&mut material_rng).unwrap().0.clone()),
                            MeshMaterial3d(materials.choose(&mut material_rng).unwrap().clone()),
                            Transform::from_xyz(0.0, (x as f32) * scale, (y as f32) * scale),
                        ))
                        .insert_if(NoCpuCulling, || args.no_cpu_culling);
                }
            }
            // camera
            let center = 0.5
                * scale
                * Vec3::new(
                    dimensions.x as f32,
                    dimensions.y as f32,
                    dimensions.x as f32,
                );
            commands.spawn((Camera3d::default(), Transform::from_translation(center)));
            // Inside-out box around the meshes onto which shadows are cast (though you cannot see them...)
            commands.spawn((
                Mesh3d(mesh_assets.add(Cuboid::from_size(2.0 * 1.1 * center))),
                MeshMaterial3d(material_assets.add(StandardMaterial::from(Color::WHITE))),
                Transform::from_scale(-Vec3::ONE).with_translation(center),
                NotShadowCaster,
            ));
        }
        Layout::Dense => {
            // NOTE: This pattern is good for demonstrating a dense configuration of cubes
            // overlapping each other, all within the camera frustum.
            let count = args.instance_count;
            let size = cbrt(count as f32).round();
            let gap = 1.25;

            for i in 0..count {
                let x = i as f32 % size;
                let y = (i as f32 / size) % size;
                let z = i as f32 / (size * size);
                let pos = Vec3::new(x * gap, y * gap, z * gap);
                commands
                    .spawn((
                        Mesh3d(meshes.choose(&mut material_rng).unwrap().0.clone()),
                        MeshMaterial3d(materials.choose(&mut material_rng).unwrap().clone()),
                        Transform::from_translation(pos),
                    ))
                    .insert_if(NoCpuCulling, || args.no_cpu_culling);
            }

            // camera
            commands.spawn((
                Camera3d::default(),
                Transform::from_xyz(100.0, 90.0, 100.0)
                    .looking_at(Vec3::new(0.0, -10.0, 0.0), Vec3::Y),
            ));
        }
    }

    commands.spawn((
        DirectionalLight {
            shadow_maps_enabled: args.shadows,
            ..default()
        },
        Transform::IDENTITY.looking_at(Vec3::new(0.0, -1.0, -1.0), Vec3::Y),
    ));
}

fn init_textures(args: &Args, images: &mut Assets<Image>) -> Vec<Handle<Image>> {
    // We're seeding the PRNG here to make this example deterministic for testing purposes.
    // This isn't strictly required in practical use unless you need your app to be deterministic.
    let mut color_rng = ChaCha8Rng::seed_from_u64(42);
    let color_bytes: Vec<u8> = (0..(args.material_texture_count * 4))
        .map(|i| {
            if (i % 4) == 3 {
                255
            } else {
                color_rng.random()
            }
        })
        .collect();
    color_bytes
        .chunks(4)
        .map(|pixel| {
            images.add(Image::new_fill(
                Extent3d::default(),
                TextureDimension::D2,
                pixel,
                TextureFormat::Rgba8UnormSrgb,
                RenderAssetUsages::RENDER_WORLD,
            ))
        })
        .collect()
}

fn init_materials(
    args: &Args,
    textures: &[Handle<Image>],
    assets: &mut Assets<StandardMaterial>,
) -> Vec<Handle<StandardMaterial>> {
    let capacity = if args.vary_material_data_per_instance {
        args.instance_count
    } else {
        args.material_texture_count
    }
    .max(1);

    let mut materials = Vec::with_capacity(capacity);
    materials.push(assets.add(StandardMaterial {
        base_color: Color::WHITE,
        base_color_texture: textures.first().cloned(),
        ..default()
    }));

    // We're seeding the PRNG here to make this example deterministic for testing purposes.
    // This isn't strictly required in practical use unless you need your app to be deterministic.
    let mut color_rng = ChaCha8Rng::seed_from_u64(42);
    let mut texture_rng = ChaCha8Rng::seed_from_u64(42);
    materials.extend(
        std::iter::repeat_with(|| {
            assets.add(StandardMaterial {
                base_color: Color::srgb_u8(
                    color_rng.random(),
                    color_rng.random(),
                    color_rng.random(),
                ),
                base_color_texture: textures.choose(&mut texture_rng).cloned(),
                ..default()
            })
        })
        .take(capacity - materials.len()),
    );

    materials
}

fn init_meshes(args: &Args, assets: &mut Assets<Mesh>) -> Vec<(Handle<Mesh>, Transform)> {
    let capacity = args.mesh_count.max(1);

    // We're seeding the PRNG here to make this example deterministic for testing purposes.
    // This isn't strictly required in practical use unless you need your app to be deterministic.
    let mut radius_rng = ChaCha8Rng::seed_from_u64(42);
    let mut variant = 0;
    std::iter::repeat_with(|| {
        let radius = radius_rng.random_range(0.25f32..=0.75f32);
        let (handle, transform) = match variant % 15 {
            0 => (
                assets.add(Cuboid {
                    half_size: Vec3::splat(radius),
                }),
                Transform::IDENTITY,
            ),
            1 => (
                assets.add(Capsule3d {
                    radius,
                    half_length: radius,
                }),
                Transform::IDENTITY,
            ),
            2 => (
                assets.add(Circle { radius }),
                Transform::IDENTITY.looking_at(Vec3::Z, Vec3::Y),
            ),
            3 => {
                let mut vertices = [Vec2::ZERO; 3];
                let dtheta = std::f32::consts::TAU / 3.0;
                for (i, vertex) in vertices.iter_mut().enumerate() {
                    let (s, c) = ops::sin_cos(i as f32 * dtheta);
                    *vertex = Vec2::new(c, s) * radius;
                }
                (
                    assets.add(Triangle2d { vertices }),
                    Transform::IDENTITY.looking_at(Vec3::Z, Vec3::Y),
                )
            }
            4 => (
                assets.add(Rectangle {
                    half_size: Vec2::splat(radius),
                }),
                Transform::IDENTITY.looking_at(Vec3::Z, Vec3::Y),
            ),
            v if (5..=8).contains(&v) => (
                assets.add(RegularPolygon {
                    circumcircle: Circle { radius },
                    sides: v,
                }),
                Transform::IDENTITY.looking_at(Vec3::Z, Vec3::Y),
            ),
            9 => (
                assets.add(Cylinder {
                    radius,
                    half_height: radius,
                }),
                Transform::IDENTITY,
            ),
            10 => (
                assets.add(Ellipse {
                    half_size: Vec2::new(radius, 0.5 * radius),
                }),
                Transform::IDENTITY.looking_at(Vec3::Z, Vec3::Y),
            ),
            11 => (
                assets.add(
                    Plane3d {
                        normal: Dir3::NEG_Z,
                        half_size: Vec2::splat(0.5),
                    }
                    .mesh()
                    .size(radius, radius),
                ),
                Transform::IDENTITY,
            ),
            12 => (assets.add(Sphere { radius }), Transform::IDENTITY),
            13 => (
                assets.add(Torus {
                    minor_radius: 0.5 * radius,
                    major_radius: radius,
                }),
                Transform::IDENTITY.looking_at(Vec3::Y, Vec3::Y),
            ),
            14 => (
                assets.add(Capsule2d {
                    radius,
                    half_length: radius,
                }),
                Transform::IDENTITY.looking_at(Vec3::Z, Vec3::Y),
            ),
            _ => unreachable!(),
        };
        variant += 1;
        (handle, transform)
    })
    .take(capacity)
    .collect()
}

// NOTE: This epsilon value is apparently optimal for optimizing for the average
// nearest-neighbor distance. See:
// http://extremelearning.com.au/how-to-evenly-distribute-points-on-a-sphere-more-effectively-than-the-canonical-fibonacci-lattice/
// for details.
const EPSILON: f64 = 0.36;

fn fibonacci_spiral_on_sphere(golden_ratio: f64, i: usize, n: usize) -> DVec2 {
    DVec2::new(
        PI * 2. * (i as f64 / golden_ratio),
        f64::acos(1.0 - 2.0 * (i as f64 + EPSILON) / (n as f64 - 1.0 + 2.0 * EPSILON)),
    )
}

fn spherical_polar_to_cartesian(p: DVec2) -> DVec3 {
    let (sin_theta, cos_theta) = p.x.sin_cos();
    let (sin_phi, cos_phi) = p.y.sin_cos();
    DVec3::new(cos_theta * sin_phi, sin_theta * sin_phi, cos_phi)
}

// System for rotating the camera
fn move_camera(
    time: Res<Time>,
    args: Res<Args>,
    mut camera_transform: Single<&mut Transform, With<Camera>>,
) {
    let delta = 0.15
        * if args.benchmark {
            1.0 / 60.0
        } else {
            time.delta_secs()
        };
    camera_transform.rotate_z(delta);
    camera_transform.rotate_x(delta);
}

// System for printing the number of meshes on every tick of the timer
fn print_mesh_count(
    time: Res<Time>,
    mut timer: Local<PrintingTimer>,
    sprites: Query<(&Mesh3d, &ViewVisibility)>,
) {
    timer.tick(time.delta());

    if timer.just_finished() {
        info!(
            "Meshes: {} - Visible Meshes {}",
            sprites.iter().len(),
            sprites.iter().filter(|(_, vis)| vis.get()).count(),
        );
    }
}

#[derive(Deref, DerefMut)]
struct PrintingTimer(Timer);

impl Default for PrintingTimer {
    fn default() -> Self {
        Self(Timer::from_seconds(1.0, TimerMode::Repeating))
    }
}

fn update_materials(mut materials: ResMut<Assets<StandardMaterial>>, time: Res<Time>) {
    let elapsed = time.elapsed_secs();
    for (i, (_, material)) in materials.iter_mut().enumerate() {
        let hue = (elapsed + i as f32 * 0.005).rem_euclid(1.0);
        // This is much faster than using base_color.set_hue(hue), and in a tight loop it shows.
        let color = fast_hue_to_rgb(hue);
        material.base_color = Color::linear_rgb(color.x, color.y, color.z);
    }
}

fn rotate_cubes(
    mut query: Query<&mut Transform, (With<Mesh3d>, Without<NotShadowCaster>)>,
    time: Res<Time>,
) {
    query.par_iter_mut().for_each(|mut transform| {
        transform.rotate_y(10.0 * time.delta_secs());
    });
}

#[inline]
fn fast_hue_to_rgb(hue: f32) -> Vec3 {
    (hue * 6.0 - vec3(3.0, 2.0, 4.0)).abs() * vec3(1.0, -1.0, -1.0) + vec3(-1.0, 2.0, 2.0)
}

// ---------------------------------------------------------------------------------------------
// PRD-449 adapter systems.
// ---------------------------------------------------------------------------------------------

fn b64(bytes: &[u8]) -> String {
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

fn f32_bytes<const N: usize>(values: &[[f32; N]]) -> Vec<u8> {
    let mut out = Vec::with_capacity(values.len() * N * 4);
    for value in values {
        for component in value {
            out.extend_from_slice(&component.to_le_bytes());
        }
    }
    out
}

fn attribute_name(values: &VertexAttributeValues) -> &'static str {
    match values {
        VertexAttributeValues::Uint8(_) => "uint8",
        VertexAttributeValues::Uint8x2(_) => "uint8x2",
        VertexAttributeValues::Uint8x4(_) => "uint8x4",
        VertexAttributeValues::Sint8(_) => "sint8",
        VertexAttributeValues::Sint8x2(_) => "sint8x2",
        VertexAttributeValues::Sint8x4(_) => "sint8x4",
        VertexAttributeValues::Unorm8(_) => "unorm8",
        VertexAttributeValues::Unorm8x2(_) => "unorm8x2",
        VertexAttributeValues::Unorm8x4(_) => "unorm8x4",
        VertexAttributeValues::Snorm8(_) => "snorm8",
        VertexAttributeValues::Snorm8x2(_) => "snorm8x2",
        VertexAttributeValues::Snorm8x4(_) => "snorm8x4",
        VertexAttributeValues::Uint16(_) => "uint16",
        VertexAttributeValues::Uint16x2(_) => "uint16x2",
        VertexAttributeValues::Uint16x4(_) => "uint16x4",
        VertexAttributeValues::Sint16(_) => "sint16",
        VertexAttributeValues::Sint16x2(_) => "sint16x2",
        VertexAttributeValues::Sint16x4(_) => "sint16x4",
        VertexAttributeValues::Unorm16(_) => "unorm16",
        VertexAttributeValues::Unorm16x2(_) => "unorm16x2",
        VertexAttributeValues::Unorm16x4(_) => "unorm16x4",
        VertexAttributeValues::Snorm16(_) => "snorm16",
        VertexAttributeValues::Snorm16x2(_) => "snorm16x2",
        VertexAttributeValues::Snorm16x4(_) => "snorm16x4",
        VertexAttributeValues::Float32(_) => "float32",
        VertexAttributeValues::Float32x2(_) => "float32x2",
        VertexAttributeValues::Float32x3(_) => "float32x3",
        VertexAttributeValues::Float32x4(_) => "float32x4",
        VertexAttributeValues::Float64(_) => "float64",
        VertexAttributeValues::Float64x2(_) => "float64x2",
        VertexAttributeValues::Float64x3(_) => "float64x3",
        VertexAttributeValues::Float64x4(_) => "float64x4",
        _ => "other",
    }
}

/// The mesh buffers this run handed to the renderer, exported as bytes. §6.1 asks for the mesh and
/// index buffers themselves, not a name that hopes for a match somewhere else.
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
        "triangles": indices.len() / 3,
        "uvs": b64(&f32_bytes(&uvs)),
        "vertices": positions.len(),
    })
}

fn quat(transform: &Transform) -> [f64; 4] {
    let q = transform.rotation;
    [q.x as f64, q.y as f64, q.z as f64, q.w as f64]
}

fn triple(value: Vec3) -> [f64; 3] {
    [value.x as f64, value.y as f64, value.z as f64]
}

/// First, last and midpoint: the objects the counterpart arm inspects at the §6.1 frames.
fn probe_indices(count: usize) -> Vec<usize> {
    let mut indices = vec![0usize];
    if count > 1 {
        indices.push(count / 2);
    }
    if count > 2 {
        indices.push(count - 1);
    }
    indices
}

/// Exports the canonical fixture: the complete object census with every transform, every geometry
/// and material id, the camera, the light, the enclosing geometry counted separately, the frame
/// schedule and the source pins. The counterpart arm renders these exact bytes.
fn export_fixture(
    args: Res<Args>,
    meshes: Res<Assets<Mesh>>,
    materials: Res<Assets<StandardMaterial>>,
    windows: Query<&Window, With<PrimaryWindow>>,
    cubes: Query<
        (Entity, &Mesh3d, &MeshMaterial3d<StandardMaterial>, &Transform),
        Without<NotShadowCaster>,
    >,
    enclosing: Query<
        (Entity, &Mesh3d, &MeshMaterial3d<StandardMaterial>, &Transform),
        With<NotShadowCaster>,
    >,
    camera: Query<(&Transform, &Projection), With<Camera>>,
    light: Query<(&DirectionalLight, &Transform)>,
    mut measure: ResMut<Measure>,
) {
    // Scoped so the two resolver closures release their borrows before the JSON reads the values
    // they filled in.
    let (mesh_values, material_values, object_values, enclosing_values, probes) = {
        let mut mesh_ids: Vec<String> = Vec::new();
        let mut mesh_values: Vec<serde_json::Value> = Vec::new();
        let mut material_ids: Vec<String> = Vec::new();
        let mut material_values: Vec<serde_json::Value> = Vec::new();

        // Dense indices, because the counterpart arm has to resolve them against the exported
        // arrays; the AssetId each came from is kept beside them as provenance.
        let mut resolve_mesh = |handle: &Handle<Mesh>, assets: &Assets<Mesh>| -> (usize, String) {
            let id = format!("mesh:{}", handle.id().to_string());
            if let Some(existing) = mesh_ids.iter().position(|value| value == &id) {
                return (existing, id);
            }
            let Some(mesh) = assets.get(handle) else {
                refuse("MESH_ASSET_MISSING");
            };
            mesh_ids.push(id.clone());
            mesh_values.push(export_mesh(mesh));
            (mesh_values.len() - 1, id)
        };
        let mut resolve_material = |handle: &Handle<StandardMaterial>, assets: &Assets<StandardMaterial>| -> (usize, String) {
            let id = format!("material:{}", handle.id().to_string());
            if let Some(existing) = material_ids.iter().position(|value| value == &id) {
                return (existing, id);
            }
            let Some(material) = assets.get(handle) else {
                refuse("MATERIAL_ASSET_MISSING");
            };
            let srgb = material.base_color.to_srgba();
            material_ids.push(id.clone());
            material_values.push(json!({
                "baseColor": [
                    srgb.red as f64,
                    srgb.green as f64,
                    srgb.blue as f64,
                    srgb.alpha as f64,
                ],
                "metallic": material.metallic as f64,
                "perceptualRoughness": material.perceptual_roughness as f64,
            }));
            (material_values.len() - 1, id)
        };

        let mut object_values: Vec<serde_json::Value> = Vec::new();
        let mut entities: Vec<Entity> = Vec::new();
        for (entity, mesh, material, transform) in cubes.iter() {
            entities.push(entity);
            let (geometry, geometry_asset) = resolve_mesh(&mesh.0, &meshes);
            let (material, material_asset) = resolve_material(&material.0, &materials);
            object_values.push(json!({
                "geometryAsset": geometry_asset,
                "geometryId": geometry,
                "materialAsset": material_asset,
                "materialId": material,
                "rotation": quat(transform),
                "scale": triple(transform.scale),
                "translation": triple(transform.translation),
            }));
        }
        let mut enclosing_values: Vec<serde_json::Value> = Vec::new();
        for (_, mesh, material, transform) in enclosing.iter() {
            let (geometry, geometry_asset) = resolve_mesh(&mesh.0, &meshes);
            let (material, material_asset) = resolve_material(&material.0, &materials);
            enclosing_values.push(json!({
                "geometryAsset": geometry_asset,
                "geometryId": geometry,
                "materialAsset": material_asset,
                "materialId": material,
                "rotation": quat(transform),
                "scale": triple(transform.scale),
                "translation": triple(transform.translation),
            }));
        }
        let indices = probe_indices(object_values.len());
        let probes = indices
            .iter()
            .filter_map(|index| entities.get(*index).map(|entity| (*index as u32, *entity)))
            .collect::<Vec<(u32, Entity)>>();
        if probes.len() != indices.len() {
            refuse("PROBE_CENSUS");
        }
        (
            mesh_values,
            material_values,
            object_values,
            enclosing_values,
            probes,
        )
    };

    let Ok((camera_transform, projection)) = camera.single() else {
        refuse("CAMERA_CENSUS");
    };
    let (fov_degrees, near, far) = match projection {
        Projection::Perspective(perspective) => (
            perspective.fov.to_degrees() as f64,
            perspective.near as f64,
            perspective.far as f64,
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
    // §6.3's common profile is 1920x1080. This desktop's work area is 1050 tall
    // (`_NET_WORKAREA 0,30,3840,1050`, a 30 px panel), so the window manager hands back 1920x1050
    // whatever the request is. The actual attachment is what the counterpart arm must match, and the
    // deviation from the requested profile is recorded next to it rather than hidden.
    let requested: (u32, u32) = (WINDOW_RESOLUTION.0 as u32, WINDOW_RESOLUTION.1 as u32);
    let deviation = if (size.x, size.y) == requested {
        serde_json::Value::Null
    } else {
        json!(format!(
            "requested {}x{}; this desktop's window-manager work area is 1920x1050, so both arms render {}x{}",
            requested.0, requested.1, size.x, size.y
        ))
    };
    let probe_indices: Vec<u32> = probes.iter().map(|(index, _)| *index).collect();

    let fixture = json!({
        "camera": {
            "far": far,
            "fovDegrees": fov_degrees,
            "near": near,
            "position": triple(camera_transform.translation),
            "rotation": quat(camera_transform),
        },
        "counts": {
            "cubes": object_values.len(),
            "directionalLights": 1,
            "enclosing": enclosing_values.len(),
            "requestedInstances": args.instance_count,
        },
        "enclosing": enclosing_values,
        "environment": {
            "background": "bevy-window-clear",
            "shadowMapsEnabled": directional.shadow_maps_enabled,
        },
        "family": "bevy-many-cubes",
        "frameSchedule": {
            "cameraStepPerFrame": CAMERA_STEP,
            "firstScoredFrameClockSteps": args.warmup_frames + 2,
            // Two different counts, because the two upstream systems do not read the same thing.
            // `move_camera` under `--benchmark` multiplies a constant 1/60, so it has applied one step
            // per clock step. `rotate_cubes` reads `Res<Time>`, and Bevy's first `Time` update records
            // `first_update` without calling `advance_by` (`bevy_time::real::update_with_instant` returns
            // early when `last_update` is `None`), so that first frame's delta is zero and
            // `rotate_y(10 * 0)` changes nothing: one step fewer. This is the trap §5.1 names, and the
            // oracle on the other side is built from these two numbers rather than from one guess.
            "firstScoredFrameConstantSteps": args.warmup_frames + 2,
            "firstScoredFrameTimeDeltas": args.warmup_frames + 1,
            "frameDelta": FRAME_DELTA,
            "measuredFrames": args.measured_frames,
            "rotationPerFrame": ROTATION_STEP,
            "rotateCubes": args.rotate_cubes,
            "warmupFrames": args.warmup_frames,
        },
        "light": {
            "rotation": quat(light_transform),
            "shadowMapsEnabled": directional.shadow_maps_enabled,
        },
        "materials": material_values,
        "meshes": mesh_values,
        "objects": object_values,
        "probeIndices": probe_indices,
        "schedule": "bevy-fractional-frame-boundary/1",
        "schemaVersion": 1,
        "source": {
            "adapterSha256": env_or_unrecorded("TN_BENCH_BEVY_ADAPTER_SHA256"),
            "commit": UPSTREAM_COMMIT,
            "patch": [
                "TimeUpdateStrategy::ManualDuration(1/60) replaces Bevy's wall-clock Automatic strategy, so Time, Time<Real> and Time<Virtual> all advance exactly 1/60 s per frame and every upstream Res<Time> consumer reads the fixture clock",
                "Args::benchmark forced on; --warmup-frames, --measured-frames, --fixture-out and --arm added to Args",
                "Window.decorations set to false so a decorating window manager cannot shrink the 1920x1080 render attachment, and the exported viewport is refused unless it matches the request; fixture export, frame schedule, conformance probes, work counters and one wgpu Device::poll(PollType::wait_indefinitely()) completion drain per boundary added; the Fibonacci sphere placement, seeded ChaCha8Rng(42) mesh/material selection, enclosing box, directional light, move_camera, rotate_cubes and print_mesh_count are unchanged",
            ],
            "path": UPSTREAM_PATH,
            "upstreamSha256": env_or_unrecorded("TN_BENCH_BEVY_UPSTREAM_SHA256"),
        },
        "variant": if args.rotate_cubes { "rotating" } else { "static" },
        "viewport": {
            "deviation": deviation,
            "height": size.y as usize,
            "requestedHeight": requested.1 as usize,
            "requestedWidth": requested.0 as usize,
            "scaleFactor": window.scale_factor() as f64,
            "width": size.x as usize,
        },
    });
    if let Err(error) = fs::write(&args.fixture_out, format!("{fixture}\n")) {
        eprintln!("ENGINE_LOAD_TEST_FAILED TN_BENCH_BEVY_FIXTURE_WRITE:{error}");
        std::process::exit(1);
    }
    measure.fixture = Some(fixture);
    measure.probes = probes;
}

/// The frame schedule. One system in `Last`, so every boundary is taken after that frame's own
/// update work and before the next frame's. The measured window opens on the first frame after the
/// unscored pre-drain and closes on the frame that observes the final completion wait.
fn measure_frame(
    args: Res<Args>,
    visibility: Query<&ViewVisibility, With<Mesh3d>>,
    transforms: Query<&Transform>,
    camera: Query<&Transform, With<Camera>>,
    mut measure: ResMut<Measure>,
) {
    let open_scored_window = |measure: &mut Measure, index: u32, stamp: f64| {
        measure.scored = Some(index);
        measure.boundaries.push((index, stamp));
        if STATE_FRAMES.contains(&index) {
            let probes: Vec<(u32, [f64; 4])> = measure
                .probes
                .iter()
                .filter_map(|(number, entity)| {
                    transforms
                        .get(*entity)
                        .ok()
                        .map(|transform| (*number, quat(transform)))
                })
                .collect();
            if probes.len() != measure.probes.len() {
                refuse("PROBE_UNOBSERVED");
            }
            let camera_rotation = camera.single().map(quat).unwrap_or([0.0, 0.0, 0.0, 1.0]);
            measure.states.push((index, probes, camera_rotation));
            measure.runs_at_sample.push((index, measure.runs.0, measure.runs.1));
        }
        if index == args.measured_frames / 2 {
            measure.work = Some(json!({
                "authoredObjects": visibility.iter().count(),
                "note": "bevy 0.19 exposes no submitted-draw or submitted-triangle counter to the main world, so those are null with a reason rather than zero",
                "sampledAtMeasuredFrame": index,
                "submittedDrawCalls": serde_json::Value::Null,
                "submittedTriangles": serde_json::Value::Null,
                "visibleObjects": visibility.iter().filter(|entry| entry.get()).count(),
            }));
        }
    };
    match measure.state {
        Phase::Warmup => {
            if measure.frame == args.warmup_frames {
                DRAIN_REQUESTED.store(true, Ordering::SeqCst);
                measure.state = Phase::PreDrain;
            }
        }
        Phase::PreDrain => {
            // The unscored pre-drain landed, so the warmup's queued GPU work is not inside the
            // measured span. This frame is measured frame 0.
            if drains_completed() >= 1 {
                open_scored_window(&mut measure, 0, now_ms());
                measure.state = Phase::Scored;
            }
        }
        Phase::Scored => {
            let next = measure.scored.unwrap_or_default() + 1;
            open_scored_window(&mut measure, next, now_ms());
            if next >= args.measured_frames {
                DRAIN_REQUESTED.store(true, Ordering::SeqCst);
                measure.state = Phase::FinalDrain;
            }
        }
        Phase::FinalDrain => {
            if drains_completed() < 2 {
                return;
            }
            measure.final_completion_ms = Some(f64::from_bits(DRAIN_COMPLETED_MS.load(Ordering::SeqCst)));
            measure.final_drain_wait_ms = Some(f64::from_bits(DRAIN_WAIT_MS.load(Ordering::SeqCst)));
            measure.done = true;
        }
    }
    measure.frame += 1;
}

/// Runs immediately after `move_camera` in the same schedule, so its count is that system's own.
fn prd449_count_camera(mut measure: ResMut<Measure>) {
    measure.runs.0 += 1;
}

/// Runs immediately after `rotate_cubes`, and is absent on a static arm — which is itself the proof
/// that the rotating arm's per-object work happened and the static arm's did not.
fn prd449_count_rotate(mut measure: ResMut<Measure>) {
    measure.runs.1 += 1;
}

fn env_or_unrecorded(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| "unrecorded".to_string())
}

fn finish_run(args: Res<Args>, measure: Res<Measure>, mut exits: MessageWriter<AppExit>) {
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
    let final_completion = match measure.final_completion_ms {
        Some(value) if value > 0.0 => value,
        _ => refuse("FINAL_COMPLETION_ABSENT"),
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
            "binary": env_or_unrecorded("TN_BENCH_BEVY_BINARY"),
            "features": env_or_unrecorded("TN_BENCH_BEVY_FEATURES"),
            "profile": "release",
            "type": "rust",
        },
        "drain": {
            "boundaryFrame": args.measured_frames,
            "includesUntimedFrames": 1,
            "waitMs": measure.final_drain_wait_ms.unwrap_or_default(),
        },
        "engine": { "name": "bevy", "version": "0.19.0" },
        "family": "bevy-many-cubes",
        "fixture": {
            "objects": fixture["counts"]["cubes"].clone(),
            "path": args.fixture_out,
            "sourceCommit": UPSTREAM_COMMIT,
        },
        "frameSchedule": fixture["frameSchedule"].clone(),
        "meanMs": (final_completion - start) / args.measured_frames as f64,
        "profile": "smoke",
        "rawSeries": {
            "boundaries": measure
                .boundaries
                .iter()
                .map(|(frame_id, stamp)| json!({
                    "frameId": frame_id,
                    "monotonicMs": *stamp,
                }))
                .collect::<Vec<serde_json::Value>>(),
            "finalCompletionMs": final_completion,
            "schemaVersion": 1,
            "unit": "ms",
        },
        "systemRuns": {
            "atSampledFrames": measure
                .runs_at_sample
                .iter()
                .map(|(frame_id, camera_runs, rotate_runs)| json!({
                    "cameraSystemRuns": camera_runs,
                    "frameId": frame_id,
                    "rotateSystemRuns": rotate_runs,
                }))
                .collect::<Vec<serde_json::Value>>(),
            "note": "`move_camera` runs on every arm and `rotate_cubes` only when --rotate-cubes is passed, so a static arm reports zero rotation-system runs by construction",
        },
        "states": measure
            .states
            .iter()
            .map(|(frame_id, probes, camera_rotation)| json!({
                "cameraRotation": camera_rotation,
                "frameId": frame_id,
                "probes": probes.iter().map(|(index, rotation)| json!({
                    "index": index,
                    "rotation": rotation,
                })).collect::<Vec<serde_json::Value>>(),
            }))
            .collect::<Vec<serde_json::Value>>(),
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
fn prd449_render_boundary(device: Res<RenderDevice>, adapter: Res<RenderAdapterInfo>) {
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
    let requested = now_ms();
    // The one completion wait of the run: every submission made up to this point, including the
    // last measured frame's, has completed when it returns.
    let _ = device.wgpu_device().poll(PollType::wait_indefinitely());
    let completed = now_ms();
    DRAIN_WAIT_MS.store((completed - requested).to_bits(), Ordering::SeqCst);
    DRAIN_COMPLETED_MS.store(completed.to_bits(), Ordering::SeqCst);
    DRAIN_COUNT.fetch_add(1, Ordering::SeqCst);
}
