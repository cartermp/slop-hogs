import assert from "node:assert/strict";
import { test } from "node:test";
import {
  httpRequestFields,
  startServerActivity,
} from "../src/lib/server/logging.ts";

function capture() {
  const entries: { level: string; line: string }[] = [];
  return {
    entries,
    sink: {
      info: (line: string) => entries.push({ level: "info", line }),
      warn: (line: string) => entries.push({ level: "warn", line }),
      error: (line: string) => entries.push({ level: "error", line }),
    },
  };
}

test("canonical activities emit one wide structured event and redact secrets", () => {
  const { entries, sink } = capture();
  const event = startServerActivity("hog.feed", {
    activity_kind: "server_action",
    actor_did: "did:plc:owner",
    request_id: "care-request",
    session_token: "do-not-log",
    provider: { accessToken: "also-secret", api_key: "still-secret" },
  }, sink);
  event.add({ food: "shitpost", meals_before: 2 });
  event.emit("success", { meals_after: 1, event_types: ["fed", "mutation_discovered"] });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, "info");
  const payload = JSON.parse(entries[0].line);
  assert.equal(payload.schema_version, 1);
  assert.equal(payload.event, "server.activity");
  assert.equal(payload.activity, "hog.feed");
  assert.equal(payload.outcome, "success");
  assert.equal(payload.activity_kind, "server_action");
  assert.equal(payload.actor_did, "did:plc:owner");
  assert.equal(payload.request_id, "care-request");
  assert.equal(payload.session_token, "[REDACTED]");
  assert.deepEqual(payload.provider, {
    accessToken: "[REDACTED]",
    api_key: "[REDACTED]",
  });
  assert.equal(payload.food, "shitpost");
  assert.equal(payload.meals_before, 2);
  assert.equal(payload.meals_after, 1);
  assert.deepEqual(payload.event_types, ["fed", "mutation_discovered"]);
  assert.equal(typeof payload.duration_ms, "number");
  assert.equal(typeof payload.timestamp, "string");
  assert.throws(() => event.emit("success"), /already emitted/);
});

test("failed activities include normalized errors at error level", () => {
  const { entries, sink } = capture();
  const event = startServerActivity("auth.login.start", {}, sink);
  event.emit("failure", { http_status: 503 }, new Error("provider unavailable"));

  const payload = JSON.parse(entries[0].line);
  assert.equal(entries[0].level, "error");
  assert.equal(payload.error_type, "Error");
  assert.equal(payload.error_message, "provider unavailable");
  assert.match(payload.error_stack, /provider unavailable/);
});

test("HTTP request context accepts bounded IDs and never logs query strings", () => {
  const request = new Request("https://hogs.example/api/actors/search?q=secret", {
    headers: {
      "x-request-id": "edge-123",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      "user-agent": "test-agent",
    },
  });
  assert.deepEqual(httpRequestFields(request, "/api/actors/search"), {
    activity_kind: "http_request",
    request_id: "edge-123",
    trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
    http_method: "GET",
    http_route: "/api/actors/search",
    http_path: "/api/actors/search",
    http_content_type: undefined,
    http_content_length: undefined,
    user_agent: "test-agent",
  });
});
