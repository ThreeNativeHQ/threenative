//! PRD-449 `bevy-city`: the pinned upstream `bevy_city` example with the deterministic fixture clock,
//! the measured frame schedule and the canonical fixture export this family needs.
//!
//! **Source pin.** bevy `v0.19.0`, commit `c6f634ca9f406d68ba5109d921247b654cb42c10`,
//! `examples/large_scenes/bevy_city`. `src/generate_city.rs` and `src/settings.rs` are the pinned
//! files byte for byte. `src/assets.rs` differs from the pinned file by exactly one line, its
//! `BASE_URL`, and this file is the pinned `main.rs` with the patches below. Every patch is listed
//! here, repeated in the `source.patch` array of every fixture this arm writes, and hashed with this
//! package's own files.
//!
//! **Adapter patches, disclosed in full.**
//!
//! 1. `assets.rs`: `BASE_URL` resolves the same 56 Kenney files from the vendored copy under the
//!    pinned checkout's `assets/kenney/` instead of over HTTPS, so the run is offline and the bytes
//!    are hashable. `BEVY_ASSET_ROOT` must name the checkout; the arm refuses without it.
//! 2. `TimeUpdateStrategy::ManualDuration(1/60 s)` replaces Bevy's wall-clock `Automatic` strategy,
//!    so `Time`, `Time<Real>` and `Time<Virtual>` all advance exactly 1/60 s per frame and
//!    `simulate_cars` — which reads `Res<Time>` — runs on the fixture clock rather than the host's.
//! 3. `Args` gains `--variant`, `--profile`, `--warmup-frames`, `--measured-frames`, `--fixture-out`
//!    and `--arm`. `--seed` is upstream's own default and `--size` defaults to 8 because this is the
//!    small fixture, upstream's 30 being the default-size cell.
//! 4. `Settings::simulate_cars` is set from `--variant`, so `static` is upstream's own "Simulate
//!    Cars" unchecked rather than an invented freeze, and `Window::decorations` is false so a
//!    decorating window manager cannot shrink the render attachment.
//! 5. `--profile common` (§6.3) clears the directional light's shadow flags and removes the
//!    camera's contact-shadow, atmosphere, HDR, bloom and TAA components. It also omits the
//!    atmosphere entity. `--profile upstream` changes nothing.
//! 6. The `prd449_*` systems: the census-stability gate, the fixture export, the frame schedule, the
//!    conformance probes, the work counters, the `simulate_cars` application count, and one
//!    `wgpu::Device::poll(PollType::wait_indefinitely())` completion drain per boundary on the
//!    render thread, which is the only place in this process that holds a `wgpu::Device`.
//!
//! **Timing semantics**, declared so the counterpart arm can be checked against it: `boundaries` are
//! `N+1` render-producing frame boundaries taken at the end of the main schedule, so each interval
//! carries the previous frame's transform work, its render submission and any GPU wait. The
//! completed-work mean additionally includes exactly one GPU completion wait, taken after the last
//! measured frame has been submitted and reported as `finalCompletionMs`; one extra untimed frame's
//! submission therefore falls inside that wait (`drain.includesUntimedFrames: 1`).

