// Rules of the monthly statement shared by screens and tests.
import type { EnergyPart, ServicePart, Statement } from "../api/types";
import { fromBelgrade, type Month } from "./belgrade";
import { parseIps } from "./payments";

/** Day of the next month by which a statement is paid — decision of the founders, 23.09.2026. */
export const DUE_DAY = 15;

/** The backend's dueDate, or — when it is missing — the 15th of the next month in Europe/Belgrade. */
export function statementDueDate(s: { month: Month; dueDate: Date | null }): Date {
  return s.dueDate ?? fromBelgrade(s.month.year, s.month.month + 1, DUE_DAY);
}

/** Everything to pay for the month (both independent parts). */
export function statementTotal(s: Pick<Statement, "energyPart" | "servicePart">): number {
  return (s.energyPart?.amountRSD ?? 0) + (s.servicePart?.amountRSD ?? 0);
}

/** Svrha plaćanja: the field when the backend sends it, otherwise the S tag of the payload. */
export function paymentPurpose(part: EnergyPart | ServicePart): string | null {
  return part.purpose ?? (part.qrPayload ? parseIps(part.qrPayload).S ?? null : null);
}

/** A part with something to scan: a payload and a non-zero amount. */
export function isPayable(part: EnergyPart | ServicePart | null): part is EnergyPart | ServicePart {
  return part !== null && part.qrPayload !== "" && part.amountRSD > 0;
}

/**
 * A part to pay NOW: something to scan, and the statement is not paid yet. A paid statement never shows a QR code
 * or "Kopiraj podatke za uplatu" — its payment details stay readable, for the record only.
 */
export function isPayableNow(statement: Pick<Statement, "status">, part: EnergyPart | ServicePart | null): boolean {
  return isPayable(part) && statement.status !== "paid";
}
