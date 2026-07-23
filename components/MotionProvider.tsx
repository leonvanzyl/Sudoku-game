"use client";

import { LazyMotion, domAnimation } from "framer-motion";

/**
 * App-wide LazyMotion provider. Components render `m.*` (not `motion.*`)
 * elements, so only the ~15 KB `domAnimation` feature bundle ships instead
 * of the full framer-motion runtime. `strict` makes any accidental
 * `motion.*` usage throw in development.
 */
export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  );
}
