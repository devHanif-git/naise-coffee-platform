import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getBestSellers } from "@/lib/menu/store";
import { getStoreSettings } from "@/lib/settings/store";
import { images } from "@/constants/images";
import { Button } from "@/components/ui/button";
import { BestSellerCarousel } from "@/components/best-seller-carousel";
import { RewardsBanner } from "@/components/rewards-banner";
import { Reveal } from "@/components/reveal";

export const metadata: Metadata = {
  title: "Naise Coffee",
  description:
    "Order coffee, non-coffee, and matcha from Naise Coffee. Customize your drink, earn Beans, and check out over WhatsApp.",
  openGraph: {
    title: "Naise Coffee",
    description:
      "Order coffee, non-coffee, and matcha from Naise Coffee. Customize your drink, earn Beans, and check out over WhatsApp.",
    type: "website",
  },
};

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const bestSellers = await getBestSellers();
  const { rewardsEnabled } = await getStoreSettings();

  return (
    <main className="flex flex-1 flex-col">
      {/* Full-bleed black hero: brand wordmark, tagline, primary CTA. */}
      <section className="flex flex-col items-center bg-black px-6 pb-9 pt-6 text-white">
        <Image
          src={images.logoTransparent}
          alt="Naise Coffee"
          width={640}
          height={640}
          priority
          className="naise-pop h-auto w-44 sm:w-48"
        />

        <p className="naise-rise [animation-delay:35ms] -mt-2 max-w-[15rem] text-balance text-center font-heading text-base font-semibold leading-snug text-white/90">
          Coffee first, everything else can wait.
        </p>

        <Button
          asChild
          size="lg"
          className="naise-rise [animation-delay:55ms] mt-3 h-12 w-full rounded-full bg-white text-xs font-semibold uppercase tracking-[0.15em] text-black transition-transform hover:scale-[1.02] hover:bg-white active:scale-[0.99]"
        >
          <Link href="/menu">Browse Menu</Link>
        </Button>
      </section>

      {/* White sheet that curves up over the hero (overlap card). The panel
          stays static and only fades in — translating it would drag the sheet's
          straight white edge up through the black hero and flash a flat white
          box. Fading is position-free, so the curve resolves cleanly in place;
          the upward motion comes from the content rising inside via Reveal. */}
      <div className=" relative z-10 -mt-6 flex flex-col gap-5 rounded-t-[1.75rem] bg-background pb-6 pt-5">
        {/* naise-fade [animation-delay:90ms] */}
        {bestSellers.length > 0 && (
          <Reveal>
            <BestSellerCarousel products={bestSellers} />
          </Reveal>
        )}

        {rewardsEnabled && (
          <Reveal delay={80}>
            <RewardsBanner />
          </Reveal>
        )}
      </div>
    </main>
  );
}
