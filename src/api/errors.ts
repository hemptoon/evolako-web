// Errors of the contract (BackendError of the app) and of the sign-in (AccountError).

export type BackendErrorCode =
  | "chargePointNotFound"
  | "capabilityUnavailable"
  | "offline"
  | "alreadyCharging"
  | "notCharging"
  | "pauseNotAvailable"
  | "tariffReadOnly"
  | "serviceRequestIncomplete"
  | "sessionNotFound"
  | "relocationRequestIncomplete"
  | "relocationAlreadyRequested"
  | "chargePointNameTooLong"
  | "guestMode"
  | "installationRequestIncomplete"
  | "installationAlreadyRequested"
  | "rateLimited"
  // 1.14: meter readings by photo
  | "meterReadingIncomplete"
  | "meterReadingTooLow";

export const BACKEND_ERROR_CODES: readonly BackendErrorCode[] = [
  "chargePointNotFound", "capabilityUnavailable", "offline", "alreadyCharging", "notCharging",
  "pauseNotAvailable", "tariffReadOnly", "serviceRequestIncomplete", "sessionNotFound",
  "relocationRequestIncomplete", "relocationAlreadyRequested", "chargePointNameTooLong", "guestMode",
  "installationRequestIncomplete", "installationAlreadyRequested", "rateLimited",
  "meterReadingIncomplete", "meterReadingTooLow",
];

export class BackendError extends Error {
  constructor(public readonly code: BackendErrorCode, public readonly field?: string) {
    super(code);
    this.name = "BackendError";
  }
}

export type AccountErrorCode =
  | "invalidEmail"
  | "invalidCode"
  | "sessionExpired"
  | "notConfigured"
  // Sign-in with Google did not go through: the ID token was refused (expired, another app's, a replayed nonce), the
  // return did not match the sign-in this browser started, or Google said no.
  | "googleFailed";

export class AccountError extends Error {
  constructor(public readonly code: AccountErrorCode) {
    super(code);
    this.name = "AccountError";
  }
}

export function isBackendError(e: unknown, code?: BackendErrorCode): e is BackendError {
  return e instanceof BackendError && (code === undefined || e.code === code);
}

export function isOffline(e: unknown): boolean {
  return isBackendError(e, "offline");
}
