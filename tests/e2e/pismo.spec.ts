// Evolako pismo — /pismo (confirm a website sign-up) and /odjava (unsubscribe from tips and news), the pages the
// e-mails link to, against a mocked API (nothing leaves the machine): every state in sr/en/ru at 390 and 1280 px, the
// link out of the address and kept for the tab only, nothing sent before the button, never a retry by itself, the
// demo sending nothing, ?l= of the e-mail links, never indexed, axe with no serious issue, no horizontal scroll
// from 360 to 1440 px. The web version of an issue (/pismo/<slug>) is in posta.spec.ts.
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow, expectTouchTargets, openDemo, watchErrors } from "./helpers";
import { KEY, mockApi, type NewsletterAnswer, type Recorded } from "./mock-api";

// Tokens shaped like the backend's: 43 characters of base64url (confirmation), 32 hex characters (unsubscribe HMAC).
const TOKEN = "Qx2mV7cN0pL4sT9wY1zA3bD5fG8hJ6kR2uE4iO7aS0d";
const TOKEN_2 = "Zp8rT3vB6nM1kQ9wX4cL7dF2gH5jS0aE8uY3iO6tR1w";
const TOKEN_3 = "Lm4nB7vC2xZ9qW6eR1tY8uI3oP5aS0dF7gH2jK4lQ9z";
const HMAC = "0f3a9c2b7d1e4f6a8b0c2d4e6f8a0b1c";
const EMAIL = "mila.petrovic+pismo@example.com";
const ODJAVA = `/odjava?e=${encodeURIComponent(EMAIL)}&t=${HMAC}`;

type Lang = "sr" | "en" | "ru";

const LANGS: Lang[] = ["sr", "en", "ru"];

