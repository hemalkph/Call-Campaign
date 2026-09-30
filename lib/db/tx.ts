import type { Db } from ".";

/** The database or an open transaction; helpers accept either so callers can make them atomic. */
export type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** True for a unique-constraint violation (e.g. a duplicate email or phone). Drizzle wraps driver errors in `cause`. */
export const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
};
