import type { Alert } from "../api/types";
import { backendOrThrow, k, useAlerts } from "../app/data";
import { invalidate } from "../app/query";
import { navigate } from "../app/router";
import { alertIcon, alertTitle, errorMessage } from "../app/texts";
import { lang, t } from "../i18n";
import { daysBetween, monthKey } from "../lib/belgrade";
import { time, weekdayAndDate } from "../lib/format";
import { LoadingScreen } from "../ui/brand";
import { Button } from "../ui/controls";
import { EmptyState, ErrorState } from "../ui/display";
import { Icon } from "../ui/Icon";
import { Drawer } from "../ui/overlay";

function dayTitle(date: Date): string {
  const days = daysBetween(date, new Date());
  if (days === 0) return t("Danas");
  if (days === 1) return t("Juče");
  const text = weekdayAndDate(date, lang.value);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function group(alerts: Alert[]): Array<{ title: string; items: Alert[] }> {
  const out: Array<{ title: string; items: Alert[] }> = [];
  for (const alert of alerts) {
    const title = dayTitle(alert.timestamp);
    const last = out[out.length - 1];
    if (last && last.title === title) last.items.push(alert);
    else out.push({ title, items: [alert] });
  }
  return out;
}

/** The alerts feed (Obaveštenja): grouped by day, unread marked with a dot, a click marks it read. */
export function AlertsPanel({ onClose }: { onClose: () => void }) {
  const alerts = useAlerts(true);
  const unread = (alerts.data ?? []).filter((a) => !a.isRead);

  const markRead = async (ids: string[]) => {
    const backend = backendOrThrow();
    await Promise.all(ids.map((id) => backend.markAlertRead(id).catch(() => undefined)));
    invalidate(k("alerts"));
  };

  const open = (alert: Alert) => {
    if (!alert.isRead) void markRead([alert.id]);
    if (alert.kind.type === "statementReady") {
      onClose();
      navigate(`/obracuni/${monthKey(alert.kind.month)}`);
    } else if (alert.kind.type === "fault") {
      onClose();
      navigate("/profil/prijavi-kvar");
    } else if (alert.kind.type === "trialEnding") {
      onClose();
      navigate("/profil/pretplata");
    }
  };

  return (
    <Drawer title={t("Obaveštenja")} onClose={onClose} testId="alerts-panel">
      {alerts.loading ? <LoadingScreen /> : alerts.data === undefined ? (
        <ErrorState message={errorMessage(alerts.error)} onRetry={alerts.reload} />
      ) : alerts.data.length === 0 ? (
        <EmptyState icon="bell" title={t("Nema obaveštenja")}
          message={t("Javićemo ti kada punjenje počne ili se završi, kada bude obračun i ako nešto krene naopako.")} />
      ) : (
        <div class="alerts">
          {unread.length > 0 ? (
            <Button variant="ghost" size="sm" icon="check" onClick={() => markRead(unread.map((a) => a.id))}
              class="alerts__all" testId="alerts-read-all">
              {t("Označi sve kao pročitano")}
            </Button>
          ) : null}
          {group(alerts.data).map((day) => (
            <section key={day.title} class="alerts__day">
              <h3 class="alerts__day-title">{day.title}</h3>
              <ul class="alerts__list">
                {day.items.map((alert) => (
                  <li key={alert.id}>
                    <button type="button" class={`alert-row${alert.isRead ? "" : " alert-row--unread"}`}
                      onClick={() => open(alert)} data-testid="alert-row">
                      <span class={`alert-row__icon${alert.kind.type === "fault" ? " alert-row__icon--fault" : ""}`}>
                        <Icon name={alertIcon(alert.kind)} />
                      </span>
                      <span class="alert-row__text">
                        <span class="alert-row__title">{alertTitle(alert.kind)}</span>
                        <span class="alert-row__time">{time(alert.timestamp, lang.value)}</span>
                      </span>
                      {alert.isRead ? null : <span class="alert-row__dot" aria-label={t("Nepročitano")} role="img" />}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Drawer>
  );
}
