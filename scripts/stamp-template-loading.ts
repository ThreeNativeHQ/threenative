import path from "node:path";
import {
  FULL_LOADING_TEMPLATES,
  restampTemplateLoadingCopies,
  templateRoot,
} from "../packages/create-threenative/src/index.js";

const root = templateRoot();
const files = await restampTemplateLoadingCopies(root);
for (const [index, template] of FULL_LOADING_TEMPLATES.entries()) {
  const file = path.relative(process.cwd(), files[index] ?? "");
  process.stdout.write(`stamped ${template}: ${file}\n`);
}
