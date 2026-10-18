import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  Braces,
  Database,
  GitBranch,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { Header, HeroArt, Products } from "@/components/interactive";
import { Action, Logo } from "@/components/ui";
import { docs, repo } from "@/lib/content";
import { PrepExplorer } from "@/components/prep-explorer";
import { StackDiagram } from "@/components/stack-diagram";
export default function Home() {
  return (
    <>
      <div className="announcement">
        <span className="mini-tag">Testnet preview</span>
        <span>Public Zcash data, built for your next application.</span>
        <Link href={docs}>
          Get started <ArrowRight size={13} />
        </Link>
      </div>
      <div className="container">
        <Header />
        <main id="main">
          <section className="hero">
            <div className="hero-copy">
              <div className="hero-note">
                <span />
                The open-source Zcash data stack
              </div>
              <h1>
                Zcash data.
                <br />
                <span>Ready to build.</span>
              </h1>
              <p>
                Query public chain data with Prep.
                <br className="desktop-break" /> Turn it into application APIs
                with Chef.
              </p>
              <div className="actions">
                <Action href="/app">Open App</Action>
                <Action href={docs} secondary>
                  Read the docs
                </Action>
              </div>
              <div className="hero-meta">
                <ShieldCheck size={15} /> Public data. Your infrastructure. Your
                rules.
              </div>
            </div>
            <HeroArt />
          </section>
          <div className="capability-strip">
            {[
              [Blocks, "Complete public blocks", "Blocks and transactions, ready to query"],
              [Braces, "TypeScript handlers", "Shape data with your application logic"],
              [Database, "Your PostgreSQL", "Keep your data on your infrastructure"],
              [GitBranch, "GraphQL APIs", "Serve the entities your application needs"],
            ].map(([Icon, label, detail]) => {
              const I = Icon as typeof Blocks;
              return (
                <div key={String(label)}>
                  <I size={22} />
                  <div><strong>{String(label)}</strong><p>{String(detail)}</p></div>
                </div>
              );
            })}
          </div>
          <StackDiagram />
          <section className="section" id="examples">
            <div className="section-heading">
              <span className="eyebrow">Zeer Prep</span>
              <h2>Less searching. More building.</h2>
              <p>Choose the data you need. See exactly how to query it.</p>
            </div>
            <PrepExplorer embedded />
          </section>
          <Products />
          <section className="closing">
            <div>
              <Terminal size={26} />
              <h2>
                Your next Zcash app
                <br />
                starts here.
              </h2>
              <p>From public chain data to your first GraphQL response.</p>
            </div>
            <div className="closing-actions">
              <Action href="/app">Open App</Action>
              <Link href={docs}>
                Or run Chef on your machine <ArrowUpRight size={14} />
              </Link>
            </div>
          </section>
        </main>
        <footer className="site-footer">
          <Logo small />
          <span>Zcash data. Ready to build.</span>
          <nav aria-label="Footer">
            <Link href={docs}>Documentation</Link>
            <Link href={repo}>
              GitHub <ArrowUpRight size={12} />
            </Link>
            <Link href={`${repo}#status`}>Project status</Link>
          </nav>
          <small>© {new Date().getFullYear()} Zeer</small>
        </footer>
      </div>
    </>
  );
}
