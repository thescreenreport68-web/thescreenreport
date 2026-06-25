import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-wide py-24 text-center">
      <p className="font-serif text-6xl font-bold text-navy">404</p>
      <h1 className="mt-3 font-serif text-2xl font-bold text-navy">
        Page not found
      </h1>
      <p className="mt-2 text-navy/60">
        The story you&apos;re looking for may have moved or no longer exists.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-sm bg-navy px-5 py-2.5 font-semibold text-white hover:bg-navy-700"
      >
        Back to homepage
      </Link>
    </div>
  );
}
