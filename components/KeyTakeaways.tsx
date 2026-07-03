// Answer-first "Key Takeaways" — the payoff in scannable bullets near the top.
// Hairline-framed on white with red square markers (stroke grammar, spec §F3).
export default function KeyTakeaways({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <aside className="my-7 border-y-2 border-ink py-4">
      <h2 className="kicker">Key Takeaways</h2>
      <ul className="mt-3 space-y-2.5">
        {items.map((t, i) => (
          <li key={i} className="flex gap-3 font-body text-[1.05rem] leading-snug text-ink">
            <span aria-hidden className="mt-[0.45em] h-1.5 w-1.5 shrink-0 bg-red" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
