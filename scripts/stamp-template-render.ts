import path from "node:path";
import {
  restampSharedRenderCopies,
  templateRoot,
} from "../packages/create-threenative/src/index.js";

const files = await restampSharedRenderCopies(templateRoot());
for (const file of files) process.stdout.write(`stamped ${path.relative(process.cwd(), file)}\n`);
