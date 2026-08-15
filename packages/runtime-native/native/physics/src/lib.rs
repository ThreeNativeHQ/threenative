use rapier3d::control::{CharacterAutostep, CharacterLength, KinematicCharacterController};
use rapier3d::na::{Quaternion, UnitQuaternion};
use rapier3d::prelude::*;
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::ptr;

const TRANSFORM_WIDTH: usize = 8;
const SLEEP_STATE_WIDTH: usize = 2;
const EVENT_WIDTH: usize = 4;

#[repr(C)]
pub struct TnPhysicsWorldOptions {
    pub gravity_x: f32,
    pub gravity_y: f32,
    pub gravity_z: f32,
}

#[repr(C)]
pub struct TnPhysicsBodyOptions {
    pub id: u32,
    pub body_type: u32,
    pub shape_type: u32,
    pub position_x: f32,
    pub position_y: f32,
    pub position_z: f32,
    pub rotation_x: f32,
    pub rotation_y: f32,
    pub rotation_z: f32,
    pub rotation_w: f32,
    pub shape_x: f32,
    pub shape_y: f32,
    pub shape_z: f32,
    pub mass: f32,
    pub collision_layer: u32,
    pub collision_mask: u32,
    pub sensor: bool,
}

#[repr(C)]
pub struct TnPhysicsCharacterOptions {
    pub id: u32,
    pub offset: f32,
    pub max_slope_climb_angle: f32,
    pub autostep_enabled: bool,
    pub autostep_max_height: f32,
    pub autostep_min_width: f32,
    pub autostep_include_dynamic_bodies: bool,
    pub snap_to_ground_enabled: bool,
    pub snap_to_ground: f32,
    pub one_way_layers: u32,
    pub pushes_dynamic_bodies: bool,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct TnPhysicsRayQuery {
    pub from_x: f32,
    pub from_y: f32,
    pub from_z: f32,
    pub to_x: f32,
    pub to_y: f32,
    pub to_z: f32,
    pub collision_mask: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct TnPhysicsRayHit {
    pub body_id: u32,
    pub position_x: f32,
    pub position_y: f32,
    pub position_z: f32,
    pub normal_x: f32,
    pub normal_y: f32,
    pub normal_z: f32,
    pub distance: f32,
}

#[repr(C)]
pub struct TnPhysicsShapeQueryOptions {
    pub shape_type: u32,
    pub shape_x: f32,
    pub shape_y: f32,
    pub shape_z: f32,
    pub position_x: f32,
    pub position_y: f32,
    pub position_z: f32,
    pub rotation_x: f32,
    pub rotation_y: f32,
    pub rotation_z: f32,
    pub rotation_w: f32,
    pub collision_mask: u32,
    pub max_results: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct TnPhysicsQueryHit {
    pub body_id: u32,
    pub position_x: f32,
    pub position_y: f32,
    pub position_z: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct TnPhysicsVector3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(Debug, PartialEq, Eq)]
enum RayQueryError {
    InvalidArithmetic,
}

#[derive(Clone)]
struct BodyEntry {
    body: RigidBodyHandle,
    collider: ColliderHandle,
    character: bool,
    sensor: bool,
    shape: SharedShape,
}

#[derive(Clone)]
struct CharacterEntry {
    controller: KinematicCharacterController,
    shape: SharedShape,
    grounded: bool,
    ground_collider: Option<u32>,
    one_way_layers: u32,
    pushes_dynamic_bodies: bool,
}

#[repr(i32)]
enum ActuationStatus {
    Ok = 1,
    UnknownBody = 0,
    NotDynamic = -1,
    NonFinite = -2,
}

pub struct Simulation {
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
    entries: BTreeMap<u32, BodyEntry>,
    characters: BTreeMap<u32, CharacterEntry>,
    colliding: BTreeSet<(u32, u32)>,
    events: VecDeque<[u32; EVENT_WIDTH]>,
    query_dirty: bool,
}

impl Simulation {
    fn new(options: TnPhysicsWorldOptions) -> Option<Self> {
        if ![options.gravity_x, options.gravity_y, options.gravity_z]
            .into_iter()
            .all(f32::is_finite)
        {
            return None;
        }
        Some(Self {
            gravity: vector![options.gravity_x, options.gravity_y, options.gravity_z],
            pipeline: PhysicsPipeline::new(),
            integration: IntegrationParameters::default(),
            islands: IslandManager::new(),
            broad_phase: BroadPhaseBvh::new(),
            narrow_phase: NarrowPhase::new(),
            bodies: RigidBodySet::new(),
            colliders: ColliderSet::new(),
            impulse_joints: ImpulseJointSet::new(),
            multibody_joints: MultibodyJointSet::new(),
            ccd: CCDSolver::new(),
            entries: BTreeMap::new(),
            characters: BTreeMap::new(),
            colliding: BTreeSet::new(),
            events: VecDeque::new(),
            query_dirty: true,
        })
    }

    fn add_body(&mut self, options: TnPhysicsBodyOptions) -> bool {
        let finite = [
            options.position_x,
            options.position_y,
            options.position_z,
            options.rotation_x,
            options.rotation_y,
            options.rotation_z,
            options.rotation_w,
            options.shape_x,
            options.shape_y,
            options.shape_z,
            options.mass,
        ]
        .into_iter()
        .all(f32::is_finite);
        let quaternion_norm = options.rotation_x * options.rotation_x
            + options.rotation_y * options.rotation_y
            + options.rotation_z * options.rotation_z
            + options.rotation_w * options.rotation_w;
        if !finite
            || quaternion_norm <= f32::EPSILON
            || self.entries.contains_key(&options.id)
            || options.mass < 0.0
        {
            return false;
        }
        let Some(layer) = Group::from_bits(options.collision_layer) else {
            return false;
        };
        let Some(mask) = Group::from_bits(options.collision_mask) else {
            return false;
        };
        let position = Isometry::from_parts(
            Translation::new(options.position_x, options.position_y, options.position_z),
            UnitQuaternion::new_normalize(Quaternion::new(
                options.rotation_w,
                options.rotation_x,
                options.rotation_y,
                options.rotation_z,
            )),
        );
        let mut body = match options.body_type {
            0 => RigidBodyBuilder::dynamic(),
            1 => RigidBodyBuilder::fixed(),
            2 | 3 => RigidBodyBuilder::kinematic_position_based(),
            _ => return false,
        }
        .pose(position);
        if options.mass > 0.0 {
            body = body.additional_mass(options.mass);
        }
        let body = self.bodies.insert(body);
        let mut collider = match options.shape_type {
            0 if options.shape_x > 0.0 && options.shape_y > 0.0 && options.shape_z > 0.0 => {
                ColliderBuilder::cuboid(options.shape_x, options.shape_y, options.shape_z)
            }
            1 if options.shape_x > 0.0 => ColliderBuilder::ball(options.shape_x),
            2 if options.shape_x >= 0.0 && options.shape_y > 0.0 => {
                ColliderBuilder::capsule_y(options.shape_x, options.shape_y)
            }
            _ => {
                self.bodies.remove(
                    body,
                    &mut self.islands,
                    &mut self.colliders,
                    &mut self.impulse_joints,
                    &mut self.multibody_joints,
                    true,
                );
                return false;
            }
        }
        .collision_groups(InteractionGroups::new(layer, mask))
        .sensor(options.sensor);
        collider = collider.active_events(ActiveEvents::COLLISION_EVENTS);
        let shape = collider.shape.clone();
        let collider = self
            .colliders
            .insert_with_parent(collider, body, &mut self.bodies);
        self.entries.insert(
            options.id,
            BodyEntry {
                body,
                collider,
                character: options.body_type == 3,
                sensor: options.sensor,
                shape,
            },
        );
        self.query_dirty = true;
        true
    }

    fn configure_character(&mut self, options: TnPhysicsCharacterOptions) -> bool {
        if ![
            options.offset,
            options.max_slope_climb_angle,
            options.autostep_max_height,
            options.autostep_min_width,
            options.snap_to_ground,
        ]
        .into_iter()
        .all(f32::is_finite)
            || options.offset <= 0.0
            || options.max_slope_climb_angle < 0.0
            || (options.autostep_enabled
                && (options.autostep_max_height <= 0.0 || options.autostep_min_width <= 0.0))
            || (options.snap_to_ground_enabled && options.snap_to_ground <= 0.0)
            || !self
                .entries
                .get(&options.id)
                .is_some_and(|entry| entry.character)
        {
            return false;
        }
        let character_shape = self.entries[&options.id].shape.clone();
        let mut controller = KinematicCharacterController {
            offset: CharacterLength::Absolute(options.offset),
            max_slope_climb_angle: options.max_slope_climb_angle,
            snap_to_ground: options
                .snap_to_ground_enabled
                .then_some(CharacterLength::Absolute(options.snap_to_ground)),
            ..KinematicCharacterController::default()
        };
        controller.autostep = options.autostep_enabled.then_some(CharacterAutostep {
            max_height: CharacterLength::Absolute(options.autostep_max_height),
            min_width: CharacterLength::Absolute(options.autostep_min_width),
            include_dynamic_bodies: options.autostep_include_dynamic_bodies,
        });
        self.characters.insert(
            options.id,
            CharacterEntry {
                controller,
                shape: character_shape,
                grounded: false,
                ground_collider: None,
                one_way_layers: options.one_way_layers,
                pushes_dynamic_bodies: options.pushes_dynamic_bodies,
            },
        );
        true
    }

    fn remove_body(&mut self, id: u32) -> bool {
        let Some(entry) = self.entries.remove(&id) else {
            return false;
        };
        self.bodies.remove(
            entry.body,
            &mut self.islands,
            &mut self.colliders,
            &mut self.impulse_joints,
            &mut self.multibody_joints,
            true,
        );
        self.colliding
            .retain(|(left, right)| *left != id && *right != id);
        self.characters.remove(&id);
        self.query_dirty = true;
        true
    }

    fn set_body_transform(&mut self, id: u32, x: f32, y: f32, z: f32) -> bool {
        if ![x, y, z].into_iter().all(f32::is_finite) {
            return false;
        }
        let Some(entry) = self.entries.get(&id) else {
            return false;
        };
        let body = &mut self.bodies[entry.body];
        body.set_translation(vector![x, y, z], true);
        body.set_next_kinematic_translation(vector![x, y, z]);
        self.bodies
            .propagate_modified_body_positions_to_colliders(&mut self.colliders);
        self.query_dirty = true;
        true
    }

    fn apply_body_impulse(&mut self, id: u32, x: f32, y: f32, z: f32) -> ActuationStatus {
        if ![x, y, z].into_iter().all(f32::is_finite) {
            return ActuationStatus::NonFinite;
        }
        let Some(entry) = self.entries.get(&id).cloned() else {
            return ActuationStatus::UnknownBody;
        };
        let body = &mut self.bodies[entry.body];
        if !body.is_dynamic() {
            return ActuationStatus::NotDynamic;
        }
        body.apply_impulse(vector![x, y, z], true);
        ActuationStatus::Ok
    }

    fn apply_body_force(&mut self, id: u32, x: f32, y: f32, z: f32) -> ActuationStatus {
        if ![x, y, z].into_iter().all(f32::is_finite) {
            return ActuationStatus::NonFinite;
        }
        let Some(entry) = self.entries.get(&id).cloned() else {
            return ActuationStatus::UnknownBody;
        };
        let body = &mut self.bodies[entry.body];
        if !body.is_dynamic() {
            return ActuationStatus::NotDynamic;
        }
        body.add_force(vector![x, y, z], true);
        ActuationStatus::Ok
    }

    fn set_body_linear_velocity(&mut self, id: u32, x: f32, y: f32, z: f32) -> ActuationStatus {
        if ![x, y, z].into_iter().all(f32::is_finite) {
            return ActuationStatus::NonFinite;
        }
        let Some(entry) = self.entries.get(&id).cloned() else {
            return ActuationStatus::UnknownBody;
        };
        let body = &mut self.bodies[entry.body];
        if !body.is_dynamic() {
            return ActuationStatus::NotDynamic;
        }
        body.set_linvel(vector![x, y, z], true);
        ActuationStatus::Ok
    }

    fn read_body_linear_velocity(&self, id: u32, output: &mut TnPhysicsVector3) -> ActuationStatus {
        let Some(entry) = self.entries.get(&id) else {
            return ActuationStatus::UnknownBody;
        };
        let body = &self.bodies[entry.body];
        if !body.is_dynamic() {
            return ActuationStatus::NotDynamic;
        }
        let velocity = body.linvel();
        output.x = velocity.x;
        output.y = velocity.y;
        output.z = velocity.z;
        ActuationStatus::Ok
    }

    fn apply_kinematic(&mut self, values: &[f32], delta_time: f32) -> bool {
        if values.len() % TRANSFORM_WIDTH != 0 || !values.iter().all(|value| value.is_finite()) {
            return false;
        }
        for record in values.chunks_exact(TRANSFORM_WIDTH) {
            let id_value = record[0];
            if id_value < 0.0 || id_value.fract() != 0.0 || id_value > u32::MAX as f32 {
                return false;
            }
            let id = id_value as u32;
            let Some(entry) = self.entries.get(&id).cloned() else {
                return false;
            };
            let rotation_norm = record[4] * record[4]
                + record[5] * record[5]
                + record[6] * record[6]
                + record[7] * record[7];
            if rotation_norm <= f32::EPSILON {
                return false;
            }
            let target = vector![record[1], record[2], record[3]];
            let rotation = UnitQuaternion::new_normalize(Quaternion::new(
                record[7], record[4], record[5], record[6],
            ));
            if entry.character {
                let Some(character) = self.characters.get(&id).cloned() else {
                    return false;
                };
                let body = &self.bodies[entry.body];
                let desired = target - body.translation();
                let upward = desired.y > 0.0;
                let one_way_layers = character.one_way_layers;
                let groups = self.colliders[entry.collider].collision_groups();
                let predicate = |_: ColliderHandle, collider: &Collider| {
                    !collider.is_sensor()
                        && (!upward
                            || (collider.collision_groups().memberships.bits() & one_way_layers)
                                == 0)
                };
                let filter = QueryFilter {
                    flags: QueryFilterFlags::EXCLUDE_SENSORS,
                    groups: Some(groups),
                    exclude_rigid_body: Some(entry.body),
                    predicate: Some(&predicate),
                    ..QueryFilter::default()
                };
                let query = self.broad_phase.as_query_pipeline(
                    self.narrow_phase.query_dispatcher(),
                    &self.bodies,
                    &self.colliders,
                    filter,
                );
                let collider_ids: HashMap<ColliderHandle, u32> = self
                    .entries
                    .iter()
                    .map(|(body_id, body_entry)| (body_entry.collider, *body_id))
                    .collect();
                let mut ground_collider = None;
                let mut collisions = Vec::new();
                let movement = character.controller.move_shape(
                    delta_time,
                    &query,
                    character.shape.as_ref(),
                    body.position(),
                    desired,
                    |collision| {
                        if collision.hit.normal1.y >= 0.5 {
                            ground_collider = collider_ids.get(&collision.handle).copied();
                        }
                        if character.pushes_dynamic_bodies {
                            collisions.push(collision);
                        }
                    },
                );
                if character.pushes_dynamic_bodies && !collisions.is_empty() {
                    let mut query = self.broad_phase.as_query_pipeline_mut(
                        self.narrow_phase.query_dispatcher(),
                        &mut self.bodies,
                        &mut self.colliders,
                        filter,
                    );
                    let character_mass = query.bodies[entry.body].mass();
                    character.controller.solve_character_collision_impulses(
                        delta_time,
                        &mut query,
                        character.shape.as_ref(),
                        character_mass,
                        collisions.iter(),
                    );
                }
                let body = &mut self.bodies[entry.body];
                let current = *body.translation();
                body.set_next_kinematic_translation(current + movement.translation);
                body.set_next_kinematic_rotation(rotation);
                let state = self.characters.get_mut(&id).expect("character was checked");
                state.grounded = movement.grounded;
                state.ground_collider = ground_collider
                    .or_else(|| movement.grounded.then_some(state.ground_collider).flatten());
            } else {
                let body = &mut self.bodies[entry.body];
                if !body.is_kinematic() {
                    return false;
                }
                body.set_next_kinematic_translation(target);
                body.set_next_kinematic_rotation(rotation);
            }
        }
        true
    }

    fn step(&mut self, delta_time: f32, kinematic: &[f32]) -> bool {
        if !delta_time.is_finite()
            || delta_time <= 0.0
            || !self.apply_kinematic(kinematic, delta_time)
        {
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
        let entries: Vec<_> = self
            .entries
            .iter()
            .map(|(id, entry)| (*id, entry.clone()))
            .collect();
        let mut current = BTreeSet::new();
        for (index, (left_id, left)) in entries.iter().enumerate() {
            for (right_id, right) in entries.iter().skip(index + 1) {
                let touching = self
                    .narrow_phase
                    .contact_pair(left.collider, right.collider)
                    .is_some_and(|pair| pair.has_any_active_contact)
                    || self
                        .narrow_phase
                        .intersection_pair(left.collider, right.collider)
                        .unwrap_or(false);
                if touching {
                    current.insert((*left_id, *right_id));
                }
            }
        }
        for pair in current.difference(&self.colliding) {
            self.events.push_back([pair.0, pair.1, 1, 1]);
        }
        for pair in self.colliding.difference(&current) {
            self.events.push_back([pair.0, pair.1, 0, 1]);
        }
        self.colliding = current;
        self.query_dirty = false;
        true
    }

    fn refresh_query_pipeline(&mut self) {
        if !self.query_dirty {
            return;
        }
        let modified: Vec<_> = self.entries.values().map(|entry| entry.collider).collect();
        let mut events = Vec::new();
        self.broad_phase.update(
            &self.integration,
            &self.colliders,
            &self.bodies,
            &modified,
            &[],
            &mut events,
        );
        self.query_dirty = false;
    }

    fn write_character_states(&self, output: &mut [f32]) -> Option<usize> {
        if output.len() < self.characters.len() * 3 {
            return None;
        }
        for (index, (id, character)) in self.characters.iter().enumerate() {
            let offset = index * 3;
            output[offset] = *id as f32;
            output[offset + 1] = if character.grounded { 1.0 } else { 0.0 };
            output[offset + 2] = character
                .ground_collider
                .map_or(-1.0, |collider| collider as f32);
        }
        Some(self.characters.len())
    }

    fn area_intersections(&self) -> Vec<[u32; 2]> {
        let collider_ids: HashMap<ColliderHandle, u32> = self
            .entries
            .iter()
            .map(|(body_id, body_entry)| (body_entry.collider, *body_id))
            .collect();
        let mut pairs = Vec::new();
        for (area_id, area) in self.entries.iter().filter(|(_, entry)| entry.sensor) {
            let area_collider = &self.colliders[area.collider];
            let area_mask = area_collider.collision_groups().filter.bits();
            let predicate = |handle: ColliderHandle, collider: &Collider| {
                handle != area.collider
                    && !collider.is_sensor()
                    && (collider.collision_groups().memberships.bits() & area_mask) != 0
            };
            let filter = QueryFilter {
                predicate: Some(&predicate),
                ..QueryFilter::default()
            };
            let query = self.broad_phase.as_query_pipeline(
                self.narrow_phase.query_dispatcher(),
                &self.bodies,
                &self.colliders,
                filter,
            );
            for (collider, _) in
                query.intersect_shape(*area_collider.position(), area_collider.shape())
            {
                if let Some(body_id) = collider_ids.get(&collider) {
                    pairs.push([*area_id, *body_id]);
                }
            }
        }
        pairs
    }

    fn intersect_ray(
        &mut self,
        query: TnPhysicsRayQuery,
    ) -> Result<Option<TnPhysicsRayHit>, RayQueryError> {
        self.refresh_query_pipeline();
        let direction = vector![
            query.to_x - query.from_x,
            query.to_y - query.from_y,
            query.to_z - query.from_z
        ];
        let scale = direction
            .x
            .abs()
            .max(direction.y.abs())
            .max(direction.z.abs());
        if !scale.is_finite() || scale == 0.0 {
            return Err(RayQueryError::InvalidArithmetic);
        }
        let scaled_direction = direction / scale;
        let scaled_distance = scaled_direction.norm();
        if !scaled_distance.is_finite() || scaled_distance == 0.0 {
            return Err(RayQueryError::InvalidArithmetic);
        }
        let distance = scale * scaled_distance;
        if !distance.is_finite() || distance == 0.0 {
            return Err(RayQueryError::InvalidArithmetic);
        }
        let ray = Ray::new(
            point![query.from_x, query.from_y, query.from_z],
            scaled_direction / scaled_distance,
        );
        let predicate = |handle: ColliderHandle, collider: &Collider| {
            self.entries.values().any(|entry| entry.collider == handle)
                && !collider.is_sensor()
                && (collider.collision_groups().memberships.bits() & query.collision_mask) != 0
        };
        let filter = QueryFilter {
            flags: QueryFilterFlags::EXCLUDE_SENSORS,
            predicate: Some(&predicate),
            ..QueryFilter::default()
        };
        let pipeline = self.broad_phase.as_query_pipeline(
            self.narrow_phase.query_dispatcher(),
            &self.bodies,
            &self.colliders,
            filter,
        );
        let Some((collider, intersection)) =
            pipeline.cast_ray_and_get_normal(&ray, distance, true)
        else {
            return Ok(None);
        };
        let Some(body_id) = self
            .entries
            .iter()
            .find_map(|(id, entry)| (entry.collider == collider).then_some(*id))
        else {
            return Ok(None);
        };
        let position = ray.point_at(intersection.time_of_impact);
        let hit = TnPhysicsRayHit {
            body_id,
            position_x: position.x,
            position_y: position.y,
            position_z: position.z,
            normal_x: intersection.normal.x,
            normal_y: intersection.normal.y,
            normal_z: intersection.normal.z,
            distance: intersection.time_of_impact,
        };
        if [
            hit.position_x,
            hit.position_y,
            hit.position_z,
            hit.normal_x,
            hit.normal_y,
            hit.normal_z,
            hit.distance,
        ]
        .into_iter()
        .all(f32::is_finite)
        {
            Ok(Some(hit))
        } else {
            Err(RayQueryError::InvalidArithmetic)
        }
    }

    fn query_shape(options: &TnPhysicsShapeQueryOptions) -> Option<SharedShape> {
        let dimensions = [options.shape_x, options.shape_y, options.shape_z];
        if !dimensions.into_iter().all(f32::is_finite) {
            return None;
        }
        match options.shape_type {
            0 if options.shape_x > 0.0
                && options.shape_y > 0.0
                && options.shape_z > 0.0 =>
            {
                Some(SharedShape::cuboid(
                    options.shape_x,
                    options.shape_y,
                    options.shape_z,
                ))
            }
            1 if options.shape_x > 0.0 => Some(SharedShape::ball(options.shape_x)),
            2 if options.shape_x >= 0.0 && options.shape_y > 0.0 => {
                Some(SharedShape::capsule_y(options.shape_x, options.shape_y))
            }
            _ => None,
        }
    }

    fn query_pose(options: &TnPhysicsShapeQueryOptions) -> Option<Isometry<Real>> {
        let values = [
            options.position_x,
            options.position_y,
            options.position_z,
            options.rotation_x,
            options.rotation_y,
            options.rotation_z,
            options.rotation_w,
        ];
        if !values.into_iter().all(f32::is_finite) {
            return None;
        }
        let norm = options.rotation_x * options.rotation_x
            + options.rotation_y * options.rotation_y
            + options.rotation_z * options.rotation_z
            + options.rotation_w * options.rotation_w;
        if norm <= f32::EPSILON {
            return None;
        }
        Some(Isometry::from_parts(
            Translation::new(
                options.position_x,
                options.position_y,
                options.position_z,
            ),
            UnitQuaternion::new_normalize(Quaternion::new(
                options.rotation_w,
                options.rotation_x,
                options.rotation_y,
                options.rotation_z,
            )),
        ))
    }

    fn intersect_shape(
        &mut self,
        options: TnPhysicsShapeQueryOptions,
    ) -> Option<Vec<TnPhysicsQueryHit>> {
        self.refresh_query_pipeline();
        if options.max_results == 0 {
            return None;
        }
        let shape = Self::query_shape(&options)?;
        let pose = Self::query_pose(&options)?;
        let predicate = |handle: ColliderHandle, collider: &Collider| {
            self.entries.values().any(|entry| entry.collider == handle)
                && !collider.is_sensor()
                && (collider.collision_groups().memberships.bits() & options.collision_mask) != 0
        };
        let filter = QueryFilter {
            flags: QueryFilterFlags::EXCLUDE_SENSORS,
            predicate: Some(&predicate),
            ..QueryFilter::default()
        };
        let pipeline = self.broad_phase.as_query_pipeline(
            self.narrow_phase.query_dispatcher(),
            &self.bodies,
            &self.colliders,
            filter,
        );
        let mut hits = Vec::with_capacity(options.max_results as usize);
        for (collider, _) in pipeline.intersect_shape(pose, shape.as_ref()) {
            let Some((body_id, entry)) = self
                .entries
                .iter()
                .find(|(_, entry)| entry.collider == collider)
            else {
                continue;
            };
            let position = self.bodies[entry.body].translation();
            hits.push(TnPhysicsQueryHit {
                body_id: *body_id,
                position_x: position.x,
                position_y: position.y,
                position_z: position.z,
            });
            if hits.len() == options.max_results as usize {
                break;
            }
        }
        Some(hits)
    }

    fn intersect_point(
        &mut self,
        position_x: f32,
        position_y: f32,
        position_z: f32,
        collision_mask: u32,
        max_results: u32,
    ) -> Option<Vec<TnPhysicsQueryHit>> {
        self.refresh_query_pipeline();
        if max_results == 0
            || ![position_x, position_y, position_z]
                .into_iter()
                .all(f32::is_finite)
        {
            return None;
        }
        let point = point![position_x, position_y, position_z];
        let predicate = |handle: ColliderHandle, collider: &Collider| {
            self.entries.values().any(|entry| entry.collider == handle)
                && !collider.is_sensor()
                && (collider.collision_groups().memberships.bits() & collision_mask) != 0
        };
        let filter = QueryFilter {
            flags: QueryFilterFlags::EXCLUDE_SENSORS,
            predicate: Some(&predicate),
            ..QueryFilter::default()
        };
        let pipeline = self.broad_phase.as_query_pipeline(
            self.narrow_phase.query_dispatcher(),
            &self.bodies,
            &self.colliders,
            filter,
        );
        let mut hits = Vec::with_capacity(max_results as usize);
        for (collider, _) in pipeline.intersect_point(point) {
            let Some((body_id, entry)) = self
                .entries
                .iter()
                .find(|(_, entry)| entry.collider == collider)
            else {
                continue;
            };
            let position = self.bodies[entry.body].translation();
            hits.push(TnPhysicsQueryHit {
                body_id: *body_id,
                position_x: position.x,
                position_y: position.y,
                position_z: position.z,
            });
            if hits.len() == max_results as usize {
                break;
            }
        }
        Some(hits)
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_version() -> *const std::ffi::c_char {
    c"0.30.0".as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_create(options: *const TnPhysicsWorldOptions) -> *mut Simulation {
    if options.is_null() {
        return ptr::null_mut();
    }
    let options = unsafe { ptr::read(options) };
    Simulation::new(options)
        .map(Box::new)
        .map_or(ptr::null_mut(), Box::into_raw)
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_add_body(
    simulation: *mut Simulation,
    options: *const TnPhysicsBodyOptions,
) -> bool {
    let (Some(simulation), false) = (unsafe { simulation.as_mut() }, options.is_null()) else {
        return false;
    };
    simulation.add_body(unsafe { ptr::read(options) })
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_remove_body(simulation: *mut Simulation, id: u32) -> bool {
    unsafe { simulation.as_mut() }.is_some_and(|simulation| simulation.remove_body(id))
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_configure_character(
    simulation: *mut Simulation,
    options: *const TnPhysicsCharacterOptions,
) -> bool {
    let (Some(simulation), false) = (unsafe { simulation.as_mut() }, options.is_null()) else {
        return false;
    };
    simulation.configure_character(unsafe { ptr::read(options) })
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_set_body_transform(
    simulation: *mut Simulation,
    id: u32,
    x: f32,
    y: f32,
    z: f32,
) -> bool {
    unsafe { simulation.as_mut() }
        .is_some_and(|simulation| simulation.set_body_transform(id, x, y, z))
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_apply_body_impulse(
    simulation: *mut Simulation,
    id: u32,
    x: f32,
    y: f32,
    z: f32,
) -> i32 {
    unsafe { simulation.as_mut() }.map_or(ActuationStatus::UnknownBody as i32, |simulation| {
        simulation.apply_body_impulse(id, x, y, z) as i32
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_apply_body_force(
    simulation: *mut Simulation,
    id: u32,
    x: f32,
    y: f32,
    z: f32,
) -> i32 {
    unsafe { simulation.as_mut() }.map_or(ActuationStatus::UnknownBody as i32, |simulation| {
        simulation.apply_body_force(id, x, y, z) as i32
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_set_body_linear_velocity(
    simulation: *mut Simulation,
    id: u32,
    x: f32,
    y: f32,
    z: f32,
) -> i32 {
    unsafe { simulation.as_mut() }.map_or(ActuationStatus::UnknownBody as i32, |simulation| {
        simulation.set_body_linear_velocity(id, x, y, z) as i32
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_read_body_linear_velocity(
    simulation: *const Simulation,
    id: u32,
    output: *mut TnPhysicsVector3,
) -> i32 {
    let (Some(simulation), false) = (unsafe { simulation.as_ref() }, output.is_null()) else {
        return ActuationStatus::UnknownBody as i32;
    };
    let output = unsafe { &mut *output };
    simulation.read_body_linear_velocity(id, output) as i32
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_step(
    simulation: *mut Simulation,
    delta_time: f32,
    kinematic_transforms: *const f32,
    kinematic_record_count: usize,
) -> bool {
    let Some(simulation) = (unsafe { simulation.as_mut() }) else {
        return false;
    };
    if kinematic_record_count > 0 && kinematic_transforms.is_null() {
        return false;
    }
    let values = if kinematic_record_count == 0 {
        &[]
    } else {
        unsafe {
            std::slice::from_raw_parts(
                kinematic_transforms,
                kinematic_record_count * TRANSFORM_WIDTH,
            )
        }
    };
    simulation.step(delta_time, values)
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_read_visible_transforms(
    simulation: *const Simulation,
    output: *mut f32,
    output_float_capacity: usize,
) -> i32 {
    let Some(simulation) = (unsafe { simulation.as_ref() }) else {
        return -1;
    };
    let required = simulation.entries.len() * TRANSFORM_WIDTH;
    if required > output_float_capacity || (required > 0 && output.is_null()) {
        return -1;
    }
    for (index, (id, entry)) in simulation.entries.iter().enumerate() {
        let body = &simulation.bodies[entry.body];
        let translation = body.translation();
        let rotation = body.rotation().quaternion();
        let values = [
            *id as f32,
            translation.x,
            translation.y,
            translation.z,
            rotation.i,
            rotation.j,
            rotation.k,
            rotation.w,
        ];
        unsafe {
            ptr::copy_nonoverlapping(
                values.as_ptr(),
                output.add(index * TRANSFORM_WIDTH),
                TRANSFORM_WIDTH,
            )
        };
    }
    simulation.entries.len() as i32
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_read_body_sleep_states(
    simulation: *const Simulation,
    output: *mut f32,
    output_float_capacity: usize,
) -> i32 {
    let Some(simulation) = (unsafe { simulation.as_ref() }) else {
        return -1;
    };
    let required = simulation.entries.len() * SLEEP_STATE_WIDTH;
    if required > output_float_capacity || (required > 0 && output.is_null()) {
        return -1;
    }
    for (index, (id, entry)) in simulation.entries.iter().enumerate() {
        let values = [
            *id as f32,
            if simulation.bodies[entry.body].is_sleeping() {
                1.0
            } else {
                0.0
            },
        ];
        unsafe {
            ptr::copy_nonoverlapping(
                values.as_ptr(),
                output.add(index * SLEEP_STATE_WIDTH),
                SLEEP_STATE_WIDTH,
            )
        };
    }
    simulation.entries.len() as i32
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_read_character_states(
    simulation: *const Simulation,
    output: *mut f32,
    output_float_capacity: usize,
) -> i32 {
    let Some(simulation) = (unsafe { simulation.as_ref() }) else {
        return -1;
    };
    let required = simulation.characters.len() * 3;
    if required > output_float_capacity || (required > 0 && output.is_null()) {
        return -1;
    }
    let values = if required == 0 {
        &mut []
    } else {
        unsafe { std::slice::from_raw_parts_mut(output, required) }
    };
    simulation
        .write_character_states(values)
        .map_or(-1, |count| count as i32)
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_read_area_intersections(
    simulation: *const Simulation,
    output: *mut u32,
    output_u32_capacity: usize,
) -> i32 {
    let Some(simulation) = (unsafe { simulation.as_ref() }) else {
        return -1;
    };
    let pairs = simulation.area_intersections();
    let required = pairs.len() * 2;
    if required > output_u32_capacity || (required > 0 && output.is_null()) {
        return -1;
    }
    for (index, pair) in pairs.iter().enumerate() {
        unsafe { ptr::copy_nonoverlapping(pair.as_ptr(), output.add(index * 2), 2) };
    }
    pairs.len() as i32
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_intersect_ray(
    simulation: *mut Simulation,
    query: *const TnPhysicsRayQuery,
    output: *mut TnPhysicsRayHit,
) -> i32 {
    let (Some(simulation), false) = (unsafe { simulation.as_mut() }, query.is_null()) else {
        return -1;
    };
    let hit = match simulation.intersect_ray(unsafe { ptr::read(query) }) {
        Err(RayQueryError::InvalidArithmetic) => return -1,
        Ok(None) => return 0,
        Ok(Some(hit)) => hit,
    };
    if output.is_null() {
        return -1;
    }
    unsafe { ptr::write(output, hit) };
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_intersect_shape(
    simulation: *mut Simulation,
    query: *const TnPhysicsShapeQueryOptions,
    output: *mut TnPhysicsQueryHit,
    output_capacity: usize,
) -> i32 {
    let (Some(simulation), false) = (unsafe { simulation.as_mut() }, query.is_null()) else {
        return -1;
    };
    let query = unsafe { ptr::read(query) };
    if query.max_results == 0 || output_capacity < query.max_results as usize {
        return -1;
    }
    let Some(hits) = simulation.intersect_shape(query) else {
        return -1;
    };
    if hits.len() > output_capacity || (hits.len() > 0 && output.is_null()) {
        return -1;
    }
    for (index, hit) in hits.iter().enumerate() {
        unsafe { ptr::write(output.add(index), *hit) };
    }
    hits.len() as i32
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_intersect_point(
    simulation: *mut Simulation,
    position_x: f32,
    position_y: f32,
    position_z: f32,
    collision_mask: u32,
    max_results: u32,
    output: *mut TnPhysicsQueryHit,
    output_capacity: usize,
) -> i32 {
    let Some(simulation) = (unsafe { simulation.as_mut() }) else {
        return -1;
    };
    if max_results == 0 || output_capacity < max_results as usize {
        return -1;
    }
    let Some(hits) = simulation.intersect_point(
        position_x,
        position_y,
        position_z,
        collision_mask,
        max_results,
    ) else {
        return -1;
    };
    if hits.len() > output_capacity || (hits.len() > 0 && output.is_null()) {
        return -1;
    }
    for (index, hit) in hits.iter().enumerate() {
        unsafe { ptr::write(output.add(index), *hit) };
    }
    hits.len() as i32
}

#[unsafe(no_mangle)]
pub extern "C" fn tn_physics_drain_collision_events(
    simulation: *mut Simulation,
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
    for (event_index, event) in simulation.events.iter().enumerate() {
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
pub extern "C" fn tn_physics_destroy(simulation: *mut Simulation) {
    if !simulation.is_null() {
        unsafe { drop(Box::from_raw(simulation)) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed_box(id: u32, x: f32, y: f32, layer: u32) -> TnPhysicsBodyOptions {
        TnPhysicsBodyOptions {
            id,
            body_type: 1,
            shape_type: 0,
            position_x: x,
            position_y: y,
            position_z: 0.0,
            rotation_x: 0.0,
            rotation_y: 0.0,
            rotation_z: 0.0,
            rotation_w: 1.0,
            shape_x: 0.5,
            shape_y: 0.5,
            shape_z: 0.5,
            mass: 0.0,
            collision_layer: layer,
            collision_mask: u16::MAX.into(),
            sensor: false,
        }
    }

    #[test]
    fn spatial_queries_report_numeric_hits_and_apply_masks_and_bounds() {
        let mut simulation = Simulation::new(TnPhysicsWorldOptions {
            gravity_x: 0.0,
            gravity_y: 0.0,
            gravity_z: 0.0,
        })
        .unwrap();
        assert!(simulation.add_body(fixed_box(0, 4.0, 0.0, 1)));
        assert!(simulation.add_body(fixed_box(1, 6.0, 0.0, 2)));
        for id in 0..20 {
            assert!(simulation.add_body(fixed_box(id + 2, id as f32, 10.0, 1)));
        }
        assert!(simulation.step(1.0 / 60.0, &[]));

        let hit = simulation
            .intersect_ray(TnPhysicsRayQuery {
                from_x: 0.0,
                from_y: 0.0,
                from_z: 0.0,
                to_x: 10.0,
                to_y: 0.0,
                to_z: 0.0,
                collision_mask: 1,
            })
            .expect("valid ray arithmetic")
            .expect("ray should hit the first box");
        assert_eq!(hit.body_id, 0);
        assert!((hit.distance - 3.5).abs() < 1.0e-6);
        assert!((hit.position_x - 3.5).abs() < 1.0e-6);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
        assert_eq!(hit.normal_z, 0.0);
        assert!(simulation
            .intersect_ray(TnPhysicsRayQuery {
                from_x: 5.5,
                from_y: 0.0,
                from_z: 0.0,
                to_x: 7.0,
                to_y: 0.0,
                to_z: 0.0,
                collision_mask: 1,
            })
            .expect("clear ray arithmetic")
            .is_none());
        assert!(simulation
            .intersect_ray(TnPhysicsRayQuery {
                from_x: 0.0,
                from_y: 20.0,
                from_z: 0.0,
                to_x: 10.0,
                to_y: 20.0,
                to_z: 0.0,
                collision_mask: 1,
            })
            .expect("masked ray arithmetic")
            .is_none());

        let hits = simulation
            .intersect_shape(TnPhysicsShapeQueryOptions {
                shape_type: 1,
                shape_x: 50.0,
                shape_y: 0.0,
                shape_z: 0.0,
                position_x: 0.0,
                position_y: 0.0,
                position_z: 0.0,
                rotation_x: 0.0,
                rotation_y: 0.0,
                rotation_z: 0.0,
                rotation_w: 1.0,
                collision_mask: 1,
                max_results: 16,
            })
            .unwrap();
        assert_eq!(hits.len(), 16);
        let point_hits = simulation
            .intersect_point(4.0, 0.0, 0.0, 1, 16)
            .unwrap();
        assert_eq!(point_hits.len(), 1);
        assert_eq!(point_hits[0].body_id, 0);
    }

    #[test]
    fn native_shape_and_point_queries_report_misses_and_apply_masks() {
        let mut simulation = Simulation::new(TnPhysicsWorldOptions {
            gravity_x: 0.0,
            gravity_y: 0.0,
            gravity_z: 0.0,
        })
        .unwrap();
        assert!(simulation.add_body(fixed_box(0, 0.0, 0.0, 1)));
        assert!(simulation.step(1.0 / 60.0, &[]));

        let query = |position_x, position_y, position_z, collision_mask| {
            TnPhysicsShapeQueryOptions {
                shape_type: 1,
                shape_x: 0.5,
                shape_y: 0.0,
                shape_z: 0.0,
                position_x,
                position_y,
                position_z,
                rotation_x: 0.0,
                rotation_y: 0.0,
                rotation_z: 0.0,
                rotation_w: 1.0,
                collision_mask,
                max_results: 16,
            }
        };
        assert!(simulation
            .intersect_shape(query(100.0, 100.0, 100.0, 1))
            .unwrap()
            .is_empty());
        assert!(simulation
            .intersect_shape(query(0.0, 0.0, 0.0, 2))
            .unwrap()
            .is_empty());
        assert!(simulation
            .intersect_point(100.0, 100.0, 100.0, 1, 16)
            .unwrap()
            .is_empty());
        assert!(simulation
            .intersect_point(0.0, 0.0, 0.0, 2, 16)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn spatial_queries_see_attached_collider_after_immediate_teleport() {
        let mut simulation = Simulation::new(TnPhysicsWorldOptions {
            gravity_x: 0.0,
            gravity_y: 0.0,
            gravity_z: 0.0,
        })
        .unwrap();
        assert!(simulation.add_body(fixed_box(0, -4.0, 0.0, 1)));
        assert!(simulation.step(1.0 / 60.0, &[]));

        assert_eq!(
            simulation
                .intersect_point(-4.0, 0.0, 0.0, 1, 16)
                .unwrap()
                .len(),
            1
        );
        assert!(simulation.set_body_transform(0, 4.0, 0.0, 0.0));

        assert!(simulation
            .intersect_point(-4.0, 0.0, 0.0, 1, 16)
            .unwrap()
            .is_empty());
        let hits = simulation.intersect_point(4.0, 0.0, 0.0, 1, 16).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].body_id, 0);
    }

    #[test]
    fn accepts_nonzero_ray_with_underflowing_norm_and_rejects_exact_zero() {
        let mut simulation = Simulation::new(TnPhysicsWorldOptions {
            gravity_x: 0.0,
            gravity_y: 0.0,
            gravity_z: 0.0,
        })
        .unwrap();
        assert!(simulation.add_body(fixed_box(0, 0.0, 0.0, 1)));
        assert!(simulation.step(1.0 / 60.0, &[]));

        let short_length = 1.0e-30_f32;
        let short_hit = simulation
            .intersect_ray(TnPhysicsRayQuery {
                from_x: 0.0,
                from_y: 0.0,
                from_z: 0.0,
                to_x: short_length,
                to_y: 0.0,
                to_z: 0.0,
                collision_mask: 1,
            })
            .expect("a nonzero short ray must have valid arithmetic")
            .expect("a nonzero short ray must reach the native query pipeline");
        assert_eq!(short_hit.body_id, 0);
        assert!(short_length > 0.0);
        assert!(
            simulation
                .intersect_ray(TnPhysicsRayQuery {
                    from_x: 0.0,
                    from_y: 0.0,
                    from_z: 0.0,
                    to_x: 0.0,
                    to_y: 0.0,
                    to_z: 0.0,
                    collision_mask: 1,
                })
                .is_err()
        );
    }

    #[test]
    fn rejects_finite_ray_endpoints_when_subtraction_is_unrepresentable() {
        let mut simulation = Simulation::new(TnPhysicsWorldOptions {
            gravity_x: 0.0,
            gravity_y: 0.0,
            gravity_z: 0.0,
        })
        .unwrap();
        let query = TnPhysicsRayQuery {
            from_x: -f32::MAX,
            from_y: 0.0,
            from_z: 0.0,
            to_x: f32::MAX,
            to_y: 0.0,
            to_z: 0.0,
            collision_mask: 1,
        };
        assert!(matches!(
            simulation.intersect_ray(query),
            Err(RayQueryError::InvalidArithmetic)
        ));

        let mut output = TnPhysicsRayHit {
            body_id: 0,
            position_x: 0.0,
            position_y: 0.0,
            position_z: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
            normal_z: 0.0,
            distance: 0.0,
        };
        assert_eq!(
            tn_physics_intersect_ray(
                &mut simulation,
                &query,
                &mut output,
            ),
            -1
        );
    }

    #[test]
    fn arbitrary_body_ids_and_kinematic_bulk_input_are_supported() {
        let mut simulation = Simulation::new(TnPhysicsWorldOptions {
            gravity_x: 0.0,
            gravity_y: -9.81,
            gravity_z: 0.0,
        })
        .unwrap();
        assert!(simulation.add_body(TnPhysicsBodyOptions {
            id: 42,
            body_type: 2,
            shape_type: 1,
            position_x: 0.0,
            position_y: 1.0,
            position_z: 0.0,
            rotation_x: 0.0,
            rotation_y: 0.0,
            rotation_z: 0.0,
            rotation_w: 1.0,
            shape_x: 0.5,
            shape_y: 0.0,
            shape_z: 0.0,
            mass: 0.0,
            collision_layer: 1,
            collision_mask: u16::MAX.into(),
            sensor: false,
        }));
        assert!(simulation.step(1.0 / 60.0, &[42.0, 2.0, 3.0, 4.0, 0.0, 0.0, 0.0, 1.0],));
        assert_eq!(
            simulation.bodies[simulation.entries[&42].body]
                .translation()
                .x,
            2.0
        );
    }

    #[test]
    fn sleep_states_are_bulk_read_and_removed_bodies_disappear() {
        let mut simulation = Simulation::new(TnPhysicsWorldOptions {
            gravity_x: 0.0,
            gravity_y: 0.0,
            gravity_z: 0.0,
        })
        .unwrap();
        let body = |id| TnPhysicsBodyOptions {
            id,
            body_type: 0,
            shape_type: 1,
            position_x: 0.0,
            position_y: 0.0,
            position_z: 0.0,
            rotation_x: 0.0,
            rotation_y: 0.0,
            rotation_z: 0.0,
            rotation_w: 1.0,
            shape_x: 0.5,
            shape_y: 0.0,
            shape_z: 0.0,
            mass: 1.0,
            collision_layer: 1,
            collision_mask: u16::MAX.into(),
            sensor: false,
        };
        assert!(simulation.add_body(body(11)));
        assert!(simulation.add_body(body(29)));
        simulation.bodies[simulation.entries[&11].body].sleep();

        let mut too_small = [f32::NAN; 3];
        assert_eq!(
            tn_physics_read_body_sleep_states(&simulation, too_small.as_mut_ptr(), too_small.len(),),
            -1
        );
        assert!(too_small.iter().all(|value| value.is_nan()));

        let mut states = [f32::NAN; 4];
        assert_eq!(
            tn_physics_read_body_sleep_states(&simulation, states.as_mut_ptr(), states.len()),
            2
        );
        assert_eq!(states, [11.0, 1.0, 29.0, 0.0]);

        assert!(simulation.remove_body(11));
        let mut remaining = [f32::NAN; 2];
        assert_eq!(
            tn_physics_read_body_sleep_states(&simulation, remaining.as_mut_ptr(), remaining.len(),),
            1
        );
        assert_eq!(remaining, [29.0, 0.0]);
    }

    #[test]
    fn configured_character_reports_grounded_while_standing_still() {
        let mut simulation = Simulation::new(TnPhysicsWorldOptions {
            gravity_x: 0.0,
            gravity_y: 0.0,
            gravity_z: 0.0,
        })
        .unwrap();
        let body = |id, body_type, y, shape_x, shape_y, shape_z| TnPhysicsBodyOptions {
            id,
            body_type,
            shape_type: if body_type == 3 { 2 } else { 0 },
            position_x: 0.0,
            position_y: y,
            position_z: 0.0,
            rotation_x: 0.0,
            rotation_y: 0.0,
            rotation_z: 0.0,
            rotation_w: 1.0,
            shape_x,
            shape_y,
            shape_z,
            mass: 0.0,
            collision_layer: 1,
            collision_mask: u16::MAX.into(),
            sensor: false,
        };
        assert!(simulation.add_body(body(1, 1, -0.1, 5.0, 0.1, 5.0)));
        assert!(simulation.add_body(body(2, 3, 0.5, 0.2, 0.3, 0.0)));
        assert!(simulation.configure_character(TnPhysicsCharacterOptions {
            id: 2,
            offset: 0.02,
            max_slope_climb_angle: std::f32::consts::FRAC_PI_4,
            autostep_enabled: true,
            autostep_max_height: 0.4,
            autostep_min_width: 0.2,
            autostep_include_dynamic_bodies: false,
            snap_to_ground_enabled: true,
            snap_to_ground: 0.1,
            one_way_layers: 2,
            pushes_dynamic_bodies: false,
        }));
        for _ in 0..30 {
            let y = simulation.bodies[simulation.entries[&2].body]
                .translation()
                .y;
            assert!(simulation.step(1.0 / 60.0, &[2.0, 0.0, y - 0.02, 0.0, 0.0, 0.0, 0.0, 1.0],));
        }
        let y = simulation.bodies[simulation.entries[&2].body]
            .translation()
            .y;
        assert!(simulation.step(1.0 / 60.0, &[2.0, 0.0, y, 0.0, 0.0, 0.0, 0.0, 1.0],));
        let character = simulation.characters[&2].clone();
        assert!(character.grounded);
        assert_eq!(character.ground_collider, Some(1));
    }

    #[test]
    fn area_mask_does_not_require_the_body_to_scan_the_area() {
        let mut simulation = Simulation::new(TnPhysicsWorldOptions {
            gravity_x: 0.0,
            gravity_y: 0.0,
            gravity_z: 0.0,
        })
        .unwrap();
        let body = |id, sensor, layer, mask| TnPhysicsBodyOptions {
            id,
            body_type: if sensor { 2 } else { 1 },
            shape_type: 0,
            position_x: 0.0,
            position_y: 0.0,
            position_z: 0.0,
            rotation_x: 0.0,
            rotation_y: 0.0,
            rotation_z: 0.0,
            rotation_w: 1.0,
            shape_x: if sensor { 1.0 } else { 0.5 },
            shape_y: if sensor { 1.0 } else { 0.5 },
            shape_z: if sensor { 1.0 } else { 0.5 },
            mass: 0.0,
            collision_layer: layer,
            collision_mask: mask,
            sensor,
        };
        assert!(simulation.add_body(body(1, true, 8, 2)));
        assert!(simulation.add_body(body(2, false, 2, 4)));
        assert!(simulation.step(1.0 / 60.0, &[]));
        assert_eq!(simulation.area_intersections(), vec![[1, 2]]);
    }
}