const TEXT = {
  sr: {
    confirmTitle: "Potvrdi prijavu na Evolako pismo",
    confirmText: "Evolako pismo stiže jednom mesečno: kako da puniš jeftinije kod kuće, šta traži skupština zgrade i šta je novo u Evolako. Odjava je u svakom pismu, jednim klikom.",
    confirmButton: "Potvrdi prijavu",
    confirmed: "Hvala — prijava je potvrđena.",
    confirmedText: "Evolako pismo stiže prve srede u mesecu.",
    expired: "Link je istekao.",
    expiredText: "Prijavi se ponovo na evolako.rs.",
    invalid: "Link nije ispravan.",
    invalidText: "Ako si prijavu već potvrdio, ovaj link više ne važi. Ako nisi, prijavi se ponovo na evolako.rs.",
    limited: "Previše pokušaja. Pokušaj ponovo malo kasnije.",
    offline: "Nema veze sa serverom. Proveri internet i pokušaj ponovo.",
    failed: "Nešto nije u redu. Pokušaj ponovo malo kasnije.",
    retry: "Pokušaj ponovo",
    signIn: "Prijavi se u Moj Evolako",
    open: "Otvori Moj Evolako",
    demo: "U demou ovo nije dostupno: Moj Evolako ovde radi bez servera i ništa ne šalje.",
    write: "Piši nam",
    unsubscribeTitle: "Odjava sa Evolako pisma",
    unsubscribeText: "Više ti nećemo slati savete i novosti. Obaveštenja o nalogu, zahtevima i obračunima stižu i dalje.",
    unsubscribeButton: "Odjavi me",
    done: "Odjavljen si.",
    doneText: "Ako se predomisliš, prijavi se ponovo na evolako.rs.",
    writeUs: "Piši nam na hello@evolako.com i odjavićemo te.",
  },
  en: {
    confirmTitle: "Confirm your Evolako Letter subscription",
    confirmText: "The Evolako Letter comes once a month: how to charge for less at home, what the building assembly needs, and what's new at Evolako. Every letter has a one-click unsubscribe.",
    confirmButton: "Confirm subscription",
    confirmed: "Thanks — you're subscribed.",
    confirmedText: "The Evolako Letter arrives on the first Wednesday of each month.",
    expired: "This link has expired.",
    expiredText: "Please sign up again on evolako.rs.",
    invalid: "This link is not valid.",
    invalidText: "If you've already confirmed, this link no longer works. If not, please sign up again on evolako.rs.",
    limited: "Too many attempts. Try again a little later.",
    offline: "Can't reach the server. Check your internet connection and try again.",
    failed: "Something went wrong. Try again a little later.",
    retry: "Try again",
    signIn: "Sign in to My Evolako",
    open: "Open My Evolako",
    demo: "This isn't available in the demo: here My Evolako runs without a server and sends nothing.",
    write: "Write to us",
    unsubscribeTitle: "Unsubscribe from the Evolako Letter",
    unsubscribeText: "We won't send you tips and news any more. Messages about your account, requests and statements still arrive.",
    unsubscribeButton: "Unsubscribe",
    done: "You're unsubscribed.",
    doneText: "Changed your mind? Sign up again on evolako.rs.",
    writeUs: "Write to us at hello@evolako.com and we'll unsubscribe you.",
  },
  ru: {
    confirmTitle: "Подтверди подписку на Письмо Evolako",
    confirmText: "Письмо Evolako приходит раз в месяц: как заряжаться дешевле дома, что нужно для собрания жильцов и что нового в Evolako. Отписаться можно в каждом письме, одним кликом.",
    confirmButton: "Подтвердить подписку",
    confirmed: "Спасибо — подписка подтверждена.",
    confirmedText: "Письмо Evolako приходит в первую среду месяца.",
    expired: "Ссылка устарела.",
    expiredText: "Подпишись ещё раз на evolako.rs.",
    invalid: "Ссылка недействительна.",
    invalidText: "Если ты уже подтвердил подписку, эта ссылка больше не работает. Если нет — подпишись ещё раз на evolako.rs.",
    limited: "Слишком много попыток. Попробуй чуть позже.",
    offline: "Нет связи с сервером. Проверь интернет и попробуй ещё раз.",
    failed: "Что-то пошло не так. Попробуй чуть позже.",
    retry: "Попробовать снова",
    signIn: "Войти в Мой Evolako",
    open: "Открыть Мой Evolako",
    demo: "В демо это недоступно: здесь Мой Evolako работает без сервера и ничего не отправляет.",
    write: "Напиши нам",
    unsubscribeTitle: "Отписка от Письма Evolako",
    unsubscribeText: "Мы больше не будем присылать советы и новости. Письма об аккаунте, заявках и отчётах продолжат приходить.",
    unsubscribeButton: "Отписаться",
    done: "Ты отписан.",
    doneText: "Если передумаешь — подпишись снова на evolako.rs.",
    writeUs: "Напиши нам на hello@evolako.com — и мы тебя отпишем.",
  },
} satisfies Record<Lang, Record<string, string>>;

const answer = (status: number, body: unknown): NewsletterAnswer => ({ status, body });
const calls = (log: Recorded[]) => log.filter((r) => r.path === "/functions/v1/newsletter");
/** Console noise of the failures the tests cause on purpose (429, 5xx, a dropped connection). */
const expected = (e: string) => /Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(e);

/** Every request to a newsletter function from now on, on any origin (in the demo apiBase is "": it would be this site). */
function watchNewsletter(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "OPTIONS" && new URL(r.url()).pathname.startsWith("/functions/")) seen.push(r.url());
  });
  return seen;
}

function card(page: Page, testId: "pismo" | "odjava") {
  return page.getByTestId(testId).locator("section.public-state");
}

function heading(page: Page) {
  return page.getByRole("heading", { level: 1 });
}

async function check(page: Page, label: string) {
  await expectNoHorizontalOverflow(page, label);
  await expectAccessible(page, label);
}

/** The app's own config says demo (apiBase ""), whatever mockApi installed before. */
async function demoConfig(page: Page) {
  await page.route("**/config.json", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ apiBase: "", publishableKey: "", demo: true }),
  }));
}

