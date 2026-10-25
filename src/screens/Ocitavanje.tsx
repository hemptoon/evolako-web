// /ocitavanje — the monthly meter reading by photo (11.10.2026), for a point billed by its MID meter with no link
// to the station (START, a building's shared line, a wallbox without a connection). A photo of the meter, the number
// on its display, "Pošalji očitavanje" — and the last readings with what happened to them. The same flow as in the
// app; the reminder e-mail of the last day of the month opens this page.
import { useEffect, useRef, useState } from "preact/hooks";
import { isBackendError, isOffline } from "../api/errors";
import type { MeterReading, MeterReadings } from "../api/types";
import { useActivity } from "../app/activity";
import { activePoint, backendOrThrow, k, useMeterReadings, useUser } from "../app/data";
import { features } from "../app/features";
import { invalidate } from "../app/query";
import { errorMessage, pointName, readingStatusTitle, readingStatusTone } from "../app/texts";
import { lang, t } from "../i18n";
import { decimal, fullDate, monthAndYear } from "../lib/format";
import { prepareJpeg } from "../lib/photo";
import { checkReading, parseReading, PHOTO_MAX_BYTES, PHOTO_MAX_SIDE, readingDue, READING_DECIMALS } from "../lib/readings";
import { Page } from "../shell/Page";
import type { Mode } from "../shell/Shell";
import { Button, TextField } from "../ui/controls";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "../ui/display";
import { Icon } from "../ui/Icon";
import { PageSkeleton, useNow } from "./common";
import NotFound from "./NotFound";

/** "1.432,6" — up to three decimals, no trailing zeros (the meter shows one or two). */
export function readingValue(kWh: number): string {
  for (let digits = 0; digits < READING_DECIMALS; digits++) {
    if (Math.abs(kWh * 10 ** digits - Math.round(kWh * 10 ** digits)) < 1e-6) return decimal(kWh, digits);
  }
  return decimal(kWh, READING_DECIMALS);
}

/** The line under the entry in Obračuni and on the page: what the last reading is, or that this month's is missing. */
export function readingSummary(data: MeterReadings, now: Date): string {
  const due = readingDue(data.readings, now);
  if (due) return t("Za %@ još nije poslato", monthAndYear(due.year, due.month, lang.value));
  const last = data.readings[0];
  if (!last) return t("Još nema očitavanja.");
  return `${readingStatusTitle(last.status)} · ${fullDate(last.readAt, lang.value)}`;
}

function Thumbnail({ path }: { path: string }) {
  const holder = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null;
    let cancelled = false;
    const load = () => {
      backendOrThrow().readingPhoto(path).then((blob) => {
        if (cancelled) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      }).catch(() => {
        // no picture (offline, removed): the row says everything without it
      });
    };
    // Only when the row comes into view: the pictures are the person's own files, up to 1,5 MB each.
    const el = holder.current;
    let observer: IntersectionObserver | null = null;
    if (el && "IntersectionObserver" in window) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer?.disconnect();
          load();
        }
      });
      observer.observe(el);
    } else load();
    return () => {
      cancelled = true;
      observer?.disconnect();
      if (made) URL.revokeObjectURL(made);
    };
  }, [path]);
  return (
    <span class="reading__thumb" ref={holder}>
      {url ? <img src={url} alt={t("Fotografija")} data-testid="reading-photo" /> : <Icon name="image" />}
    </span>
  );
}

function ReadingRow({ reading }: { reading: MeterReading }) {
  const l = lang.value;
  return (
    <li class="reading" data-testid="reading-row" data-status={reading.status}>
      {reading.photoPath ? <Thumbnail path={reading.photoPath} /> : (
        <span class="reading__thumb"><Icon name="gauge" /></span>
      )}
      <div class="reading__text">
        <span class="reading__value num">{readingValue(reading.valueKWh)} {t("kWh")}</span>
        <span class="reading__date">{fullDate(reading.readAt, l)}</span>
        {reading.status === "rejected" && reading.note ? (
          <span class="reading__note" data-testid="reading-note">{t("Razlog")}: {reading.note}</span>
        ) : null}
      </div>
      <Badge tone={readingStatusTone(reading.status)}
        icon={reading.status === "accepted" ? "checkCircle" : reading.status === "rejected" ? "alert" : "clock"}>
        {readingStatusTitle(reading.status)}
      </Badge>
    </li>
  );
}

