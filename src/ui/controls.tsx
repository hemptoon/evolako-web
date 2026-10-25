import type { ComponentChildren, InputHTMLAttributes, JSX } from "preact";
import { useId, useRef } from "preact/hooks";
import { Loader } from "./brand";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps {
  variant?: Variant;
  size?: "md" | "sm";
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  block?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  href?: string;
  external?: boolean;
  download?: string;
  onClick?: (e: MouseEvent) => void;
  class?: string;
  label?: string;
  id?: string;
  children?: ComponentChildren;
  testId?: string;
}

/** Pill button (PillButton): primary = blue fill (one per screen), secondary = outline. */
export function Button(props: ButtonProps) {
  const {
    variant = "primary", size = "md", icon, iconRight, loading = false, block = false, disabled = false,
    type = "button", href, external, download, onClick, label, id, children, testId,
  } = props;
  const className = [
    "btn", `btn--${variant}`, size === "sm" ? "btn--sm" : "", block ? "btn--block" : "", props.class ?? "",
  ].filter(Boolean).join(" ");
  const content = (
    <>
      {loading ? <Loader size="inline" /> : icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
      {iconRight && !loading ? <Icon name={iconRight} /> : null}
    </>
  );
  if (href && !disabled) {
    return (
      <a
        class={className}
        href={href}
        id={id}
        aria-label={label}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        download={download}
        onClick={onClick}
        data-testid={testId}
      >
        {content}
      </a>
    );
  }
  return (
    <button
      class={className}
      type={type}
      id={id}
      // A busy button stays enabled-looking (grey pills fail contrast); repeated clicks are ignored.
      disabled={disabled}
      aria-busy={loading ? "true" : undefined}
      aria-label={label}
      onClick={(e) => {
        if (loading) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      data-testid={testId}
    >
      {content}
    </button>
  );
}

interface IconButtonProps {
  icon: IconName;
  label: string;
  onClick?: (e: MouseEvent) => void;
  href?: string;
  class?: string;
  expanded?: boolean;
  controls?: string;
  hasPopup?: "menu" | "dialog";
  children?: ComponentChildren;
  testId?: string;
}

export function IconButton({ icon, label, onClick, href, class: className, expanded, controls, hasPopup, children, testId }: IconButtonProps) {
  const cls = className ? `icon-btn ${className}` : "icon-btn";
  if (href) {
    return (
      <a class={cls} href={href} aria-label={label} title={label} data-testid={testId}>
        <Icon name={icon} />
        {children}
      </a>
    );
  }
  return (
    <button
      class={cls}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      aria-expanded={expanded === undefined ? undefined : expanded ? "true" : "false"}
      aria-controls={controls}
      aria-haspopup={hasPopup}
      data-testid={testId}
    >
      <Icon name={icon} />
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- segmented control (radio group)

interface SegmentedProps<T extends string> {
  label: string;
  options: Array<{ value: T; label: ComponentChildren }>;
  value: T;
  onChange: (value: T) => void;
  class?: string;
  testId?: string;
}

/** A radio group drawn as a segmented control; arrow keys move the selection (roving tabindex). */
export function Segmented<T extends string>({ label, options, value, onChange, class: className, testId }: SegmentedProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (index: number) => {
    const next = (index + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    refs.current[next]?.focus();
  };
  return (
    <div class={className ? `seg ${className}` : "seg"} role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            class="seg__item"
            aria-checked={checked ? "true" : "false"}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(index + 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(index - 1);
              }
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- switch

interface SwitchProps {
  label: string;
  hint?: string;
  /** A small second line about where the shown state comes from (e.g. "this device"). */
  note?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  testId?: string;
}

/** A labelled switch row; the whole row toggles. */
export function Switch({ label, hint, note, checked, onChange, disabled, testId }: SwitchProps) {
  const id = useId();
  const described = [hint ? `${id}-h` : "", note ? `${id}-n` : ""].filter(Boolean).join(" ");
  return (
    <div class="switch-row" onClick={() => !disabled && onChange(!checked)}>
      <div class="switch-row__text">
        <div class="switch-row__label" id={`${id}-l`}>{label}</div>
        {hint ? <div class="switch-row__hint" id={`${id}-h`}>{hint}</div> : null}
        {note ? (
          <div class="switch-row__note" id={`${id}-n`} data-testid={testId ? `${testId}-note` : undefined}>
            <Icon name="monitor" />
            <span>{note}</span>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        class="switch"
        aria-checked={checked ? "true" : "false"}
        aria-labelledby={`${id}-l`}
        aria-describedby={described || undefined}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onChange(!checked);
        }}
        data-testid={testId}
      />
    </div>
  );
}

// ---------------------------------------------------------------- chips

export function Chip({ pressed, onClick, children, icon }: {
  pressed: boolean;
  onClick: () => void;
  children: ComponentChildren;
  icon?: IconName;
}) {
  return (
    <button type="button" class="chip" aria-pressed={pressed ? "true" : "false"} onClick={onClick}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- fields

interface FieldShell {
  label: string;
  optional?: string;
  hint?: string;
  error?: string | null;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => JSX.Element;
  counter?: string;
}

export function Field({ label, optional, hint, error, children, counter }: FieldShell) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : "";
  const errorId = error ? `${id}-err` : "";
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div class="field">
      <label class="field__label" for={id}>
        {label}
        {optional ? <span class="field__optional"> ({optional})</span> : null}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {counter ? <div class="counter" aria-hidden="true">{counter}</div> : null}
      {hint ? <div class="field__hint" id={hintId}>{hint}</div> : null}
      {error ? (
        <div class="field__error" id={errorId}>
          <Icon name="circleAlert" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}

type InputAttrs = Omit<InputHTMLAttributes<HTMLInputElement>, "onInput" | "value" | "label">;

interface TextFieldProps extends InputAttrs {
  label: string;
  optional?: string;
  hint?: string;
  error?: string | null;
  value: string;
  onValue: (value: string) => void;
  counter?: string;
  inputClass?: string;
  testId?: string;
}

export function TextField({ label, optional, hint, error, value, onValue, counter, inputClass, testId, ...rest }: TextFieldProps) {
  return (
    <Field label={label} optional={optional} hint={hint} error={error} counter={counter}>
      {({ id, describedBy, invalid }) => (
        <input
          {...rest}
          id={id}
          class={inputClass ? `input ${inputClass}` : "input"}
          value={value}
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={describedBy}
          onInput={(e) => onValue((e.currentTarget as HTMLInputElement).value)}
          data-testid={testId}
        />
      )}
    </Field>
  );
}

interface TextAreaProps {
  label: string;
  optional?: string;
  hint?: string;
  error?: string | null;
  value: string;
  onValue: (value: string) => void;
  maxLength?: number;
  placeholder?: string;
  rows?: number;
  testId?: string;
}

export function TextArea({ label, optional, hint, error, value, onValue, maxLength, placeholder, rows = 4, testId }: TextAreaProps) {
  return (
    <Field label={label} optional={optional} hint={hint} error={error}
      counter={maxLength ? `${value.length} / ${maxLength}` : undefined}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          class="textarea"
          value={value}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={describedBy}
          onInput={(e) => onValue((e.currentTarget as HTMLTextAreaElement).value)}
          data-testid={testId}
        />
      )}
    </Field>
  );
}

interface SelectProps<T extends string> {
  label: string;
  optional?: string;
  hint?: string;
  error?: string | null;
  value: T | "";
  placeholder: string;
  options: Array<{ value: T; label: string }>;
  onValue: (value: T | "") => void;
  testId?: string;
}

export function SelectField<T extends string>({ label, optional, hint, error, value, placeholder, options, onValue, testId }: SelectProps<T>) {
  return (
    <Field label={label} optional={optional} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <div class="select-wrap">
          <select
            id={id}
            class="select"
            value={value}
            aria-invalid={invalid ? "true" : undefined}
            aria-describedby={describedBy}
            onChange={(e) => onValue((e.currentTarget as HTMLSelectElement).value as T | "")}
            data-testid={testId}
          >
            <option value="">{placeholder}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <Icon name="chevronDown" />
        </div>
      )}
    </Field>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ComponentChildren;
  error?: string | null;
  testId?: string;
}

export function Checkbox({ checked, onChange, children, error, testId }: CheckboxProps) {
  const id = useId();
  return (
    <div class="field">
      <label class="check-row" for={id}>
        <input
          id={id}
          type="checkbox"
          class="check"
          checked={checked}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
          data-testid={testId}
        />
        <span>{children}</span>
      </label>
      {error ? (
        <div class="field__error" id={`${id}-err`}>
          <Icon name="circleAlert" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}
