// Domain values → words (Localization.swift of the app). Keys are the app's Serbian strings.
import { AccountError, BackendError } from "../api/errors";
import { InvalidResponseError } from "../api/parse";
import type {
  AlertKind,
  ChargePoint,
  InstallationStatus,
  NotEligibleReason,
  PointStatus,
  ReadingStatus,
  ReferralState,
  RelocationStatus,
  ServiceCategory,
  ServiceStatus,
  SessionTag,
  Sku,
  Subscription,
} from "../api/types";
import { lang, t, tp } from "../i18n";
import { decimal, monthAndYear } from "../lib/format";
import { lastFreeDay } from "../lib/readings";
import type { BadgeTone } from "../ui/display";
import type { IconName } from "../ui/Icon";

export function pointName(point: Pick<ChargePoint, "customName">): string {
  return point.customName ?? t("Moja tačka");
}

export function statusTitle(status: PointStatus): string {
  switch (status) {
    case "online": return t("Na mreži");
    case "offline": return t("Van mreže");
    case "charging": return t("Punjenje u toku");
    case "fault": return t("Kvar");
  }
}

export function statusTone(status: PointStatus): BadgeTone {
  return status;
}

export function statusIcon(status: PointStatus): IconName {
  switch (status) {
    case "online": return "checkCircle";
    case "offline": return "wifiOff";
    case "charging": return "bolt";
    case "fault": return "alert";
  }
}

export function skuTitle(sku: Sku): string {
  return sku === "wallboxB" ? t("Wallbox 11 kW") : t("Utičnica + merenje");
}

/** "12,4 kWh" / "12,4 кВт·ч" — Serbian number, translated unit. */
export function energy(kWh: number, digits = 1): string {
  return `${decimal(kWh, digits)} ${t("kWh")}`;
}

export function power(kW: number): string {
  return `${decimal(kW, 1)} ${t("kW")}`;
}

export function tagTitle(tag: SessionTag): string {
  return tag === "personal" ? t("Lično") : t("Službeno");
}

export function triggerTitle(trigger: "auto" | "manual"): string {
  return trigger === "auto" ? t("Autostart") : t("Ručno");
}

export function alertTitle(kind: AlertKind): string {
  switch (kind.type) {
    case "chargeStarted": return t("Punjenje je počelo");
    case "chargeFinished": return t("Punjenje je završeno — %@", energy(kind.kWh));
    case "fault": return t("Kvar na tački");
    case "wentOffline": return t("Tačka je van mreže");
    case "autostartExecuted": return t("Autostart je pokrenuo punjenje");
    case "statementReady": return t("Obračun za %@ je spreman", monthAndYear(kind.month.year, kind.month.month, lang.value));
    case "trialEnding": return tp("Probni period ističe za %lld dana", kind.daysLeft);
  }
}

export function alertIcon(kind: AlertKind): IconName {
  switch (kind.type) {
    case "chargeStarted":
    case "autostartExecuted":
      return "bolt";
    case "chargeFinished": return "checkCircle";
    case "fault": return "alert";
    case "wentOffline": return "wifiOff";
    case "statementReady": return "statement";
    case "trialEnding": return "hourglass";
  }
}

export function categoryTitle(c: ServiceCategory): string {
  switch (c) {
    case "notCharging": return t("Ne puni");
    case "notVisible": return t("Ne vidi se");
    case "damaged": return t("Oštećeno");
    case "other": return t("Drugo");
  }
}

export function categorySubtitle(c: ServiceCategory): string {
  switch (c) {
    case "notCharging": return t("Auto je priključen, a punjenje ne počinje.");
    case "notVisible": return t("Tačka se u aplikaciji ne vidi ili je van mreže.");
    case "damaged": return t("Kabl, utičnica ili kućište su oštećeni.");
    case "other": return t("Nešto treće — opiši u komentaru.");
  }
}

export function categoryIcon(c: ServiceCategory): IconName {
  switch (c) {
    case "notCharging": return "plug";
    case "notVisible": return "wifiOff";
    case "damaged": return "alert";
    case "other": return "more";
  }
}

export function serviceStatusTitle(s: ServiceStatus): string {
  switch (s) {
    case "received": return t("Primljeno");
    case "scheduled": return t("Zakazano");
    case "resolved": return t("Rešeno");
  }
}

export function relocationStatusTitle(s: RelocationStatus): string {
  switch (s) {
    case "received": return t("Primljeno");
    case "scheduled": return t("Zakazano");
    case "completed": return t("Preseljeno");
  }
}

export function installationStatusTitle(s: InstallationStatus): string {
  switch (s) {
    case "received": return t("Primljeno");
    case "assessmentScheduled": return t("Procena zakazana");
    case "installationScheduled": return t("Ugradnja zakazana");
    case "installed": return t("Ugrađeno");
  }
}

