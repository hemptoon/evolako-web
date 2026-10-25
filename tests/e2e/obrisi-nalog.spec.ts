// /obrisi-nalog — deleting the account without the app (the address given to Google Play), against a mocked API
// (nothing leaves the machine): the page opens directly and reads without signing in, in sr / sr-Cyrl / en / ru at 390
// and 1280 px; sign-in returns here; the deletion needs an explicit confirmation, is sent once per press with the
// user's token, says every problem in words and ends on "Nalog je obrisan." with the session forgotten; an ended
// session, the demo and a build without the API; never indexed; axe with no serious issue in both themes; no
// horizontal scroll from 360 to 1440 px.
import { expect, test, type Page } from "@playwright/test";
import { chooseLang, expectAccessible, expectNoHorizontalOverflow, expectTouchTargets, openDemo, watchErrors } from "./helpers";
import { ACCESS, GOOD_CODE, KEY, mockApi, type Recorded } from "./mock-api";

type Lang = "sr" | "sr-Cyrl" | "en" | "ru";
const LANGS: Lang[] = ["sr", "sr-Cyrl", "en", "ru"];
const EMAIL = "mila@example.com";

const TEXT = {
  sr: {
    app: "Moj Evolako",
    title: "Brisanje naloga",
    lead: "Evolako nalog možeš da obrišeš sam — ovde, bez aplikacije, ili u aplikaciji. Isti je u aplikaciji Evolako i u Moj Evolako.",
    signInText: "Prijavi se kodom na e-poštu naloga, pa potvrdi brisanje.",
    signIn: "Prijavi se da obrišeš nalog",
    deleted: "Šta brišemo",
    deletedFirst: "Nalog i profil: e-poštu za prijavu, ime, telefon, podešavanja i saglasnosti.",
    photos: "Fotografije koje si poslao — uz prijavu kvara i očitavanje brojila.",
    kept: "Šta ostaje",
    statements: "Obračuni i podaci o plaćanjima — samo sa imenom platioca. Čuvamo ih onoliko dugo koliko to propisuje Zakon o računovodstvu.",
    point: "Podaci o samoj tački punjenja — adresa ugradnje, sesije punjenja, stanja brojila i istorija servisa — ostaju uz tačku, bez veze sa tvojim nalogom.",
    before: "Pre nego što obrišeš",
    permanent: "Brisanje je trajno — ne može da se poništi.",
    subscription: "Ako tačku punjenja koristiš samo ti, pretplata za nju prestaje poslednjeg dana tekućeg meseca.",
    how: "Kako da obrišeš nalog",
    here: "Ovde: prijavi se, pritisni „Obriši nalog“ i potvrdi.",
    inApp: "U aplikaciji Evolako: Podešavanja → Nalog → Obriši nalog.",
    inWeb: "U Moj Evolako: Profil → Nalog i podešavanja → Obriši nalog.",
    write: "Ne možeš da se prijaviš? Piši nam sa e-pošte naloga na hello@evolako.com.",
    policy: "Politika privatnosti",
    which: "Nalog koji brišeš:",
    button: "Obriši nalog",
    open: "Otvori Moj Evolako",
    confirmTitle: "Obrisati nalog?",
    confirmText: "Brišemo ime, kontakt, zahteve i fotografije. Obračuni ostaju samo sa imenom platioca — čuvamo ih po zakonu. Ovo ne može da se poništi.",
    cancel: "Otkaži",
    done: "Nalog je obrisan.",
    doneText: "Ime, kontakt, zahtevi i fotografije su obrisani. Obračuni ostaju samo sa imenom platioca — čuvamo ih po zakonu.",
    doneMail: "Potvrdu šaljemo na e-poštu naloga.",
  },
  "sr-Cyrl": {
    app: "Мој Evolako",
    title: "Брисање налога",
    lead: "Evolako налог можеш да обришеш сам — овде, без апликације, или у апликацији. Исти је у апликацији Evolako и у Мој Evolako.",
    signInText: "Пријави се кодом на е-пошту налога, па потврди брисање.",
    signIn: "Пријави се да обришеш налог",
    deleted: "Шта бришемо",
    deletedFirst: "Налог и профил: е-пошту за пријаву, име, телефон, подешавања и сагласности.",
    photos: "Фотографије које си послао — уз пријаву квара и очитавање бројила.",
    kept: "Шта остаје",
    statements: "Обрачуни и подаци о плаћањима — само са именом платиоца. Чувамо их онолико дуго колико то прописује Закон о рачуноводству.",
    point: "Подаци о самој тачки пуњења — адреса уградње, сесије пуњења, стања бројила и историја сервиса — остају уз тачку, без везе са твојим налогом.",
    before: "Пре него што обришеш",
    permanent: "Брисање је трајно — не може да се поништи.",
    subscription: "Ако тачку пуњења користиш само ти, претплата за њу престаје последњег дана текућег месеца.",
    how: "Како да обришеш налог",
    here: "Овде: пријави се, притисни „Обриши налог“ и потврди.",
    inApp: "У апликацији Evolako: Подешавања → Налог → Обриши налог.",
    inWeb: "У Мој Evolako: Профил → Налог и подешавања → Обриши налог.",
    write: "Не можеш да се пријавиш? Пиши нам са е-поште налога на hello@evolako.com.",
    policy: "Политика приватности",
    which: "Налог који бришеш:",
    button: "Обриши налог",
    open: "Отвори Мој Evolako",
    confirmTitle: "Обрисати налог?",
    confirmText: "Бришемо име, контакт, захтеве и фотографије. Обрачуни остају само са именом платиоца — чувамо их по закону. Ово не може да се поништи.",
    cancel: "Откажи",
    done: "Налог је обрисан.",
    doneText: "Име, контакт, захтеви и фотографије су обрисани. Обрачуни остају само са именом платиоца — чувамо их по закону.",
    doneMail: "Потврду шаљемо на е-пошту налога.",
  },
  en: {
    app: "My Evolako",
    title: "Delete your account",
    lead: "You can delete your Evolako account yourself — here, without the app, or in the app. It's the same account in the Evolako app and in My Evolako.",
    signInText: "Sign in with a code sent to the account's email, then confirm the deletion.",
    signIn: "Sign in to delete your account",
    deleted: "What we delete",
    deletedFirst: "Your account and profile: sign-in email, name, phone number, settings and consents.",
    photos: "Photos you sent — with a problem report or a meter reading.",
    kept: "What stays",
    statements: "Statements and payment records — with the payer's name only. We keep them for as long as Serbia's Law on Accounting requires.",
    point: "Data about the charging point itself — installation address, charging sessions, meter readings and service history — stays with the point, no longer linked to your account.",
    before: "Before you delete",
    permanent: "Deletion is permanent — it can't be undone.",
    subscription: "If you're the only user of your charging point, its subscription ends on the last day of the current month.",
    how: "How to delete your account",
    here: "Here: sign in, tap “Delete account” and confirm.",
    inApp: "In the Evolako app: Settings → Account → Delete account.",
    inWeb: "In My Evolako: Profile → Account and settings → Delete account.",
    write: "Can't sign in? Write to us from the account's email at hello@evolako.com.",
    policy: "Privacy policy",
    which: "The account you're deleting:",
    button: "Delete account",
    open: "Open My Evolako",
    confirmTitle: "Delete your account?",
    confirmText: "We delete your name, contact details, requests and photos. Statements stay with the payer's name only — the law requires us to keep them. This can't be undone.",
    cancel: "Cancel",
    done: "Your account has been deleted.",
    doneText: "Your name, contact details, requests and photos are deleted. Statements stay with the payer's name only — the law requires us to keep them.",
    doneMail: "We're sending a confirmation to the account's email.",
  },
  ru: {
    app: "Мой Evolako",
    title: "Удаление аккаунта",
    lead: "Аккаунт Evolako можно удалить самому — здесь, без приложения, или в приложении. Он один и тот же в приложении Evolako и в Мой Evolako.",
    signInText: "Войди по коду на почту аккаунта и подтверди удаление.",
    signIn: "Войти, чтобы удалить аккаунт",
    deleted: "Что удаляем",
    deletedFirst: "Аккаунт и профиль: почту для входа, имя, телефон, настройки и согласия.",
    photos: "Фотографии, которые ты отправил, — к заявке о проблеме и к показаниям счётчика.",
    kept: "Что остаётся",
    statements: "Отчёты и данные об оплатах — только с именем плательщика. Храним их столько, сколько требует сербский Закон о бухгалтерском учёте.",
    point: "Данные о самой точке — адрес установки, зарядки, показания счётчика и история сервиса — остаются у точки, без связи с твоим аккаунтом.",
    before: "Прежде чем удалить",
    permanent: "Удаление окончательное — отменить его нельзя.",
    subscription: "Если точкой пользуешься только ты, подписка на неё закончится в последний день текущего месяца.",
    how: "Как удалить аккаунт",
    here: "Здесь: войди, нажми «Удалить аккаунт» и подтверди.",
    inApp: "В приложении Evolako: Настройки → Аккаунт → Удалить аккаунт.",
    inWeb: "В Мой Evolako: Профиль → Аккаунт и настройки → Удалить аккаунт.",
    write: "Не получается войти? Напиши нам с почты аккаунта на hello@evolako.com.",
    policy: "Политика конфиденциальности",
    which: "Аккаунт, который удаляешь:",
    button: "Удалить аккаунт",
    open: "Открыть Мой Evolako",
    confirmTitle: "Удалить аккаунт?",
    confirmText: "Удалим имя, контакты, заявки и фотографии. Отчёты останутся только с именем плательщика — их мы обязаны хранить по закону. Отменить это нельзя.",
    cancel: "Отмена",
    done: "Аккаунт удалён.",
    doneText: "Имя, контакты, заявки и фотографии удалены. Отчёты остаются только с именем плательщика — их мы обязаны хранить по закону.",
    doneMail: "Подтверждение отправим на почту аккаунта.",
  },
} satisfies Record<Lang, Record<string, string>>;

