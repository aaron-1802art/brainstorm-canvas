'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import type {
  Board,
  BoardMember,
  BoardRole,
  CloudSaveStatus,
  CollaboratorPresence,
  RealtimeBoardEvent,
} from '@/lib/types';
import {
  cleanEdges,
  cleanNodes,
  generateOpId,
  generateUuid,
  getCollaboratorColor,
  isValidUuid,
  OpDeduplicator,
} from '@/lib/collaborationUtils';

interface UseCollaborationOptions {
  nodes: Node[];
  edges: Edge[];
  boardTitle: string;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  setBoardTitle: React.Dispatch<React.SetStateAction<string>>;
  pushHistory: (n: Node[], e: Edge[]) => void;
  ready: boolean;
}

export function useCollaboration({
  nodes,
  edges,
  boardTitle,
  setNodes,
  setEdges,
  setBoardTitle,
  pushHistory,
  ready,
}: UseCollaborationOptions) {
  const { user, profile } = useAuth();

  // Active board identity: Initialized to empty string for clean SSR, resolved to UUID on client mount
  const [boardId, setBoardId] = useState<string>('');
  const [userRole, setUserRole] = useState<BoardRole>('owner');
  const [members, setMembers] = useState<BoardMember[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorPresence[]>([]);
  const [saveStatus, setSaveStatus] = useState<CloudSaveStatus>('local');
  const [snapshotVersion, setSnapshotVersion] = useState<number>(1);

  // References
  const channelRef = useRef<RealtimeChannel | null>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const deduplicatorRef = useRef(new OpDeduplicator(300));
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef<number>(0);
  const cursorThrottleRef = useRef<number>(0);
  const clientIdRef = useRef<string>(`client-${Math.random().toString(36).slice(2, 9)}`);
  const activeUserRef = useRef({ user, profile });
  activeUserRef.current = { user, profile };

  const latestDocRef = useRef({ nodes, edges, boardTitle });
  latestDocRef.current = { nodes, edges, boardTitle };

  const isSavingRef = useRef<boolean>(false);
  const hasPendingSaveRef = useRef<boolean>(false);
  const lastSavedContentRef = useRef<string>('');
  const snapshotVersionRef = useRef<number>(snapshotVersion);
  snapshotVersionRef.current = snapshotVersion;

  const saveToCloudRef = useRef<((currentNodes: Node[], currentEdges: Edge[], title: string) => Promise<void>) | null>(null);

  // Unique user styling
  const currentUserColor = getCollaboratorColor(
    user?.id || clientIdRef.current,
  );

  /* ---------------------------------------------------------------- */
  /*  1. Initialize Board ID from URL query param or persistent UUID  */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const qBoard = params.get('board');
    let activeId: string;

    if (qBoard && isValidUuid(qBoard.trim())) {
      activeId = qBoard.trim();
    } else {
      const stored = localStorage.getItem('last_active_board_id');
      if (stored && isValidUuid(stored.trim())) {
        activeId = stored.trim();
      } else {
        activeId = generateUuid();
      }
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('board', activeId);
        window.history.replaceState(null, '', url.toString());
      } catch {
        // Fallback
      }
    }

    try {
      localStorage.setItem('last_active_board_id', activeId);
    } catch {
      // Fallback
    }
    setBoardId(activeId);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  2. Handle Granular Incoming Events (no full board rerenders)    */
  /* ---------------------------------------------------------------- */

  const handleIncomingRealtimeEvent = useCallback(
    (event: RealtimeBoardEvent) => {
      switch (event.type) {
        case 'node:add':
          setNodes((curr) => {
            if (curr.some((n) => n.id === event.node.id)) return curr;
            return [...curr, event.node];
          });
          break;

        case 'node:update':
          setNodes((curr) =>
            curr.map((n) =>
              n.id === event.node.id
                ? {
                    ...n,
                    data: { ...n.data, ...event.node.data },
                    style: event.node.style ? { ...n.style, ...event.node.style } : n.style,
                  }
                : n,
            ),
          );
          break;

        case 'node:move':
          setNodes((curr) =>
            curr.map((n) =>
              n.id === event.id ? { ...n, position: event.position } : n,
            ),
          );
          break;

        case 'node:resize':
          setNodes((curr) =>
            curr.map((n) =>
              n.id === event.id
                ? { ...n, style: { ...n.style, ...event.style } }
                : n,
            ),
          );
          break;

        case 'nodes:delete':
          setNodes((curr) => curr.filter((n) => !event.nodeIds.includes(n.id)));
          if (event.edgeIds && event.edgeIds.length > 0) {
            setEdges((curr) => curr.filter((e) => !event.edgeIds!.includes(e.id)));
          }
          break;

        case 'edge:add':
          setEdges((curr) => {
            if (curr.some((e) => e.id === event.edge.id)) return curr;
            return [...curr, event.edge];
          });
          break;

        case 'edges:delete':
          setEdges((curr) => curr.filter((e) => !event.edgeIds.includes(e.id)));
          break;

        case 'board:title':
          setBoardTitle(event.title);
          break;

        case 'board:full_sync':
          setNodes(event.nodes);
          setEdges(event.edges);
          setSnapshotVersion(event.version);
          break;
      }
    },
    [setNodes, setEdges, setBoardTitle],
  );

  /* ---------------------------------------------------------------- */
  /*  3. Local BroadcastChannel setup for fast same-browser sync      */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!isValidUuid(boardId)) return;
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;

    try {
      const bChan = new BroadcastChannel(`brainstorm-bc-${boardId}`);
      broadcastChannelRef.current = bChan;

      bChan.onmessage = (e: MessageEvent<RealtimeBoardEvent>) => {
        const event = e.data;
        if (!event || !event.opId) return;
        if (deduplicatorRef.current.has(event.opId)) return;
        deduplicatorRef.current.record(event.opId);

        handleIncomingRealtimeEvent(event);
      };

      return () => {
        try {
          bChan.close();
        } catch {
          // Ignore close error
        }
        broadcastChannelRef.current = null;
      };
    } catch {
      // Ignore BroadcastChannel instantiation error in unsupported environments
    }
  }, [boardId, handleIncomingRealtimeEvent]);

  /* ---------------------------------------------------------------- */
  /*  4. Broadcast helper (dispatches via Supabase & BroadcastChannel)*/
  /* ---------------------------------------------------------------- */

  const broadcastEvent = useCallback(
    (event: RealtimeBoardEvent) => {
      deduplicatorRef.current.record(event.opId);

      // Local browser sync
      try {
        broadcastChannelRef.current?.postMessage(event);
      } catch {
        // Ignore BroadcastChannel error
      }

      // Cloud Supabase Realtime broadcast
      const chan = channelRef.current;
      if (chan) {
        chan.send({
          type: 'broadcast',
          event: 'board_action',
          payload: event,
        });
      }
    },
    [],
  );

  /* ---------------------------------------------------------------- */
  /*  5. High-level Action Broadcasters                               */
  /* ---------------------------------------------------------------- */

  const broadcastNodeAdd = useCallback(
    (node: Node) => {
      broadcastEvent({
        type: 'node:add',
        opId: generateOpId(clientIdRef.current),
        userId: user?.id || clientIdRef.current,
        node,
        timestamp: Date.now(),
      });
    },
    [broadcastEvent, user],
  );

  const broadcastNodeUpdate = useCallback(
    (node: Node) => {
      broadcastEvent({
        type: 'node:update',
        opId: generateOpId(clientIdRef.current),
        userId: user?.id || clientIdRef.current,
        node,
        timestamp: Date.now(),
      });
    },
    [broadcastEvent, user],
  );

  const broadcastNodeMove = useCallback(
    (id: string, position: { x: number; y: number }) => {
      broadcastEvent({
        type: 'node:move',
        opId: generateOpId(clientIdRef.current),
        userId: user?.id || clientIdRef.current,
        id,
        position,
        timestamp: Date.now(),
      });
    },
    [broadcastEvent, user],
  );

  const broadcastNodeResize = useCallback(
    (id: string, style: { width?: number; height?: number }) => {
      broadcastEvent({
        type: 'node:resize',
        opId: generateOpId(clientIdRef.current),
        userId: user?.id || clientIdRef.current,
        id,
        style,
        timestamp: Date.now(),
      });
    },
    [broadcastEvent, user],
  );

  const broadcastNodesDelete = useCallback(
    (nodeIds: string[], edgeIds: string[] = []) => {
      broadcastEvent({
        type: 'nodes:delete',
        opId: generateOpId(clientIdRef.current),
        userId: user?.id || clientIdRef.current,
        nodeIds,
        edgeIds,
        timestamp: Date.now(),
      });
    },
    [broadcastEvent, user],
  );

  const broadcastEdgeAdd = useCallback(
    (edge: Edge) => {
      broadcastEvent({
        type: 'edge:add',
        opId: generateOpId(clientIdRef.current),
        userId: user?.id || clientIdRef.current,
        edge,
        timestamp: Date.now(),
      });
    },
    [broadcastEvent, user],
  );

  const broadcastEdgesDelete = useCallback(
    (edgeIds: string[]) => {
      broadcastEvent({
        type: 'edges:delete',
        opId: generateOpId(clientIdRef.current),
        userId: user?.id || clientIdRef.current,
        edgeIds,
        timestamp: Date.now(),
      });
    },
    [broadcastEvent, user],
  );

  const broadcastTitleChange = useCallback(
    (title: string) => {
      broadcastEvent({
        type: 'board:title',
        opId: generateOpId(clientIdRef.current),
        userId: user?.id || clientIdRef.current,
        title,
        timestamp: Date.now(),
      });
    },
    [broadcastEvent, user],
  );

  /* ---------------------------------------------------------------- */
  /*  6. Throttled Live Cursor Broadcasting                           */
  /* ---------------------------------------------------------------- */

  const updateCursor = useCallback(
    (cursorPos: { x: number; y: number } | null) => {
      const now = Date.now();
      if (now - cursorThrottleRef.current < 40) return; // 25fps throttle
      cursorThrottleRef.current = now;

      const chan = channelRef.current;
      if (!chan) return;

      const currentUid = user?.id || clientIdRef.current;
      const currentName =
        profile?.display_name || user?.email?.split('@')[0] || 'Collaborator';

      chan.track({
        userId: currentUid,
        email: user?.email || '',
        displayName: currentName,
        avatarUrl: profile?.avatar_url || null,
        color: currentUserColor,
        cursor: cursorPos,
        lastActive: now,
      });
    },
    [user, profile, currentUserColor],
  );

  /* ---------------------------------------------------------------- */
  /*  7. Supabase Realtime Channel Connection (Presence + Broadcast)  */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !isValidUuid(boardId)) {
      setSaveStatus('local');
      return;
    }

    const chanName = `board-channel:${boardId}`;
    const channel = sb.channel(chanName, {
      config: {
        broadcast: { ack: false, self: false },
        presence: { key: user?.id || clientIdRef.current },
      },
    });

    channelRef.current = channel;

    // Presence sync
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<CollaboratorPresence>();
        const list: CollaboratorPresence[] = [];
        Object.values(state).forEach((presences) => {
          presences.forEach((p) => {
            if (p.userId) list.push(p);
          });
        });
        setCollaborators(list);
      })
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        const joined = (newPresences as unknown as CollaboratorPresence[])[0];
        if (joined && joined.userId !== (user?.id || clientIdRef.current)) {
          // New collaborator joined
        }
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        const left = (leftPresences as unknown as CollaboratorPresence[])[0];
        if (left) {
          setCollaborators((prev) => prev.filter((p) => p.userId !== left.userId));
        }
      })
      // Broadcast messages from remote collaborators
      .on('broadcast', { event: 'board_action' }, ({ payload }) => {
        const event = payload as RealtimeBoardEvent;
        if (!event || !event.opId) return;
        if (deduplicatorRef.current.has(event.opId)) return;
        deduplicatorRef.current.record(event.opId);

        handleIncomingRealtimeEvent(event);
      })
      // Listen to database snapshot insertions from remote collaborators (CDC)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'board_snapshots',
          filter: `board_id=eq.${boardId}`,
        },
        (payload) => {
          const newSnap = payload.new as {
            version: number;
            updated_by: string;
            document: { nodes: Node[]; edges: Edge[]; name?: string };
          };
          if (!newSnap || !newSnap.document) return;
          const currentUid = user?.id || clientIdRef.current;
          if (newSnap.updated_by === currentUid) return;

          if (newSnap.version > snapshotVersionRef.current) {
            snapshotVersionRef.current = newSnap.version;
            setSnapshotVersion(newSnap.version);
            if (newSnap.document.nodes && Array.isArray(newSnap.document.nodes)) {
              setNodes(cleanNodes(newSnap.document.nodes));
            }
            if (newSnap.document.edges && Array.isArray(newSnap.document.edges)) {
              setEdges(cleanEdges(newSnap.document.edges));
            }
            if (newSnap.document.name) {
              setBoardTitle(newSnap.document.name);
            }
            lastSavedContentRef.current = JSON.stringify({
              nodes: cleanNodes(newSnap.document.nodes || []),
              edges: cleanEdges(newSnap.document.edges || []),
              name: newSnap.document.name || '',
            });
            setSaveStatus('saved');
          }
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setSaveStatus((s) => (s === 'offline' ? 'saved' : s));
          // Initial presence track
          channel.track({
            userId: user?.id || clientIdRef.current,
            email: user?.email || '',
            displayName:
              profile?.display_name || user?.email?.split('@')[0] || 'Collaborator',
            avatarUrl: profile?.avatar_url || null,
            color: currentUserColor,
            cursor: null,
            lastActive: Date.now(),
          });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setSaveStatus('offline');
        }
      });

    return () => {
      channel.unsubscribe();
      sb.removeChannel(channel);
      channelRef.current = null;
    };
  }, [boardId, user, profile, currentUserColor, handleIncomingRealtimeEvent, setNodes, setEdges, setBoardTitle]);

  /* ---------------------------------------------------------------- */
  /*  8. Cloud Autosave to `board_snapshots` & Robust Retry Logic     */
  /* ---------------------------------------------------------------- */

  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (retryCountRef.current >= 5) {
      console.warn('Max cloud autosave retries reached. Will retry on next edit or reconnection.');
      return;
    }

    const delay = Math.min(2000 * Math.pow(1.5, retryCountRef.current), 10000);
    retryCountRef.current += 1;

    retryTimerRef.current = setTimeout(() => {
      if (saveToCloudRef.current && latestDocRef.current) {
        const { nodes: n, edges: e, boardTitle: t } = latestDocRef.current;
        saveToCloudRef.current(n, e, t);
      }
    }, delay);
  }, []);

  const saveToCloud = useCallback(
    async (currentNodes: Node[], currentEdges: Edge[], title: string) => {
      const sb = getSupabase();
      if (!sb || !user || !isValidUuid(boardId)) {
        setSaveStatus('local');
        return;
      }

      // Compute content signature
      const sanitizedNodes = cleanNodes(currentNodes);
      const sanitizedEdges = cleanEdges(currentEdges);
      const contentHash = JSON.stringify({
        nodes: sanitizedNodes,
        edges: sanitizedEdges,
        name: title || '',
      });

      // Avoid redundant cloud writes if content has not mutated since last save
      if (contentHash === lastSavedContentRef.current) {
        setSaveStatus('saved');
        return;
      }

      // If a save is already in-flight, mark pending so the next iteration saves latest state
      if (isSavingRef.current) {
        hasPendingSaveRef.current = true;
        return;
      }

      isSavingRef.current = true;
      hasPendingSaveRef.current = false;
      setSaveStatus('saving');

      // 10-second timeout promise to guarantee UI never hangs indefinitely
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<{ timeout: true }>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Cloud save request timed out')), 10000);
      });

      const executeSave = async () => {
        // 1. Ensure the board exists in public.boards so RLS check on snapshots succeeds
        const { data: existingBoard } = await sb
          .from('boards')
          .select('id, owner_id')
          .eq('id', boardId)
          .maybeSingle();

        if (!existingBoard) {
          // Use insert instead of upsert to trigger the correct insert RLS policy
          const { error: insertBoardErr } = await sb.from('boards').insert({
            id: boardId,
            title: title || 'Untitled board',
            owner_id: user.id,
          });
          if (insertBoardErr && insertBoardErr.code !== '23505') {
            console.warn('Failed to insert board:', insertBoardErr.message);
          }
        } else if (title && title.trim()) {
          // Update title if mutated
          await sb.from('boards').update({ title: title.trim() }).eq('id', boardId);
        }

        // 2. Fetch the highest snapshot version in database to avoid unique constraint 23505
        const { data: latestSnap } = await sb
          .from('board_snapshots')
          .select('version')
          .eq('board_id', boardId)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle();

        const currentMaxVersion = Math.max(
          latestSnap?.version || 0,
          snapshotVersionRef.current || 0,
        );
        const nextVersion = currentMaxVersion + 1;

        // 3. Serialize document
        const document = {
          nodes: sanitizedNodes,
          edges: sanitizedEdges,
          name: title,
        };

        // 4. Insert versioned snapshot
        const { error: snapErr } = await sb.from('board_snapshots').insert({
          board_id: boardId,
          document,
          version: nextVersion,
          updated_by: user.id,
        });

        if (snapErr) {
          console.warn('Cloud save snapshot error:', snapErr.message, snapErr.code);
          setSaveStatus('error');
          scheduleRetry();
          return false;
        }

        // Success! Record saved content and update version
        retryCountRef.current = 0;
        lastSavedContentRef.current = contentHash;
        snapshotVersionRef.current = nextVersion;
        setSnapshotVersion(nextVersion);
        setSaveStatus('saved');
        return true;
      };

      try {
        await Promise.race([executeSave(), timeoutPromise]);
      } catch (err) {
        console.warn('Network autosave error:', err);
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setSaveStatus('offline');
        } else {
          setSaveStatus('error');
          scheduleRetry();
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        isSavingRef.current = false;

        // If another mutation occurred while in-flight, process the queued save
        if (hasPendingSaveRef.current && latestDocRef.current) {
          const { nodes: n, edges: e, boardTitle: t } = latestDocRef.current;
          saveToCloudRef.current?.(n, e, t);
        }
      }
    },
    [boardId, user, scheduleRetry],
  );

  saveToCloudRef.current = saveToCloud;

  /* Automatic reconnection sync when online */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      if (saveStatus === 'error' || saveStatus === 'offline') {
        retryCountRef.current = 0;
        if (saveToCloudRef.current && latestDocRef.current) {
          const { nodes: n, edges: e, boardTitle: t } = latestDocRef.current;
          saveToCloudRef.current(n, e, t);
        }
      }
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [saveStatus]);

  /* Trigger debounced autosave when document mutates */
  useEffect(() => {
    if (!ready) return;
    if (userRole === 'viewer') return; // Viewers never autosave to cloud

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveToCloud(nodes, edges, boardTitle);
    }, 1200);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [nodes, edges, boardTitle, ready, userRole, saveToCloud]);

  /* ---------------------------------------------------------------- */
  /*  9. Fetch Initial Snapshot & User Role from Cloud                */
  /* ---------------------------------------------------------------- */

  const fetchMembers = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !isValidUuid(boardId)) return;
    try {
      const { data } = await sb
        .from('board_members')
        .select('id, board_id, user_id, role, joined_at, profiles(display_name, email, avatar_url)')
        .eq('board_id', boardId);

      if (data) {
        const formatted: BoardMember[] = data.map((d: any) => ({
          id: d.id,
          board_id: d.board_id,
          user_id: d.user_id,
          role: d.role,
          joined_at: d.joined_at,
          profile: d.profiles ? {
            id: d.user_id,
            display_name: d.profiles.display_name,
            email: d.profiles.email,
            avatar_url: d.profiles.avatar_url,
          } : undefined,
        }));
        setMembers(formatted);
      }
    } catch {
      // Ignore member listing errors
    }
  }, [boardId]);

  const loadBoardData = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !user || !isValidUuid(boardId)) return;

    try {
      // 1. Check user membership & role
      const { data: memberData } = await sb
        .from('board_members')
        .select('role')
        .eq('board_id', boardId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (memberData) {
        setUserRole(memberData.role as BoardRole);
      } else {
        const { data: boardData } = await sb
          .from('boards')
          .select('owner_id, title')
          .eq('id', boardId)
          .maybeSingle();

        if (boardData && boardData.owner_id === user.id) {
          setUserRole('owner');
        }
      }

      // 2. Fetch latest snapshot
      const { data: snap } = await sb
        .from('board_snapshots')
        .select('document, version')
        .eq('board_id', boardId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (snap && snap.document) {
        const doc = snap.document as { nodes: Node[]; edges: Edge[]; name?: string };
        if (doc.nodes && Array.isArray(doc.nodes)) {
          setNodes(cleanNodes(doc.nodes));
        }
        if (doc.edges && Array.isArray(doc.edges)) {
          setEdges(cleanEdges(doc.edges));
        }
        if (doc.name) {
          setBoardTitle(doc.name);
        }
        if (snap.version) {
          snapshotVersionRef.current = snap.version;
          setSnapshotVersion(snap.version);
        }
        // Mark current content as saved so initial mount doesn't re-save to cloud
        lastSavedContentRef.current = JSON.stringify({
          nodes: cleanNodes(doc.nodes || []),
          edges: cleanEdges(doc.edges || []),
          name: doc.name || '',
        });
        setSaveStatus('saved');
      } else {
        // No snapshot exists in cloud yet for this board: initialize first snapshot
        if (saveToCloudRef.current && latestDocRef.current) {
          const { nodes: n, edges: e, boardTitle: t } = latestDocRef.current;
          saveToCloudRef.current(n, e, t);
        }
      }

      // 3. Fetch board members
      fetchMembers();
    } catch (err) {
      console.warn('Error loading cloud board data:', err);
    }
  }, [boardId, user, setNodes, setEdges, setBoardTitle, fetchMembers]);

  useEffect(() => {
    if (ready && isValidUuid(boardId)) {
      loadBoardData();
    }
  }, [ready, boardId, loadBoardData]);

  /* ---------------------------------------------------------------- */
  /*  10. Sharing & Invites Helper                                    */
  /* ---------------------------------------------------------------- */

  const inviteMember = useCallback(
    async (email: string, role: BoardRole): Promise<string | null> => {
      const sb = getSupabase();
      if (!sb || !user || !isValidUuid(boardId)) return 'Supabase authentication and valid board required to invite';
      try {
        const { error } = await sb.from('board_invites').insert({
          board_id: boardId,
          email: email.trim().toLowerCase(),
          role,
          invited_by: user.id,
        });
        if (error) return error.message;
        fetchMembers();
        return null;
      } catch (err: unknown) {
        return err instanceof Error ? err.message : 'Invitation failed';
      }
    },
    [boardId, user, fetchMembers],
  );

  const removeMember = useCallback(
    async (memberId: string) => {
      const sb = getSupabase();
      if (!sb) return;
      await sb.from('board_members').delete().eq('id', memberId);
      fetchMembers();
    },
    [fetchMembers],
  );

  const updateMemberRole = useCallback(
    async (memberId: string, role: BoardRole) => {
      const sb = getSupabase();
      if (!sb) return;
      await sb.from('board_members').update({ role }).eq('id', memberId);
      fetchMembers();
    },
    [fetchMembers],
  );

  return {
    boardId,
    userRole,
    isReadOnly: userRole === 'viewer',
    collaborators,
    members,
    saveStatus,
    snapshotVersion,
    currentUserColor,
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
    fetchMembers,
  };
}
