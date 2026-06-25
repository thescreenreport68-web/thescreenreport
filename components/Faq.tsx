import type { Faq as FaqType } from "@/lib/articles";

export default function Faq({ items }: { items: FaqType[] }) {
  if (!items?.length) return null;
  return (
    <section className="mt-12">
      <h2 className="font-serif text-2xl font-bold text-navy">
        Frequently asked questions
      </h2>
      <div className="mt-4 divide-y divide-navy/10 border-y border-navy/10">
        {items.map((f, i) => (
          <details key={i} className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-navy">
              {f.q}
              <span className="text-gold-600 transition group-open:rotate-45">+</span>
            </summary>
            <p className="mt-2 text-navy/70">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
