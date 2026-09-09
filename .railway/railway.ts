import { defineRailway, project, service } from "railway/iac";

export const partial = "slop-hogs";

export default defineRailway(() => {
  const slopHogs = service("slop-hogs", {
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
  });

  return project("slop-hogs", {
    resources: [slopHogs],
  });
});
