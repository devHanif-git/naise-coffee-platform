import { TabBar } from "@/components/tab-bar";
import { CartProvider } from "@/store/cart";

export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CartProvider>
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background pb-[calc(4rem+env(safe-area-inset-bottom))]">
        {children}
        <TabBar />
      </div>
    </CartProvider>
  );
}
