import { loadCostPolicy } from "./cost-policy.ts";
import { requestSource } from "./hourly-rate-limit.ts";
import { loadTrustedProxyCount } from "./proxy-config.ts";
import { rateLimitKey, TokenBucketRateLimiter } from "./request-limits.ts";

const sourceAdmissionLimiter = new TokenBucketRateLimiter();
const globalAdmissionLimiter = new TokenBucketRateLimiter(1);
const accountSyncLimiter = new TokenBucketRateLimiter();
const accountActionLimiter = new TokenBucketRateLimiter();

export function reserveFarmAdmission(
  request: Request,
  policy: ReturnType<typeof loadCostPolicy>,
): boolean {
  const source = requestSource(request, loadTrustedProxyCount());
  const sourceAllowed = sourceAdmissionLimiter.reserve(
    rateLimitKey("farm", source),
    {
      refillPerMinute: policy.limits.farmRequestsPerIpPerMinute,
      burst: policy.limits.farmRequestBurstPerIp,
    },
  );
  if (!sourceAllowed) return false;
  return globalAdmissionLimiter.reserve("farm", {
    refillPerMinute: policy.limits.farmRequestsGlobalPerMinute,
    burst: policy.limits.farmRequestGlobalBurst,
  });
}

export function reserveFarmSync(
  ownerDid: string,
  policy: ReturnType<typeof loadCostPolicy>,
): boolean {
  return accountSyncLimiter.reserve(ownerDid, {
    refillPerMinute: policy.limits.farmSyncsPerAccountPerMinute,
    burst: policy.limits.farmSyncBurstPerAccount,
  });
}

export function reserveFarmAction(
  ownerDid: string,
  policy: ReturnType<typeof loadCostPolicy>,
): boolean {
  return accountActionLimiter.reserve(ownerDid, {
    refillPerMinute: policy.limits.farmActionsPerAccountPerMinute,
    burst: policy.limits.farmActionBurstPerAccount,
  });
}
