// Resources of the account, one hook per contract method. Keys carry the session id, so two accounts never share
// cached data. Polling mirrors the app: 30 s for lists and alerts, 10 s for the live session.
import type { Backend } from "../api/backend";
import type { User } from "../api/types";
import { monthKey, type Month } from "../lib/belgrade";
import { LIVE_POLL_MS, POLL_MS, useResource } from "./query";
import { backend as backendSignal, session } from "./session";

function current(): { id: string; backend: Backend } | null {
  const s = session.value;
  return s.kind === "demo" || s.kind === "in" ? { id: s.id, backend: s.backend } : null;
}

/** Cache key of a resource of the current session. */
export function k(...parts: Array<string | number>): string {
  const s = current();
  return `${s?.id ?? "none"}:${parts.join(":")}`;
}

function be(): Backend {
  const b = backendSignal.value;
  if (!b) throw new Error("no backend");
  return b;
}

export function useUser() {
  return useResource<User>(current() ? k("user") : null, () => be().currentUser(), { poll: POLL_MS });
}

export { activePoint, forgetSelectedPoint, selectedPointId, selectPoint } from "./point";

export const useTariff = (pointId: string | null) =>
  useResource(pointId ? k("tariff", pointId) : null, () => be().tariff(pointId!));

export const useSchedule = (pointId: string | null) =>
  useResource(pointId ? k("schedule", pointId) : null, () => be().schedule(pointId!));

export const useLive = (pointId: string | null) =>
  useResource(pointId ? k("live", pointId) : null, () => be().liveSession(pointId!), { poll: LIVE_POLL_MS });

export const useAlerts = (enabled: boolean) =>
  useResource(enabled ? k("alerts") : null, () => be().alerts(), { poll: POLL_MS });

export const useStatements = (pointId: string | null) =>
  useResource(pointId ? k("statements", pointId) : null, () => be().statements(pointId!), { poll: POLL_MS });

export const useStatement = (pointId: string | null, month: Month | null) =>
  useResource(pointId && month ? k("statement", pointId, monthKey(month)) : null,
    () => be().statement(pointId!, month!));

export const useSessions = (pointId: string | null, from: Date, to: Date) =>
  useResource(pointId ? k("sessions", pointId, from.toISOString(), to.toISOString()) : null,
    () => be().sessions(pointId!, from, to), { poll: POLL_MS });

export const useSubscription = (enabled: boolean) =>
  useResource(enabled ? k("subscription") : null, () => be().subscription());

/** Meter readings by photo (1.14). Not polled: it changes when the person sends one (then invalidated). */
export const useMeterReadings = (pointId: string | null) =>
  useResource(pointId ? k("readings", pointId) : null, () => be().meterReadings(pointId!));

export const useReferral = (enabled: boolean) =>
  useResource(enabled ? k("referral") : null, () => be().referralStatus());

export const useServiceRequests = (pointId: string | null) =>
  useResource(pointId ? k("service", pointId) : null, () => be().serviceRequests(pointId!), { poll: POLL_MS });

export const useRelocations = (pointId: string | null) =>
  useResource(pointId ? k("relocation", pointId) : null, () => be().relocationRequests(pointId!), { poll: POLL_MS });

export const useInstallationRequests = (enabled: boolean) =>
  useResource(enabled ? k("installation") : null, () => be().installationRequests(), { poll: POLL_MS });

export function backendOrThrow(): Backend {
  return be();
}
