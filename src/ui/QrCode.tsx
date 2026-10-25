// IPS QR as crisp vector modules (its own module: the QR encoder loads with the statement screens only).
import { useMemo } from "preact/hooks";
import { t } from "../i18n";
import { encodeQr, qrPath } from "../lib/qr";

/**
 * IPS QR as crisp vector modules (level M). Always dark on white, whatever the theme — a bank app's camera reads
 * it. In the demo the code carries a visible "DEMO — ne plaćaj" label: the payee accounts are placeholders.
 */
export function QrCode({ payload, demo, label, size }: { payload: string; demo?: boolean; label: string; size?: number }) {
  const matrix = useMemo(() => encodeQr(payload), [payload]);
  const side = matrix.size + 8;
  const path = useMemo(() => qrPath(matrix, 4), [matrix]);
  return (
    <figure class="qr" data-testid="ips-qr" data-payload={payload} style={size ? { maxWidth: `${size}px` } : undefined}>
      <svg viewBox={`0 0 ${side} ${side}`} role="img" aria-label={label} shape-rendering="crispEdges">
        <rect width={side} height={side} fill="#FFFFFF" />
        <path d={path} fill="#0B1220" />
      </svg>
      {demo ? <span class="qr__demo" data-testid="qr-demo">{t("DEMO — ne plaćaj")}</span> : null}
    </figure>
  );
}
