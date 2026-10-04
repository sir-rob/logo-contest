/**
 * A small in-memory stand-in for `Firestore`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 * The anonymity guarantees in 01-SPEC.md §6 are properties of what the HTTP
 * layer puts on the wire. Testing them therefore requires real routes, real
 * DTO projections and real `.parse()` calls — but no emulator is available in
 * CI, and mocking each route's Firestore calls one by one would let a leak
 * hide in the mock rather than in the code.
 *
 * So this fake implements the *narrow* slice of the Firestore surface the API
 * actually uses, faithfully enough that `buildApp()` runs unmodified:
 *
 *   collection / doc / get / set / update / delete
 *   where / orderBy / limit / select / count
 *   withConverter (including `withConverter(null)`)
 *   getAll, runTransaction
 *   FieldValue.delete()
 *
 * Two behaviours matter for privacy tests specifically and are implemented
 * deliberately rather than incidentally:
 *
 *   • `.select(...)` really does drop the unselected fields from the returned
 *     snapshot. `/admin/turnout` relies on that projection to keep `ranking`
 *     out of the process; a fake that returned whole documents would make the
 *     turnout test pass for the wrong reason.
 *   • `withConverter(null)` really does strip the converter, so a raw read
 *     yields raw stored data.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';

// ---------------------------------------------------------------------------
// Stored representation
// ---------------------------------------------------------------------------

export type StoredDoc = Record<string, unknown>;

type WhereOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains';

interface WhereClause {
  field: string;
  op: WhereOp;
  value: unknown;
}

interface OrderClause {
  field: string;
  dir: 'asc' | 'desc';
}

/** Structural shape of a Firestore converter, enough for our purposes. */
export interface FakeConverter<T> {
  toFirestore(model: T): StoredDoc;
  fromFirestore(snapshot: { id: string; data(): StoredDoc }): T;
}

/** Deep clone that preserves `Date` and `Timestamp` instances. */
function cloneValue(value: unknown): unknown {
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Timestamp) return value;
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    const out: StoredDoc = {};
    for (const [k, v] of Object.entries(value as StoredDoc)) out[k] = cloneValue(v);
    return out;
  }
  return value;
}

function isDeleteSentinel(value: unknown): boolean {
  // `FieldValue.delete()` returns a private subclass; identify it structurally
  // rather than by name so a firebase-admin minor bump does not break us.
  if (!(value instanceof FieldValue)) return false;
  return String((value as { constructor?: { name?: string } }).constructor?.name ?? '')
    .toLowerCase()
    .includes('delete');
}

function comparable(value: unknown): number | string {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return String(value);
}

function matches(doc: StoredDoc, clause: WhereClause): boolean {
  const actual = readPath(doc, clause.field);
  switch (clause.op) {
    case '==':
      return comparable(actual) === comparable(clause.value);
    case '!=':
      return comparable(actual) !== comparable(clause.value);
    case '<':
      return comparable(actual) < comparable(clause.value);
    case '<=':
      return comparable(actual) <= comparable(clause.value);
    case '>':
      return comparable(actual) > comparable(clause.value);
    case '>=':
      return comparable(actual) >= comparable(clause.value);
    case 'in':
      return Array.isArray(clause.value) && clause.value.some((v) => comparable(v) === comparable(actual));
    case 'array-contains':
      return Array.isArray(actual) && actual.some((v) => comparable(v) === comparable(clause.value));
  }
}

