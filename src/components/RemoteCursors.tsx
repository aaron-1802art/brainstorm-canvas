'use client';

import React from 'react';
import { useViewport } from '@xyflow/react';
import type { CollaboratorPresence } from '@/lib/types';

interface RemoteCursorsProps {
  collaborators: CollaboratorPresence[];
  currentUserId?: string;
}

export function RemoteCursors({ collaborators, currentUserId }: RemoteCursorsProps) {
  const { x: vpX, y: vpY, zoom } = useViewport();

  // Filter out self and collaborators without active cursor
  const activeRemoteCursors = collaborators.filter(
    (c) => c.userId !== currentUserId && c.cursor && c.cursor.x !== null && c.cursor.y !== null,
  );

  if (activeRemoteCursors.length === 0) return null;

  return (
    <div
      className="remote-cursors-layer"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 10,
        overflow: 'hidden',
      }}
    >
      {activeRemoteCursors.map((collab) => {
        if (!collab.cursor) return null;

        // Transform flow coordinates to screen/viewport coordinates
        const screenX = collab.cursor.x * zoom + vpX;
        const screenY = collab.cursor.y * zoom + vpY;

        return (
          <div
            key={collab.userId}
            className="remote-cursor"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: `translate3d(${screenX}px, ${screenY}px, 0)`,
              transition: 'transform 0.08s cubic-bezier(0, 0, 0.2, 1)',
              pointerEvents: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
            }}
          >
            {/* Custom SVG Cursor Arrow */}
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill={collab.color}
              stroke="#ffffff"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))',
                transform: 'rotate(-25deg)',
                transformOrigin: 'top left',
              }}
            >
              <polygon points="3 3 10 21 13 14 20 11 3 3" />
            </svg>

            {/* Collaborator Name Tag */}
            <div
              className="cursor-badge"
              style={{
                marginLeft: 14,
                marginTop: -4,
                backgroundColor: collab.color,
                color: '#ffffff',
                fontSize: 11,
                fontWeight: 500,
                padding: '2px 8px',
                borderRadius: 9999,
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                userSelect: 'none',
              }}
            >
              {collab.displayName || 'Collaborator'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
