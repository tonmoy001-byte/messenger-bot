/**
 * supabaseClient.js
 * ─────────────────────────────────────────────────────────────
 * Supabase client + Mongoose-like query wrapper with multi-tenant scoping and soft delete.
 * Drop-in replacement for Mongoose models with minimal code changes.
 * ─────────────────────────────────────────────────────────────
 */

const { createClient } = require("@supabase/supabase-js");
const { getTenantContext } = require("../../utils/tenantContext");
require("dotenv").config();
// Load env config so test-mode placeholder vars are set before the FATAL check.
require("./env");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("FATAL: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

const MULTI_TENANT_TABLES = [
  "admins",
  "users",
  "products",
  "orders",
  "knowledge_base",
  "messages",
  "integrations",
  "tenant_channels",
  "settings",
  "order_sessions",
  "payments",
  "broadcasts",
  "templates",
  "ecommerce_connections",
  "feedback",
  "conversation_analytics",
  "ads",
  "ad_clicks",
  "conversation_handoffs",
  "conversation_handoff_events"
];

// Registry/mapping tables legitimately queried before a tenant context exists.
// ("tenants" is NOT in MULTI_TENANT_TABLES — it is special-cased in applyFilter;
//  "tenant_channels" is in MULTI_TENANT_TABLES but allowlisted here.)
const ALLOWLIST_TABLES = ["tenants", "tenant_channels"];

class TenantContextError extends Error {
  constructor(tableName) {
    super(`Missing tenant context: query on "${tableName}" requires a tenant context`);
    this.name = "TenantContextError";
    this.statusCode = 500;
  }
}

function requireTenantScope(tableName) {
  if (!MULTI_TENANT_TABLES.includes(tableName)) return;
  if (ALLOWLIST_TABLES.includes(tableName)) return;
  const ctx = getTenantContext();
  if (ctx && ctx.tenant_id) return;
  if (ctx && ctx.isSuperAdmin) return;
  if (process.env.NODE_ENV === "production") {
    throw new TenantContextError(tableName);
  }
  console.warn(`[TenantScope] ${tableName} queried without tenant context (dev mode)`);
}

/**
 * Convert value to ISO string if it's a Date object.
 * Prevents "gmt+0600" timezone errors with Supabase/PostgreSQL.
 */
function toISODate(val) {
  if (val instanceof Date) return val.toISOString();
  return val;
}

/**
 * Convert Mongoose-style filter to Supabase query filter.
 * Handles: { field: value }, { $or: [...] }, { field: { $regex: ... } }
 */
function toPostgrestColumn(key) {
  if (!key.includes(".")) return key;
  const parts = key.split(".");
  if (parts.length === 2) return `${parts[0]}->>${parts[1]}`;
  return parts[0] + parts.slice(1, -1).map(p => `->${p}`).join("") + `->>${parts[parts.length - 1]}`;
}

function applyFilter(query, filter, tableName) {
  requireTenantScope(tableName);
  // Apply tenant scoping & soft-delete filtering first
  const ctx = getTenantContext();
  if (ctx && ctx.tenant_id) {
    if (tableName === "tenants") {
      query = query.eq("id", ctx.tenant_id).is("deleted_at", null);
    } else if (MULTI_TENANT_TABLES.includes(tableName)) {
      query = query.eq("tenant_id", ctx.tenant_id).is("deleted_at", null);
    }
  } else {
    // If no context exists but it's not a superadmin, filter out soft-deleted records by default
    if (!ctx || !ctx.isSuperAdmin) {
      if (tableName === "tenants") {
        query = query.is("deleted_at", null);
      } else if (MULTI_TENANT_TABLES.includes(tableName)) {
        query = query.is("deleted_at", null);
      }
    }
  }

  if (!filter) return query;

  for (const [key, value] of Object.entries(filter)) {
    // Avoid duplicating tenant_id/deleted_at conditions if already handled
    if (ctx && ctx.tenant_id) {
      if (key === "tenant_id" || key === "deleted_at") continue;
    }

    const col = toPostgrestColumn(key);
    if (key === "$or") {
      // Supabase doesn't support OR natively in chain; use .or()
      const orParts = value.map(cond => {
        const [k, v] = Object.entries(cond)[0];
        const ok = toPostgrestColumn(k);
        if (v && typeof v === "object" && v.$regex) {
          return `${ok}.ilike.*${v.$regex}*`;
        }
        if (v && typeof v === "object" && v.$in) {
          return `${ok}.in.(${v.$in.join(",")})`;
        }
        if (v === null) return `${ok}.is.null`;
        return `${ok}.eq.${v}`;
      });
      query = query.or(orParts.join(","));
    } else if (value && typeof value === "object" && value.$regex) {
      query = query.ilike(col, `%${value.$regex}%`);
    } else if (value && typeof value === "object" && value.$in) {
      if (col.includes("->")) {
        query = query.or(`${col}.in.(${value.$in.join(",")})`);
      } else {
        query = query.in(col, value.$in);
      }
    } else if (value && typeof value === "object" && value.$ne) {
      query = query.neq(col, value.$ne);
    } else if (value && typeof value === "object" && "$exists" in value) {
      query = value.$exists ? query.not(col, "is", null) : query.is(col, null);
    } else if (value && typeof value === "object" && value.$gte && value.$lte) {
      query = query.gte(col, toISODate(value.$gte)).lte(col, toISODate(value.$lte));
    } else if (value && typeof value === "object" && value.$gte) {
      query = query.gte(col, toISODate(value.$gte));
    } else if (value && typeof value === "object" && value.$gt) {
      query = query.gt(col, toISODate(value.$gt));
    } else if (value && typeof value === "object" && value.$lte) {
      query = query.lte(col, toISODate(value.$lte));
    } else if (value && typeof value === "object" && value.$lt) {
      query = query.lt(col, toISODate(value.$lt));
    } else if (value && typeof value === "object" && value.$contains) {
      query = query.contains(col, value.$contains);
    } else if (value === null || value === undefined) {
      query = query.is(col, null);
    } else {
      query = query.eq(col, value);
    }
  }
  return query;
}

/**
 * Build the $set / $setOnInsert / $inc update object into Supabase update data.
 * Handles dot-notation for nested JSONB fields (e.g., "metadata.notes").
 */
function buildUpdateData(update) {
  const data = {};

  if (update.$set) {
    for (const [key, value] of Object.entries(update.$set)) {
      if (key.includes(".")) {
        // Dot-notation: merge into nested object
        const parts = key.split(".");
        const rootKey = parts[0];
        if (!data[rootKey] || typeof data[rootKey] !== "object") {
          data[rootKey] = {};
        }
        let target = data[rootKey];
        for (let i = 1; i < parts.length - 1; i++) {
          if (!target[parts[i]] || typeof target[parts[i]] !== "object") {
            target[parts[i]] = {};
          }
          target = target[parts[i]];
        }
        target[parts[parts.length - 1]] = value;
      } else {
        data[key] = value;
      }
    }
  }
  if (update.$setOnInsert) {
    Object.assign(data, update.$setOnInsert);
  }
  if (update.$inc) {
    data._increments = update.$inc;
  }

  return data;
}

/**
 * Model class: wraps Supabase table operations to mimic Mongoose model API.
 */
class Model {
  constructor(tableName) {
    this.tableName = tableName;
    this.client = supabase;
  }

  /**
   * findOne({ field: value }) or findOne({ ... }).sort({ ... })
   */
  findOne(filter = {}) {
    return new FindOneQuery(this.client, this.tableName, filter);
  }

  /**
   * find({ ... }).sort({ ... }).limit(n)
   * Returns a chainable query builder.
   */
  find(filter = {}) {
    return new QueryBuilder(this.client, this.tableName, filter);
  }

  /**
   * findOneAndUpdate(filter, update, options)
   * options: { upsert: true, new: true }
   */
  async findOneAndUpdate(filter, update, options = {}) {
    const { upsert = false, new: returnNew = true } = options;
    const updateData = buildUpdateData(update);

    // Enforce tenant scoping cascade when soft-deleting a tenant
    if (this.tableName === "tenants" && update.$set && update.$set.deleted_at) {
      const tenantId = filter.id || filter.tenant_id;
      if (tenantId) {
        for (const childTable of MULTI_TENANT_TABLES) {
          await this.client
            .from(childTable)
            .update({ deleted_at: update.$set.deleted_at })
            .eq("tenant_id", tenantId);
        }
      }
    }

    // First, try to find existing record
    let query = this.client.from(this.tableName).select("*").limit(1);
    query = applyFilter(query, filter, this.tableName);
    const { data: existing } = await query.maybeSingle();

    if (existing) {
      // Update existing
      const { _increments, ...setFields } = updateData;
      let updateQuery = this.client.from(this.tableName).update(setFields).eq("id", existing.id);
      const { error } = await updateQuery;
      if (error) throw error;

      // Handle $inc
      if (_increments) {
        for (const [field, amount] of Object.entries(_increments)) {
          await this.client.rpc("increment_field", {
            table_name: this.tableName,
            record_id: existing.id,
            field_name: field,
            increment_by: amount
          }).catch(() => {
            // Fallback: read-modify-write
            const current = existing[field] || 0;
            const newVal = (typeof current === "number" ? current : 0) + amount;
            this.client.from(this.tableName).update({ [field]: newVal }).eq("id", existing.id);
          });
        }
      }

      if (returnNew) {
        const { data: updated } = await this.client.from(this.tableName).select("*").eq("id", existing.id).single();
        return this._wrapDoc(updated);
      }
      return this._wrapDoc(existing);
    }

    if (upsert) {
      // Insert new
      const insertData = { ...update.$setOnInsert, ...update.$set };
      const { _increments, ...setFields } = insertData;
      const insertPayload = { ...setFields };
      // Apply filter fields if they're not in the data already
      for (const [k, v] of Object.entries(filter)) {
        if (insertPayload[k] === undefined && !(v && typeof v === "object")) {
          insertPayload[k] = v;
        }
      }

      // Automatically inject tenant_id on insertion
      const ctx = getTenantContext();
      if (ctx && ctx.tenant_id && MULTI_TENANT_TABLES.includes(this.tableName)) {
        insertPayload.tenant_id = ctx.tenant_id;
      }

      const { data: inserted, error } = await this.client.from(this.tableName).insert(insertPayload).select().single();
      if (error) throw error;
      return this._wrapDoc(inserted);
    }

    return null;
  }

  /**
   * findByIdAndUpdate(id, update, options)
   */
  async findByIdAndUpdate(id, update, options = {}) {
    requireTenantScope(this.tableName);
    const updateData = buildUpdateData(update);
    const { _increments, ...setFields } = updateData;
    const { new: returnNew = true } = options;

    const ctx = getTenantContext();
    let query = this.client.from(this.tableName).update(setFields).eq("id", id);
    if (ctx && ctx.tenant_id && MULTI_TENANT_TABLES.includes(this.tableName)) {
      query = query.eq("tenant_id", ctx.tenant_id).is("deleted_at", null);
    }

    const { error } = await query;
    if (error) throw error;

    if (_increments) {
      for (const [field, amount] of Object.entries(_increments)) {
        let currentQuery = this.client.from(this.tableName).select(field).eq("id", id);
        if (ctx && ctx.tenant_id && MULTI_TENANT_TABLES.includes(this.tableName)) {
          currentQuery = currentQuery.eq("tenant_id", ctx.tenant_id);
        }
        const { data: current } = await currentQuery.single();
        const newVal = (current?.[field] || 0) + amount;
        await this.client.from(this.tableName).update({ [field]: newVal }).eq("id", id);
      }
    }

    if (returnNew) {
      let getQuery = this.client.from(this.tableName).select("*").eq("id", id);
      if (ctx && ctx.tenant_id && MULTI_TENANT_TABLES.includes(this.tableName)) {
        getQuery = getQuery.eq("tenant_id", ctx.tenant_id);
      }
      const { data } = await getQuery.single();
      return this._wrapDoc(data);
    }
    return null;
  }

  /**
   * findByIdAndDelete(id) -> Maps to Soft Delete
   */
  async findByIdAndDelete(id) {
    requireTenantScope(this.tableName);
    const ctx = getTenantContext();
    if (ctx && ctx.tenant_id && MULTI_TENANT_TABLES.includes(this.tableName)) {
      const { data, error } = await this.client
        .from(this.tableName)
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id)
        .eq("tenant_id", ctx.tenant_id)
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await this.client.from(this.tableName).delete().eq("id", id).select().maybeSingle();
      if (error) throw error;
      return data;
    }
  }

  /**
   * new Model({ ... }).save()
   */
  async save(doc) {
    requireTenantScope(this.tableName);
    const ctx = getTenantContext();
    if (ctx && ctx.tenant_id && MULTI_TENANT_TABLES.includes(this.tableName)) {
      doc.tenant_id = ctx.tenant_id;
    }
    const { data, error } = await this.client.from(this.tableName).insert(doc).select().single();
    if (error) throw error;
    return this._wrapDoc(data);
  }

  /**
   * insertMany([ { ... }, { ... } ])
   */
  async insertMany(docs) {
    requireTenantScope(this.tableName);
    const ctx = getTenantContext();
    if (ctx && ctx.tenant_id && MULTI_TENANT_TABLES.includes(this.tableName)) {
      for (const doc of docs) {
        doc.tenant_id = ctx.tenant_id;
      }
    }
    const { data, error } = await this.client.from(this.tableName).insert(docs).select();
    if (error) throw error;
    return (data || []).map(d => this._wrapDoc(d));
  }

  /**
   * Supports $set, $setOnInsert, $inc
   */
  async updateOne(filter, update) {
    // Handle $inc via read-modify-write (Supabase doesn't support atomic increment natively)
    if (update.$inc) {
      let readQuery = this.client.from(this.tableName).select("*").limit(1);
      readQuery = applyFilter(readQuery, filter, this.tableName);
      const { data: existing } = await readQuery.maybeSingle();
      if (!existing) return { modifiedCount: 0, data: null };

      const incData = {};
      for (const [field, delta] of Object.entries(update.$inc)) {
        incData[field] = (existing[field] || 0) + delta;
      }
      // Merge with $set if present
      if (update.$set) Object.assign(incData, update.$set);

      const { data, error } = await this.client
        .from(this.tableName)
        .update(incData)
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw error;
      return { modifiedCount: 1, data };
    }

    let query = this.client.from(this.tableName).update(buildUpdateData(update));
    query = applyFilter(query, filter, this.tableName);
    const { data, error } = await query.select().single();
    if (error) throw error;
    return { modifiedCount: 1, data };
  }

  /**
   * updateMany(filter, update) - Update all matching records
   */
  async updateMany(filter, update) {
    // Fetch matching rows, then update each (Supabase doesn't support bulk update with filter)
    let readQuery = this.client.from(this.tableName).select("id");
    readQuery = applyFilter(readQuery, filter, this.tableName);
    const { data: rows, error: readErr } = await readQuery;
    if (readErr) throw readErr;
    if (!rows || rows.length === 0) return { modifiedCount: 0 };

    const updateData = buildUpdateData(update);
    let modifiedCount = 0;
    for (const row of rows) {
      const { error } = await this.client
        .from(this.tableName)
        .update(updateData)
        .eq("id", row.id);
      if (!error) modifiedCount++;
    }
    return { modifiedCount };
  }

  /**
   * countDocuments(filter)
   */
  async countDocuments(filter = {}) {
    try {
      let query = this.client.from(this.tableName).select("*", { count: "exact", head: true });
      query = applyFilter(query, filter, this.tableName);
      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    } catch (e) {
      // Fallback: fetch all and count in JS
      let query = this.client.from(this.tableName).select("id");
      query = applyFilter(query, filter, this.tableName);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).length;
    }
  }

  /**
   * deleteOne(filter) - Maps to Soft Delete
   */
  async deleteOne(filter = {}) {
    const ctx = getTenantContext();
    if (ctx && ctx.tenant_id && MULTI_TENANT_TABLES.includes(this.tableName)) {
      let query = this.client.from(this.tableName).select("id").limit(1);
      query = applyFilter(query, filter, this.tableName);
      const { data: existing } = await query.maybeSingle();
      if (!existing) return { deletedCount: 0 };
      const { error } = await this.client
        .from(this.tableName)
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", existing.id)
        .eq("tenant_id", ctx.tenant_id);
      if (error) throw error;
      return { deletedCount: 1 };
    } else {
      let query = this.client.from(this.tableName).select("id").limit(1);
      query = applyFilter(query, filter, this.tableName);
      const { data: existing } = await query.maybeSingle();
      if (!existing) return { deletedCount: 0 };
      const { error } = await this.client.from(this.tableName).delete().eq("id", existing.id);
      if (error) throw error;
      return { deletedCount: 1 };
    }
  }

  /**
   * deleteMany(filter) - Maps to Soft Delete
   */
  async deleteMany(filter = {}) {
    const ctx = getTenantContext();
    if (ctx && ctx.tenant_id && MULTI_TENANT_TABLES.includes(this.tableName)) {
      let query = this.client.from(this.tableName).select("id");
      query = applyFilter(query, filter, this.tableName);
      const { data: rows, error: readErr } = await query;
      if (readErr) throw readErr;
      if (!rows || rows.length === 0) return { deletedCount: 0 };

      let deletedCount = 0;
      for (const row of rows) {
        const { error } = await this.client
          .from(this.tableName)
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", row.id)
          .eq("tenant_id", ctx.tenant_id);
        if (!error) deletedCount++;
      }
      return { deletedCount };
    } else {
      let query = this.client.from(this.tableName).select("id");
      query = applyFilter(query, filter, this.tableName);
      const { data: rows, error: readErr } = await query;
      if (readErr) throw readErr;
      if (!rows || rows.length === 0) return { deletedCount: 0 };

      let deletedCount = 0;
      for (const row of rows) {
        const { error } = await this.client.from(this.tableName).delete().eq("id", row.id);
        if (!error) deletedCount++;
      }
      return { deletedCount };
    }
  }

  /**
   * create(doc) - Insert a document (alias for save)
   */
  async create(doc) {
    return this.save(doc);
  }

  /**
   * distinct(field, filter) - Get unique values for a field
   */
  async distinct(field, filter = {}) {
    let query = this.client.from(this.tableName).select(field);
    query = applyFilter(query, filter, this.tableName);
    const { data, error } = await query;
    if (error) throw error;
    const values = (data || []).map(row => row[field]);
    return [...new Set(values)];
  }

  /**
   * aggregate(pipeline) - Simplified MongoDB-style aggregation.
   * Supports: $match, $group (with $sum, $avg, $min, $max, $count), $sort, $project
   */
  async aggregate(pipeline) {
    let matchFilter = {};
    let groupStage = null;
    let sortStage = null;

    for (const stage of pipeline) {
      if (stage.$match) Object.assign(matchFilter, stage.$match);
      if (stage.$group) groupStage = stage.$group;
      if (stage.$sort) sortStage = stage.$sort;
    }

    // Fetch all matching rows
    let query = this.client.from(this.tableName).select("*");
    query = applyFilter(query, matchFilter, this.tableName);
    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];

    if (!groupStage) return rows;

    // Process $group
    const groupId = groupStage._id;

    if (groupId === null) {
      // Global aggregation (no grouping key)
      const result = {};
      for (const [key, op] of Object.entries(groupStage)) {
        if (key === "_id") continue;
        result[key] = this._evalAggOp(rows, op);
      }
      return [result];
    }

    if (typeof groupId === "object" && groupId.$dateToString) {
      // Group by date
      const dateField = groupId.$dateToString.date.replace("$", "");
      const format = groupId.$dateToString.format || "%Y-%m-%d";
      const groups = {};
      for (const row of rows) {
        const dateVal = row[dateField];
        if (!dateVal) continue;
        const d = new Date(dateVal);
        let key;
        if (format === "%Y-%m-%d") key = d.toISOString().split("T")[0];
        else key = d.toISOString();
        if (!groups[key]) groups[key] = [];
        groups[key].push(row);
      }
      const results = [];
      for (const [key, groupRows] of Object.entries(groups)) {
        const result = { _id: key };
        for (const [aggKey, op] of Object.entries(groupStage)) {
          if (aggKey === "_id") continue;
          result[aggKey] = this._evalAggOp(groupRows, op);
        }
        results.push(result);
      }
      if (sortStage) {
        const sortKey = Object.keys(sortStage)[0];
        const sortDir = sortStage[sortKey];
        results.sort((a, b) => sortDir === 1 ? (a._id > b._id ? 1 : -1) : (a._id < b._id ? 1 : -1));
      }
      return results;
    }

    if (typeof groupId === "string") {
      // Simple string field grouping
      const field = groupId.replace("$", "");
      const groups = {};
      for (const row of rows) {
        const key = row[field] || "null";
        if (!groups[key]) groups[key] = [];
        groups[key].push(row);
      }
      const results = [];
      for (const [key, groupRows] of Object.entries(groups)) {
        const result = { _id: key };
        for (const [aggKey, op] of Object.entries(groupStage)) {
          if (aggKey === "_id") continue;
          result[aggKey] = this._evalAggOp(groupRows, op);
        }
        results.push(result);
      }
      return results;
    }

    // Fallback: return raw rows
    return rows;
  }

  _evalAggOp(rows, op) {
    if (op.$sum) {
      const field = op.$sum === 1 ? null : (typeof op.$sum === "string" ? op.$sum.replace("$", "") : null);
      if (op.$sum === 1) return rows.length;
      return rows.reduce((sum, r) => sum + (Number(r[field]) || 0), 0);
    }
    if (op.$avg) {
      const field = op.$avg.replace("$", "");
      const vals = rows.map(r => Number(r[field])).filter(v => !isNaN(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }
    if (op.$min) {
      const field = op.$min.replace("$", "");
      return Math.min(...rows.map(r => Number(r[field])).filter(v => !isNaN(v)));
    }
    if (op.$max) {
      const field = op.$max.replace("$", "");
      return Math.max(...rows.map(r => Number(r[field])).filter(v => !isNaN(v)));
    }
    if (op.$push) {
      const field = op.$push.replace("$", "");
      return rows.map(r => r[field]).filter(v => v !== undefined && v !== null);
    }
    if (op.$cond) {
      // Simplified $cond: [condition, trueVal, falseVal]
      const [cond, trueVal, falseVal] = op.$cond;
      let count = 0;
      for (const row of rows) {
        if (this._evalCond(row, cond)) count += (typeof trueVal === "object" && trueVal.$sum ? 1 : (trueVal || 0));
      }
      return count;
    }
    return 0;
  }

  _evalCond(row, cond) {
    if (cond.$eq) {
      const [field, val] = Array.isArray(cond.$eq) ? cond.$eq : [Object.keys(cond.$eq)[0], Object.values(cond.$eq)[0]];
      const f = typeof field === "string" ? field.replace("$", "") : field;
      return row[f] === val;
    }
    if (cond.$gte) {
      const [field, val] = Array.isArray(cond.$gte) ? cond.$gte : [Object.keys(cond.$gte)[0], Object.values(cond.$gte)[0]];
      const f = typeof field === "string" ? field.replace("$", "") : field;
      return row[f] >= val;
    }
    return false;
  }

  /**
   * Helper: wrap returned data with Mongoose-like methods
   */
  _wrapDoc(doc) {
    if (!doc) return null;
    return {
      ...doc,
      _doc: doc,
      toObject: () => doc,
      toJSON: () => doc,
    };
  }
}

/**
 * Chainable query builder for find() operations.
 */
class QueryBuilder {
  constructor(client, tableName, filter) {
    this.client = client;
    this.tableName = tableName;
    this.filter = filter;
    this._sortField = null;
    this._sortAsc = true;
    this._limitCount = null;
    this._offsetCount = null;
    this._selectFields = "*";
    this._excludeFields = null;
  }

  sort(sortObj) {
    for (const [field, dir] of Object.entries(sortObj)) {
      this._sortField = field;
      this._sortAsc = dir === 1 || dir === "asc";
    }
    return this;
  }

  limit(n) {
    this._limitCount = n;
    return this;
  }

  lean() {
    return this;
  }

  skip(n) {
    this._offsetCount = n;
    return this;
  }

  select(fields) {
    if (typeof fields === "string" && fields.includes("-")) {
      const excluded = fields.split(",").map(f => f.trim().replace("-", "")).filter(Boolean);
      this._selectFields = "*";
      this._excludeFields = excluded;
    } else {
      this._selectFields = fields;
      this._excludeFields = null;
    }
    return this;
  }

  /**
   * Execute the query and return results.
   */
  async then(resolve) {
    let query = this.client.from(this.tableName).select(this._selectFields);
    query = applyFilter(query, this.filter, this.tableName);

    if (this._sortField) {
      query = query.order(this._sortField, { ascending: this._sortAsc });
    }
    if (this._limitCount) {
      query = query.limit(this._limitCount);
    }
    if (this._offsetCount) {
      const from = this._offsetCount;
      const to = this._limitCount ? from + this._limitCount - 1 : from + 999;
      query = query.range(from, to);
    }

    const { data, error } = await query;
    if (error) throw error;

    let results = (data || []).map(doc => ({
      ...doc,
      _doc: doc,
      toObject: () => doc,
      toJSON: () => doc,
    }));

    // Handle excluded fields (Mongoose "-field" syntax)
    if (this._excludeFields && this._excludeFields.length) {
      results = results.map(doc => {
        const filtered = { ...doc };
        for (const field of this._excludeFields) {
          delete filtered[field];
          if (filtered._doc) delete filtered._doc[field];
        }
        return filtered;
      });
    }

    resolve(results);
  }
}

/**
 * Chainable query for findOne() - supports .sort() before await.
 */
class FindOneQuery {
  constructor(client, tableName, filter) {
    this.client = client;
    this.tableName = tableName;
    this.filter = filter;
    this._sortField = null;
    this._sortAsc = true;
  }

  sort(sortObj) {
    for (const [field, dir] of Object.entries(sortObj)) {
      this._sortField = field;
      this._sortAsc = dir === 1 || dir === "asc";
    }
    return this;
  }

  async then(resolve) {
    let query = this.client.from(this.tableName).select("*").limit(1);
    query = applyFilter(query, this.filter, this.tableName);
    if (this._sortField) {
      query = query.order(this._sortField, { ascending: this._sortAsc });
    }
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    resolve(data ? { ...data, _doc: data, toObject: () => data, toJSON: () => data } : null);
  }
}

// ─── Table instances (Mongoose model replacements) ───────────
const User = new Model("users");
const Admin = new Model("admins");
const Message = new Model("messages");
const Settings = new Model("settings");
const Integration = new Model("integrations");
const Order = new Model("orders");
const Product = new Model("products");
const OrderSession = new Model("order_sessions");
const Payment = new Model("payments");
const Broadcast = new Model("broadcasts");
const Template = new Model("templates");
const EcommerceConnection = new Model("ecommerce_connections");
const KnowledgeBase = new Model("knowledge_base");
const Feedback = new Model("feedback");
const ConversationAnalytics = new Model("conversation_analytics");
const Ad = new Model("ads");
const AdClick = new Model("ad_clicks");
const Tenant = new Model("tenants");
const TenantChannel = new Model("tenant_channels");
const ConversationHandoff = new Model("conversation_handoffs");
const ConversationHandoffEvent = new Model("conversation_handoff_events");

module.exports = {
  supabase,
  Model,
  User,
  Admin,
  Message,
  Settings,
  Integration,
  Order,
  Product,
  OrderSession,
  Payment,
  Broadcast,
  Template,
  EcommerceConnection,
  KnowledgeBase,
  Feedback,
  ConversationAnalytics,
  Ad,
  AdClick,
  Tenant,
  TenantChannel,
  ConversationHandoff,
  ConversationHandoffEvent,
  MULTI_TENANT_TABLES,
  ALLOWLIST_TABLES,
  requireTenantScope,
  TenantContextError,
  applyFilter,
};
