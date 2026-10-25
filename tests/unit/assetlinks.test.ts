// Android App Links: public/.well-known/assetlinks.json is what lets the Android app (com.evolako.app) open this
// site's links. Google reads it as it is, so its shape is checked here; that it is served as a file (200, JSON, no
// redirect, before the SPA fallback) is checked in tests/e2e/pwa.spec.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(new URL(`../../public/${path}`, import.meta.url), "utf8");

describe("assetlinks.json", () => {
  const statements = JSON.parse(read(".well-known/assetlinks.json")) as Array<{
    relation: string[];
    target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
  }>;

  it("delegates all URLs of the site to the Android app, and to nothing else", () => {
    expect(statements).toHaveLength(1);
    const [statement] = statements;
    expect(statement!.relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(statement!.target.namespace).toBe("android_app");
    expect(statement!.target.package_name).toBe("com.evolako.app");
  });

  it("lists SHA-256 certificate fingerprints the way Android compares them: upper-case hex pairs", () => {
    const prints = statements[0]!.target.sha256_cert_fingerprints;
    expect(prints.length).toBeGreaterThanOrEqual(1);
    expect(new Set(prints).size).toBe(prints.length);
    for (const print of prints) expect(print).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
  });

  it("is the one thing robots.txt lets crawlers read; the headers keep it fresh", () => {
    expect(read("robots.txt")).toBe("User-agent: *\nAllow: /.well-known/assetlinks.json\nDisallow: /\n");
    expect(read("_headers")).toMatch(/^\/\.well-known\/assetlinks\.json\n {2}Cache-Control: no-cache$/m);
    // The SPA fallback is a rewrite of what is NOT a file; nothing redirects the file itself.
    expect(read("_redirects").trim()).toBe("/* /index.html 200");
  });
});