/** Read a (possibly dotted) field path out of a stored document. */
function readPath(doc: StoredDoc, path: string): unknown {
  let cursor: unknown = doc;
  for (const segment of path.split('.')) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as StoredDoc)[segment];
  }
  return cursor;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export class FakeDocumentSnapshot<T = StoredDoc> {
  constructor(
    readonly id: string,
    readonly ref: FakeDocumentReference<T>,
    private readonly raw: StoredDoc | null,
    private readonly converter: FakeConverter<T> | null,
  ) {}

  get exists(): boolean {
    return this.raw !== null;
  }

  data(): T | undefined {
    if (this.raw === null) return undefined;
    if (this.converter) {
      return this.converter.fromFirestore({ id: this.id, data: () => cloneValue(this.raw) as StoredDoc });
    }
    return cloneValue(this.raw) as T;
  }

  /** Field accessor, as used by the turnout route on projected snapshots. */
  get(field: string): unknown {
    if (this.raw === null) return undefined;
    return cloneValue(readPath(this.raw, field));
  }
}

export class FakeQuerySnapshot<T = StoredDoc> {
  constructor(readonly docs: FakeDocumentSnapshot<T>[]) {}

  get empty(): boolean {
    return this.docs.length === 0;
  }

  get size(): number {
    return this.docs.length;
  }

  forEach(fn: (doc: FakeDocumentSnapshot<T>) => void): void {
    this.docs.forEach(fn);
  }
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

export class FakeDocumentReference<T = StoredDoc> {
  constructor(
    private readonly store: FakeFirestore,
    readonly collectionName: string,
    readonly id: string,
    private readonly converter: FakeConverter<T> | null,
  ) {}

  get path(): string {
    return `${this.collectionName}/${this.id}`;
  }

  withConverter<U>(converter: FakeConverter<U> | null): FakeDocumentReference<U> {
    return new FakeDocumentReference<U>(this.store, this.collectionName, this.id, converter);
  }

  async get(): Promise<FakeDocumentSnapshot<T>> {
    return this.getSync();
  }

  getSync(): FakeDocumentSnapshot<T> {
    const raw = this.store.readRaw(this.collectionName, this.id);
    return new FakeDocumentSnapshot<T>(this.id, this, raw, this.converter);
  }

  async set(value: T, options?: { merge?: boolean }): Promise<void> {
    this.setSync(value, options);
  }

  setSync(value: T, options?: { merge?: boolean }): void {
    const data = this.converter ? this.converter.toFirestore(value) : (value as unknown as StoredDoc);
    if (options?.merge) {
      const existing = this.store.readRaw(this.collectionName, this.id) ?? {};
      this.store.writeRaw(this.collectionName, this.id, applyPatch({ ...existing }, data));
      return;
    }
    this.store.writeRaw(this.collectionName, this.id, cloneValue(stripUndefined(data)) as StoredDoc);
  }

  async update(patch: StoredDoc): Promise<void> {
    this.updateSync(patch);
  }

  updateSync(patch: StoredDoc): void {
    const existing = this.store.readRaw(this.collectionName, this.id);
    if (existing === null) throw new Error(`NOT_FOUND: no document at ${this.path}`);
    this.store.writeRaw(this.collectionName, this.id, applyPatch({ ...existing }, patch));
  }

  async delete(): Promise<void> {
    this.deleteSync();
  }

  deleteSync(): void {
    this.store.deleteRaw(this.collectionName, this.id);
  }
}

/** Apply an `update()` patch, honouring dotted paths and delete sentinels. */
function applyPatch(target: StoredDoc, patch: StoredDoc): StoredDoc {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (isDeleteSentinel(value)) {
      deletePath(target, key);
      continue;
    }
    writePath(target, key, cloneValue(value));
  }
  return target;
}

