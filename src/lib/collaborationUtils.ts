import type { Edge, Node } from '@xyflow/react';

/* ------------------------------------------------------------------ */
/*  Distinct Collaborator Color Generation                            */
/* ------------------------------------------------------------------ */

export const COLLABORATOR_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f97316', // orange
  '#6366f1', // indigo
];

export function getCollaboratorColor(identifier: string): string {
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = (hash << 5) - hash + identifier.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % COLLABORATOR_COLORS.length;
  return COLLABORATOR_COLORS[index];
}

/* ------------------------------------------------------------------ */
/*  Unique Operation ID & Loop Prevention                             */
/* ------------------------------------------------------------------ */

export function generateOpId(clientId: string): string {
  return `op-${Date.now()}-${clientId.slice(0, 6)}-${Math.random().toString(36).slice(2, 7)}`;
}

export class OpDeduplicator {
  private seen = new Set<string>();
  private queue: string[] = [];
  private maxSize: number;

  constructor(maxSize = 250) {
    this.maxSize = maxSize;
  }

  public has(opId: string): boolean {
    return this.seen.has(opId);
  }

  public record(opId: string): boolean {
    if (this.seen.has(opId)) return false;
    this.seen.add(opId);
    this.queue.push(opId);
    if (this.queue.length > this.maxSize) {
      const evicted = this.queue.shift();
      if (evicted) this.seen.delete(evicted);
    }
    return true;
  }
}

/* ------------------------------------------------------------------ */
/*  UUID Validation and Generation                                    */
/* ------------------------------------------------------------------ */

export function isValidUuid(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id.trim());
}

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* ------------------------------------------------------------------ */
/*  Node & Edge Sanitization                                          */
/* ------------------------------------------------------------------ */

export function cleanNode(n: Node): Node {
  const posX = n && n.position && typeof n.position.x === 'number' && !isNaN(n.position.x) ? Math.round(n.position.x) : 0;
  const posY = n && n.position && typeof n.position.y === 'number' && !isNaN(n.position.y) ? Math.round(n.position.y) : 0;
  return {
    id: String(n?.id ?? ''),
    type: n?.type || 'note',
    position: { x: posX, y: posY },
    data: {
      label: String(n?.data?.label ?? ''),
      color: String(n?.data?.color ?? '#fff2b3'),
    },
    style: n?.style ? { ...n.style } : undefined,
    parentId: n?.parentId,
    extent: n?.extent,
  };
}

export function cleanNodes(nodes: Node[]): Node[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.filter(Boolean).map(cleanNode);
}

export function cleanEdge(e: Edge): Edge {
  return {
    id: String(e?.id ?? ''),
    source: String(e?.source ?? ''),
    target: String(e?.target ?? ''),
    sourceHandle: e?.sourceHandle,
    targetHandle: e?.targetHandle,
    style: e?.style ? { ...e.style } : undefined,
  };
}

export function cleanEdges(edges: Edge[]): Edge[] {
  if (!Array.isArray(edges)) return [];
  return edges.filter(Boolean).map(cleanEdge);
}
