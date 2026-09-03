import path from "node:path";
import {
  discoverStampedTemplates,
  restampTemplateLoadingCopies,
  templateRoot,
} from "../packages/create-threenative/src/index.js";

const root = templateRoot();
const files = await restampTemplateLoadingCopies(root);
for (const [index, template] of discoverStampedTemplates(root).entries()) {
  const file = path.relative(process.cwd(), files[index] ?? "");
  process.stdout.write(`stamped ${template}: ${file}\n`);
}
