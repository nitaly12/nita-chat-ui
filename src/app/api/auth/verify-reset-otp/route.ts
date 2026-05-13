import axios from "axios";
import { NextRequest, NextResponse } from "next/server";
import { resolveAuthBackendBaseUrl } from "../backendBaseUrl";

const BACKEND_BASE_URL = resolveAuthBackendBaseUrl();

/**
 * Proxies to Spring: POST /api/auth/verify-reset-otp
 * Body: { "email": "...", "otp": "..." }
 * Expected response includes `resetToken` (or `token`) for POST /api/auth/reset-password.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const response = await axios.post(
      `${BACKEND_BASE_URL}/api/auth/verify-otp`,
      body,
      {
        headers: { "Content-Type": "application/json" },
      }
    );
    return NextResponse.json(response.data ?? {}, { status: response.status });
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response) {
      return NextResponse.json(err.response.data ?? {}, {
        status: err.response.status,
      });
    }
    return NextResponse.json(
      { message: "Verify-reset-otp proxy failed" },
      { status: 500 }
    );
  }
}
