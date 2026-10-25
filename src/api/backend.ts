// The one interface screens talk to (BackendClient of the app). Two implementations: RemoteBackend (HTTPS to our
// API_BASE, backend/docs/API.md) and DemoBackend (deterministic demo data through the same decoders).
import type { Month } from "../lib/belgrade";
import type { Currency } from "../lib/format";
import type {
  Alert,
  CancelResult,
  ChargePoint,
  ChargingSchedule,
  ChargingSession,
  InstallationDraft,
  InstallationRequest,
  LiveSession,
  MeterReadings,
  PointActivity,
  ReferralStatus,
  RelocationDraft,
  RelocationRequest,
  ServiceDraft,
  ServiceRequest,
  SessionTag,
  Statement,
  Subscription,
  TariffConfig,
  TariffPrices,
  User,
} from "./types";

export interface InstallationMeta {
  lang: "sr" | "en" | "ru";
  marketingOptIn: boolean;
}

export interface Backend {
  readonly kind: "demo" | "remote";

  currentUser(): Promise<User>;
  chargePoint(id: string): Promise<ChargePoint>;
  updateChargePointName(id: string, name: string | null): Promise<ChargePoint>;

  sessions(pointId: string, from: Date, to: Date): Promise<ChargingSession[]>;
  updateSessionTag(pointId: string, sessionId: string, tag: SessionTag | null): Promise<ChargingSession>;
  liveSession(pointId: string): Promise<LiveSession | null>;

  schedule(pointId: string): Promise<ChargingSchedule>;
  updateSchedule(pointId: string, schedule: ChargingSchedule): Promise<void>;
  tariff(pointId: string): Promise<TariffConfig>;
  /** null prices — back to the service's typical prices. Only for ownMeter (else tariffReadOnly). */
  updateTariffPrices(pointId: string, prices: TariffPrices | null): Promise<TariffConfig>;

  statements(pointId: string): Promise<Statement[]>;
  statement(pointId: string, month: Month): Promise<Statement | null>;

  subscription(): Promise<Subscription>;
  requestSubscriptionPause(): Promise<Subscription>;
  cancelSubscription(): Promise<CancelResult>;
  resumeSubscription(): Promise<Subscription>;
  referralStatus(): Promise<ReferralStatus>;

  // Meter readings by photo (1.14): for a point billed by its MID meter with no link to the station.
  meterReadings(pointId: string): Promise<MeterReadings>;
  /** `photo` — JPEG ≤ 1,5 MB, re-encoded (no EXIF). Uploaded first, then referenced by path. Returns the reading's number. */
  submitMeterReading(pointId: string, valueKWh: number, photo: Blob): Promise<number>;
  /** The caller's own photo of a reading (private storage), for the thumbnail. */
  readingPhoto(photoPath: string): Promise<Blob>;
  /**
   * The owner did something with the charger (opened its status, the history, a statement, the readings; changed a
   * setting or the schedule): the free period starts with the first such call (1.14 §2). Idempotent.
   */
  markPointActivity(pointId: string): Promise<PointActivity>;

  alerts(): Promise<Alert[]>;
  markAlertRead(id: string): Promise<void>;

  createServiceRequest(pointId: string, draft: ServiceDraft): Promise<ServiceRequest>;
  serviceRequests(pointId: string): Promise<ServiceRequest[]>;
  createRelocationRequest(pointId: string, draft: RelocationDraft): Promise<RelocationRequest>;
  relocationRequests(pointId: string): Promise<RelocationRequest[]>;

  createInstallationRequest(draft: InstallationDraft, meta: InstallationMeta): Promise<InstallationRequest>;
  installationRequests(): Promise<InstallationRequest[]>;

  setMarketingConsent(granted: boolean): Promise<void>;
  setAnalyticsOptOut(optOut: boolean): Promise<void>;
  /** The display currency of the account (1.11.3), shared with the app: PATCH of the own profile row. */
  setDisplayCurrency(currency: Currency): Promise<void>;
  deleteAccount(): Promise<void>;
}
