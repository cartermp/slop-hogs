import { randomUUID } from "node:crypto";

export type ActivityOutcome =
  | "success"
  | "rejected"
  | "denied"
  | "rate_limited"
  | "not_found"
  | "failure";

export type LogFields = Record<string, unknown>;

type LogSink = Pick<Console, "info" | "warn" | "error">;

const sensitiveKey = /(?:authorization|cookie|password|secret|token|private[_-]?key|api[_-]?key)/i;
const requestIdPattern = /^[A-Za-z0-9._:/-]{1,128}$/;

function safeValue(value: unknown, key: string, seen: WeakSet<object>): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry, index) => safeValue(entry, String(index), seen));
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([entryKey, entry]) => [entryKey, safeValue(entry, entryKey, seen)]),
  );
}

function safeFields(fields: LogFields): LogFields {
  return safeValue(fields, "", new WeakSet()) as LogFields;
}

function errorFields(error: unknown): LogFields {
  if (!(error instanceof Error)) return { error_type: typeof error, error_message: String(error) };
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  return {
    error_type: error.name,
    error_message: error.message,
    error_code: code,
    error_stack: error.stack,
    error_cause: error.cause instanceof Error
      ? { type: error.cause.name, message: error.cause.message }
      : error.cause,
  };
}

function levelFor(outcome: ActivityOutcome): "info" | "warn" | "error" {
  if (outcome === "success") return "info";
  if (outcome === "failure") return "error";
  return "warn";
}

function deploymentFields(): LogFields {
  return {
    service: process.env.RAILWAY_SERVICE_NAME ?? "slop-hogs",
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "unknown",
    deployment_id: process.env.RAILWAY_DEPLOYMENT_ID ?? process.env.VERCEL_DEPLOYMENT_ID,
    commit_sha: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA,
  };
}

function incomingRequestId(request: Request): string {
  const candidate = request.headers.get("x-request-id") ?? request.headers.get("railway-request-id");
  return candidate && requestIdPattern.test(candidate) ? candidate : randomUUID();
}

function traceId(request: Request): string | undefined {
  const match = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i.exec(
    request.headers.get("traceparent") ?? "",
  );
  return match?.[1];
}

export function httpRequestFields(request: Request, route: string): LogFields {
  const url = new URL(request.url);
  return {
    activity_kind: "http_request",
    request_id: incomingRequestId(request),
    trace_id: traceId(request),
    http_method: request.method,
    http_route: route,
    http_path: url.pathname,
    http_content_type: request.headers.get("content-type") ?? undefined,
    http_content_length: request.headers.get("content-length") ?? undefined,
    user_agent: request.headers.get("user-agent") ?? undefined,
  };
}

export function startServerActivity(
  activity: string,
  initialFields: LogFields = {},
  sink: LogSink = console,
) {
  const startedAt = performance.now();
  const fields = { ...initialFields };
  let emitted = false;

  return {
    add(moreFields: LogFields): void {
      Object.assign(fields, moreFields);
    },
    emit(outcome: ActivityOutcome, finalFields: LogFields = {}, error?: unknown): void {
      if (emitted) throw new Error(`Canonical event already emitted for ${activity}`);
      emitted = true;
      const level = levelFor(outcome);
      const payload = safeFields({
        timestamp: new Date().toISOString(),
        schema_version: 1,
        event: "server.activity",
        level,
        activity,
        outcome,
        duration_ms: Number((performance.now() - startedAt).toFixed(3)),
        ...deploymentFields(),
        ...fields,
        ...finalFields,
        ...(error === undefined ? {} : errorFields(error)),
      });
      sink[level](JSON.stringify(payload));
    },
  };
}

export function logOperationalEvent(
  activity: string,
  outcome: ActivityOutcome,
  fields: LogFields = {},
  error?: unknown,
): void {
  startServerActivity(activity, { activity_kind: "operational", ...fields }).emit(outcome, {}, error);
}
