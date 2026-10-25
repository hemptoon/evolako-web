// Kill switches of the service (app_config.features), read from the content document `config` of our API:
// manifest → file, like the rate of the display currency (app/currency.ts). No API, no document, an error → the
// defaults: everything on. The server applies the same switches to its own answers (api_meter_readings.required),
// so this only hides an entry point a little earlier.
import { signal } from "@preact/signals";
import { config } from "./session";

export interface Features {
  /** Meter readings by photo (1.14): false hides the row in Obračuni, the card in Danas and the page. */
  meterPhoto: boolean;
  /** Sign-in with Google (13.10.2026): false hides the button on /prijava (app/google.ts). */
  googleLogin: boolean;
}

export const features = signal<Features>({ meterPhoto: true, googleLogin: true });

export async function loadFeatures(fetcher: typeof fetch = (input, init) => fetch(input, init)): Promise<void> {
  const base = config.value.apiBase;
  if (!base) return;
  try {
    const manifestRes = await fetcher(`${base}/content/v1/manifest.json`, { cache: "no-cache" });
    if (!manifestRes.ok) return;
    const manifest = await manifestRes.json() as { files?: Record<string, { path?: unknown; schemaVersion?: unknown }> };
    const entry = manifest.files?.config;
    if (!entry || typeof entry.path !== "string" || (entry.schemaVersion ?? 1) !== 1) return;
    const path = entry.path.replace(/^\/+/, "");
    if (!/^v1\/[a-z_]+(\.[0-9a-f]{12})?\.json$/.test(path)) return;
    const res = await fetcher(`${base}/content/${path}`);
    if (!res.ok) return;
    const doc = await res.json() as { values?: { features?: Record<string, unknown> } };
    features.value = {
      meterPhoto: doc.values?.features?.meterPhoto !== false,
      googleLogin: doc.values?.features?.googleLogin !== false,
    };
  } catch {
    // offline, 5xx, not the contract: the defaults stay
  }
}
