import { NextResponse } from "next/server";
import { api, ApiError, apiSession, jsonBody } from "@/lib/api";
import { deleteDeviceToken, saveDeviceToken } from "@/lib/apns";

const TOKEN = /^[0-9a-f]{32,200}$/i;

/** POST { token, environment: "sandbox" | "production" } — the iPhone registering for push. */
export const POST = api(async (request: Request) => {
  const { person } = await apiSession();
  const body = await jsonBody<{ token?: string; environment?: string }>(request);
  if (!body.token || !TOKEN.test(body.token)) throw new ApiError(400, "Send the device token as hex.");
  await saveDeviceToken(person.id, body.token.toLowerCase(), body.environment === "sandbox" ? "sandbox" : "production");
  return NextResponse.json({ ok: true });
});

/** DELETE { token } — signing out on that iPhone: stop pushing to it. */
export const DELETE = api(async (request: Request) => {
  const { person } = await apiSession();
  const body = await jsonBody<{ token?: string }>(request);
  if (body.token && TOKEN.test(body.token)) await deleteDeviceToken(person.id, body.token.toLowerCase());
  return NextResponse.json({ ok: true });
});
