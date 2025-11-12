// server.js
// Simple Express + Socket.io server to serve static client and handle realtime events.

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const rooms = require('./rooms');
const drawingState = require('./drawing-state');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// Serve static client
app.use('/client', express.static(path.join(__dirname, '..', 'client')));

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  // Join a room
  socket.on('join', (data) => {
    const { roomId, user } = data;
    socket.join(roomId);
    rooms.addUser(roomId, socket.id, user);

    // Send current user list
    const users = rooms.listUsers(roomId);
    io.to(roomId).emit('userList', users);

    // Send opLog snapshot to new client
    socket.emit('snapshot', { opLog: drawingState.getOpLog() });
  });

  socket.on('startStroke', (msg) => {
    // startStroke includes initial point and stroke metadata
    // We'll broadcast to room and create a temporary op entry when stroke ends
    socket.to(msg.roomId).emit('startStroke', msg);
  });

  socket.on('strokePoint', (msg) => {
    // broadcast streaming points
    socket.to(msg.roomId).emit('strokePoint', msg);
  });

  socket.on('endStroke', (msg) => {
    // Persist stroke as operation
    const { roomId, user, stroke } = msg;
    const op = drawingState.addStroke(user, stroke);
    // Broadcast endStroke + op metadata
    io.to(roomId).emit('endStroke', { ...msg, opId: op.opId });
    // Send updated opLog snapshot so clients can replay authoritative state
    io.to(roomId).emit('snapshot', { opLog: drawingState.getOpLog() });
  });

  socket.on('cursor', (msg) => {
    socket.to(msg.roomId).emit('cursor', msg);
  });

  socket.on('undo', (msg) => {
    // msg: { roomId, user, targetOpId? }
    // If client supplied targetOpId, use it; otherwise find last undoable op globally.
    let targetOpId = msg.targetOpId;
    if (!targetOpId) {
      const last = drawingState.findLastUndoableOp();
      if (last) targetOpId = last.opId;
    }
    if (!targetOpId) return; // nothing to undo
    const op = drawingState.addUndo(msg.user, targetOpId);
    if (!op) return;
    io.to(msg.roomId).emit('undo', { opId: op.opId, targetOpId: op.payload.targetOpId, user: msg.user });
    io.to(msg.roomId).emit('snapshot', { opLog: drawingState.getOpLog() });
  });

  socket.on('redo', (msg) => {
    // If client didn't specify a targetOpId, pick the most-recently undone stroke
    // (the top of the undo stack) so redo re-applies in the order the user undid.
    let targetOpId = msg.targetOpId;
    if (!targetOpId) {
      const opLog = drawingState.getOpLog();
      // Build an "undo stack" by processing ops in order: push on 'undo', remove on 'redo'
      const stack = [];
      for (const op of opLog) {
        if (op.type === 'undo') stack.push(op.payload.targetOpId);
        else if (op.type === 'redo') {
          // remove the most recent occurrence of this target from the stack
          const idx = stack.lastIndexOf(op.payload.targetOpId);
          if (idx !== -1) stack.splice(idx, 1);
        }
      }
      if (stack.length > 0) targetOpId = stack[stack.length - 1];
    }
    if (!targetOpId) return; // nothing to redo
    const op = drawingState.addRedo(msg.user, targetOpId);
    if (!op) return;
    io.to(msg.roomId).emit('redo', { opId: op.opId, targetOpId: op.payload.targetOpId, user: msg.user });
    io.to(msg.roomId).emit('snapshot', { opLog: drawingState.getOpLog() });
  });

  socket.on('disconnecting', () => {
    // Remove from all rooms
    for (const roomId of socket.rooms) {
      if (roomId === socket.id) continue;
      rooms.removeUser(roomId, socket.id);
      const users = rooms.listUsers(roomId);
      io.to(roomId).emit('userList', users);
    }
  });
});

server.listen(PORT, () => {
  console.log('Server running on port', PORT);
  console.log('Open http://localhost:' + PORT + '/client/index.html');
});
