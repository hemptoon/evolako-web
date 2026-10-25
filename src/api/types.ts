// Models of Docs/API_CONTRACT.md. Dates are Date objects, money and energy are numbers
// (amounts come from the backend already rounded; the web app never rebuilds a payment document).
import type { Month } from "../lib/belgrade";
import type { PozivNaBroj } from "../lib/payments";
import type { Currency } from "../lib/format";
import type { EnergySplit, Window } from "../lib/tariff";

export type { EnergySplit, Month, PozivNaBroj, Window };

// 1.13 (paketi v2, 07.10.2026): + connectivity (Wi-Fi/Ethernet), cellular (4G), rfid, loadManagement — the iOS
// contract (Docs/API_CONTRACT.md → ChargePoint). Unknown values are skipped by parse.ts, never fatal.
// metering only with a MID meter in the kit; anything about load balancing only with loadManagement.
export type Capability = "metering" | "remoteControl" | "scheduling" | "livePower"
  | "connectivity" | "cellular" | "rfid" | "loadManagement";
export const CAPABILITIES: Capability[] = ["metering", "remoteControl", "scheduling", "livePower",
  "connectivity", "cellular", "rfid", "loadManagement"];

export type Sku = "socketA" | "wallboxB";
export type PointStatus = "online" | "offline" | "charging" | "fault";

export interface Payee {
  name: string;
  accountNumber: string;
  referenceModel: string;
}

export type ConnectionScheme = { type: "ownMeter" } | { type: "thirdPartyMeter"; payee: Payee };

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface ChargePoint {
  id: string;
  /** The customer's own name, ≤ 24 characters; null → "Moja tačka" in the interface language. */
  customName: string | null;
  address: string;
  sku: Sku;
  capabilities: Capability[];
  status: PointStatus;
  serialNumber: string;
  installedAt: Date;
  connectionScheme: ConnectionScheme;
  nominalPowerKW: number;
  phases: number;
  location: GeoPoint | null;
}

export interface User {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  lang: string | null;
  /** Display currency chosen on any device (1.11.3); RSD when the server does not send it. */
  displayCurrency: Currency;
  chargePoints: ChargePoint[];
}

export type SessionTrigger = "auto" | "manual";
export type SessionTag = "personal" | "business";

export interface ChargingSession {
  id: string;
  chargePointID: string;
  startedAt: Date;
  endedAt: Date;
  energy: EnergySplit;
  trigger: SessionTrigger;
  tag: SessionTag | null;
}

export interface LiveSession {
  chargePointID: string;
  startedAt: Date;
  /** null for points without livePower. */
  powerKW: number | null;
  energy: EnergySplit;
  costRSD: number;
  trigger: SessionTrigger;
}

export type TariffSource = "estimate" | "customerBill" | "meterOwnerBill";

export interface TariffConfig {
  highRateRSDPerKWh: number;
  lowRateRSDPerKWh: number;
  nightWindow: Window;
  source: TariffSource;
}

export interface ChargingSchedule {
  isEnabled: boolean;
  window: Window;
}

export type SubscriptionState =
  | { type: "trial"; until: Date }
  | { type: "active" }
  | { type: "paused"; monthsUsed: number }
  | { type: "none" };

export interface SubscriptionEntry {
  month: Month;
  state: SubscriptionState;
  amountRSD: number;
}

export interface Subscription {
  state: SubscriptionState;
  startedAt: Date;
  /** Last day of a cancelled subscription ("yyyy-MM-dd", v1.8 extension); null — not cancelled. */
  endsOn: string | null;
  history: SubscriptionEntry[];
  // 1.14 (11.10.2026) — all optional in the contract; a backend before the change simply sends none of them.
  /** When the free period started (the owner's first action with the charger); null — not yet, or not told. */
  activatedAt: Date | null;
  /** The free period has not started: it starts with the first action, at this moment at the latest. */
  trialStartsBy: Date | null;
  /** On hold: the subscription part is unpaid 30 days after its due date. No fees; a payment releases it. */
  suspendedSince: Date | null;
  /** The oldest unpaid month of a subscription on hold — its statement carries the IPS QR. */
  unpaid: { month: Month; amountRSD: number } | null;
  /** Unused free referral months of a cancelled (or ended) subscription and the day they are kept until. */
  keptFreeMonths: { months: number; until: Date } | null;
}

export interface EnergyPart {
  amountRSD: number;
  payee: Payee;
  pozivNaBroj: PozivNaBroj | null;
  qrPayload: string;
  /** Prices the month was computed with — the document stays verifiable after a tariff change. */
  tariff: TariffConfig;
  /** Svrha plaćanja, when the backend sends it (fixture field); otherwise read from the payload's S tag. */
  purpose: string | null;
}

export interface ServicePart {
  amountRSD: number;
  payee: Payee;
  pozivNaBroj: PozivNaBroj | null;
  qrPayload: string;
  isTrial: boolean;
  purpose: string | null;
  /** The month the free period ended in: charged for the days after it (1.14). */
  proration: { paidDays: number; monthDays: number } | null;
}

export type StatementStatus = "issued" | "paid";

export interface Statement {
  month: Month;
  chargePointID: string;
  sessions: ChargingSession[];
  energy: EnergySplit;
  /** null for ownMeter: the energy is already on the customer's own EPS bill. */
  energyPart: EnergyPart | null;
  /** null while the subscription is paused or absent. */
  servicePart: ServicePart | null;
  status: StatementStatus;
  /** From the backend; null → the 15th of the next month (see statementDueDate). */
  dueDate: Date | null;
  /** No meter reading arrived for the month: the energy is the average of the last months (1.14). */
  energyEstimated: boolean;
}