function History({ data }: { data: MeterReadings }) {
  return (
    <section aria-labelledby="readings-title" class="stack">
      <h2 class="section-title" id="readings-title">{t("Poslednja očitavanja")}</h2>
      {data.readings.length === 0 ? (
        <Card><EmptyState icon="gauge" title={t("Još nema očitavanja.")} testId="readings-empty" /></Card>
      ) : (
        <ul class="card card--flush readings" data-testid="readings-list">
          {data.readings.map((r) => <ReadingRow key={r.id} reading={r} />)}
        </ul>
      )}
    </section>
  );
}

function PhotoField({ photo, onPhoto, error }: { photo: Blob | null; onPhoto: (photo: Blob | null) => void; error: string | null }) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const pick = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      onPhoto(await prepareJpeg(file, PHOTO_MAX_SIDE, PHOTO_MAX_BYTES));
    } catch {
      setProblem(t("Ovu fotografiju ne možemo da otvorimo. Probaj drugu."));
    } finally {
      setBusy(false);
    }
  };

  const shown = problem ?? error;
  return (
    <div class="field photo reading-photo">
      <span class="field__label">{t("Fotografija")}</span>
      {preview ? (
        <div class="photo__preview">
          <img src={preview} alt={t("Fotografija")} data-testid="reading-preview" />
          <Button variant="secondary" size="sm" icon="camera" onClick={() => onPhoto(null)} testId="reading-photo-change">
            {t("Promeni fotografiju")}
          </Button>
        </div>
      ) : (
        <div class="reading-photo__actions">
          <Button variant="secondary" icon="camera" loading={busy} onClick={() => camera.current?.click()} testId="reading-camera">
            {t("Fotografiši brojilo")}
          </Button>
          <Button variant="secondary" icon="image" disabled={busy} onClick={() => gallery.current?.click()} testId="reading-gallery">
            {t("Izaberi iz galerije")}
          </Button>
        </div>
      )}
      <input ref={camera} type="file" accept="image/*" capture="environment" class="sr-only" tabIndex={-1}
        aria-hidden="true" data-testid="reading-camera-input" onChange={pick} />
      <input ref={gallery} type="file" accept="image/*" class="sr-only" tabIndex={-1}
        aria-hidden="true" data-testid="reading-gallery-input" onChange={pick} />
      {shown ? <div class="field__error" data-testid="reading-photo-error"><Icon name="circleAlert" /><span>{shown}</span></div> : null}
    </div>
  );
}

