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
          Preview release · Linux / WSL2 · Node 24.14+ · packages installed from
          local tarballs
        </div>
        <section>
          <h2>1. Prepare your packages</h2>
          <p>
            Clone the repository and pack both packages. Chef builds during
            packing; the packages are not yet published to npm.
          </p>
          <Code
            code={`git clone ${repo}.git\ncd zeer\nnpm ci\nmkdir -p .tmp/chef-packages\nnpm pack ./packages/prep-client --pack-destination .tmp/chef-packages\nnpm pack ./packages/chef --pack-destination .tmp/chef-packages`}
          />
        </section>
        <section>
          <h2>2. Create an independent project</h2>
          <p>
            Choose a start height your testnet Prep archive covers. The target
            directory must not already exist.
          </p>
          <Code
            code={
              "node packages/chef/dist/cli.js init \\\n  --dir ../my-indexer \\\n  --project my_indexer \\\n  --start-height 0\n\ncd ../my-indexer\nnpm install ../zeer/.tmp/chef-packages/zeer-prep-client-0.1.0.tgz \\\n  ../zeer/.tmp/chef-packages/zeer-chef-0.1.0.tgz\nnpm run codegen\nnpm run typecheck"
            }
          />
        </section>
        <section>
          <h2>3. Connect your data</h2>
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
          <Code code={"npm run db:up\nnpm run migrate\nnpm run status"} />
        </section>
        <section>
          <h2>4. Index, then query</h2>
          <p>
            Set an end height available in Prep. Sync uses an inclusive end;
            Prep queries use an exclusive end. Start the API, then run the query
            command in another terminal.
          </p>
          <Code
            code={
              "npm run sync -- --to 1002\nnpm run serve\n\n# In another terminal\nnpm run query"
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
