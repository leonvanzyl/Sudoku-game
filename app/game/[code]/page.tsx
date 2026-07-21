import GameShell from "@/components/GameShell";

export default async function GamePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ solo?: string }>;
}) {
  const [{ code }, { solo }] = await Promise.all([params, searchParams]);
  return <GameShell code={code.toUpperCase()} solo={solo === "1"} />;
}
