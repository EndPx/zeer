import pg, { type PoolClient } from "pg";
import { encodeEntity, decodeEntity } from "./schema.js";
import type { ChefStore, Checkpoint, EntityAccess, PublicBlock, ReadView, StoredEntity, StoreOptions } from "./types.js";

type State = { fingerprint: string; model: string; network: string; start_height: number; height: number | null; hash: string | null; anchor_hash: string | null; status: Checkpoint["status"]; reorg_window: number };
const MAX_MUTATIONS = 10_000;
const hashPattern = /^[0-9a-f]{64}$/;

export class StoreNotReadyError extends Error {
  readonly code = "CHEF_NOT_READY";
  constructor(status: Checkpoint["status"]) {
    super(`Chef project is ${status}`);
    this.name = "StoreNotReadyError";
  }
}

/** Each project owns one marked namespace. No user tables are discovered or changed. */
export class PostgresStore implements ChefStore {
  private readonly pool: pg.Pool;
  private readonly namespace: string;
  private readonly sql: string;
  private writer: PoolClient | null = null;
  private busy = false;
  private closed = false;
  private writerError: Error | null = null;

  constructor(connectionString: string, private readonly options: StoreOptions) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(options.project)) throw new Error("Invalid Chef project name");
    if (!Number.isInteger(options.startHeight) || options.startHeight < 0 || options.startHeight > 0xffff_ffff) throw new Error("Invalid startHeight");
    if (!Number.isInteger(options.reorgWindow) || options.reorgWindow < 1 || options.reorgWindow > 1000) throw new Error("reorgWindow must be 1..1000");
    this.namespace = `chef_${options.project}`;
    this.sql = `"${this.namespace}"`;
    this.pool = new pg.Pool({ connectionString, max: 6, connectionTimeoutMillis: 5000 });
    // Idle connection failures must not crash the application; subsequent operations reconnect.
    this.pool.on("error", () => {});
  }

  private ensureOpen(): void { if (this.closed) throw new Error("Chef store is closed"); }
  private async state(client: PoolClient, lock = false): Promise<State> {
    const result = await client.query<State>(`SELECT * FROM ${this.sql}.state WHERE singleton = true${lock ? " FOR UPDATE" : ""}`);
    const row = result.rows[0];
    const value = row && { ...row, start_height: Number(row.start_height), height: row.height === null ? null : Number(row.height) };
    if (!value || value.fingerprint !== this.options.fingerprint || value.model !== this.options.model.fingerprint || value.network !== this.options.network || value.start_height !== this.options.startHeight || value.reorg_window !== this.options.reorgWindow) {
      throw new Error("Chef project identity mismatch; use a new project namespace");
    }
    return value;
  }
  private checkpointOf(state: State): Checkpoint {
    return { height: state.height, hash: state.hash, anchorHash: state.anchor_hash, status: state.status };
  }
  private entity(name: string): void {
    if (!Object.hasOwn(this.options.model.entities, name)) throw new Error(`Unknown entity: ${name}`);
  }
  private id(id: string): void { if (typeof id !== "string" || id.length === 0 || id.includes("\0") || Buffer.byteLength(id, "utf8") > 256) throw new Error("Entity id must contain 1..256 UTF-8 bytes"); }

  async migrate(): Promise<void> {
    this.ensureOpen();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked", [`chef:migrate:${this.namespace}`]);
      if (!lock.rows[0]?.locked) throw new Error("Chef namespace initialization is already in progress");
      const existing = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [this.namespace]);
      if (existing.rowCount) {
        const marker = await client.query<{ relation: string | null }>("SELECT to_regclass($1)::text AS relation", [`${this.namespace}.chef_owned_namespace`]);
        if (!marker.rows[0]?.relation) throw new Error("Refusing existing unmarked database namespace");
        const version = await client.query(`SELECT version FROM ${this.sql}.chef_owned_namespace WHERE singleton = true`);
        if (version.rows[0]?.version !== 1) throw new Error("Unsupported Chef namespace version");
        await this.state(client);
      } else {
        await client.query(`CREATE SCHEMA ${this.sql}`);
        await client.query(`CREATE TABLE ${this.sql}.chef_owned_namespace (singleton boolean PRIMARY KEY CHECK(singleton), version integer NOT NULL)`);
        await client.query(`INSERT INTO ${this.sql}.chef_owned_namespace VALUES (true, 1)`);
        await client.query(`CREATE TABLE ${this.sql}.state (singleton boolean PRIMARY KEY CHECK(singleton), fingerprint text NOT NULL, model text NOT NULL, network text NOT NULL, start_height bigint NOT NULL, reorg_window integer NOT NULL, height bigint, hash text, anchor_hash text, status text NOT NULL CHECK(status IN ('ready','reconciling','blocked')))`);
        await client.query(`CREATE TABLE ${this.sql}.entities (entity text NOT NULL, id text COLLATE "C" NOT NULL, data jsonb NOT NULL, PRIMARY KEY(entity,id))`);
        await client.query(`CREATE TABLE ${this.sql}.blocks (height bigint PRIMARY KEY, hash text NOT NULL)`);
        await client.query(`CREATE TABLE ${this.sql}.undo (height bigint NOT NULL, entity text NOT NULL, id text COLLATE "C" NOT NULL, previous jsonb, PRIMARY KEY(height,entity,id))`);
        await client.query(`INSERT INTO ${this.sql}.state (singleton,fingerprint,model,network,start_height,reorg_window,status) VALUES(true,$1,$2,$3,$4,$5,'ready')`, [this.options.fingerprint, this.options.model.fingerprint, this.options.network, this.options.startHeight, this.options.reorgWindow]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async acquire(): Promise<void> {
    this.ensureOpen();
    if (this.writer) throw new Error("Writer lock already acquired by this store");
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [this.namespace]);
      if (!result.rows[0]?.locked) throw new Error("Chef project already has an active writer");
      await this.state(client);
      this.writerError = null;
      client.on("error", this.onWriterError);
      this.writer = client;
    } catch (error) { client.release(true); throw error; }
  }
  private onWriterError = (error: Error): void => { this.writerError = error; };
  async release(): Promise<void> {
    if (this.busy) throw new Error("Cannot release a busy writer");
    const client = this.writer;
    if (!client) return;
    this.writer = null;
    try { await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [this.namespace]); }
    finally { client.removeListener("error", this.onWriterError); client.release(true); }
  }
  private async write<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    this.ensureOpen();
    if (!this.writer || this.writerError) throw new Error("Acquire a healthy writer lock before mutation");
    if (this.busy) throw new Error("Concurrent Chef writer operation");
    this.busy = true;
    try { return await fn(this.writer); } finally { this.busy = false; }
  }
  private async inspect<T>(fn: (client: PoolClient, state: State) => Promise<T>): Promise<T> {
    this.ensureOpen();
    const client = await this.pool.connect();
    try { return await fn(client, await this.state(client)); } finally { client.release(); }
  }
  async checkpoint(): Promise<Checkpoint> { return this.inspect(async (_client, state) => this.checkpointOf(state)); }
  async blockHash(height: number): Promise<string | null> {
    return this.inspect(async (client, state) => {
      if (height === this.options.startHeight - 1) return state.anchor_hash;
      return (await client.query<{ hash: string }>(`SELECT hash FROM ${this.sql}.blocks WHERE height=$1`, [height])).rows[0]?.hash ?? null;
    });
  }

  async apply(block: PublicBlock, handler: (entities: EntityAccess) => Promise<void>): Promise<void> {
    if (!Number.isInteger(block.height) || block.height < 0 || block.height > 0xffff_ffff || !hashPattern.test(block.hash) || !hashPattern.test(block.previousHash)) throw new Error("Invalid block identity");
    await this.write(async client => {
      await client.query("BEGIN");
      let active = true;
      let mutations = 0;
      let operationError: unknown;
      const pending = new Set<Promise<unknown>>();
      const track = <T>(fn: () => Promise<T>): Promise<T> => {
        if (!active) return Promise.reject(new Error("Entity context is no longer active"));
        const result = fn();
        pending.add(result);
        void result.then(() => pending.delete(result), error => { pending.delete(result); operationError ??= error; });
        return result;
      };
      const drain = async (): Promise<void> => { while (pending.size) await Promise.allSettled([...pending]); };
      try {
        const state = await this.state(client, true);
        if (state.status === "blocked") throw new Error("Chef project is blocked");
        if (state.height !== null && block.height <= state.height) {
          const existing = await client.query<{ hash: string }>(`SELECT hash FROM ${this.sql}.blocks WHERE height=$1`, [block.height]);
          if (existing.rows[0]?.hash !== block.hash) throw new Error("Block conflicts with checkpoint or falls outside retained journal");
          active = false;
          await client.query("COMMIT");
          return;
        }
        if (block.height !== (state.height === null ? this.options.startHeight : state.height + 1)) throw new Error("Non-contiguous block height");
        if (state.hash !== null && state.hash !== block.previousHash) throw new Error("Block parent does not match checkpoint");
        if (state.height === null && state.anchor_hash !== null && state.anchor_hash !== block.previousHash) throw new Error("Block parent does not match retained anchor");
        const before = async (entity: string, id: string): Promise<void> => {
          this.entity(entity); this.id(id);
          if (++mutations > MAX_MUTATIONS) throw new Error("Block entity mutation limit exceeded");
          await client.query(`INSERT INTO ${this.sql}.undo(height,entity,id,previous) VALUES($1,$2,$3,(SELECT data FROM ${this.sql}.entities WHERE entity=$2 AND id=$3)) ON CONFLICT DO NOTHING`, [block.height, entity, id]);
        };
        const entities: EntityAccess = {
          get: (entity, id) => track(async () => {
            this.entity(entity); this.id(id);
            const data = (await client.query<{ data: StoredEntity }>(`SELECT data FROM ${this.sql}.entities WHERE entity=$1 AND id=$2`, [entity, id])).rows[0]?.data;
            return data ? decodeEntity(this.options.model, entity, data) : null;
          }),
          set: (entity, value) => track(async () => {
            this.entity(entity);
            const data = encodeEntity(this.options.model, entity, value);
            await before(entity, data.id);
            await client.query(`INSERT INTO ${this.sql}.entities(entity,id,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(entity,id) DO UPDATE SET data=EXCLUDED.data`, [entity, data.id, JSON.stringify(data)]);
          }),
          delete: (entity, id) => track(async () => {
            await before(entity, id);
            await client.query(`DELETE FROM ${this.sql}.entities WHERE entity=$1 AND id=$2`, [entity, id]);
          }),
        };
        await handler(entities);
        await drain();
        active = false;
        if (operationError !== undefined) throw operationError;
        await client.query(`INSERT INTO ${this.sql}.blocks VALUES($1,$2)`, [block.height, block.hash]);
        await client.query(`UPDATE ${this.sql}.state SET height=$1,hash=$2,anchor_hash=COALESCE(anchor_hash,$3) WHERE singleton=true`, [block.height, block.hash, block.previousHash]);
        const boundary = block.height - this.options.reorgWindow;
        await client.query(`DELETE FROM ${this.sql}.undo WHERE height <= $1`, [boundary]);
        await client.query(`DELETE FROM ${this.sql}.blocks WHERE height < $1`, [boundary]);
        await client.query("COMMIT");
      } catch (error) {
        active = false;
        await drain();
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally { active = false; }
    });
  }

  private async status(status: Checkpoint["status"]): Promise<void> {
    await this.write(async client => {
      await this.state(client);
      await client.query(`UPDATE ${this.sql}.state SET status=$1 WHERE singleton=true`, [status]);
    });
  }
  async markReconciling(): Promise<void> { await this.status("reconciling"); }
  async markReady(): Promise<void> { await this.status("ready"); }
  async markBlocked(): Promise<void> { await this.status("blocked"); }
  async rollback(height: number, hash: string): Promise<void> {
    if (!Number.isInteger(height) || !hashPattern.test(hash)) throw new Error("Invalid rollback ancestor");
    await this.write(async client => {
      await client.query("BEGIN");
      try {
        const state = await this.state(client, true);
        if (state.status !== "reconciling") throw new Error("Mark project reconciling before rollback");
        if (state.height === null || height > state.height || height < Math.max(this.options.startHeight - 1, state.height - this.options.reorgWindow)) throw new Error("Rollback ancestor outside retained window");
        const expected = height === this.options.startHeight - 1 ? state.anchor_hash : (await client.query<{ hash: string }>(`SELECT hash FROM ${this.sql}.blocks WHERE height=$1`, [height])).rows[0]?.hash;
        if (expected !== hash) throw new Error("Rollback ancestor hash mismatch");
        // Restore in bounded keyset pages, without loading the entire reorg journal.
        for (let undoHeight = state.height; undoHeight > height; undoHeight--) {
          let afterEntity = "";
          let afterId = "";
          while (true) {
            const undo = await client.query<{ entity: string; id: string; previous: StoredEntity | null }>(`SELECT entity,id,previous FROM ${this.sql}.undo WHERE height=$1 AND (entity COLLATE "C",id)>($2::text COLLATE "C",$3::text COLLATE "C") ORDER BY entity COLLATE "C",id LIMIT 100`, [undoHeight, afterEntity, afterId]);
            for (const row of undo.rows) {
              if (row.previous === null) await client.query(`DELETE FROM ${this.sql}.entities WHERE entity=$1 AND id=$2`, [row.entity, row.id]);
              else await client.query(`INSERT INTO ${this.sql}.entities(entity,id,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(entity,id) DO UPDATE SET data=EXCLUDED.data`, [row.entity, row.id, JSON.stringify(row.previous)]);
            }
            const last = undo.rows.at(-1);
            if (!last || undo.rows.length < 100) break;
            afterEntity = last.entity;
            afterId = last.id;
          }
        }
        await client.query(`DELETE FROM ${this.sql}.undo WHERE height>$1`, [height]);
        await client.query(`DELETE FROM ${this.sql}.blocks WHERE height>$1`, [height]);
        const empty = height === this.options.startHeight - 1;
        await client.query(`UPDATE ${this.sql}.state SET height=$1,hash=$2 WHERE singleton=true`, [empty ? null : height, empty ? null : hash]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    });
  }

  async read<T>(handler: (view: ReadView) => Promise<T>): Promise<T> {
    this.ensureOpen();
    const client = await this.pool.connect();
    let active = true;
    const check = (entity: string): void => { if (!active) throw new Error("Read context is no longer active"); this.entity(entity); };
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SET LOCAL statement_timeout = 5000");
      const state = await this.state(client);
      if (state.status !== "ready") throw new StoreNotReadyError(state.status);
      const view: ReadView = {
        checkpoint: this.checkpointOf(state),
        get: async (entity, id) => {
          check(entity); this.id(id);
          return (await client.query<{ data: StoredEntity }>(`SELECT data FROM ${this.sql}.entities WHERE entity=$1 AND id=$2`, [entity, id])).rows[0]?.data ?? null;
        },
        list: async (entity, options) => {
          check(entity);
          if (!Number.isInteger(options.first) || options.first < 1 || options.first > 101) throw new Error("first must be 1..101");
          const values: unknown[] = [entity];
          const clauses = ["entity=$1"];
          if (options.after !== undefined) { this.id(options.after); values.push(options.after); clauses.push(`id > $${values.length}`); }
          for (const [field, value] of Object.entries(options.where ?? {})) {
            const definition = this.options.model.entities[entity]?.fields[field];
            if (!definition || !Object.hasOwn(this.options.model.entities[entity]!.fields, field)) throw new Error(`Unknown filter field: ${field}`);
            let encoded: unknown = value;
            if (value === null) { if (definition.required) throw new Error("Required filter field cannot be null"); }
            else if (definition.scalar === "BigInt") { const integer = typeof value === "bigint" ? value.toString() : value; if (typeof integer !== "string" || !/^(0|-?[1-9][0-9]{0,127})$/.test(integer)) throw new Error("Invalid BigInt filter"); encoded = integer; }
            else if (definition.scalar === "Int") { if (!Number.isInteger(value) || (value as number) < -2147483648 || (value as number) > 2147483647) throw new Error("Invalid Int filter"); }
            else if (definition.scalar === "Boolean") { if (typeof value !== "boolean") throw new Error("Invalid Boolean filter"); }
            else if (typeof value !== "string" || value.includes("\0") || Buffer.byteLength(value, "utf8") > (definition.scalar === "ID" ? 256 : 16384) || (definition.scalar === "ID" && !value.length)) throw new Error("Invalid string filter");
            values.push(field, JSON.stringify(encoded));
            clauses.push(`data -> $${values.length - 1}::text = $${values.length}::jsonb`);
          }
          values.push(options.first);
          return (await client.query<{ data: StoredEntity }>(`SELECT data FROM ${this.sql}.entities WHERE ${clauses.join(" AND ")} ORDER BY id ASC LIMIT $${values.length}`, values)).rows.map(row => row.data);
        },
      };
      const result = await handler(view);
      active = false;
      await client.query("COMMIT");
      return result;
    } catch (error) { active = false; await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { active = false; client.release(); }
  }
  async close(): Promise<void> { if (this.closed) return; await this.release(); this.closed = true; await this.pool.end(); }
}