use std::{
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

use argh::FromArgs;
use bevy::{
    anti_alias::taa::TemporalAntiAliasing,
    asset::AssetServer,
    camera::{visibility::NoCpuCulling, Exposure, Hdr},
    camera::visibility::ViewVisibility,
    camera_controller::free_camera::{FreeCamera, FreeCameraPlugin},
    color::palettes::css::WHITE,
    ecs::{hierarchy::Children, system::SystemParam},
    mesh::UvChannel,
    feathers::{dark_theme::create_dark_theme, theme::UiTheme, FeathersPlugins},
    light::{
        atmosphere::{Falloff, PhaseFunction, ScatteringMedium, ScatteringTerm},
        Atmosphere, AtmosphereEnvironmentMapLight,
    },
    pbr::{
        wireframe::{WireframeConfig, WireframePlugin},
        AtmosphereSettings, ContactShadows,
    },
    post_process::bloom::Bloom,
    prelude::*,
    render::{
        renderer::{RenderAdapterInfo, RenderDevice},
        Render, RenderApp,
    },
    time::TimeUpdateStrategy,
    window::{PresentMode, PrimaryWindow, WindowResolution},
    winit::WinitSettings,
    world_serialization::WorldInstanceReady,
};
use serde_json::json;

use assets::{load_assets, merge_car_meshes, strip_base_url, CityAssets};
use generate_city::{spawn_city, CityRoot};
use settings::{settings_ui, Settings};

mod assets;
mod export;
mod generate_city;
mod settings;

/// The upstream commit this arm is pinned to, stated in the fixture and the report.
const UPSTREAM_COMMIT: &str = "c6f634ca9f406d68ba5109d921247b654cb42c10";
const UPSTREAM_PATH: &str = "examples/large_scenes/bevy_city";
/// §7.2's deterministic throughput step. The fixture clock advances by exactly this every frame.
const FRAME_DELTA: f64 = 1.0 / 60.0;
/// `simulate_cars`'s own speed, unchanged.
const CAR_SPEED: f64 = 1.5;
/// The frames §6.1 names for the conformance inspection, in measured-frame numbering.
const STATE_FRAMES: [u32; 6] = [0, 1, 60, 120, 300, 599];
/// §6.3's common profile render attachment. The window manager may hand back less; the actual
/// attachment is what the counterpart arm must match and the deviation is recorded beside it.
const WINDOW_RESOLUTION: (f32, f32) = (1920.0, 1080.0);
/// How many consecutive `Last` ticks the census must be unchanged before the fixture is exported.
/// The city spawns in `Update` and its `WorldAssetRoot` scenes instantiate over the following
/// frames, so exporting on the first frame with a non-zero census would freeze a partial city.
const STABLE_TICKS: u32 = 8;
/// Untimed frames between the export and the warmup, so the export's multi-megabyte disk write and
/// the render graph's first response to the full scene stay outside the measured span.
const SETTLE_FRAMES: u32 = 8;
/// How many nodes the conformance probes cover: first, two interior points, and last.
const NODE_PROBES: usize = 5;
/// How many cars the conformance probes cover: this many from the first two roads.
const CAR_PROBES: usize = 4;

#[derive(FromArgs, Resource, Clone)]
/// Config
pub struct Args {
    /// seed
    #[argh(option, default = "42")]
    seed: u64,

    /// size
    #[argh(option, default = "8")]
    size: u32,

    /// adds NoCpuCulling to all meshes
    #[argh(switch)]
    no_cpu_culling: bool,

    /// whether the city runs with upstream's own "Simulate Cars" unchecked (`static`) or at its
    /// upstream default (`moving`). Neither is an invented freeze: both are states the pinned
    /// scene's own settings offer.
    #[argh(option, default = "Variant::Moving")]
    variant: Variant,

    /// which rendering profile to run: `common` is the PRD's shadows-off common profile, `upstream`
    /// keeps every effect the pinned scene's own sun() and camera() spawn.
    #[argh(option, default = "Profile::Common")]
    profile: Profile,

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

#[derive(Clone, Copy, PartialEq, Eq)]
enum Variant {
    Static,
    Moving,
}

impl std::str::FromStr for Variant {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "static" => Ok(Self::Static),
            "moving" => Ok(Self::Moving),
            other => Err(format!("unknown --variant '{other}', expected static or moving")),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Profile {
    Common,
    Upstream,
}

impl std::str::FromStr for Profile {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "common" => Ok(Self::Common),
            "upstream" => Ok(Self::Upstream),
            other => Err(format!("unknown --profile '{other}', expected common or upstream")),
        }
    }
}

impl Variant {
    fn as_str(self) -> &'static str {
        match self {
            Self::Static => "static",
            Self::Moving => "moving",
        }
    }

    /// Upstream's own `Settings::default()` has `simulate_cars: true`; `static` is the same settings
    /// with the scene's first checkbox unchecked, which is what the pinned `settings.rs` writes.
    fn simulate_cars(self) -> bool {
        matches!(self, Self::Moving)
    }
}

// ---------------------------------------------------------------------------------------------
// Cross-thread hand-off. The `wgpu::Device` in this process only exists on the render thread, so the
// completion waits are requested through these statics and served by `prd449_render_boundary`.
// ---------------------------------------------------------------------------------------------

static DRAIN_COUNT: AtomicU32 = AtomicU32::new(0);
static DRAIN_REQUESTED: AtomicBool = AtomicBool::new(false);
/// `now_ms()` at which the most recent completion wait returned, as `f64` bits.
static DRAIN_COMPLETED_MS: AtomicU64 = AtomicU64::new(0);
/// The most recent completion wait's own duration in ms, as `f64` bits.
static DRAIN_WAIT_MS: AtomicU64 = AtomicU64::new(0);
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
    eprintln!("ENGINE_LOAD_TEST_FAILED TN_BENCH_CITY_{code}");
    std::process::exit(1);
}

fn env_or_unrecorded(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| "unrecorded".to_string())
}

/// Which `simulate_cars` applications had run when the fixture was exported, and when the measured
/// window opened. The car oracle is composed from these two numbers rather than from one guess: the
/// arms are separated by untimed settle and warmup frames, and every one of those ran the system.
#[derive(Resource, Default, Clone, Copy)]
struct CarRuns {
    applications: u32,
}

