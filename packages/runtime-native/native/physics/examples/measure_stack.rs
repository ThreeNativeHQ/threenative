use rapier3d::prelude::*;

fn main() {
    let gravity = vector![0.0, -9.81, 0.0];
    let integration = IntegrationParameters::default();
    let mut pipeline = PhysicsPipeline::new();
    let mut islands = IslandManager::new();
    let mut broad_phase = BroadPhaseBvh::new();
    let mut narrow_phase = NarrowPhase::new();
    let mut bodies = RigidBodySet::new();
    let mut colliders = ColliderSet::new();
    let mut impulse_joints = ImpulseJointSet::new();
    let mut multibody_joints = MultibodyJointSet::new();
    let mut ccd = CCDSolver::new();

    let x = 0.01;
    let floor = bodies.insert(RigidBodyBuilder::fixed().translation(vector![x, -0.6, 0.0]));
    colliders.insert_with_parent(ColliderBuilder::cuboid(4.0, 0.1, 4.0), floor, &mut bodies);
    let boxes: Vec<_> = (0..5)
        .map(|index| {
            let body = bodies.insert(RigidBodyBuilder::dynamic().translation(vector![
                x,
                index as f32,
                0.0
            ]));
            colliders.insert_with_parent(ColliderBuilder::cuboid(0.5, 0.5, 0.5), body, &mut bodies);
            body
        })
        .collect();

    for _ in 0..300 {
        pipeline.step(
            &gravity,
            &integration,
            &mut islands,
            &mut broad_phase,
            &mut narrow_phase,
            &mut bodies,
            &mut colliders,
            &mut impulse_joints,
            &mut multibody_joints,
            &mut ccd,
            &(),
            &(),
        );
    }

    let snapshot = bincode::serialize(&(
        &gravity,
        &integration,
        &islands,
        &broad_phase,
        &narrow_phase,
        &bodies,
        &colliders,
        &impulse_joints,
        &multibody_joints,
    ))
    .expect("Rapier snapshot serialization must succeed");
    let position_bits = boxes
        .iter()
        .map(|handle| {
            let position = bodies[*handle].translation();
            format!(
                "[{},{},{}]",
                position.x.to_bits(),
                position.y.to_bits(),
                position.z.to_bits()
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let snapshot_hex = snapshot
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();

    println!(
        "{{\"version\":\"0.30.0\",\"snapshotHex\":\"{snapshot_hex}\",\"positionBits\":[{position_bits}]}}"
    );
}
