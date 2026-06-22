export const images = {
  logo: "/brand/logo.jpg",
  logoTransparent: "/brand/logo_transparent.png",
  badge: "/brand/badge.png",
  latteArt: "/brand/latte_art_black_mug.png",
  celebration: "/brand/celebration_in_a_cup.png",
  coffeeWithLogo: "/brand/coffee_with_logo.png",
  emptyCart: "/brand/empty_cart.png",
  emptyCartNoBg: "/brand/empty_cart_nobg.png",
  qrDuitnow: "/brand/QRCode.png",
} as const;

export type ImageKey = keyof typeof images;