function ReadingForm({ pointId, data, onSent }: { pointId: string; data: MeterReadings; onSent: () => void }) {
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [valueError, setValueError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** The value the person was asked about ("izgleda previše") — sending it again is their answer. */
  const [asked, setAsked] = useState<number | null>(null);
  const field = useRef<HTMLDivElement>(null);
  const last = data.lastAccepted;

  const tooLow = (than: number) => t("Stanje ne može biti manje od poslednjeg prihvaćenog: %@ kWh.", readingValue(than));
  const focusValue = () => field.current?.querySelector("input")?.focus();

  const send = async (confirmed: boolean) => {
    if (busy) return;
    setProblem(null);
    const value = parseReading(text);
    setPhotoError(photo ? null : t("Dodaj fotografiju brojila."));
    setValueError(value === null ? t("Upiši stanje na brojilu.") : null);
    if (!photo || value === null) {
      if (photo) focusValue();
      return;
    }
    const verdict = checkReading(value, last, new Date());
    if (verdict === "tooLow") {
      setValueError(tooLow(last!.valueKWh));
      focusValue();
      return;
    }
    if (verdict === "tooHigh" && !confirmed) {
      setAsked(value);
      return;
    }
    setAsked(null);
    setBusy(true);
    try {
      await backendOrThrow().submitMeterReading(pointId, value, photo);
      invalidate(k("readings"), k("subscription"));
      onSent();
    } catch (e) {
      // Nothing is cleared: the photo and the number stay for another try.
      if (isBackendError(e, "meterReadingTooLow")) {
        setValueError(last ? tooLow(last.valueKWh) : errorMessage(e));
        invalidate(k("readings"));
      } else if (isOffline(e)) {
        setProblem(t("Nema veze. Očitavanje nije poslato — fotografija i broj su sačuvani, pokušaj ponovo."));
      } else setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="card card--block form reading-form" noValidate data-testid="reading-form" onSubmit={(e) => {
      e.preventDefault();
      void send(false);
    }}>
      <p class="reading-form__intro">{t("Jednom mesečno pošalji fotografiju MID brojila pored punjača. Iz nje pravimo mesečni obračun.")}</p>
      <PhotoField photo={photo} error={photoError} onPhoto={(p) => {
        setPhoto(p);
        setPhotoError(null);
      }} />
      <div ref={field}>
        <TextField label={t("Stanje na brojilu (kWh)")} value={text} inputMode="decimal" autoComplete="off"
          enterKeyHint="send" maxLength={14} inputClass="num" testId="reading-value" error={valueError}
          hint={last ? `${t("Upiši broj sa ekrana brojila.")} ${t("Poslednje prihvaćeno: %@ kWh", readingValue(last.valueKWh))}`
            : t("Upiši broj sa ekrana brojila.")}
          onValue={(v) => {
            setText(v);
            setValueError(null);
            setAsked(null);
          }} />
      </div>
      {asked !== null ? (
        <div class="banner banner--info reading-form__ask" role="alert" data-testid="reading-ask">
          <Icon name="circleAlert" />
          <div class="banner__main">
            <div class="banner__title">{t("Proveri broj — izgleda previše.")}</div>
            <div class="reading-form__ask-actions">
              <Button variant="secondary" size="sm" onClick={() => {
                setAsked(null);
                focusValue();
              }} testId="reading-edit">{t("Ispravi")}</Button>
              <Button variant="secondary" size="sm" loading={busy} onClick={() => void send(true)} testId="reading-send-anyway">
                {t("Pošalji ipak")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {problem ? (
        <div class="inline-error" role="alert" data-testid="form-error"><Icon name="circleAlert" /><span>{problem}</span></div>
      ) : null}
      <Button type="submit" block loading={busy && asked === null} icon="send" testId="reading-send">{t("Pošalji očitavanje")}</Button>
    </form>
  );
}

function Sent({ onAgain }: { onAgain: () => void }) {
  return (
    <Card class="sent" data-testid="reading-sent">
      <span class="state__icon"><Icon name="checkCircle" /></span>
      <p class="state__text" role="status">{t("Očitavanje je poslato. Proveravamo ga i javljamo se ako nešto nije jasno.")}</p>
      <div class="state__actions">
        <Button href="/obracuni" icon="check">{t("Gotovo")}</Button>
        <Button variant="ghost" onClick={onAgain} testId="reading-again">{t("Pošalji očitavanje")}</Button>
      </div>
    </Card>
  );
}

export default function Ocitavanje(props: { params: Record<string, string>; mode: Mode }) {
  const user = useUser();
  const point = activePoint(user.data);
  const enabled = features.value.meterPhoto;
  const readings = useMeterReadings(enabled ? point?.id ?? null : null);
  useActivity(point?.id ?? null);
  const now = useNow(60_000);
  const [sent, setSent] = useState(false);
  if (!enabled) return <NotFound {...props} />;
  if (!point) return <PageSkeleton />;

  let body;
  if (readings.data === undefined) {
    body = readings.error ? <Card><ErrorState message={errorMessage(readings.error)} onRetry={readings.reload} /></Card>
      : <div class="stack"><Skeleton height={420} radius={28} /></div>;
  } else if (!readings.data.required) {
    // A point that reports by itself (or the feature is off on the server): there is nothing to send.
    return <NotFound {...props} />;
  } else {
    const data = readings.data;
    body = (
      <div class="two-col two-col--form">
        {sent ? <Sent onAgain={() => setSent(false)} /> : (
          <ReadingForm pointId={point.id} data={data} onSent={() => {
            setSent(true);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }} />
        )}
        <History data={data} />
      </div>
    );
  }

  return (
    <Page title={t("Očitavanje brojila")}
      subtitle={readings.data ? `${pointName(point)} · ${readingSummary(readings.data, now)}` : pointName(point)}
      back="/obracuni" backLabel={t("Obračuni")} testId="ocitavanje">
      {body}
    </Page>
  );
}
