import type { Policy } from "./types";

/**
 * Policy Administration Point (PAP)
 * Manages policy storage and retrieval.
 */
export class PolicyAdministrationPoint {
  private policies: Map<string, Policy> = new Map();
  private filePath?: string;

  constructor(_store: "memory" | "file" = "memory", filePath?: string) {
    this.filePath = filePath;
  }

  /**
   * Load policies from file (if configured)
   */
  async load(): Promise<void> {
    if (!this.filePath) return;

    try {
      const file = Bun.file(this.filePath);
      if (await file.exists()) {
        const data = await file.json();
        const policies = Array.isArray(data) ? data : (data.policies ?? []);

        for (const policy of policies as Policy[]) {
          this.policies.set(policy.id, policy);
        }
      }
    } catch (err) {
      console.error(`[PAP] Failed to load policies from ${this.filePath}:`, err);
    }
  }

  /**
   * Save policies to file (if configured)
   */
  async save(): Promise<void> {
    if (!this.filePath) return;

    try {
      const policies = this.getAll();
      await Bun.write(this.filePath, JSON.stringify({ policies }, null, 2));
    } catch (err) {
      console.error(`[PAP] Failed to save policies to ${this.filePath}:`, err);
    }
  }

  /**
   * Get all policies
   */
  getAll(): Policy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Get policy by ID
   */
  get(id: string): Policy | undefined {
    return this.policies.get(id);
  }

  /**
   * Create or update a policy
   */
  async set(policy: Policy): Promise<void> {
    this.policies.set(policy.id, policy);
    await this.save();
  }

  /**
   * Delete a policy
   */
  async delete(id: string): Promise<boolean> {
    const deleted = this.policies.delete(id);
    if (deleted) {
      await this.save();
    }
    return deleted;
  }

  /**
   * Load policies from array (for inline config)
   */
  loadFromArray(policies: Policy[]): void {
    for (const policy of policies) {
      this.policies.set(policy.id, policy);
    }
  }

  /**
   * Clear all policies
   */
  clear(): void {
    this.policies.clear();
  }
}
