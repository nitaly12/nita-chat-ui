import axios from "axios";
import { NextRequest, NextResponse } from "next/server";
import { resolveAuthBackendBaseUrl } from "../backendBaseUrl";

const BACKEND_BASE_URL = resolveAuthBackendBaseUrl();

/**
 * Proxies to Spring: PUT /api/auth/change-password
 * Body: { "currentPassword": "...", "newPassword": "..." }
 * Forwards Authorization: Bearer … to the backend.
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const authorization = req.headers.get("authorization");
    const response = await axios.put(
      `${BACKEND_BASE_URL}/api/auth/change-password`,
      body,
      {
        headers: {
          "Content-Type": "application/json",
          ...(authorization ? { Authorization: authorization } : {}),
        },
      }
    );
    return NextResponse.json(response.data ?? { ok: true }, {
      status: response.status,
    });
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response) {
      return NextResponse.json(err.response.data ?? {}, {
        status: err.response.status,
      });
    }
    return NextResponse.json(
      { message: "Change-password proxy failed" },
      { status: 500 }
    );
  }
}
