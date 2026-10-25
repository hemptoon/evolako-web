// Sessions as CSV for Serbian Excel (port of Domain/Export/SessionCSV.swift):
// ";" separator (the comma is the decimal separator), numbers "12,40" without thousands separators,
// date yyyy-MM-dd and time HH:mm in Europe/Belgrade, UTF-8 with BOM (Excel reads č/ć as garbage without it),
// CRLF line ends, fields with ; " or a line break quoted.
import { clockKey, dayKey } from "./belgrade";
import { decimal } from "./format";
import { cost, type EnergySplit } from "./tariff";

export interface CsvColumns {
  date: string;
  start: string;
  end: string;
  nightKWh: string;
  dayKWh: string;
  /** Header of the amount column when prices come from a bill. */
  rsd: string;
  /** Header of the amount column when prices are the service's typical prices. */
  rsdEstimate: string;
  tag: string;
}

export interface CsvSession {
  startedAt: Date;
  endedAt: Date;
  energy: EnergySplit;
  tag: "personal" | "business" | null;
}

export interface CsvTariff {
  highRateRSDPerKWh: number;
  lowRateRSDPerKWh: number;
  source: "estimate" | "customerBill" | "meterOwnerBill";
}

export const BOM = "﻿";

export function escapeCsv(field: string): string {
  return /[;"\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

const number = (value: number) => decimal(value, 2, false);

/** CSV text without the BOM; sessions oldest first, as a table is read. */
export function sessionsCsv(
  sessions: CsvSession[],
  tariff: CsvTariff,
  columns: CsvColumns,
  tagTitles: Record<"personal" | "business", string>,
): string {
  const header = [columns.date, columns.start, columns.end, columns.nightKWh, columns.dayKWh,
    tariff.source === "estimate" ? columns.rsdEstimate : columns.rsd, columns.tag];
  const rows = [...sessions]
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    .map((s) => [
      dayKey(s.startedAt),
      clockKey(s.startedAt),
      clockKey(s.endedAt),
      number(s.energy.nightKWh),
      number(s.energy.dayKWh),
      number(cost(tariff, s.energy)),
      s.tag ? tagTitles[s.tag] : "",
    ]);
  return [header, ...rows].map((row) => row.map(escapeCsv).join(";")).join("\r\n") + "\r\n";
}

/** "evolako-sesije-2026-09-22.csv" */
export function csvFileName(day: Date): string {
  return `evolako-sesije-${dayKey(day)}.csv`;
}
