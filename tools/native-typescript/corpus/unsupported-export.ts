// PRD-506: importing a name the catalog does not support fails the native build at compile time,
// naming it, rather than at run time. Upstream three has Raycaster; the native engine does not.
import { Raycaster } from "three";

console.log(new Raycaster().near.toString());
