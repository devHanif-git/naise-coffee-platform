// CMS-facing promotion shape. Dates are ISO strings (or null = open-ended).
export type AdminPromotion = {
  id: string;
  slug: string;
  label: string;
  percentOff: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  productIds: string[];
  categoryIds: string[];
};

// Payload the promotion editor submits.
export type PromotionFormData = {
  id?: string;
  label: string;
  percentOff: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  productIds: string[];
  categoryIds: string[];
};
