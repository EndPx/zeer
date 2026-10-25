import { redirect } from "next/navigation";

// Production serves /docs from the dedicated documentation release. Keep the
// standalone Next.js fallback on that same maintained guide instead of copying it.
export default function Page() {
  redirect("https://zeer.endpx.cloud/docs/chef/quickstart/");
}
