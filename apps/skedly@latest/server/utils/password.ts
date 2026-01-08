import { randomBytes, scryptSync } from "node:crypto";

export const generateSalt = () => randomBytes(16).toString("hex");

export const hashPassword = async (password: string, salt: string) => {
  return scryptSync(password, salt, 64).toString("hex");
};

export const verifyPassword = async (storedPassword: string, password: string) => {
  const parts = storedPassword.split(":");
  const salt = parts[0]!;
  const hash = parts[1]!;
  const derivedKey = await hashPassword(password, salt);
  return hash === derivedKey;
};
