// The last line of defence: a screen that fails to render (a bug, or a chunk that no longer exists after a new
// release) shows a calm "Nešto nije u redu" with "Osveži" instead of a blank page. Two layers: around each screen
// inside the shell (navigation stays usable; the error clears when the path changes) and around the whole app.
import { Component, type ComponentChildren } from "preact";
import { t } from "../i18n";
import { Button } from "../ui/controls";
import { Icon } from "../ui/Icon";
import { Page } from "./Page";

interface Props {
  children: ComponentChildren;
  /** "app": the whole window; "page": the content area inside the shell. */
  level: "app" | "page";
  /** A new key (the path) clears the error: another screen gets its own chance. */
  resetKey?: string;
}

interface State {
  error: unknown;
  key: string | undefined;
}

export function ErrorScreen({ level }: { level: "app" | "page" }) {
  const reload = (
    <Button icon="refresh" onClick={() => window.location.reload()} testId="app-error-reload">{t("Osveži")}</Button>
  );
  if (level === "page") {
    return (
      <Page title={t("Nešto nije u redu")} testId="app-error">
        <div class="card card--block">
          <div class="state" role="alert">
            <span class="state__icon state__icon--fault"><Icon name="alert" /></span>
            <p class="state__text">{t("Pokušaj ponovo malo kasnije.")}</p>
            {reload}
          </div>
        </div>
      </Page>
    );
  }
  return (
    <main class="public public--center">
      <div class="state" role="alert" data-testid="app-error">
        <span class="state__icon state__icon--fault"><Icon name="alert" /></span>
        <h1 class="state__title" id="page-title" tabIndex={-1}>{t("Nešto nije u redu")}</h1>
        <p class="state__text">{t("Pokušaj ponovo malo kasnije.")}</p>
        {reload}
      </div>
    </main>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, key: this.props.resetKey };

  static override getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  static override getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error("render failed") };
  }

  override componentDidCatch(error: unknown): void {
    // Kept in the console for whoever looks; never sent anywhere.
    console.error(error);
  }

  render() {
    return this.state.error ? <ErrorScreen level={this.props.level} /> : this.props.children;
  }
}
