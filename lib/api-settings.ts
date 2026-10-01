import { ApiError } from "@/lib/api";
import type { SessionInfo } from "@/lib/auth";

/** Settings changes are the owner's (like the website's Settings page). */
export function requireOwner(session: SessionInfo): void {
  if (session.person.role !== "owner") throw new ApiError(403, "Only an owner can change this.");
}
