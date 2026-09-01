import path from "node:path";
import { checkTemplateQuality, formatTemplateQualityReport } from "./template-quality.js";

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  checkTemplateQuality(process.cwd())
    .then((report) => {
      const output = formatTemplateQualityReport(report);
      if (report.findings.length > 0) {
        console.error(output);
        process.exitCode = 1;
      } else {
        console.log(output);
      }
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