function stripUndefined(doc: StoredDoc): StoredDoc {
  const out: StoredDoc = {};
  for (const [k, v] of Object.entries(doc)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function writePath(target: StoredDoc, path: string, value: unknown): void {
  const parts = path.split('.');
  const last = parts.pop();
  if (last === undefined) return;
  let cursor = target;
  for (const part of parts) {
    const next = cursor[part];
    if (!next || typeof next !== 'object') cursor[part] = {};
    cursor = cursor[part] as StoredDoc;
  }
  cursor[last] = value;
}

function deletePath(target: StoredDoc, path: string): void {
  const parts = path.split('.');
  const last = parts.pop();
  if (last === undefined) return;
  let cursor: StoredDoc | undefined = target;
  for (const part of parts) {
    const next: unknown = cursor?.[part];
    if (!next || typeof next !== 'object') return;
    cursor = next as StoredDoc;
  }
  if (cursor) delete cursor[last];
}

export class FakeQuery<T = StoredDoc> {
  constructor(
    protected readonly store: FakeFirestore,
    readonly collectionName: string,
    protected readonly converter: FakeConverter<T> | null,
    protected readonly wheres: readonly WhereClause[] = [],
    protected readonly orders: readonly OrderClause[] = [],
    protected readonly limitCount: number | null = null,
    protected readonly selected: readonly string[] | null = null,
  ) {}

  where(field: string, op: WhereOp, value: unknown): FakeQuery<T> {
    return this.derive({ wheres: [...this.wheres, { field, op, value }] });
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): FakeQuery<T> {
    return this.derive({ orders: [...this.orders, { field, dir }] });
  }

  limit(count: number): FakeQuery<T> {
    return this.derive({ limitCount: count });
  }

  /**
   * A real field-mask projection: unselected fields are NOT present on the
   * resulting snapshots. `/admin/turnout` depends on this to keep `ranking`
   * out of the handler entirely.
   */
  select(...fields: string[]): FakeQuery<StoredDoc> {
    return new FakeQuery<StoredDoc>(
      this.store,
      this.collectionName,
      null,
      this.wheres,
      this.orders,
      this.limitCount,
      fields,
    );
  }

  withConverter<U>(converter: FakeConverter<U> | null): FakeQuery<U> {
    return new FakeQuery<U>(
      this.store,
      this.collectionName,
      converter,
      this.wheres,
      this.orders,
      this.limitCount,
      this.selected,
    );
  }

  /** Aggregation query. Only the count is ever materialised. */
  count(): { get(): Promise<{ data(): { count: number } }> } {
    return {
      get: async () => {
        const rows = this.evaluate();
        return { data: () => ({ count: rows.length }) };
      },
    };
  }

  async get(): Promise<FakeQuerySnapshot<T>> {
    const rows = this.evaluate();
    return new FakeQuerySnapshot<T>(
      rows.map(
        ([id, raw]) =>
          new FakeDocumentSnapshot<T>(
            id,
            new FakeDocumentReference<T>(this.store, this.collectionName, id, this.converter),
            this.project(raw),
            this.converter,
          ),
      ),
    );
  }

  protected project(raw: StoredDoc): StoredDoc {
    if (this.selected === null) return raw;
    const out: StoredDoc = {};
    for (const field of this.selected) {
      const value = readPath(raw, field);
      if (value !== undefined) writePath(out, field, value);
    }
    return out;
  }

  protected evaluate(): Array<[string, StoredDoc]> {
    let rows = [...this.store.entries(this.collectionName)];
    for (const clause of this.wheres) {
      rows = rows.filter(([, raw]) => matches(raw, clause));
    }
    for (const order of [...this.orders].reverse()) {
      rows.sort(([, a], [, b]) => {
        const av = comparable(readPath(a, order.field));
        const bv = comparable(readPath(b, order.field));
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return order.dir === 'desc' ? -cmp : cmp;
      });
    }
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    return rows;
  }

  private derive(patch: {
    wheres?: readonly WhereClause[];
    orders?: readonly OrderClause[];
    limitCount?: number | null;
  }): FakeQuery<T> {
    return new FakeQuery<T>(
      this.store,
      this.collectionName,
      this.converter,
      patch.wheres ?? this.wheres,
      patch.orders ?? this.orders,
      patch.limitCount === undefined ? this.limitCount : patch.limitCount,
      this.selected,
    );
  }
}

export class FakeCollectionReference<T = StoredDoc> extends FakeQuery<T> {
  doc(id?: string): FakeDocumentReference<T> {
    return new FakeDocumentReference<T>(
      this.store,
      this.collectionName,
      id ?? `auto_${(autoIdCounter += 1).toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      this.converter,
    );
  }

  override withConverter<U>(converter: FakeConverter<U> | null): FakeCollectionReference<U> {
    return new FakeCollectionReference<U>(this.store, this.collectionName, converter);
  }

  async add(value: T): Promise<FakeDocumentReference<T>> {
    const ref = this.doc();
    await ref.set(value);
    return ref;
  }
}

let autoIdCounter = 0;

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export class FakeTransaction {
  async get<T>(target: FakeDocumentReference<T> | FakeQuery<T>): Promise<unknown> {
    return target.get();
  }

  async getAll<T>(...refs: FakeDocumentReference<T>[]): Promise<FakeDocumentSnapshot<T>[]> {
    return Promise.all(refs.map((r) => r.get()));
  }

  set<T>(ref: FakeDocumentReference<T>, value: T, options?: { merge?: boolean }): FakeTransaction {
    ref.setSync(value, options);
    return this;
  }

  update<T>(ref: FakeDocumentReference<T>, patch: StoredDoc): FakeTransaction {
    ref.updateSync(patch);
    return this;
  }

  delete<T>(ref: FakeDocumentReference<T>): FakeTransaction {
    ref.deleteSync();
    return this;
  }
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export class FakeFirestore {
  private readonly collections = new Map<string, Map<string, StoredDoc>>();

  collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(this, name, null);
  }

  doc(path: string): FakeDocumentReference {
    const [collectionName, ...rest] = path.split('/');
    return new FakeDocumentReference(this, collectionName ?? '', rest.join('/'), null);
  }

  async getAll<T>(...refs: FakeDocumentReference<T>[]): Promise<FakeDocumentSnapshot<T>[]> {
    // Mirrors the real `Firestore.getAll`, which erases the per-ref converter
    // and returns untyped snapshots. The moderation route re-parses by hand
    // precisely because of that, so the fake must behave the same way.
    return Promise.all(
      refs.map(async (ref) => {
        const stripped = ref.withConverter<T>(null);
        return stripped.get();
      }),
    );
  }

  async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    return fn(new FakeTransaction());
  }

  batch(): {
    set<T>(ref: FakeDocumentReference<T>, value: T, options?: { merge?: boolean }): void;
    update<T>(ref: FakeDocumentReference<T>, patch: StoredDoc): void;
    delete<T>(ref: FakeDocumentReference<T>): void;
    commit(): Promise<void>;
  } {
    const ops: Array<() => void> = [];
    return {
      set: (ref, value, options) => void ops.push(() => ref.setSync(value, options)),
      update: (ref, patch) => void ops.push(() => ref.updateSync(patch)),
      delete: (ref) => void ops.push(() => ref.deleteSync()),
      commit: async () => {
        for (const op of ops) op();
      },
    };
  }

  settings(): void {
    /* no-op */
  }

  // -- raw access used by the reference classes and by test seeding ---------

  readRaw(collectionName: string, id: string): StoredDoc | null {
    const raw = this.collections.get(collectionName)?.get(id);
    return raw === undefined ? null : raw;
  }

  writeRaw(collectionName: string, id: string, doc: StoredDoc): void {
    let col = this.collections.get(collectionName);
    if (!col) {
      col = new Map<string, StoredDoc>();
      this.collections.set(collectionName, col);
    }
    col.set(id, doc);
  }

  deleteRaw(collectionName: string, id: string): void {
    this.collections.get(collectionName)?.delete(id);
  }

  entries(collectionName: string): Array<[string, StoredDoc]> {
    return [...(this.collections.get(collectionName)?.entries() ?? [])];
  }

  /** Direct seeding helper — bypasses converters on purpose. */
  seed(collectionName: string, id: string, doc: StoredDoc): void {
    this.writeRaw(collectionName, id, cloneValue(doc) as StoredDoc);
  }

  reset(): void {
    this.collections.clear();
  }
}
