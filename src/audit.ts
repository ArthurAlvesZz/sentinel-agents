import type { AuditEntry, AuditEvent, Provenance } from "./types.js";

/** Append-only audit trail. In production, back this with a WORM store or an insert-only table. */
export class AuditLog {
  private entries: AuditEntry[] = [];

  constructor(private clock: () => Date = () => new Date()) {}

  record(event: AuditEvent, provenance?: Provenance): AuditEntry {
    const entry: AuditEntry = {
      seq: this.entries.length + 1,
      at: this.clock().toISOString(),
      event,
      provenance,
    };
    this.entries.push(entry);
    return entry;
  }

  all(): readonly AuditEntry[] {
    return this.entries;
  }
}
