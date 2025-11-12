# ARCHITECTURE

Data flow

Client -> Server via Socket.io messages: startStroke, strokePoint, endStroke, cursor, undo, redo, requestSnapshot.

Server keeps append-only opLog. New clients receive `snapshot` containing full opLog and replay it client-side.

WebSocket protocol (sample messages)

{ "type": "startStroke", "id":"strokeId", "user":"u1", "color":"#ff0", "width":4, "point":{ "x":10,"y":20 } }
{ "type": "strokePoint", "id":"strokeId", "point":{ "x":11,"y":21 }, "ts": 1690000000 }
{ "type": "endStroke", "id":"strokeId" }
{ "type": "cursor", "user":"u1", "x":100, "y":200 }
{ "type": "undo", "user":"u1", "targetOperationId": "op123" }

Undo/Redo strategy and op-log schema

The server keeps an append-only `opLog` for auditing and for new clients to replay. To provide correct, global LIFO undo/redo semantics the server also maintains two stacks:

- `undoStack`: the current visible timeline (performed stroke ops). The top of this stack is the most-recent visible stroke.
- `redoStack`: operations that were undone (LIFO). Redo pops from this stack.

Each operation in `opLog` is serialized as:

```
{
  opId: string,
  type: 'stroke' | 'undo' | 'redo',
  user: { id, name, color },
  ts: number,
  payload: { stroke? , targetOpId? }
}
```

Server-side stack semantics

- `addStroke(user, stroke)`: append a `'stroke'` op to `opLog`, push the op onto `undoStack`, and clear `redoStack` (new actions invalidate redo history).
- `addUndo(user, targetOpId?)`: if `targetOpId` is omitted, pop the top of `undoStack`; otherwise locate and remove the most-recent occurrence of `targetOpId` in `undoStack`. Push the removed op onto `redoStack`. Append an `'undo'` op to `opLog` with `payload.targetOpId`.
- `addRedo(user, targetOpId?)`: if `targetOpId` is omitted, pop the top of `redoStack`; otherwise locate and remove the most-recent occurrence of `targetOpId` in `redoStack`. Push the removed op back onto `undoStack`. Append a `'redo'` op to `opLog` with `payload.targetOpId`.

Why both stacks and opLog?

- The `opLog` remains append-only so new clients can receive the full history and the system keeps a durable audit trail.
- The `undoStack`/`redoStack` encode current timeline semantics and make Undo/Redo deterministic and LIFO (like desktop editors). The server updates stacks as operations occur and also appends companion `'undo'`/`redo'` ops to `opLog` so the full history is preserved and replayable.

Client replay rules (mirror server)

- When a client receives a `snapshot` (the `opLog`) it reconstructs visible strokes in the same way the server's `replay()` does:
  - process `'stroke'` ops: add stroke to a map and append to the visible timeline
  - process `'undo'` ops: remove the most-recent occurrence of `payload.targetOpId` from the visible timeline (LIFO semantics)
  - process `'redo'` ops: re-insert (append) the referenced stroke into the visible timeline at the spot the `'redo'` op occurs

This keeps clients and server consistent even though the `opLog` accumulates history and strokes may have multiple visible occurrences (after redo).

Bug fixed (why redo previously returned the wrong op)

- Symptom: after undoing multiple strokes (e.g., 7,6,5), calling redo sometimes restored 7 instead of 5. The root cause was selecting a target by scanning `opLog` for any undone stroke; that approach didn't preserve the order in which undos were applied.
- Fix: implement explicit `undoStack` and `redoStack` on the server and update them on every stroke/undo/redo. Redo now pops the top of `redoStack` (the last undone op) so reapplication order is the same order in which strokes were undone (LIFO). The client was also updated to compute a redo target from the `opLog` snapshot using the same stack-construction (push on `'undo'`, remove on `'redo'`) and now sends explicit `targetOpId` when invoking redo; the server still handles empty-redo requests as a fallback using server stacks.

This combination ensures global, stack-based undo/redo that behaves like typical drawing apps.

Conflict resolution

- Deterministic, order-based: operations apply in server-received order. Later ops paint over earlier ones.
- Overlapping strokes: later stroke in op order will visually appear on top.
- If User A undoes User B's stroke, the undo op is global and removes that stroke from replay for all users.

Performance decisions

- Client throttles strokePoint to ~30ms and batches drawing locally for smoothing.
- Simple quadratic bezier smoothing on client.
- Server does minimal processing and stores full stroke payload (meta + sampled points). For scaling, use snapshots to avoid replaying huge logs on join.

Scaling plan

- Use Redis/Socket.io adapter to scale socket servers and share opLog state or persist opLog to a database and use pub/sub for broadcasting new ops.
- Snapshotting: periodically store a bitmap or summarized state to accelerate join.

Security

- Rate-limit strokePoint and message sizes; validate payloads server-side.

Rationale for Socket.io

Socket.io provides robust reconnection, binary transports fallback, and room abstractions which speed up development. It simplifies common WebSocket pitfalls and is acceptable per requirements.
