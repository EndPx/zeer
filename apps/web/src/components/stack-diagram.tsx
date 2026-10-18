"use client";
import { useEffect, useRef, useState } from "react";
import { Box, Database, Layers3, PanelsTopLeft } from "lucide-react";

const stages = [
  { name: "Zcash", description: "Public chain data", icon: Box },
  { name: "Prep", description: "Query and filter chain data", icon: Layers3 },
  { name: "Chef", description: "Run your logic and store it", icon: Database },
  { name: "Your app", description: "Build with GraphQL APIs", icon: PanelsTopLeft },
];

export function StackDiagram() {
  const root = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const preference = () => setReduced(media.matches);
    const visibility = () => setHidden(document.hidden);
    preference();
    visibility();
    media.addEventListener("change", preference);
    document.addEventListener("visibilitychange", visibility);
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.25),
      { threshold: 0.25 },
    );
    if (root.current) observer.observe(root.current);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", preference);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  const running = visible && !hidden && !reduced;
  useEffect(() => {
    if (!running) {
      setPhase(0);
      return;
    }
    let timers: ReturnType<typeof setTimeout>[] = [];
    const cycle = () => {
      timers.forEach(clearTimeout);
      setPhase(1);
      timers = [
        setTimeout(() => setPhase(2), 1100),
        setTimeout(() => setPhase(3), 2200),
        setTimeout(() => setPhase(4), 3300),
      ];
    };
    cycle();
    const interval = setInterval(cycle, 6400);
    return () => { clearInterval(interval); timers.forEach(clearTimeout); };
  }, [running]);
  return (
    <section className="stack-section" id="stack" aria-labelledby="stack-title" ref={root} data-phase={phase} data-running={running}>
      <span className="eyebrow">The Zeer stack</span>
      <h2 id="stack-title">Two layers. One developer workflow.</h2>
      <figure className="stack-diagram">
        <ol className="stack-stages">
          {stages.map(({ name, description, icon: Icon }, index) => (
            <li className="stack-stage" key={name} data-active={running && phase === index + 1}>
              <Icon size={32} strokeWidth={1.4} aria-hidden="true" />
              <div>
                <h3>{name}</h3>
                <p>{description}</p>
              </div>
              {index < stages.length - 1 && <span className="stack-arrow" aria-hidden="true"><i className="stack-packet" /></span>}
            </li>
          ))}
        </ol>
        <div className="stack-bypass">
          <svg viewBox="0 0 1000 80" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <marker id="stack-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M1 1 L6 4 L1 7" fill="none" stroke="currentColor" />
              </marker>
            </defs>
            <path d="M365 0 V12 Q365 48 401 48 H869 Q905 48 905 12 V3" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 4" markerEnd="url(#stack-arrowhead)" vectorEffect="non-scaling-stroke" />
            {running && phase === 3 && <circle className="bypass-signal" r="4">
              <animateMotion dur="1.1s" path="M365 0 V12 Q365 48 401 48 H869 Q905 48 905 12 V3" fill="freeze" />
            </circle>}
          </svg>
          <i className="mobile-bypass-signal" aria-hidden="true" />
          <span>Direct API (from Prep)</span>
        </div>
        <figcaption className="sr-only">
          Zcash public data is prepared by Prep. Chef transforms it into application
          entities and GraphQL APIs. Applications can also query Prep directly,
          without passing through Chef.
        </figcaption>
      </figure>
    </section>
  );
}
