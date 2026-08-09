use rapier3d::prelude::*;
use std::collections::VecDeque;
use std::ptr;

const FLOOR_ID: u32 = 0;
const CUBE_ID: u32 = 1;
const TRANSFORM_WIDTH: usize = 8;
const VISIBLE_BODY_COUNT: usize = 2;
const EVENT_WIDTH: usize = 4;

#[repr(C)]
pub struct TnPhysicsProofOptions {
    pub gravity_x: f32,
    pub gravity_y: f32,
    pub gravity_z: f32,
    pub floor_collision_layer: u32,
    pub floor_collision_mask: u32,
    pub cube_collision_layer: u32,
    pub cube_collision_mask: u32,
}

pub struct ProofSimulation {
    gravity: Vector<Real>,
    pipeline: PhysicsPipeline,
    integration: IntegrationParameters,
    islands: IslandManager,
    broad_phase: BroadPhaseBvh,
    narrow_phase: NarrowPhase,
    bodies: RigidBodySet,
    colliders: ColliderSet,
    impulse_joints: ImpulseJointSet,
    multibody_joints: MultibodyJointSet,
    ccd: CCDSolver,
    floor_body: RigidBodyHandle,
    cube_body: RigidBodyHandle,
    floor_collider: ColliderHandle,
    cube_collider: ColliderHandle,
    colliding: bool,
    events: VecDeque<[u32; EVENT_WIDTH]>,
}

impl ProofSimulation {
    fn new(options: TnPhysicsProofOptions) -> Option<Self> {
        let floor_layer = Group::from_bits(options.floor_collision_layer)?;
        let floor_mask = Group::from_bits(options.floor_collision_mask)?;
        let cube_layer = Group::from_bits(options.cube_collision_layer)?;
        let cube_mask = Group::from_bits(options.cube_collision_mask)?;
        let mut bodies = RigidBodySet::new();
        let mut colliders = ColliderSet::new();

        let floor_body = bodies.insert(RigidBodyBuilder::fixed().translation(vector![0.0, -0.5, 0.0]));
        let floor_collider = colliders.insert_with_parent(
            ColliderBuilder::cuboid(50.0, 0.5, 50.0)
                .collision_groups(InteractionGroups::new(floor_layer, floor_mask)),
            floor_body,
            &mut bodies,
        );
        let cube_body = bodies.insert(RigidBodyBuilder::dynamic().translation(vector![0.0, 3.0, 0.0]));
        let cube_collider = colliders.insert_with_parent(
            ColliderBuilder::cuboid(0.5, 0.5, 0.5)
                .collision_groups(InteractionGroups::new(cube_layer, cube_mask)),
            cube_body,
            &mut bodies,
        );

        Some(Self {
            gravity: vector![options.gravity_x, options.gravity_y, options.gravity_z],
            pipeline: PhysicsPipeline::new(),
            integration: IntegrationParameters::default(),
            islands: IslandManager::new(),
            broad_phase: BroadPhaseBvh::new(),
            narrow_phase: NarrowPhase::new(),
            bodies,
            colliders,
            impulse_joints: ImpulseJointSet::new(),
            multibody_joints: MultibodyJointSet::new(),
            ccd: CCDSolver::new(),
            floor_body,
            cube_body,
            floor_collider,
            cube_collider,
            colliding: false,
            events: VecDeque::new(),
        })
    }

