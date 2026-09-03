use std::collections::BTreeMap;

use threenative_native_physics::{
    TnPhysicsBodyOptions, TnPhysicsJointOptions, TnPhysicsWorldOptions, tn_physics_add_body,
    tn_physics_create, tn_physics_create_joint, tn_physics_destroy,
    tn_physics_read_visible_transforms, tn_physics_step,
};

const TRANSFORM_WIDTH: usize = 8;

fn body(id: u32, body_type: u32, x: f32, mass: f32) -> TnPhysicsBodyOptions {
    TnPhysicsBodyOptions {
        id,
        body_type,
        shape_type: 1,
        position_x: x,
        position_y: 0.0,
        position_z: 0.0,
        rotation_x: 0.0,
        rotation_y: 0.0,
        rotation_z: 0.0,
        rotation_w: 1.0,
        shape_x: 0.2,
        shape_y: 0.0,
        shape_z: 0.0,
        mass,
        collision_layer: 1,
        collision_mask: u16::MAX.into(),
        sensor: false,
        continuous_collision: true,
    }
}

fn joint_options(id: u32, joint_type: u32) -> TnPhysicsJointOptions {
    TnPhysicsJointOptions {
        id,
        joint_type,
        body_a: 0,
        body_b: 1,
        anchor_a_x: 0.0,
        anchor_a_y: 0.0,
        anchor_a_z: 0.0,
        anchor_b_x: 0.0,
        anchor_b_y: 0.0,
        anchor_b_z: 0.0,
        axis_x: 1.0,
        axis_y: 0.0,
        axis_z: 0.0,
        limit_enabled: false,
        limit_lower: 0.0,
        limit_upper: 0.0,
        frame_a_x: 0.0,
        frame_a_y: 0.0,
        frame_a_z: 0.0,
        frame_a_w: 1.0,
        frame_b_x: 0.0,
        frame_b_y: 0.0,
        frame_b_z: 0.0,
        frame_b_w: 1.0,
    }
}

fn next_f32(value: f32) -> f32 {
    f32::from_bits(value.to_bits() + 1)
}

fn positions(
    simulation: *const threenative_native_physics::Simulation,
    body_count: usize,
) -> BTreeMap<u32, [f32; 3]> {
    let mut output = vec![0.0; body_count * TRANSFORM_WIDTH];
    let count = tn_physics_read_visible_transforms(simulation, output.as_mut_ptr(), output.len());
    assert_eq!(count, body_count as i32);
    (0..count as usize)
        .map(|index| {
            let offset = index * TRANSFORM_WIDTH;
            (
                output[offset] as u32,
                [output[offset + 1], output[offset + 2], output[offset + 3]],
            )
        })
        .collect()
}

#[test]
fn fixed_joint_preserves_nonzero_anchor_translation() {
    let simulation = tn_physics_create(&TnPhysicsWorldOptions {
        gravity_x: 0.0,
        gravity_y: 0.0,
        gravity_z: 0.0,
    });
    assert!(!simulation.is_null());
    assert!(tn_physics_add_body(simulation, &body(0, 1, 0.0, 0.0)));
    assert!(tn_physics_add_body(simulation, &body(1, 0, 2.0, 1.0)));

    assert_eq!(
        tn_physics_create_joint(
            simulation,
            &TnPhysicsJointOptions {
                id: 0,
                joint_type: 2,
                body_a: 0,
                body_b: 1,
                anchor_a_x: 0.0,
                anchor_a_y: 0.0,
                anchor_a_z: 0.0,
                anchor_b_x: -2.0,
                anchor_b_y: 0.0,
                anchor_b_z: 0.0,
                axis_x: 1.0,
                axis_y: 0.0,
                axis_z: 0.0,
                limit_enabled: false,
                limit_lower: 0.0,
                limit_upper: 0.0,
                frame_a_x: 0.0,
                frame_a_y: 0.0,
                frame_a_z: 0.0,
                frame_a_w: 1.0,
                frame_b_x: 0.0,
                frame_b_y: 0.0,
                frame_b_z: 0.0,
                frame_b_w: 1.0,
            },
        ),
        0
    );

    for _ in 0..5 {
        assert!(tn_physics_step(simulation, 1.0 / 60.0, std::ptr::null(), 0));
    }

    let child = positions(simulation, 2)[&1];
    assert!(
        (child[0] - 2.0).abs() < 1.0e-3,
        "child x moved to {}",
        child[0]
    );
    assert!(child[1].abs() < 1.0e-3, "child y moved to {}", child[1]);
    assert!(child[2].abs() < 1.0e-3, "child z moved to {}", child[2]);

    tn_physics_destroy(simulation);
}

#[test]
fn rejects_near_zero_fixed_frames_and_hinge_axes() {
    let simulation = tn_physics_create(&TnPhysicsWorldOptions {
        gravity_x: 0.0,
        gravity_y: 0.0,
        gravity_z: 0.0,
    });
    assert!(!simulation.is_null());
    assert!(tn_physics_add_body(simulation, &body(0, 1, 0.0, 0.0)));
    assert!(tn_physics_add_body(simulation, &body(1, 0, 1.0, 1.0)));

    let mut hinge = joint_options(0, 1);
    hinge.axis_x = 1.0e-7;
    assert_eq!(tn_physics_create_joint(simulation, &hinge), -1);

    let mut fixed = joint_options(1, 2);
    fixed.frame_a_x = 1.0e-4;
    fixed.frame_a_w = 0.0;
    assert_eq!(tn_physics_create_joint(simulation, &fixed), -1);

    tn_physics_destroy(simulation);
}

#[test]
fn brackets_f32_joint_epsilon_boundaries() {
    let simulation = tn_physics_create(&TnPhysicsWorldOptions {
        gravity_x: 0.0,
        gravity_y: 0.0,
        gravity_z: 0.0,
    });
    assert!(!simulation.is_null());
    assert!(tn_physics_add_body(simulation, &body(0, 1, 0.0, 0.0)));
    assert!(tn_physics_add_body(simulation, &body(1, 0, 1.0, 1.0)));

    let mut fixed = joint_options(0, 2);
    fixed.frame_a_x = f32::EPSILON.sqrt();
    fixed.frame_a_w = 0.0;
    assert_eq!(tn_physics_create_joint(simulation, &fixed), -1);
    fixed.id = 1;
    fixed.frame_a_x = next_f32(fixed.frame_a_x);
    assert_eq!(tn_physics_create_joint(simulation, &fixed), 1);

    let mut hinge = joint_options(2, 1);
    hinge.axis_x = f32::EPSILON;
    assert_eq!(tn_physics_create_joint(simulation, &hinge), -1);
    hinge.id = 3;
    hinge.axis_x = next_f32(hinge.axis_x);
    assert_eq!(tn_physics_create_joint(simulation, &hinge), 3);

    tn_physics_destroy(simulation);
}
