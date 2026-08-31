use rapier3d::prelude::*;
use std::time::Instant;

const BODY_COUNT: usize = 128;
const DT: f32 = 1.0 / 60.0;
const PROJECTILE_RADIUS: f32 = 0.05;
const WALL_HALF_THICKNESS: f32 = 0.05;
const WALL_X: f32 = 0.0;
const WALL_HALF_HEIGHT: f32 = 16.0;
const WALL_HALF_DEPTH: f32 = 32.0;
const BODY_GRID_WIDTH: usize = 16;
const MOVING_BODY_FARTHEST_START_X: f32 = -479.0;
const MOVING_BODY_NEAREST_START_X: f32 = -81.0;
const TUNNEL_SPEED_MAX: u32 = 300;
const MOVING_BODY_SPEED: f32 = 40.0;
const WARMUP_STEPS: usize = 120;
const MEASURED_STEPS: usize = 600;
const SAMPLES: usize = 5;

struct PhysicsScene {
    gravity: Vector<Real>,
    integration: IntegrationParameters,
    pipeline: PhysicsPipeline,
    islands: IslandManager,
    broad_phase: BroadPhaseBvh,
    narrow_phase: NarrowPhase,
    bodies: RigidBodySet,
    colliders: ColliderSet,
    impulse_joints: ImpulseJointSet,
    multibody_joints: MultibodyJointSet,
    ccd: CCDSolver,
}

impl PhysicsScene {
    fn new() -> Self {
        let mut integration = IntegrationParameters::default();
        integration.dt = DT;
        Self {
            gravity: vector![0.0, 0.0, 0.0],
            integration,
            pipeline: PhysicsPipeline::new(),
            islands: IslandManager::new(),
            broad_phase: BroadPhaseBvh::new(),
            narrow_phase: NarrowPhase::new(),
            bodies: RigidBodySet::new(),
            colliders: ColliderSet::new(),
            impulse_joints: ImpulseJointSet::new(),
            multibody_joints: MultibodyJointSet::new(),
            ccd: CCDSolver::new(),
        }
    }

    fn step(&mut self) {
        self.pipeline.step(
            &self.gravity,
            &self.integration,
            &mut self.islands,
            &mut self.broad_phase,
            &mut self.narrow_phase,
            &mut self.bodies,
            &mut self.colliders,
            &mut self.impulse_joints,
            &mut self.multibody_joints,
            &mut self.ccd,
            &(),
            &(),
        );
    }
}

fn moving_body_start_x(index: usize) -> f32 {
    MOVING_BODY_FARTHEST_START_X
        + (MOVING_BODY_NEAREST_START_X - MOVING_BODY_FARTHEST_START_X) * index as f32
            / (BODY_COUNT - 1) as f32
}

fn assert_timed_collision_geometry() {
    let step_distance = MOVING_BODY_SPEED * DT;
    let measured_start_x =
        moving_body_start_x(BODY_COUNT - 1) + step_distance * WARMUP_STEPS as f32;
    let measured_end_x =
        moving_body_start_x(0) + step_distance * (WARMUP_STEPS + MEASURED_STEPS) as f32;
    let collision_entry_x = WALL_X - WALL_HALF_THICKNESS - PROJECTILE_RADIUS;
    let collision_exit_x = WALL_X + WALL_HALF_THICKNESS + PROJECTILE_RADIUS;
    let max_y = ((BODY_COUNT - 1) / BODY_GRID_WIDTH) as f32 * 2.0;
    let max_z = ((BODY_COUNT - 1) % BODY_GRID_WIDTH) as f32 * 2.0;

    assert!(
        measured_start_x < collision_entry_x
            && measured_end_x > collision_exit_x
            && max_y + PROJECTILE_RADIUS < WALL_HALF_HEIGHT
            && max_z + PROJECTILE_RADIUS < WALL_HALF_DEPTH,
        "TN_PRD292_BENCHMARK_GEOMETRY_UNMEASURED: timed path {measured_start_x}..{measured_end_x} does not cross wall collision range {collision_entry_x}..{collision_exit_x}"
    );
}

fn add_wall(scene: &mut PhysicsScene, x: f32) {
    let body = scene
        .bodies
        .insert(RigidBodyBuilder::fixed().translation(vector![x, 0.0, 0.0]));
    scene.colliders.insert_with_parent(
        ColliderBuilder::cuboid(WALL_HALF_THICKNESS, WALL_HALF_HEIGHT, WALL_HALF_DEPTH),
        body,
        &mut scene.bodies,
    );
}

