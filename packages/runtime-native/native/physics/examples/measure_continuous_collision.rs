use rapier3d::prelude::*;
use std::time::Instant;

const BODY_COUNT: usize = 128;
const DT: f32 = 1.0 / 60.0;
const PROJECTILE_RADIUS: f32 = 0.05;
const WALL_HALF_THICKNESS: f32 = 0.05;
const START_X: f32 = -1.0;
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

fn add_wall(scene: &mut PhysicsScene, x: f32) {
    let body = scene
        .bodies
        .insert(RigidBodyBuilder::fixed().translation(vector![x, 0.0, 0.0]));
    scene.colliders.insert_with_parent(
        ColliderBuilder::cuboid(WALL_HALF_THICKNESS, 10.0, 10.0),
        body,
        &mut scene.bodies,
    );
}

fn first_tunnel_speed(continuous: bool) -> Option<u32> {
    for speed in 1..=TUNNEL_SPEED_MAX {
        let mut scene = PhysicsScene::new();
        add_wall(&mut scene, 0.0);
        let mut builder = RigidBodyBuilder::dynamic().translation(vector![START_X, 0.0, 0.0]);
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

fn moving_scene(continuous: bool) -> PhysicsScene {
    let mut scene = PhysicsScene::new();
    add_wall(&mut scene, 10_000.0);
    for index in 0..BODY_COUNT {
        let y = (index / 16) as f32 * 2.0;
        let z = (index % 16) as f32 * 2.0;
        let mut builder = RigidBodyBuilder::dynamic().translation(vector![-1_000.0, y, z]);
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

fn median_step_ms(continuous: bool) -> f64 {
    let mut samples = Vec::with_capacity(SAMPLES);
    for _ in 0..SAMPLES {
        let mut scene = moving_scene(continuous);
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
    let baseline_ms = median_step_ms(false);
    let continuous_ms = median_step_ms(true);
    println!(
        "{{\"backend\":\"native\",\"rapierVersion\":\"0.30.0\",\"bodyCount\":{BODY_COUNT},\"dt\":{DT},\"baselineFirstTunnelSpeed\":{},\"continuousFirstTunnelSpeed\":{},\"baselineStepMs\":{baseline_ms:.6},\"continuousStepMs\":{continuous_ms:.6},\"deltaStepMs\":{:.6}}}",
        first_tunnel_speed(false).map_or_else(|| "null".to_string(), |speed| speed.to_string()),
        first_tunnel_speed(true).map_or_else(|| "null".to_string(), |speed| speed.to_string()),
        continuous_ms - baseline_ms,
    );
}