const deletes = (log: Recorded[]) => log.filter((r) => r.path === "/functions/v1/account-delete");
/** Console noise of the failures the tests cause on purpose (401, 429, 5xx, a dropped connection). */
const expected = (e: string) => /Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(e);

function card(page: Page) {
  return page.getByTestId("deletion");
}

function heading(page: Page) {
  return page.getByRole("heading", { level: 1 });
}

async function check(page: Page, label: string) {
  await expectNoHorizontalOverflow(page, label);
  await expectAccessible(page, label);
}

/** From the page through the usual sign-in and back to the page. */
async function signInFromPage(page: Page) {
  await page.getByTestId("deletion-sign-in").click();
  await expect(page).toHaveURL(/\/prijava\?next=%2Fobrisi-nalog$/);
  await page.getByTestId("signin-email").fill(EMAIL);
  await page.getByTestId("signin-send").click();
  await page.getByTestId("signin-code").fill(GOOD_CODE);
  await expect(page).toHaveURL(/\/obrisi-nalog$/);
  await expect(card(page)).toHaveAttribute("data-state", "ready");
}

/** The app's own config says demo-only (apiBase ""), whatever mockApi installed before. */
async function demoConfig(page: Page) {
  await page.route("**/config.json", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ apiBase: "", publishableKey: "", demo: true }),
  }));
}