test.describe("/pismo — confirm a website sign-up", () => {
  for (const lang of LANGS) {
    for (const width of [390, 1280]) {
      test(`every state — ${lang}, ${width} px`, async ({ page }) => {
        const x = TEXT[lang];
        const errors = watchErrors(page);
        await page.setViewportSize({ width, height: 900 });
        const log = await mockApi(page, { newsletter: [
          answer(429, { ok: false, error: "limit" }), "abort", answer(400, { ok: false, error: "json" }),
          answer(200, { ok: true, status: "confirmed" }), answer(200, { ok: false, status: "expired" }),
          answer(200, { ok: false, status: "invalid" }),
        ] });
        const state = card(page, "pismo");

        // The title, the short text and one button — and nothing sent yet.
        await page.goto(`/pismo?t=${TOKEN}&l=${lang}`);
        await expect(state).toHaveAttribute("data-state", "ready");
        await expect(heading(page)).toHaveText(x.confirmTitle);
        await expect(state).toContainText(x.confirmText);
        await expect(state.getByRole("button")).toHaveCount(1);
        await expect(page.getByTestId("pismo-confirm")).toHaveText(x.confirmButton);
        await expect(page).toHaveTitle(`${x.confirmTitle} · ${lang === "sr" ? "Moj Evolako" : lang === "en" ? "My Evolako" : "Мой Evolako"}`);
        expect(calls(log)).toHaveLength(0);
        await check(page, `ready ${lang} ${width}`);

        // 429: too many attempts; the same one button, for another try.
        await page.getByTestId("pismo-confirm").click();
        await expect(page.getByTestId("problem")).toHaveText(x.limited);
        await expect(page.getByTestId("pismo-confirm")).toHaveText(x.retry);
        await expect(state.getByRole("button")).toHaveCount(1);
        await check(page, `limited ${lang} ${width}`);

        // The connection drops: no connection — and exactly one request for this press.
        await page.getByTestId("pismo-confirm").click();
        await expect(page.getByTestId("problem")).toHaveAttribute("data-problem", "offline");
        await expect(page.getByTestId("problem")).toHaveText(x.offline);
        expect(calls(log)).toHaveLength(2);
        await check(page, `offline ${lang} ${width}`);

        // An answer nobody expected.
        await page.getByTestId("pismo-confirm").click();
        await expect(page.getByTestId("problem")).toHaveAttribute("data-problem", "failed");
        await expect(page.getByTestId("problem")).toHaveText(x.failed);

        // Confirmed: thanks, when it arrives, and the ways on.
        await page.getByTestId("pismo-confirm").click();
        await expect(state).toHaveAttribute("data-state", "confirmed");
        await expect(heading(page)).toHaveText(x.confirmed);
        await expect(heading(page)).toBeFocused();
        await expect(state).toContainText(x.confirmedText);
        await expect(page.getByTestId("problem")).toHaveCount(0);
        await expect(page.getByTestId("site-link")).toHaveAttribute("href", `https://www.evolako.rs?lang=${lang}`);
        await expect(page.getByTestId("site-link")).toHaveAttribute("target", "_blank");
        await expect(page.getByTestId("account-link")).toHaveText(x.signIn);
        await expect(page.getByTestId("account-link")).toHaveAttribute("href", "/prijava");
        expect(calls(log)).toHaveLength(4);
        await check(page, `confirmed ${lang} ${width}`);

        // Another link in the same tab: expired.
        await page.goto(`/pismo?t=${TOKEN_2}`);
        await page.getByTestId("pismo-confirm").click();
        await expect(state).toHaveAttribute("data-state", "expired");
        await expect(heading(page)).toHaveText(x.expired);
        await expect(state).toContainText(x.expiredText);
        await expect(page.getByTestId("site-link")).toBeVisible();
        await check(page, `expired ${lang} ${width}`);

        // And one the server does not know: invalid.
        await page.goto(`/pismo?t=${TOKEN_3}`);
        await page.getByTestId("pismo-confirm").click();
        await expect(state).toHaveAttribute("data-state", "invalid");
        await expect(heading(page)).toHaveText(x.invalid);
        await expect(state).toContainText(x.invalidText);
        await check(page, `invalid ${lang} ${width}`);
        expect(calls(log)).toHaveLength(6);

        // No token, or a broken one: not a link — without asking the server.
        await page.evaluate(() => sessionStorage.clear());
        for (const path of ["/pismo", "/pismo?t=", "/pismo?t=abc", "/pismo?t=a%20b%20c%20d%20e%20f%20g%20h"]) {
          await page.goto(path);
          await expect(state, path).toHaveAttribute("data-state", "invalid");
          await expect(heading(page)).toHaveText(x.invalid);
        }
        expect(calls(log)).toHaveLength(6);

        // The demo (no API configured) sends nothing at all.
        await demoConfig(page);
        const sent = watchNewsletter(page);
        await page.goto(`/pismo?t=${TOKEN}`);
        await expect(state).toHaveAttribute("data-state", "demo");
        await expect(heading(page)).toHaveText(x.confirmTitle);
        await expect(state).toContainText(x.demo);
        await expect(page.getByTestId("pismo-confirm")).toHaveCount(0);
        await expect(page.getByTestId("write-link")).toHaveText(x.write);
        await expect(page.getByTestId("write-link")).toHaveAttribute("href", /^mailto:hello@evolako\.com\?subject=/);
        await check(page, `demo ${lang} ${width}`);
        expect(calls(log)).toHaveLength(6);
        expect(sent).toEqual([]);
        expect(errors.filter((e) => !expected(e))).toEqual([]);
      });
    }
  }
});

