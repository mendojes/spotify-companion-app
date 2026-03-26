import { getMongoDiagnostics, testMongoConnection } from "@/lib/mongodb";

export async function GET() {
  const mongoPing = await testMongoConnection();

  return Response.json({
    status: mongoPing.reachable ? "ok" : "degraded",
    app: "SoundScope",
    timestamp: new Date().toISOString(),
    mongo: {
      ...getMongoDiagnostics(),
      ping: mongoPing,
    },
  });
}
