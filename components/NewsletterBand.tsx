export default function NewsletterBand() {
  return (
    <section
      id="newsletter"
      className="my-12 rounded-lg bg-navy px-6 py-10 text-center text-white"
    >
      <h2 className="font-serif text-2xl font-bold sm:text-3xl">
        Never miss the story
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-white/70">
        The biggest Hollywood headlines, the best of streaming, and the celebrity
        news that matters — straight to your inbox.
      </p>
      <form
        action="#"
        className="mx-auto mt-5 flex max-w-md gap-2"
        aria-label="Newsletter signup"
      >
        <input
          type="email"
          required
          placeholder="Your email address"
          className="w-full rounded-sm px-4 py-2.5 text-ink"
        />
        <button className="whitespace-nowrap rounded-sm bg-gold px-5 py-2.5 font-bold text-navy hover:bg-gold-600">
          Subscribe
        </button>
      </form>
      <p className="mt-3 text-xs text-white/50">No spam. Unsubscribe anytime.</p>
    </section>
  );
}
