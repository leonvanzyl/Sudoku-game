import GameShell from "@/components/GameShell";

export default async function GamePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <GameShell code={code.toUpperCase()} />;
}
