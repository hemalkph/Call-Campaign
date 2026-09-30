import { auditEvents, db } from "./db";
import type { Tx } from "./db/tx";

/** Records who changed what. Never pass phone numbers or passwords in before/after. */
export function audit(
  e: { actorId?: string | null; action: string; entity: string; entityId?: string | null; before?: unknown; after?: unknown },
  tx: Tx = db,
) {
  return tx.insert(auditEvents).values(e);
}
