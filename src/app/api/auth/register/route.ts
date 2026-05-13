import axios from "axios";
import { NextRequest, NextResponse } from "next/server";
import { resolveAuthBackendBaseUrl } from "../backendBaseUrl";

const BACKEND_BASE_URL = resolveAuthBackendBaseUrl();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const response = await axios.post(
      `${BACKEND_BASE_URL}/api/auth/register`,
      body,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    return NextResponse.json({ ok: true, data: response.data });
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response) {
      return NextResponse.json(err.response.data ?? {}, {
        status: err.response.status,
      });
    }
    return NextResponse.json(
      { message: "Register proxy failed" },
      { status: 500 }
    );
  }
}