export function referralStatusTitle(s: ReferralState): string {
  switch (s) {
    case "sent": return t("Poslato");
    case "installed": return t("Instalirano");
    case "notEligible": return t("Ne računa se");
  }
}

export function notEligibleTitle(r: NotEligibleReason): string {
  switch (r) {
    case "ownCode": return t("Sopstveni kod");
    case "sameAddress": return t("Ista adresa ili tačka");
    case "existingCustomer": return t("Već je klijent");
    case "codeAfterInstallation": return t("Kod upisan posle ugradnje");
  }
}

export function readingStatusTitle(s: ReadingStatus): string {
  switch (s) {
    case "submitted": return t("Poslato");
    case "accepted": return t("Prihvaćeno");
    case "rejected": return t("Treba ponoviti");
  }
}

export function readingStatusTone(s: ReadingStatus): BadgeTone {
  return s === "accepted" ? "paid" : s === "rejected" ? "fault" : "neutral";
}

type SubscriptionLike = Pick<Subscription, "state"> & Partial<Pick<Subscription, "trialStartsBy" | "suspendedSince">>;

export function subscriptionTitle(subscription: SubscriptionLike): { title: string; active: boolean } {
  const s = subscription.state;
  // On hold for an unpaid subscription (1.14): not the customer's own pause, and said calmly.
  if (subscription.suspendedSince) return { title: t("Na čekanju"), active: false };
  switch (s.type) {
    case "trial": return { title: t("Probni period"), active: true };
    case "active": return { title: t("Aktivna"), active: true };
    case "paused": return { title: t("Pauzirana"), active: false };
    case "none": return { title: t("Neaktivna"), active: false };
  }
}

export function subscriptionSummary(subscription: SubscriptionLike, priceRSD: string): string {
  const s = subscription.state;
  switch (s.type) {
    // Not started yet (it starts with the first action with the charger): no date to promise. Started: the last
    // free day — `until` is the first paid one.
    case "trial": return subscription.trialStartsBy ? t("Probni period") : t("Probni period: do %@.", lastFreeDay(s.until));
    case "active": return t("Aktivna — %@ mesečno", priceRSD);
    case "paused": return t("Pauzirana — %lld od %lld meseca godišnje", s.monthsUsed, 3);
    case "none": return t("Nema pretplate");
  }
}

/** A message that is fine to show to a customer: words, never codes. */
export function errorMessage(error: unknown): string {
  if (error instanceof BackendError) {
    switch (error.code) {
      case "chargePointNotFound": return t("Ne možemo da nađemo tvoju tačku.");
      case "capabilityUnavailable": return t("Ova tačka ne podržava tu radnju.");
      case "offline": return t("Nema veze sa serverom. Proveri internet i pokušaj ponovo.");
      case "alreadyCharging": return t("Punjenje je već u toku.");
      case "notCharging": return t("Punjenje trenutno ne radi.");
      case "pauseNotAvailable": return t("Pauza trenutno nije dostupna.");
      case "tariffReadOnly": return t("Cene unosimo po računu zgrade koji nam pošalješ");
      case "sessionNotFound": return t("Ne možemo da nađemo tu sesiju.");
      case "serviceRequestIncomplete": return t("Za „Drugo“ napiši ukratko šta se dešava.");
      case "relocationRequestIncomplete": return t("Upiši novu adresu i izaberi datum.");
      case "relocationAlreadyRequested": return t("Prijava selidbe je već poslata.");
      case "chargePointNameTooLong": return tp("Ime može da ima najviše %lld znakova.", 24);
      case "guestMode": return t("Ovo je dostupno kad imaš Evolako tačku.");
      case "installationRequestIncomplete": return t("Popuni ime, kontakt, grad i mesto, i prihvati politiku privatnosti.");
      case "installationAlreadyRequested": return t("Zahtev za procenu je već poslat.");
      case "rateLimited": return t("Previše pokušaja. Pokušaj ponovo za minut.");
      case "meterReadingIncomplete": return t("Dodaj fotografiju brojila.");
      case "meterReadingTooLow": return t("Upiši stanje na brojilu.");
    }
  }
  if (error instanceof AccountError) {
    switch (error.code) {
      case "invalidEmail": return t("Proveri adresu e-pošte.");
      case "invalidCode": return t("Kod nije tačan ili je istekao. Proveri pismo ili zatraži novi.");
      case "sessionExpired": return t("Sesija je istekla. Prijavi se ponovo.");
      case "notConfigured": return t("Prijava na webu stiže uskoro. Do tada pogledaj demo.");
    }
  }
  if (error instanceof InvalidResponseError) return t("Podaci trenutno nisu dostupni.");
  return t("Podaci trenutno nisu dostupni.");
}

export function isOfflineError(error: unknown): boolean {
  return error instanceof BackendError && error.code === "offline";
}
