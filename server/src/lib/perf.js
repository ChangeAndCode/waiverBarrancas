const ENABLE_PERF_LOGS = String(process.env.ENABLE_PERF_LOGS || "").trim() === "1";

export function nowMs() {
  return Date.now();
}

export function perfLog(event, data = {}) {
  if (!ENABLE_PERF_LOGS) return;
  console.info("[perf]", JSON.stringify({ event, ...data }));
}

