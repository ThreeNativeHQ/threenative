// Fail-closed gate over a probe JSON (from `node scripts/capture.mjs probe.html <out.png>`):
// the virtual footprint must land on the analytic centre and on the stock control within
// `tolerance` world units, and the dark-pixel mask must differ from the control by <= 1 %.
import { readFileSync } from 'node:fs';

const [file = 'report/probe.json', tolerance = '0.75'] = process.argv.slice(2);
const payload = JSON.parse(readFileSync(file, 'utf8'));
const probe = payload.debug;
if (!probe || probe.probe !== 'sphere-footprint') {
  console.error('probe payload missing');
  process.exit(2);
}
const limit = Number(tolerance);
const rows = {
  virtualToExpected: probe.virtualToExpected,
  stockToExpected: probe.stockToExpected,
  virtualToStock: probe.virtualToStock,
  changedPixelRatio: probe.changedPixelRatio,
  darkPixelRatio: probe.darkPixelRatio,
};
console.log(JSON.stringify(rows));
const ok = probe.virtualToExpected <= limit
  && probe.virtualToStock <= limit
  && probe.changedPixelRatio <= 0.01
  && probe.virtual.count > 0;
console.log(ok ? `PROBE GREEN (tolerance ${limit})` : `PROBE RED (tolerance ${limit})`);
process.exit(ok ? 0 : 1);
