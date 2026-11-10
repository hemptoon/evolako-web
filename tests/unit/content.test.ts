import { describe, expect, it } from "vitest";
import paketi from "../../src/content/paketi.json";
import faq from "../../src/content/faq.json";
import config from "../../src/content/config.json";
import { PRICING } from "../../src/app/contacts";

// A package links its FAQ by the Serbian question; a renamed question must not silently drop out of the package page.
describe("synced content", () => {
  const questions = new Set(
    (faq as unknown as { categories: Array<{ items: Array<{ question: { sr: string } }> }> }).categories
      .flatMap((c) => c.items.map((i) => i.question.sr)),
  );
  const packages = (paketi as unknown as { packages: Array<{ id: string; faq: string[] }> }).packages;

  it("every FAQ link of a package exists in faq.json", () => {
    const missing = packages.flatMap((p) => p.faq.filter((q) => !questions.has(q)).map((q) => `${p.id}: ${q}`));
    expect(missing).toEqual([]);
  });

  it("the assessment fee is the same in config.json and the app (2.990 RSD since 14.10.2026)", () => {
    expect((config as unknown as { values: { pricing: { assessmentFee: number } } }).values.pricing.assessmentFee).toBe(PRICING.assessmentFee);
    expect(PRICING.assessmentFee).toBe(2990);
  });
});
