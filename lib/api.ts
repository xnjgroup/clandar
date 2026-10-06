/**
 * Helpers for the JSON API the iOS app uses (app/api/v1/…). Unlike pages, these never redirect:
 * no session → 401 JSON; a thrown ApiError → its status and message.
 */
import { NextResponse } from "next/server";
import { currentSession, type SessionInfo } from "@/lib/auth";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The signed-in person (bearer token or cookie), or a 401. */
export async function apiSession(): Promise<SessionInfo> {
  const session = await currentSession();
  if (!session) throw new ApiError(401, "Not signed in.");
  return session;
}

/** Wraps a handler: ApiErrors become `{ error }` with their status; anything else is a 500. */
export function api<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
      console.error("[api]", error);
      return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
    }
  };
}

/** Parses a JSON body, or a 400. */
export async function jsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError(400, "Expected a JSON body.");
  }
}

/** What the app needs to know about who's signed in. */
export function meResponse(session: SessionInfo) {
  return {
    person: session.person,
    org: { id: session.org.id, name: session.org.name, assistantName: session.org.assistantName },
  };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** A route's `[id]`, checked to be a UUID (else 404) — `what` names it in the error. */
export async function idParam(params: Promise<{ id: string }>, what: string): Promise<string> {
  const { id } = await params;
  if (!UUID.test(id)) throw new ApiError(404, `${what} not found.`);
  return id;
}

/** Trimmed string or null; undefined when the key wasn't sent (so PATCH leaves it alone). */
export function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" ? value.trim() : undefined;
}
