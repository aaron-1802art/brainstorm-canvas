'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  BackgroundVariant,
  NodeResizer,
  SelectionMode,
  useOnSelectionChange,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
  Handle,
  Position,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import {
  ArrowDownToLine,
  Circle,
  Copy,
  ClipboardPaste,
  Group,
  Hand,
  MousePointer2,
  Palette,
  Redo2,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  Users,
  Share2,
  Lock,
  User as UserIcon,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useCollaboration } from '@/lib/useCollaboration';
import { RemoteCursors } from '@/components/RemoteCursors';
import { AuthModal } from '@/components/AuthModal';
import { ShareModal } from '@/components/ShareModal';
import { cleanNode, cleanNodes } from '@/lib/collaborationUtils';

/* ------------------------------------------------------------------ */
/*  Types & constants                                                 */
/* ------------------------------------------------------------------ */

type NoteData = {
  label: string;
  color: string;
  onLabelChange?: (id: string, label: string) => void;
  onColorChange?: (id: string, color: string) => void;
  selected?: boolean;
};

const palette = ['#fff2b3', '#dcecff', '#e7ddff', '#dff3e4', '#ffe0e0', '#ffffff'];
const MIN_W = 140;
const MIN_H = 100;
const MAX_W = 600;
const MAX_H = 500;

/* ------------------------------------------------------------------ */
/*  NoteNode                                                          */
/* ------------------------------------------------------------------ */

