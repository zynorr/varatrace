import type { TraceTree, MessageNode } from "./types.js";

const STATUS_GLYPH: Record<MessageNode["status"], string> = {
  Success: "OK ",
  Failed: "ERR",
  NotExecuted: "...",
};

/**
 * Render a TraceTree as an ASCII tree for CLIs / quick debugging.
 * (The web app renders the same structure with React Flow.)
 */
export function renderAsciiTree(tree: TraceTree): string {
  const nodeById = new Map(tree.nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, { id: string; confidence: string }[]>();
  for (const e of tree.edges) {
    const list = childrenOf.get(e.from) ?? [];
    list.push({ id: e.to, confidence: e.confidence });
    childrenOf.set(e.from, list);
  }

  const lines: string[] = [];

  const walk = (id: string, prefix: string, isLast: boolean, edgeTag: string) => {
    const node = nodeById.get(id);
    if (!node) return;
    const branch = prefix === "" ? "" : isLast ? "└─ " : "├─ ";
    const label = `${short(node.source)} → ${short(node.destination)}`;
    const tag = edgeTag ? ` (${edgeTag})` : "";
    const onPath = tree.failure?.path.includes(id) ? "  <<< failure path" : "";
    lines.push(
      `${prefix}${branch}[${STATUS_GLYPH[node.status]}] ${label}  msg:${short(id)}${tag}${onPath}`,
    );
    const kids = childrenOf.get(id) ?? [];
    const childPrefix = prefix + (prefix === "" ? "" : isLast ? "   " : "│  ");
    kids.forEach((k, i) =>
      walk(k.id, childPrefix, i === kids.length - 1, k.confidence),
    );
  };

  walk(tree.rootId, "", true, "");

  if (tree.failure) {
    lines.push("");
    lines.push(
      `FAILURE: ${tree.failure.reason} at program ${short(tree.failure.program)} (msg ${short(tree.failure.messageId)})`,
    );
  }
  return lines.join("\n");
}

function short(hex: string): string {
  if (!hex.startsWith("0x") || hex.length <= 12) return hex;
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}
