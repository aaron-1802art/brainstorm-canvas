# Canvas — minimal infinite brainstorming board

A standalone Next.js starter with an infinite React Flow canvas, editable sticky notes, connections, minimap, zoom controls, JSON export, local persistence, and instant same-browser multi-tab sync via `BroadcastChannel`.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000 in two tabs. Add or move notes in one tab; the other tab receives the update. Notes are saved in the browser's local storage.

## Enable cross-device / cross-browser sync

1. Create a Supabase project.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to `.env.local`.
3. The starter uses a Supabase Realtime Broadcast channel (`board-main`) for live cloud broadcasts.
4. For production, add authenticated board rooms, database-backed snapshots, access policies, presence, and reconnect/replay handling. The current MVP does not yet persist a canonical shared board snapshot to Postgres, and anonymous users sharing the same channel should not be used for private boards.

## Current MVP scope

- Infinite pan/zoom canvas with dot grid
- Sticky notes with editable text and colour variants
- Connect notes with edges
- Minimap and zoom controls
- JSON export
- Local browser persistence
- Same-browser multi-tab live sync
- Optional Supabase Realtime broadcast transport scaffold

## Next implementation milestones

- Add true history-aware undo/redo and keyboard shortcuts
- Add shapes, freehand drawing, text blocks, grouping, duplicate/delete
- Add Supabase board snapshots and authenticated collaboration
- Add cursors/presence and conflict-safe collaborative editing (Yjs or equivalent)
- Add PNG/SVG export
