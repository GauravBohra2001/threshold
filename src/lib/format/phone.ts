/**
 * Mask a phone number for display so only the last four digits are visible,
 * e.g. "+16173960097" -> "+1 ••• ••• 0097". Everything except the last four
 * digits (and a short leading country code when the number begins with "+") is
 * hidden. The full caregiver number is never rendered.
 */
export function maskPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const hasPlus = raw.trim().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return "•".repeat(digits.length);
  const last4 = digits.slice(-4);

  // For an international number, keep a short country code visible ("+1") since
  // it is not identifying; mask everything between it and the last four digits.
  let country = "";
  if (hasPlus) {
    const lead = digits.length - 4;
    // 11 digits (e.g. 1 + 10) -> 1-digit country code; otherwise up to 2.
    const ccLen = lead >= 11 ? 2 : 1;
    country = "+" + digits.slice(0, Math.min(ccLen, Math.max(0, lead)));
  }

  return [country, "•••", "•••", last4].filter((p) => p.length > 0).join(" ");
}