test.describe("/obrisi-nalog — reading without an account", () => {
  for (const lang of LANGS) {
    for (const width of [390, 1280]) {
      test(`opens directly and says what is deleted and what stays — ${lang}, ${width} px`, async ({ page }) => {
        const x = TEXT[lang];
        const errors = watchErrors(page);
        await page.setViewportSize({ width, height: 900 });
        const log = await mockApi(page);
        await page.goto(`/obrisi-nalog?lang=${lang}`);

        // Not sent through sign-in: the address stays, without the account's navigation.
        await expect(card(page)).toHaveAttribute("data-state", "signedOut");
        await expect(page).toHaveURL(/\/obrisi-nalog$/);
        await expect(page.locator(".tabbar, .sidebar")).toHaveCount(0);
        await expect(heading(page)).toHaveText(x.title);
        await expect(page).toHaveTitle(`${x.title} · ${x.app}`);
        await expect(card(page)).toContainText(x.lead);
        await expect(card(page)).toContainText(x.signInText);
        await expect(page.getByTestId("deletion-sign-in")).toHaveText(x.signIn);
        await expect(page.getByTestId("deletion-sign-in")).toHaveAttribute("href", "/prijava?next=%2Fobrisi-nalog");
        await expect(page.getByTestId("delete-account")).toHaveCount(0);

        // What is deleted, what stays (and for how long: as the law says), what else to know, the three ways.
        const details = page.getByTestId("deletion-details");
        await expect(details.getByRole("heading", { level: 2 })).toHaveText([x.deleted, x.kept, x.before, x.how]);
        for (const line of [x.deletedFirst, x.photos, x.statements, x.point, x.permanent, x.subscription, x.here, x.inApp, x.inWeb, x.write]) {
          await expect(details, line).toContainText(line);
        }
        await expect(page.getByTestId("deletion-write").getByRole("link")).toHaveText("hello@evolako.com");
        await expect(page.getByTestId("deletion-write").getByRole("link")).toHaveAttribute("href", /^mailto:hello@evolako\.com\?subject=/);
        await expect(page.getByTestId("deletion-policy")).toHaveText(x.policy);
        await expect(page.getByTestId("deletion-policy")).toHaveAttribute("href", `https://www.evolako.rs/politika-privatnosti?lang=${lang}`);

        // Reading sends nothing to the API.
        expect(log).toEqual([]);
        await check(page, `signed out ${lang} ${width}`);
        expect(errors).toEqual([]);
      });
    }
  }

  test("a direct request answers 200 with the app, never indexed", async ({ page, request }) => {
    const res = await request.get("/obrisi-nalog");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/html");
    expect(res.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    await mockApi(page);
    await page.goto("/obrisi-nalog/");
    await expect(card(page)).toHaveAttribute("data-state", "signedOut");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  });
});

test.describe("/obrisi-nalog — deleting", () => {
  test("sign in and come back; cancel; every problem in words; one request per press; deleted and forgotten", async ({ page }) => {
    const x = TEXT.sr;
    const errors = watchErrors(page);
    const log = await mockApi(page, { accountDelete: ["abort", 503, 429, 200] });
    await page.goto("/obrisi-nalog");
    await signInFromPage(page);

    // Signed in: which account goes, the button, a way back to the account — and still no navigation of the account.
    await expect(heading(page)).toHaveText(x.title);
    await expect(card(page)).toContainText(x.which);
    await expect(page.getByTestId("deletion-email")).toContainText(EMAIL);
    await expect(page.getByTestId("delete-account")).toHaveText(x.button);
    await expect(page.getByTestId("account-link")).toHaveText(x.open);
    await expect(page.getByTestId("deletion-sign-in")).toHaveCount(0);
    await expect(page.getByTestId("deletion-details")).toBeVisible();
    await expect(page.locator(".tabbar, .sidebar")).toHaveCount(0);
    await check(page, "ready");

    // The button only asks; "Otkaži" sends nothing.
    await page.getByTestId("delete-account").click();
    const dialog = page.getByTestId("delete-dialog");
    await expect(dialog).toHaveAttribute("role", "alertdialog");
    await expect(dialog).toContainText(x.confirmTitle);
    await expect(dialog).toContainText(x.confirmText);
    await check(page, "confirmation");
    await page.getByTestId("delete-cancel").click();
    await expect(dialog).toBeHidden();
    expect(deletes(log)).toHaveLength(0);
    await expect(card(page)).toHaveAttribute("data-state", "ready");

    // No connection: said in words, the dialog stays, exactly one request for the press.
    await page.getByTestId("delete-account").click();
    await page.getByTestId("delete-confirm").click();
    await expect(page.getByTestId("delete-error")).toHaveText("Nema veze sa serverom. Proveri internet i pokušaj ponovo.");
    expect(deletes(log)).toHaveLength(1);
    await check(page, "no connection");
    // The server is down.
    await page.getByTestId("delete-confirm").click();
    await expect(page.getByTestId("delete-error")).toHaveText("Nema veze sa serverom. Proveri internet i pokušaj ponovo.");
    expect(deletes(log)).toHaveLength(2);
    // Too many attempts.
    await page.getByTestId("delete-confirm").click();
    await expect(page.getByTestId("delete-error")).toHaveText("Previše pokušaja. Pokušaj ponovo za minut.");
    expect(deletes(log)).toHaveLength(3);
    await expect(card(page)).toHaveAttribute("data-state", "ready");
    expect(await page.evaluate(() => localStorage.getItem("evo.auth.refresh"))).toBe("refresh-token-1");

    // Deleted: the page says so itself and keeps its address; the session is forgotten in this browser.
    await page.getByTestId("delete-confirm").click();
    await expect(card(page)).toHaveAttribute("data-state", "done");
    await expect(dialog).toHaveCount(0);
    await expect(heading(page)).toHaveText(x.done);
    await expect(heading(page)).toBeFocused();
    await expect(card(page)).toContainText(x.doneText);
    await expect(card(page)).toContainText(x.doneMail);
    await expect(page).toHaveURL(/\/obrisi-nalog$/);
    await expect(page.getByTestId("site-link")).toHaveAttribute("href", "https://www.evolako.rs?lang=sr");
    await expect(page.getByTestId("delete-account")).toHaveCount(0);
    await expect(page.getByTestId("deletion-details")).toHaveCount(0);
    await check(page, "done");

    // The same call as in the apps: POST with the user's token and the publishable key, no body, sent once per press.
    const calls = deletes(log);
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.method).toBe("POST");
      expect(call.headers.apikey).toBe(KEY);
      expect(call.headers.authorization).toBe(`Bearer ${ACCESS}`);
      expect(call.body).toBeNull();
    }
    // No logout call (the account and its sessions no longer exist) and nothing of the session left here.
    expect(log.filter((r) => r.path.startsWith("/auth/v1/logout"))).toHaveLength(0);
    const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("evo.auth.") || k.startsWith("evo.pref.") || k === "evo.point"));
    expect(left).toEqual([]);

    // The landing knows too; a new visit of the page starts from the beginning.
    await page.goto("/prijava");
    await expect(page.getByTestId("landing")).toBeVisible();
    await page.goto("/obrisi-nalog");
    await expect(card(page)).toHaveAttribute("data-state", "signedOut");
    expect(errors.filter((e) => !expected(e))).toEqual([]);
  });

  for (const lang of ["sr-Cyrl", "en", "ru"] as const) {
    test(`the confirmation and the outcome in ${lang}`, async ({ page }) => {
      const x = TEXT[lang];
      const log = await mockApi(page);
      await page.goto("/obrisi-nalog");
      await signInFromPage(page);
      await chooseLang(page, lang);
      await expect(heading(page)).toHaveText(x.title);
      await expect(card(page)).toContainText(x.which);
      await expect(page.getByTestId("delete-account")).toHaveText(x.button);
      await page.getByTestId("delete-account").click();
      const dialog = page.getByTestId("delete-dialog");
      await expect(dialog).toContainText(x.confirmTitle);
      await expect(dialog).toContainText(x.confirmText);
      await expect(page.getByTestId("delete-cancel")).toHaveText(x.cancel);
      await check(page, `confirmation ${lang}`);
      await page.getByTestId("delete-confirm").click();
      await expect(card(page)).toHaveAttribute("data-state", "done");
      await expect(heading(page)).toHaveText(x.done);
      await expect(card(page)).toContainText(x.doneText);
      await expect(card(page)).toContainText(x.doneMail);
      await expect(page).toHaveTitle(`${x.title} · ${x.app}`);
      expect(deletes(log)).toHaveLength(1);
      await check(page, `done ${lang}`);
    });
  }

  test("with Google on /prijava: the page says so, Google comes back here, the account shown is the Google one", async ({ page }) => {
    const origin = "http://127.0.0.1:4173";
    const errors = watchErrors(page);
    const log = await mockApi(page, { google: { origins: [origin] }, googleToken: "existing" });
    await page.goto("/obrisi-nalog?lang=en");
    await expect(page.getByTestId("deletion-sign-in-text"))
      .toHaveText("Sign in with a code sent to the account's email, or with Google using that email, then confirm the deletion.");
    await page.goto("/obrisi-nalog?lang=sr");
    await expect(page.getByTestId("deletion-sign-in-text"))
      .toHaveText("Prijavi se kodom na e-poštu naloga ili preko Google naloga sa tom e-poštom, pa potvrdi brisanje.");
    await check(page, "signed out, Google offered");

    // Google, mocked as in google.spec.ts: back to /auth/google with the state echoed and an ID token.
    await page.route("https://accounts.google.com/**", (route) => {
      const state = new URL(route.request().url()).searchParams.get("state") ?? "";
      return route.fulfill({ status: 302, headers: { location: `${origin}/auth/google#state=${state}&id_token=eyJhbGciOiJSUzI1NiJ9.e30.c2ln` } });
    });
    await page.getByTestId("deletion-sign-in").click();
    await expect(page).toHaveURL(/\/prijava\?next=%2Fobrisi-nalog$/);
    await page.getByTestId("signin-google").click();
    await expect(page).toHaveURL(/\/obrisi-nalog$/);
    await expect(card(page)).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("deletion-email")).toContainText("mila@gmail.com");
    expect(log.filter((r) => r.path === "/auth/v1/token?grant_type=id_token")).toHaveLength(1);

    await page.getByTestId("delete-account").click();
    await page.getByTestId("delete-confirm").click();
    await expect(card(page)).toHaveAttribute("data-state", "done");
    const calls = deletes(log);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${ACCESS}`);
    expect(errors).toEqual([]);
  });

  test("a session that ended is said in words; sign in again", async ({ page }) => {
    // The server no longer knows the token (signed out elsewhere, or the account is already gone): 401 twice.
    const log = await mockApi(page, { accountDelete: [401] });
    await page.goto("/obrisi-nalog");
    await signInFromPage(page);
    await page.getByTestId("delete-account").click();
    await page.getByTestId("delete-confirm").click();
    await expect(card(page)).toHaveAttribute("data-state", "signedOut");
    await expect(page.getByTestId("session-expired")).toContainText("Sesija je istekla. Prijavi se ponovo.");
    await expect(page.getByTestId("delete-dialog")).toHaveCount(0);
    await expect(page.getByTestId("deletion-sign-in")).toBeVisible();
    // One refresh between the two attempts, as for every call of the account.
    expect(deletes(log)).toHaveLength(2);
    expect(await page.evaluate(() => localStorage.getItem("evo.auth.refresh"))).toBeNull();
    await check(page, "session ended");
  });

  test("deleting on /profil/nalog still ends on the landing", async ({ page }) => {
    const log = await mockApi(page);
    await page.goto("/prijava");
    await page.getByTestId("signin-email").fill(EMAIL);
    await page.getByTestId("signin-send").click();
    await page.getByTestId("signin-code").fill(GOOD_CODE);
    await expect(page).toHaveURL(/\/danas$/);
    await page.goto("/profil/nalog");
    await page.getByTestId("delete-account").click();
    await page.getByTestId("delete-confirm").click();
    await expect(page).toHaveURL(/\/prijava$/);
    await expect(page.getByTestId("account-deleted")).toContainText("Nalog je obrisan.");
    expect(deletes(log)).toHaveLength(1);
    // The page agrees while the tab remembers it.
    await page.getByTestId("landing").waitFor();
    await page.evaluate(() => history.pushState({ key: "t" }, "", "/obrisi-nalog"));
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
    await expect(card(page)).toHaveAttribute("data-state", "done");
  });
});

test.describe("/obrisi-nalog — where there is nothing to delete", () => {
  test("a demo session: leave the demo first, then the page asks to sign in", async ({ page }) => {
    const log = await mockApi(page);
    await openDemo(page, "wallbox", "/obrisi-nalog");
    await expect(card(page)).toHaveAttribute("data-state", "demo");
    await expect(page.locator(".tabbar, .sidebar")).toHaveCount(0);
    await expect(heading(page)).toHaveText(TEXT.sr.title);
    await expect(card(page)).toContainText("Sada gledaš demo — u njemu nema pravog naloga. Izađi iz demoa i prijavi se svojom e-poštom.");
    await expect(page.getByTestId("delete-account")).toHaveCount(0);
    await expect(page.getByTestId("deletion-details")).toBeVisible();
    await check(page, "demo session");
    await page.getByTestId("deletion-exit-demo").click();
    await expect(card(page)).toHaveAttribute("data-state", "signedOut");
    await expect(page).toHaveURL(/\/obrisi-nalog$/);
    expect(await page.evaluate(() => localStorage.getItem("evo.demo"))).toBeNull();
    expect(log).toEqual([]);
  });

  test("a build without the API: no accounts here, nothing is sent; write to us", async ({ page }) => {
    await demoConfig(page);
    const sent: string[] = [];
    page.on("request", (r) => {
      if (/\/(functions|auth|rest)\//.test(new URL(r.url()).pathname)) sent.push(r.url());
    });
    for (const lang of ["sr", "en", "ru"] as const) {
      await page.goto(`/obrisi-nalog?lang=${lang}`);
      await expect(card(page)).toHaveAttribute("data-state", "unavailable");
      await expect(heading(page)).toHaveText(TEXT[lang].title);
      await expect(page.getByTestId("delete-account")).toHaveCount(0);
      await expect(page.getByTestId("deletion-sign-in")).toHaveCount(0);
      await expect(page.getByTestId("write-link")).toHaveAttribute("href", /^mailto:hello@evolako\.com\?subject=/);
      await expect(page.getByTestId("deletion-details")).toContainText(TEXT[lang].statements);
      await check(page, `unavailable ${lang}`);
    }
    await expect(card(page)).toContainText("В демо это недоступно: здесь Мой Evolako работает без сервера и ничего не отправляет.");
    expect(sent).toEqual([]);
  });
});

test.describe("/obrisi-nalog — dark theme and layout", () => {
  test("reads well in the dark too (axe): signed out, the confirmation, deleted", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("evo.theme", "dark"));
    await mockApi(page, { accountDelete: [503, 200] });
    await page.goto("/obrisi-nalog");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await check(page, "signed out dark");
    await signInFromPage(page);
    await check(page, "ready dark");
    await page.getByTestId("delete-account").click();
    await page.getByTestId("delete-confirm").click();
    await expect(page.getByTestId("delete-error")).toBeVisible();
    await check(page, "problem dark");
    await page.getByTestId("delete-confirm").click();
    await expect(card(page)).toHaveAttribute("data-state", "done");
    await check(page, "done dark");
  });

  test("no horizontal scroll from 360 to 1440 px; 44 px touch targets", async ({ page }) => {
    await mockApi(page);
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/obrisi-nalog?lang=ru");
      await expect(card(page)).toHaveAttribute("data-state", "signedOut");
      await expectNoHorizontalOverflow(page, `signed out ${width}`);
      if (width === 390) await expectTouchTargets(page, "signed out");
    }
    // Signed in with a long address, in the language with the longest words.
    await page.route("https://api.evolako.rs/auth/v1/verify", (route) => route.fulfill({
      status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ access_token: ACCESS, refresh_token: "refresh-token-1", expires_in: 3600, token_type: "bearer",
        user: { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "aleksandra.dimitrijevic-petrovic+evolako.nalog@primer-kompanije.co.rs" } }),
    }));
    await page.goto("/obrisi-nalog");
    await signInFromPage(page);
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page, `ready ${width}`);
      if (width === 390) await expectTouchTargets(page, "ready");
    }
    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByTestId("delete-account").click();
    await expect(page.getByTestId("delete-dialog")).toBeVisible();
    await expectNoHorizontalOverflow(page, "confirmation 360");
    await expectTouchTargets(page, "confirmation");
  });
});
