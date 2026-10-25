// Serbian payment details: account numbers, "poziv na broj" and the NBS IPS QR payload.
// Ported from Domain/Payments of the iOS app (BankAccount, PozivNaBroj, IPSQRPayload).

/** ISO 7064 MOD 97-10 remainder of a digit string of any length. */
export function remainder97(digits: string): number {
  let r = 0;
  for (const ch of digits) r = (r * 10 + (ch.charCodeAt(0) - 48)) % 97;
  return r;
}

// ---------------------------------------------------------------- account

/** 18 digits (3 bank + 13 party + 2 control) and the whole number mod 97 == 1. */
export function isValidAccount(account: string): boolean {
  return /^\d{18}$/.test(account) && remainder97(account) === 1;
}

/** As printed on documents: "160-0000000000000-76". Anything that is not 18 digits is shown as is. */
export function accountDisplay(account: string): string {
  if (!/^\d{18}$/.test(account)) return account;
  return `${account.slice(0, 3)}-${account.slice(3, 16)}-${account.slice(16)}`;
}

/** Builds an account from a bank code and party number, computing the control digits. */
export function makeAccount(bank: string, party: string): string | null {
  if (!/^\d{3}$/.test(bank) || !/^\d{1,13}$/.test(party)) return null;
  const base = bank + party.padStart(13, "0");
  const control = 98 - remainder97(base + "00");
  return base + String(control).padStart(2, "0");
}

// ---------------------------------------------------------------- poziv na broj

export interface PozivNaBroj {
  model: string;
  reference: string;
}

/** Control digits of model 97: 98 − (base × 100) mod 97, always two digits. */
export function mod97Control(base: string): string | null {
  if (!/^\d+$/.test(base)) return null;
  return String(98 - ((remainder97(base) * 100) % 97)).padStart(2, "0");
}

export function makePoziv(model: "97" | "00", base: string): PozivNaBroj | null {
  if (!/^\d+$/.test(base)) return null;
  const reference = model === "97" ? `${mod97Control(base)}${base}` : base;
  if (model.length + reference.length > 35) return null;
  return { model, reference };
}

export function isValidPoziv(p: PozivNaBroj): boolean {
  if (p.model === "00") return /^\d*$/.test(p.reference);
  if (p.model !== "97" || p.reference.length <= 2 || !/^\d+$/.test(p.reference)) return false;
  return mod97Control(p.reference.slice(2)) === p.reference.slice(0, 2);
}

/** The RO tag: model and reference together, "9714202607000001". */
export function pozivTag(p: PozivNaBroj): string {
  return p.model + p.reference;
}

/** For reading: "97 14-202607000001". */
export function pozivDisplay(p: PozivNaBroj): string {
  if (p.model === "97" && p.reference.length > 2) return `97 ${p.reference.slice(0, 2)}-${p.reference.slice(2)}`;
  return `${p.model} ${p.reference}`;
}

// ---------------------------------------------------------------- IPS QR

export type IpsFields = Partial<Record<"K" | "V" | "C" | "R" | "N" | "I" | "SF" | "S" | "RO", string>>;

/**
 * Splits a payload into its tags. The payload comes from the backend and is never rebuilt by the web app
 * (contract, "IPS QR"); parsing is only for showing the purpose and for the "copy payment details" text.
 */
export function parseIps(payload: string): IpsFields {
  const out: IpsFields = {};
  for (const field of payload.split("|")) {
    const colon = field.indexOf(":");
    if (colon <= 0) continue;
    const tag = field.slice(0, colon) as keyof IpsFields;
    out[tag] = field.slice(colon + 1);
  }
  return out;
}

/** "RSD1690,00" — the I tag: no thousands separator, mandatory comma and two decimals. */
export function ipsAmount(amount: number): string {
  const paras = Math.round(Number((amount * 100).toPrecision(15)));
  return `RSD${Math.trunc(paras / 100)},${String(Math.abs(paras % 100)).padStart(2, "0")}`;
}

/** Removes the characters that break the payload and cuts to the tag's limit. */
export function sanitizeIps(text: string, limit: number): string {
  return text.replace(/[|\r\n]/g, " ").trim().slice(0, limit).trim();
}

export interface IpsInput {
  account: string;
  payeeName: string;
  amount: number;
  purpose: string;
  paymentCode?: string;
  poziv?: PozivNaBroj | null;
}

/**
 * Builds a K:PR payload (NBS specification, tag order as in the NBS examples). Used by the demo backend only —
 * real statements carry the backend's payload. Throws on data a bank would reject.
 */
export function buildIps(input: IpsInput): string {
  if (!isValidAccount(input.account)) throw new Error(`invalid account ${input.account}`);
  const name = sanitizeIps(input.payeeName, 70);
  const purpose = sanitizeIps(input.purpose, 35);
  const code = input.paymentCode ?? "289";
  if (!name || !purpose || !/^[12]\d\d$/.test(code) || input.amount < 0) throw new Error("invalid IPS input");
  const fields: [string, string][] = [
    ["K", "PR"], ["V", "01"], ["C", "1"], ["R", input.account], ["N", name],
    ["I", ipsAmount(input.amount)], ["SF", code], ["S", purpose],
  ];
  if (input.poziv) {
    if (!isValidPoziv(input.poziv)) throw new Error("invalid poziv na broj");
    fields.push(["RO", pozivTag(input.poziv)]);
  }
  return fields.map(([k, v]) => `${k}:${v}`).join("|");
}
