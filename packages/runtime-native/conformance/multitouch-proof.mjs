/**
 * The simultaneous-touch proof contract, shared by the conformance entry template and the
 * runner tests so neither can drift from the other.
 *
 * `moved` and `leftGround` latch, so on their own they are also satisfied by two sequential
 * one-finger touches. The proof is only satisfied when the scene also reports that the stick
 * half and the jump half were both held **within the same frame** (`simultaneous`) and that
 * two pointers are still down at the moment the proof is read (`pointers`). Both are current
 * observations, not history, which is what makes a sequential two-touch run go red.
 */
export function isMultitouchProofSatisfied(proof) {
  return (
    proof?.moved === true &&
    proof?.leftGround === true &&
    proof?.simultaneous === true &&
    Number.isInteger(proof?.pointers) &&
    proof.pointers >= 2
  );
}
