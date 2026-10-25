// /obrisi-nalog — the account deletion page Google Play links to: what the page offers for each session, the way
// through sign-in and back, and the texts — the three ways are spelled with the menus' own names, and what the page
// says is deleted and kept stays what the backend does (account-delete and delete_account_data in the iOS repo).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deletionSignInLink, deletionView, DELETE_ACCOUNT_PATH } from "../../src/app/deletion";
import { match, safeNext } from "../../src/app/router";

type Entry = Record<"sr" | "sr-Cyrl" | "en" | "ru", string>;
const catalog = JSON.parse(readFileSync(new URL("../../src/i18n/strings.json", import.meta.url), "utf8")) as Record<string, Entry>;
const page = readFileSync(new URL("../../src/screens/ObrisiNalog.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../src/App.tsx", import.meta.url), "utf8");

describe("what the page offers", () => {
  it("signed in: the account's e-mail and the button — also right after a deletion elsewhere was announced", () => {
    expect(deletionView({ session: "in", signInAvailable: true, deleted: false })).toBe("ready");
    // A new sign-in clears the notice; even if it did not, a signed-in person sees their account, not "deleted".
    expect(deletionView({ session: "in", signInAvailable: true, deleted: true })).toBe("ready");
  });

  it("nobody: sign in first — or 'deleted' when the account just went in this tab", () => {
    expect(deletionView({ session: "out", signInAvailable: true, deleted: false })).toBe("signedOut");
    expect(deletionView({ session: "out", signInAvailable: true, deleted: true })).toBe("done");
  });

  it("the demo has nothing to delete: leave it first; a build without the API has no accounts at all", () => {
    expect(deletionView({ session: "demo", signInAvailable: true, deleted: false })).toBe("demo");
    expect(deletionView({ session: "demo", signInAvailable: false, deleted: false })).toBe("demo");
    expect(deletionView({ session: "out", signInAvailable: false, deleted: false })).toBe("unavailable");
    expect(deletionView({ session: "out", signInAvailable: false, deleted: true })).toBe("unavailable");
  });
});

describe("the address", () => {
  it("is /obrisi-nalog (the one given to Google Play) and a public route of the app", () => {
    expect(DELETE_ACCOUNT_PATH).toBe("/obrisi-nalog");
    expect(match("/obrisi-nalog", DELETE_ACCOUNT_PATH)).toEqual({});
    // Public: listed with the pages that are never sent through sign-in first, not with the account's routes.
    const publicRoutes = app.slice(app.indexOf("const PUBLIC_ROUTES"), app.indexOf("function publicPage"));
    const accountRoutes = app.slice(app.indexOf("const ROUTES"));
    expect(publicRoutes).toContain('{ pattern: "/obrisi-nalog", screen: ObrisiNalog }');
    expect(accountRoutes).not.toContain("/obrisi-nalog");
  });

  it("sign-in returns to the page", () => {
    expect(deletionSignInLink()).toBe("/prijava?next=%2Fobrisi-nalog");
    const next = new URL(deletionSignInLink(), "https://app.evolako.rs").searchParams.get("next");
    expect(safeNext(next)).toBe("/obrisi-nalog");
  });
});

describe("the texts", () => {
  const text = (key: string) => {
    const entry = catalog[key];
    expect(entry, key).toBeTruthy();
    return entry!;
  };

  it("every text of the page is in the catalog in all four languages", () => {
    const keys = [...page.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      for (const l of ["sr", "sr-Cyrl", "en", "ru"] as const) expect(text(key)[l]?.trim(), `${l}: ${key}`).toBeTruthy();
    }
  });

  it("the confirmation and the outcome are the app's own words", () => {
    expect(text("Obrisati nalog?").en).toBe("Delete your account?");
    expect(text("Brišemo ime, kontakt, zahteve i fotografije. Obračuni ostaju samo sa imenom platioca — čuvamo ih po zakonu. Ovo ne može da se poništi.").ru)
      .toBe("Удалим имя, контакты, заявки и фотографии. Отчёты останутся только с именем плательщика — их мы обязаны хранить по закону. Отменить это нельзя.");
    expect(text("Nalog je obrisan.").en).toBe("Your account has been deleted.");
  });

  it("names the law instead of a number of years, and makes no promise of a deadline", () => {
    const kept = text("Obračuni i podaci o plaćanjima — samo sa imenom platioca. Čuvamo ih onoliko dugo koliko to propisuje Zakon o računovodstvu.");
    expect(kept.en).toContain("Law on Accounting");
    expect(kept.ru).toContain("Закон о бухгалтерском учёте");
    const own = Object.keys(catalog).filter((key) => page.includes(JSON.stringify(key).slice(1, -1)));
    for (const key of own) {
      for (const l of ["sr", "en", "ru"] as const) {
        // No retention period and no response time that the backend or the policy does not state.
        expect(text(key)[l], `${l}: ${key}`).not.toMatch(/\b\d+\s*(godin|year|лет|год|dan|day|дн|sat|hour|час)/i);
      }
    }
  });

  it("spells the ways with the menus' own names", () => {
    // The page joins these catalog entries with " → " instead of retyping them: a renamed menu renames the page.
    expect(page).toContain('[t("Podešavanja"), t("Nalog"), t("Obriši nalog")].join(" → ")');
    expect(page).toContain('[t("Profil"), t("Nalog i podešavanja"), t("Obriši nalog")].join(" → ")');
    expect(text("Podešavanja").en).toBe("Settings");
    expect(text("Nalog").ru).toBe("Аккаунт");
    expect(text("Obriši nalog").en).toBe("Delete account");
  });

  it("keeps our address in every language of the 'cannot sign in' line (the page links it)", () => {
    const line = text("Ne možeš da se prijaviš? Piši nam sa e-pošte naloga na hello@evolako.com.");
    for (const l of ["sr", "sr-Cyrl", "en", "ru"] as const) expect(line[l], l).toContain("hello@evolako.com");
  });
});
