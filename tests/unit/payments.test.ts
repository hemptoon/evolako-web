import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { parseStatement } from "../../src/api/parse";
import {
  accountDisplay,
  buildIps,
  ipsAmount,
  isValidAccount,
  isValidPoziv,
  makeAccount,
  makePoziv,
  mod97Control,
  parseIps,
  pozivDisplay,
  pozivTag,
} from "../../src/lib/payments";
import { encodedEccOrdinal, encodeQr, qrPath, rasterize } from "../../src/lib/qr";
import { isPayable, isPayableNow, paymentPurpose, statementTotal } from "../../src/lib/statement";
import statementFixture from "../fixtures/api/statement_2026_09.json";

const NBS_EXAMPLE =
  "K:PR|V:01|C:1|R:845000000040484987|N:JP EPS BEOGRAD|I:RSD3596,13|SF:189|S:Uplata po racunu|RO:97163220000111111111000";

function decode(payload: string) {
  const { data, width } = rasterize(encodeQr(payload), 4);
  return jsQR(data, width, width);
}

describe("bank account", () => {
  it("validates mod 97", () => {
    expect(isValidAccount("160000000000000173")).toBe(true);
    expect(isValidAccount("160000000000000076")).toBe(true);
    expect(isValidAccount("845000000040484987")).toBe(true);
    expect(isValidAccount("160000000000000174")).toBe(false);
    expect(isValidAccount("16000000000000017")).toBe(false);
  });

  it("formats for reading", () => {
    expect(accountDisplay("160000000000000173")).toBe("160-0000000000001-73");
    expect(accountDisplay("abc")).toBe("abc");
  });

  it("builds the control digits", () => {
    expect(makeAccount("160", "404039")).toBe("160000000040403971");
    expect(isValidAccount(makeAccount("160", "404039")!)).toBe(true);
  });
});

describe("poziv na broj", () => {
  it("computes model 97 control digits like the NBS example", () => {
    expect(mod97Control("3220000111111111000")).toBe("16");
    expect(makePoziv("97", "3220000111111111000")).toEqual({ model: "97", reference: "163220000111111111000" });
  });

  it("matches the backend fixture", () => {
    const statement = parseStatement(statementFixture);
    const energy = statement.energyPart!;
    expect(isValidPoziv(energy.pozivNaBroj!)).toBe(true);
    expect(pozivTag(energy.pozivNaBroj!)).toBe("97461202609000001");
    expect(pozivDisplay(energy.pozivNaBroj!)).toBe("97 46-1202609000001");
    expect(parseIps(energy.qrPayload).RO).toBe(pozivTag(energy.pozivNaBroj!));
    expect(isValidPoziv({ model: "97", reference: "471202609000001" })).toBe(false);
  });
});

describe("IPS QR", () => {
  it("parses the payload into tags", () => {
    const f = parseIps(NBS_EXAMPLE);
    expect(f.R).toBe("845000000040484987");
    expect(f.N).toBe("JP EPS BEOGRAD");
    expect(f.I).toBe("RSD3596,13");
    expect(f.S).toBe("Uplata po racunu");
  });

  it("formats the amount tag", () => {
    expect(ipsAmount(1690)).toBe("RSD1690,00");
    expect(ipsAmount(310.62)).toBe("RSD310,62");
    expect(ipsAmount(0)).toBe("RSD0,00");
    expect(ipsAmount(3596.125)).toBe("RSD3596,13");
  });

  it("builds the NBS example byte for byte", () => {
    const payload = buildIps({
      account: "845000000040484987", payeeName: "JP EPS BEOGRAD", amount: 3596.13, purpose: "Uplata po racunu",
      paymentCode: "189", poziv: makePoziv("97", "3220000111111111000"),
    });
    expect(payload).toBe(NBS_EXAMPLE);
  });

  it("refuses an account a bank would reject", () => {
    expect(() => buildIps({ account: "160000000000000174", payeeName: "X", amount: 1, purpose: "Y" })).toThrow();
  });

  it("encodes at error correction level M exactly", () => {
    expect(encodedEccOrdinal(NBS_EXAMPLE)).toBe(1); // Ecc.MEDIUM.ordinal
    expect(encodedEccOrdinal("K:PR")).toBe(1); // no automatic boost to Q/H for short payloads
  });

  it("round-trips the fixture payload byte for byte (encode → rasterise → jsQR)", () => {
    const payload = parseStatement(statementFixture).energyPart!.qrPayload;
    expect(payload).toContain("oslobođenja"); // UTF-8, tag C:1
    const result = decode(payload);
    expect(result).not.toBeNull();
    expect(Buffer.from(result!.binaryData)).toEqual(Buffer.from(payload, "utf8"));
    expect(result!.data).toBe(payload);
  });

  it("round-trips the NBS example", () => {
    expect(decode(NBS_EXAMPLE)?.data).toBe(NBS_EXAMPLE);
  });

  it("draws one path of horizontal runs inside the quiet zone", () => {
    const matrix = encodeQr(NBS_EXAMPLE);
    const path = qrPath(matrix, 4);
    expect(path.startsWith("M4 4h7v1h-7z")).toBe(true); // the top-left finder pattern row
    const dark = matrix.dark.filter(Boolean).length;
    const area = [...path.matchAll(/h(\d+)v1/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    expect(area).toBe(dark);
  });
});

describe("statement helpers", () => {
  it("adds the two independent parts", () => {
    const statement = parseStatement(statementFixture);
    expect(statementTotal(statement)).toBeCloseTo(310.62);
    expect(paymentPurpose(statement.energyPart!)).toBe("Struja punjac 09/2026");
    // Trial: amount 0 and no payload — nothing to scan.
    expect(statement.servicePart!.isTrial).toBe(true);
    expect(statement.servicePart!.qrPayload).toBe("");
  });

  it("never offers a paid statement for payment", () => {
    const paid = parseStatement(statementFixture);
    expect(paid.status).toBe("paid");
    // The energy part still has a payload and an amount (the document is kept as issued) …
    expect(isPayable(paid.energyPart)).toBe(true);
    // … but it is paid: no QR, no copy — for the record only.
    expect(isPayableNow(paid, paid.energyPart)).toBe(false);
    expect(isPayableNow(paid, paid.servicePart)).toBe(false);
    const issued = parseStatement({ ...statementFixture, status: "issued" });
    expect(isPayableNow(issued, issued.energyPart)).toBe(true);
    // A 0 RSD trial part has nothing to pay either way.
    expect(isPayableNow(issued, issued.servicePart)).toBe(false);
    expect(isPayableNow(issued, null)).toBe(false);
  });
});
