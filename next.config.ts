import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Auto-memoizes components/hooks — the codebase relies on this instead of
  // hand-written React.memo/useMemo for most render-skipping.
  reactCompiler: true,
};

export default nextConfig;
