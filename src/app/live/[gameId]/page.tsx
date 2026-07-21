import LiveGameView from "@/components/LiveGameView";

export default async function LiveGamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return <LiveGameView gameId={gameId.toUpperCase()} />;
}
