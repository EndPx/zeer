import { ConsoleShell } from "@/components/console-shell";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleShell>
      {process.env.ZEER_DEMO_LABEL && (
        <div className="notice">{process.env.ZEER_DEMO_LABEL}</div>
      )}
      {children}
    </ConsoleShell>
  );
}
