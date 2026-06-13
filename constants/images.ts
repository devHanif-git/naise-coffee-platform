export const images = {
  logo: "/brand/logo.jpg",
  logoTransparent: "/brand/logo_transparent.png",
  badge: "/brand/badge.png",
  latteArt: "/brand/latte_art_black_mug.png",
  celebration: "/brand/celebration_in_a_cup.png",
} as const;

export type ImageKey = keyof typeof images;
