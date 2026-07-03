import Link from "next/link";
import SectionHeader from "./SectionHeader";
import FeatureLead from "./FeatureLead";
import DottedList from "./DottedList";
import type { Article } from "@/lib/articles";

export type FeatureColumn = {
  title: string;
  tagline?: string;
  href: string;
  lead: Article;
  rest: Article[];
};

// The Hollywood Reporter "Heat Vision | Live Feed" pattern: two branded columns
// split by a hairline rule — centered display title + italic tagline, a lead
// story, a dotted secondary list, one CTA spec (spec §C2).
function Column({ c }: { c: FeatureColumn }) {
  return (
    <div className="flex h-full flex-col">
      <SectionHeader title={c.title} tagline={c.tagline} center />
      <FeatureLead article={c.lead} />
      {c.rest.length ? (
        <div className="mt-5 border-t border-hair pt-4">
          <DottedList items={c.rest} showKicker={false} />
        </div>
      ) : null}
      <div className="mt-auto pt-5">
        <Link
          href={c.href}
          className="btn-label inline-block text-slate transition-colors duration-150 hover:text-red"
        >
          View All{" "}
          <span aria-hidden className="align-[-1px]">
            ›
          </span>
        </Link>
      </div>
    </div>
  );
}

export default function TwoColumnFeature({
  left,
  right,
}: {
  left: FeatureColumn;
  right: FeatureColumn;
}) {
  return (
    <section className="grid gap-10 md:grid-cols-2 md:gap-0 md:divide-x md:divide-hair">
      <div className="md:pr-8">
        <Column c={left} />
      </div>
      <div className="md:pl-8">
        <Column c={right} />
      </div>
    </section>
  );
}
