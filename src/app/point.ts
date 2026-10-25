// Which charging point this browser shows (the switcher, when an account has more than one). Its own module so the
// session can forget it on sign-out without importing the data hooks.
import { signal } from "@preact/signals";
import type { ChargePoint, User } from "../api/types";

const POINT_KEY = "evo.point";
export const selectedPointId = signal<string | null>((() => {
  try {
    return localStorage.getItem(POINT_KEY);
  } catch {
    return null;
  }
})());

/** Forgets which charging point was chosen here (the next person on this browser starts from their own first). */
export function forgetSelectedPoint(): void {
  selectedPointId.value = null;
  try {
    localStorage.removeItem(POINT_KEY);
  } catch {
    // nothing remembered
  }
}

export function selectPoint(id: string): void {
  selectedPointId.value = id;
  try {
    localStorage.setItem(POINT_KEY, id);
  } catch {
    // not remembered
  }
}

/** The active charging point: the one chosen in the switcher, else the first. */
export function activePoint(user: User | undefined): ChargePoint | null {
  if (!user || user.chargePoints.length === 0) return null;
  return user.chargePoints.find((p) => p.id === selectedPointId.value) ?? user.chargePoints[0]!;
}
