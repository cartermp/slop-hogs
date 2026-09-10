import { defineRailway, github, preserve, project, service } from "railway/iac";

export const partial = "slop-hogs";

export default defineRailway(() => {
  const slopHogs = service("slop-hogs", {
    source: github("cartermp/slop-hogs", {
      branch: "main",
      autoDeploy: false,
    }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    deploy: {
      startCommand: "sh scripts/start-production.sh",
      preDeployCommand: ["npm run policy:check && npm run db:migrate"],
      healthcheckPath: "/api/health",
      healthcheckTimeout: 60,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 2,
      numReplicas: 1,
      limitOverride: {
        containers: {
          cpu: 0.5,
          memoryBytes: 1_000_000_000,
        },
      },
    },
    env: {
      DATABASE_URL: preserve(),
      APP_ORIGIN: preserve(),
      BLUESKY_INVITED_DIDS: preserve(),
      NEXT_TELEMETRY_DISABLED: preserve(),
      NODE_ENV: preserve(),
      OAUTH_ENCRYPTION_KEY: preserve(),
      OAUTH_KEY_ID: preserve(),
      OAUTH_PRIVATE_KEY: preserve(),
      PORT: preserve(),
      SLOP_HOGS_OWNER_DIDS: preserve(),
      TRUSTED_PROXY_COUNT: preserve(),
    },
  });

  return project("slop-hogs", {
    resources: [slopHogs],
  });
});
