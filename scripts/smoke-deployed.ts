import assert from "node:assert/strict";

const origin = new URL(process.argv[2] ?? "");
assert.ok(origin.protocol === "https:" || (origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname)), "Use HTTPS, or loopback HTTP for container checks");
assert.ok(!origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === "/", "Supply an origin without credentials, path or query");
for (const [path, status] of [["/api/health", 200], ["/", 200], ["/gallery", 404], ["/owner", 404]] as const) {
  const response = await fetch(new URL(path, origin), { redirect: "error", signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, status, path);
  if (path === "/api/health") {
    assert.deepEqual(await response.json(), {status:"ok"});
    assert.equal(response.headers.get("cache-control"), "no-store");
  } else if (path === "/") {
    const html = await response.text();
    assert.match(html, /SLOP SYSTEMS PRESENTS/);
    assert.match(html, /SIGN IN TO INSERT HOG/);
    assert.doesNotMatch(html, /SLOP SYSTEMS PRESENTS \/\/ \d{4}/);
    assert.doesNotMatch(html, /ROAM THE COMMUNAL FARM|EAT UNVERIFIED AI SLOP|GET BIG\. POP SPECTACULARLY/);
    assert.doesNotMatch(html, /IDENTITY BY BLUESKY|PRESS SIGN IN TO INSERT HOG/);
  }
}
console.log("Deployed shell, health endpoint, gallery restriction and anonymous owner denial passed.");
