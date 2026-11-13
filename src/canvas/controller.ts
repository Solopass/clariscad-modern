// Owns the three viewport canvases, the camera, pointer/keyboard input and
// the requestAnimationFrame loop. Lives outside React: stores are read
// directly and redraws are driven by dirty flags.
import type { Entity, Id } from "../kernel/types";
import { snap, type SnapResult } from "../kernel/snapEngine";
import { entityBBox, unionBox } from "../kernel/prims";
import { STANDARDS } from "../kernel/dimensions";
import { duplicate } from "../state/arrange";
import { type Vec2, dist } from "../kernel/vec";
import { useDocumentStore, newId } from "../state/useDocumentStore";
import { useToolStore, type ToolId } from "../state/useToolStore";
import { useCursorStore } from "../state/useCursorStore";
import { methodDef, TOOLS, type Shape } from "../tools/defs";
import { DrawTool, SelectTool, type PointerInfo, type Tool, type ToolContext } from "../tools/runtime";
import { type Camera, fitBox, panBy, screenToWorld, viewBox, worldToScreen, zoomAt } from "./camera";
import {
  CLASSIC,
  type DrawContext,
  drawCrosshair,
  drawEntities,
  drawGrid,
  drawGuides,
  drawHandles,
  drawSnapBadge,
  handlePoints,
  setupCanvas,
  strokeEntity,
} from "./render";

const PICK_PX = 8;

export class ViewportController {
  cam: Camera = { cx: 0, cy: 0, zoom: 1, width: 1, height: 1 };
  private tool: Tool;
  private dirty = { grid: true, static: true, overlay: true };
  private raf = 0;
  private pointer: { screen: Vec2; shift: boolean; alt: boolean; ctrl: boolean } | null = null;
  private lastInfo: PointerInfo | null = null;
  private lastSnap: SnapResult | null = null;
  private panning: { x: number; y: number } | null = null;
  private spaceDown = false;
  private anchors: Vec2[] = [];
  private unsubs: (() => void)[] = [];
  private ro: ResizeObserver;

