// Money is stored in sen (1 MYR = 100 sen). Format to a RM display string.
export function formatPrice(sen: number): string {
  return `RM ${(sen / 100).toFixed(2)}`;
}
