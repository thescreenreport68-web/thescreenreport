// Answer-first "Key Takeaways" box — App. P gate item 5. Rendered near the top of
// the article so the reader (and AI Overviews) get the payoff in scannable bullets.
export default function KeyTakeaways({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <aside className="my-7 border-l-4 border-breaking bg-mist/40 px-5 py-4">
      <h2 className="font-sans text-xs font-bold uppercase tracking-[0.12em] text-breaking">
        Key Takeaways
      </h2>
      <ul className="mt-3 space-y-2">
        {items.map((t, i) => (
          <li
            key={i}
            className="flex gap-2.5 font-body text-[1.05rem] leading-snug text-navy"
          >
            <span
              aria-hidden
              className="mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full bg-breaking"
            />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
