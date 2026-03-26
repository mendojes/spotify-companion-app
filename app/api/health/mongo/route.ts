import { getDatabase, getMongoDiagnostics, testMongoConnection } from "@/lib/mongodb";

const CONNECTED_USERS_COLLECTION = "connected_users";
const SNAPSHOT_HISTORY_COLLECTION = "spotify_snapshots_history";
const HEALTHCHECK_COLLECTION = "_healthchecks";

type HealthcheckDocument = {
  _id: string;
  createdAt: string;
  source: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function runStep(label: string, action: () => Promise<unknown>) {
  const startedAt = Date.now();

  try {
    const result = await action();
    return {
      label,
      ok: true,
      latencyMs: Date.now() - startedAt,
      result,
      error: null,
    };
  } catch (error) {
    return {
      label,
      ok: false,
      latencyMs: Date.now() - startedAt,
      result: null,
      error: getErrorMessage(error),
    };
  }
}

export async function GET() {
  const ping = await testMongoConnection();
  const diagnostics = getMongoDiagnostics();
  const db = await getDatabase({ forceRetry: true });

  if (!db) {
    return Response.json(
      {
        status: "degraded",
        timestamp: new Date().toISOString(),
        mongo: {
          ...diagnostics,
          ping,
          operations: [],
        },
      },
      { status: 503 },
    );
  }

  const probeId = `healthcheck:${Date.now()}`;
  const operations = await Promise.all([
    runStep("connected_users.findOne", async () => {
      const doc = await db.collection(CONNECTED_USERS_COLLECTION).findOne({}, { projection: { spotifyUserId: 1, updatedAt: 1 } });
      return doc ? { found: true } : { found: false };
    }),
    runStep("spotify_snapshots_history.find.limit(1)", async () => {
      const docs = await db.collection(SNAPSHOT_HISTORY_COLLECTION).find({}, { projection: { spotifyUserId: 1, fetchedAt: 1 } }).limit(1).toArray();
      return { count: docs.length };
    }),
    runStep("_healthchecks.upsert+delete", async () => {
      await db.collection<HealthcheckDocument>(HEALTHCHECK_COLLECTION).updateOne(
        { _id: probeId },
        { $set: { createdAt: new Date().toISOString(), source: "mongo-health-route" } },
        { upsert: true },
      );
      await db.collection<HealthcheckDocument>(HEALTHCHECK_COLLECTION).deleteOne({ _id: probeId });
      return { wrote: true, cleanedUp: true };
    }),
  ]);

  const allOk = ping.reachable && operations.every((operation) => operation.ok);

  return Response.json(
    {
      status: allOk ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      mongo: {
        ...diagnostics,
        ping,
        operations,
      },
    },
    { status: allOk ? 200 : 503 },
  );
}

