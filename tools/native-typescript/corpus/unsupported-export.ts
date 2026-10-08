// PRD-506: importing a name the catalog does not support fails the native build at compile time,
// naming it, rather than at run time. Upstream three has CatmullRomCurve3; the native engine does not.
// (Raycaster was the name here until PRD-531 implemented it.)
import { CatmullRomCurve3 } from "three";

console.log(new CatmullRomCurve3().closed.toString());
