// Storefront notice shown when the store is closed (store_settings.is_open=false).
export function StoreClosedBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="mx-4 mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      {message}
    </div>
  );
}