fn first_tunnel_speed(continuous: bool) -> Option<u32> {
    for speed in 1..=TUNNEL_SPEED_MAX {
        let mut scene = PhysicsScene::new();
        add_wall(&mut scene, WALL_X);
        let mut builder = RigidBodyBuilder::dynamic().translation(vector![-1.0, 0.0, 0.0]);
        if continuous {
            builder = builder.ccd_enabled(true);
        }
        let body = scene.bodies.insert(builder);
        scene.colliders.insert_with_parent(
            ColliderBuilder::ball(PROJECTILE_RADIUS),
            body,
            &mut scene.bodies,
        );
        scene.bodies[body].set_linvel(vector![speed as f32, 0.0, 0.0], true);
        scene.step();
        let x = scene.bodies[body].translation().x;
        if x > WALL_HALF_THICKNESS + PROJECTILE_RADIUS {
            return Some(speed);
        }
    }
    None
}

fn moving_scene(continuous: bool, with_wall: bool) -> PhysicsScene {
    let mut scene = PhysicsScene::new();
    if with_wall {
        add_wall(&mut scene, WALL_X);
    }
    for index in 0..BODY_COUNT {
        let y = (index / BODY_GRID_WIDTH) as f32 * 2.0;
        let z = (index % BODY_GRID_WIDTH) as f32 * 2.0;
        let mut builder =
            RigidBodyBuilder::dynamic().translation(vector![moving_body_start_x(index), y, z]);
        if continuous {
            builder = builder.ccd_enabled(true);
        }
        let body = scene.bodies.insert(builder);
        scene.colliders.insert_with_parent(
            ColliderBuilder::ball(PROJECTILE_RADIUS),
            body,
            &mut scene.bodies,
        );
        scene.bodies[body].set_linvel(vector![MOVING_BODY_SPEED, 0.0, 0.0], true);
    }
    scene
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    values[values.len() / 2]
}

fn median_step_ms(continuous: bool, with_wall: bool) -> f64 {
    let mut samples = Vec::with_capacity(SAMPLES);
    for _ in 0..SAMPLES {
        let mut scene = moving_scene(continuous, with_wall);
        for _ in 0..WARMUP_STEPS {
            scene.step();
        }
        let started = Instant::now();
        for _ in 0..MEASURED_STEPS {
            scene.step();
        }
        samples.push(started.elapsed().as_secs_f64() * 1_000.0 / MEASURED_STEPS as f64);
    }
    median(&mut samples)
}

fn main() {
    assert_timed_collision_geometry();
    let no_wall_baseline_ms = median_step_ms(false, false);
    let no_wall_continuous_ms = median_step_ms(true, false);
    let baseline_ms = median_step_ms(false, true);
    let continuous_ms = median_step_ms(true, true);
    println!(
        "{{\"backend\":\"native\",\"runner\":\"cargo run --release --example measure_continuous_collision\",\"bodyCount\":{BODY_COUNT},\"dt\":{DT},\"geometry\":{{\"bodyCount\":{BODY_COUNT},\"bodyStartFarthestX\":{MOVING_BODY_FARTHEST_START_X},\"bodyStartNearestX\":{MOVING_BODY_NEAREST_START_X},\"bodySpeed\":{MOVING_BODY_SPEED},\"dt\":{DT},\"measuredSteps\":{MEASURED_STEPS},\"projectileRadius\":{PROJECTILE_RADIUS},\"wallHalfDepth\":{WALL_HALF_DEPTH},\"wallHalfHeight\":{WALL_HALF_HEIGHT},\"wallThickness\":{},\"wallX\":{WALL_X},\"warmupSteps\":{WARMUP_STEPS}}},\"baselineFirstTunnelSpeed\":{},\"continuousFirstTunnelSpeed\":{},\"noWallBaselineStepMs\":{no_wall_baseline_ms:.6},\"noWallContinuousStepMs\":{no_wall_continuous_ms:.6},\"noWallDeltaStepMs\":{:.6},\"baselineStepMs\":{baseline_ms:.6},\"continuousStepMs\":{continuous_ms:.6},\"deltaStepMs\":{:.6}}}",
        WALL_HALF_THICKNESS * 2.0,
        first_tunnel_speed(false).map_or_else(|| "null".to_string(), |speed| speed.to_string()),
        first_tunnel_speed(true).map_or_else(|| "null".to_string(), |speed| speed.to_string()),
        no_wall_continuous_ms - no_wall_baseline_ms,
        continuous_ms - baseline_ms,
    );
}
