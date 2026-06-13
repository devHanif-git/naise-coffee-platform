import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { images } from "@/constants/images";

export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center bg-black px-6 py-16 text-center text-white">
      <div className="flex w-full max-w-sm flex-col items-center">
        <Image
          src={images.logoTransparent}
          alt="Naise Coffee"
          width={640}
          height={640}
          priority
          className="naise-pop h-auto w-60 sm:w-64"
        />

        <h1
          className="naise-rise mt-9 max-w-[18rem] text-balance font-heading text-xl font-semibold leading-snug tracking-tight text-white/90 sm:text-2xl"
          style={{ animationDelay: "0.35s" }}
        >
          Coffee first, everything else can wait.
        </h1>

        <Button
          asChild
          size="lg"
          className="naise-rise mt-12 h-14 w-full rounded-full bg-white text-sm font-semibold uppercase tracking-[0.15em] text-black transition-transform hover:bg-white hover:scale-[1.02] active:scale-[0.99]"
          style={{ animationDelay: "0.55s" }}
        >
          <Link href="/menu">Browse Menu</Link>
        </Button>
      </div>
    </main>
  );
}
