//! PRD-449 `bevy-many-foxes`: the pinned upstream `many_foxes` example, unchanged in what it
//! builds, with the deterministic fixture clock, the measured frame schedule and the conformance
//! probes this family needs.
//!
//! **Source pin.** bevy `v0.19.0`, commit `c6f634ca9f406d68ba5109d921247b654cb42c10`,
//! `examples/stress_tests/many_foxes.rs`. The ring hierarchy, the alternating ring directions, the
//! fox spacing, the 0.01 scale, the `base_rotation * Quat::from_rotation_y(-fox_angle)` facing, the
//! three loaded clips and their `add_clips` order, the `seek_to(entity_index / 10)` phase,
//! `update_fox_rings`, `keyboard_animation_control`, the plane, the camera framing and
//! `setup_scene_once_loaded` are below verbatim.
//!
//! **Asset pin.** `assets/models/animated/Fox.glb`, 162,852 bytes, Git blob
//! `1ef5c0d05658caea339680fe581aa2c8302b3365`, SHA-256
//! `d97044e701822bac5a62696459b27d7b375aada5de8574ed4362edbba94771f7`. The pinned
//! [Bevy CREDITS](https://github.com/bevyengine/bevy/blob/c6f634ca9f406d68ba5109d921247b654cb42c10/CREDITS.md)
//! attributes the model to PixelMannen (CC0) and the rigging and animation to @tomkranis
//! (CC-BY 4.0), which is also what the file's own `asset.copyright` string says. That attribution
//! is separate from Bevy's code licence and travels with the fixture.
//!
//! **Adapter patch, disclosed in full and hashed with this file.**
//!
//! 1. `TimeUpdateStrategy::ManualDuration(1/60 s)` replaces Bevy's wall-clock `Automatic` strategy,
//!    so `Time`, `Time<Real>` and `Time<Virtual>` all advance exactly `1/60 s` per frame. Every
//!    upstream `Res<Time>` consumer reads it — `update_fox_rings` above all — and so does the
//!    animation graph's own advancement, which is what makes both the ring motion and the clip
//!    playhead reproducible. Upstream has no benchmark switch for this example at all, so the
//!    resource is the whole determinism patch.
//! 2. `DirectionalLight { shadow_maps_enabled: false }`. Upstream requests `true`; §6.3 makes
//!    shadows off the common profile and §5's foxes family lists "shadows off" as a required
//!    primary-cell setting. The upstream `CascadeShadowConfigBuilder` is kept, so the values it
//!    chose stay in the fixture as a disclosure even though nothing consumes them.
//! 3. `Msaa::Off` on the camera upstream spawned. Bevy 0.19 keeps MSAA as a camera component with a
//!    4x default, §6.3 requires MSAA off, and the counterpart arm runs `antialias: false`; the
//!    observed value is exported so the comparison checks it rather than trusting the patch.
//! 4. `Window.decorations = false` — a decorating window manager shrinks the render attachment
//!    (measured 1912x1010 against 1920x1050 undecorated) — and the exported viewport is the actual
//!    attachment, with its deviation from §6.3 recorded.
//! 5. Four measurement options are added to `Args` (`--warmup-frames`, `--measured-frames`,
//!    `--fixture-out`, `--arm`) and the `prd449_*` systems below are added: fixture export, the
//!    frame schedule, the conformance probes, the work counters, and one
//!    `Device::poll(PollType::wait_indefinitely())` completion wait per measurement boundary on the
//!    render thread, the only place in this process that holds a `wgpu::Device`.
//!
//! **What the fixture carries, and what it does not.** The asset is the pinned `Fox.glb` itself:
//! the counterpart arm loads the same bytes (its build injects them from this checkout) and both
//! arms report the file's SHA-256, so "same asset bytes" is a hash rather than a claim. The glTF
//! JSON inside that file is the authority for the clip list, its interpolation and the joint order,
//! because Bevy 0.19 has no accessor for a loaded clip's keyframes any more: `AnimationClip` keeps
//! its curves in a private `AnimationCurves` map of `VariableCurve`s. The runtime cross-checks what
//! it can — every clip's duration, its glTF animation index and its animation-target count, the
//! skeleton it loaded against the file, and every bone's animated transform at six frames. The
//! skin's 24 inverse bind matrices *are* shipped as f64 numbers, because that is small and because
//! it is the one thing two independent glTF loaders could genuinely disagree about.
//!
//! **Timing semantics**, declared so the counterpart arm can be checked against it: `boundaries` are
//! `N+1` render-producing frame boundaries taken at the end of the main schedule, so each interval
//! carries the previous frame's ring update, its animation evaluation, its render submission and any
//! GPU wait. The completed-work mean additionally includes exactly one GPU completion wait, taken
//! after the last measured frame has been submitted and reported as `finalCompletionMs`; one extra
//! untimed frame's submission therefore falls inside that wait (`drain.includesUntimedFrames: 1`).

