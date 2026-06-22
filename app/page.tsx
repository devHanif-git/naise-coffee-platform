"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { images } from "@/constants/images";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const timeout = setTimeout(() => {
      // Home screen is hidden for now — land straight on the menu.
      router.push("/menu");
    }, 1500);

    return () => clearTimeout(timeout);
  }, [router]);

  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center bg-black px-6 py-16 text-center text-white">
      <div className="flex w-full max-w-sm flex-col items-center">
        <Image
          src={images.logoTransparent}
          alt="Naise Coffee"
          width={640}
          height={640}
          priority
          className="naise-logo-splash h-auto w-60 sm:w-64"
        />

        <h1
          className="naise-rise mt-9 max-w-[18rem] text-balance font-heading text-xl font-semibold leading-snug tracking-tight text-white/90 sm:text-2xl [animation-delay:350ms]"
        >
          Coffee first, everything else can wait.
        </h1>
      </div>
    </main>
  );
}
