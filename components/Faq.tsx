import type { Faq as FaqType } from "@/lib/articles";

export default function Faq({ items }: { items: FaqType[] }) {
  if (!items?.length) return null;
  return (
    <section className="mt-12">
      <div className="border-b-2 border-ink pb-2">
        <h2 className="sect-head text-2xl lg:text-2xl">Frequently Asked Questions</h2>
      </div>
      <div className="divide-y divide-hair">
        {items.map((f, i) => (
          <details key={i} className="group py-4">
            <summary className="hed-s flex cursor-pointer list-none items-center justify-between gap-4 transition-colors duration-150 hover:text-red">
              {f.q}
              <span
                aria-hidden
                className="font-display text-xl font-bold leading-none text-red transition-transform duration-150 group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-2 font-body text-[1.05rem] leading-relaxed text-slate">
              {f.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