/// The asset collections the export reads. A `SystemParam` rather than a long parameter list because
/// Bevy's system-parameter tuples top out at sixteen entries and the export needs nineteen.
#[derive(SystemParam)]
pub(crate) struct CityAssetStore<'w> {
    pub(crate) meshes: Res<'w, Assets<Mesh>>,
    pub(crate) materials: Res<'w, Assets<StandardMaterial>>,
    pub(crate) images: Res<'w, Assets<Image>>,
    pub(crate) server: Res<'w, AssetServer>,
}

/// The scene queries the export reads, bundled for the same reason.
#[derive(SystemParam)]
pub(crate) struct CityScene<'w, 's> {
    pub(crate) root: Query<'w, 's, Entity, With<CityRoot>>,
    pub(crate) children: Query<'w, 's, &'static Children>,
    pub(crate) mesh_handles: Query<'w, 's, &'static Mesh3d>,
    pub(crate) material_handles: Query<'w, 's, &'static MeshMaterial3d<StandardMaterial>>,
    pub(crate) transforms: Query<'w, 's, &'static Transform>,
    pub(crate) roads: Query<'w, 's, &'static Road>,
    pub(crate) cars: Query<'w, 's, &'static Car>,
    pub(crate) camera: Query<'w, 's, (&'static Transform, &'static Projection), With<Camera>>,
    pub(crate) light: Query<'w, 's, (&'static DirectionalLight, &'static Transform)>,
    pub(crate) windows: Query<'w, 's, &'static Window, With<PrimaryWindow>>,
}

/// The frame schedule, as in the many-cubes adapter.
#[derive(Resource, Default)]
struct Measure {
    frame: u32,
    scored: Option<u32>,
    boundaries: Vec<(u32, f64)>,
    /// The node and car entities the fixture named as probes, in fixture order.
    probes: Vec<(u32, Entity)>,
    car_probes: Vec<(u32, Entity)>,
    /// The sampled state at the §6.1 frames.
    states: Vec<serde_json::Value>,
    /// (measured frame, `simulate_cars` applications) at each sampled frame.
    runs_at_sample: Vec<(u32, u32)>,
    work: Option<serde_json::Value>,
    fixture: Option<serde_json::Value>,
    final_completion_ms: Option<f64>,
    final_drain_wait_ms: Option<f64>,
    car_runs_at_first_boundary: u32,
    done: bool,
}

#[derive(Resource, Default, Clone, Copy, PartialEq, Eq)]
struct Phase {
    current: PhaseKind,
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
enum PhaseKind {
    #[default]
    Loading,
    Exporting,
    Settling,
    Warmup,
    PreDrain,
    Scored,
    FinalDrain,
}

/// The city census the fixture freezes, and how long it has been unchanged.
#[derive(Resource, Default)]
struct Census {
    nodes: u32,
    mesh_nodes: u32,
    stable_ticks: u32,
}

/// The two adapter systems that must sit either side of `simulate_cars`. A named set rather than
/// `.after(simulate_cars)`, because this Bevy version resolves the bare function item ambiguously.
#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
enum CitySet {
    SimulateCars,
    CountCars,
}

fn main() {
    let args: Args = argh::from_env();
    if args.measured_frames == 0 {
        eprintln!("ENGINE_LOAD_TEST_FAILED TN_BENCH_CITY_NO_MEASURED_FRAMES");
        std::process::exit(2);
    }
    if args.size < 2 {
        eprintln!("ENGINE_LOAD_TEST_FAILED TN_BENCH_CITY_SIZE_TOO_SMALL");
        std::process::exit(2);
    }
    // The vendored Kenney pack is read through `BEVY_ASSET_ROOT`, so a run that cannot name the
    // checkout would silently fall back to the network and measure something else.
    if std::env::var("BEVY_ASSET_ROOT").is_err() {
        eprintln!("ENGINE_LOAD_TEST_FAILED TN_BENCH_CITY_ASSET_ROOT_UNSET");
        std::process::exit(2);
    }
    let simulate_cars_enabled = args.variant.simulate_cars();
    ORIGIN.get_or_init(Instant::now);

    let mut app = App::new();
    app.add_plugins((
        DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: "prd449_city".into(),
                // Patch 4, and the only window deviation: a decorating window manager shrinks the
                // request to fit its title bar. It changes no rendered pixel, and the exported
                // viewport is the actual attachment with its deviation from §6.3 recorded.
                decorations: false,
                resolution: WindowResolution::new(
                    WINDOW_RESOLUTION.0 as u32,
                    WINDOW_RESOLUTION.1 as u32,
                )
                .with_scale_factor_override(1.0),
                present_mode: PresentMode::AutoNoVsync,
                position: WindowPosition::Centered(MonitorSelection::Primary),
                ..default()
            }),
            ..default()
        }),
        FreeCameraPlugin,
        FeathersPlugins,
        WireframePlugin::default(),
    ))
    // Patch 4: upstream's own `Settings`, with the scene's first checkbox set from the variant.
    .insert_resource(Settings {
        simulate_cars: simulate_cars_enabled,
        ..Settings::default()
    })
    .insert_resource(args.clone())
    .insert_resource(ClearColor(Color::BLACK))
    .insert_resource(WinitSettings::continuous())
    .insert_resource(UiTheme(create_dark_theme()))
    .insert_resource(WireframeConfig {
        global: false,
        default_color: WHITE.into(),
        ..default()
    })
    // Upstream: "Like in many realistic large scenes, many of the objects don't move", so transform
    // propagation is optimized for that case. This is the pinned scene's own choice, kept.
    .insert_resource(StaticTransformOptimizations::Enabled)
    // Patch 2: the fixture clock.
    .insert_resource(TimeUpdateStrategy::ManualDuration(Duration::from_secs_f64(FRAME_DELTA)))
    .add_message::<CityAssetsLoaded>()
    .add_message::<CityAssetsReady>()
    .add_message::<CitySpawned>()
    .add_systems(Startup, (scene.spawn(), spawn_atmosphere, load_assets))
    .add_systems(
        Update,
        (
            simulate_cars.in_set(CitySet::SimulateCars),
            // Patch 6: the count runs immediately after `simulate_cars` in the same schedule, so it
            // is that system's own invocation count and not an inference.
            prd449_count_cars.in_set(CitySet::CountCars),
            update_loading_screen,
            process_assets.run_if(on_message::<CityAssetsLoaded>),
            on_city_assets_ready.run_if(on_message::<CityAssetsReady>),
            (add_no_cpu_culling, on_city_spawned, settings_ui.spawn())
                .run_if(on_message::<CitySpawned>),
            prd449_apply_profile,
        ),
    )
    .configure_sets(Update, (CitySet::SimulateCars, CitySet::CountCars).chain())
    .add_observer(add_no_cpu_culling_on_scene_ready)
    .add_systems(
        Last,
        (
            prd449_export.run_if(in_phase(PhaseKind::Exporting)),
            prd449_boundary,
            prd449_finish,
        )
            .chain(),
    )
    .init_resource::<Measure>()
    .init_resource::<CarRuns>()
    .init_resource::<Census>()
    .init_resource::<Phase>();

    // Patch 6: the render-thread half of the completion drain plus the adapter identity.
    if let Some(render_app) = app.get_sub_app_mut(RenderApp) {
        render_app.add_systems(Render, prd449_render_boundary);
    }

    app.run();
}