function NoteNode({ id, data, selected }: { id: string; data: NoteData; selected: boolean }) {
  return (
    <div className="note" style={{ background: data.color }}>
      <NodeResizer
        minWidth={MIN_W}
        minHeight={MIN_H}
        maxWidth={MAX_W}
        maxHeight={MAX_H}
        isVisible={selected}
        lineStyle={{ borderColor: 'transparent' }}
        handleStyle={{
          width: 8,
          height: 8,
          background: '#555',
          border: '2px solid #fff',
          borderRadius: 2,
        }}
      />
      <Handle type="target" position={Position.Top} />
      <textarea
        aria-label="Edit note"
        value={data.label}
        onChange={(e) => data.onLabelChange?.(id, e.target.value)}
      />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { note: NoteNode };

const initialNodes: Node[] = [
  {
    id: 'welcome',
    type: 'note',
    position: { x: 100, y: 100 },
    data: { label: 'Start with a thought…', color: '#fff2b3' },
    style: { width: 220, height: 150 },
  },
  {
    id: 'question',
    type: 'note',
    position: { x: 430, y: 230 },
    data: { label: 'What are we trying to solve?', color: '#dcecff' },
    style: { width: 240, height: 150 },
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function uid() {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/* ------------------------------------------------------------------ */
/*  Context Menu component                                            */
/* ------------------------------------------------------------------ */

type MenuPos = { x: number; y: number; nodeId?: string } | null;

function ContextMenu({
  pos,
  onClose,
  onDuplicate,
  onDelete,
  onCopy,
  onPaste,
  onSetColor,
  onGroup,
  onUngroup,
  hasSelection,
  nodeId,
  isReadOnly,
}: {
  pos: MenuPos;
  onClose: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSetColor: (color: string) => void;
  onGroup: () => void;
  onUngroup: () => void;
  hasSelection: boolean;
  nodeId?: string;
  isReadOnly?: boolean;
}) {
  const [showColors, setShowColors] = useState(false);

  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [onClose]);

  if (!pos) return null;

  return (
    <div
      className="ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {!isReadOnly && nodeId && (
        <>
          <button onClick={() => setShowColors(!showColors)}>
            <Palette size={14} /> Change colour
          </button>
          {showColors && (
            <div className="ctx-colors">
              {palette.map((c) => (
                <button
                  key={c}
                  className="color-dot"
                  style={{ background: c }}
                  onClick={() => {
                    onSetColor(c);
                    onClose();
                  }}
                  aria-label={`Set colour ${c}`}
                />
              ))}
            </div>
          )}
        </>
      )}
      {!isReadOnly && (
        <button onClick={() => { onDuplicate(); onClose(); }}>
          <Copy size={14} /> Duplicate {hasSelection ? 'selection' : ''}
        </button>
      )}
      <button onClick={() => { onCopy(); onClose(); }}>
        <Copy size={14} /> Copy
      </button>
      {!isReadOnly && (
        <button onClick={() => { onPaste(); onClose(); }}>
          <ClipboardPaste size={14} /> Paste
        </button>
      )}
      <div className="ctx-divider" />
      {!isReadOnly && hasSelection && (
        <>
          <button onClick={() => { onGroup(); onClose(); }}>
            <Group size={14} /> Group
          </button>
          <button onClick={() => { onUngroup(); onClose(); }}>
            <Ungroup size={14} /> Ungroup
          </button>
          <div className="ctx-divider" />
        </>
      )}
      {!isReadOnly && (
        <button className="ctx-danger" onClick={() => { onDelete(); onClose(); }}>
          <Trash2 size={14} /> Delete
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  BoardInner                                                        */
/* ------------------------------------------------------------------ */

function BoardInner() {
  const { user, profile } = useAuth();
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [activeTool, setActiveTool] = useState<'select' | 'hand'>('select');
  const [boardName, setBoardName] = useState('Untitled board');
  const [editingName, setEditingName] = useState(false);
  const [ready, setReady] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<MenuPos>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  /* Undo / redo stacks */
  const [history, setHistory] = useState<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const [future, setFuture] = useState<{ nodes: Node[]; edges: Edge[] }[]>([]);

  /* Clipboard */
  const clipboardRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);

  /* Selection tracking */
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHistoryRef = useRef<string>('');

  const { screenToFlowPosition } = useReactFlow();

  /* ---------------------------------------------------------------- */
  /*  History helpers                                                 */
  /* ---------------------------------------------------------------- */

  const pushHistory = useCallback(
    (currentNodes: Node[], currentEdges: Edge[]) => {
      const snapshot = JSON.stringify({ nodes: cleanNodes(currentNodes), edges: currentEdges });
      if (snapshot === lastHistoryRef.current) return;
      lastHistoryRef.current = snapshot;
      setHistory((h) => [
        ...h.slice(-49),
        { nodes: cleanNodes(currentNodes), edges: currentEdges },
      ]);
      setFuture([]);
    },
    [],
  );

  const pushHistoryDebounced = useCallback(
    (currentNodes: Node[], currentEdges: Edge[]) => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
      historyTimerRef.current = setTimeout(() => pushHistory(currentNodes, currentEdges), 400);
    },
    [pushHistory],
  );

  /* ---------------------------------------------------------------- */
  /*  Phase 3: Collaboration Hook                                     */
  /* ---------------------------------------------------------------- */

  const {
    boardId,
    userRole,
    isReadOnly,
    collaborators,
    members,
    saveStatus,
    snapshotVersion,
    updateCursor,
    broadcastNodeAdd,
    broadcastNodeUpdate,
    broadcastNodeMove,
    broadcastNodeResize,
    broadcastNodesDelete,
    broadcastEdgeAdd,
    broadcastEdgesDelete,
    broadcastTitleChange,
    inviteMember,
    removeMember,
    updateMemberRole,
  } = useCollaboration({
    nodes,
    edges,
    boardTitle: boardName,
    setNodes,
    setEdges,
    setBoardTitle: setBoardName,
    pushHistory,
    ready,
  });

  /* ---------------------------------------------------------------- */
  /*  Selection change handler                                        */
  /* ---------------------------------------------------------------- */

  useOnSelectionChange({
    onChange: useCallback(({ nodes: selNodes }: { nodes: Node[] }) => {
      setSelectedNodeIds(new Set(selNodes.map((n) => n.id)));
    }, []),
  });

  /* ---------------------------------------------------------------- */
  /*  Undo / Redo                                                     */
  /* ---------------------------------------------------------------- */

  const undo = useCallback(() => {
    if (isReadOnly) return;
    setHistory((h) => {
      if (h.length === 0) return h;
      const previous = h[h.length - 1];
      setFuture((f) => [...f, { nodes: cleanNodes(nodes), edges }]);
      setNodes(previous.nodes);
      setEdges(previous.edges);
      return h.slice(0, -1);
    });
  }, [nodes, edges, isReadOnly]);

  const redo = useCallback(() => {
    if (isReadOnly) return;
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      setHistory((h) => [...h, { nodes: cleanNodes(nodes), edges }]);
      setNodes(next.nodes);
      setEdges(next.edges);
      return f.slice(0, -1);
    });
  }, [nodes, edges, isReadOnly]);

  /* ---------------------------------------------------------------- */
  /*  Node callbacks                                                  */
  /* ---------------------------------------------------------------- */

  const updateLabel = useCallback((id: string, label: string) => {
    if (isReadOnly) return;
    setNodes((current) => {
      const next = current.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, label } } : n,
      );
      const target = next.find((n) => n.id === id);
      if (target) broadcastNodeUpdate(target);
      return next;
    });
  }, [isReadOnly, broadcastNodeUpdate]);

  const updateColor = useCallback(
    (id: string, color: string) => {
      if (isReadOnly) return;
      setNodes((current) => {
        const next = current.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, color } } : n,
        );
        pushHistory(current, edges);
        const target = next.find((n) => n.id === id);
        if (target) broadcastNodeUpdate(target);
        return next;
      });
    },
    [edges, isReadOnly, pushHistory, broadcastNodeUpdate],
  );

  const decoratedNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: { ...n.data, onLabelChange: updateLabel, onColorChange: updateColor },
      })),
    [nodes, updateLabel, updateColor],
  );

  /* ---------------------------------------------------------------- */
  /*  ReactFlow change handlers                                       */
  /* ---------------------------------------------------------------- */

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (isReadOnly) return;
      setNodes((current) => {
        const next = applyNodeChanges(changes, current);
        const hasStructural = changes.some(
          (c) => c.type === 'position' || c.type === 'dimensions' || c.type === 'remove',
        );
        if (hasStructural) {
          pushHistoryDebounced(current, edges);
        }
        return next;
      });
    },
    [edges, isReadOnly, pushHistoryDebounced],
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      if (isReadOnly) return;
      broadcastNodeMove(node.id, node.position);
    },
    [isReadOnly, broadcastNodeMove],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (isReadOnly) return;
      setEdges((current) => applyEdgeChanges(changes, current));
    },
    [isReadOnly],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (isReadOnly) return;
      const newEdge: Edge = {
        ...connection,
        id: `e-${uid()}`,
        animated: false,
        style: { stroke: '#777', strokeWidth: 1.5 },
      };
      setEdges((current) => {
        const next = addEdge(newEdge, current);
        pushHistory(nodes, next);
        broadcastEdgeAdd(newEdge);
        return next;
      });
    },
    [nodes, isReadOnly, pushHistory, broadcastEdgeAdd],
  );

  /* ---------------------------------------------------------------- */
  /*  Add / Duplicate / Delete / Copy / Paste                         */
  /* ---------------------------------------------------------------- */

  const addNote = useCallback(
    (color = palette[0]) => {
      if (isReadOnly) return;
      const id = uid();
      const position = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const newNode: Node = {
        id,
        type: 'note',
        position,
        data: { label: 'Double-click to add an idea', color },
        style: { width: 220, height: 150 },
      };
      setNodes((curr) => {
        const next = [...curr, newNode];
        pushHistory(next, edges);
        broadcastNodeAdd(newNode);
        return next;
      });
    },
    [edges, isReadOnly, pushHistory, screenToFlowPosition, broadcastNodeAdd],
  );

  const getSelectedNodes = useCallback(() => {
    return nodes.filter((n) => selectedNodeIds.has(n.id));
  }, [nodes, selectedNodeIds]);

  const getSelectedEdges = useCallback(() => {
    return edges.filter(
      (e) => selectedNodeIds.has(e.source) && selectedNodeIds.has(e.target),
    );
  }, [edges, selectedNodeIds]);

  const duplicateSelected = useCallback(() => {
    if (isReadOnly) return;
    const sel = getSelectedNodes();
    if (sel.length === 0) return;

    const idMap = new Map<string, string>();
    const newNodes = sel.map((n) => {
      const newId = uid();
      idMap.set(n.id, newId);
      const created: Node = {
        ...n,
        id: newId,
        position: { x: n.position.x + 30, y: n.position.y + 30 },
        selected: false,
        data: { label: String(n.data.label ?? ''), color: String(n.data.color ?? '#fff2b3') },
      };
      broadcastNodeAdd(created);
      return created;
    });

    const selEdges = getSelectedEdges();
    const newEdges = selEdges
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e) => {
        const edgeCreated: Edge = {
          ...e,
          id: `e-${uid()}`,
          source: idMap.get(e.source)!,
          target: idMap.get(e.target)!,
        };
        broadcastEdgeAdd(edgeCreated);
        return edgeCreated;
      });

    const nextNodes = [...nodes, ...newNodes];
    const nextEdges = [...edges, ...newEdges];
    setNodes(nextNodes);
    setEdges(nextEdges);
    pushHistory(nextNodes, nextEdges);
  }, [nodes, edges, isReadOnly, pushHistory, getSelectedNodes, getSelectedEdges, broadcastNodeAdd, broadcastEdgeAdd]);

  const deleteSelected = useCallback(() => {
    if (isReadOnly) return;
    const selIds = Array.from(selectedNodeIds);
    if (selIds.length === 0) return;

    const remaining = nodes.filter((n) => !selectedNodeIds.has(n.id));
    const remainingEdges = edges.filter(
      (e) => !selectedNodeIds.has(e.source) && !selectedNodeIds.has(e.target),
    );
    setNodes(remaining);
    setEdges(remainingEdges);
    pushHistory(remaining, remainingEdges);
    broadcastNodesDelete(selIds);
  }, [nodes, edges, selectedNodeIds, isReadOnly, pushHistory, broadcastNodesDelete]);

  const copySelected = useCallback(() => {
    const sel = getSelectedNodes();
    if (sel.length === 0) return;
    clipboardRef.current = {
      nodes: sel.map(cleanNode),
      edges: getSelectedEdges(),
    };
  }, [getSelectedNodes, getSelectedEdges]);

  const pasteClipboard = useCallback(() => {
    if (isReadOnly) return;
    const clip = clipboardRef.current;
    if (!clip || clip.nodes.length === 0) return;

    const idMap = new Map<string, string>();
    const newNodes = clip.nodes.map((n) => {
      const newId = uid();
      idMap.set(n.id, newId);
      const created: Node = {
        ...n,
        id: newId,
        position: { x: n.position.x + 40, y: n.position.y + 40 },
        selected: false,
      };
      broadcastNodeAdd(created);
      return created;
    });

    const newEdges = clip.edges
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e) => {
        const created: Edge = {
          ...e,
          id: `e-${uid()}`,
          source: idMap.get(e.source)!,
          target: idMap.get(e.target)!,
        };
        broadcastEdgeAdd(created);
        return created;
      });

    const nextNodes = [...nodes, ...newNodes];
    const nextEdges = [...edges, ...newEdges];
    setNodes(nextNodes);
    setEdges(nextEdges);
    pushHistory(nextNodes, nextEdges);
  }, [nodes, edges, isReadOnly, pushHistory, broadcastNodeAdd, broadcastEdgeAdd]);

  /* ---------------------------------------------------------------- */
  /*  Grouping / Ungrouping                                           */
  /* ---------------------------------------------------------------- */

  const groupSelected = useCallback(() => {
    if (isReadOnly) return;
    const sel = getSelectedNodes();
    if (sel.length < 2) return;

    const groupId = `group-${uid()}`;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    sel.forEach((n) => {
      const w = (n.style?.width as number) || 220;
      const h = (n.style?.height as number) || 150;
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + w);
      maxY = Math.max(maxY, n.position.y + h);
    });

    const padding = 30;
    const groupNode: Node = {
      id: groupId,
      type: 'group',
      position: { x: minX - padding, y: minY - padding },
      style: {
        width: maxX - minX + padding * 2,
        height: maxY - minY + padding * 2,
        background: 'rgba(0,0,0,0.03)',
        border: '1.5px dashed #ccc',
        borderRadius: 8,
      },
      data: { label: '', color: '' },
    };

    const updatedNodes = nodes.map((n) => {
      if (selectedNodeIds.has(n.id)) {
        return {
          ...n,
          parentId: groupId,
          position: {
            x: n.position.x - (minX - padding),
            y: n.position.y - (minY - padding),
          },
          extent: 'parent' as const,
        };
      }
      return n;
    });

    const nextNodes = [groupNode, ...updatedNodes];
    setNodes(nextNodes);
    pushHistory(nextNodes, edges);
    broadcastNodeAdd(groupNode);
  }, [nodes, edges, selectedNodeIds, isReadOnly, pushHistory, getSelectedNodes, broadcastNodeAdd]);

  const ungroupSelected = useCallback(() => {
    if (isReadOnly) return;
    const groupIds = new Set<string>();
    nodes.forEach((n) => {
      if (selectedNodeIds.has(n.id) && n.type === 'group') {
        groupIds.add(n.id);
      }
      if (selectedNodeIds.has(n.id) && n.parentId) {
        groupIds.add(n.parentId);
      }
    });

    if (groupIds.size === 0) return;

    const updatedNodes = nodes
      .filter((n) => !groupIds.has(n.id))
      .map((n) => {
        if (n.parentId && groupIds.has(n.parentId)) {
          const parent = nodes.find((p) => p.id === n.parentId);
          return {
            ...n,
            parentId: undefined,
            extent: undefined,
            position: parent
              ? { x: n.position.x + parent.position.x, y: n.position.y + parent.position.y }
              : n.position,
          };
        }
        return n;
      });

    setNodes(updatedNodes);
    pushHistory(updatedNodes, edges);
    broadcastNodesDelete(Array.from(groupIds));
  }, [nodes, edges, selectedNodeIds, isReadOnly, pushHistory, broadcastNodesDelete]);

  /* ---------------------------------------------------------------- */
  /*  Context menu                                                    */
  /* ---------------------------------------------------------------- */

  const onContextMenu = useCallback(
    (event: React.MouseEvent, node?: Node) => {
      event.preventDefault();
      setCtxMenu({ x: event.clientX, y: event.clientY, nodeId: node?.id });
    },
    [],
  );

  const onSetColorFromMenu = useCallback(
    (color: string) => {
      if (!ctxMenu?.nodeId) return;
      updateColor(ctxMenu.nodeId, color);
    },
    [ctxMenu, updateColor],
  );

  /* ---------------------------------------------------------------- */
  /*  Keyboard shortcuts                                              */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (meta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (meta && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }
      if (isInput) return;

      if (meta && e.key === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (meta && e.key === 'c') {
        e.preventDefault();
        copySelected();
        return;
      }
      if (meta && e.key === 'v') {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if (meta && e.key === 'g' && !e.shiftKey) {
        e.preventDefault();
        groupSelected();
        return;
      }
      if (meta && e.key === 'g' && e.shiftKey) {
        e.preventDefault();
        ungroupSelected();
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        deleteSelected();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, duplicateSelected, deleteSelected, copySelected, pasteClipboard, groupSelected, ungroupSelected]);

  /* ---------------------------------------------------------------- */
  /*  Load saved localStorage board initially                         */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const saved = localStorage.getItem('brainstorm-board-v1');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.nodes && parsed.nodes.length > 0) setNodes(parsed.nodes);
        if (parsed.edges) setEdges(parsed.edges);
        if (parsed.name) setBoardName(parsed.name);
      } catch { /* ignore */ }
    }
    setReady(true);
  }, []);

  /* Save to localStorage as resilient offline backup */
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      localStorage.setItem(
        'brainstorm-board-v1',
        JSON.stringify({ nodes: cleanNodes(nodes), edges, name: boardName }),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [nodes, edges, boardName, ready]);

  /* ---------------------------------------------------------------- */
  /*  Export                                                          */
  /* ---------------------------------------------------------------- */

  const exportBoard = useCallback(() => {
    const blob = new Blob(
      [JSON.stringify({ name: boardName, nodes: cleanNodes(nodes), edges }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${boardName.toLowerCase().replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [boardName, nodes, edges]);

  /* ---------------------------------------------------------------- */
  /*  Live Cursor Tracking over Canvas                                */
  /* ---------------------------------------------------------------- */

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      updateCursor(flowPos);
    },
    [screenToFlowPosition, updateCursor],
  );

  const handleCanvasMouseLeave = useCallback(() => {
    updateCursor(null);
  }, [updateCursor]);

  /* ---------------------------------------------------------------- */
  /*  Save status label formatting                                    */
  /* ---------------------------------------------------------------- */

  const getSaveLabel = () => {
    switch (saveStatus) {
      case 'saving':
        return 'Saving to cloud…';
      case 'saved':
        return `Saved (v${snapshotVersion})`;
      case 'offline':
        return 'Offline · Local backup';
      case 'error':
        return 'Sync error · Retrying';
      case 'local':
      default:
        return 'Local sync active';
    }
  };

  const hasSelection = selectedNodeIds.size > 0;

  return (
    <main className="app-shell">
      {/* Top Navigation Bar */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">c</div>
          <span>canvas</span>
          <span className="crumb">/</span>
          {editingName && !isReadOnly ? (
            <input
              autoFocus
              value={boardName}
              onChange={(e) => {
                setBoardName(e.target.value);
                broadcastTitleChange(e.target.value);
              }}
              onBlur={() => setEditingName(false)}
              onKeyDown={(e) => e.key === 'Enter' && setEditingName(false)}
            />
          ) : (
            <button
              className="board-title"
              onClick={() => {
                if (!isReadOnly) setEditingName(true);
              }}
            >
              {boardName}
            </button>
          )}

          {isReadOnly && (
            <span className="view-only-badge">
              <Lock size={12} /> View Only
            </span>
          )}
        </div>

        <div className="top-actions">
          {/* Real-time Save & Sync Indicator */}
          <span className="sync">
            <i className={`sync-dot ${saveStatus}`} />
            {getSaveLabel()}
          </span>

          {/* Collaborator Avatars in Topbar */}
          <div className="collaborators-stack">
            {collaborators.map((c) => (
              <div
                key={c.userId}
                className="collaborator-avatar-bubble"
                style={{ backgroundColor: c.color }}
                title={`${c.displayName} (${c.email || 'Online'})`}
              >
                {(c.displayName || 'C')[0].toUpperCase()}
              </div>
            ))}
          </div>

          {/* Share Button */}
          <button
            className="btn-share"
            onClick={() => setShareModalOpen(true)}
            title="Share board with collaborators"
          >
            <Share2 size={14} />
            <span>Share</span>
          </button>

          {/* Auth Button / Profile Avatar */}
          {user ? (
            <button
              className="btn-auth-user"
              onClick={() => setAuthModalOpen(true)}
              title="Account settings"
            >
              <div className="user-avatar-mini">
                {(profile?.display_name || user.email || 'U')[0].toUpperCase()}
              </div>
              <span>{profile?.display_name?.split(' ')[0] || user.email?.split('@')[0]}</span>
            </button>
          ) : (
            <button
              className="btn-auth-signin"
              onClick={() => setAuthModalOpen(true)}
              title="Sign in to collaborate"
            >
              <UserIcon size={14} />
              <span>Sign in</span>
            </button>
          )}

          {/* Undo / Redo / Export */}
          <button
            className="icon-btn"
            title="Undo (⌘Z)"
            onClick={undo}
            disabled={isReadOnly}
          >
            <Undo2 size={17} />
          </button>
          <button
            className="icon-btn"
            title="Redo (⌘⇧Z)"
            onClick={redo}
            disabled={isReadOnly}
          >
            <Redo2 size={17} />
          </button>
          <button className="icon-btn" title="Export board" onClick={exportBoard}>
            <ArrowDownToLine size={17} />
          </button>
        </div>
      </header>

      {/* Main Canvas Workspace */}
      <div className="workspace">
        {!isReadOnly && (
          <aside className="toolbar" aria-label="Canvas tools">
            <button
              className={`tool ${activeTool === 'select' ? 'active' : ''}`}
              title="Select (V)"
              onClick={() => setActiveTool('select')}
            >
              <MousePointer2 size={18} />
            </button>
            <button
              className={`tool ${activeTool === 'hand' ? 'active' : ''}`}
              title="Pan (H)"
              onClick={() => setActiveTool('hand')}
            >
              <Hand size={18} />
            </button>
            <div className="tool-divider" />
            <button className="tool" title="Add sticky note" onClick={() => addNote()}>
              <StickyNote size={18} />
            </button>
            <button className="tool" title="Add blue note" onClick={() => addNote(palette[1])}>
              <Type size={18} />
            </button>
            <button className="tool" title="Add purple note" onClick={() => addNote(palette[2])}>
              <Circle size={18} />
            </button>
            {hasSelection && (
              <>
                <div className="tool-divider" />
                <button className="tool" title="Duplicate (⌘D)" onClick={duplicateSelected}>
                  <Copy size={18} />
                </button>
                <button className="tool" title="Delete (⌫)" onClick={deleteSelected}>
                  <Trash2 size={18} />
                </button>
              </>
            )}
          </aside>
        )}

        <section
          className="canvas-area"
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={handleCanvasMouseLeave}
        >
          <div className="canvas-hint">
            A quiet space for big ideas <span>·</span> Drag to move, scroll to zoom, connect
            notes by dragging handles
          </div>

          <ReactFlow
            nodes={decoratedNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeContextMenu={(event, node) => onContextMenu(event, node)}
            onPaneContextMenu={(event) => onContextMenu(event as unknown as React.MouseEvent)}
            nodesDraggable={!isReadOnly && activeTool === 'select'}
            nodesConnectable={!isReadOnly && activeTool === 'select'}
            elementsSelectable={!isReadOnly && activeTool === 'select'}
            selectionMode={SelectionMode.Partial}
            selectNodesOnDrag={false}
            selectionOnDrag={!isReadOnly && activeTool === 'select'}
            panOnDrag={activeTool === 'hand' ? true : [1]}
            multiSelectionKeyCode="Shift"
            deleteKeyCode={null}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            minZoom={0.15}
            maxZoom={2.2}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d9d9d5" />
            <Controls showInteractive={false} position="bottom-right" />
            <MiniMap
              position="bottom-left"
              pannable
              zoomable
              nodeColor={(n) => String((n.data as NoteData).color || '#ddd')}
              maskColor="rgba(248,248,246,.65)"
            />
            {/* Live Collaborator Cursors Overlay */}
            <RemoteCursors
              collaborators={collaborators}
              currentUserId={user?.id}
            />
          </ReactFlow>
        </section>
      </div>

      {/* Context Menu */}
      <ContextMenu
        pos={ctxMenu}
        onClose={() => setCtxMenu(null)}
        onDuplicate={duplicateSelected}
        onDelete={deleteSelected}
        onCopy={copySelected}
        onPaste={pasteClipboard}
        onSetColor={onSetColorFromMenu}
        onGroup={groupSelected}
        onUngroup={ungroupSelected}
        hasSelection={hasSelection}
        nodeId={ctxMenu?.nodeId}
        isReadOnly={isReadOnly}
      />

      {/* Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
      />

      {/* Share Modal */}
      <ShareModal
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        boardId={boardId}
        boardTitle={boardName}
        userRole={userRole}
        members={members}
        onInvite={inviteMember}
        onRemoveMember={removeMember}
        onUpdateRole={updateMemberRole}
      />

      {/* Status Bar */}
      <footer className="statusbar">
        <div>
          <span className={`status-dot ${saveStatus}`} />
          {saveStatus === 'saved'
            ? `Cloud synchronized · Board: ${boardId}`
            : saveStatus === 'saving'
            ? 'Saving snapshot to database…'
            : saveStatus === 'error'
            ? 'Sync error · Retrying… (local changes saved)'
            : 'All changes saved locally'}
        </div>
        <div>
          <Users size={14} />{' '}
          {collaborators.length > 1
            ? `${collaborators.length} collaborators active`
            : 'Open in another tab or share link to collaborate'}
        </div>
        <div>Canvas v0.3</div>
      </footer>
    </main>
  );
}

export default function Board() {
  return (
    <ReactFlowProvider>
      <BoardInner />
    </ReactFlowProvider>
  );
}
