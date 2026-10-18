"use client";
import { useEffect } from "react";
export function DevTools() {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      void import("react-grab");
      void import("react-scan").then(({ scan }) =>
        scan({ enabled: true, showToolbar: false }),
      );
    }
  }, []);
  return null;
}
