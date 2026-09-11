import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { loadCostPolicy } from "@/lib/server/cost-policy";
import { getDatabase } from "@/lib/server/database";
import { getAppSession } from "@/lib/server/hogs";
import { getOwnerOperations } from "@/lib/server/operations";
import { parseOwnerDids } from "@/lib/server/oauth-config";

export const metadata: Metadata = {
  title: "Operations | Slop Hogs",
  robots: { index: false, follow: false },
};

const bytes = new Intl.NumberFormat("en", {
  style: "unit",
  unit: "megabyte",
  maximumFractionDigits: 1,
});

function formatBytes(value: number): string {
  return bytes.format(value / 1_000_000);
}

function formatDate(value: Date | null): string {
  return value ? value.toISOString() : "Never";
}

export default async function OwnerPage() {
  const token = (await cookies()).get("slop_hogs_session")?.value;
  const session = token ? await getAppSession(getDatabase(), token) : null;
  const owners = parseOwnerDids(process.env.SLOP_HOGS_OWNER_DIDS);
  if (!session || !owners.has(session.ownerDid)) notFound();

  const policy = loadCostPolicy();
  const operations = await getOwnerOperations(getDatabase(), {
    database: policy.database,
    readOnlyMode: policy.features.readOnlyMode,
  });

  return (
    <main className="owner-page">
      <p className="eyebrow">Owner operations</p>
      <h1>Launch controls</h1>
      <p className="note">Application safeguards only. Confirm provider billing, resource ceilings, backups, and current usage in Railway.</p>

      {operations.storage.warning && (
        <p className="operations-warning">
          Database storage is at {operations.storage.usedPercent}% of the internal budget.
          {operations.storage.readOnly ? " State changes are blocked." : " New cards may be blocked."}
        </p>
      )}

      <section className="operations-grid" aria-label="Operational status">
        <article>
          <h2>Database</h2>
          <dl>
            <div><dt>Measured size</dt><dd>{formatBytes(operations.storage.databaseSizeBytes)}</dd></div>
            <div><dt>Internal budget</dt><dd>{formatBytes(policy.database.maxBytes)}</dd></div>
            <div><dt>Budget used</dt><dd>{operations.storage.usedPercent}%</dd></div>
            <div><dt>Measured at</dt><dd>{formatDate(operations.storage.measuredAt)}</dd></div>
            <div><dt>Read-only</dt><dd>{operations.storage.readOnly ? "On" : "Off"}</dd></div>
          </dl>
        </article>
        <article>
          <h2>Current quota use</h2>
          <dl>
            <div><dt>Accounts</dt><dd>{operations.accountCount}</dd></div>
            <div><dt>Logins this hour</dt><dd>{operations.loginAttemptsThisHour} / {policy.limits.loginAttemptsGlobalPerHour}</dd></div>
            <div><dt>Post lookups this hour</dt><dd>{operations.postLookupsThisHour} / {policy.limits.postLookupsGlobalPerHour}</dd></div>
            <div><dt>Visitor treats today</dt><dd>{operations.giftsToday}</dd></div>
            <div><dt>Pending visitor treats</dt><dd>{operations.pendingGifts}</dd></div>
            <div><dt>Gift limits</dt><dd>{policy.limits.giftsPerSenderPerDay} sent / {policy.limits.giftsPerRecipientPerDay} received daily</dd></div>
            <div><dt>Cards today</dt><dd>{operations.cardsToday} / {policy.limits.cardsGlobalPerDay}</dd></div>
            <div><dt>Stored cards</dt><dd>{formatBytes(operations.cardStorageBytes)} / {formatBytes(policy.limits.cardStorageMaxBytes)}</dd></div>
          </dl>
        </article>
        <article>
          <h2>Feature flags</h2>
          <dl>
            {Object.entries(policy.features).map(([name, enabled]) => (
              <div key={name}><dt>{name}</dt><dd>{enabled ? "On" : "Off"}</dd></div>
            ))}
            <div><dt>Cards blocked</dt><dd>{operations.storage.cardsBlocked ? "Yes" : "No"}</dd></div>
          </dl>
        </article>
        <article>
          <h2>Backup restore</h2>
          <dl>
            <div><dt>Prepared</dt><dd>{formatDate(operations.backupPreparedAt)}</dd></div>
            <div><dt>Last verified</dt><dd>{formatDate(operations.backupVerifiedAt)}</dd></div>
            <div><dt>Restored size</dt><dd>{operations.restoredDatabaseSizeBytes === null ? "Not verified" : formatBytes(operations.restoredDatabaseSizeBytes)}</dd></div>
          </dl>
        </article>
      </section>

      <p className="operations-links">
        <a href="https://railway.com/dashboard" rel="noreferrer">Open Railway dashboard</a>
        <Link href="/">Return to your hog</Link>
      </p>
    </main>
  );
}
