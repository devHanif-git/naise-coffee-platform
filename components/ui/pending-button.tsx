import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Button + an in-flight spinner. Disables while `pending` so the action can't
// be re-fired or raced, and shows the same Loader2 used elsewhere in the app
// (e.g. order-detail). For plain text/icon buttons — not for asChild/Slot.
export function PendingButton({
  pending = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { pending?: boolean }) {
  return (
    <Button disabled={pending || disabled} {...props}>
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}
