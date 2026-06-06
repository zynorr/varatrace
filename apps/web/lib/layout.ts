import dagre from "dagre";
import type { Edge, Node } from "reactflow";
import { MarkerType } from "reactflow";
import type { TraceTree } from "./types";

export const TRACE_NODE_WIDTH = 240;
export const TRACE_NODE_HEIGHT = 56;

/**
 * Convert a TraceTree into positioned React Flow nodes/edges using a dagre
 * top-down layout. Failure-path elements and inferred edges are styled
 * distinctly. Custom node rendering lives in components/TraceNodeCard.
 */
export function traceToFlow(tree: TraceTree): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 80 });

  for (const n of tree.nodes) {
    g.setNode(n.id, { width: TRACE_NODE_WIDTH, height: TRACE_NODE_HEIGHT });
  }
  for (const e of tree.edges) g.setEdge(e.from, e.to);
  dagre.layout(g);

  const failPath = new Set(tree.failure?.path ?? []);

  const nodes: Node[] = tree.nodes.map((n) => {
    const { x, y } = g.node(n.id);
    return {
      id: n.id,
      type: "trace",
      position: { x: x - TRACE_NODE_WIDTH / 2, y: y - TRACE_NODE_HEIGHT / 2 },
      width: TRACE_NODE_WIDTH,
      height: TRACE_NODE_HEIGHT,
      data: { node: n, onFailPath: failPath.has(n.id) },
    };
  });

  const edges: Edge[] = tree.edges.map((e) => {
    const fromFail = failPath.has(e.from);
    const toFail = failPath.has(e.to);
    const onFailEdge = fromFail && toFail;
    const isInferred = e.confidence === "inferred";

    return {
      id: `${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      type: "smoothstep",
      animated: onFailEdge,
      label: isInferred ? "inferred" : undefined,
      labelStyle: {
        fontSize: 10,
        fill: onFailEdge ? "var(--edge-fail)" : "var(--edge-color)",
        fontWeight: onFailEdge ? 600 : 400,
      },
      labelBgStyle: {
        fill: "var(--bg-primary)",
      },
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 3,
      style: {
        stroke: onFailEdge ? "var(--edge-fail)" : isInferred ? "var(--edge-inferred)" : "var(--edge-color)",
        strokeWidth: onFailEdge ? 2.5 : isInferred ? 1.5 : 2,
        strokeDasharray: isInferred ? "6 4" : undefined,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: onFailEdge ? 18 : 14,
        height: onFailEdge ? 18 : 14,
        color: onFailEdge ? "var(--edge-fail)" : isInferred ? "var(--edge-inferred)" : "var(--edge-color)",
      },
    };
  });

  return { nodes, edges };
}
