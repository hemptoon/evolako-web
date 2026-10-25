// /profil/prijavi-kvar — report a problem: what is happening (a category), a comment (required for "Drugo"),
// an optional photo (resized to ≤ 1600 px, JPEG 0.7, metadata dropped by re-encoding), and the requests so far.
import { useEffect, useRef, useState } from "preact/hooks";
import type { ServiceCategory, ServiceRequest } from "../../api/types";
import { SERVICE_CATEGORIES } from "../../api/types";
import { activePoint, backendOrThrow, k, useServiceRequests, useUser } from "../../app/data";
import { invalidate } from "../../app/query";
import { categoryIcon, categorySubtitle, categoryTitle, errorMessage } from "../../app/texts";
import { t } from "../../i18n";
import { Page } from "../../shell/Page";
import type { Mode } from "../../shell/Shell";
import { Button, TextArea } from "../../ui/controls";
import { Card, EmptyState, ErrorState, Skeleton } from "../../ui/display";
import { Icon } from "../../ui/Icon";
import { PageSkeleton, ServiceRequestCard } from "../common";

const COMMENT_LIMIT = 500;
const MAX_SIDE = 1600;
const QUALITY = 0.7;

/**
 * A photo as the service needs it: the longest side ≤ 1600 px, JPEG at quality 0.7. Drawing to a canvas and
 * encoding again drops EXIF (location, device) — only pixels leave the browser.
 */
export async function preparePhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height, 1));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode"))), "image/jpeg", QUALITY);
  });
}

function PhotoPicker({ photo, onPhoto }: { photo: Blob | null; onPhoto: (photo: Blob | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  return (
    <div class="field photo">
      <span class="field__label">{t("Fotografija (nije obavezno)")}</span>
      {preview ? (
        <div class="photo__preview">
          <img src={preview} alt={t("Fotografija")} data-testid="photo-preview" />
          <Button variant="secondary" size="sm" icon="trash" onClick={() => onPhoto(null)} testId="photo-remove">
            {t("Ukloni")}
          </Button>
        </div>
      ) : (
        <Button variant="secondary" icon="camera" loading={busy} onClick={() => input.current?.click()} testId="photo-add">
          {t("Dodaj fotografiju")}
        </Button>
      )}
      <input ref={input} type="file" accept="image/*" capture="environment" class="sr-only" tabIndex={-1}
        aria-hidden="true" data-testid="photo-input"
        onChange={async (e) => {
          const file = (e.currentTarget as HTMLInputElement).files?.[0];
          (e.currentTarget as HTMLInputElement).value = "";
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            onPhoto(await preparePhoto(file));
          } catch {
            setError(t("Ovu fotografiju ne možemo da otvorimo. Probaj drugu."));
          } finally {
            setBusy(false);
          }
        }} />
      {error ? <div class="field__error"><Icon name="circleAlert" /><span>{error}</span></div> : null}
    </div>
  );
}

function Sent({ request }: { request: ServiceRequest }) {
  return (
    <div class="stack">
      <Card class="sent" data-testid="service-sent">
        <span class="state__icon"><Icon name="checkCircle" /></span>
        <h2 class="state__title">{t("Prijava je poslata")}</h2>
        <p class="state__text">{t("Javićemo se u roku od 48 h.")}</p>
        <p class="card__sub">{t("Status pratiš na ekranu Danas i u obaveštenjima.")}</p>
        <Button href="/danas" icon="check">{t("Gotovo")}</Button>
      </Card>
      <ServiceRequestCard request={request} />
    </div>
  );
}

export default function PrijaviKvar(_props: { params: Record<string, string>; mode: Mode }) {
  const user = useUser();
  const point = activePoint(user.data);
  const requests = useServiceRequests(point?.id ?? null);
  const [category, setCategory] = useState<ServiceCategory | null>(null);
  const [comment, setComment] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<ServiceRequest | null>(null);
  if (!point) return <PageSkeleton />;

  const needsComment = category === "other";
  const submit = async () => {
    if (busy) return;
    if (!category) {
      setProblem(t("Izaberi šta se dešava."));
      return;
    }
    const trimmed = comment.trim().slice(0, COMMENT_LIMIT);
    if (needsComment && !trimmed) {
      setProblem(t("Za „Drugo“ napiši ukratko šta se dešava."));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const request = await backendOrThrow().createServiceRequest(point.id, {
        category, comment: trimmed || null, photo,
      });
      invalidate(k("service"), k("alerts"));
      setSent(request);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const list = requests.data ?? [];
  const history = (
    <section aria-labelledby="requests-title" class="stack">
      <h2 class="section-title" id="requests-title">{t("Tvoje prijave")}</h2>
      {requests.data === undefined ? (
        requests.error ? <Card><ErrorState message={errorMessage(requests.error)} onRetry={requests.reload} /></Card>
          : <Skeleton height={160} radius={24} />
      ) : list.length === 0 ? (
        <Card><EmptyState icon="wrench" title={t("Još nema prijava")} message={t("Javićemo se u roku od 48 h.")} /></Card>
      ) : (
        list.filter((r) => r.id !== sent?.id).map((r) => <ServiceRequestCard key={r.id} request={r} />)
      )}
    </section>
  );

  return (
    <Page title={t("Prijavi kvar")} subtitle={t("Javićemo se u roku od 48 h.")} back="/profil" backLabel={t("Profil")}
      testId="prijavi-kvar">
      <div class="two-col two-col--form">
        {sent ? <Sent request={sent} /> : (
          <form class="card card--block form" noValidate data-testid="service-form" onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}>
            <fieldset class="choices">
              <legend class="form__legend">{t("Šta se dešava?")}</legend>
              {SERVICE_CATEGORIES.map((c) => (
                <label key={c} class="choice" data-testid={`category-${c}`}>
                  <input type="radio" name="category" value={c} checked={category === c}
                    onChange={() => {
                      setCategory(c);
                      setProblem(null);
                    }} />
                  <span class="choice__icon"><Icon name={categoryIcon(c)} /></span>
                  <span class="choice__text">
                    <span class="choice__title">{categoryTitle(c)}</span>
                    <span class="choice__sub">{categorySubtitle(c)}</span>
                  </span>
                  <Icon name="checkCircle" class="choice__tick" />
                </label>
              ))}
            </fieldset>
            <TextArea label={needsComment ? t("Komentar") : t("Komentar (nije obavezno)")} value={comment}
              onValue={(v) => {
                setComment(v.slice(0, COMMENT_LIMIT));
                setProblem(null);
              }} maxLength={COMMENT_LIMIT} placeholder={t("Kada je počelo, šta vidiš na tački…")} testId="service-comment"
              hint={needsComment ? t("Za „Drugo“ napiši ukratko šta se dešava.") : undefined} />
            <PhotoPicker photo={photo} onPhoto={setPhoto} />
            {problem ? (
              <div class="inline-error" role="alert" data-testid="form-error"><Icon name="circleAlert" /><span>{problem}</span></div>
            ) : null}
            <Button type="submit" block loading={busy} icon="send" testId="service-send">{t("Pošalji")}</Button>
            <p class="note"><Icon name="clock" /><span>{t("Javićemo se u roku od 48 h.")}</span></p>
          </form>
        )}
        {history}
      </div>
    </Page>
  );
}
