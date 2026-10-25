// PWA: the manifest, the service worker caching only our shell and static files, and an offline reload.
import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "allow" });

test("manifest and icons", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.name).toBe("Evolako");
  expect(manifest.display).toBe("standalone");
  expect(manifest.theme_color).toBe("#F1F4F9");
  const purposes = manifest.icons.map((i: { purpose: string }) => i.purpose);
  expect(purposes).toContain("maskable");
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
});

test("never indexed: robots.txt, X-Robots-Tag and the robots meta; a proper title and description", async ({ page, request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBe(true);
  expect(robots.headers()["content-type"]).toContain("text/plain");
  // Everything is closed to crawlers except the one file Google has to read to verify the Android app's links.
  expect(await robots.text()).toBe("User-agent: *\nAllow: /.well-known/assetlinks.json\nDisallow: /\n");
  for (const path of ["/", "/prijava", "/obracuni/2026-09", "/config.json"]) {
    expect((await request.get(path)).headers()["x-robots-tag"], path).toBe("noindex, nofollow");
  }
  await page.goto("/prijava");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Moj Evolako: tvoja tačka punjenja/);
  await expect(page).toHaveTitle("Prijava · Moj Evolako");
});

test("Android App Links: assetlinks.json is a real file — 200, JSON, no redirect, never the SPA fallback", async ({ request }) => {
  const res = await request.get("/.well-known/assetlinks.json", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  expect(res.headers()["cache-control"]).toBe("no-cache");
  const statements = await res.json();
  expect(statements).toHaveLength(1);
  expect(statements[0].relation).toEqual(["delegate_permission/common.handle_all_urls"]);
  expect(statements[0].target.package_name).toBe("com.evolako.app");
  // The neighbours of the file are not files: the SPA fallback answers them with the shell, never with JSON.
  for (const path of ["/.well-known/", "/.well-known/apple-app-site-association", "/.well-known/assetlinks"]) {
    expect((await request.get(path)).headers()["content-type"], path).toContain("text/html");
  }
});

test("the shell works offline; the API is never cached", async ({ page, context }) => {
  await page.goto("/prijava");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The first load was not controlled yet; reload so the worker serves the page.
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const cached = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) out.push(new URL(request.url).pathname + new URL(request.url).host);
    }
    return out;
  });
  expect(cached.some((p) => p.startsWith("/assets/") && p.includes(".js"))).toBe(true);
  expect(cached.some((p) => p.startsWith("/config.json"))).toBe(true);
  expect(cached.every((p) => p.endsWith("127.0.0.1:4173"))).toBe(true);
  expect(cached.some((p) => p.includes("/rest/v1/") || p.includes("/auth/v1/"))).toBe(false);

  await context.setOffline(true);
  await page.goto("/demo");
  await expect(page.getByTestId("demo-chooser")).toBeVisible();
  await context.setOffline(false);
});