  constructor(
    private host: HTMLElement,
    private grid: HTMLCanvasElement,
    private stat: HTMLCanvasElement,
    private over: HTMLCanvasElement,
  ) {
    this.tool = this.makeTool();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    // Start with roughly 20 feet across.
    this.cam = { ...this.cam, zoom: Math.max(0.05, this.cam.width / 6096), cx: 2500, cy: 1500 };

    this.unsubs.push(
      useDocumentStore.subscribe((s, prev) => {
        if (s.version !== prev.version) this.mark("static", "overlay");
        if (s.selection !== prev.selection) this.mark("overlay");
      }),
      useToolStore.subscribe((s, prev) => {
        if (s.tool !== prev.tool || s.methods[s.tool] !== prev.methods[prev.tool]) {
          this.tool.cancel();
          this.tool = this.makeTool();
          this.anchors = [];
        }
        if (s.settings !== prev.settings) this.mark("grid", "static");
        this.mark("overlay");
      }),
    );

    over.addEventListener("pointerdown", this.onDown);
    over.addEventListener("pointermove", this.onMove);
    over.addEventListener("pointerup", this.onUp);
    over.addEventListener("pointerleave", this.onLeave);
    over.addEventListener("dblclick", this.onDbl);
    over.addEventListener("wheel", this.onWheel, { passive: false });
    over.addEventListener("contextmenu", this.onContext);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    this.loop();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.unsubs.forEach((u) => u());
    // Every listener must go: React StrictMode mounts twice in dev, and a disposed
    // controller left listening would act on clicks a second time.
    const o = this.over;
    o.removeEventListener("pointerdown", this.onDown);
    o.removeEventListener("pointermove", this.onMove);
    o.removeEventListener("pointerup", this.onUp);
    o.removeEventListener("pointerleave", this.onLeave);
    o.removeEventListener("dblclick", this.onDbl);
    o.removeEventListener("wheel", this.onWheel);
    o.removeEventListener("contextmenu", this.onContext);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  // ------------------------------------------------------------ tools

  private toolContext(): ToolContext {
    return {
      doc: () => useDocumentStore.getState().doc,
      index: () => useDocumentStore.getState().index,
      commit: (p) => useDocumentStore.getState().commit(p),
      selection: () => useDocumentStore.getState().selection,
      setSelection: (ids) => useDocumentStore.getState().setSelection(ids),
      settings: () => useToolStore.getState().settings,
      tolerance: () => PICK_PX / this.cam.zoom,
      newId: () => newId(),
    };
  }

  private makeTool(): Tool {
    const { tool, methods } = useToolStore.getState();
    if (tool === "select") return new SelectTool(this.toolContext(), methods.select as "pick" | "lasso" | "polygon");
    return new DrawTool(methodDef(tool, methods[tool]), this.toolContext());
  }

  /** Called by the HUD when the user types a point. */
  typedPoint(p: Vec2) {
    this.tool.typed(p);
    this.mark("overlay");
  }

  currentFrom(): Vec2 | undefined {
    return this.tool.from();
  }

  // ------------------------------------------------------------ view commands

  zoomBy(f: number) {
    this.cam = zoomAt(this.cam, { x: this.cam.width / 2, y: this.cam.height / 2 }, f);
    this.mark("grid", "static", "overlay");
  }

  zoomFit() {
    const { doc } = useDocumentStore.getState();
    let box = null;
    for (const e of doc.entities) {
      const b = entityBBox(e, useDocumentStore.getState().index.ctx);
      if (b) box = box ? unionBox(box, b) : b;
    }
    if (!box) return;
    this.cam = fitBox(this.cam, box);
    this.mark("grid", "static", "overlay");
  }

  // ------------------------------------------------------------ input

  private info(ev: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
    const r = this.over.getBoundingClientRect();
    this.pointer = { screen: { x: ev.clientX - r.left, y: ev.clientY - r.top }, shift: ev.shiftKey, alt: ev.altKey, ctrl: ev.ctrlKey || ev.metaKey };
    return this.computeInfo();
  }

  /** Snap the current pointer. Shared by events and the frame loop. */
  private computeInfo(): PointerInfo | null {
    if (!this.pointer) return null;
    const { screen, shift, alt, ctrl } = this.pointer;
    const raw = screenToWorld(this.cam, screen);
    const ts = useToolStore.getState();
    const ds = useDocumentStore.getState();
    const layers = new Map(ds.doc.layers.map((l) => [l.id, l]));
    const from = this.tool.from();
    const modifiers = { ...ts.modifiers };
    // Shift constrains to 45° steps (or the angle-lock step if that modifier is on).
    if (shift && from) modifiers.angle = true;
    const angleStep = ((modifiers.angle && !ts.modifiers.angle ? 45 : ts.settings.angleStep) * Math.PI) / 180;
    const wantsSnap = this.tool.wantsSnap();
    const res = wantsSnap
      ? snap(raw, ds.index, { modifiers, tolerance: PICK_PX / this.cam.zoom, grid: { spacing: ts.settings.gridSpacing }, angleStep }, {
          from,
          anchors: this.anchors,
          exclude: this.tool.snapExclude() as Set<Id> | undefined,
          filter: (e) => e.kind !== "dimension" && layers.get(e.layerId)?.visible !== false,
        })
      : null;
    this.lastSnap = res;
    if (res && ["endpoint", "midpoint", "center", "intersection", "quadrant"].includes(res.kind)) {
      if (!this.anchors.some((a) => dist(a, res.point) < 1e-9)) this.anchors = [res.point, ...this.anchors].slice(0, 6);
    }
    const info: PointerInfo = { p: res?.point ?? raw, raw, screen, shift, alt, ctrl, ids: res?.entityIds };
    this.lastInfo = info;
    return info;
  }

  private onDown = (ev: PointerEvent) => {
    this.over.setPointerCapture(ev.pointerId);
    if (ev.button === 1 || (ev.button === 0 && this.spaceDown)) {
      this.panning = { x: ev.clientX, y: ev.clientY };
      ev.preventDefault();
      return;
    }
    if (ev.button !== 0) return;
    const info = this.info(ev);
    if (!info) return;
    this.tool.down(info);
    if (this.tool.from()) this.anchors = [this.tool.from()!, ...this.anchors.filter((a) => dist(a, this.tool.from()!) > 1e-9)].slice(0, 6);
    this.mark("overlay");
  };

  private onMove = (ev: PointerEvent) => {
    if (this.panning) {
      this.cam = panBy(this.cam, ev.clientX - this.panning.x, ev.clientY - this.panning.y);
      this.panning = { x: ev.clientX, y: ev.clientY };
      this.mark("grid", "static", "overlay");
      return;
    }
    const r = this.over.getBoundingClientRect();
    this.pointer = { screen: { x: ev.clientX - r.left, y: ev.clientY - r.top }, shift: ev.shiftKey, alt: ev.altKey, ctrl: ev.ctrlKey || ev.metaKey };
    // Freehand needs every sample; everything else snaps once per frame.
    const coalesced = typeof ev.getCoalescedEvents === "function" ? ev.getCoalescedEvents() : [];
    if (coalesced.length > 1 && this.tool.busy()) {
      for (const c of coalesced) {
        const raw = screenToWorld(this.cam, { x: c.clientX - r.left, y: c.clientY - r.top });
        this.tool.move({ p: raw, raw, screen: { x: c.clientX - r.left, y: c.clientY - r.top }, shift: ev.shiftKey, alt: ev.altKey, ctrl: ev.ctrlKey });
      }
    }
    this.mark("overlay");
  };

  private onUp = (ev: PointerEvent) => {
    if (this.panning) {
      this.panning = null;
      return;
    }
    if (ev.button !== 0) return;
    const info = this.info(ev);
    if (info) {
      // Deliver the final position before the release (moves are otherwise once per frame).
      if (this.tool.busy()) this.tool.move(info);
      this.tool.up(info);
    }
    this.mark("overlay");
  };

  private onLeave = () => {
    if (!this.tool.busy()) {
      this.pointer = null;
      this.lastInfo = null;
      this.mark("overlay");
    }
  };

  private onDbl = (ev: MouseEvent) => {
    const info = this.info(ev);
    if (info) this.tool.dblclick(info);
    this.mark("overlay");
  };

  private onContext = (ev: MouseEvent) => {
    ev.preventDefault();
    // Right-click finishes a multi-point command, like Enter.
    this.tool.key("Enter", { shift: false, ctrl: false });
    this.mark("overlay");
  };

  private onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const r = this.over.getBoundingClientRect();
    const s = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    if (ev.ctrlKey || Math.abs(ev.deltaY) >= 50 || ev.deltaMode !== 0 || Number.isInteger(ev.deltaY) && ev.deltaX === 0) {
      // Mouse wheel or pinch: zoom at cursor.
      const k = ev.deltaMode === 1 ? 0.05 : 0.0015;
      this.cam = zoomAt(this.cam, s, Math.exp(-ev.deltaY * k * (ev.ctrlKey ? 4 : 1)));
    } else {
      // Two-finger trackpad scroll: pan.
      this.cam = panBy(this.cam, -ev.deltaX, -ev.deltaY);
    }
    this.mark("grid", "static", "overlay");
  };

