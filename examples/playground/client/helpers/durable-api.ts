const BASE_URL = "/_/plugin-durable";

export interface DurableObject {
  className: string;
  createdAt: number;
  id: string;
  lastActiveAt: number;
}

export const durableApi = {
  async list(): Promise<DurableObject[]> {
    const res = await fetch(`${BASE_URL}/`);
    if (!res.ok) throw new Error(`Failed to list objects: ${res.statusText}`);
    return res.json();
  },

  async get(id: string): Promise<DurableObject> {
    const res = await fetch(`${BASE_URL}/${encodeURIComponent(id)}`);
    if (!res.ok) {
      if (res.status === 404) throw new Error("Object not found");
      throw new Error(`Failed to get object: ${res.statusText}`);
    }
    return res.json();
  },

  async delete(id: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      if (res.status === 404) throw new Error("Object not found");
      throw new Error(`Failed to delete object: ${res.statusText}`);
    }
  },
};
