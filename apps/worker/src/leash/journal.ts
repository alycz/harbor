import type { LeashJournal } from './execution.ts';

/** Requires the separately applied local/remote migration; never migrates on request. */
export function leashJournal(db: D1Database): LeashJournal {
  return {
    async claim(id, owner, digest) {
      const result = await db
        .prepare(
          "INSERT OR IGNORE INTO leash_executions(id,owner,digest,state,created_at_ms) VALUES(?,?,?,'claimed',?)",
        )
        .bind(id, owner, digest, Date.now())
        .run();
      return result.meta.changes === 1;
    },
    async submitted(id, digest, txHash) {
      const result = await db
        .prepare("UPDATE leash_executions SET state='submitted',tx_hash=? WHERE id=? AND digest=? AND state='claimed'")
        .bind(txHash, id, digest)
        .run();
      if (result.meta.changes !== 1) throw new Error('Execution claim changed; recover without resubmission');
    },
    async unknown(id, digest) {
      await db
        .prepare("UPDATE leash_executions SET state='outcome_unknown' WHERE id=? AND digest=? AND state='claimed'")
        .bind(id, digest)
        .run();
    },
  };
}
