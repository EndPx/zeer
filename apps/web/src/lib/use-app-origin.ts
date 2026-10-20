"use client";
import { useEffect, useState } from "react";
import { publicPrepApi } from "./content";

export function useAppOrigin() {
  const [origin, setOrigin] = useState(publicPrepApi.replace(/\/api\/prep$/, ""));
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}