use std::{
    f32::consts::PI,
    fs,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

use argh::FromArgs;
use bevy::{
    asset::AssetPlugin,
    camera::visibility::ViewVisibility,
    diagnostic::{FrameTimeDiagnosticsPlugin, LogDiagnosticsPlugin},
    light::{CascadeShadowConfig, CascadeShadowConfigBuilder},
    math::{Mat4, Vec3},
    mesh::{
        skinning::{SkinnedMesh, SkinnedMeshInverseBindposes},
        Indices, VertexAttributeValues,
    },
    post_process::motion_blur::MotionBlur,
    prelude::*,
    render::{
        render_resource::PollType,
        Render, RenderApp,
        renderer::{RenderAdapterInfo, RenderDevice},
    },
    ecs::system::SystemParam,
    time::TimeUpdateStrategy,
    window::{PresentMode, PrimaryWindow, WindowResolution},
    winit::WinitSettings,
    world_serialization::WorldInstanceReady,
};
use serde_json::{json, Value};

/// The upstream commit this adapter is pinned to, stated in the fixture and the report.
const UPSTREAM_COMMIT: &str = "c6f634ca9f406d68ba5109d921247b654cb42c10";
const UPSTREAM_PATH: &str = "examples/stress_tests/many_foxes.rs";
/// The pinned asset, relative to this checkout's root, exactly as the upstream source loads it.
const ASSET_RELATIVE: &str = "assets/models/animated/Fox.glb";
/// The pinned asset's byte length, refused on sight: a truncated or substituted file is not this
/// cell's asset even if the loader tolerates it.
const ASSET_BYTES: usize = 162_852;
/// §7.2's deterministic throughput step. The fixture clock advances by exactly this every frame.
const FRAME_DELTA: f64 = 1.0 / 60.0;
/// The frames §6.1 names for the conformance inspection, in measured-frame numbering.
const STATE_FRAMES: [u32; 6] = [0, 1, 60, 120, 300, 599];
/// §6.3's common render profile.
const WINDOW_RESOLUTION: (f32, f32) = (1920.0, 1080.0);
/// Upstream's `add_clips` order is `[Animation(2), Animation(1), Animation(0)]` and
/// `setup_scene_once_loaded` plays `node_indices[0]`, so the played clip is glTF animation 2.
const ACTIVE_CLIP: usize = 2;
/// The joint indices whose 4x4 skin matrix both arms report: a hierarchy spot check that also
/// covers the ring rotation, the fox placement and the bind pose in one number. Joint 0 is the rig
/// root, joint 12 a mid-leg joint.
const SKIN_PROBE_JOINTS: [usize; 2] = [0, 12];

#[derive(FromArgs, Resource)]
/// `many_foxes` stress test, PRD-449 measured adapter.
struct Args {
    /// whether all foxes run in sync.
    #[argh(switch)]
    sync: bool,

    /// total number of foxes.
    #[argh(option, default = "1000")]
    count: usize,

    /// enable motion blur.
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

// ---------------------------------------------------------------------------------------------
// Frame schedule state.
// ---------------------------------------------------------------------------------------------

/// Every fox, in the upstream spawn order: rings by radius, and each ring's children in the order
/// `with_children` created them.
struct FoxRow {
    index: u32,
    ring: u32,
    phase: f32,
    joints: Vec<Entity>,
}

/// A probed fox: its row index, and the inverse bind matrices its own skin asset carries.
struct FoxProbe {
    fox: usize,
    binds: Vec<[f64; 16]>,
}

#[derive(Resource, Default)]
struct Measure {
    frame: u32,
    state: Phase,
    /// Measured-frame index of the frame currently running, once the scored window has opened.
    scored: Option<u32>,
    boundaries: Vec<(u32, f64)>,
    /// (ring index, ring entity) in upstream ring order.
    rings: Vec<(u32, Entity)>,
    foxes: Vec<FoxRow>,
    probes: Vec<FoxProbe>,
    /// The joint index the fixture's animation oracle reads, in the shared `skin.joints` order.
    oracle_joint: usize,
    /// (measured frame, the full state record) at the §6.1 frames.
    states: Vec<(u32, Value)>,
    /// How many times `update_fox_rings` has run: §5.1 asks for the actual effect, not a name.
    ring_runs: u32,
    /// (measured frame, `update_fox_rings` runs) at each sampled frame.
    ring_runs_at_sample: Vec<(u32, u32)>,
    work: Option<Value>,
    fixture: Option<Value>,
    final_completion_ms: Option<f64>,
    final_drain_wait_ms: Option<f64>,
    done: bool,
}

/// The phase upstream's `setup_scene_once_loaded` sought, captured from the same `WorldInstanceReady`
/// event it reads, so the fixture states the value the runtime actually used instead of a
/// re-derivation of it.
#[derive(Resource, Default)]
struct Phases(Vec<(Entity, f32)>);

fn prd449_capture_phase(ready: On<WorldInstanceReady>, foxes: Res<Foxes>, mut phases: ResMut<Phases>) {
    let phase = if foxes.sync {
        0.0
    } else {
        ready.entity.index_u32() as f32 / 10.0
    };
    phases.0.push((ready.entity, phase));
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

/// The pinned glTF, read once at startup: the fixture export is the only consumer, and no frame pays
/// for parsing it.
#[derive(Resource)]
struct GltfCache {
    pinned: Option<Gltf>,
}

fn main() {
    let args: Args = argh::from_env();
    // §6.3's common profile has no motion blur, and upstream's shutter angle of 3.0 is a
    // deliberately exaggerated effect. Refusing is the honest answer: a run that took it would not
    // be the cell this family measures.
    if args.motion_blur {
        eprintln!("ENGINE_LOAD_TEST_FAILED TN_BENCH_BEVY_MOTION_BLUR_UNSUPPORTED");
        std::process::exit(2);
    }
    if args.measured_frames == 0 {
        eprintln!("ENGINE_LOAD_TEST_FAILED TN_BENCH_BEVY_NO_MEASURED_FRAMES");
        std::process::exit(2);
    }
    if args.count == 0 {
        eprintln!("ENGINE_LOAD_TEST_FAILED TN_BENCH_BEVY_NO_FOXES");
        std::process::exit(2);
    }
    ORIGIN.get_or_init(Instant::now);

    let mut app = App::new();
    app.add_plugins((
        DefaultPlugins
        .set(AssetPlugin {
            // Bevy's default asset root is the executable's own directory, which for a cargo
            // example is `target/release/examples/` — so the upstream path
            // `models/animated/Fox.glb` would resolve to a file that does not exist. Pointing the
            // root back at the checkout's `assets/` is what lets the pinned source keep its own path
            // string and still load the pinned file.
            file_path: format!("{}/assets", env!("CARGO_MANIFEST_DIR")),
            ..default()
        })
        .set(WindowPlugin {
            primary_window: Some(Window {
                present_mode: PresentMode::AutoNoVsync,
                // Patches 3 and 4. Window chrome is the only deviation from upstream's `Window`
                // beyond MSAA: a decorating window manager shrinks the request to fit its title bar
                // (measured: 1912x1010 against 1920x1050 undecorated). It changes no rendered pixel,
                // and the exported viewport is the actual attachment with its deviation from §6.3
                // recorded.
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
    // Upstream's own resource, verbatim: the ring speed, the "rings are moving" switch and the
    // `--sync` phase switch the whole staggered variant is about.
    .insert_resource(Foxes {
        count: args.count,
        speed: 2.0,
        moving: true,
        sync: args.sync,
    })
    // Patch 1: the fixture clock.
    .insert_resource(TimeUpdateStrategy::ManualDuration(Duration::from_secs_f64(FRAME_DELTA)))
    .init_resource::<Measure>()
    .init_resource::<Phases>()
    .init_resource::<GltfCache>()
    .add_observer(prd449_capture_phase)
    .add_systems(Startup, setup)
    // The GLTF scene is instanced asynchronously, so the fixture export waits for the assets the
    // upstream source asked for rather than assuming a startup order.
    .add_systems(Update, prd449_export_when_ready)
    .add_systems(
        Update,
        (
            keyboard_animation_control,
            update_fox_rings.after(keyboard_animation_control),
            prd449_count_rings.after(update_fox_rings),
        ),
    )
    .add_systems(PostStartup, prd449_msaa_off)
    .add_systems(Last, (measure_frame, finish_run).chain());

    // Patch 5: the render-thread half of the completion drain plus the adapter identity.
    if let Some(render_app) = app.get_sub_app_mut(RenderApp) {
        render_app.add_systems(Render, prd449_render_boundary);
    }

    app.insert_resource(args);
    app.run();
}

// ---------------------------------------------------------------------------------------------
// Upstream `many_foxes`, verbatim from the pinned commit except the two lines patches 2 and 3
// change, which are marked where they appear.
// ---------------------------------------------------------------------------------------------

#[derive(Resource)]
struct Foxes {
    count: usize,
    speed: f32,
    moving: bool,
    sync: bool,
}

#[derive(Resource)]
struct Animations {
    node_indices: Vec<AnimationNodeIndex>,
    graph: Handle<AnimationGraph>,
}

const RING_SPACING: f32 = 2.0;
const FOX_SPACING: f32 = 2.0;

#[derive(Component, Clone, Copy)]
enum RotationDirection {
    CounterClockwise,
    Clockwise,
}

impl RotationDirection {
    fn sign(&self) -> f32 {
        match self {
            RotationDirection::CounterClockwise => 1.0,
            RotationDirection::Clockwise => -1.0,
        }
    }
}

#[derive(Component)]
struct Ring {
    radius: f32,
}

fn setup(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut animation_graphs: ResMut<Assets<AnimationGraph>>,
    foxes: Res<Foxes>,
    args: Res<Args>,
) {
    // The pinned warning text, read from where upstream keeps it. Only the path differs, because the
    // adapter is compiled as `examples/prd449_foxes.rs` rather than in `examples/stress_tests/`.
    warn!(include_str!("stress_tests/warning_string.txt"));

    // Insert a resource with the current scene information
    let animation_clips = [
        asset_server.load(GltfAssetLabel::Animation(2).from_asset("models/animated/Fox.glb")),
        asset_server.load(GltfAssetLabel::Animation(1).from_asset("models/animated/Fox.glb")),
        asset_server.load(GltfAssetLabel::Animation(0).from_asset("models/animated/Fox.glb")),
    ];
    let mut animation_graph = AnimationGraph::new();
    let node_indices = animation_graph
        .add_clips(animation_clips, 1.0, animation_graph.root)
        .collect();
    commands.insert_resource(Animations {
        node_indices,
        graph: animation_graphs.add(animation_graph),
    });

    // Foxes
    // Concentric rings of foxes, running in opposite directions. The rings are spaced at 2m radius intervals.
    // The foxes in each ring are spaced at least 2m apart around its circumference.'

    // NOTE: This fox model faces +z
    let fox_handle =
        asset_server.load(GltfAssetLabel::Scene(0).from_asset("models/animated/Fox.glb"));

    let ring_directions = [
        (
            Quat::from_rotation_y(PI),
            RotationDirection::CounterClockwise,
        ),
        (Quat::IDENTITY, RotationDirection::Clockwise),
    ];

    let mut ring_index = 0;
    let mut radius = RING_SPACING;
    let mut foxes_remaining = foxes.count;

    info!("Spawning {} foxes...", foxes.count);

    while foxes_remaining > 0 {
        let (base_rotation, ring_direction) = ring_directions[ring_index % 2];
        let ring_parent = commands
            .spawn((
                Transform::default(),
                Visibility::default(),
                ring_direction,
                Ring { radius },
            ))
            .id();

        let circumference = PI * 2. * radius;
        let foxes_in_ring = ((circumference / FOX_SPACING) as usize).min(foxes_remaining);
        let fox_spacing_angle = circumference / (foxes_in_ring as f32 * radius);

        for fox_i in 0..foxes_in_ring {
            let fox_angle = fox_i as f32 * fox_spacing_angle;
            let (s, c) = ops::sin_cos(fox_angle);
            let (x, z) = (radius * c, radius * s);

            commands.entity(ring_parent).with_children(|builder| {
                builder
                    .spawn((
                        WorldAssetRoot(fox_handle.clone()),
                        Transform::from_xyz(x, 0.0, z)
                            .with_scale(Vec3::splat(0.01))
                            .with_rotation(base_rotation * Quat::from_rotation_y(-fox_angle)),
                    ))
                    .observe(setup_scene_once_loaded);
            });
        }

        foxes_remaining -= foxes_in_ring;
        radius += RING_SPACING;
        ring_index += 1;
    }

    // Camera
    let zoom = 0.8;
    let translation = Vec3::new(
        radius * 1.25 * zoom,
        radius * 0.5 * zoom,
        radius * 1.5 * zoom,
    );
    let mut camera = commands.spawn((
        Camera3d::default(),
        Transform::from_translation(translation)
            .looking_at(0.2 * Vec3::new(translation.x, 0.0, translation.z), Vec3::Y),
    ));

    if args.motion_blur {
        camera.insert((
            MotionBlur {
                // Use an unrealously large shutter angle so that motion blur is clearly visible.
                shutter_angle: 3.0,
                ..Default::default()
            },
            // MSAA and MotionBlur are not compatible on WebGL.
            #[cfg(all(feature = "webgl2", target_arch = "wasm32", not(feature = "webgpu")))]
            Msaa::Off,
        ));
    }

    // Plane
    commands.spawn((
        Mesh3d(meshes.add(Plane3d::default().mesh().size(5000.0, 5000.0))),
        MeshMaterial3d(materials.add(Color::srgb(0.3, 0.5, 0.3))),
    ));

    // Light
    commands.spawn((
        Transform::from_rotation(Quat::from_euler(EulerRot::ZYX, 0.0, 1.0, -PI / 4.)),
        DirectionalLight {
            // Patch 2: shadows off, as §6.3's common profile and §5's foxes family require.
            shadow_maps_enabled: false,
            ..default()
        },
        CascadeShadowConfigBuilder {
            first_cascade_far_bound: 0.9 * radius,
            maximum_distance: 2.8 * radius,
            ..default()
        }
        .build(),
    ));

    println!("Animation controls:");
    println!("  - spacebar: play / pause");
    println!("  - arrow up / down: speed up / slow down animation playback");
    println!("  - arrow left / right: seek backward / forward");
    println!("  - return: change animation");
}

// Once the scene is loaded, start the animation
fn setup_scene_once_loaded(
    scene_ready: On<WorldInstanceReady>,
    animations: Res<Animations>,
    foxes: Res<Foxes>,
    mut commands: Commands,
    children: Query<&Children>,
    mut players: Query<&mut AnimationPlayer>,
) {
    for child in children.iter_descendants(scene_ready.entity) {
        if let Ok(mut player) = players.get_mut(child) {
            let playing_animation = player.play(animations.node_indices[0]).repeat();
            if !foxes.sync {
                playing_animation.seek_to(scene_ready.entity.index_u32() as f32 / 10.0);
            }
            commands.entity(child).insert((
                AnimationGraphHandle(animations.graph.clone()),
                AnimationTransitions::default(),
            ));
        }
    }
}

fn update_fox_rings(
    time: Res<Time>,
    foxes: Res<Foxes>,
    mut rings: Query<(&Ring, &RotationDirection, &mut Transform)>,
) {
    if !foxes.moving {
        return;
    }

    let dt = time.delta_secs();
    for (ring, rotation_direction, mut transform) in &mut rings {
        let angular_velocity = foxes.speed / ring.radius;
        transform.rotate_y(rotation_direction.sign() * angular_velocity * dt);
    }
}

fn keyboard_animation_control(
    keyboard_input: Res<ButtonInput<KeyCode>>,
    mut animation_player: Query<(&mut AnimationPlayer, &mut AnimationTransitions)>,
    animations: Res<Animations>,
    mut current_animation: Local<usize>,
    mut foxes: ResMut<Foxes>,
) {
    if keyboard_input.just_pressed(KeyCode::Space) {
        foxes.moving = !foxes.moving;
    }

    if keyboard_input.just_pressed(KeyCode::ArrowUp) {
        foxes.speed *= 1.25;
    }

    if keyboard_input.just_pressed(KeyCode::ArrowDown) {
        foxes.speed *= 0.8;
    }

    if keyboard_input.just_pressed(KeyCode::Enter) {
        *current_animation = (*current_animation + 1) % animations.node_indices.len();
    }

    for (mut player, mut transitions) in &mut animation_player {
        if keyboard_input.just_pressed(KeyCode::Space) {
            if player.all_paused() {
                player.resume_all();
            } else {
                player.pause_all();
            }
        }

        if keyboard_input.just_pressed(KeyCode::ArrowUp) {
            player.adjust_speeds(1.25);
        }

        if keyboard_input.just_pressed(KeyCode::ArrowDown) {
            player.adjust_speeds(0.8);
        }

        if keyboard_input.just_pressed(KeyCode::ArrowLeft) {
            player.seek_all_by(-0.1);
        }

        if keyboard_input.just_pressed(KeyCode::ArrowRight) {
            player.seek_all_by(0.1);
        }

        if keyboard_input.just_pressed(KeyCode::Enter) {
            transitions
                .play(
                    &mut player,
                    animations.node_indices[*current_animation],
                    Duration::from_millis(250),
                )
                .repeat();
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The pinned glTF, read directly. Bevy 0.19 keeps a loaded clip's keyframes in a private map of
// curves, so the file itself is the only place the clip's bytes, its interpolation and the joint
// order are readable. Everything the runtime can confirm is confirmed separately.
// ---------------------------------------------------------------------------------------------

struct Gltf {
    json: Value,
    bin: Vec<u8>,
}

impl FromWorld for GltfCache {
    fn from_world(_world: &mut World) -> Self {
        Self {
            pinned: Some(read_glb()),
        }
    }
}

fn read_glb() -> Gltf {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(ASSET_RELATIVE);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => refuse(&format!("ASSET_UNREADABLE:{error}")),
    };
    if bytes.len() != ASSET_BYTES {
        refuse(&format!(
            "ASSET_BYTE_LENGTH:{} expected {ASSET_BYTES}",
            bytes.len()
        ));
    }
    if bytes.len() < 20 || &bytes[0..4] != b"glTF" {
        refuse("ASSET_NOT_A_GLTF");
    }
    let mut offset = 12usize;
    let mut json: Option<Value> = None;
    let mut bin: Vec<u8> = Vec::new();
    while offset + 8 <= bytes.len() {
        let header: [u8; 8] = bytes[offset..offset + 8]
            .try_into()
            .unwrap_or_else(|_| refuse("GLB_CHUNK_HEADER"));
        let length = u32::from_le_bytes([header[0], header[1], header[2], header[3]]) as usize;
        let kind = u32::from_le_bytes([header[4], header[5], header[6], header[7]]);
        let start = offset + 8;
        let end = start + length;
        if end > bytes.len() {
            refuse("GLB_CHUNK_TRUNCATED");
        }
        match kind {
            0x4E4F_534A => {
                json = serde_json::from_slice(&bytes[start..end]).ok();
                if json.is_none() {
                    refuse("GLB_JSON_UNPARSABLE");
                }
            }
            0x004E_4942 => bin = bytes[start..end].to_vec(),
            _ => {}
        }
        offset = end;
    }
    Gltf {
        json: json.unwrap_or_else(|| refuse("GLB_JSON_ABSENT")),
        bin,
    }
}

fn node_name(gltf: &Gltf, node: usize) -> String {
    gltf.json["nodes"][node]["name"]
        .as_str()
        .unwrap_or_else(|| refuse("GLTF_NODE_UNNAMED"))
        .to_string()
}

/// The float components of one accessor. Only what the pinned file uses: `5126` float data, a tight
/// or strided `bufferView`, and `SCALAR`/`VEC3`/`VEC4`.
fn accessor_f32(gltf: &Gltf, accessor: usize) -> Vec<f32> {
    let entry = &gltf.json["accessors"][accessor];
    let component_type = entry["componentType"].as_u64().unwrap_or(0);
    if component_type != 5126 {
        refuse(&format!("ACCESSOR_COMPONENT_TYPE:{component_type}"));
    }
    let components = match entry["type"].as_str().unwrap_or("") {
        "SCALAR" => 1,
        "VEC3" => 3,
        "VEC4" => 4,
        // The skin's inverse bind matrices: sixteen floats, laid out exactly as a `Mat4`'s columns.
        "MAT4" => 16,
        other => refuse(&format!("ACCESSOR_TYPE:{other}")),
    };
    let count = entry["count"].as_u64().unwrap_or(0) as usize;
    let view = &gltf.json["bufferViews"][entry["bufferView"].as_u64().unwrap_or(0) as usize];
    let base = view["byteOffset"].as_u64().unwrap_or(0) as usize
        + entry["byteOffset"].as_u64().unwrap_or(0) as usize;
    let stride = view["byteStride"]
        .as_u64()
        .map(|value| value as usize)
        .unwrap_or(components * 4);
    let mut out = Vec::with_capacity(count * components);
    for index in 0..count {
        let start = base + index * stride;
        for component in 0..components {
            let at = start + component * 4;
            if at + 4 > gltf.bin.len() {
                refuse("ACCESSOR_OUT_OF_RANGE");
            }
            let bytes: [u8; 4] = gltf.bin[at..at + 4].try_into().unwrap_or([0u8; 4]);
            out.push(f32::from_le_bytes(bytes));
        }
    }
    out
}

fn property_components(property: &str) -> usize {
    match property {
        "scale" | "translation" => 3,
        "rotation" => 4,
        _ => 0,
    }
}

/// One channel of a clip, resolved from the pinned file: the node it drives, the property, its
/// interpolation and its keyframes.
struct ClipChannel {
    node: String,
    property: String,
    interpolation: String,
    times: Vec<f32>,
    values: Vec<f32>,
}

fn clip_channels(gltf: &Gltf, animation: usize) -> Vec<ClipChannel> {
    let entry = &gltf.json["animations"][animation];
    let samplers = entry["samplers"].as_array().cloned().unwrap_or_default();
    entry["channels"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|channel| {
            let sampler = &samplers[channel["sampler"].as_u64().unwrap_or(0) as usize];
            let property = match channel["target"]["path"].as_str().unwrap_or("") {
                "translation" => "translation",
                "rotation" => "rotation",
                "scale" => "scale",
                other => refuse(&format!("CLIP_TARGET_PATH:{other}")),
            };
            let interpolation =
                match sampler.get("interpolation").and_then(|value| value.as_str()) {
                    None => "linear",
                    Some("LINEAR") => "linear",
                    Some("STEP") => "step",
                    Some("CUBICSPLINE") => "cubic-spline",
                    Some(other) => refuse(&format!("CLIP_INTERPOLATION:{other}")),
                };
            ClipChannel {
                node: node_name(gltf, channel["target"]["node"].as_u64().unwrap_or(0) as usize),
                property: property.to_string(),
                interpolation: interpolation.to_string(),
                times: accessor_f32(gltf, sampler["input"].as_u64().unwrap_or(0) as usize),
                values: accessor_f32(gltf, sampler["output"].as_u64().unwrap_or(0) as usize),
            }
        })
        .collect()
}

/// FNV-1a 64 over a declared canonical byte stream, hex. A *correspondence* digest: it answers "did
/// the two arms' bytes agree", not "is this file authentic". The SHA-256 locks are the asset file
/// and the fixture file, hashed by the runner and by the counterpart arm.
struct Digest(u64);

const FNV_OFFSET: u64 = 14695981039346656037;
const FNV_PRIME: u64 = 1099511628211;

impl Digest {
    fn new(header: &str) -> Self {
        let mut digest = Self(FNV_OFFSET);
        digest.text(header);
        digest
    }
    fn bytes(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(FNV_PRIME);
        }
    }
    fn text(&mut self, value: &str) {
        self.bytes(value.as_bytes());
        self.bytes(&[0]);
    }
    fn u32(&mut self, value: u32) {
        self.bytes(&value.to_le_bytes());
    }
    fn f32(&mut self, value: f32) {
        self.bytes(&value.to_le_bytes());
    }
    fn hex(self) -> String {
        format!("{:016x}", self.0)
    }
}

/// `threenative-foxes-clip/1`: the clip's name, then each channel in file order with its node, the
/// glTF property path, the interpolation, the key count, the key times and the key values. The
/// counterpart arm recomputes it from the clip its own glTF loader parsed, mapping the glTF paths
/// onto three's track suffixes (`translation` to `.position`, `rotation` to `.quaternion`).
fn clip_digest(name: &str, channels: &[ClipChannel]) -> String {
    let mut digest = Digest::new("threenative-foxes-clip/1");
    digest.text(name);
    digest.u32(channels.len() as u32);
    for channel in channels {
        digest.text(&channel.node);
        digest.text(&channel.property);
        digest.text(&channel.interpolation);
        digest.u32(channel.times.len() as u32);
        for time in &channel.times {
            digest.f32(*time);
        }
        for value in &channel.values {
            digest.f32(*value);
        }
    }
    digest.hex()
}

/// `threenative-foxes-mesh/1` over the buffers a renderer actually receives: counts, whether normals
/// exist, then positions, uvs, joint indices and indices. Indices are widened to `u32` on both sides
/// first, because the pinned primitive declares no index accessor — bevy keeps the mesh non-indexed
/// and three's loader generates a sequential index — so unwinding both to the same triangle list is
/// what lets one digest cover the two.
///
/// The skin weights are deliberately outside it, and that is a measured difference rather than a
/// convenience: three's `GLTFLoader` renormalises every vertex's four weights through
/// `SkinnedMesh.normalizeSkinWeights`, and bevy takes them as authored. The asset's SHA-256 covers
/// the authored values; the digest covers the channels the two loaders must agree on.
fn mesh_digest(
    positions: &[[f32; 3]],
    uvs: &[[f32; 2]],
    joints: &[[u16; 4]],
    indices: &[u32],
    has_normals: bool,
) -> String {
    let mut digest = Digest::new("threenative-foxes-mesh/1");
    digest.u32(positions.len() as u32);
    digest.u32(indices.len() as u32);
    digest.bytes(&[u8::from(has_normals)]);
    for vertex in positions {
        for value in vertex {
            digest.f32(*value);
        }
    }
    for uv in uvs {
        for value in uv {
            digest.f32(*value);
        }
    }
    for joint in joints {
        for value in joint {
            digest.bytes(&value.to_le_bytes());
        }
    }
    for index in indices {
        digest.bytes(&index.to_le_bytes());
    }
    digest.hex()
}

/// `threenative-foxes-bindposes/1` over the joint count and the column-major inverse bind matrices,
/// in `skin.joints` order.
fn bindpose_digest(binds: &[[f64; 16]]) -> String {
    let mut digest = Digest::new("threenative-foxes-bindposes/1");
    digest.u32(binds.len() as u32);
    for matrix in binds {
        for value in matrix {
            digest.f32(*value as f32);
        }
    }
    digest.hex()
}

/// The fixture's animation oracle: one channel component of the played clip, chosen by the largest
/// output range so the f64 lerp the comparator composes is well conditioned, ties broken by channel
/// order. Its keys ship with the fixture because §6.1 allows a verification oracle outside the
/// timed path.
fn oracle_channel(channels: &[ClipChannel]) -> Value {
    let mut best: Option<(usize, usize, usize, f32)> = None;
    for (channel_index, channel) in channels.iter().enumerate() {
        let components = property_components(&channel.property);
        if components == 0 {
            continue;
        }
        for component in 0..components {
            let mut low = f32::INFINITY;
            let mut high = f32::NEG_INFINITY;
            for key in 0..channel.times.len() {
                let value = channel.values[key * components + component];
                low = low.min(value);
                high = high.max(value);
            }
            let range = high - low;
            if best.is_none_or(|current| range > current.3) {
                best = Some((channel_index, component, components, range));
            }
        }
    }
    let Some((channel_index, component, components, range)) = best else {
        refuse("NO_ORACLE_CHANNEL");
    };
    let channel = &channels[channel_index];
    let times: Vec<f64> = channel.times.iter().map(|value| f64::from(*value)).collect();
    let values: Vec<f64> = (0..channel.times.len())
        .map(|key| f64::from(channel.values[key * components + component]))
        .collect();
    json!({
        "animation": ACTIVE_CLIP,
        "channel": channel_index,
        "component": component,
        "components": components,
        "interpolation": channel.interpolation,
        "keys": times.len(),
        "node": channel.node,
        "property": channel.property,
        "range": range as f64,
        "rule": "the channel component with the largest max-min over the played clip's keyframes, ties broken by channel order; its keys are the fixture's verification oracle for the animation clock",
        "times": times,
        "values": values,
    })
}

fn gltf_clip_census(gltf: &Gltf) -> Vec<Value> {
    gltf.json["animations"]
        .as_array()
        .cloned()
        .unwrap_or_else(|| refuse("GLTF_ANIMATIONS_ABSENT"))
        .iter()
        .enumerate()
        .map(|(index, animation)| {
            let channels = clip_channels(gltf, index);
            let name = animation["name"].as_str().unwrap_or("").to_string();
            let duration = channels
                .first()
                .and_then(|channel| channel.times.last().copied())
                .unwrap_or_default();
            let mut targets: Vec<&String> = channels.iter().map(|channel| &channel.node).collect();
            targets.sort_unstable();
            targets.dedup();
            json!({
                "channels": channels.len(),
                "digest": clip_digest(&name, &channels),
                "duration": f64::from(duration),
                "index": index,
                "interpolation": channels
                    .first()
                    .map(|channel| channel.interpolation.clone())
                    .unwrap_or_default(),
                "keys": channels.first().map(|channel| channel.times.len()).unwrap_or(0),
                "name": name,
                "nodes": channels
                    .iter()
                    .map(|channel| channel.node.clone())
                    .collect::<Vec<String>>(),
                "targets": targets.len(),
            })
        })
        .collect()
}

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

fn quat(transform: &Transform) -> [f64; 4] {
    let q = transform.rotation;
    [q.x as f64, q.y as f64, q.z as f64, q.w as f64]
}

fn triple(value: Vec3) -> [f64; 3] {
    [value.x as f64, value.y as f64, value.z as f64]
}

fn matrix16(matrix: Mat4) -> [f64; 16] {
    let columns = matrix.to_cols_array();
    let mut out = [0.0; 16];
    for (index, value) in columns.iter().enumerate() {
        out[index] = f64::from(*value);
    }
    out
}

fn mat4_from_columns(values: &[f64; 16]) -> Mat4 {
    let mut columns = [0.0f32; 16];
    for (index, value) in values.iter().enumerate() {
        columns[index] = *value as f32;
    }
    Mat4::from_cols_array(&columns)
}

/// The plane's own buffers, exported as bytes: it is four vertices, and §6.1's "exact mesh and index
/// buffers" is then a byte comparison rather than a matching name.
fn export_plane_mesh(mesh: &Mesh) -> Value {
    let positions = match mesh.attribute(Mesh::ATTRIBUTE_POSITION) {
        Some(VertexAttributeValues::Float32x3(entries)) => entries.clone(),
        Some(_) => refuse("PLANE_POSITION_UNSUPPORTED"),
        None => refuse("PLANE_POSITION_ABSENT"),
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

fn attribute_name(values: &VertexAttributeValues) -> &'static str {
    match values {
        VertexAttributeValues::Uint16x4(_) => "uint16x4",
        VertexAttributeValues::Uint8x4(_) => "uint8x4",
        VertexAttributeValues::Uint32x4(_) => "uint32x4",
        VertexAttributeValues::Float32x4(_) => "float32x4",
        _ => "other",
    }
}

/// The fox mesh's own channel census: the digest both arms recompute, plus the counts that say how
/// much was there. The buffers themselves are not shipped: they are inside the asset both arms
/// loaded, and the asset's SHA-256 is the lock.
fn fox_mesh_census(mesh: &Mesh) -> Value {
    let Some(VertexAttributeValues::Float32x3(positions)) =
        mesh.attribute(Mesh::ATTRIBUTE_POSITION)
    else {
        refuse("FOX_POSITION_UNSUPPORTED");
    };
    let uvs = match mesh.attribute(Mesh::ATTRIBUTE_UV_0) {
        Some(VertexAttributeValues::Float32x2(entries)) => entries.clone(),
        _ => refuse("FOX_UV_UNSUPPORTED"),
    };
    let weights = match mesh.attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT) {
        Some(VertexAttributeValues::Float32x4(entries)) => entries.len(),
        Some(other) => refuse(&format!("FOX_WEIGHT_UNSUPPORTED:{}", attribute_name(other))),
        None => refuse("FOX_WEIGHT_ABSENT"),
    };
    let joints: Vec<[u16; 4]> = match mesh.attribute(Mesh::ATTRIBUTE_JOINT_INDEX) {
        Some(VertexAttributeValues::Uint16x4(entries)) => entries.clone(),
        Some(VertexAttributeValues::Uint8x4(entries)) => entries
            .iter()
            .map(|value| {
                [
                    u16::from(value[0]),
                    u16::from(value[1]),
                    u16::from(value[2]),
                    u16::from(value[3]),
                ]
            })
            .collect(),
        Some(VertexAttributeValues::Uint32x4(entries)) => entries
            .iter()
            .map(|value| {
                [
                    value[0] as u16,
                    value[1] as u16,
                    value[2] as u16,
                    value[3] as u16,
                ]
            })
            .collect(),
        Some(other) => refuse(&format!("FOX_JOINT_UNSUPPORTED:{}", attribute_name(other))),
        None => refuse("FOX_JOINT_ABSENT"),
    };
    let has_normals = matches!(
        mesh.attribute(Mesh::ATTRIBUTE_NORMAL),
        Some(VertexAttributeValues::Float32x3(_))
    );
    // The pinned primitive declares no index accessor, so bevy keeps the mesh non-indexed. The
    // effective triangle list is then 0..vertices, which is exactly what three's loader generates
    // for the same file — unwinding both sides to that list is what lets one digest cover two
    // loaders that legitimately disagree about whether an index buffer exists.
    let (indices, source_indexed) = match mesh.indices() {
        Some(Indices::U32(entries)) => (entries.clone(), true),
        Some(Indices::U16(entries)) => (entries.iter().map(|value| *value as u32).collect(), true),
        None => ((0..positions.len() as u32).collect(), false),
    };
    if uvs.len() != positions.len() || weights != positions.len() || joints.len() != positions.len()
    {
        refuse("FOX_CHANNEL_COUNT_MISMATCH");
    }
    json!({
        "digest": mesh_digest(&positions, &uvs, &joints, &indices, has_normals),
        "hasNormals": has_normals,
        "indexCount": indices.len(),
        "joints": joints.len(),
        "sourceIndexed": source_indexed,
        "stream": "threenative-foxes-mesh/1",
        "triangles": indices.len() / 3,
        "vertices": positions.len(),
        "weightsExcluded": "three's GLTFLoader renormalises every vertex's four skin weights through SkinnedMesh.normalizeSkinWeights and bevy takes them as authored, so the one channel the two loaders legitimately differ on is outside the digest and inside the asset's SHA-256",
    })
}

/// First fox, a fox past index eight, and the last fox: §6.1 and §6.2 both ask for an object beyond
/// the first eight, and the last one is the boundary of the set.
fn probe_indices(count: usize) -> Vec<usize> {
    let mut indices = vec![0usize];
    for candidate in [8usize, 25] {
        if count > candidate {
            indices.push(candidate);
        }
    }
    if count > 1 {
        indices.push(count - 1);
    }
    indices.sort_unstable();
    indices.dedup();
    indices
}

fn env_or_unrecorded(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| "unrecorded".to_string())
}

fn collect_descendants(root: Entity, children: &Query<&Children>, out: &mut Vec<Entity>) {
    let Ok(list) = children.get(root) else {
        return;
    };
    for child in list.iter() {
        out.push(child);
        collect_descendants(child, children, out);
    }
}

type RingRow = (Entity, u32, f32, RotationDirection, Vec<Entity>);

fn foxes_in(ring_rows: &[RingRow]) -> usize {
    ring_rows.iter().map(|row| row.4.len()).sum()
}

/// Every query the census reads, in one bundle: Bevy allows a system sixteen parameters, and this
/// census needs more world views than that.
#[derive(SystemParam)]
struct Census<'w, 's> {
    pub windows: Query<'w, 's, &'static Window, With<PrimaryWindow>>,
    pub rings: Query<
        'w,
        's,
        (Entity, &'static Ring, &'static RotationDirection, &'static Children),
    >,
    pub children: Query<'w, 's, &'static Children>,
    pub fox_roots: Query<'w, 's, &'static Transform, With<WorldAssetRoot>>,
    pub skinned: Query<
        'w,
        's,
        (
            &'static SkinnedMesh,
            &'static Mesh3d,
            &'static MeshMaterial3d<StandardMaterial>,
            &'static ChildOf,
        ),
    >,
    pub camera: Query<'w, 's, (&'static Transform, &'static Projection, &'static Msaa), With<Camera>>,
    pub light: Query<
        'w,
        's,
        (
            &'static DirectionalLight,
            &'static Transform,
            Option<&'static CascadeShadowConfig>,
        ),
    >,
    pub plane: Query<
        'w,
        's,
        (
            &'static Mesh3d,
            &'static MeshMaterial3d<StandardMaterial>,
            &'static Transform,
        ),
        (Without<ChildOf>, Without<SkinnedMesh>),
    >,
}

/// §6.3's common profile is MSAA off and Bevy 0.19 keeps `Msaa` on the camera entity rather than on
/// the `Window`, so the switch is a component the adapter sets on the camera upstream spawned.
fn prd449_msaa_off(mut cameras: Query<&mut Msaa, With<Camera>>) {
    for mut msaa in &mut cameras {
        *msaa = Msaa::Off;
    }
}

/// Exports the canonical fixture once the upstream source's own assets have arrived: the ring
/// hierarchy and every fox's placement, phase and scale, the camera, the light, the plane, the
/// skeleton and clip identity read from the pinned file and cross-checked against what the runtime
/// loaded, the frame schedule and the source pins.
fn prd449_export_when_ready(
    args: Res<Args>,
    foxes: Res<Foxes>,
    phases: Res<Phases>,
    gltf: Res<GltfCache>,
    meshes: Res<Assets<Mesh>>,
    materials: Res<Assets<StandardMaterial>>,
    images: Res<Assets<Image>>,
    clips: Res<Assets<AnimationClip>>,
    asset_paths: Res<AssetServer>,
    bindposes: Res<Assets<SkinnedMeshInverseBindposes>>,
    census: Census,
    mut measure: ResMut<Measure>,
) {
    let Census {
        windows,
        rings,
        children,
        fox_roots,
        skinned,
        camera,
        light,
        plane,
    } = census;
    if measure.fixture.is_some() {
        return;
    }
    // Ready means: every fox root exists, every scene instance has produced its skinned mesh, and
    // all three clips the upstream source requested are present. Anything less would export a
    // census of a half-built scene.
    if fox_roots.iter().count() != foxes.count
        || skinned.iter().count() != foxes.count
        || clips.is_empty()
    {
        return;
    }
    let pinned = gltf
        .pinned
        .as_ref()
        .expect("the pinned glTF is read once at startup");

    // Rings, in upstream order: the radius grows by RING_SPACING per ring, so the radius *is* the
    // index, and sorting by it recovers the spawn order a query does not promise.
    let mut ring_rows: Vec<RingRow> = rings
        .iter()
        .map(|(entity, ring, direction, list)| {
            (
                entity,
                ((ring.radius / RING_SPACING).round() as u32) - 1,
                ring.radius,
                *direction,
                list.iter().collect(),
            )
        })
        .collect();
    ring_rows.sort_by_key(|row| row.1);
    for (position, row) in ring_rows.iter().enumerate() {
        if position as u32 != row.1
            || (row.2 - RING_SPACING * (row.1 as f32 + 1.0)).abs() > 1e-4
            || row.4.is_empty()
        {
            refuse("RING_LAYOUT_MISMATCH");
        }
    }
    if foxes_in(&ring_rows) != foxes.count {
        refuse("FOX_COUNT_MISMATCH");
    }

    // Every fox, in the same flattened order, with the skinned mesh it instanced.
    let mut rows: Vec<FoxRow> = Vec::new();
    let mut mesh_handle: Option<Handle<Mesh>> = None;
    let mut material_handle: Option<Handle<StandardMaterial>> = None;
    let mut binds: Vec<[f64; 16]> = Vec::new();
    for row in &ring_rows {
        for root in &row.4 {
            let mut descendants = Vec::new();
            collect_descendants(*root, &children, &mut descendants);
            let found: Vec<_> = descendants
                .iter()
                .filter_map(|entity| skinned.get(*entity).ok())
                .collect();
            let [(skin, mesh, material, _)] = found.as_slice() else {
                refuse("FOX_SKINNED_MESH_CENSUS");
            };
            match &mesh_handle {
                None => {
                    mesh_handle = Some(mesh.0.clone());
                    material_handle = Some(material.0.clone());
                    let Some(loaded) = bindposes.get(&skin.inverse_bindposes) else {
                        refuse("FOX_BIND_POSES_ABSENT");
                    };
                    binds = loaded.iter().map(|matrix| matrix16(*matrix)).collect();
                }
                Some(existing) if *existing != mesh.0 => refuse("FOX_MESH_HANDLE_DIVERGED"),
                Some(_) => {}
            }
            let Some((_, phase)) = phases.0.iter().find(|(entity, _)| entity == root) else {
                refuse("FOX_PHASE_ABSENT");
            };
            rows.push(FoxRow {
                index: rows.len() as u32,
                ring: row.1,
                phase: *phase,
                joints: skin.joints.clone(),
            });
        }
    }
    if rows.len() != foxes.count {
        refuse("FOX_COUNT_MISMATCH");
    }

    // The skeleton, from the pinned file, cross-checked against what the runtime loaded.
    let skin_json = &pinned.json["skins"][0];
    let joint_names: Vec<String> = skin_json["joints"]
        .as_array()
        .cloned()
        .unwrap_or_else(|| refuse("GLTF_SKIN_JOINTS_ABSENT"))
        .iter()
        .map(|node| node_name(pinned, node.as_u64().unwrap_or(0) as usize))
        .collect();
    let declared_binds: Vec<[f64; 16]> =
        accessor_f32(pinned, skin_json["inverseBindMatrices"].as_u64().unwrap_or(0) as usize)
            .chunks_exact(16)
            .map(|chunk| {
                let mut matrix = [0.0; 16];
                for (index, value) in chunk.iter().enumerate() {
                    matrix[index] = f64::from(*value);
                }
                matrix
            })
            .collect();
    if declared_binds.len() != joint_names.len() || binds.len() != joint_names.len() {
        refuse("BIND_POSE_COUNT");
    }
    for (loaded, declared) in binds.iter().zip(declared_binds.iter()) {
        for (index, (left, right)) in loaded.iter().zip(declared.iter()).enumerate() {
            if (left - right).abs() > 1e-6 {
                refuse(&format!("BIND_POSE_COMPONENT:{index}"));
            }
        }
    }
    if rows.iter().any(|row| row.joints.len() != joint_names.len()) {
        refuse("FOX_JOINT_COUNT_MISMATCH");
    }

    // Clips: every clip the upstream source requested, by glTF animation index, with the duration and
    // the animation-target count the runtime states.
    let clips_json = gltf_clip_census(pinned);
    let mut loaded_clips: Vec<(usize, f64, usize, usize)> = Vec::new();
    for (id, clip) in clips.iter() {
        let Some(path) = asset_paths.get_path(id) else {
            refuse("CLIP_ASSET_PATH_ABSENT");
        };
        let Some(index) = path
            .label()
            .and_then(|label| label.strip_prefix("Animation"))
            .and_then(|digits| digits.parse::<usize>().ok())
        else {
            refuse("CLIP_ASSET_LABEL_UNREADABLE");
        };
        let targets = clip.curves();
        let curves: usize = targets.values().map(|group| group.len()).sum();
        loaded_clips.push((index, f64::from(clip.duration()), targets.len(), curves));
    }
    loaded_clips.sort_by_key(|(index, _, _, _)| *index);
    if loaded_clips.len() != clips_json.len() {
        refuse("CLIP_CENSUS");
    }
    let mut runtime_clips: Vec<Value> = Vec::new();
    for ((index, duration, targets, curves), declared) in loaded_clips.iter().zip(clips_json.iter()) {
        if *index as u64 != declared["index"].as_u64().unwrap_or(u64::MAX) {
            refuse("CLIP_INDEX_MISMATCH");
        }
        if (duration - declared["duration"].as_f64().unwrap_or(-1.0)).abs() > 1e-6 {
            refuse("CLIP_DURATION_MISMATCH");
        }
        // One curve per channel, grouped by the node the channel drives: the pinned file's `Run` clip
        // has 21 channels over 20 distinct nodes because `b_Hip_01` carries both a translation and a
        // rotation channel. Both numbers are what the file declares, and both are checked.
        if *curves != declared["channels"].as_u64().unwrap_or(0) as usize {
            refuse("CLIP_CURVE_COUNT_MISMATCH");
        }
        if *targets != declared["targets"].as_u64().unwrap_or(0) as usize {
            refuse("CLIP_TARGET_COUNT_MISMATCH");
        }
        runtime_clips.push(json!({
            "curves": curves,
            "duration": duration,
            "index": index,
            "targets": targets,
        }));
    }
    let oracle = oracle_channel(&clip_channels(pinned, ACTIVE_CLIP));
    let oracle_node = oracle["node"].as_str().unwrap_or_default().to_string();
    let Some(oracle_joint) = joint_names.iter().position(|name| name == &oracle_node) else {
        refuse("ORACLE_NODE_NOT_A_JOINT");
    };

    // Geometry and material bindings.
    let mesh_json = fox_mesh_census(
        meshes
            .get(mesh_handle.as_ref().expect("one fox is enough"))
            .unwrap_or_else(|| refuse("FOX_MESH_ABSENT")),
    );
    let fox_material = materials
        .get(material_handle.as_ref().expect("one fox is enough"))
        .unwrap_or_else(|| refuse("FOX_MATERIAL_ABSENT"));
    let srgb = fox_material.base_color.to_srgba();
    // The texture the fox's own material binds, not merely the first image the asset server happens
    // to hold: bevy's default window cursor is an image too, and `Assets::iter` has no order.
    let texture_json = match fox_material
        .base_color_texture
        .as_ref()
        .and_then(|handle| images.get(handle))
    {
        Some(image) => {
            let size = image.texture_descriptor.size;
            json!({
                "format": format!("{:?}", image.texture_descriptor.format),
                "height": size.height,
                "mipLevelCount": image.texture_descriptor.mip_level_count,
                "stream": "threenative-foxes-image/1",
                "width": size.width,
            })
        }
        None => Value::Null,
    };

    let Ok((plane_mesh, plane_material, _)) = plane.single() else {
        refuse("PLANE_CENSUS");
    };
    let plane_srgb = materials
        .get(&plane_material.0)
        .unwrap_or_else(|| refuse("PLANE_MATERIAL_ABSENT"))
        .base_color
        .to_srgba();

    let Ok((camera_transform, projection, msaa)) = camera.single() else {
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
    let Ok((directional, light_transform, cascade)) = light.single() else {
        refuse("LIGHT_CENSUS");
    };
    let Ok(window) = windows.single() else {
        refuse("WINDOW_CENSUS");
    };
    let size = window.physical_size();
    let requested: (u32, u32) = (WINDOW_RESOLUTION.0 as u32, WINDOW_RESOLUTION.1 as u32);
    let deviation = if (size.x, size.y) == requested {
        Value::Null
    } else {
        json!(format!(
            "requested {}x{}; this desktop's window-manager work area is 1920x1050, so both arms render {}x{}",
            requested.0, requested.1, size.x, size.y
        ))
    };

    // The fox rows, in the flattened order, with the placement upstream authored.
    let mut fox_values: Vec<Value> = Vec::new();
    let mut flat = 0usize;
    for row in &ring_rows {
        for root in &row.4 {
            let transform = fox_roots
                .get(*root)
                .unwrap_or_else(|_| refuse("FOX_ROOT_ABSENT"));
            let fox = &rows[flat];
            fox_values.push(json!({
                "entityIndex": root.index_u32(),
                "index": fox.index,
                "joints": fox.joints.len(),
                "phase": f64::from(fox.phase),
                "ring": fox.ring,
                "ringRadius": f64::from(row.2),
                "rotation": quat(transform),
                "scale": triple(transform.scale),
                "translation": triple(transform.translation),
            }));
            flat += 1;
        }
    }
    let ring_values: Vec<Value> = ring_rows
        .iter()
        .map(|row| {
            json!({
                "direction": match row.3 {
                    RotationDirection::CounterClockwise => "counter-clockwise",
                    RotationDirection::Clockwise => "clockwise",
                },
                "foxes": row.4.len(),
                "index": row.1,
                "radius": f64::from(row.2),
                // Upstream spawns every ring at `Transform::default()`, so the whole rotation is
                // composed from identity by the reader: sign, radius, the fixed step and the
                // declared step count. An observation here would be a mid-run value that depends on
                // when the export happened, which is exactly the kind of input the oracle must not
                // inherit from the run it is checking.
                "sign": f64::from(row.3.sign()),
                "spawnRotation": [0.0, 0.0, 0.0, 1.0],
            })
        })
        .collect();
    let probe_rows = probe_indices(rows.len());

    let fixture = json!({
        "asset": {
            "attribution": "Bevy CREDITS at the pinned commit: model by PixelMannen (CC0 1.0 Universal), rigging and animation by @tomkranis (CC-BY 4.0), which is also what the file's own asset.copyright string says. Separate from Bevy's MIT/Apache-2.0 code licence.",
            "bytes": ASSET_BYTES,
            "copyright": pinned.json["asset"]["copyright"].as_str().unwrap_or(""),
            "name": "Fox.glb",
            "path": ASSET_RELATIVE,
            "sha256": env_or_unrecorded("TN_BENCH_FOX_ASSET_SHA256"),
        },
        "camera": {
            "far": far,
            "fovDegrees": fov_degrees,
            "msaa": format!("{msaa:?}"),
            "near": near,
            "position": triple(camera_transform.translation),
            "rotation": quat(camera_transform),
        },
        "clips": clips_json,
        "counts": {
            "directionalLights": 1,
            "foxes": rows.len(),
            "joints": joint_names.len(),
            "requestedFoxes": foxes.count,
            "rings": ring_rows.len(),
        },
        "environment": {
            "antialias": format!("{msaa:?}"),
            "background": "bevy-window-clear",
            "motionBlur": false,
            "shadowMapsEnabled": directional.shadow_maps_enabled,
            "staticTransformOptimizations": "Disabled (upstream)",
        },
        "family": "bevy-many-foxes",
        "foxes": fox_values,
        "frameSchedule": {
            "firstScoredFrameTimeDeltas": args.warmup_frames + 1,
            "foxSpacing": f64::from(FOX_SPACING),
            "foxSpeed": 2.0,
            "frameDelta": FRAME_DELTA,
            "measuredFrames": args.measured_frames,
            "ringSpacing": f64::from(RING_SPACING),
            "ringsMoving": true,
            "staggerDivisor": 10.0,
            "warmupFrames": args.warmup_frames,
            "stepNote": "Bevy's first Time update records first_update without calling advance_by, so that frame's delta is zero; update_fox_rings and the animation graph's advancement both read that delta, so one count governs both and the ring oracle is what proves it",
        },
        "light": {
            "cascades": cascade.map_or_else(Vec::new, |config| {
                config.bounds.iter().map(|value| f64::from(*value)).collect::<Vec<f64>>()
            }),
            "minimumDistance": cascade.map_or(0.0, |config| f64::from(config.minimum_distance)),
            "overlapProportion": cascade.map_or(0.0, |config| f64::from(config.overlap_proportion)),
            "rotation": quat(light_transform),
            "shadowMapsEnabled": directional.shadow_maps_enabled,
        },
        "material": {
            "baseColor": [
                srgb.red as f64,
                srgb.green as f64,
                srgb.blue as f64,
                srgb.alpha as f64,
            ],
            "metallic": fox_material.metallic as f64,
            "perceptualRoughness": fox_material.perceptual_roughness as f64,
            "texture": texture_json,
            "textureBinding": match pinned.json["materials"][0]["pbrMetallicRoughness"]
                .get("baseColorTexture")
            {
                Some(_) => "baseColorTexture",
                None => "none",
            },
        },
        "mesh": mesh_json,
        "oracleChannel": oracle,
        "plane": {
            "color": [
                plane_srgb.red as f64,
                plane_srgb.green as f64,
                plane_srgb.blue as f64,
                plane_srgb.alpha as f64,
            ],
            "mesh": export_plane_mesh(
                meshes
                    .get(&plane_mesh.0)
                    .unwrap_or_else(|| refuse("PLANE_MESH_ABSENT")),
            ),
        },
        "probeFoxIndices": probe_rows,
        "rings": ring_values,
        "runtime": {
            "clips": runtime_clips,
            "note": "bevy 0.19's AnimationClip keeps its curves in a private map, so this arm states the index, the duration and the animation-target count it loaded, and takes the keyframes, the interpolation and the joint order from the pinned file; the bone poses at six frames are what prove both arms evaluated that clip the same way",
        },
        "schedule": "bevy-fractional-frame-boundary/1",
        "schemaVersion": 1,
        "skin": {
            "bindposeDigest": bindpose_digest(&declared_binds),
            "inverseBindMatrices": declared_binds,
            "joints": joint_names,
            "stream": "threenative-foxes-bindposes/1",
        },
        "source": {
            "adapterSha256": env_or_unrecorded("TN_BENCH_BEVY_ADAPTER_SHA256"),
            "commit": UPSTREAM_COMMIT,
            "patch": [
                "TimeUpdateStrategy::ManualDuration(1/60) replaces Bevy's wall-clock Automatic strategy, so Time, Time<Real> and Time<Virtual> all advance exactly 1/60 s per frame and both update_fox_rings and the animation graph's own advancement read it; upstream many_foxes has no benchmark switch, so this resource is the whole determinism patch",
                "DirectionalLight.shadow_maps_enabled forced to false: upstream requests true and the primary cell is shadows off; the upstream cascade config is kept and exported as a disclosure",
                "Msaa::Off forced on the camera upstream spawned, where bevy 0.19 keeps MSAA as a camera component and defaults it to 4x, because the common profile requires MSAA off; the observed value is exported in the fixture",
                "Window.decorations set to false so a decorating window manager cannot shrink the render attachment; the exported viewport is the actual attachment with its deviation recorded",
                "The pinned warning text is included from stress_tests/ instead of the upstream sibling path, because the adapter is compiled as examples/prd449_foxes.rs",
                "AssetPlugin.file_path pointed back at this checkout's assets/ directory, because Bevy's default asset root is the executable's own directory (target/release/examples/) and the upstream path string is left unchanged",
                "--warmup-frames, --measured-frames, --fixture-out and --arm added to Args; the fixture export, the frame schedule, the conformance probes, the work counters and one wgpu Device::poll(PollType::wait_indefinitely()) completion drain per boundary added; the ring hierarchy, the ring directions, the spacing, the 0.01 scale, the facing, the three clips and their add_clips order, the seek_to(entity_index / 10) phase, update_fox_rings, keyboard_animation_control, the plane, the camera framing and setup_scene_once_loaded are unchanged",
            ],
            "path": UPSTREAM_PATH,
            "upstreamSha256": env_or_unrecorded("TN_BENCH_BEVY_UPSTREAM_SHA256"),
        },
        "variant": if foxes.sync { "sync" } else { "staggered" },
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
    measure.rings = ring_rows.iter().map(|row| (row.1, row.0)).collect();
    measure.foxes = rows;
    measure.probes = probe_rows
        .iter()
        .map(|row| FoxProbe {
            fox: *row,
            binds: binds.clone(),
        })
        .collect();
    measure.oracle_joint = oracle_joint;
}

/// The frame schedule. One system in `Last`, so every boundary is taken after that frame's own
/// update work, its animation evaluation and its render submission, and before the next frame's.
/// The measured window opens on the first frame after the unscored pre-drain and closes on the
/// frame that observes the final completion wait.
fn measure_frame(
    args: Res<Args>,
    visibility: Query<&ViewVisibility, With<SkinnedMesh>>,
    transforms: Query<(&Transform, &GlobalTransform)>,
    mut measure: ResMut<Measure>,
) {
    let open_scored_window = |measure: &mut Measure, index: u32, stamp: f64| {
        measure.scored = Some(index);
        measure.boundaries.push((index, stamp));
        if STATE_FRAMES.contains(&index) {
            match prd449_state(index, measure, &transforms) {
                Some(state) => measure.states.push((index, state)),
                None => refuse("PROBE_UNOBSERVED"),
            }
            measure.ring_runs_at_sample.push((index, measure.ring_runs));
        }
        if index == args.measured_frames / 2 {
            measure.work = Some(json!({
                "authoredFoxes": visibility.iter().count(),
                "note": "bevy 0.19 exposes no submitted-draw or submitted-triangle counter to the main world, so those are null with a reason rather than zero",
                "sampledAtMeasuredFrame": index,
                "shadowMapsEnabled": false,
                "submittedDrawCalls": Value::Null,
                "submittedTriangles": Value::Null,
                "visibleFoxes": visibility.iter().filter(|entry| entry.get()).count(),
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
            measure.final_completion_ms =
                Some(f64::from_bits(DRAIN_COMPLETED_MS.load(Ordering::SeqCst)));
            measure.final_drain_wait_ms =
                Some(f64::from_bits(DRAIN_WAIT_MS.load(Ordering::SeqCst)));
            measure.done = true;
        }
    }
    measure.frame += 1;
}

/// Runs immediately after `update_fox_rings`, so its count is that system's own: §5.1 asks for the
/// actual effect rather than an option's name, and a count is the evidence a transform cannot give.
fn prd449_count_rings(mut measure: ResMut<Measure>) {
    measure.ring_runs += 1;
}

/// The conformance record for one sampled frame: every ring's rotation, one pose scalar for every
/// fox so §5.1's "independently evaluated skeleton" is measurable rather than asserted, and for the
/// probed foxes their full local joint transforms, two skin matrices and the oracle joint's own
/// translation and rotation.
fn prd449_state(
    frame: u32,
    measure: &Measure,
    transforms: &Query<(&Transform, &GlobalTransform)>,
) -> Option<Value> {
    let mut rings: Vec<Value> = Vec::new();
    for (index, entity) in &measure.rings {
        let Ok((transform, _)) = transforms.get(*entity) else {
            return None;
        };
        rings.push(json!({ "index": index, "rotation": quat(transform) }));
    }
    let bones_of = |row: &FoxRow| -> Option<Vec<[f64; 7]>> {
        let mut bones = Vec::with_capacity(row.joints.len());
        for joint in &row.joints {
            let Ok((transform, _)) = transforms.get(*joint) else {
                return None;
            };
            let q = transform.rotation;
            bones.push([
                transform.translation.x as f64,
                transform.translation.y as f64,
                transform.translation.z as f64,
                q.x as f64,
                q.y as f64,
                q.z as f64,
                q.w as f64,
            ]);
        }
        Some(bones)
    };
    let mut pose_scalars: Vec<Value> = Vec::with_capacity(measure.foxes.len());
    for row in &measure.foxes {
        pose_scalars.push(json!(scalar_of(&bones_of(row)?)));
    }
    let mut probed: Vec<Value> = Vec::new();
    for probe in &measure.probes {
        let row = measure.foxes.get(probe.fox)?;
        let bones = bones_of(row)?;
        let mut skin_matrices: Vec<Value> = Vec::new();
        for joint_index in SKIN_PROBE_JOINTS {
            let entity = row.joints.get(joint_index)?;
            let bind = probe.binds.get(joint_index)?;
            let Ok((_, global)) = transforms.get(*entity) else {
                return None;
            };
            skin_matrices.push(json!(matrix16(
                global.to_matrix() * mat4_from_columns(bind)
            )));
        }
        let Ok((oracle_transform, _)) = transforms.get(*row.joints.get(measure.oracle_joint)?)
        else {
            return None;
        };
        probed.push(json!({
            "bonePoses": bones,
            "index": row.index,
            "joints": bones.len(),
            "oracleRotation": quat(oracle_transform),
            "oracleTranslation": triple(oracle_transform.translation),
            "phase": f64::from(row.phase),
            "poseScalar": scalar_of(&bones),
            "ring": row.ring,
            "skinMatrices": skin_matrices,
        }));
    }
    Some(json!({
        "foxes": probed,
        "frameId": frame,
        "poseScalars": pose_scalars,
        "rings": rings,
        "ringSystemRuns": measure.ring_runs,
    }))
}

/// One number per fox, from its local joint transforms only, so it is the pose and not the ring
/// placement. §5.1's staggered variant is only honest if the foxes differ in this.
fn scalar_of(bones: &[[f64; 7]]) -> f64 {
    let total: f64 = bones.iter().flat_map(|bone| bone.iter()).sum();
    total / (bones.len() * 7) as f64
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
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or(Value::Null);

    let report = json!({
        "adapter": adapter,
        "arm": args.arm.clone().unwrap_or_else(|| "bevy-desktop".to_string()),
        "asset": {
            "bytes": ASSET_BYTES,
            "path": ASSET_RELATIVE,
            // Hashed by the runner from the same path the counterpart arm's build injects, because
            // the pinned Rust dependencies carry no SHA-256; the file's own length is read here.
            "sha256": env_or_unrecorded("TN_BENCH_FOX_ASSET_SHA256"),
        },
        "boundarySemantics": "render-producing frame boundary at the end of the main schedule; each interval carries the previous frame's ring update, its animation evaluation, its render submission and any GPU wait",
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
        "family": "bevy-many-foxes",
        "fixture": {
            "foxes": fixture["counts"]["foxes"].clone(),
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
                .collect::<Vec<Value>>(),
            "finalCompletionMs": final_completion,
            "schemaVersion": 1,
            "unit": "ms",
        },
        "states": measure
            .states
            .iter()
            .map(|(frame_id, state)| json!({ "frameId": frame_id, "state": state }))
            .collect::<Vec<Value>>(),
        "systemRuns": {
            "atSampledFrames": measure
                .ring_runs_at_sample
                .iter()
                .map(|(frame_id, runs)| json!({
                    "frameId": frame_id,
                    "ringSystemRuns": runs,
                }))
                .collect::<Vec<Value>>(),
            "note": "`update_fox_rings` runs on every frame of this arm, so its count is the evidence that the rings moved rather than the rings' option name",
        },
        "variant": fixture["variant"].clone(),
        "viewport": {
            "deviation": fixture["viewport"]["deviation"].clone(),
            "height": fixture["viewport"]["height"].clone(),
            "width": fixture["viewport"]["width"].clone(),
        },
        "warmupFrames": args.warmup_frames,
        "work": measure.work.clone().unwrap_or(Value::Null),
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
