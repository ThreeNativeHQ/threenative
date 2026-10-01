use threenative_native_physics::{
    Simulation, TnPhysicsBodyOptions, TnPhysicsWorldOptions, tn_physics_add_body,
    tn_physics_add_trimesh_body, tn_physics_create, tn_physics_destroy,
    tn_physics_read_body_sleep_states, tn_physics_read_contacts,
    tn_physics_read_visible_transforms, tn_physics_set_trimesh_shape, tn_physics_step,
};

const CONTACT_WIDTH: usize = 8;
const TRANSFORM_WIDTH: usize = 8;
const HEIGHTFIELD_SURFACE: u32 = 4;
const STEP: f32 = 1.0 / 60.0;
const SURFACE: u32 = 0;
const BALL: u32 = 1;

fn options(id: u32, body_type: u32, shape_type: u32, y: f32, radius: f32) -> TnPhysicsBodyOptions {
    TnPhysicsBodyOptions {
        id,
        body_type,
        shape_type,
        position_x: 0.0,
        position_y: y,
        position_z: 0.0,
        rotation_x: 0.0,
        rotation_y: 0.0,
        rotation_z: 0.0,
        rotation_w: 1.0,
        shape_x: radius,
        shape_y: 0.0,
        shape_z: 0.0,
        mass: if body_type == 0 { 10.0 } else { 0.0 },
        collision_layer: 1,
        collision_mask: u16::MAX.into(),
        sensor: false,
        continuous_collision: true,
    }
}

/// A flat heightfield surface at `height`, triangulated the way the TypeScript adapter does.
fn surface(height: f32) -> (Vec<f32>, Vec<u32>) {
    let (rows, columns, size) = (33u32, 33u32, 6.0f32);
    let mut vertices = Vec::new();
    for row in 0..rows {
        for column in 0..columns {
            vertices.extend_from_slice(&[
                -size / 2.0 + column as f32 * size / (columns - 1) as f32,
                height,
                -size / 2.0 + row as f32 * size / (rows - 1) as f32,
            ]);
        }
    }
    let mut indices = Vec::new();
    for row in 0..rows - 1 {
        for column in 0..columns - 1 {
            let upper_left = row * columns + column;
            let lower_left = upper_left + columns;
            indices.extend_from_slice(&[
                upper_left,
                lower_left,
                upper_left + 1,
                upper_left + 1,
                lower_left,
                lower_left + 1,
            ]);
        }
    }
    (vertices, indices)
}

fn ball_height(simulation: *mut Simulation) -> f32 {
    let mut transforms = [0.0f32; TRANSFORM_WIDTH * 4];
    let count =
        tn_physics_read_visible_transforms(simulation, transforms.as_mut_ptr(), transforms.len());
    (0..count as usize)
        .find(|index| transforms[index * TRANSFORM_WIDTH] as u32 == BALL)
        .map(|index| transforms[index * TRANSFORM_WIDTH + 2])
        .expect("the ball reports a transform")
}

fn ball_sleeping(simulation: *mut Simulation) -> bool {
    let mut states = [0.0f32; 8];
    let count = tn_physics_read_body_sleep_states(simulation, states.as_mut_ptr(), states.len());
    (0..count as usize)
        .any(|index| states[index * 2] as u32 == BALL && states[index * 2 + 1] == 1.0)
}

fn read(simulation: *mut Simulation, output: &mut [f32]) -> i32 {
    let candidates = [BALL];
    tn_physics_read_contacts(
        simulation,
        SURFACE,
        candidates.as_ptr(),
        candidates.len(),
        output.as_mut_ptr(),
        output.len(),
    )
}

fn step(simulation: *mut Simulation, steps: usize) {
    for _ in 0..steps {
        assert!(tn_physics_step(simulation, STEP, std::ptr::null(), 0));
    }
}

#[test]
fn reads_solved_support_and_refreshes_the_surface_in_place() {
    let simulation = tn_physics_create(&TnPhysicsWorldOptions {
        gravity_x: 0.0,
        gravity_y: -9.81,
        gravity_z: 0.0,
    });
    let (vertices, indices) = surface(0.28);
    assert!(tn_physics_add_trimesh_body(
        simulation,
        &options(SURFACE, 1, HEIGHTFIELD_SURFACE, 0.0, 0.0),
        vertices.as_ptr(),
        vertices.len() as u32,
        indices.as_ptr(),
        indices.len() as u32,
    ));
    assert!(tn_physics_add_body(
        simulation,
        &options(BALL, 0, 1, 1.0, 0.25)
    ));

    // Airborne: no solved contact exists yet.
    step(simulation, 10);
    let mut output = [0.0f32; CONTACT_WIDTH * 16];
    assert_eq!(read(simulation, &mut output), 0);

    step(simulation, 60);
    let found = read(simulation, &mut output);
    assert!(found > 0, "a resting ball has solved support");
    let mut impulse = 0.0;
    for record in output.chunks_exact(CONTACT_WIDTH).take(found as usize) {
        assert_eq!(record[0] as u32, BALL);
        assert!(
            record[5] > 0.9,
            "the surface pushes up on the ball: {record:?}"
        );
        assert!(
            (record[2] - 0.28).abs() < 0.02,
            "contact lies on the surface: {record:?}"
        );
        impulse += record[7];
    }
    // The summed impulse over a step carries roughly the ball's weight.
    let load = impulse / STEP;
    assert!(load > 98.1 * 0.5 && load < 98.1 * 2.0, "load {load}");
    assert!((ball_height(simulation) - 0.53).abs() < 0.01);

    // A buffer too small is told the count instead of losing contacts silently.
    assert_eq!(read(simulation, &mut []), found);
    // An unknown target fails closed.
    let candidates = [BALL];
    assert_eq!(
        tn_physics_read_contacts(
            simulation,
            99,
            candidates.as_ptr(),
            1,
            output.as_mut_ptr(),
            output.len()
        ),
        -1
    );

    // At rest the ball sleeps and reports nothing: its stored impulses are not this step's.
    let mut slept = false;
    for _ in 0..600 {
        step(simulation, 1);
        if ball_sleeping(simulation) {
            slept = true;
            break;
        }
    }
    assert!(slept, "a ball resting on flat surface falls asleep");
    assert_eq!(read(simulation, &mut output), 0);

    // Lower the surface in place: same body, and the sleeping ball wakes and follows it down.
    let (lowered, indices) = surface(0.1);
    assert!(tn_physics_set_trimesh_shape(
        simulation,
        SURFACE,
        HEIGHTFIELD_SURFACE,
        lowered.as_ptr(),
        lowered.len() as u32,
        indices.as_ptr(),
        indices.len() as u32,
    ));
    step(simulation, 120);
    assert!(
        (ball_height(simulation) - 0.35).abs() < 0.01,
        "ball {}",
        ball_height(simulation)
    );
    assert!(read(simulation, &mut output) > 0 || ball_sleeping(simulation));

    // Malformed refreshes are refused rather than half-applied.
    assert!(!tn_physics_set_trimesh_shape(
        simulation,
        SURFACE,
        1,
        lowered.as_ptr(),
        lowered.len() as u32,
        indices.as_ptr(),
        indices.len() as u32,
    ));
    assert!(!tn_physics_set_trimesh_shape(
        simulation,
        42,
        HEIGHTFIELD_SURFACE,
        lowered.as_ptr(),
        lowered.len() as u32,
        indices.as_ptr(),
        indices.len() as u32,
    ));
    tn_physics_destroy(simulation);
}