// ---------------------------------------------------------------- meter readings by photo (1.14)

export type ReadingStatus = "submitted" | "accepted" | "rejected";

export interface MeterReading {
  id: number;
  valueKWh: number;
  readAt: Date;
  /** The month the reading closes (taken from the 4th of a month to the 3rd of the next one). */
  month: Month;
  status: ReadingStatus;
  /** Why it was rejected, as the team wrote it. */
  note: string | null;
  /** The caller's own photo in the private bucket `readings` ("<user id>/<file>"); null — none, or not theirs. */
  photoPath: string | null;
}

export interface MeterReadings {
  /** This point is read by photo (billed by its MID meter, nothing comes from the station) and the feature is on. */
  required: boolean;
  lastAccepted: { valueKWh: number; readAt: Date } | null;
  /** The last 12, newest first. */
  readings: MeterReading[];
}

export interface PointActivity {
  /** This call started the free period. */
  started: boolean;
  activatedAt: Date | null;
}

export type AlertKind =
  | { type: "chargeStarted" }
  | { type: "chargeFinished"; kWh: number }
  | { type: "fault" }
  | { type: "wentOffline" }
  | { type: "autostartExecuted" }
  | { type: "statementReady"; month: Month }
  | { type: "trialEnding"; daysLeft: number };

export interface Alert {
  id: string;
  kind: AlertKind;
  timestamp: Date;
  chargePointID: string;
  isRead: boolean;
}

export type ServiceCategory = "notCharging" | "notVisible" | "damaged" | "other";
export const SERVICE_CATEGORIES: ServiceCategory[] = ["notCharging", "notVisible", "damaged", "other"];
export type ServiceStatus = "received" | "scheduled" | "resolved";
export const SERVICE_STATUSES: ServiceStatus[] = ["received", "scheduled", "resolved"];

export interface ServiceRequest {
  id: string;
  chargePointID: string;
  category: ServiceCategory;
  comment: string | null;
  hasPhoto: boolean;
  createdAt: Date;
  status: ServiceStatus;
  updatedAt: Date;
  scheduledFor: Date | null;
}

export type RelocationStatus = "received" | "scheduled" | "completed";
export const RELOCATION_STATUSES: RelocationStatus[] = ["received", "scheduled", "completed"];

export interface RelocationRequest {
  id: string;
  chargePointID: string;
  newAddress: string;
  desiredDate: Date;
  comment: string | null;
  createdAt: Date;
  status: RelocationStatus;
  updatedAt: Date;
  scheduledFor: Date | null;
}

export type City = "beograd" | "novisad" | "vojvodina" | "ostatak";
export const CITIES: City[] = ["beograd", "novisad", "vojvodina", "ostatak"];
export type Parking = "iznajmljena" | "svoja" | "zajednicka" | "kuca" | "kompanija";
export const PARKINGS: Parking[] = ["iznajmljena", "svoja", "zajednicka", "kuca", "kompanija"];
// Paketi v2 (07.10.2026): the three main kits plus "Još opcija" — the same values as ?paket= on evolako.rs and the app.
export type PackageId = "start" | "wallbox" | "zgrada" | "plus" | "premium" | "ugradnja";
export const PACKAGE_IDS: PackageId[] = ["start", "wallbox", "zgrada", "plus", "premium", "ugradnja"];

export interface InstallationDraft {
  name: string;
  phone: string;
  email: string;
  city: City | null;
  address: string;
  parking: Parking | null;
  /** null — "Još ne znam". */
  package: PackageId | null;
  car: string;
  comment: string;
  referralCode: string;
  acceptsPrivacyPolicy: boolean;
}

export type InstallationStatus = "received" | "assessmentScheduled" | "installationScheduled" | "installed";
export const INSTALLATION_STATUSES: InstallationStatus[] =
  ["received", "assessmentScheduled", "installationScheduled", "installed"];

export interface InstallationRequest {
  id: string;
  draft: InstallationDraft;
  createdAt: Date;
  status: InstallationStatus;
  updatedAt: Date;
  assessmentAt: Date | null;
  installationAt: Date | null;
  /** "Z-1003" — the team's request number (sent by the backend, not in the contract table). */
  requestNo: string | null;
}

export type ReferralState = "sent" | "installed" | "notEligible";
export type NotEligibleReason = "ownCode" | "sameAddress" | "existingCustomer" | "codeAfterInstallation";

export interface Referral {
  id: string;
  friendName: string;
  status: ReferralState;
  notEligibleReason: NotEligibleReason | null;
  createdAt: Date;
  installedAt: Date | null;
  monthsAwarded: number;
}

export interface ReferralStatus {
  code: string;
  link: string;
  referrals: Referral[];
  freeMonthsBalance: number;
  appliesFrom: Month | null;
}

export interface CancelResult {
  endsOn: string | null;
  already: boolean;
  /** Unused free referral months that stay for 12 months after the last day (1.14); 0 — none. */
  freeMonthsKept: number;
}

export interface TariffPrices {
  highRateRSDPerKWh: number;
  lowRateRSDPerKWh: number;
}

export interface ServiceDraft {
  category: ServiceCategory;
  comment: string | null;
  /** JPEG, already resized to ≤ 1600 px without EXIF. */
  photo: Blob | null;
}

export interface RelocationDraft {
  newAddress: string;
  /** "yyyy-MM-dd" (Belgrade day). */
  desiredDate: string;
  comment: string | null;
}
