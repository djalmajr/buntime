import { Kv } from "@buntime/keyval";

function getApiBase(): string {
  const baseHref = document.querySelector("base")?.getAttribute("href") || "/";
  return baseHref.replace(/\/$/, "") || "/keyval";
}

export const kv = new Kv(`${getApiBase()}/api`);