test.describe("/odjava — unsubscribe", () => {
  for (const lang of LANGS) {
    for (const width of [390, 1280]) {
      test(`every state — ${lang}, ${width} px`, async ({ page }) => {
        const x = TEXT[lang];
        const errors = watchErrors(page);
        await page.setViewportSize({ width, height: 900 });
        const log = await mockApi(page, { newsletter: [
          "abort", answer(503, {}), answer(429, { ok: false, error: "limit" }), answer(400, { ok: false, error: "json" }),
          answer(200, { ok: true }), answer(400, { ok: false, error: "invalid" }),
        ] });
        const state = card(page, "odjava");

        // The title, what stops and what does not, the address, one button — nothing sent yet.
        await page.goto(`${ODJAVA}&l=${lang}`);
        await expect(state).toHaveAttribute("data-state", "ready");
        await expect(heading(page)).toHaveText(x.unsubscribeTitle);
        await expect(state).toContainText(x.unsubscribeText);
        await expect(page.getByTestId("odjava-email")).toContainText(EMAIL);
        await expect(state.getByRole("button")).toHaveCount(1);
        await expect(page.getByTestId("odjava-confirm")).toHaveText(x.unsubscribeButton);
        expect(calls(log)).toHaveLength(0);
        await check(page, `ready ${lang} ${width}`);

        // No connection, twice (a dropped connection, then a 503): the retry button, pressed by hand only.
        await page.getByTestId("odjava-confirm").click();
        await expect(page.getByTestId("problem")).toHaveText(x.offline);
        await expect(page.getByTestId("odjava-confirm")).toHaveText(x.retry);
        await check(page, `offline ${lang} ${width}`);
        await page.getByTestId("odjava-confirm").click();
        await expect(page.getByTestId("problem")).toHaveText(x.offline);
        expect(calls(log)).toHaveLength(2);

        await page.getByTestId("odjava-confirm").click();
        await expect(page.getByTestId("problem")).toHaveText(x.limited);
        await page.getByTestId("odjava-confirm").click();
        await expect(page.getByTestId("problem")).toHaveText(x.failed);
        await check(page, `failed ${lang} ${width}`);

        // Done.
        await page.getByTestId("odjava-confirm").click();
        await expect(state).toHaveAttribute("data-state", "done");
        await expect(heading(page)).toHaveText(x.done);
        await expect(heading(page)).toBeFocused();
        await expect(state).toContainText(x.doneText);
        await expect(page.getByTestId("odjava-email")).toContainText(EMAIL);
        await expect(page.getByTestId("site-link")).toHaveAttribute("href", `https://www.evolako.rs?lang=${lang}`);
        expect(calls(log)).toHaveLength(5);
        await check(page, `done ${lang} ${width}`);

        // A link whose token does not belong to the address: invalid — write to us.
        await page.goto(`/odjava?e=${encodeURIComponent(EMAIL)}&t=${"f".repeat(32)}`);
        await page.getByTestId("odjava-confirm").click();
        await expect(state).toHaveAttribute("data-state", "invalid");
        await expect(heading(page)).toHaveText(x.invalid);
        await expect(state).toContainText(x.writeUs);
        await expect(page.getByTestId("write-link")).toHaveAttribute("href", /^mailto:hello@evolako\.com\?subject=/);
        await check(page, `invalid ${lang} ${width}`);
        expect(calls(log)).toHaveLength(6);

        // Half a link, or none: invalid without a request.
        await page.evaluate(() => sessionStorage.clear());
        for (const path of ["/odjava", `/odjava?e=${encodeURIComponent(EMAIL)}`, `/odjava?t=${HMAC}`, `/odjava?e=mila%40&t=${HMAC}`]) {
          await page.goto(path);
          await expect(state, path).toHaveAttribute("data-state", "invalid");
        }
        expect(calls(log)).toHaveLength(6);

        // The demo sends nothing.
        await demoConfig(page);
        const sent = watchNewsletter(page);
        await page.goto(ODJAVA);
        await expect(state).toHaveAttribute("data-state", "demo");
        await expect(heading(page)).toHaveText(x.unsubscribeTitle);
        await expect(state).toContainText(x.demo);
        await expect(page.getByTestId("odjava-confirm")).toHaveCount(0);
        await check(page, `demo ${lang} ${width}`);
        expect(calls(log)).toHaveLength(6);
        expect(sent).toEqual([]);
        expect(errors.filter((e) => !expected(e))).toEqual([]);
      });
    }
  }
});

