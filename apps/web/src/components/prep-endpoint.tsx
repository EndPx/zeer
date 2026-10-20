"use client";
import { CopyButton } from "./interactive";
import { useAppOrigin } from "@/lib/use-app-origin";

export function PrepEndpoint() {
  const endpoint = `${useAppOrigin()}/api/prep`;
  return <div className="notice public-endpoint">
    <span>Public testnet API<code>{endpoint}</code></span>
    <CopyButton text={endpoint} label="Copy endpoint" />
  </div>;
}
