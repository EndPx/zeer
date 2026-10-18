import { Action, Logo } from "@/components/ui";
export default function NotFound() {
  return (
    <main id="main" className="not-found">
      <Logo />
      <h1>This path is uncharted.</h1>
      <p>The page you requested isn&apos;t here.</p>
      <Action href="/">Back to Zeer</Action>
    </main>
  );
}
