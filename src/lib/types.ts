import type { Edge, Node } from '@xyflow/react';

/* ------------------------------------------------------------------ */
/*  User & Profile Types                                              */
/* ------------------------------------------------------------------ */

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  created_at?: string;
  updated_at?: string;
}

/* ------------------------------------------------------------------ */
/*  Board & Member Types                                              */
/* ------------------------------------------------------------------ */

export type BoardRole = 'owner' | 'editor' | 'viewer';

export interface Board {
  id: string;
  title: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface BoardMember {
  id: string;
  board_id: string;
  user_id: string;
  role: BoardRole;
  joined_at: string;
  profile?: Profile;
}

export interface BoardInvite {
  id: string;
  board_id: string;
  email: string;
  role: BoardRole;
  invited_by: string;
  created_at: string;
}

export interface BoardDocument {
  nodes: Node[];
  edges: Edge[];
  name?: string;
}

export interface BoardSnapshot {
  id: string;
  board_id: string;
  document: BoardDocument;
  version: number;
  updated_at: string;
  updated_by: string | null;
}

/* ------------------------------------------------------------------ */
/*  Collaboration & Realtime Presence                                 */
/* ------------------------------------------------------------------ */

export interface CollaboratorPresence {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  color: string;
  cursor: { x: number; y: number } | null;
  lastActive: number;
}

export type CloudSaveStatus = 'saving' | 'saved' | 'offline' | 'error' | 'local';

/* Granular real-time event types to prevent full-board overwrites */
export type RealtimeBoardEvent =
  | {
      type: 'node:add';
      opId: string;
      userId: string;
      node: Node;
      timestamp: number;
    }
  | {
      type: 'node:update';
      opId: string;
      userId: string;
      node: Node;
      timestamp: number;
    }
  | {
      type: 'node:move';
      opId: string;
      userId: string;
      id: string;
      position: { x: number; y: number };
      timestamp: number;
    }
  | {
      type: 'node:resize';
      opId: string;
      userId: string;
      id: string;
      style: { width?: number; height?: number };
      timestamp: number;
    }
  | {
      type: 'nodes:delete';
      opId: string;
      userId: string;
      nodeIds: string[];
      edgeIds?: string[];
      timestamp: number;
    }
  | {
      type: 'edge:add';
      opId: string;
      userId: string;
      edge: Edge;
      timestamp: number;
    }
  | {
      type: 'edges:delete';
      opId: string;
      userId: string;
      edgeIds: string[];
      timestamp: number;
    }
  | {
      type: 'board:title';
      opId: string;
      userId: string;
      title: string;
      timestamp: number;
    }
  | {
      type: 'board:full_sync';
      opId: string;
      userId: string;
      nodes: Node[];
      edges: Edge[];
      version: number;
      timestamp: number;
    };
