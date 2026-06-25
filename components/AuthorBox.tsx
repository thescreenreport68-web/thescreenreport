import Link from "next/link";
import { getAuthor } from "@/lib/site";

export default function AuthorBox({ author }: { author: string }) {
  const a = getAuthor(author);
  if (!a) return null;
  const initials = a.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);
  return (
    <aside className="mt-10 flex gap-4 rounded-lg border border-navy/10 bg-mist/50 p-5">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-navy font-serif text-lg font-bold text-white">
        {initials}
      </span>
      <div>
        <Link
          href={`/author/${a.slug}/`}
          className="font-serif text-lg font-bold text-navy hover:text-gold-600"
        >
          {a.name}
        </Link>
        <div className="text-xs font-semibold uppercase tracking-wide text-gold-600">
          {a.role}
        </div>
        <p className="mt-2 text-sm text-navy/70">{a.bio}</p>
      </div>
    </aside>
  );
}
