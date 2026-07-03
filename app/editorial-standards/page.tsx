import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Editorial Standards",
  description:
    "How The Screen Report researches, writes, sources images and ensures accuracy — including our use of AI with human oversight.",
};

export default function EditorialStandardsPage() {
  return (
    <div className="container-wide max-w-prose py-12">
      <h1 className="font-serif text-4xl font-bold text-ink">
        Editorial Standards
      </h1>
      <div className="prose prose-screen mt-6 max-w-none">
        <p>
          The Screen Report is committed to accuracy, fairness and transparency.
          These standards govern everything we publish.
        </p>

        <h2>AI-assisted reporting, with human oversight</h2>
        <p>
          The Screen Report operates an AI-assisted newsroom. We use artificial
          intelligence to help monitor the news, research topics, draft articles and
          check facts at speed. Editorial standards, sourcing rules and final
          accountability remain human. We never publish fabricated quotes, invented
          sources or made-up events, and we do not present AI-generated images as
          real photographs of real events.
        </p>

        <h2>Sourcing and accuracy</h2>
        <p>
          We base reporting on credible, verifiable sources and aim to corroborate
          significant claims across multiple outlets. Facts such as names, dates and
          figures are checked against authoritative references. When information is
          unconfirmed, we say so clearly and attribute it to its source.
        </p>

        <h2>Handling sensitive claims</h2>
        <p>
          For sensitive subjects — legal matters, relationships, health or
          allegations — we use careful framing: confirmed facts are stated plainly,
          official records are attributed as such, and reported-but-unconfirmed
          claims are attributed to the originating outlet and clearly labeled as
          reports, including any relevant denial or response.
        </p>

        <h2>Images</h2>
        <p>
          We source images legally — from properly licensed providers, studio press
          materials, public-domain and Creative Commons libraries, and official
          embeds — and we credit them. We do not use photographs we are not licensed
          to publish.
        </p>

        <h2>Corrections and independence</h2>
        <p>
          When we get something wrong, we fix it and note the change — see our{" "}
          <a href="/corrections/">Corrections</a> policy. Our editorial decisions are
          independent of advertisers and partners; affiliate and sponsored content is
          labeled. Read more about ownership and funding on our{" "}
          <a href="/ethics/">Ethics &amp; Ownership</a> page.
        </p>
      </div>
    </div>
  );
}
