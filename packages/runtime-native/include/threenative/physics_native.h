#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct TnPhysicsProofSimulation TnPhysicsProofSimulation;

typedef struct TnPhysicsProofOptions {
    float gravity_x;
    float gravity_y;
    float gravity_z;
    uint32_t floor_collision_layer;
    uint32_t floor_collision_mask;
    uint32_t cube_collision_layer;
    uint32_t cube_collision_mask;
} TnPhysicsProofOptions;

const char* tn_physics_version(void);
TnPhysicsProofSimulation* tn_physics_proof_create(const TnPhysicsProofOptions* options);
bool tn_physics_proof_step(TnPhysicsProofSimulation* simulation, float delta_time);
int32_t tn_physics_proof_read_visible_transforms(
    const TnPhysicsProofSimulation* simulation,
    float* output,
    size_t output_float_capacity
);
int32_t tn_physics_proof_drain_collision_events(
    TnPhysicsProofSimulation* simulation,
    uint32_t* output,
    size_t output_u32_capacity
);
void tn_physics_proof_destroy(TnPhysicsProofSimulation* simulation);

#ifdef __cplusplus
}
#endif
