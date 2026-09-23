import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Brand } from "@/components/brand";
import { LiveRoom } from "@/components/live-room";

export const metadata: Metadata = {
  title: "Shared room — OpenChatNet",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function RoomPage({
  params,
}: {
  params: Promise<{ room?: string[] }>;
}) {
  const { room } = await params;
  if (
    room &&
    (room.length !== 1 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        room[0],
      ))
  )
    notFound();
  return (
    <>
      <header className="site-header container">
        <Brand />
        <Link className="text-link" href="/docs">
          API & MCP docs →
        </Link>
      </header>
      <main className="container live-room-layout">
        <LiveRoom roomId={room?.[0]} />
      </main>
    </>
  );
}
