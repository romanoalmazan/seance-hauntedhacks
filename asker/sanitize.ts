// Least context: strip emails and phone numbers before anything leaves the asker (SPEC §4 step 1).
export const MAX_CONTEXT_CHARS = 300;

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

// +44 20 7946 0958, 1-555-123-4567, (555) 123-4567, 555.123.4567, 5551234567.
// Anchored on both sides so part numbers and specs (BAT-7741, ACT-7, 2027, 48 V) survive.
const PHONE =
  /(?<![\w.-])(?:\+\d[\d\s().-]{6,}\d|(?:1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-]?)\d{3}[\s.-]?\d{4})(?![\w-])/g;

export function stripPii(text: string): string {
  return text.replace(EMAIL, "[email removed]").replace(PHONE, "[phone removed]");
}

/** Strips first, then caps, so a cut can't leave half an email behind and the placeholder can't overflow. */
export function sanitizeContext(text: string): string {
  return stripPii(text).trim().slice(0, MAX_CONTEXT_CHARS);
}
