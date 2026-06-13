import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Naise Coffee",
    short_name: "Naise",
    description: "Order coffee from Naise Coffee.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#171717",
    icons: [
      // TODO: replace with purpose-built 192x192 and 512x512 (incl. maskable) icons.
      {
        src: "/brand/logo_transparent.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/brand/logo_transparent.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
