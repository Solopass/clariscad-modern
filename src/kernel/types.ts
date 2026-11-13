// Document data model. Everything is plain, serializable data (no functions,
// no class instances) so it can go straight into the store, undo stack and
// the .tcad file. Model units are millimetres; angles are radians, CCW.
import type { Vec2 } from "./vec";

export type Id = string;

export type Justify = "center" | "left" | "right";

export interface StyleRef {
  /** Pen weight in mm on paper (0.13 – 2.00). */
  penWeight?: number;
  /** Named dash pattern (see DASH_PATTERNS in the renderer). */
  dash?: string;
  color?: string;
  /** Hatch/fill pattern id for closed shapes. */
  fill?: string;
}

interface EntityBase {
  id: Id;
  layerId: Id;
  style?: StyleRef;
}

export interface LineEntity extends EntityBase {
  kind: "line";
  a: Vec2;
  b: Vec2;
}

export interface PolylineEntity extends EntityBase {
  kind: "polyline";
  points: Vec2[];
  closed: boolean;
  /**
   * DXF-style bulge per vertex: segment i (points[i] → points[i+1], or the closing
   * segment for the last vertex) is an arc with bulge = tan(θ/4), θ = included angle,
   * positive = CCW. Missing or 0 = straight.
   */
  bulges?: number[];
}

export interface DoubleLineEntity extends EntityBase {
  kind: "doubleLine";
  a: Vec2;
  b: Vec2;
  width: number;
  justify: Justify;
  capStart: boolean;
  capEnd: boolean;
}

export interface WallEntity extends EntityBase {
  kind: "wall";
  a: Vec2;
  b: Vec2;
  thickness: number;
  justify: Justify;
  /** Cavity/fill pattern id. */
  fill?: string;
  /** Door/window openings: `at` = distance from `a` along the wall to the opening's centre. */
  openings?: WallOpening[];
}

export interface WallOpening {
  id: Id;
  at: number;
  width: number;
  /** Symbol drawn in the opening (door swing, window), if any. */
  symbolId?: Id;
}

export interface RectEntity extends EntityBase {
  kind: "rect";
  /** Centre of the rectangle. */
  center: Vec2;
  width: number;
  height: number;
  rotation: number;
  cornerRadius: number;
}

export interface CircleEntity extends EntityBase {
  kind: "circle";
  center: Vec2;
  r: number;
}

/** Arc runs CCW from `start` to `end`. */
export interface ArcEntity extends EntityBase {
  kind: "arc";
  center: Vec2;
  r: number;
  start: number;
  end: number;
}

export interface EllipseEntity extends EntityBase {
  kind: "ellipse";
  center: Vec2;
  rx: number;
  ry: number;
  rotation: number;
  /** Partial ellipse: CCW parametric start/end angles. Omitted = full ellipse. */
  start?: number;
  end?: number;
}

/** Any closed straight-sided figure. Centre is always derived from the points (never stored). */
export interface PolygonEntity extends EntityBase {
  kind: "polygon";
  points: Vec2[];
  /** True when drawn by the Regular Polygon tool (keeps reshape handles regular). */
  regular?: boolean;
}

export interface SplineEntity extends EntityBase {
  kind: "spline";
  /** Control points (bspline) or fit points the curve passes through (interpolated). */
  points: Vec2[];
  mode: "bspline" | "interpolated";
  closed: boolean;
  /** B-spline degree (default 3, capped at points-1). */
  degree?: number;
  /** Explicit knot vector (DXF import). Omitted = clamped uniform (open) or uniform periodic (closed). */
  knots?: number[];
  /** Rational weights (NURBS), one per control point. Omitted = all 1. */
  weights?: number[];
}

/** Infinite construction line (Graphic Guide). */
export interface GuideEntity extends EntityBase {
  kind: "guide";
  point: Vec2;
  dir: Vec2;
}

export type DimensionType =
  | "horizontal"
  | "vertical"
  | "aligned"
  | "angular"
  | "radius"
  | "diameter"
  | "centerMark";

/**
 * Associative link to a point on another entity.
 * Vertex handles are indices ("vertex:3"), so every command that inserts, removes or
 * splits vertices (trim, split, reshape) must remap the refs that point at it in the
 * same undoable step. The command stack owns that (Milestone 3).
 */
export interface DimRef {
  entityId: Id;
  /** Which point: "a", "b", "center", "vertex:3", ... (resolved by the dimension solver). */
  handle: string;
}

export interface DimensionEntity extends EntityBase {
  kind: "dimension";
  dimType: DimensionType;
  /** Definition points (used when refs are missing or broken). */
  points: Vec2[];
  refs: (DimRef | null)[];
  /** Where the dimension line sits. */
  linePoint: Vec2;
  textOverride?: string;
  /** Chain/baseline group id. */
  groupId?: Id;
}

export interface SymbolInstanceEntity extends EntityBase {
  kind: "symbol";
  symbolId: Id;
  position: Vec2;
  rotation: number;
  /** Scale along the symbol's own x/y axes (applied before rotation). Negative = mirrored. */
  scaleX: number;
  scaleY: number;
}

export type Entity =
  | LineEntity
  | PolylineEntity
  | DoubleLineEntity
  | WallEntity
  | RectEntity
  | CircleEntity
  | ArcEntity
  | EllipseEntity
  | PolygonEntity
  | SplineEntity
  | GuideEntity
  | DimensionEntity
  | SymbolInstanceEntity;

export type EntityKind = Entity["kind"];

export interface Layer {
  id: Id;
  name: string;
  visible: boolean;
  locked: boolean;
  color?: string;
  /**
   * Drawing scale as model units per paper unit, e.g. 48 for 1/4" = 1'-0".
   * All layers share one millimetre model space, so geometry, snapping and
   * intersections ignore this. It only affects how the layer is shown/printed
   * on the sheet and the paper size of its annotations (text, arrows, hatch spacing).
   */
  scale: number;
}

export interface SymbolDef {
  id: Id;
  name: string;
  /** Insertion point in the symbol's own coordinates. */
  origin: Vec2;
  entities: Entity[];
}

export type UnitSystem = "architectural" | "engineering" | "inches" | "feet" | "mm" | "cm" | "m";

export type DraftingStandard = "ANSI" | "ISO" | "DIN" | "JIS" | "BS308";

/** A whole drawing, as saved in .tcad. */
export interface CadDocument {
  /** File-format version; bump on breaking schema changes and add a migration. */
  version: number;
  units: UnitSystem;
  standard: DraftingStandard;
  layers: Layer[];
  activeLayerId: Id;
  /** Draw order: later entities draw on top. */
  entities: Entity[];
  symbols: SymbolDef[];
}

export const DOCUMENT_VERSION = 1;

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
