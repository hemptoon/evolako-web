// SplitMix64 — the same deterministic generator as MockBackend/SeededRandom.swift. Demo data must be
// reproducible: one seed, the same sessions, the same screenshots, passing tests.
const MASK = (1n << 64n) - 1n;

export class SeededRandom {
  private state: bigint;

  constructor(seed: bigint) {
    this.state = seed & MASK;
  }

  next(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return z ^ (z >> 31n);
  }

  /** Uniform in [lo, hi). */
  double(lo: number, hi: number): number {
    const unit = Number(this.next() >> 11n) / 9007199254740992;
    return lo + unit * (hi - lo);
  }

  /** Uniform integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + Number(this.next() % BigInt(hi - lo + 1));
  }

  chance(probability: number): boolean {
    return this.double(0, 1) < probability;
  }
}

/** Referral code EVO-XXXXX derived from a user id with FNV-1a (ReferralCode.make of the app). */
export function referralCode(userId: string): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(userId)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & MASK;
  }
  let body = "";
  for (let i = 0; i < 5; i++) {
    body += alphabet[Number(hash % BigInt(alphabet.length))];
    hash /= BigInt(alphabet.length);
  }
  return `EVO-${body}`;
}
