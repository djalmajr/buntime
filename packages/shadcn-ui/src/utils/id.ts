import { customAlphabet } from "nanoid";

const prefixes: Record<string, unknown> = {};

interface GenerateIdOptions {
  length?: number;
  separator?: string;
  alphabet?: string;
}

export function generateId(
  prefixOrOptions?: keyof typeof prefixes | GenerateIdOptions,
  inputOptions: GenerateIdOptions = {},
) {
  const finalOptions = typeof prefixOrOptions === "object" ? prefixOrOptions : inputOptions;
  const prefix = typeof prefixOrOptions === "object" ? undefined : prefixOrOptions;
  const {
    length = 12,
    separator = "_",
    alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  } = finalOptions;
  const id = customAlphabet(alphabet, length)();
  return prefix && prefix in prefixes ? `${prefixes[prefix]}${separator}${id}` : id;
}
