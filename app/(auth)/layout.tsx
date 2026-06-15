import { AuthProvider } from "@/store/auth";

// The auth route group sits outside the (customer) shell — no tab bar, just a
// centered mobile-width canvas. It gets its own AuthProvider; because the store
// is localStorage-backed, the session written here is read back by the customer
// layout's provider after redirect (and the persisted cart is untouched).
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background">
        {children}
      </div>
    </AuthProvider>
  );
}