fn in_phase(kind: PhaseKind) -> impl Fn(Res<Phase>) -> bool {
    move |phase: Res<Phase>| phase.current == kind
}

// ---------------------------------------------------------------------------------------------
// Upstream `bevy_city/src/main.rs` from the pinned commit, with patches 4, 5 and 6 applied.
// ---------------------------------------------------------------------------------------------

#[derive(Message)]
struct CityAssetsLoaded;
#[derive(Message)]
struct CityAssetsReady;
#[derive(Message)]
struct CitySpawned;

fn scene() -> impl SceneList {
    bsn_list![camera(), sun(), loading_screen()]
}

fn camera() -> impl Scene {
    bsn! {
        Camera3d
        Hdr
        template_value(Transform::from_xyz(15.0, 10.0, 20.0).looking_at(Vec3::ZERO, Vec3::Y))
        FreeCamera
        AtmosphereSettings {
            // Reduce the default max distance in the aerial view LUT
            // to 16km to approximately fit the size of the city. This way the aerial perspective
            // gets more detail and has less banding artifacts compared to the 32km default.
            aerial_view_lut_max_distance: 1.6e4,
        }
        // The directional light illuminance used in this scene is
        // quite bright, so raising the exposure compensation helps
        // bring the scene to a nicer brightness range.
        Exposure::OVERCAST
        // Bloom gives the sun a much more natural look.
        Bloom::NATURAL
        // Enables the atmosphere to drive reflections and ambient lighting (IBL) for this view
        AtmosphereEnvironmentMapLight
        Msaa::Off
        TemporalAntiAliasing
        ContactShadows
    }
}

fn loading_screen() -> impl Scene {
    bsn! {
        LoadingScreen
        Node {
            position_type: PositionType::Absolute,
            width: percent(100),
            height: percent(100),
        }
        BackgroundColor(Color::BLACK)
        Children [
            Node {
                position_type: PositionType::Absolute,
                top: percent(50),
                left: percent(20),
                right: percent(20),
                height: vh(40),
                flex_direction: FlexDirection::Column,
                align_items: AlignItems::Start,
                overflow: Overflow::scroll_y(),
            }
            Children [
                (
                    LoadingText
                    Text("Loading...")
                    TextFont {
                        font_size: FontSize::Px(24.0),
                    }
                ),
                (
                    LoadingPaths
                    Text
                    TextFont {
                        font_size: FontSize::Px(14.0),
                    }
                ),
            ]
        ]
    }
}

