/** Minimal test-facing declaration for Three's private attribute uploader. */
declare module "three/src/renderers/common/Attributes.js" {
  export default class Attributes {
    constructor(backend: object, info: object);
    update(attribute: object, type: number): void;
  }
}
