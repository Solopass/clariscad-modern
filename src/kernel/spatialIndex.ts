// R-tree over entity bounding boxes (rbush). Unbounded entities (Graphic
// Guides) live in a side list and are returned by every query.
import RBush from "rbush";
import type { BBox, Entity, Id } from "./types";
import { type PrimContext, bandOffsets, closestOnPrim, entityBBox, isUnbounded, primsOf } from "./prims";
import type { Vec2 } from "./vec";

interface Item extends BBox {
  id: Id;
}

export class SpatialIndex {
  private tree = new RBush<Item>();
  private items = new Map<Id, Item>();
  private unbounded = new Set<Id>();

  /** Insert or replace an id with a box; a null box means "unbounded". */
  set(id: Id, box: BBox | null): void {
    this.remove(id);
    if (!box) {
      this.unbounded.add(id);
      return;
    }
    const item: Item = { id, ...box };
    this.items.set(id, item);
    this.tree.insert(item);
  }

  remove(id: Id): void {
    const it = this.items.get(id);
    if (it) {
      this.tree.remove(it);
      this.items.delete(id);
    }
    this.unbounded.delete(id);
  }

  clear(): void {
    this.tree.clear();
    this.items.clear();
    this.unbounded.clear();
  }

  get size(): number {
    return this.items.size + this.unbounded.size;
  }

  has(id: Id): boolean {
    return this.items.has(id) || this.unbounded.has(id);
  }

  /** Bulk-load (fast initial build for opened files). */
  load(entries: { id: Id; box: BBox | null }[]): void {
    const batch: Item[] = [];
    for (const { id, box } of entries) {
      this.remove(id);
      if (!box) this.unbounded.add(id);
      else {
        const item = { id, ...box };
        this.items.set(id, item);
        batch.push(item);
      }
    }
    this.tree.load(batch);
  }

  /** Ids whose boxes intersect `box`, plus all unbounded ids. */
  search(box: BBox): Id[] {
    const out = this.tree.search(box).map((i) => i.id);
    for (const id of this.unbounded) out.push(id);
    return out;
  }

  /** Ids whose boxes lie fully inside `box` (window/inside selection). Unbounded ids never qualify. */
  searchInside(box: BBox): Id[] {
    return this.tree
      .search(box)
      .filter((i) => i.minX >= box.minX && i.maxX <= box.maxX && i.minY >= box.minY && i.maxY <= box.maxY)
      .map((i) => i.id);
  }

  /** Ids within `radius` of `p` by box (candidates only; use EntityIndex.nearest for exact distance). */
  around(p: Vec2, radius: number): Id[] {
    return this.search({ minX: p.x - radius, minY: p.y - radius, maxX: p.x + radius, maxY: p.y + radius });
  }
}

/** Spatial index that also knows the entities, so it can answer exact-distance queries. */
export class EntityIndex {
  readonly spatial = new SpatialIndex();
  private entities = new Map<Id, Entity>();

  constructor(
    entities: Iterable<Entity> = [],
    public ctx?: PrimContext,
  ) {
    const entries: { id: Id; box: BBox | null }[] = [];
    for (const e of entities) {
      this.entities.set(e.id, e);
      const box = isUnbounded(e) ? null : entityBBox(e, ctx);
      if (box || isUnbounded(e)) entries.push({ id: e.id, box });
    }
    this.spatial.load(entries);
  }

  upsert(e: Entity): void {
    this.entities.set(e.id, e);
    if (isUnbounded(e)) return this.spatial.set(e.id, null);
    const box = entityBBox(e, this.ctx);
    // Entities with no geometry (e.g. a symbol whose definition is missing) stay out of the tree.
    if (box) this.spatial.set(e.id, box);
    else this.spatial.remove(e.id);
  }

  /** Re-index every instance of a symbol after its definition changed. */
  reindexSymbol(symbolId: Id): void {
    for (const e of this.entities.values()) if (e.kind === "symbol" && e.symbolId === symbolId) this.upsert(e);
  }

  remove(id: Id): void {
    this.entities.delete(id);
    this.spatial.remove(id);
  }

  get(id: Id): Entity | undefined {
    return this.entities.get(id);
  }

  all(): IterableIterator<Entity> {
    return this.entities.values();
  }

  around(p: Vec2, radius: number): Entity[] {
    return this.spatial
      .around(p, radius)
      .map((id) => this.entities.get(id))
      .filter((e): e is Entity => !!e);
  }

  /** Exact distance from a point to an entity's geometry. */
  distanceTo(e: Entity, p: Vec2): number {
    if (e.kind === "wall") {
      const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
      if (len > 0) {
        const dx = (e.b.x - e.a.x) / len;
        const dy = (e.b.y - e.a.y) / len;
        const u = (p.x - e.a.x) * dx + (p.y - e.a.y) * dy;
        const o = -(p.x - e.a.x) * dy + (p.y - e.a.y) * dx;
        const [lo, hi] = bandOffsets(e.thickness, e.justify);
        if (u >= 0 && u <= len && o >= lo && o <= hi) return 0;
      }
    }
    let best = Infinity;
    for (const prim of primsOf(e, this.ctx)) best = Math.min(best, closestOnPrim(prim, p).distance);
    return best;
  }

  /** Entities within `radius` of `p`, nearest first. */
  nearest(p: Vec2, radius: number, filter?: (e: Entity) => boolean): { entity: Entity; distance: number }[] {
    const out: { entity: Entity; distance: number }[] = [];
    for (const e of this.around(p, radius)) {
      if (filter && !filter(e)) continue;
      const d = this.distanceTo(e, p);
      if (d <= radius) out.push({ entity: e, distance: d });
    }
    return out.sort((a, b) => a.distance - b.distance);
  }
}