  private onKey = (ev: KeyboardEvent) => {
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const ctrl = ev.ctrlKey || ev.metaKey;
    const ds = useDocumentStore.getState();
    if (ctrl && (ev.key === "z" || ev.key === "Z")) {
      ev.preventDefault();
      this.tool.cancel();
      if (ev.shiftKey) ds.redo();
      else ds.undo();
      return;
    }
    if (ctrl && (ev.key === "y" || ev.key === "Y")) {
      ev.preventDefault();
      this.tool.cancel();
      ds.redo();
      return;
    }
    if (ctrl && (ev.key === "d" || ev.key === "D")) {
      ev.preventDefault();
      const g = useToolStore.getState().settings.gridSpacing;
      duplicate({ x: g, y: -g });
      return;
    }
    if (ctrl && (ev.key === "a" || ev.key === "A")) {
      ev.preventDefault();
      useToolStore.getState().setTool("select");
      ds.setSelection(ds.doc.entities.map((e) => e.id));
      return;
    }
    if (ev.key === " ") {
      this.spaceDown = true;
      ev.preventDefault();
      return;
    }
    if (this.tool.key(ev.key, { shift: ev.shiftKey, ctrl })) {
      ev.preventDefault();
      this.mark("overlay");
      return;
    }
    if (ctrl) {
      if (ev.key === "=" || ev.key === "+") (ev.preventDefault(), this.zoomBy(1.5));
      else if (ev.key === "-") (ev.preventDefault(), this.zoomBy(1 / 1.5));
      else if (ev.key === "0") (ev.preventDefault(), this.zoomFit());
      return;
    }
    if (ev.key === "Escape") {
      useToolStore.getState().setTool("select");
      return;
    }
    if (ev.key === "f" || ev.key === "F") return this.zoomFit();
    const tool = TOOLS.find((x) => x.key === ev.key.toLowerCase());
    if (tool && !ev.altKey) {
      if (tool.id === useToolStore.getState().tool) {
        // Pressing the key again cycles through the tool's Methods.
        const ms = tool.methods;
        const cur = useToolStore.getState().methods[tool.id];
        const i = ms.findIndex((m) => m.id === cur);
        useToolStore.getState().setMethod(tool.id as ToolId, ms[(i + 1) % ms.length].id);
      } else useToolStore.getState().setTool(tool.id);
    }
  };

  private onKeyUp = (ev: KeyboardEvent) => {
    if (ev.key === " ") this.spaceDown = false;
    if (ev.key === "Shift") this.mark("overlay");
  };

  // ------------------------------------------------------------ rendering

