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
    },
    env: {
      DATABASE_URL: preserve(),
      NEXT_TELEMETRY_DISABLED: preserve(),
      NODE_ENV: preserve(),
      PORT: preserve(),
    },
  });

  return project("slop-hogs", {
    resources: [slopHogs],
  });
});