fn sun() -> impl Scene {
    bsn! {
        DirectionalLight {
            shadow_maps_enabled: {Settings::default().shadow_maps_enabled},
            contact_shadows_enabled: {Settings::default().contact_shadows_enabled},
            illuminance: light_consts::lux::RAW_SUNLIGHT,
        }
        template_value(Transform::from_xyz(1.0, 0.15, 1.0).looking_at(Vec3::ZERO, Vec3::Y))
    }
}

#[derive(Component, Default, Clone)]
struct LoadingScreen;
#[derive(Component, Default, Clone)]
struct LoadingText;
#[derive(Component, Default, Clone)]
struct LoadingPaths;

/// Spawns the earth atmosphere plus an extra near-ground fog term.
fn spawn_atmosphere(
    args: Res<Args>,
    mut commands: Commands,
    mut scattering_mediums: ResMut<Assets<ScatteringMedium>>,
) {
    if args.profile == Profile::Common {
        return;
    }
    let mut earth_medium = ScatteringMedium::default();

    // Same 60 km atmosphere height as `ScatteringMedium::earth`
    const ATMOSPHERE_REF_HEIGHT_KM: f32 = 60.0;

    // The scale height of haze is set to 100 meters providing a low-lying dense fog layer.
    const HAZE_SCALE_HEIGHT_KM: f32 = 0.1;

    // Fog has high albedo and very low absorption resulting in a white color.
    const HAZE_SINGLE_SCATTER_ALBEDO: f32 = 0.99;

    // Distance at which contrast falls low enough to be indistinguishable from the sky.
    // known as Meteorological Optical Range
    const HAZE_VISIBILITY_KM: f32 = 12.0;

    // Koschmieder relation to calculate the extinction coefficient for the medium in m^-1 units.
    let beta_ext = (3.912 / HAZE_VISIBILITY_KM) * 1e-3;

    // Add the fog to the earth medium as an additional scattering term.
    earth_medium.terms.push(ScatteringTerm {
        absorption: Vec3::splat(beta_ext * (1.0 - HAZE_SINGLE_SCATTER_ALBEDO)),
        scattering: Vec3::splat(beta_ext * HAZE_SINGLE_SCATTER_ALBEDO),
        falloff: Falloff::Exponential {
            scale: HAZE_SCALE_HEIGHT_KM / ATMOSPHERE_REF_HEIGHT_KM,
        },
        // Fog is approximated as a mie scatterer with this asymmetry factor
        phase: PhaseFunction::Mie { asymmetry: 0.76 },
    });
    let earth_atmosphere = Atmosphere::earth(scattering_mediums.add(earth_medium));

    // This scale means that 1 city block in this scene will be roughly 100 meters relative to the atmosphere.
    let scale = 1.0 / 20.0;
    commands.spawn((
        earth_atmosphere.clone(),
        Transform::from_scale(Vec3::splat(scale))
            .with_translation(-Vec3::Y * earth_atmosphere.inner_radius * scale),
    ));
}

#[allow(clippy::type_complexity)]
fn update_loading_screen(
    mut commands: Commands,
    assets: Res<CityAssets>,
    asset_server: Res<AssetServer>,
    mut loading_text: Query<&mut Text, With<LoadingText>>,
    mut loading_paths: Query<(Entity, &mut Text), (With<LoadingPaths>, Without<LoadingText>)>,
) {
    let Ok(mut text) = loading_text.single_mut() else {
        return;
    };
    let Ok((paths_entity, mut paths_text)) = loading_paths.single_mut() else {
        return;
    };
    let mut paths = vec![];
    for untyped in &assets.untyped_assets {
        if let Some(path) = asset_server.get_path(untyped) {
            let state = asset_server.is_loaded_with_dependencies(untyped);
            if !state {
                paths.push(strip_base_url(path.to_string()));
            }
        }
    }
    if paths.is_empty() {
        commands.entity(paths_entity).despawn();
        text.0 = "Processing assets...".into();
        // Use a Message instead of an Event so asset processing only starts on the next frame
        commands.write_message(CityAssetsLoaded);
    } else {
        text.0 = format!(
            "Loading assets: {}/{}",
            assets.untyped_assets.len() - paths.len(),
            assets.untyped_assets.len(),
        );
        paths.reverse();
        paths_text.0 = paths.join("\n");
    }
}

/// Runs after the assets are loaded. For now, this will merge all the meshes for each car gltf into
/// a single mesh. This is necessary because the tires are separate meshes and this increases the
/// amount of meshes bevy has to process every frame for no benefits.
///
/// Eventually, this will also be used for things like generating LODs
fn process_assets(
    mut commands: Commands,
    mut city_assets: ResMut<CityAssets>,
    mut world_assets: ResMut<Assets<WorldAsset>>,
    mut meshes: ResMut<Assets<Mesh>>,
) {
    merge_car_meshes(&mut city_assets, &mut world_assets, &mut meshes);

    // Use a Message instead of an Event so spawning the city happens in the next frame
    commands.write_message(CityAssetsReady);
}

