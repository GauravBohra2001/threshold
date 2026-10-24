import type { ButtonProps } from "@/components/ui/Button";
import Button from "@/components/ui/Button";

export type PrimaryButtonProps = Omit<ButtonProps, "variant" | "fullWidth">;

/**
 * Backwards-compatible wrapper around the design-system {@link Button}. Existing
 * P1 screens import this as the full-width bottom primary action; new screens
 * should import `@/components/ui/Button` directly.
 */
export default function PrimaryButton(props: PrimaryButtonProps) {
  return <Button variant="primary" fullWidth {...props} />;
}
