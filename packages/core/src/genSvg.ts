import { writeFileSync } from "node:fs";
import { buildTraceTree } from "./buildTraceTree.js";
import { renderSvgTree } from "./renderSvgTree.js";
import { fixtureFanOut, fixtureDeepFailure } from "./fixtures.js";

const outDir = process.argv[2] ?? ".";

const fan = buildTraceTree(...Object.values(fixtureFanOut()) as [any, any]);
writeFileSync(
  `${outDir}/varatrace-trace-fanout.svg`,
  renderSvgTree(fan, "VaraTrace — successful fan-out"),
);

const fail = buildTraceTree(...Object.values(fixtureDeepFailure()) as [any, any]);
writeFileSync(
  `${outDir}/varatrace-trace-failure.svg`,
  renderSvgTree(fail, "VaraTrace — failed cross-program call"),
);

console.log("wrote varatrace-trace-fanout.svg and varatrace-trace-failure.svg to", outDir);
