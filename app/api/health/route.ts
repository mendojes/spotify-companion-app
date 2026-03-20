export async function GET() {
  return Response.json({
    status: "ok",
    app: "SoundScope",
    timestamp: new Date().toISOString(),
  });
}
