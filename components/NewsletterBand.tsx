// One newsletter spec (spec §F6): white ground, 2px ink rules top and bottom,
// display-caps title + italic serif cadence line, hairline input, red button.
export default function NewsletterBand() {
  return (
    <section id="newsletter" className="my-12 border-y-2 border-ink py-8">
      <div className="grid items-center gap-6 lg:grid-cols-2">
        <div>
          <h2 className="sect-head">The Screen Report Daily</h2>
          <p className="sect-tag mt-2">
            Every story that matters in film and TV, each morning.
          </p>
        </div>
        <form
          action="#"
          className="flex w-full max-w-md lg:justify-self-end"
          aria-label="Newsletter signup"
        >
          <input
            type="email"
            required
            placeholder="Your email address"
            className="w-full border border-ink px-3 py-2.5 font-sans text-sm text-ink placeholder:text-gray focus:outline-none"
          />
          <button className="btn-label whitespace-nowrap bg-red px-5 py-2.5 text-paper transition-colors duration-150 hover:bg-red-dark">
            Sign Up
          </button>
        </form>
      </div>
    </section>
  );
}