fn on_city_assets_ready(
    mut commands: Commands,
    city_assets: Res<CityAssets>,
    args: Res<Args>,
    mut loading_text: Query<&mut Text, With<LoadingText>>,
) {
    let Ok(mut text) = loading_text.single_mut() else {
        return;
    };
    text.0 = "Spawning city...".into();

    spawn_city(&mut commands, &city_assets, args.seed, args.size);
    commands.write_message(CitySpawned);
}

fn on_city_spawned(
    mut commands: Commands,
    loading_screen: Option<Single<Entity, With<LoadingScreen>>>,
) {
    let Some(loading_screen) = loading_screen else {
        return;
    };
    commands.entity(*loading_screen).despawn();
}

#[derive(Component)]
struct Road {
    start: Vec3,
    end: Vec3,
}

#[derive(Component)]
struct Car {
    offset: Vec3,
    distance_traveled: f32,
    dir: f32,
}

/// Do a very naive traffic simulation. This will only move the car to the end of the road then
/// spawn it back at the start.
///
/// Eventually this will be a more complex traffic simulation that should stress the ECS
fn simulate_cars(
    settings: Res<Settings>,
    roads: Query<(&Road, &Transform, &Children), Without<Car>>,
    mut cars: Query<(&mut Car, &mut Transform), Without<Road>>,
    time: Res<Time>,
) {
    if !settings.simulate_cars {
        return;
    }
    let speed = 1.5;

    for (road, _, children) in &roads {
        for child in children {
            let Ok((mut car, mut car_transform)) = cars.get_mut(*child) else {
                continue;
            };

            car.distance_traveled += speed * time.delta_secs();
            let road_len = (road.end - road.start).length();
            if car.distance_traveled > road_len {
                car.distance_traveled = 0.0;
            }
            let direction = (road.end - road.start).normalize() * car.dir;

            let progress = car.distance_traveled / road_len;
            car_transform.translation = (road.start + car.offset) + direction * road_len * progress;
        }
    }
}

/// Adds [`NoCpuCulling`] to all meshes in the scene after the city is done spawning
fn add_no_cpu_culling(
    mut commands: Commands,
    meshes: Query<Entity, (With<Mesh3d>, Without<NoCpuCulling>)>,
    args: Res<Args>,
) {
    if args.no_cpu_culling {
        for entity in meshes.iter() {
            commands.entity(entity).insert(NoCpuCulling);
        }
    }
}