test.describe("the e-mail links", () => {
  test("nothing is sent before the button; one press, one request, exactly as the backend expects", async ({ page }) => {
    const log = await mockApi(page, { newsletter: ["abort", answer(200, { ok: true, status: "confirmed" }), answer(200, { ok: true })] });
    const sent = watchNewsletter(page);
    await page.goto(`/pismo?t=${TOKEN}`);
    await expect(page.getByTestId("pismo-confirm")).toBeVisible();
    // A mail scanner that opens the link and runs its scripts leaves without pressing anything.
    await page.waitForTimeout(1000);
    expect(calls(log)).toHaveLength(0);
    expect(sent).toEqual([]);

    await page.getByTestId("pismo-confirm").click();
    await expect(page.getByTestId("problem")).toHaveAttribute("data-problem", "offline");
    await page.waitForTimeout(500);
    // Not retried by itself: the answer may have been lost after the server confirmed.
    expect(calls(log)).toHaveLength(1);
    const [call] = calls(log);
    expect(call!.method).toBe("POST");
    expect(call!.body).toEqual({ action: "confirm", token: TOKEN });
    expect(call!.headers.apikey).toBe(KEY);
    expect(call!.headers["content-type"]).toBe("application/json");
    expect(call!.headers.authorization).toBeUndefined();

    // A double press sends once.
    await page.getByTestId("pismo-confirm").dblclick();
    await expect(card(page, "pismo")).toHaveAttribute("data-state", "confirmed");
    expect(calls(log)).toHaveLength(2);

    await page.goto(`${ODJAVA}&l=ru`);
    await expect(page.getByTestId("odjava-confirm")).toBeVisible();
    await page.waitForTimeout(1000);
    expect(calls(log)).toHaveLength(2);
    await page.getByTestId("odjava-confirm").click();
    await expect(card(page, "odjava")).toHaveAttribute("data-state", "done");
    const unsubscribe = calls(log)[2]!;
    expect(unsubscribe.body).toEqual({ action: "unsubscribe", e: EMAIL, t: HMAC, l: "ru" });
    expect(unsubscribe.headers.apikey).toBe(KEY);
    expect(unsubscribe.headers.authorization).toBeUndefined();
  });

  test("the link leaves the address at once and stays with this tab only; a reload works, also after the answer", async ({ page, context }) => {
    const log = await mockApi(page, { newsletter: [answer(200, { ok: true, status: "confirmed" }), answer(200, { ok: true })] });
    await page.goto(`/pismo?t=${TOKEN}&l=en&utm_source=pismo`);
    await expect(page.getByTestId("pismo-confirm")).toBeVisible();
    await expect(page).toHaveURL(/\/pismo\?utm_source=pismo$/);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(TOKEN);
    expect(await page.evaluate(() => sessionStorage.getItem("evo.pismo.potvrda"))).toContain(TOKEN);

    await page.reload();
    await expect(page.getByTestId("pismo-confirm")).toBeVisible();
    expect(calls(log)).toHaveLength(0);
    await page.getByTestId("pismo-confirm").click();
    await expect(card(page, "pismo")).toHaveAttribute("data-state", "confirmed");
    // A reload shows the outcome again: the used token is not sent a second time (it would now be "invalid").
    await page.reload();
    await expect(card(page, "pismo")).toHaveAttribute("data-state", "confirmed");
    expect(calls(log)).toHaveLength(1);

    // Another tab has its own session storage: nothing of this link there.
    const other = await context.newPage();
    await mockApi(other);
    await other.goto("/pismo");
    await expect(card(other, "pismo")).toHaveAttribute("data-state", "invalid");
    await other.close();

    await page.goto(`${ODJAVA}&l=ru`);
    await expect(page.getByTestId("odjava-confirm")).toBeVisible();
    await expect(page).toHaveURL(/\/odjava$/);
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    expect(stored).not.toContain(HMAC);
    expect(stored).not.toContain("mila.petrovic");
    await page.reload();
    await expect(page.getByTestId("odjava-email")).toContainText(EMAIL);
    await page.getByTestId("odjava-confirm").click();
    await expect(card(page, "odjava")).toHaveAttribute("data-state", "done");
    await page.reload();
    await expect(card(page, "odjava")).toHaveAttribute("data-state", "done");
    expect(calls(log)).toHaveLength(2);
  });

  test("?l=: applied before the first paint, remembered, taken out — on /pismo and /odjava only; ?lang= wins", async ({ page }) => {
    await mockApi(page);
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        (window as unknown as { langAtLoad: string }).langAtLoad = document.documentElement.lang;
      });
    });
    await page.goto(`/pismo?t=${TOKEN}&l=ru`);
    await expect(heading(page)).toHaveText(TEXT.ru.confirmTitle);
    expect(await page.evaluate(() => (window as unknown as { langAtLoad: string }).langAtLoad)).toBe("ru");
    await expect(page).toHaveURL(/\/pismo$/);
    expect(await page.evaluate(() => localStorage.getItem("evo.lang"))).toBe("ru");

    await page.goto(`${ODJAVA}&l=ru&lang=en`);
    await expect(heading(page)).toHaveText(TEXT.en.unsubscribeTitle);
    await expect(page).toHaveURL(/\/odjava$/);

    // Elsewhere ?l= is nobody's business.
    await page.goto("/prijava?l=sr");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveURL(/\/prijava\?l=sr$/);
  });

  test("an installed app still running an older boot.js: the page applies ?l= itself", async ({ page }) => {
    await mockApi(page);
    // A boot.js from before ?l= existed (the service worker serves it from its cache until the update is accepted).
    await page.route("**/boot.js", (route) => route.fulfill({
      contentType: "text/javascript",
      body: "(function(){var l='sr';try{l=localStorage.getItem('evo.lang')||'sr';}catch(e){}document.documentElement.setAttribute('lang',l==='sr'?'sr-Latn':l);})();",
    }));
    await page.goto(`/pismo?t=${TOKEN}&l=en`);
    await expect(heading(page)).toHaveText(TEXT.en.confirmTitle);
    await expect(page).toHaveURL(/\/pismo$/);
    expect(await page.evaluate(() => localStorage.getItem("evo.lang"))).toBe("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("the same page in a demo session, without the account's navigation; Moj Evolako opens the account", async ({ page }) => {
    await mockApi(page, { newsletter: [answer(200, { ok: true, status: "confirmed" })] });
    await openDemo(page, "wallbox", `/pismo?t=${TOKEN}`);
    await expect(card(page, "pismo")).toHaveAttribute("data-state", "ready");
    await expect(page.locator(".tabbar, .sidebar")).toHaveCount(0);
    await page.getByTestId("pismo-confirm").click();
    await expect(page.getByTestId("account-link")).toHaveText(TEXT.sr.open);
    await page.getByTestId("account-link").click();
    await expect(page).toHaveURL(/\/danas$/);
    await expect(page.getByTestId("live-session")).toBeVisible();
  });
});

