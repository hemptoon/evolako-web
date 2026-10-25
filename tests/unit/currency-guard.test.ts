// Guard (VALUTA_SPEC §7, §8.2): everything payable stays in dinars whatever the display currency. The payable
// modules never import the display currency, and with EUR or USD chosen the CSV and the IPS QR payload are byte for
// byte what they are with RSD — no "€", "$", "EUR" or "USD" in them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStatement } from "../../src/api/parse";
import { sessionsCsv } from "../../src/lib/csv";
import { buildIps, ipsAmount, parseIps } from "../../src/lib/payments";
import statementFixture from "../fixtures/api/statement_2026_09.json";

const ROOT = join(__dirname, "../..");
const FOREIGN = /€|\$|\bEUR\b|\bUSD\b/;

/** Statements (screen, print/PDF), IPS QR, CSV, e-mails' issue pages, request forms, the bill's prices. */
const PAYABLE = [
  "src/screens/Obracun.tsx",
  "src/screens/Obracuni.tsx",
  "src/screens/statement/PrintDocument.tsx",
  "src/screens/statement/parts.tsx",
  "src/ui/QrCode.tsx",
  "src/lib/payments.ts",
  "src/lib/qr.ts",
  "src/lib/csv.ts",
  "src/lib/statement.ts",
  "src/lib/forms.ts",
  "src/api/posta.ts",
  "src/screens/pismo/Pismo.tsx",
  "src/screens/lead/RequestForm.tsx",
  "src/screens/lead/ZatraziProcenu.tsx",
  "src/screens/profil/CeneStruje.tsx",
];

describe("payable modules never see the display currency", () => {
  for (const file of PAYABLE) {
    it(file, () => {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source).not.toMatch(/app\/currency|ui\/money|foreignAmount|foreignRate|ownPrice|referenceAmount|compactAmount/);
      // "$" is everywhere in code (template literals): the source guard looks for the euro sign and the codes.
      expect(source).not.toMatch(/€|\bEUR\b|\bUSD\b/);
    });
  }
});

describe("with EUR or USD chosen, the payable output is unchanged", () => {
  beforeEach(() => {
    vi.resetModules();
    const map = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => map.set(k, v),
      removeItem: (k: string) => map.delete(k), key: () => null, length: 0,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const statement = parseStatement(statementFixture);
  const columns = { date: "Datum", start: "Početak", end: "Kraj", nightKWh: "kWh noć", dayKWh: "kWh dan",
    rsd: "RSD", rsdEstimate: "RSD (procena)", tag: "Oznaka" };
  const tags = { personal: "lično", business: "službeno" };
  const tariff = { lowRateRSDPerKWh: 5.7, highRateRSDPerKWh: 19.65, source: "meterOwnerBill" as const };
  const ips = () => buildIps({
    account: "160000000000000173", payeeName: "SZ Bulevar oslobođenja 12, Novi Sad", amount: 3208.42,
    purpose: "Struja za punjenje, septembar 2026",
  });

  async function outputs() {
    return {
      csv: sessionsCsv(statement.sessions, tariff, columns, tags),
      qrs: [statement.energyPart?.qrPayload, statement.servicePart?.qrPayload, ips()],
      amount: ipsAmount(3208.42),
    };
  }

  it("CSV, QR payloads and the IPS amount", async () => {
    const { currency } = await import("../../src/app/currency");
    expect(currency.value).toBe("RSD");
    const rsd = await outputs();
    for (const code of ["EUR", "USD"] as const) {
      currency.value = code;
      const other = await outputs();
      expect(other).toEqual(rsd);
      expect(other.csv).not.toMatch(FOREIGN);
      for (const qr of other.qrs) if (qr) expect(qr).not.toMatch(FOREIGN);
      expect(parseIps(other.qrs[2]!).I).toBe("RSD3208,42");
    }
  });
});
