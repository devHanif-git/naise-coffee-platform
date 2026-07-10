import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { listMyVouchers } from "@/lib/stamps/voucher-store";
import { VoucherList } from "@/components/stamps/voucher-list";

export const metadata: Metadata = {
  title: "Your Vouchers",
  description: "Your loyalty vouchers at Naise Coffee.",
};

export default async function ProfileVouchersPage() {
  const vouchers = await listMyVouchers();

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-background px-5 pb-3 pt-4">
        <Link
          href="/profile"
          aria-label="Back to profile"
          className="flex size-9 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
        <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">
          Vouchers
        </h1>
        <div className="size-9" aria-hidden />
      </header>

      <main className="px-5 pb-8 pt-2">
        {vouchers.length === 0 ? (
          <div className="mt-16 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">No vouchers yet.</p>
            <Link
              href="/profile"
              className="text-xs font-semibold text-foreground underline-offset-2 hover:underline"
            >
              Back to profile
            </Link>
          </div>
        ) : (
          <VoucherList vouchers={vouchers} showAll heading={false} />
        )}
      </main>
    </div>
  );
}
