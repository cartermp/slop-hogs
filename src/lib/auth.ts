export type AuthProvider = "bluesky" | "github";

export function canShareToBluesky(authProvider: AuthProvider): boolean {
  return authProvider === "bluesky";
}