    fn step(&mut self, delta_time: f32) -> bool {
        if !delta_time.is_finite() || delta_time <= 0.0 {
            return false;
        }
        self.integration.dt = delta_time;
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

        let colliding = self
            .narrow_phase
            .contact_pair(self.floor_collider, self.cube_collider)
            .is_some_and(|pair| pair.has_any_active_contact);
        if colliding != self.colliding {
            self.events
                .push_back([FLOOR_ID, CUBE_ID, u32::from(colliding), 1]);
            self.colliding = colliding;
        }
        true
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_version() -> *const std::ffi::c_char {
    c"0.30.0".as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_proof_create(
    options: *const TnPhysicsProofOptions,
) -> *mut ProofSimulation {
    if options.is_null() {
        return ptr::null_mut();
    }
    // SAFETY: The caller supplies a non-null pointer to the C-compatible options struct.
    let options = unsafe { ptr::read(options) };
    ProofSimulation::new(options)
        .map(Box::new)
        .map_or(ptr::null_mut(), Box::into_raw)
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_proof_step(
    simulation: *mut ProofSimulation,
    delta_time: f32,
) -> bool {
    // SAFETY: A live simulation pointer is created and exclusively owned by the C++ wrapper.
    unsafe { simulation.as_mut() }.is_some_and(|simulation| simulation.step(delta_time))
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_proof_read_visible_transforms(
    simulation: *const ProofSimulation,
    output: *mut f32,
    output_float_capacity: usize,
) -> i32 {
    if simulation.is_null()
        || output.is_null()
        || output_float_capacity < TRANSFORM_WIDTH * VISIBLE_BODY_COUNT
    {
        return -1;
    }
    // SAFETY: Both pointers were checked and the caller guarantees capacity for eight floats.
    let simulation = unsafe { &*simulation };
    for (index, (id, handle)) in [
        (FLOOR_ID, simulation.floor_body),
        (CUBE_ID, simulation.cube_body),
    ]
    .into_iter()
    .enumerate()
    {
        let body = &simulation.bodies[handle];
        let translation = body.translation();
        let rotation = body.rotation().quaternion();
        let values = [
            id as f32,
            translation.x,
            translation.y,
            translation.z,
            rotation.i,
            rotation.j,
            rotation.k,
            rotation.w,
        ];
        // SAFETY: output_float_capacity was validated for both complete records.
        unsafe {
            ptr::copy_nonoverlapping(
                values.as_ptr(),
                output.add(index * TRANSFORM_WIDTH),
                values.len(),
            )
        };
    }
    VISIBLE_BODY_COUNT as i32
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_proof_drain_collision_events(
    simulation: *mut ProofSimulation,
    output: *mut u32,
    output_u32_capacity: usize,
) -> i32 {
    let Some(simulation) = (unsafe { simulation.as_mut() }) else {
        return -1;
    };
    let required = simulation.events.len() * EVENT_WIDTH;
    if required > output_u32_capacity || (required > 0 && output.is_null()) {
        return -1;
    }
    for event_index in 0..simulation.events.len() {
        let event = simulation.events[event_index];
        // SAFETY: The full queue capacity was validated before writing any event.
        unsafe {
            ptr::copy_nonoverlapping(
                event.as_ptr(),
                output.add(event_index * EVENT_WIDTH),
                EVENT_WIDTH,
            )
        };
    }
    let count = simulation.events.len() as i32;
    simulation.events.clear();
    count
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_proof_destroy(simulation: *mut ProofSimulation) {
    if !simulation.is_null() {
        // SAFETY: The C++ wrapper calls destroy at most once for the Box returned by create.
        unsafe { drop(Box::from_raw(simulation)) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> TnPhysicsProofOptions {
        TnPhysicsProofOptions {
            gravity_x: 0.0,
            gravity_y: -9.81,
            gravity_z: 0.0,
            floor_collision_layer: 1,
            floor_collision_mask: u16::MAX.into(),
            cube_collision_layer: 1,
            cube_collision_mask: u16::MAX.into(),
        }
    }

    #[test]
    fn cube_rests_on_floor_and_emits_collision() {
        let mut simulation = ProofSimulation::new(options()).unwrap();
        for _ in 0..180 {
            assert!(simulation.step(1.0 / 60.0));
        }
        let cube_y = simulation.bodies[simulation.cube_body].translation().y;
        assert!((cube_y - 0.5).abs() <= 0.02, "cube y was {cube_y}");
        assert!(simulation.events.iter().any(|event| *event == [0, 1, 1, 1]));
    }

    #[test]
    fn collision_mask_is_a_real_negative_control() {
        let mut masked = options();
        masked.cube_collision_layer = 2;
        masked.cube_collision_mask = 2;
        let mut simulation = ProofSimulation::new(masked).unwrap();
        for _ in 0..180 {
            assert!(simulation.step(1.0 / 60.0));
        }
        assert!(simulation.bodies[simulation.cube_body].translation().y < -5.0);
        assert!(simulation.events.is_empty());
    }

    #[test]
    fn upward_gravity_is_a_real_negative_control() {
        let mut upward = options();
        upward.gravity_y = 9.81;
        let mut simulation = ProofSimulation::new(upward).unwrap();
        for _ in 0..60 {
            assert!(simulation.step(1.0 / 60.0));
        }
        assert!(simulation.bodies[simulation.cube_body].translation().y > 7.0);
    }
}
