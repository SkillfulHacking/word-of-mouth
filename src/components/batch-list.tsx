import Link from "next/link";

export type BatchRow = { batch: string; note: string; total: number; open: number; by?: string };

/** Bulk print runs, with a link to print the unused ones again. */
export function BatchList({ eventId, batches }: { eventId: string; batches: BatchRow[] }) {
  if (batches.length === 0) return null;
  return (
    <>
      <h3 style={{ margin: "16px 0 4px" }}>Print batches</h3>
      {batches.map((b) => (
        <div className="card" key={b.batch} style={{ margin: "8px 0" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>
              <strong>{b.note || "Unlabeled batch"}</strong>
              {b.by && <span className="muted"> · made by {b.by}</span>}
              <span className="muted"> · {b.total} invites, {b.open} unused</span>
            </span>
            {b.open > 0 ? (
              <Link className="btn secondary" style={{ flex: "none" }} href={`/print/invites/${eventId}?batch=${b.batch}`}>
                Print {b.open} unused
              </Link>
            ) : (
              <span className="pill" style={{ flex: "none" }}>all used</span>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
