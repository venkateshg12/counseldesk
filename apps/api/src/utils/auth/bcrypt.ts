import bcrypt from "bcrypt";

// 12 rounds: roughly 4x the work of the old default of 10 per guess against a leaked hash, while a
// login still hashes in well under a second.
const DEFAULT_SALT_ROUNDS = 12;

export const hashValue = async (value: string, saltRounds?: number) =>
  bcrypt.hash(value, saltRounds || DEFAULT_SALT_ROUNDS);

export const compareValue = async (value: string, hashedValue: string) =>
  bcrypt.compare(value, hashedValue).catch(() => false);
