// Self-contained drawing engine: local rendering + remote stroke playback +
// undo/redo history. Coordinates are normalized 0..1 so canvases of different
// sizes across devices stay in sync.

export class DrawingCanvas {
  constructor(canvasEl, { onLocalStroke } = {}) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext("2d");
    this.onLocalStroke = onLocalStroke || (() => {});
    this.tool = "pencil";
    this.color = "#2b2d42";
    this.size = 6;
    this.isDrawing = false;
    this.currentPoints = [];
    this.history = []; // completed strokes {tool,color,size,points}
    this.redoStack = [];
    this.isDrawerMode = false;

    this._resize();
    window.addEventListener("resize", () => this._resize());

    canvasEl.addEventListener("pointerdown", (e) => this._start(e));
    canvasEl.addEventListener("pointermove", (e) => this._move(e));
    window.addEventListener("pointerup", () => this._end());
    canvasEl.addEventListener("pointerleave", () => this._end());
  }

  setEnabled(enabled) {
    this.isDrawerMode = enabled;
    this.canvas.style.cursor = enabled ? "crosshair" : "not-allowed";
  }

  setTool(tool) { this.tool = tool; }
  setColor(color) { this.color = color; }
  setSize(size) { this.size = Number(size); }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * ratio;
    this.canvas.height = rect.height * ratio;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this._redrawAll();
  }

  _toNorm(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  _start(e) {
    if (!this.isDrawerMode) return;
    e.preventDefault();
    this.isDrawing = true;
    this.currentPoints = [this._toNorm(e)];
    if (["rect", "circle", "line"].includes(this.tool)) {
      this._shapeStart = this._toNorm(e);
    }
    if (this.tool === "fill") {
      this._floodFill(this._toNorm(e));
      this.isDrawing = false;
    }
  }

  _move(e) {
    if (!this.isDrawing || !this.isDrawerMode) return;
    const p = this._toNorm(e);
    if (["rect", "circle", "line"].includes(this.tool)) {
      this._redrawAll();
      this._drawShapePreview(this._shapeStart, p);
      return;
    }
    this.currentPoints.push(p);
    this._drawSegment(this.currentPoints[this.currentPoints.length - 2], p);
  }

  _end() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    let stroke;
    if (["rect", "circle", "line"].includes(this.tool) && this._shapeStart) {
      stroke = {
        tool: this.tool,
        color: this.color,
        size: this.size,
        points: [this._shapeStart, this.currentPoints[this.currentPoints.length - 1] || this._shapeStart],
      };
      this._shapeStart = null;
    } else if (this.currentPoints.length > 0) {
      stroke = { tool: this.tool, color: this.color, size: this.size, points: this.currentPoints };
    }
    if (stroke) {
      stroke.strokeId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      this.history.push(stroke);
      this.redoStack = [];
      this.onLocalStroke(stroke);
    }
    this.currentPoints = [];
  }

  /** Called when a stroke arrives from the network (remote drawer). */
  applyRemoteStroke(stroke) {
    this.history.push(stroke);
    this._renderStroke(stroke);
  }

  clear() {
    this.history = [];
    this.redoStack = [];
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  undo() {
    const s = this.history.pop();
    if (s) this.redoStack.push(s);
    this._redrawAll();
  }

  redo() {
    const s = this.redoStack.pop();
    if (s) this.history.push(s);
    this._redrawAll();
  }

  _redrawAll() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const s of this.history) this._renderStroke(s);
  }

  _px(p) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: p.x * rect.width, y: p.y * rect.height };
  }

  _renderStroke(stroke) {
    const { tool, color, size, points } = stroke;
    if (tool === "rect" || tool === "circle" || tool === "line") {
      this._drawShapePreview(points[0], points[1], { tool, color, size });
      return;
    }
    this.ctx.strokeStyle = tool === "eraser" ? "#ffffff" : color;
    this.ctx.lineWidth = tool === "marker" ? size * 1.8 : size;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.globalAlpha = tool === "marker" ? 0.7 : 1;
    this.ctx.beginPath();
    const first = this._px(points[0]);
    this.ctx.moveTo(first.x, first.y);
    for (const p of points.slice(1)) {
      const px = this._px(p);
      this.ctx.lineTo(px.x, px.y);
    }
    this.ctx.stroke();
    this.ctx.globalAlpha = 1;
  }

  _drawSegment(a, b) {
    if (!a) return;
    this.ctx.strokeStyle = this.tool === "eraser" ? "#ffffff" : this.color;
    this.ctx.lineWidth = this.tool === "marker" ? this.size * 1.8 : this.size;
    this.ctx.lineCap = "round";
    this.ctx.globalAlpha = this.tool === "marker" ? 0.7 : 1;
    const pa = this._px(a);
    const pb = this._px(b);
    this.ctx.beginPath();
    this.ctx.moveTo(pa.x, pa.y);
    this.ctx.lineTo(pb.x, pb.y);
    this.ctx.stroke();
    this.ctx.globalAlpha = 1;
  }

  _drawShapePreview(start, end, override) {
    const tool = override?.tool ?? this.tool;
    const color = override?.color ?? this.color;
    const size = override?.size ?? this.size;
    const a = this._px(start);
    const b = this._px(end);
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = size;
    this.ctx.beginPath();
    if (tool === "line") {
      this.ctx.moveTo(a.x, a.y);
      this.ctx.lineTo(b.x, b.y);
    } else if (tool === "rect") {
      this.ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    } else if (tool === "circle") {
      const rx = Math.abs(b.x - a.x) / 2;
      const ry = Math.abs(b.y - a.y) / 2;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    }
    this.ctx.stroke();
  }

  /** Simple flood fill on the visible canvas bitmap (not vector-accurate but fast). */
  _floodFill(normPoint) {
    const { width, height } = this.canvas;
    const px = Math.floor(normPoint.x * width);
    const py = Math.floor(normPoint.y * height);
    const imageData = this.ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const idx = (x, y) => (y * width + x) * 4;
    const target = data.slice(idx(px, py), idx(px, py) + 4);
    const fill = hexToRgba(this.color);
    if (colorsMatch(target, fill)) return;

    const stack = [[px, py]];
    const visited = new Uint8Array(width * height);
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const vIdx = y * width + x;
      if (visited[vIdx]) continue;
      const i = idx(x, y);
      if (!colorsMatch(data.slice(i, i + 4), target)) continue;
      visited[vIdx] = 1;
      data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = 255;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    this.ctx.putImageData(imageData, 0, 0);
    const stroke = { tool: "fill", color: this.color, size: 0, points: [normPoint], strokeId: `${Date.now()}-fill` };
    this.history.push(stroke);
    this.onLocalStroke(stroke);
  }
}

function hexToRgba(hex) {
  const v = hex.replace("#", "");
  const bigint = parseInt(v, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255, 255];
}
function colorsMatch(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}
