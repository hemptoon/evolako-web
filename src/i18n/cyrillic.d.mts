/** One text in Serbian Cyrillic; placeholders (%@, %lld, %1$@, {name}) stay as they are. */
export function cyrText(text: string): string;
/** A catalog value: a text, or plural forms. */
export function cyrValue<T extends string | Record<string, string>>(value: T): T;
