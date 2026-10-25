// How to reach Evolako: e-mail, and messages only (no calls) on WhatsApp, Viber and Telegram.
// Links to evolako.rs carry the interface language (?lang=sr|sr-Cyrl|en|ru — the site reads all four).
import type { Lang } from "../i18n";

export const SUPPORT_EMAIL = "hello@evolako.com";
export const MESSENGER_NUMBER = "+381 65 381 6083";
export const MESSENGER_NUMBER_RAW = "+381653816083";

export const LINKS = {
  whatsapp: "https://wa.me/381653816083",
  viber: "viber://chat?number=%2B381653816083",
  telegram: "https://t.me/evolako_rs",
  site: "https://www.evolako.rs",
  kviz: "https://www.evolako.rs/proveri-svoju-garazu",
  faq: "https://www.evolako.rs/cesta-pitanja",
  privacy: "https://www.evolako.rs/politika-privatnosti",
  paketi: "https://www.evolako.rs/paketi-i-cene",
} as const;

export function siteUrl(url: string, lang: Lang): string {
  return `${url}${url.includes("?") ? "&" : "?"}lang=${lang}`;
}

export function mailto(subject: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

/** Subscription terms of the service (app_config.pricing). */
export const PRICING = {
  subscriptionMonthly: 990,
  trialMonths: 2,
  pauseMonthsPerYear: 3,
  assessmentFee: 3500,
} as const;

export const REFERRAL = {
  friendBonusMonths: 2,
  referrerMonthsPerFriend: 2,
  baseURL: "https://www.evolako.rs/preporuka",
} as const;
