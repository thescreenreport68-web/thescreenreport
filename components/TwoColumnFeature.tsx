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

// The Hollywood Reporter "Heat Vision | Live Feed" pattern: two branded columns,
// each with a centered title + italic tagline, a lead story, a dotted secondary
// list, and a "View all" link — divided by a vertical rule.
function Column({ c }: { c: FeatureColumn }) {
  return (
    <div>
      <SectionHeader title={c.title} tagline={c.tagline} center />
      <FeatureLead article={c.lead} />
      {c.rest.length ? (
        <div className="mt-4 border-t border-navy/10 pt-4">
          <DottedList items={c.rest} showKicker={false} />
        </div>
      ) : null}
      <Link
        href={c.href}
        className="mt-4 inline-block font-sans text-xs font-bold uppercase tracking-[0.14em] text-gold-600 hover:text-navy"
      >
        View all →
      </Link>
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
    <section className="grid gap-8 md:grid-cols-2 md:divide-x md:divide-navy/10">
      <div className="md:pr-8">
        <Column c={left} />
      </div>
      <div className="md:pl-8">
        <Column c={right} />
      </div>
    </section>
  );
}
