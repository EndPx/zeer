"use client";
import Link from "next/link";
import {
  ArrowRight,
  Braces,
  Database,
  GitBranch,
  Layers3,
  ShieldCheck,
} from "lucide-react";
import { docs } from "@/lib/content";
import { NetworkStatus } from "./network-status";
import { useConsoleStatus } from "@/lib/use-console-status";
export function Overview() {
  const { status, loading, error, refresh } = useConsoleStatus();
  return (
    <>
      <div className="console-title">
        <span className="eyebrow">Overview</span>
        <h1>Your data, from source to API.</h1>
        <p>Inspect coverage, query Prep, and explore your Chef entities.</p>
      </div>
      <NetworkStatus status={status} loading={loading} error={error} refresh={() => void refresh()} />
      <div className="console-flow">
        {[
          [Layers3, "Prep archive", "Blocks & transactions"],
          [Braces, "Chef handlers", "Your TypeScript"],
          [Database, "PostgreSQL", "Application data"],
          [GitBranch, "GraphQL", "Query API"],
        ].map(([Icon, name, description], i) => {
          const I = Icon as typeof Layers3;
          return (
            <div className="console-flow-item" key={String(name)}>
              <I size={22} />
              <div>
                <strong>{String(name)}</strong>
                <small>{String(description)}</small>
              </div>
              {i < 3 && <ArrowRight className="flow-arrow" size={20} />}
            </div>
          );
        })}
      </div>
      <div className="console-products">
        {[
          {
            name: "Prep",
            icon: Layers3,
            text: "Query blocks and transactions.",
            body: "Choose a range, select fields, and retrieve the public data your application needs.",
            href: "/app/prep",
            label: "Range filters · Field selection · Batch lookup",
          },
          {
            name: "Chef",
            icon: Braces,
            text: "Query your application entities.",
            body: "Explore the GraphQL API built from your schema, handlers, and PostgreSQL database.",
            href: "/app/chef",
            label: "TypeScript · PostgreSQL · GraphQL",
          },
        ].map(({ name, icon: Icon, text, body, href, label }) => (
          <article key={name}>
            <Icon size={27} />
            <h2>Zeer {name}</h2>
            <h3>{text}</h3>
            <p>{body}</p>
            <span className="product-detail">{label}</span>
            <Link href={href} className="button secondary">
              Open {name} Playground <ArrowRight size={15} />
            </Link>
          </article>
        ))}
      </div>
      <div className="own-project">
        <div>
          <strong>Make it your own.</strong>
          <p>Run Chef on your machine. Bring your schema and your database.</p>
        </div>
        <Link href={docs} className="text-link">
          Developer quickstart <ArrowRight size={16} />
        </Link>
      </div>
      <p className="privacy-note">
        <ShieldCheck size={15} /> Public data only. Viewing keys and private
        memo scanning are outside this preview.
      </p>
    </>
  );
}
