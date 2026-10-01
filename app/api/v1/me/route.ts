import { NextResponse } from "next/server";
import { api, apiSession, meResponse } from "@/lib/api";

/** GET → who's signed in and their workspace (name, assistant's name). */
export const GET = api(async () => NextResponse.json(meResponse(await apiSession())));
