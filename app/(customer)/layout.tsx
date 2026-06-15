import { TabBar } from "@/components/tab-bar";
import { AuthProvider } from "@/store/auth";
import { CartProvider } from "@/store/cart";
import { BeansProvider } from "@/store/beans";
import { ProfileProvider } from "@/store/profile";
import { WelcomeModal } from "@/components/welcome-modal";

export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <ProfileProvider>
        <BeansProvider>
          <CartProvider>
            <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background pb-[calc(4rem+env(safe-area-inset-bottom))]">
              {children}
              <TabBar />
            </div>
            <WelcomeModal />
          </CartProvider>
        </BeansProvider>
      </ProfileProvider>
    </AuthProvider>
  );
}
