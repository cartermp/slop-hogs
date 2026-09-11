import { createBoundedFetch, type ServerFetch } from "./bounded-fetch.ts";
import { loadCostPolicy } from "./cost-policy.ts";
import { parseAppOrigin } from "./oauth-config.ts";
import { loadTrustedProxyCount } from "./proxy-config.ts";

const githubLoginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export interface GitHubOAuthConfig {
  origin: string;
  clientId: string;
  clientSecret: string;
  trustedProxyCount: number;
}

export interface GitHubIdentity {
  id: string;
  login: string;
}

export function isValidGitHubLogin(value: string): boolean {
  return githubLoginPattern.test(value);
}

export function loadGitHubOAuthConfig(env: NodeJS.ProcessEnv = process.env): GitHubOAuthConfig {
  const clientId = env.GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_CLIENT_SECRET;
  if (!clientId || !/^[A-Za-z0-9_]{1,255}$/.test(clientId)) {
    throw new Error("GITHUB_CLIENT_ID is required and must be a valid client ID");
  }
  if (!clientSecret || !/^[A-Za-z0-9]{1,255}$/.test(clientSecret)) {
    throw new Error("GITHUB_CLIENT_SECRET is required and must be a valid client secret");
  }
  return {
    origin: parseAppOrigin(env.APP_ORIGIN, env.NODE_ENV === "production"),
    clientId,
    clientSecret,
    trustedProxyCount: loadTrustedProxyCount(env),
  };
}

export function createGitHubAuthorizationUrl(config: GitHubOAuthConfig, state: string): URL {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error("Invalid GitHub OAuth state");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", `${config.origin}/oauth/github/callback`);
  url.searchParams.set("state", state);
  return url;
}

export function parseGitHubIdentity(value: unknown): GitHubIdentity {
  if (typeof value !== "object" || value === null) throw new Error("GitHub returned an invalid user");
  const user = value as Record<string, unknown>;
  if (!Number.isSafeInteger(user.id) || (user.id as number) <= 0) {
    throw new Error("GitHub returned an invalid user ID");
  }
  if (typeof user.login !== "string" || !isValidGitHubLogin(user.login)) {
    throw new Error("GitHub returned an invalid login");
  }
  return { id: String(user.id), login: user.login };
}

function parseAccessToken(value: unknown): string {
  if (typeof value !== "object" || value === null) throw new Error("GitHub returned an invalid access token");
  const result = value as Record<string, unknown>;
  if (typeof result.access_token !== "string" || result.access_token.length < 20 || result.access_token.length > 512) {
    throw new Error("GitHub did not return an access token");
  }
  return result.access_token;
}

async function readJson(response: Response, operation: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${operation} failed with status ${response.status}`);
  return response.json() as Promise<unknown>;
}

export async function authenticateGitHubCode(
  config: GitHubOAuthConfig,
  code: string,
  fetcher?: ServerFetch,
): Promise<GitHubIdentity> {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(code)) throw new Error("Invalid GitHub authorization code");
  const limits = loadCostPolicy().limits;
  const request = fetcher ?? createBoundedFetch(limits.externalRequestTimeoutMs, limits.externalResponseMaxBytes);
  const tokenResponse = await request("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: `${config.origin}/oauth/github/callback`,
    }),
  });
  const accessToken = parseAccessToken(await readJson(tokenResponse, "GitHub token exchange"));
  const userResponse = await request("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "slop-hogs",
      "x-github-api-version": "2026-03-10",
    },
  });
  return parseGitHubIdentity(await readJson(userResponse, "GitHub user lookup"));
}
