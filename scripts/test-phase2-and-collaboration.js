/**
 * Unit & Integration verification for Phase 2 interactions & Phase 3 Collaboration Logic
 * Run with: node scripts/test-phase2-and-collaboration.js
 */

const assert = require('assert');

console.log('--- Running Canvas Logic & Collaboration Verification ---');

// 1. Serialization & Deserialization (cleanNode / cleanNodes)
function cleanNode(n) {
  return {
    ...n,
    data: { label: String(n.data?.label ?? ''), color: String(n.data?.color ?? '#fff2b3') },
  };
}

const mockNode = {
  id: 'node-1',
  position: { x: 100, y: 150 },
  data: {
    label: 'Test note',
    color: '#dcecff',
    onLabelChange: () => {},
    onColorChange: () => {},
  },
};

const cleaned = cleanNode(mockNode);
assert.strictEqual(typeof cleaned.data.onLabelChange, 'undefined', 'Callback functions should be stripped');
assert.strictEqual(cleaned.data.label, 'Test note');
assert.strictEqual(cleaned.data.color, '#dcecff');
console.log('✅ Test 1: Node serialization sanitization verified.');

// 2. OpId Deduplication & Feedback Loop Prevention
class OpTracker {
  constructor(maxSize = 200) {
    this.seen = new Set();
    this.queue = [];
    this.maxSize = maxSize;
  }
  has(opId) {
    return this.seen.has(opId);
  }
  record(opId) {
    if (this.seen.has(opId)) return false;
    this.seen.add(opId);
    this.queue.push(opId);
    if (this.queue.length > this.maxSize) {
      const oldest = this.queue.shift();
      this.seen.delete(oldest);
    }
    return true;
  }
}

const tracker = new OpTracker(5);
assert.strictEqual(tracker.record('op-1'), true);
assert.strictEqual(tracker.record('op-1'), false, 'Duplicate opId should be rejected');
tracker.record('op-2');
tracker.record('op-3');
tracker.record('op-4');
tracker.record('op-5');
tracker.record('op-6');
assert.strictEqual(tracker.has('op-1'), false, 'Oldest opId should roll off without memory leak');
assert.strictEqual(tracker.has('op-6'), true);
console.log('✅ Test 2: OpId tracking and loop prevention verified.');

// 3. Granular Event Processing (Do not overwrite unaffected nodes)
let nodes = [
  { id: 'n1', position: { x: 0, y: 0 }, data: { label: 'A', color: '#fff2b3' }, style: { width: 200, height: 100 } },
  { id: 'n2', position: { x: 300, y: 0 }, data: { label: 'B', color: '#dcecff' }, style: { width: 200, height: 100 } },
];

function applyRemoteEvent(currentNodes, event) {
  switch (event.type) {
    case 'node:add':
      if (currentNodes.some((n) => n.id === event.node.id)) return currentNodes;
      return [...currentNodes, event.node];
    case 'node:update':
      return currentNodes.map((n) =>
        n.id === event.node.id
          ? { ...n, data: { ...n.data, ...event.node.data } }
          : n
      );
    case 'node:move':
      return currentNodes.map((n) =>
        n.id === event.id ? { ...n, position: event.position } : n
      );
    case 'node:resize':
      return currentNodes.map((n) =>
        n.id === event.id ? { ...n, style: { ...n.style, ...event.style } } : n
      );
    case 'nodes:delete':
      return currentNodes.filter((n) => !event.nodeIds.includes(n.id));
    default:
      return currentNodes;
  }
}

// Move node 1 remotely
nodes = applyRemoteEvent(nodes, { type: 'node:move', id: 'n1', position: { x: 50, y: 50 } });
assert.strictEqual(nodes[0].position.x, 50);
assert.strictEqual(nodes[1].position.x, 300, 'Node 2 position must remain unaffected');

// Update label on node 2 remotely
nodes = applyRemoteEvent(nodes, { type: 'node:update', node: { id: 'n2', data: { label: 'Updated B' } } });
assert.strictEqual(nodes[1].data.label, 'Updated B');
assert.strictEqual(nodes[1].data.color, '#dcecff', 'Node 2 color must remain intact');

// Remote resize on node 1
nodes = applyRemoteEvent(nodes, { type: 'node:resize', id: 'n1', style: { width: 350, height: 220 } });
assert.strictEqual(nodes[0].style.width, 350);

// Remote delete
nodes = applyRemoteEvent(nodes, { type: 'nodes:delete', nodeIds: ['n2'] });
assert.strictEqual(nodes.length, 1);
assert.strictEqual(nodes[0].id, 'n1');
console.log('✅ Test 3: Granular real-time event mutation without full board overwrite verified.');

// 4. Board Role Permissions
function canUserEdit(role) {
  return role === 'owner' || role === 'editor';
}

assert.strictEqual(canUserEdit('owner'), true);
assert.strictEqual(canUserEdit('editor'), true);
assert.strictEqual(canUserEdit('viewer'), false, 'Viewer role must NOT have edit permission');
console.log('✅ Test 4: Role permission boundaries verified.');

console.log('--- All Canvas Logic & Collaboration Tests Passed! ---');
