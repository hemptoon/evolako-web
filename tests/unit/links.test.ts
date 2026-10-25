// Deep links: the e-mail footer's #podesavanja, prefilled e-mail and referral code, statement months.
import { describe, expect, it } from "vitest";
import { hashRoute, prefillEmail, prefillReferral } from "../../src/app/links";
import { match, safeNext } from "../../src/app/router";
import { parseMonthKey } from "../../src/lib/belgrade";

const q = (search: string) => new URLSearchParams(search);

describe("hash links", () => {
  it("sends the e-mail footer's #podesavanja to the account settings", () => {
    for (const hash of ["#podesavanja", "#/podesavanja", "#PODESAVANJA", "#podesavanja/", "#%70odesavanja"]) {
      expect(hashRoute(hash), hash).toBe("/profil/nalog");
    }
  });

  it("leaves every other hash alone (the skip link, anchors, junk)", () => {
    for (const hash of ["", "#", "#main", "#page-title", "#constructor", "#__proto__", "#podesavanja-x", "#%E0%A4%A"]) {
      expect(hashRoute(hash), hash).toBeNull();
    }
  });
});

describe("prefilled forms", () => {
  it("takes ?email= only when it looks like an address", () => {
    expect(prefillEmail(q("?email=Mila%40Example.com"))).toBe("mila@example.com");
    expect(prefillEmail(q("?email=%20ana@example.com%20&next=%2Fdanas"))).toBe("ana@example.com");
    expect(prefillEmail(q("?email=mila@"))).toBe("");
    expect(prefillEmail(q("?email=mila example@example.com"))).toBe("");
    expect(prefillEmail(q(`?email=${"a".repeat(250)}@example.com`))).toBe("");
    expect(prefillEmail(q(""))).toBe("");
  });

  it("takes ?ref= only when it is a valid EVO-XXXXX code", () => {
    expect(prefillReferral(q("?ref=EVO-K7PQ2"))).toBe("EVO-K7PQ2");
    expect(prefillReferral(q("?ref=evo-k7pq2"))).toBe("EVO-K7PQ2");
    expect(prefillReferral(q("?ref=EVO-K7PQ2&paket=wallbox"))).toBe("EVO-K7PQ2");
    // Look-alikes (0, O, 1, I, L) are never in a code; wrong length or prefix is not a code either.
    for (const bad of ["EVO-K7PQ1", "EVO-K7PQO", "EVO-K7PQ", "EVO-K7PQ22", "EV0-K7PQ2", "K7PQ2", ""]) {
      expect(prefillReferral(q(`?ref=${encodeURIComponent(bad)}`)), bad).toBe("");
    }
    expect(prefillReferral(q("?paket=wallbox"))).toBe("");
  });
});

describe("statement months and returns", () => {
  it("reads /obracuni/YYYY-MM strictly", () => {
    expect(parseMonthKey("2026-09")).toEqual({ year: 2026, month: 9 });
    expect(parseMonthKey("2026-12")).toEqual({ year: 2026, month: 12 });
    for (const bad of ["2026-13", "2026-00", "2026-9", "26-09", "2026-09-01", "septembar", ""]) {
      expect(parseMonthKey(bad), bad).toBeNull();
    }
  });

  it("matches routes without ever throwing on a malformed address", () => {
    expect(match("/obracuni/:month", "/obracuni/2026-09")).toEqual({ month: "2026-09" });
    expect(match("/paketi/:id", "/paketi/wallbox%20b")).toEqual({ id: "wallbox b" });
    for (const bad of ["/obracuni/%", "/obracuni/%E0%A4%A", "/obracuni/%zz"]) {
      expect(() => match("/obracuni/:month", bad), bad).not.toThrow();
      expect(match("/obracuni/:month", bad), bad).toBeNull();
    }
    expect(match("/obracuni", "/obracuni/2026-09")).toBeNull();
  });

  it("returns after sign-in only inside the app", () => {
    expect(safeNext("/obracuni/2026-09")).toBe("/obracuni/2026-09");
    expect(safeNext("/zatrazi-procenu?ref=EVO-K7PQ2")).toBe("/zatrazi-procenu?ref=EVO-K7PQ2");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "danas", null]) {
      expect(safeNext(bad), String(bad)).toBeNull();
    }
  });
});
