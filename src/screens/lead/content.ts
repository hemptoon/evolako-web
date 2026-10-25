// The site snapshot of kits and prices (paketi.json) and the FAQ, typed for the lead screens.
import faq from "../../content/faq.json";
import paketi from "../../content/paketi.json";
import type { City, PackageId, Parking } from "../../api/types";
import type { RenderName } from "../../ui/Render";

export type SiteText = { sr: string; en: string; ru: string };

export interface Package {
  id: PackageId;
  name: SiteText;
  priceRSD: number;
  priceText: SiteText;
  priceFrom: boolean;
  priceUnit: SiteText;
  tagline: SiteText;
  forWhom: SiteText;
  note: SiteText | null;
  features: SiteText[];
  /** Price variants exactly as the site writes them: "94.000 — punjač i osnovna ugradnja…" (07.10.2026). */
  variantLines: SiteText[];
  variants: PriceVariant[];
  /** "MID brojilo — +10.000": the only add-on the site prices. */
  midOptionRSD: number | null;
  badge: SiteText | null;
  photos: RenderName[];
  faq: string[];
}

export interface PriceVariant { id: string; priceRSD: number; includesMID: boolean }

/** "Još opcija — Kad ti treba nešto drugo": Wallbox Plus, Wallbox Premium, Samo ugradnja (07.10.2026). */
export interface ExtraOption {
  id: PackageId;
  name: SiteText;
  priceRSD: number;
  priceText: SiteText;
  priceFrom: boolean;
  priceUnit: SiteText;
  tagline: SiteText;
  text: SiteText | null;
  variantLines: SiteText[];
  variants: PriceVariant[];
  midOptionRSD: number | null;
  note: SiteText | null;
}

interface Option<T extends string> { id: T; title: SiteText }
interface Question { id: string; title: SiteText; options: Array<Option<string>> }

interface Catalog {
  retrieved: string;
  intro: { title: SiteText; text: SiteText; photo: RenderName };
  packages: Package[];
  options: { kicker: SiteText; title: SiteText; items: ExtraOption[] };
  assessment: { kicker: SiteText; title: SiteText; text: SiteText; note: SiteText };
  subscription: { kicker: SiteText; title: SiteText; text: SiteText; items: Array<{ title: SiteText; text: SiteText }> };
  steps: { kicker: SiteText; title: SiteText; items: Array<{ title: SiteText; text: SiteText }> };
  quiz: { questions: Question[] };
  standardInstallation: SiteText;
}

export const CATALOG = paketi as unknown as Catalog;

export function findPackage(id: string | null | undefined): Package | undefined {
  return CATALOG.packages.find((p) => p.id === id);
}

/** Any kit of the site — a main one or one from "Još opcija". */
export function findAnyPackage(id: string | null | undefined): Package | ExtraOption | undefined {
  return findPackage(id) ?? CATALOG.options.items.find((o) => o.id === id);
}

/** All kits in the site's order: the three main ones, then "Još opcija". */
export const ALL_PACKAGES: Array<Package | ExtraOption> = [...CATALOG.packages, ...CATALOG.options.items];

function question(id: string): Question | undefined {
  return CATALOG.quiz.questions.find((q) => q.id === id);
}

export const CITY_OPTIONS = (question("grad")?.options ?? []) as Array<Option<City>>;
export const PARKING_OPTIONS = (question("tip")?.options ?? []) as Array<Option<Parking>>;

export function cityTitle(id: City | null): SiteText | null {
  return CITY_OPTIONS.find((o) => o.id === id)?.title ?? null;
}

export function parkingTitle(id: Parking | null): SiteText | null {
  return PARKING_OPTIONS.find((o) => o.id === id)?.title ?? null;
}

interface FaqItem { question: SiteText; answer: SiteText }
const FAQ_ITEMS: FaqItem[] = (faq as unknown as { categories: Array<{ items: FaqItem[] }> }).categories.flatMap((c) => c.items);

/** The FAQ entries a package links to (by their Serbian question). */
export function packageFaq(pkg: Package): FaqItem[] {
  return pkg.faq.map((q) => FAQ_ITEMS.find((i) => i.question.sr === q)).filter((i): i is FaqItem => Boolean(i));
}
