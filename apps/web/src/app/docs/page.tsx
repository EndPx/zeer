import Link from "next/link";
import { Header } from "@/components/interactive";
import { Action, Code } from "@/components/ui";
import { repo, publicPrepApi } from "@/lib/content";
export const metadata = { title: "Developer quickstart" };
export default function Page() {
  return (
    <div className="container">
      <Header />
      <main id="main" className="docs-page">
        <span className="eyebrow">Developer quickstart</span>
        <h1>Your first Chef project.</h1>
        <p className="docs-lead">
          Run Chef in your environment. Connect a Prep source. Turn public Zcash
          data into your own GraphQL API.
        </p>
        <div className="notice">
          Developer preview · Linux / WSL2 · Node 24.14+ · install from npm
        </div>
        <p><Link className="text-link" href={`${repo}/blob/main/docs/HACKATHON_DEMO.md`}>Public demo walkthrough ↗</Link>{" · "}<Link className="text-link" href={`${repo}/tree/main/examples/chef-hackathon`}>Run the bounded testnet demo ↗</Link></p>
        <section>
          <h2>1. Create your indexer</h2>
          <p>
            Choose a new directory and project name. This command creates the
            schema, TypeScript handlers and example GraphQL query.
          </p>
          <Code
            code={"npx @zeer-dev/chef@0.1.0 init --dir my-indexer --project my_indexer --start-height 0\ncd my-indexer\nnpm install\nnpm run codegen\nnpm run typecheck"}
          />
        </section>
        <section>
          <h2>2. Connect your data</h2>
          <p>
            Edit the generated, git-ignored <code>.env</code>: set your actual{" "}
            <code>PREP_URL</code>, optional Prep token, and PostgreSQL{" "}
            <code>DATABASE_URL</code>. Use the public testnet endpoint below or
            your own Prep source. Check its current coverage before indexing;
            the preview requires no personal API token.
          </p>
          <Code code={`PREP_URL=${publicPrepApi}\nPREP_API_TOKEN=`} />
          <a className="text-link" href={`${publicPrepApi}/height`} target="_blank" rel="noreferrer">Check current coverage ↗</a>
          <p>
            The starter includes optional PostgreSQL via Docker Compose. Skip
            this command when using an existing database.
          </p>
          <Code code={"npm run db:up"} />
          <p>With either database option, initialize the project's tables:</p>
          <Code code={"npm run migrate\nnpm run status"} />
        </section>
        <section>
          <h2>3. Serve while indexing</h2>
          <p>
            Set an end height available in Prep. Sync uses an inclusive end;
            Prep queries use an exclusive end. Start the API first, then index
            and query in separate terminals. GraphQL reads the committed prefix
            while indexing continues; _meta.height reports that checkpoint.
          </p>
          <Code
            code={
              "# Terminal 1\nnpm run serve\n\n# Terminal 2: blocks 0 and 1\nnpm run sync -- --to 1\n\n# Terminal 3\nnpm run query"
            }
          />
          <p>
            Use <code>npm run follow</code> for ongoing indexing. Restart
            resumes your persisted checkpoint. Keep tokens server-side, and use
            a fresh project namespace when changing schema or handler identity.
          </p>
        </section>
        <section className="docs-bottom">
          <h2>Explore before you integrate.</h2>
          <p>
            The console keeps source coverage, application progress, and query
            results visible.
          </p>
          <Action href="/app">Open App</Action>
          <Link
            className="text-link"
            href={`${repo}/blob/main/docs/OPERATIONS.md`}
          >
            Read the operations guide
          </Link>
        </section>
      </main>
    </div>
  );
}
