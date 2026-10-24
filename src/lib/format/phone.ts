/**
 * Mask a phone number for display so only the country/area prefix and the last
 * four digits are shown, e.g. "+16173960097" -> "+1 617 ••• 0097". The full
 * caregiver number is never rendered.
 */
export function maskPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const hasPlus = raw.trim().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return "•".repeat(digits.length);
  const last4 = digits.slice(-4);
  const rest = digits.slice(0, -4);
  let country = "";
  let area = "";
  if (hasPlus && rest.length > 3) {
    country = "+" + rest.slice(0, rest.length - 3);
    area = rest.slice(-3);
  } else if (rest.length >= 3) {
    area = rest.slice(-3);
    const lead = rest.slice(0, -3);
    country = lead ? (hasPlus ? "+" : "") + lead : "";
  } else {
    area = rest;
  }
  return [country, area, "•••", last4].filter((p) => p.length > 0).join(" ");
}
