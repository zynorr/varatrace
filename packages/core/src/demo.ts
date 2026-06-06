import { buildTraceTree } from "./buildTraceTree.js";
import { renderAsciiTree } from "./renderAsciiTree.js";
import {
  fixtureSimpleCall,
  fixtureReply,
  fixtureFanOut,
  fixtureDeepFailure,
  fixtureReplyChainWithFailure,
  fixtureFanOutWithMixedOutcomes,
} from "./fixtures.js";

const cases: [string, () => { messages: any[]; statuses: any[] }][] = [
  ["1) Simple two-program call", fixtureSimpleCall],
  ["2) Reply (linked via reply.to)", fixtureReply],
  ["3) Three-level fan-out", fixtureFanOut],
  ["4) Deep failure", fixtureDeepFailure],
  ["5) Reply chain with failure", fixtureReplyChainWithFailure],
  ["6) Fan-out with mixed outcomes", fixtureFanOutWithMixedOutcomes],
];

for (const [title, make] of cases) {
  const { messages, statuses } = make();
  const tree = buildTraceTree(messages, statuses);
  console.log("\n" + "=".repeat(64));
  console.log(title);
  console.log("=".repeat(64));
  console.log(renderAsciiTree(tree));
}
console.log("");
