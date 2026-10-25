// The free period of the subscription starts with the owner's first action with the charger (1.14 §2): opening its
// status, the charging history, a statement or the meter readings, changing a setting or the schedule. Signing in
// alone is not one — so this is called by those screens, never by the session. The server call is idempotent; here
// it goes out at most once per page load and point, only while the subscription says the period has not started,
// never in the demo, and a failure is nobody's problem (the 14th day starts the period anyway).
import { useEffect } from "preact/hooks";
import type { Subscription } from "../api/types";
import { k, useSubscription } from "./data";
import { getData, invalidate } from "./query";
import { session } from "./session";

const marked = new Set<string>();

/** For tests: forget what was marked in this page load. */
export function resetActivity(): void {
  marked.clear();
}

export function markActivity(pointId: string): void {
  const s = session.value;
  if (s.kind !== "in") return;
  const key = `${s.id}:${pointId}`;
  if (marked.has(key)) return;
  // Already started (the subscription on screen says so): nothing to tell the server.
  const known = getData<Subscription>(k("subscription"));
  if (known && (known.activatedAt !== null || known.state.type === "none")) return;
  marked.add(key);
  s.backend.markPointActivity(pointId).then((answer) => {
    if (answer.started) invalidate(k("subscription"));
  }).catch(() => {
    marked.delete(key);      // not carried out (offline): the next screen tries again
  });
}

/** Marks the action once the subscription is known and its free period has not started yet. */
export function useActivity(pointId: string | null): void {
  const live = session.value.kind === "in";
  const subscription = useSubscription(live && pointId !== null);
  const waiting = subscription.data !== undefined && subscription.data.state.type !== "none"
    && subscription.data.activatedAt === null;
  useEffect(() => {
    if (pointId && waiting) markActivity(pointId);
  }, [pointId, waiting]);
}
