#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct TnPhysicsSimulation TnPhysicsSimulation;

typedef struct TnPhysicsWorldOptions {
  float gravity_x;
  float gravity_y;
  float gravity_z;
} TnPhysicsWorldOptions;

typedef struct TnPhysicsBodyOptions {
  uint32_t id;
  uint32_t body_type;
  uint32_t shape_type;
  float position_x;
  float position_y;
  float position_z;
  float rotation_x;
  float rotation_y;
  float rotation_z;
  float rotation_w;
  float shape_x;
  float shape_y;
  float shape_z;
  float mass;
  uint32_t collision_layer;
  uint32_t collision_mask;
  bool sensor;
} TnPhysicsBodyOptions;

typedef struct TnPhysicsCharacterOptions {
  uint32_t id;
  float offset;
  float max_slope_climb_angle;
  bool autostep_enabled;
  float autostep_max_height;
  float autostep_min_width;
  bool autostep_include_dynamic_bodies;
  bool snap_to_ground_enabled;
  float snap_to_ground;
  uint32_t one_way_layers;
} TnPhysicsCharacterOptions;

const char *tn_physics_version(void);
TnPhysicsSimulation *
tn_physics_create(const TnPhysicsWorldOptions *options);
bool tn_physics_add_body(TnPhysicsSimulation *simulation,
                         const TnPhysicsBodyOptions *options);
bool tn_physics_configure_character(
    TnPhysicsSimulation *simulation,
    const TnPhysicsCharacterOptions *options);
bool tn_physics_remove_body(TnPhysicsSimulation *simulation, uint32_t id);
bool tn_physics_set_body_transform(TnPhysicsSimulation *simulation, uint32_t id,
                                   float x, float y, float z);
bool tn_physics_step(TnPhysicsSimulation *simulation, float delta_time,
                     const float *kinematic_transforms,
                     size_t kinematic_record_count);
int32_t tn_physics_read_visible_transforms(
    const TnPhysicsSimulation *simulation, float *output,
    size_t output_float_capacity);
int32_t tn_physics_read_body_sleep_states(
    const TnPhysicsSimulation *simulation, float *output,
    size_t output_float_capacity);
int32_t tn_physics_read_character_states(
    const TnPhysicsSimulation *simulation, float *output,
    size_t output_float_capacity);
int32_t tn_physics_read_area_intersections(
    const TnPhysicsSimulation *simulation, uint32_t *output,
    size_t output_u32_capacity);
int32_t tn_physics_drain_collision_events(TnPhysicsSimulation *simulation,
                                          uint32_t *output,
                                          size_t output_u32_capacity);
void tn_physics_destroy(TnPhysicsSimulation *simulation);

#ifdef __cplusplus
}
#endif
