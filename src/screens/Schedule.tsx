// "Punjenje": the night auto-start and the bounds of its window (PunjenjeView of the app). No "Save" button:
// the switch saves at once, the bounds 0.6 s after the last change, and "Sačuvano" confirms it.
import { useEffect, useRef, useState } from "preact/hooks";
import type { ChargingSchedule, TariffConfig, Window } from "../api/types";
import { markActivity } from "../app/activity";
import { backendOrThrow, k, useSchedule } from "../app/data";
import { setData } from "../app/query";
import { errorMessage } from "../app/texts";
import { lang, t, type Lang } from "../i18n";
import { duration, rate } from "../lib/format";
import { endMinuteOfDay, isEmptyWindow, moveBound, roundWindow, startMinuteOfDay, windowMinutes } from "../lib/tariff";
import { Switch } from "../ui/controls";
import { ErrorState } from "../ui/display";
import { Icon } from "../ui/Icon";
import { FxNote, RefRate } from "../ui/money";
import { Drawer } from "../ui/overlay";
import { LoadingScreen } from "../ui/brand";

const STEP = 15;
const SAVE_DELAY = 600;

const pad = (n: number) => String(n).padStart(2, "0");

/** "23:00" — minutes of the day as a 24-hour clock (the schedule lives in Belgrade time). */
export function clock(minuteOfDay: number): string {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** "23:00 — 07:00" */
export function windowText(w: Window, _lang?: Lang): string {
  return `${clock(startMinuteOfDay(w))} — ${clock(endMinuteOfDay(w))}`;
}

function BoundRow({ title, minute, onChange, testId }: {
  title: string;
  minute: number;
  onChange: (minute: number) => void;
  testId: string;
}) {
  const options = new Set<number>();
  for (let m = 0; m < 1440; m += STEP) options.add(m);
  options.add(minute);
  return (
    <div class="bound">
      <span class="bound__title" id={`${testId}-label`}>{title}</span>
      <button type="button" class="bound__step" aria-label={t("15 minuta ranije")} title={t("15 minuta ranije")}
        onClick={() => onChange(minute - STEP)} data-testid={`${testId}-minus`}>
        <Icon name="minus" />
      </button>
      <span class="bound__time">
        <select class="bound__select num" value={String(minute)} aria-labelledby={`${testId}-label`}
          title={t("Izaberi vreme")} onChange={(e) => onChange(Number((e.currentTarget as HTMLSelectElement).value))}
          data-testid={testId}>
          {[...options].sort((a, b) => a - b).map((m) => <option key={m} value={String(m)}>{clock(m)}</option>)}
        </select>
      </span>
      <button type="button" class="bound__step" aria-label={t("15 minuta kasnije")} title={t("15 minuta kasnije")}
        onClick={() => onChange(minute + STEP)} data-testid={`${testId}-plus`}>
        <Icon name="plus" />
      </button>
    </div>
  );
}

export function ScheduleDrawer({ pointId, tariff, onClose }: { pointId: string; tariff: TariffConfig; onClose: () => void }) {
  const schedule = useSchedule(pointId);
  const [draft, setDraft] = useState<ChargingSchedule | null>(null);
  const [status, setStatus] = useState<"idle" | "pending" | "saving" | "saved">("idle");
  const [error, setError] = useState<{ message: string; failed: ChargingSchedule } | null>(null);
  const saved = useRef<ChargingSchedule | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (schedule.data && !draft) {
      setDraft(schedule.data);
      saved.current = schedule.data;
    }
  }, [schedule.data]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (reset.current) clearTimeout(reset.current);
  }, []);

  const save = async (requested: ChargingSchedule) => {
    const next: ChargingSchedule = { isEnabled: requested.isEnabled, window: roundWindow(requested.window, STEP) };
    if (isEmptyWindow(next.window)) {
      setDraft(saved.current);
      setStatus("idle");
      return;
    }
    setDraft(next);
    setStatus("saving");
    setError(null);
    try {
      await backendOrThrow().updateSchedule(pointId, next);
      markActivity(pointId);
      saved.current = next;
      setData(k("schedule", pointId), next);
      setStatus("saved");
      if (reset.current) clearTimeout(reset.current);
      reset.current = setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setDraft(saved.current);
      setStatus("idle");
      setError({ message: errorMessage(e), failed: next });
    }
  };

  const setEnabled = (isEnabled: boolean) => {
    if (!draft) return;
    if (timer.current) clearTimeout(timer.current);
    void save({ ...draft, isEnabled });
  };

  const setBound = (bound: "start" | "end", minute: number) => {
    if (!draft) return;
    const window = moveBound(draft.window, bound, minute);
    if (isEmptyWindow(window)) return;
    const next = { ...draft, window };
    setDraft(next);
    setStatus("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), SAVE_DELAY);
  };

  const l = lang.value;
  let body;
  if (!draft) {
    body = schedule.error
      ? <ErrorState message={errorMessage(schedule.error)} onRetry={schedule.reload} />
      : <LoadingScreen />;
  } else {
    body = (
      <div class="stack schedule">
        <div class="card card--tile">
          <Switch label={t("Noćni autostart")} hint={t("Punjenje kreće samo, u okviru noćnog okna.")}
            checked={draft.isEnabled} onChange={setEnabled} testId="schedule-toggle" />
        </div>
        {draft.isEnabled ? (
          <div class="card card--tile schedule__window" data-testid="schedule-window">
            <div class="schedule__head">
              <h3 class="card__title">{t("Noćno okno")}</h3>
              <span class="card__sub num">{duration(windowMinutes(draft.window) * 60, l)}</span>
            </div>
            <BoundRow title={t("Početak")} minute={startMinuteOfDay(draft.window)}
              onChange={(m) => setBound("start", m)} testId="schedule-start" />
            <BoundRow title={t("Kraj")} minute={endMinuteOfDay(draft.window)}
              onChange={(m) => setBound("end", m)} testId="schedule-end" />
          </div>
        ) : null}
        <p class="schedule__status" aria-live="polite" data-testid="schedule-status">
          {status === "saved" ? (<><Icon name="checkCircle" /><span>{t("Sačuvano")}</span></>) : " "}
        </p>
        {error ? (
          <div class="inline-error" role="alert">
            <Icon name="circleAlert" />
            <span>{t("Nije uspelo")}: {error.message}</span>
            <button type="button" class="link-btn" onClick={() => void save(error.failed)}>{t("Pokušaj ponovo")}</button>
          </div>
        ) : null}
        <div class="card card--tile">
          <h3 class="card__title schedule__why"><Icon name="moon" />{t("Zašto noću")}</h3>
          <p class="card__sub">{t("U noćnom oknu struja je jeftinija po nižoj tarifi EPS-a.")}</p>
          <dl class="rates">
            <div>
              <dt><span class="split__swatch split__swatch--night" aria-hidden="true" />{t("Niža tarifa")}</dt>
              <dd class="num"><RefRate rsd={tariff.lowRateRSDPerKWh} unit={t("kWh")} rsdText={`${rate(tariff.lowRateRSDPerKWh)} RSD / ${t("kWh")}`} /></dd>
            </div>
            <div>
              <dt><span class="split__swatch split__swatch--day" aria-hidden="true" />{t("Viša tarifa")}</dt>
              <dd class="num"><RefRate rsd={tariff.highRateRSDPerKWh} unit={t("kWh")} rsdText={`${rate(tariff.highRateRSDPerKWh)} RSD / ${t("kWh")}`} /></dd>
            </div>
          </dl>
          <FxNote />
        </div>
      </div>
    );
  }
  return (
    <Drawer title={t("Punjenje")} onClose={onClose} testId="schedule-drawer">
      {body}
    </Drawer>
  );
}
