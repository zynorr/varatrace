import type { TraceTree, MessageNode } from "./types.js";

/**
 * Render a TraceTree as a standalone SVG (top-down tree layout).
 * This mirrors what the web app draws with React Flow, but as a static image —
 * useful for docs, share previews, and environments without a browser.
 */
export function renderSvgTree(tree: TraceTree, title = "VaraTrace"): string {
  const NODE_W = 230;
  const NODE_H = 66;
  const H_GAP = 28;
  const V_GAP = 70;
  const PAD = 32;
  const HEADER = 56;

  const nodeById = new Map(tree.nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  for (const e of tree.edges) {
    const list = children.get(e.from) ?? [];
    list.push(e.to);
    children.set(e.from, list);
  }
  const confByPair = new Map(
    tree.edges.map((e) => [`${e.from}->${e.to}`, e.confidence]),
  );
  const failPath = new Set(tree.failure?.path ?? []);

  // Tree layout: assign leaves left-to-right, parents centered over children.
  const pos = new Map<string, { x: number; y: number }>();
  let nextLeafX = 0;
  const layout = (id: string, depth: number): number => {
    const kids = children.get(id) ?? [];
    const y = HEADER + PAD + depth * (NODE_H + V_GAP);
    if (kids.length === 0) {
      const x = nextLeafX * (NODE_W + H_GAP);
      nextLeafX += 1;
      pos.set(id, { x, y });
      return x;
    }
    const xs = kids.map((k) => layout(k, depth + 1));
    const x = (Math.min(...xs) + Math.max(...xs)) / 2;
    pos.set(id, { x, y });
    return x;
  };
  layout(tree.rootId, 0);

  const xsAll = [...pos.values()].map((p) => p.x);
  const ysAll = [...pos.values()].map((p) => p.y);
  const minX = Math.min(...xsAll);
  const contentW = Math.max(...xsAll) - minX + NODE_W;
  const width = Math.max(contentW + 2 * PAD, 560);
  const offsetX = (width - contentW) / 2 - minX;
  for (const p of pos.values()) p.x += offsetX; // center the tree
  const height = Math.max(...ysAll) + NODE_H + PAD + 24;

  const accent = (n: MessageNode) =>
    n.status === "Failed" ? "#dc2626" : n.status === "Success" ? "#16a34a" : "#9ca3af";

  const edgeSvg = tree.edges
    .map((e) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) return "";
      const x1 = a.x + NODE_W / 2;
      const y1 = a.y + NODE_H;
      const x2 = b.x + NODE_W / 2;
      const y2 = b.y;
      const onFail = failPath.has(e.from) && failPath.has(e.to);
      const stroke = onFail ? "#dc2626" : "#94a3b8";
      const dash =
        confByPair.get(`${e.from}->${e.to}`) === "inferred"
          ? ' stroke-dasharray="6 5"'
          : "";
      const midY = (y1 + y2) / 2;
      return `<path d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="${onFail ? 2.5 : 1.5}"${dash}/>`;
    })
    .join("\n");

  const nodeSvg = tree.nodes
    .map((n) => {
      const p = pos.get(n.id);
      if (!p) return "";
      const a = accent(n);
      const onFail = failPath.has(n.id);
      const ring = onFail ? `stroke="#dc2626" stroke-width="2.5"` : `stroke="#e2e8f0" stroke-width="1"`;
      const statusLabel = n.status.toUpperCase();
      return `
  <g transform="translate(${p.x}, ${p.y})">
    <rect width="${NODE_W}" height="${NODE_H}" rx="10" fill="#ffffff" ${ring}/>
    <rect width="6" height="${NODE_H}" rx="3" fill="${a}"/>
    <text x="18" y="24" font-family="ui-monospace, monospace" font-size="13" fill="#0f172a" font-weight="600">${esc(short(n.source))} → ${esc(short(n.destination))}</text>
    <text x="18" y="44" font-family="ui-monospace, monospace" font-size="11" fill="#64748b">msg ${esc(short(n.id))} · blk ${n.blockNumber}</text>
    <text x="${NODE_W - 14}" y="24" text-anchor="end" font-family="ui-sans-serif, sans-serif" font-size="10.5" font-weight="700" fill="${a}">${statusLabel}</text>
    ${n.isReply ? `<text x="${NODE_W - 14}" y="44" text-anchor="end" font-family="ui-sans-serif, sans-serif" font-size="10" fill="#64748b">reply</text>` : ""}
  </g>`;
    })
    .join("\n");

  const failBanner = tree.failure
    ? `<text x="${PAD}" y="${height - 12}" font-family="ui-sans-serif, sans-serif" font-size="12.5" fill="#dc2626" font-weight="600">FAILURE: ${esc(tree.failure.reason)} at ${esc(short(tree.failure.program))}</text>`
    : `<text x="${PAD}" y="${height - 12}" font-family="ui-sans-serif, sans-serif" font-size="12.5" fill="#16a34a" font-weight="600">All messages dispatched successfully</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f8fafc"/>
  <text x="${PAD}" y="34" font-family="ui-sans-serif, sans-serif" font-size="18" font-weight="700" fill="#0f172a">${esc(title)}</text>
  <text x="${width - PAD}" y="34" text-anchor="end" font-family="ui-sans-serif, sans-serif" font-size="11" fill="#64748b">solid = linked · dashed = inferred</text>
${edgeSvg}
${nodeSvg}
  ${failBanner}
</svg>`;
}

function short(hex: string): string {
  if (!hex.startsWith("0x") || hex.length <= 12) return hex;
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}
function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}