/// Adds [`NoCpuCulling`] to all meshes in all scenes after the city is done spawning
///
/// This is required because a few assets are spawned using a [`WorldAssetRoot`] instead of directly
/// spawning a [`Mesh`]
fn add_no_cpu_culling_on_scene_ready(
    scene_ready: On<WorldInstanceReady>,
    mut commands: Commands,
    children: Query<&Children>,
    meshes: Query<(), (With<Mesh3d>, Without<NoCpuCulling>)>,
    args: Res<Args>,
) {
    if args.no_cpu_culling {
        for descendant in children.iter_descendants(scene_ready.entity) {
            if meshes.get(descendant).is_ok() {
                commands.entity(descendant).insert(NoCpuCulling);
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Patch 6: the PRD-449 adapter systems.
// ---------------------------------------------------------------------------------------------

/// Patch 5. Apply §6.3's common profile to the light and camera that upstream actually spawned.
fn prd449_apply_profile(
    args: Res<Args>,
    mut commands: Commands,
    mut done: Local<bool>,
    mut lights: Query<(Entity, &mut DirectionalLight)>,
    cameras: Query<Entity, With<Camera3d>>,
) {
    if *done || args.profile != Profile::Common {
        return;
    }
    if lights.iter().next().is_none() {
        return;
    }
    for (_, mut light) in &mut lights {
        light.shadow_maps_enabled = false;
        light.contact_shadows_enabled = false;
    }
    for entity in cameras.iter() {
        commands.entity(entity).remove::<(
            ContactShadows,
            AtmosphereSettings,
            AtmosphereEnvironmentMapLight,
            Hdr,
            Bloom,
            TemporalAntiAliasing,
        )>();
    }
    *done = true;
}

/// Counts `simulate_cars` applications. §5.1: the switch effects are validated, not trusted. This
/// count alone does not separate the variants — the system early-returns on a static arm and still
/// runs — so the sampled car positions carry that half of the evidence.
fn prd449_count_cars(mut runs: ResMut<CarRuns>) {
    runs.applications += 1;
}

/// The census gate and the frame schedule. One system in `Last`, so every boundary is taken after
/// that frame's own update work and before the next frame's.
fn prd449_boundary(
    args: Res<Args>,
    runs: Res<CarRuns>,
    root: Query<Entity, With<CityRoot>>,
    children: Query<&Children>,
    meshes: Query<&Mesh3d>,
    visibility: Query<&ViewVisibility, With<Mesh3d>>,
    cars: Res<CarRuns>,
    transforms: Query<&GlobalTransform>,
    camera: Query<&GlobalTransform, With<Camera>>,
    mut phase: ResMut<Phase>,
    mut census: ResMut<Census>,
    mut measure: ResMut<Measure>,
) {
    match phase.current {
        PhaseKind::Loading => {
            let Ok(root) = root.single() else {
                return;
            };
            let (nodes, mesh_nodes) = count_city(&root, &children, &meshes);
            if nodes == census.nodes && mesh_nodes == census.mesh_nodes {
                census.stable_ticks += 1;
            } else {
                census.nodes = nodes;
                census.mesh_nodes = mesh_nodes;
                census.stable_ticks = 1;
            }
            if census.stable_ticks >= STABLE_TICKS {
                eprintln!(
                    "prd449_city: census stable at {} nodes / {} mesh nodes; exporting",
                    census.nodes, census.mesh_nodes
                );
                phase.current = PhaseKind::Exporting;
            } else if census.stable_ticks % 300 == 0 {
                eprintln!(
                    "prd449_city: {} nodes / {} mesh nodes, {} ticks unchanged",
                    census.nodes, census.mesh_nodes, census.stable_ticks
                );
            }
        }
        PhaseKind::Exporting => {
            // The export system has already run this frame; the manifest is on disk, so the
            // untimed settle frames can start.
            eprintln!("prd449_city: settling");
            phase.current = PhaseKind::Settling;
            measure.frame = 0;
        }
        PhaseKind::Settling => {
            if measure.frame + 1 >= SETTLE_FRAMES {
                eprintln!("prd449_city: warming up");
                phase.current = PhaseKind::Warmup;
                measure.frame = 0;
            }
        }
        PhaseKind::Warmup => {
            if measure.frame + 1 >= args.warmup_frames {
                DRAIN_REQUESTED.store(true, Ordering::SeqCst);
                eprintln!("prd449_city: pre-drain");
                phase.current = PhaseKind::PreDrain;
                measure.frame = 0;
            }
        }
        PhaseKind::PreDrain => {
            if drains_completed() >= 1 {
                measure.scored = Some(0);
                measure.car_runs_at_first_boundary = runs.applications;
                // Frame 0 is a sampled frame like any other, so its state is read at the same
                // boundary that opens the window.
                sample_state(&mut measure, 0, &transforms, &camera, runs.applications);
                measure.boundaries.push((0, now_ms()));
                eprintln!("prd449_city: measured window open, {} car applications", runs.applications);
                phase.current = PhaseKind::Scored;
            }
        }
        PhaseKind::Scored => {
            let next = measure.scored.unwrap_or_default() + 1;
            let stamp = now_ms();
            if STATE_FRAMES.contains(&next) || next + 1 == args.measured_frames {
                sample_state(
                    &mut measure,
                    next,
                    &transforms,
                    &camera,
                    runs.applications,
                );
            }
            if next + 1 == args.measured_frames {
                // §7.4's work counters, sampled at the measurement boundary rather than at an
                // arbitrary frame, so a correct screenshot run cannot excuse an empty timed loop.
                let authored = meshes.iter().count();
                let visible = visibility.iter().filter(|entry| entry.get()).count();
                measure.work = Some(json!({
                    "admittedMeshNodes": visible,
                    "authoredMeshNodes": authored,
                    "authoredNodes": census.nodes,
                    "carNodes": measure.car_probes.len(),
                    "note": "bevy 0.19 exposes no submitted-draw or submitted-triangle counter to the main world, so those are null with a reason rather than zero",
                    "sampledAtMeasuredFrame": args.measured_frames,
                    "simulateCarsApplications": runs.applications,
                    "simulateCarsEnabled": args.variant.simulate_cars(),
                    "submittedDrawCalls": serde_json::Value::Null,
                    "submittedTriangles": serde_json::Value::Null,
                    "visibleMeshNodes": visible,
                }));
            }
            measure.boundaries.push((next, stamp));
            measure.scored = Some(next);
            if next >= args.measured_frames {
                DRAIN_REQUESTED.store(true, Ordering::SeqCst);
                eprintln!("prd449_city: final drain");
                phase.current = PhaseKind::FinalDrain;
            }
        }
        PhaseKind::FinalDrain => {
            if drains_completed() < 2 {
                return;
            }
            measure.final_completion_ms = Some(f64::from_bits(
                DRAIN_COMPLETED_MS.load(Ordering::SeqCst),
            ));
            measure.final_drain_wait_ms = Some(f64::from_bits(DRAIN_WAIT_MS.load(Ordering::SeqCst)));
            measure.done = true;
        }
    }
    let _ = cars;
    measure.frame += 1;
}

/// The shortest decimal that round-trips the same `f32`, so a manifest carries 3-8 characters per
/// component instead of a 19-character f64 widening, and `Number(text)` in the reader is still
/// exactly the value Bevy used.
fn num(value: f32) -> serde_json::Value {
    json!(format!("{value:?}"))
}

fn triple(value: Vec3) -> serde_json::Value {
    json!([num(value.x), num(value.y), num(value.z)])
}

fn quat(value: Quat) -> serde_json::Value {
    json!([num(value.x), num(value.y), num(value.z), num(value.w)])
}

/// Bevy's two UV sets as the channel numbers three's `uv`/`uv1` attributes use. A third set would be
/// a real difference rather than a remap, so the reader on the other side refuses anything above 1.
fn uv(value: &UvChannel) -> f32 {
    match value {
        UvChannel::Uv0 => 0.0,
        UvChannel::Uv1 => 1.0,
    }
}

fn count_city(
    root: &Entity,
    children: &Query<&Children>,
    meshes: &Query<&Mesh3d>,
) -> (u32, u32) {
    let mut nodes = 0u32;
    let mut mesh_nodes = 0u32;
    let mut queue = vec![*root];
    let mut index = 0usize;
    while index < queue.len() {
        let entity = queue[index];
        index += 1;
        nodes += 1;
        if meshes.get(entity).is_ok() {
            mesh_nodes += 1;
        }
        if let Ok(list) = children.get(entity) {
            queue.extend(list.iter());
        }
    }
    (nodes, mesh_nodes)
}

fn sample_state(
    measure: &mut Measure,
    frame: u32,
    transforms: &Query<&GlobalTransform>,
    camera: &Query<&GlobalTransform, With<Camera>>,
    car_applications: u32,
) {
    let nodes: Vec<serde_json::Value> = measure
        .probes
        .iter()
        .filter_map(|(index, entity)| {
            transforms
                .get(*entity)
                .ok()
                .map(|global| json!({ "index": index, "translation": triple(global.translation()) }))
        })
        .collect();
    if nodes.len() != measure.probes.len() {
        refuse("PROBE_UNOBSERVED");
    }
    let cars: Vec<serde_json::Value> = measure
        .car_probes
        .iter()
        .filter_map(|(index, entity)| {
            transforms
                .get(*entity)
                .ok()
                .map(|global| json!({ "index": index, "translation": triple(global.translation()) }))
        })
        .collect();
    if cars.len() != measure.car_probes.len() {
        refuse("CAR_PROBE_UNOBSERVED");
    }
    let Ok(camera) = camera.single() else {
        refuse("CAMERA_CENSUS");
    };
    let (_, camera_rotation, camera_translation) = camera.to_scale_rotation_translation();
    measure.states.push(json!({
        "camera": {
            "rotation": quat(camera_rotation),
            "translation": triple(camera_translation),
        },
        "cars": cars,
        "frameId": frame,
        "nodes": nodes,
        "simulateCarsApplications": car_applications,
    }));
    measure.runs_at_sample.push((frame, car_applications));
}

/// Patch 6: the fixture export, the only writer of the canonical file both arms then hash.
fn prd449_export(
    args: Res<Args>,
    runs: Res<CarRuns>,
    census: Res<Census>,
    settings: Res<Settings>,
    assets: CityAssetStore,
    scene: CityScene,
    mut measure: ResMut<Measure>,
) {
    let Ok(root) = scene.root.single() else {
        refuse("CITY_ROOT_ABSENT_AT_EXPORT");
    };
    let (fixture, probes, car_probes) = export::export(
        &args,
        *runs,
        &census,
        root,
        &scene.children,
        &assets.meshes,
        &assets.materials,
        &assets.images,
        &assets.server,
        &scene.mesh_handles,
        &scene.material_handles,
        &scene.transforms,
        &scene.roads,
        &scene.cars,
        &scene.camera,
        &scene.light,
        &settings,
        &scene.windows,
    );
    let path = std::path::Path::new(&args.fixture_out);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(error) = std::fs::write(path, format!("{fixture}\n")) {
        eprintln!("ENGINE_LOAD_TEST_FAILED TN_BENCH_CITY_FIXTURE_WRITE:{error}");
        std::process::exit(1);
    }
    measure.fixture = Some(fixture);
    measure.probes = probes;
    measure.car_probes = car_probes;
}

/// Patch 6: the run report, printed between the collector's markers.
fn prd449_finish(args: Res<Args>, measure: Res<Measure>, exits: MessageWriter<AppExit>) {
    export::finish(args, measure, exits);
}

/// Patch 6: the render-thread half of the completion drain, and the adapter identity.
fn prd449_render_boundary(device: Res<RenderDevice>, adapter: Res<RenderAdapterInfo>) {
    export::render_boundary(device, adapter);
}
