/**
 * Simple KeyVal client for browser using HTTP API
 */
export class Kv {
  constructor(baseUrl = "/api/keyval") {
    this.baseUrl = baseUrl;
  }

  /**
   * Encode a key array to URL path
   * @param {string[]} key
   * @returns {string}
   */
  encodeKey(key) {
    return key.map((part) => encodeURIComponent(part)).join("/");
  }

  /**
   * Get a value by key
   * @param {string[]} key
   * @returns {Promise<{ key: string[], value: any, versionstamp: string } | null>}
   */
  async get(key) {
    const res = await fetch(`${this.baseUrl}/keys/${this.encodeKey(key)}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`KV get failed: ${res.statusText}`);
    }
    return res.json();
  }

  /**
   * Set a value
   * @param {string[]} key
   * @param {any} value
   * @returns {Promise<{ ok: boolean, versionstamp: string }>}
   */
  async set(key, value) {
    const res = await fetch(`${this.baseUrl}/keys/${this.encodeKey(key)}`, {
      body: JSON.stringify(value),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });
    if (!res.ok) throw new Error(`KV set failed: ${res.statusText}`);
    return res.json();
  }

  /**
   * Delete a key
   * @param {string[]} key
   * @returns {Promise<{ deleted: number }>}
   */
  async delete(key) {
    const res = await fetch(`${this.baseUrl}/keys/${this.encodeKey(key)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`KV delete failed: ${res.statusText}`);
    return res.json();
  }

  /**
   * List entries by prefix
   * @param {string[]} prefix
   * @returns {Promise<Array<{ key: string[], value: any, versionstamp: string }>>}
   */
  async list(prefix) {
    const res = await fetch(`${this.baseUrl}/keys/list`, {
      body: JSON.stringify({ prefix }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!res.ok) throw new Error(`KV list failed: ${res.statusText}`);
    return res.json();
  }

  /**
   * Create an atomic operation builder
   * @returns {KvAtomic}
   */
  atomic() {
    return new KvAtomic(this.baseUrl);
  }
}

/**
 * Atomic operation builder
 */
class KvAtomic {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.operations = [];
  }

  /**
   * Add a set operation
   * @param {string[]} key
   * @param {any} value
   * @returns {this}
   */
  set(key, value) {
    this.operations.push({ key, type: "set", value });
    return this;
  }

  /**
   * Add a delete operation
   * @param {string[]} key
   * @returns {this}
   */
  delete(key) {
    this.operations.push({ key, type: "delete" });
    return this;
  }

  /**
   * Commit all operations atomically
   * @returns {Promise<{ ok: boolean, versionstamp?: string }>}
   */
  async commit() {
    const res = await fetch(`${this.baseUrl}/atomic`, {
      body: JSON.stringify({ operations: this.operations }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!res.ok) throw new Error(`KV atomic commit failed: ${res.statusText}`);
    return res.json();
  }
}
