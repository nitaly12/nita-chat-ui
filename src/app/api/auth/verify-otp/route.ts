import axios from "axios";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_BASE_URL = (
  process.env.BACKEND_BASE_URL ??
  process.env.NEXT_PUBLIC_SOCKET_URL ??
  "http://localhost:8080"
).replace(/\/+$/, "");

/** Proxies to Spring: POST /api/auth/verify-otp { "email": "...", "otp": "..." } */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const response = await axios.post(`${BACKEND_BASE_URL}/api/auth/verify-otp`, body, {
      headers: { "Content-Type": "application/json" },
    });
    return NextResponse.json(response.data ?? {}, { status: response.status });
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response) {
      return NextResponse.json(err.response.data ?? {}, {
        status: err.response.status,
      });
    }
    return NextResponse.json({ message: "Verify-otp proxy failed" }, { status: 500 });
  }
}
