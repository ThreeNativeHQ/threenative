// Fresnel/extinction equations adapted from Aureliengmz/clearwater (MIT, Lumaris 2026).
// See CLEARWATER-LICENSE.txt. The same expressions run on TSL scalars and in numeric tests.
export interface IOpticalScalar<T> {
  add(value: number | T): T;
  sub(value: number | T): T;
  mul(value: number | T): T;
  div(value: number | T): T;
  max(value: number): T;
  clamp(min: number, max: number): T;
  sqrt(): T;
  exp(): T;
  oneMinus(): T;
}

/** Exact unpolarized air-to-water dielectric Fresnel; ior > 1 is validated at construction. */
export function dielectricFresnel<T extends IOpticalScalar<T>>(cosine: T, ior: number): T {
  const ci = cosine.clamp(0, 1);
  const ct = ci.mul(ci).oneMinus().div(ior * ior).oneMinus().max(0).sqrt();
  const rs = ci.sub(ct.mul(ior)).div(ci.add(ct.mul(ior)));
  const rp = ci.mul(ior).sub(ct).div(ci.mul(ior).add(ct));
  return rs.mul(rs).add(rp.mul(rp)).mul(0.5);
}

/** coefficient is inverse metres; a zero/negative thickness must never amplify light. */
export function beerLambert<T extends IOpticalScalar<T>>(metres: T, coefficient: number): T {
  return metres.max(0).mul(-coefficient).exp();
}
