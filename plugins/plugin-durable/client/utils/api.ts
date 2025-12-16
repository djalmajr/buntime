function getBasePath(): string {
  const outlet = document.querySelector("fragment-outlet[data-fragment-base]");
  if (outlet) {
    const fragmentBase = outlet.getAttribute("data-fragment-base");
    if (fragmentBase) {
      return fragmentBase.replace(/\/$/, "");
    }
  }

  const base = document.querySelector("base");
  if (base) {
    const href = base.getAttribute("href") || "";
    return href.replace(/\/$/, "");
  }
  return "";
}

export const api = {
  basePath: getBasePath(),

  durable: {
    index: {
      $get: async () => {
        const res = await fetch(`${api.basePath}/api/durable`);
        if (!res.ok) throw new Error("Failed to fetch durable objects");
        return res;
      },
    },
    ":id": {
      $get: async ({ param }: { param: { id: string } }) => {
        const res = await fetch(`${api.basePath}/api/durable/${param.id}`);
        return res;
      },
      $delete: async ({ param }: { param: { id: string } }) => {
        const res = await fetch(`${api.basePath}/api/durable/${param.id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to delete durable object");
        return res;
      },
    },
  },
};
