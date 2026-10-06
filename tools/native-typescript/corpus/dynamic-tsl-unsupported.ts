import { float } from "three/tsl";
let refused = false;
try {
  float(1).mod(float(2));
} catch (error) {
  // Missing or differently named errors must fail; a successful operation cannot pass this case.
  if (!String(error).startsWith("TN_TSL_DYNAMIC_UNSUPPORTED ")) throw error;
  refused = true;
}
if (!refused) throw "unsupported dynamic feature did not raise TN_TSL_DYNAMIC_UNSUPPORTED";
console.log("TN_TSL_DYNAMIC_UNSUPPORTED");
