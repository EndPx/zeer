"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  Copy,
  Database,
  Layers3,
  Menu,
  ShieldCheck,
  X,
} from "lucide-react";
import { Action, Code, Logo } from "./ui";
import { chefCode, docs, prepQuery, repo } from "@/lib/content";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [feedback, setFeedback] = useState({ text: "", message: "" });
  const message = feedback.text === text ? feedback.message : "";
  return (
    <button
      className="copy"
      disabled={!text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setFeedback({ text, message: "Copied" });
        } catch {
          setFeedback({ text, message: "Select and copy the code" });
        }
      }}
    >
      <span aria-hidden="true">
        {message === "Copied" ? <Check size={14} /> : <Copy size={14} />}
      </span>
      <span aria-live="polite">{message || label}</span>
    </button>
  );
}
export function Header() {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  return (
    <header
      className="site-header"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          menuButton.current?.focus();
        }
      }}
    >
      <Logo />
      <nav aria-label="Main navigation" className={open ? "open" : ""}>
        <Link href="/#products" onClick={() => setOpen(false)}>
          Products
        </Link>
        <Link href={docs}>
          Developers <ArrowUpRight size={12} />
        </Link>
        <Link href={repo}>
          GitHub <ArrowUpRight size={12} />
        </Link>
      </nav>
      <Action href="/app">Open App</Action>
      <button
        className="icon-button mobile-menu"
        ref={menuButton}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        {open ? <X /> : <Menu />}
      </button>
    </header>
  );
}
export function HeroArt() {
  const root = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false),
    [reduced, setReduced] = useState(true),
    [hidden, setHidden] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    change();
    media.addEventListener("change", change);
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    if (root.current) observer.observe(root.current);
    const visibility = () => setHidden(document.hidden);
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      media.removeEventListener("change", change);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const playing = visible && !reduced && !hidden;
  return (
    <div
      className={`hero-art ${playing ? "animated" : ""}`}
      ref={root}
    >
      <div className="hero-stage-backdrop" aria-hidden="true">
        <div className="hero-stage-haze" />
        <div className="hero-floor" />
        <div className="hero-floor-light" />
        <div className="hero-floor-reflection">
          <Image src="/hero-zeer-mark.png" width={1280} height={1280} alt="" sizes="(max-width: 540px) calc(100vw - 40px), (max-width: 800px) 440px, (max-width: 1200px) 44vw, 560px" />
        </div>
        <div className="hero-ground-shadow" />
      </div>
      <div className="hero-object">
      <Image
        className="hero-sculpture"
        src="/hero-zeer-mark.png"
        width={1280}
        height={1280}
        alt=""
        priority
        fetchPriority="high"
        sizes="(max-width: 540px) calc(100vw - 40px), (max-width: 800px) 440px, (max-width: 1200px) 44vw, 560px"
      />
      {playing && <svg className="hero-data-channel" viewBox="0 0 1280 1280" aria-hidden="true">
        {[0, 0.45, 0.9].map((delay, index) => (
          <rect key={delay} x={index === 1 ? -4 : -18} y={index === 1 ? -4 : -1.5} width={index === 1 ? 8 : 36} height={index === 1 ? 8 : 3} rx="1" opacity="0">
            <animateMotion path={`M155 ${988 + index * 5} L1145 ${418 + index * 5}`} rotate="auto" begin={`${delay}s`} dur="3.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.9;1" begin={`${delay}s`} dur="3.2s" repeatCount="indefinite" />
          </rect>
        ))}
      </svg>}
      </div>
    </div>
  );
}
const productData = {
  chef: {
    name: "Zeer Chef",
    tag: "Your logic. Your database. Your API.",
    body: "Turn public Zcash data into the entities your application needs.",
    features: [
      [
        "Write your logic in TypeScript",
        "Typed handlers transform blocks and transactions.",
      ],
      [
        "Keep your own PostgreSQL",
        "Your schema, your data, your infrastructure.",
      ],
      [
        "Serve it through GraphQL",
        "An authenticated API over your indexed entities.",
      ],
    ],
    code: chefCode,
    file: "chef.config.ts — handler excerpt",
    url: docs,
  },
  prep: {
    name: "Zeer Prep",
    tag: "The data you need. Ready to query.",
    body: "Access complete public Zcash blocks and transactions through a focused API.",
    features: [
      [
        "Choose your block range",
        "Page through a captured range of available history.",
      ],
      [
        "Select just the fields you need",
        "Keep responses focused on your application.",
      ],
      ["Build your own pipeline", "Use Prep directly, with or without Chef."],
    ],
    code: JSON.stringify(prepQuery("headers", 1000, 1003), null, 2),
    file: "POST /query — example request",
    url: `${repo}/blob/main/docs/PREP_QUERY.md`,
  },
};
export function Products() {
  const [selected, setSelected] = useState<"chef" | "prep">("chef");
  const data = productData[selected];
  return (
    <section className="section products" id="products">
      <div className="section-heading">
        <span className="eyebrow">Choose your layer</span>
        <h2>From Zcash data to your application.</h2>
        <p>Build your API with Chef, or query chain data directly with Prep.</p>
      </div>
      <div className="product-switch" aria-label="Choose a product" data-product={selected}>
        {(["chef", "prep"] as const).map((id) => (
          <button
            key={id}
            aria-pressed={selected === id}
            onClick={() => setSelected(id)}
          >
            {id === "chef" ? <Braces size={17} /> : <Layers3 size={17} />}Zeer{" "}
            {id === "chef" ? "Chef" : "Prep"}
          </button>
        ))}
      </div>
      <div className="product-layout" key={selected}>
        <div>
          <div className="product-intro">
            <h3>{data.name}</h3>
            <p>{data.body}</p>
          </div>
          <div className="feature-list">
            {data.features.map(([title, body], i) => (
              <div key={title}>
                <span className="feature-icon">
                  {i === 0 ? (
                    <Braces size={18} />
                  ) : i === 1 ? (
                    <Database size={18} />
                  ) : (
                    <ShieldCheck size={18} />
                  )}
                </span>
                <div>
                  <h4>{title}</h4>
                  <p>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="code-panel">
            <div className="panel-toolbar">
              <span>{data.file}</span>
              <CopyButton text={data.code} />
            </div>
            <Code code={data.code} />
            <div className="panel-foot">
              {selected === "chef"
                ? "Handler excerpt · public-data example"
                : "Example query · to_block is exclusive"}
            </div>
          </div>
          <div className="product-links">
            <Link href={data.url}>
              Documentation <ArrowUpRight size={14} />
            </Link>
            <Link href={`/app/${selected}`}>
              Open playground <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