  private mark(...what: ("grid" | "static" | "overlay")[]) {
    for (const w of what) this.dirty[w] = true;
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.cam = { ...this.cam, width: Math.max(1, r.width), height: Math.max(1, r.height) };
    this.mark("grid", "static", "overlay");
  }

  private drawContext(): DrawContext {
    const ds = useDocumentStore.getState();
    return {
      cam: this.cam,
      theme: CLASSIC,
      layers: new Map(ds.doc.layers.map((l) => [l.id, l])),
      symbols: ds.index.ctx ?? {},
      showWeights: useToolStore.getState().settings.showWeights,
      dimStyle: STANDARDS[ds.doc.standard] ?? STANDARDS.ANSI,
      units: ds.doc.units,
    };
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.frame();
  };

  /** Draw whatever is dirty. Public so tests/devtools can drive frames when rAF is paused. */
  frame() {
    const { width, height } = this.cam;
    if (this.dirty.grid) {
      const ctx = setupCanvas(this.grid, width, height);
      const s = useToolStore.getState().settings;
      drawGrid(ctx, this.cam, CLASSIC, s.gridSpacing, s.gridVisible);
      this.dirty.grid = false;
    }
    if (this.dirty.static) {
      const ctx = setupCanvas(this.stat, width, height);
      const ds = useDocumentStore.getState();
      const visible = new Set(ds.index.spatial.search(viewBox(this.cam)));
      drawEntities(ctx, ds.doc.entities.filter((e) => visible.has(e.id)), this.drawContext());
      this.dirty.static = false;
    }
    if (this.dirty.overlay) {
      this.drawOverlay();
      this.dirty.overlay = false;
    }
  }

  private drawOverlay() {
    const ctx = setupCanvas(this.over, this.cam.width, this.cam.height);
    const dc = this.drawContext();
    const ds = useDocumentStore.getState();
    const info = this.pointer ? this.computeInfo() : null;
    // Drags (move, grip, marquee, lasso) see the snapped pointer once per frame.
    if (info && this.tool.busy()) this.tool.move(info);

    // Selection handles.
    for (const id of ds.selection) {
      const e = ds.index.get(id);
      if (e) drawHandles(ctx, this.cam, handlePoints(e));
    }

    const ov = this.tool.overlay(info);
    for (const s of ov.shapes) {
      const ent = { ...s, id: "preview", layerId: "" } as Entity;
      strokeEntity(ctx, ent, dc, { color: CLASSIC.preview, width: 1, dash: s.kind === "guide" ? [4, 4] : [] });
    }
    for (const s of ov.highlight) {
      const ent = { ...s, id: "preview", layerId: "" } as Entity;
      strokeEntity(ctx, ent, dc, { color: CLASSIC.snap, width: 2, dash: [5, 3] });
    }
    if (ov.outline && ov.outline.length > 1) {
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ov.outline.forEach((p, i) => {
        const q = worldToScreen(this.cam, p);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const p of ov.points) {
      const q = worldToScreen(this.cam, p);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(q.x - 3, q.y - 3);
      ctx.lineTo(q.x + 3, q.y + 3);
      ctx.moveTo(q.x + 3, q.y - 3);
      ctx.lineTo(q.x - 3, q.y + 3);
      ctx.stroke();
    }
    if (ov.marquee) {
      const a = worldToScreen(this.cam, ov.marquee.a);
      const b = worldToScreen(this.cam, ov.marquee.b);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      // Marching-ants look: dotted for crossing, solid for inside.
      ctx.setLineDash(ov.marquee.crossing ? [3, 3] : []);
      ctx.strokeRect(Math.round(Math.min(a.x, b.x)) + 0.5, Math.round(Math.min(a.y, b.y)) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.setLineDash([]);
    }

    const snapRes = this.lastSnap;
    if (info && snapRes) {
      drawGuides(ctx, this.cam, snapRes.guides, CLASSIC);
      if (snapRes.kind !== "none" && snapRes.kind !== "grid") drawSnapBadge(ctx, this.cam, snapRes.point, snapRes.label, CLASSIC);
    }
    if (info) drawCrosshair(ctx, this.cam, info.p);

    useCursorStore.getState().set({
      point: info?.p ?? this.lastInfo?.p ?? { x: 0, y: 0 },
      from: this.tool.from() ?? null,
      snapLabel: snapRes && snapRes.kind !== "none" ? snapRes.label : "",
      prompt: this.tool.prompt(),
      zoom: this.cam.zoom,
    });
  }
}

/** The mounted viewport (one per window), for menus and the HUD. */
export const viewportRef: { current: ViewportController | null } = { current: null };

export type { Shape };
