import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authenticateGitHubCode,
  createGitHubAuthorizationUrl,
  loadGitHubOAuthConfig,
  parseGitHubIdentity,
} from "../src/lib/server/github-oauth.ts";
import type { ServerFetch } from "../src/lib/server/bounded-fetch.ts";

const config = {
  origin: "https://hogs.example",
  clientId: "Ov23liExampleClient",
  clientSecret: "0123456789abcdef0123456789abcdef01234567",
  trustedProxyCount: 1,
};

test("GitHub OAuth configuration and authorization URL use the exact callback", () => {
  assert.deepEqual(loadGitHubOAuthConfig({
    NODE_ENV: "production",
    APP_ORIGIN: config.origin,
    GITHUB_CLIENT_ID: config.clientId,
    GITHUB_CLIENT_SECRET: config.clientSecret,
    TRUSTED_PROXY_COUNT: "1",
  }), config);
  const state = "A".repeat(43);
  const url = createGitHubAuthorizationUrl(config, state);
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.pathname, "/login/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), config.clientId);
  assert.equal(url.searchParams.get("redirect_uri"), "https://hogs.example/oauth/github/callback");
  assert.equal(url.searchParams.get("state"), state);
  assert.equal(url.searchParams.has("scope"), false);
  assert.throws(() => createGitHubAuthorizationUrl(config, "guessable"), /state/);
  assert.throws(
    () => loadGitHubOAuthConfig({
      NODE_ENV: "production",
      APP_ORIGIN: config.origin,
      GITHUB_CLIENT_ID: config.clientId,
      TRUSTED_PROXY_COUNT: "1",
    }),
    /GITHUB_CLIENT_SECRET/,
  );
});

test("GitHub identities require a stable numeric ID and valid login", () => {
  assert.deepEqual(parseGitHubIdentity({ id: 583231, login: "octocat" }), {
    id: "583231",
    login: "octocat",
  });
  assert.throws(() => parseGitHubIdentity({ id: 0, login: "octocat" }), /user ID/);
  assert.throws(() => parseGitHubIdentity({ id: 583231, login: "-octocat" }), /login/);
});

test("GitHub code exchange requests identity without retaining the provider token", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: ServerFetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (calls.length === 1) return Response.json({ access_token: "gho_abcdefghijklmnopqrstuvwxyz" });
    return Response.json({ id: 583231, login: "octocat" });
  };
  assert.deepEqual(await authenticateGitHubCode(config, "temporary_code", fetcher), {
    id: "583231",
    login: "octocat",
  });
  assert.equal(calls[0].url, "https://github.com/login/oauth/access_token");
  assert.match(String(calls[0].init?.body), /client_secret=/);
  assert.equal(calls[1].url, "https://api.github.com/user");
  assert.equal(new Headers(calls[1].init?.headers).get("authorization"), "Bearer gho_abcdefghijklmnopqrstuvwxyz");
});
