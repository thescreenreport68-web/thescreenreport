import type { Metadata } from "next";
import Breadcrumbs from "@/components/Breadcrumbs";
import SearchBox from "@/components/SearchBox";

export const metadata: Metadata = {
  title: "Search",
  description:
    "Search every story on The Screen Report — film, TV, streaming, celebrity and music news.",
  alternates: { canonical: "/search/" },
  robots: { index: false, follow: true },
};

export default function SearchPage() {
  return (
    <div className="container-wide py-8">
      <Breadcrumbs items={[{ href: "/", label: "Home" }]} />
      <header className="border-b border-gray pb-4">
        <span className="kicker">The Screen Report</span>
        <h1 className="mt-1 font-display text-[30px] font-bold uppercase leading-none tracking-tight text-ink sm:text-[44px]">
          Search
        </h1>
        <p className="dek mt-3 max-w-2xl text-base">
          Every story we&apos;ve published — film, TV, streaming, celebrity and music.
        </p>
      </header>
      <div className="mx-auto mt-8 max-w-3xl">
        <SearchBox />
      </div>
    </div>
  );
}
