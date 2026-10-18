import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="Zeer home"
      className={`logo ${small ? "small" : ""}`}
    >
      <span className="brand-mark" aria-hidden="true">
        <Image
          src="/brand.png"
          width={1536}
          height={1024}
          alt=""
          sizes="320px"
        />
      </span>
      <span>zeer</span>
    </Link>
  );
}
export function Action({
  href,
  children,
  secondary = false,
  external = false,
}: {
  href: string;
  children: ReactNode;
  secondary?: boolean;
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`button ${secondary ? "secondary" : ""}`}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {children}
      <ArrowUpRight size={16} aria-hidden="true" />
    </Link>
  );
}
export function Code({ code }: { code: string }) {
  return (
    <pre className="code" tabIndex={0} aria-label="Code example">
      <code>
        {code.split("\n").map((line, i) => (
          <span className="code-line" key={i}>
            <span className="line-number" aria-hidden="true">
              {i + 1}
            </span>
            <span>
              {line
                .split(
                  /("[^"\n]*"|\b\d+\b|\b(?:async|await|const|import|from|query|return)\b)/g,
                )
                .map((part, j) => (
                  <span
                    key={j}
                    className={
                      part.startsWith('"')
                        ? "syntax-string"
                        : /^\d+$/.test(part)
                          ? "syntax-number"
                          : /^(async|await|const|import|from|query|return)$/.test(
                                part,
                              )
                            ? "syntax-keyword"
                            : undefined
                    }
                  >
                    {part}
                  </span>
                ))}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}
export function Network() {
  return (
    <span className="network">
      <span aria-hidden="true" />
      Zcash Testnet
    </span>
  );
}
