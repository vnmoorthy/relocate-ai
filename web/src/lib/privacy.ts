/**
 * Last-line display protection for the public dashboard. This is not a
 * substitute for server-side authorization/redaction, but prevents common
 * identifiers from being rendered when a live feed is configured.
 */
export function redactDisplayText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[government id redacted]")
    .replace(/\bA-?\d{7,9}\b/gi, "[government id redacted]")
    .replace(
      /\b\d{1,6}\s+(?:[A-Z0-9.'-]+\s+){0,5}(?:ST(?:REET)?|AVE(?:NUE)?|RD|ROAD|BLVD|BOULEVARD|DR(?:IVE)?|LN|LANE|CT|COURT|WAY|PL(?:ACE)?|PKWY|PARKWAY)\b/gi,
      "[street address redacted]",
    )
    .replace(/\b(?:\d[ -]?){9,}\d\b/g, "[number redacted]")
    .replace(
      /\b(account|member|policy|confirmation|tracking|ref(?:erence)?|event(?:_id)?|doc(?:ument)?_?id|message_?id)\s*[:=#-]?\s*<?[^\s,;]{5,}>?/gi,
      "$1 [id redacted]",
    );
}

/**
 * The static dashboard is public. Live provider payloads can contain names or
 * identifiers that pattern matching cannot safely recognize, so their freeform
 * text is never rendered. Synthetic demo copy may be shown after redaction.
 */
export function publicFeedText(value: string, demoMode: boolean, hiddenLabel: string): string {
  return demoMode ? redactDisplayText(value) : hiddenLabel;
}
