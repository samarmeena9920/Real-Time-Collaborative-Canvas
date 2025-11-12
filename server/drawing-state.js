// drawing-state.js
// Maintains an append-only operation log (opLog) and exposes methods
// to append operations, apply undo/redo as compensating ops, and rebuild
// canvas state by replaying the op log.

const { v4: uuidv4 } = require('uuid');

// Each operation has shape:
// { opId, type, user, ts, payload }
// where type is 'stroke' | 'undo' | 'redo' | 'snapshot'

const opLog = [];
// For stack-based undo/redo semantics we keep explicit stacks
const undoStack = []; // stores stroke ops in visible timeline order
const redoStack = []; // stores undone stroke ops (LIFO)

function newOp(type, user, payload = {}) {
  return {
    opId: uuidv4(),
    type,
    user,
    ts: Date.now(),
    payload
  };
}

function appendOp(op) {
  opLog.push(op);
}

function addStroke(user, stroke) {
  const op = newOp('stroke', user, { stroke });
  appendOp(op);
  // push to undo stack and clear redo stack (new action invalidates redo history)
  undoStack.push(op);
  redoStack.length = 0;
  return op;
}

function addUndo(user, targetOpId) {
  // If no target provided, pop the top of undoStack
  let targetOp = null;
  if (!targetOpId) {
    if (undoStack.length === 0) return null;
    targetOp = undoStack.pop();
  } else {
    // find the most-recent occurrence in undoStack and remove it
    for (let i = undoStack.length - 1; i >= 0; i--) {
      if (undoStack[i].opId === targetOpId) { targetOp = undoStack.splice(i,1)[0]; break; }
    }
    if (!targetOp) return null; // nothing to undo
  }
  // push into redo stack
  redoStack.push(targetOp);
  const op = newOp('undo', user, { targetOpId: targetOp.opId });
  appendOp(op);
  return op;
}

function addRedo(user, targetOpId) {
  // If no target provided, pop from redoStack
  let targetOp = null;
  if (!targetOpId) {
    if (redoStack.length === 0) return null;
    targetOp = redoStack.pop();
  } else {
    // find the most-recent occurrence in redoStack and remove it
    for (let i = redoStack.length - 1; i >= 0; i--) {
      if (redoStack[i].opId === targetOpId) { targetOp = redoStack.splice(i,1)[0]; break; }
    }
    if (!targetOp) return null;
  }
  // push back onto undoStack
  undoStack.push(targetOp);
  const op = newOp('redo', user, { targetOpId: targetOp.opId });
  appendOp(op);
  return op;
}

function getOpLog() {
  // Return the append-only opLog for auditing and client snapshots.
  return opLog;
}

// Replay opLog to compute list of effective strokes in order.
// This returns an array of strokes to draw: each item {opId, user, stroke}
function replay() {
  // We'll maintain a map of original stroke ops so redo can re-insert a
  // previously undone stroke at the point the redo occurs (chronological redo).
  const strokes = [];
  const strokeMap = new Map();

  for (const op of opLog) {
    if (op.type === 'stroke') {
      const item = { opId: op.opId, user: op.user, stroke: op.payload.stroke };
      strokeMap.set(op.opId, item);
      strokes.push(item);
    } else if (op.type === 'undo') {
      // remove the most-recent occurrence of the target stroke from current timeline (LIFO)
      const target = op.payload.targetOpId;
      for (let i = strokes.length - 1; i >= 0; i--) {
        if (strokes[i].opId === target) { strokes.splice(i, 1); break; }
      }
    } else if (op.type === 'redo') {
      // re-insert the target stroke at this position in timeline
      const target = op.payload.targetOpId;
      const s = strokeMap.get(target);
      if (s) strokes.push(s);
    }
  }

  return strokes;
}

// Find last stroke op that is not undone yet (for global undo semantics)
function findLastUndoableOp() {
  // If we have an explicit undoStack, the last visible stroke is its top.
  if (undoStack.length === 0) return null;
  const top = undoStack[undoStack.length - 1];
  // return the opLog entry matching this opId
  for (let i = opLog.length - 1; i >= 0; i--) {
    if (opLog[i].opId === top.opId) return opLog[i];
  }
  return null;
}

module.exports = { newOp, appendOp, addStroke, addUndo, addRedo, getOpLog, replay, findLastUndoableOp };
