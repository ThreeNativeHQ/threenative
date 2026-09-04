import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type BridgeResult, blenderScriptsDirectory, runBlenderScript } from "./bridge.js";

/**
 * The shipped bpy recipes: what they do, and their own source text.
 *
 * `blender_recipes` returns the **text**, not just a name, because an agent that can read a working
 * recipe adapts it into its own game; one that gets a name has to write bpy cold. Same shape as
 * the sculpt server's grimoire.
 *
 * The appearance boundary holds here. `decimate` changes how much geometry there is; `unwrap`
 * computes a parameterisation; `bake_ao` computes occlusion from geometry; `retarget` renames
 * tracks. None of them picks a material, colour, light, curve or timing — those belong to the
 * game's `src/render/`.
 */

export interface IRecipeParameter {
  readonly description: string;
  readonly name: string;
  readonly required: boolean;
}

export interface IRecipe {
  readonly description: string;
  readonly name: string;
  readonly parameters: readonly IRecipeParameter[];
  /** The file under `gpl/recipes/`. */
  readonly script: string;
}

const PATH_PARAMETERS: readonly IRecipeParameter[] = [
  { description: "Path to the model to read.", name: "source", required: true },
  { description: "Path of the file to write.", name: "out", required: true },
];

export const RECIPES: readonly IRecipe[] = Object.freeze([
  Object.freeze({
    description:
      "Reduce triangle count to a requested fraction, preserving materials, UVs and rig. Reports trianglesBefore, trianglesAfter and achievedRatio.",
    name: "decimate",
    parameters: Object.freeze([
      ...PATH_PARAMETERS,
      {
        description: "Target fraction of the original triangles, 0 < ratio <= 1. Default 0.5.",
        name: "ratio",
        required: false,
      },
    ]),
    script: "decimate.py",
  }),
  Object.freeze({
    description:
      "Give meshes a UV layer they do not have, so they can carry a texture or a lightmap. Reports uvLayersBefore and uvLayersAfter.",
    name: "unwrap",
    parameters: Object.freeze([
      ...PATH_PARAMETERS,
      {
        description: "Smart-project angle limit in degrees. Default 66.",
        name: "angleLimit",
        required: false,
      },
      { description: "Island margin. Default 0.02.", name: "islandMargin", required: false },
      {
        description: "Only unwrap meshes with no UV layer at all. Default true.",
        name: "onlyMissing",
        required: false,
      },
    ]),
    script: "unwrap.py",
  }),
  Object.freeze({
    description:
      "Bake ambient occlusion — computed from geometry — into a PNG. Reports the baked image's mean, min and max luminance.",
    name: "bake_ao",
    parameters: Object.freeze([
      ...PATH_PARAMETERS,
      { description: "Square texture size in pixels. Default 256.", name: "size", required: false },
      { description: "Cycles samples. Default 16.", name: "samples", required: false },
    ]),
    script: "bake_ao.py",
  }),
  Object.freeze({
    description:
      "Move animation clips from one armature's bone names onto another's. Fails when a clip resolves no track on the destination armature.",
    name: "retarget",
    parameters: Object.freeze([
      { description: "Model carrying the clips to move.", name: "source", required: true },
      { description: "Model whose armature receives them.", name: "target", required: true },
      { description: "Path of the .glb to write.", name: "out", required: true },
      {
        description: "Object mapping source bone name to destination bone name.",
        name: "map",
        required: true,
      },
    ]),
    script: "retarget.py",
  }),
]);

export function recipeNames(): readonly string[] {
  return RECIPES.map((recipe) => recipe.name);
}

export function findRecipe(name: unknown): IRecipe {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("blender_recipes requires a string 'name' argument, or none to list them all.");
  }
  const recipe = RECIPES.find((candidate) => candidate.name === name);
  if (recipe === undefined) {
    throw new Error(`Unknown recipe '${name}'. Shipped recipes: ${recipeNames().join(", ")}.`);
  }
  return recipe;
}

/** The absolute path of a recipe's script, which is also what `blender_run_python` may be handed. */
export function recipePath(recipe: IRecipe, environment: NodeJS.ProcessEnv = process.env): string {
  return path.join(blenderScriptsDirectory(environment), "recipes", recipe.script);
}

/** A recipe's own source. Fails closed: a recipe listed but not shipped is a packaging defect. */
export function recipeSource(
  recipe: IRecipe,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const file = recipePath(recipe, environment);
  if (!existsSync(file)) {
    throw new Error(`TN_BLENDER_RECIPE_MISSING: recipe '${recipe.name}' has no script at ${file}.`);
  }
  return readFileSync(file, "utf8");
}

export async function runRecipe(
  name: unknown,
  request: Record<string, unknown>,
  options: { readonly environment?: NodeJS.ProcessEnv; readonly timeoutMs?: number } = {},
): Promise<BridgeResult> {
  const recipe = findRecipe(name);
  const environment = options.environment ?? process.env;
  const script = recipePath(recipe, environment);
  if (!existsSync(script)) {
    throw new Error(
      `TN_BLENDER_RECIPE_MISSING: recipe '${recipe.name}' has no script at ${script}.`,
    );
  }
  for (const parameter of recipe.parameters) {
    if (!parameter.required) continue;
    if (request[parameter.name] === undefined) {
      throw new Error(`Recipe '${recipe.name}' requires the '${parameter.name}' argument.`);
    }
  }
  return runBlenderScript(script, request, options);
}
