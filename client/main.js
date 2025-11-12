// main.js
// Wire up UI, canvas, and websocket

(() => {
  const serverUrl = window.location.origin; // assumes same origin
  const roomId = new URLSearchParams(window.location.search).get('room') || 'default';
  const user = { id: 'u-' + Math.floor(Math.random() * 10000), name: 'User' + Math.floor(Math.random() * 1000), color: randomColor() };

  const socket = io(serverUrl);
  socket.on('connect', () => {
    socket.emit('join', { roomId, user });
  });

  const canvasEl = document.getElementById('canvas');
  const drawing = new DrawingCanvas(canvasEl);
  let latestOpLog = [];

  const colorPicker = document.getElementById('colorPicker');
  const widthRange = document.getElementById('widthRange');
  const brushBtn = document.getElementById('brushBtn');
  const eraserBtn = document.getElementById('eraserBtn');
  const highlighterBtn = document.getElementById('highlighterBtn');
  const dashedBtn = document.getElementById('dashedBtn');
  const dottedBtn = document.getElementById('dottedBtn');
  const solidBtn = document.getElementById('solidBtn');
  const redoBtn = document.getElementById('redoBtn');
  const undoBtn = document.getElementById('undoBtn');
  const usersDiv = document.getElementById('users');

  let tool = 'brush';
  let shapeMode = null; // 'rect' | 'circle' | 'line'

  // header button active management
  const headerButtons = [brushBtn, eraserBtn, highlighterBtn, dashedBtn, dottedBtn, solidBtn];
  function clearHeaderActive() {
    headerButtons.forEach(b => b.classList.remove('active'));
  }
  function setHeaderActive(btn) {
    clearHeaderActive();
    if (btn) btn.classList.add('active');
  }
  // ensure selecting a header tool clears any active shape selection
  const originalSetHeaderActive = setHeaderActive;
  setHeaderActive = (btn) => {
    originalSetHeaderActive(btn);
    if (btn) {
      document.querySelectorAll('.shape-btn.active').forEach(x=>x.classList.remove('active'));
    }
  };

  brushBtn.onclick = () => { tool = 'brush'; setHeaderActive(brushBtn); /* clear shape selection */ document.querySelectorAll('.shape-btn.active').forEach(x=>x.classList.remove('active')); };
  eraserBtn.onclick = () => { tool = 'eraser'; setHeaderActive(eraserBtn); document.querySelectorAll('.shape-btn.active').forEach(x=>x.classList.remove('active')); };
  // initial header active
  setHeaderActive(brushBtn);
  // toolbar toggles
  let isHighlighter = false, isDashed = false, isDotted = false;
  highlighterBtn.onclick = () => { isHighlighter = !isHighlighter; highlighterBtn.classList.toggle('active', isHighlighter); setHeaderActive(isHighlighter ? highlighterBtn : brushBtn); if (isHighlighter) tool = 'brush'; };
  dashedBtn.onclick = () => {
    isDashed = !isDashed;
    if (isDashed) {
      isDotted = false; dottedBtn.classList.remove('active');
      setHeaderActive(dashedBtn);
    } else {
      setHeaderActive(brushBtn);
    }
    dashedBtn.classList.toggle('active', isDashed);
  };
  dottedBtn.onclick = () => {
    isDotted = !isDotted;
    if (isDotted) {
      isDashed = false; dashedBtn.classList.remove('active');
      setHeaderActive(dottedBtn);
    } else {
      setHeaderActive(brushBtn);
    }
    dottedBtn.classList.toggle('active', isDotted);
  };
  solidBtn.onclick = () => {
    // explicit solid/complete line: clear dashed/dotted
    isDashed = false; isDotted = false;
    dashedBtn.classList.remove('active'); dottedBtn.classList.remove('active');
    setHeaderActive(solidBtn);
  };
  
  undoBtn.onclick = () => socket.emit('undo', { roomId, user });
  redoBtn.onclick = () => {
    // compute last undone opId from latestOpLog and request redo for that target
    const target = findLastUndone(latestOpLog);
    socket.emit('redo', { roomId, user, targetOpId: target });
  };

  // shape toolbar
  document.getElementById('rectBtn').onclick = () => { shapeMode = 'rect'; tool = 'shape'; setHeaderActive(null); };
  document.getElementById('circleBtn').onclick = () => { shapeMode = 'circle'; tool = 'shape'; setHeaderActive(null); };
  document.getElementById('lineBtn').onclick = () => { shapeMode = 'line'; tool = 'shape'; setHeaderActive(null); };
  document.getElementById('roundedRectBtn').onclick = () => { shapeMode = 'roundedRect'; tool = 'shape'; setHeaderActive(null); };
  document.getElementById('diamondBtn').onclick = () => { shapeMode = 'diamond'; tool = 'shape'; setHeaderActive(null); };
  document.getElementById('triangleBtn').onclick = () => { shapeMode = 'triangle'; tool = 'shape'; setHeaderActive(null); };
  document.getElementById('pentagonBtn').onclick = () => { shapeMode = 'pentagon'; tool = 'shape'; setHeaderActive(null); };
  document.getElementById('hexagonBtn').onclick = () => { shapeMode = 'hexagon'; tool = 'shape'; setHeaderActive(null); };
  document.getElementById('starBtn').onclick = () => { shapeMode = 'star'; tool = 'shape'; setHeaderActive(null); };
  document.getElementById('arrowBtn').onclick = () => { shapeMode = 'arrow'; tool = 'shape'; setHeaderActive(null); };
  // cloud shape removed

  socket.on('userList', (users) => {
    // render user count + up to 4 users, then a +N more badge
    const countEl = document.getElementById('userCount');
    const listEl = document.getElementById('userList');
    if (!countEl || !listEl) return;
    countEl.textContent = users.length;
    // show up to 4 user entries
    const maxVisible = 4;
    listEl.innerHTML = '';
    const visible = users.slice(0, maxVisible);
      // hide individual user entries in the toolbar — show a compact "Users ▾" menu
      const menuBtn = document.createElement('div');
      menuBtn.className = 'userEntry userListButton';
      menuBtn.textContent = 'Users ▾';
      menuBtn.title = `${users.length} users connected`;
      listEl.appendChild(menuBtn);
    // populate dropdown full list
    const dd = document.getElementById('userDropdown');
    if (dd) {
      dd.innerHTML = '';
      users.forEach(u => {
        const e = document.createElement('div');
        e.className = 'entry';
        e.innerHTML = `<span class="userDot" style="background:${u.color}"></span><span class="name">${escapeHtml(u.name)}</span>`;
        dd.appendChild(e);
      });
    }
  });

  // Dropdown behavior: toggle on click, close on outside click or Escape
  (function setupUserDropdown(){
    const listEl = document.getElementById('userList');
    const countEl = document.getElementById('userCount');
    const dd = document.getElementById('userDropdown');
    if (!listEl || !dd || !countEl) return;

    function open() {
      dd.classList.remove('hidden');
      dd.setAttribute('aria-hidden','false');
      listEl.setAttribute('aria-expanded','true');
    }
    function close() {
      dd.classList.add('hidden');
      dd.setAttribute('aria-hidden','true');
      listEl.setAttribute('aria-expanded','false');
    }

    listEl.addEventListener('click', (e) => { e.stopPropagation(); dd.classList.contains('hidden') ? open() : close(); });
    countEl.addEventListener('click', (e) => { e.stopPropagation(); dd.classList.contains('hidden') ? open() : close(); });
    // prevent clicks inside dropdown from bubbling to document (which would close it)
    dd.addEventListener('click', (e) => { e.stopPropagation(); });
    // close when clicking outside
    document.addEventListener('click', (ev) => { if (!dd.classList.contains('hidden')) close(); });
    // close on Esc
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
  })();

  // Responsive toolbar: move toolbar controls into dropdown on small screens
  (function setupResponsiveToolbar(){
    const toolbar = document.getElementById('toolbar');
    const users = document.getElementById('users');
    const menu = document.getElementById('toolbarMenu');
    const dropdown = document.getElementById('toolbarDropdown');
    if (!toolbar || !menu || !dropdown || !users) return;

    let collapsed = false;

    function collapse() {
      if (collapsed) return;
      // move all toolbar children except users, menu, dropdown into dropdown
      const nodes = Array.from(toolbar.children).filter(n => n !== users && n !== menu && n !== dropdown);
      nodes.forEach(n => dropdown.appendChild(n));
      menu.setAttribute('aria-expanded','false');
      collapsed = true;
    }

    function expand() {
      if (!collapsed) return;
      // move back elements from dropdown to toolbar before users
      const nodes = Array.from(dropdown.children);
      nodes.forEach(n => toolbar.insertBefore(n, users));
      dropdown.classList.add('hidden');
      menu.setAttribute('aria-expanded','false');
      collapsed = false;
    }

    function update() {
      const w = window.innerWidth;
      if (w <= 900) collapse(); else expand();
    }

    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown.classList.contains('hidden')) {
        dropdown.classList.remove('hidden');
        dropdown.setAttribute('aria-hidden','false');
        menu.setAttribute('aria-expanded','true');
      } else {
        dropdown.classList.add('hidden');
        dropdown.setAttribute('aria-hidden','true');
        menu.setAttribute('aria-expanded','false');
      }
    });

    // close dropdown when clicking outside
    document.addEventListener('click', () => { if (!dropdown.classList.contains('hidden')) { dropdown.classList.add('hidden'); dropdown.setAttribute('aria-hidden','true'); menu.setAttribute('aria-expanded','false'); } });
    window.addEventListener('resize', update);
    // initial
    update();
  })();

  socket.on('snapshot', (msg) => {
    // remember latest opLog so UI can compute undo/redo targets
    latestOpLog = msg.opLog || [];
    // msg.opLog - replay on client to build strokes
    const strokes = replayOpLogToStrokes(msg.opLog);
    drawing.setStrokes(strokes);
  });

  // Broadcast local drawing events
  let lastEmit = 0;
  function emitThrottle(evtName, payload) {
    // basic 30ms throttle
    const now = Date.now();
    if (now - lastEmit < 30 && evtName === 'strokePoint') return;
    lastEmit = now;
    socket.emit(evtName, payload);
  }

  // Pointer events
  let rect = canvasEl.getBoundingClientRect();
  window.addEventListener('resize', () => rect = canvasEl.getBoundingClientRect());

  function normalizePoint(e) {
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvasEl.addEventListener('pointerdown', (e) => {
    canvasEl.setPointerCapture(e.pointerId);
    const p = normalizePoint(e);
  const meta = { color: colorPicker.value, width: Number(widthRange.value), mode: tool };
  // attach toolbar flags into meta so they persist in the opLog
  if (isHighlighter) meta.highlighter = true;
  if (isDashed) meta.dashPattern = [10, 8];
  if (isDotted) meta.dashPattern = [2, 6];
  if (isHighlighter) meta.globalAlpha = 0.35;
    if (tool === 'shape' && shapeMode) {
      // start a temporary shape
      drawing.currentShape = { type: shapeMode, meta, start: p, end: p };
    } else {
      drawing.startLocalStroke(meta, p);
      emitThrottle('startStroke', { roomId, user, stroke: { meta, points: [p] } });
    }
  });

  canvasEl.addEventListener('pointermove', (e) => {
    const p = normalizePoint(e);
    // local prediction
    if (tool === 'shape' && drawing.currentShape) {
      drawing.currentShape.end = p;
      drawing.redraw();
      // draw preview
      drawing.drawPreviewShape(drawing.currentShape);
    } else {
      if (drawing.isDrawing) drawing.addPoint(p);
      emitThrottle('strokePoint', { roomId, user, point: p });
    }
    // cursor broadcast every 100ms
    socket.emit('cursor', { roomId, user, x: p.x, y: p.y });
  });

  canvasEl.addEventListener('pointerup', (e) => {
    canvasEl.releasePointerCapture(e.pointerId);
    if (tool === 'shape' && drawing.currentShape) {
      const shape = drawing.currentShape;
      drawing.currentShape = null;
      // convert shape to a stroke-like payload for server persistence
      const stroke = shapeToStroke(shape);
      drawing.strokes.push(stroke);
      socket.emit('endStroke', { roomId, user, stroke });
      drawing.redraw();
    } else {
      const finished = drawing.endLocalStroke();
      if (finished) socket.emit('endStroke', { roomId, user, stroke: finished });
    }
  });

  // Remote events mapping
  socket.on('startStroke', (msg) => {
    // create an ephemeral stroke for other user
    // msg.stroke: { meta, points }
    drawing.strokes.push({ meta: msg.stroke.meta, points: msg.stroke.points });
    drawing.redraw();
  });

  socket.on('strokePoint', (msg) => {
    // append point to last stroke from that user
    const p = msg.point;
    // naive: push to last strokes array
    const last = drawing.strokes[drawing.strokes.length - 1];
    if (last) {
      last.points.push(p);
      drawing.redraw();
    }
  });

  socket.on('endStroke', (msg) => {
    // msg contains opId and stroke; update local opId if necessary
    // For simplicity, we trust server persisted stroke; nothing else to do here
  });

  socket.on('undo', (msg) => {
    // msg.targetOpId -> ask server for full opLog via snapshot
    socket.emit('requestSnapshot', { roomId });
  });

  socket.on('redo', (msg) => {
    socket.emit('requestSnapshot', { roomId });
  });

  function findLastUndone(opLog) {
    if (!opLog || opLog.length === 0) return null;
    // Build undo stack: push on 'undo', remove on 'redo'. Top of stack is last undone.
    const stack = [];
    for (const op of opLog) {
      if (op.type === 'undo') stack.push(op.payload.targetOpId);
      else if (op.type === 'redo') {
        const idx = stack.lastIndexOf(op.payload.targetOpId);
        if (idx !== -1) stack.splice(idx, 1);
      }
    }
    return stack.length ? stack[stack.length - 1] : null;
  }

  function replayOpLogToStrokes(opLog) {
    // Rebuild visible strokes in the same way server.replay() does:
    // - on 'stroke' push the stroke into timeline
    // - on 'undo' remove the target stroke from the current timeline
    // - on 'redo' re-insert the target stroke at the time of redo (push)
    const strokes = [];
    const strokeMap = new Map();

    for (const op of opLog || []) {
      if (op.type === 'stroke') {
        const item = { meta: op.payload.stroke.meta, points: op.payload.stroke.points, opId: op.opId };
        strokeMap.set(op.opId, item);
        strokes.push(item);
      } else if (op.type === 'undo') {
        const target = op.payload.targetOpId;
        // remove the most-recent occurrence (last) so undo acts LIFO when duplicates exist
        for (let i = strokes.length - 1; i >= 0; i--) {
          if (strokes[i].opId === target) { strokes.splice(i, 1); break; }
        }
      } else if (op.type === 'redo') {
        const target = op.payload.targetOpId;
        const s = strokeMap.get(target);
        if (s) strokes.push(s);
      }
    }

    return strokes;
  }

  function randomColor() {
    return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
  }

  function shapeToStroke(shape) {
    // Create a simple stroke representation for shapes: meta + few points approximating shape
    const meta = Object.assign({}, shape.meta);
    // tag this stroke as a shape so drawing code can render it accurately (no smoothing)
    meta.shape = shape.type;
    meta.shapeBounds = { start: shape.start, end: shape.end };
    if (shape.type === 'line') {
      return { meta, points: [shape.start, shape.end] };
    }
    if (shape.type === 'rect') {
      const s = shape.start, e = shape.end;
      const points = [s, { x: e.x, y: s.y }, e, { x: s.x, y: e.y }, s];
      return { meta, points };
    }
    if (shape.type === 'circle') {
      // approximate circle with 8 points
      const cx = (shape.start.x + shape.end.x) / 2;
      const cy = (shape.start.y + shape.end.y) / 2;
      const rx = Math.abs(shape.end.x - shape.start.x) / 2;
      const ry = Math.abs(shape.end.y - shape.start.y) / 2;
      const pts = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
      }
      pts.push(pts[0]);
      return { meta, points: pts };
    }
    // Additional shapes approximated as polygons or have explicit params in meta
    const s = shape.start, e = shape.end;
    const cx = (s.x + e.x) / 2; const cy = (s.y + e.y) / 2;
    const rx = Math.abs(e.x - s.x) / 2; const ry = Math.abs(e.y - s.y) / 2;
    if (shape.type === 'diamond') {
      // diamond is square rotated 45 deg -> 4 points
      const pts = [ {x:cx, y: s.y}, {x: e.x, y: cy}, {x:cx, y: e.y}, {x: s.x, y: cy}, {x:cx, y: s.y} ];
      return { meta, points: pts };
    }
    if (shape.type === 'triangle') {
      // equilateral-ish triangle: top and bottom corners
      const pts = [ {x:cx, y: s.y}, {x: e.x, y: e.y}, {x: s.x, y: e.y}, {x:cx, y: s.y} ];
      return { meta, points: pts };
    }
    if (shape.type === 'pentagon' || shape.type === 'hexagon') {
      const sides = shape.type === 'pentagon' ? 5 : 6;
      const pts = [];
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 - Math.PI/2;
        pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
      }
      pts.push(pts[0]);
      return { meta, points: pts };
    }
    if (shape.type === 'star') {
      // 5-point star with inner radius
      const pts = [];
      const spikes = 5;
      const innerR = Math.min(rx, ry) * 0.5;
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? Math.max(rx, ry) : innerR;
        const a = (i / (spikes*2)) * Math.PI * 2 - Math.PI/2;
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      pts.push(pts[0]);
      return { meta, points: pts };
    }
    if (shape.type === 'arrow') {
      // represent arrow as line with head params in meta
      meta.shapeParams = { headLength: Math.max(rx, ry) * 0.4 };
      return { meta, points: [ {x:s.x, y:s.y}, {x:e.x, y:e.y} ] };
    }
    if (shape.type === 'roundedRect') {
      meta.shapeParams = { radius: Math.min(rx, ry) * 0.2 };
      return { meta, points: [s, e] };
    }
    
    // fallback
    return { meta, points: [shape.start, shape.end] };
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])) }

  // Initialize shape buttons: inject icon SVG + label, and manage active state
  (function initShapeButtons(){
    const btns = document.querySelectorAll('.shape-btn');
    function svgFor(name){
      name = name.toLowerCase();
      if (name === 'line') return `<svg viewBox="0 0 24 24" class="icon" xmlns="http://www.w3.org/2000/svg"><line x1="3" y1="21" x2="21" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
      if (name === 'rectangle' || name === 'rect') return `<svg viewBox="0 0 24 24" class="icon" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="6" width="18" height="12" stroke="currentColor" fill="none" stroke-width="2" rx="0"/></svg>`;
      if (name === 'rounded rect' || name === 'roundedrect') return `<svg viewBox="0 0 24 24" class="icon" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="6" width="18" height="12" stroke="currentColor" fill="none" stroke-width="2" rx="3"/></svg>`;
      if (name === 'circle') return `<svg viewBox="0 0 24 24" class="icon" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="7" stroke="currentColor" fill="none" stroke-width="2"/></svg>`;
      if (name === 'diamond') return `<svg viewBox="0 0 24 24" class="icon" xmlns="http://www.w3.org/2000/svg"><polygon points="12,3 21,12 12,21 3,12" stroke="currentColor" fill="none" stroke-width="2"/></svg>`;
      if (name === 'triangle') return `<svg viewBox="0 0 24 24" class="icon" xmlns="http://www.w3.org/2000/svg"><polygon points="12,4 20,18 4,18" stroke="currentColor" fill="none" stroke-width="2"/></svg>`;
      if (name === 'pentagon') return `<svg viewBox="0 0 24 24" class="icon" xmlns="http://www.w3.org/2000/svg"><polygon points="12,3 20,9 16,20 8,20 4,9" stroke="currentColor" fill="none" stroke-width="2"/></svg>`;
      if (name === 'hexagon') return `<svg viewBox="0 0 24 24" class="icon" xmlns="http://www.w3.org/2000/svg"><polygon points="6,4 18,4 22,12 18,20 6,20 2,12" stroke="currentColor" fill="none" stroke-width="2"/></svg>`;
      if (name === 'star') return `<svg viewBox="0 0 24 24" class="icon" xmlns="http://www.w3.org/2000/svg"><polygon points="12,2 14.9,8.5 22,9.3 16.5,13.8 18.2,21 12,17.7 5.8,21 7.5,13.8 2,9.3 9.1,8.5" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>`;
      if (name === 'arrow') return `<svg viewBox="0 0 24 24" class="icon" xmlns="http://www.w3.org/2000/svg"><line x1="4" y1="12" x2="18" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polygon points="18,12 14,9 14,15" fill="currentColor"/></svg>`;
      
      return `<svg viewBox="0 0 24 24" class="icon" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="6" width="18" height="12" stroke="currentColor" fill="none" stroke-width="2"/></svg>`;
    }

    btns.forEach(b => {
      const name = b.dataset.name || b.id || 'shape';
      b.innerHTML = `<span class="icon">${svgFor(name)}</span><span class="label">${name}</span>`;
      b.addEventListener('click', (ev) => {
        // clear other active
        btns.forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        // set tool/shapeMode based on id
        const id = b.id;
        // match id to shapeMode used above
        shapeMode = id.replace(/Btn$/, '');
        tool = 'shape';
      });
    });
  })();

})();