test.describe("dark theme", () => {
  test("the states read well in the dark too (axe)", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("evo.theme", "dark"));
    await mockApi(page, { newsletter: [answer(429, { ok: false, error: "limit" }), answer(200, { ok: true, status: "confirmed" }),
      answer(503, {}), answer(200, { ok: true })] });
    await page.goto(`/pismo?t=${TOKEN}&l=sr`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByTestId("pismo-confirm").click();
    await expect(page.getByTestId("problem")).toBeVisible();
    await check(page, "pismo limited dark");
    await page.getByTestId("pismo-confirm").click();
    await expect(card(page, "pismo")).toHaveAttribute("data-state", "confirmed");
    await check(page, "pismo confirmed dark");
    await page.goto(ODJAVA);
    await page.getByTestId("odjava-confirm").click();
    await expect(page.getByTestId("problem")).toBeVisible();
    await check(page, "odjava offline dark");
    await page.getByTestId("odjava-confirm").click();
    await expect(card(page, "odjava")).toHaveAttribute("data-state", "done");
    await check(page, "odjava done dark");
  });
});

test.describe("indexing", () => {
  test("never indexed: the X-Robots-Tag header and the robots meta", async ({ page, request }) => {
    for (const path of ["/pismo", "/odjava"]) {
      expect((await request.get(path)).headers()["x-robots-tag"], path).toBe("noindex, nofollow");
    }
    await mockApi(page);
    for (const path of [`/pismo?t=${TOKEN}`, ODJAVA]) {
      await page.goto(path);
      await page.locator("#page-title").waitFor();
      await expect(page.locator('meta[name="robots"]'), path).toHaveAttribute("content", "noindex, nofollow");
    }
  });
});

test.describe("layout", () => {
  test("no horizontal scroll from 360 to 1440 px; 44 px touch targets", async ({ page }) => {
    const long = "aleksandra.dimitrijevic-petrovic+evolako.pismo@primer-kompanije.co.rs";
    await mockApi(page, { newsletter: (body) => (body.action === "confirm"
      ? answer(200, { ok: true, status: "confirmed" }) : answer(429, { ok: false, error: "limit" })) });
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      // A new link per width (the tab keeps the outcome of the previous one).
      await page.goto(`/pismo?t=${TOKEN.slice(0, 39)}${String(width).padStart(4, "0")}&l=ru`);
      await expect(card(page, "pismo")).toHaveAttribute("data-state", "ready");
      await expectNoHorizontalOverflow(page, `pismo ready ${width}`);
      await page.getByTestId("pismo-confirm").click();
      await expect(card(page, "pismo")).toHaveAttribute("data-state", "confirmed");
      await expectNoHorizontalOverflow(page, `pismo confirmed ${width}`);
      if (width === 390) await expectTouchTargets(page, "pismo confirmed");

      await page.goto(`/odjava?e=${encodeURIComponent(long)}&t=${HMAC}`);
      await page.getByTestId("odjava-confirm").click();
      await expect(page.getByTestId("problem")).toBeVisible();
      await expectNoHorizontalOverflow(page, `odjava ${width}`);
      if (width === 390) await expectTouchTargets(page, "odjava");
    }
  });
});
