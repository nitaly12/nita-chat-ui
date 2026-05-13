import axios from "axios";
import { NextRequest, NextResponse } from "next/server";
import { resolveAuthBackendBaseUrl } from "../backendBaseUrl";

const BACKEND_BASE_URL = resolveAuthBackendBaseUrl();

const extractToken = (
  data: unknown,
  headers: Record<string, unknown>
): string => {
  // axios (node) returns header keys in lowercase
  const authorizationHeader =
    (headers["authorization"] as string | undefined) ??
    (headers["Authorization"] as string | undefined);

  const fromHeader = (authorizationHeader ?? "").replace(/^Bearer\s+/i, "");

  if (typeof data === "string") {
    return data;
  }

  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const nestedData = record.data as Record<string, unknown> | undefined;
    const nestedPayload = record.payload as Record<string, unknown> | undefined;
    const nestedResult = record.result as Record<string, unknown> | undefined;
    const candidate =
      record.accessToken ??
      record.token ??
      record.jwt ??
      record.access_token ??
      record.access_token ??
      record.idToken ??
      nestedData?.accessToken ??
      nestedData?.token ??
      nestedData?.jwt ??
      nestedPayload?.accessToken ??
      nestedPayload?.token ??
      nestedPayload?.jwt ??
      nestedResult?.accessToken ??
      nestedResult?.token ??
      nestedResult?.jwt;

    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return fromHeader;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const response = await axios.post(
      `${BACKEND_BASE_URL}/api/auth/login`,
      body,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const token = extractToken(
      response.data,
      (response.headers ?? {}) as Record<string, unknown>
    );

    return NextResponse.json({ accessToken: token });
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response) {
      const status = err.response.status;
      const upstream = err.response.data;
      const base =
        typeof upstream === "object" && upstream !== null && !Array.isArray(upstream)
          ? (upstream as Record<string, unknown>)
          : {};
      if (status === 404) {
        return NextResponse.json(
          {
            ...base,
            message:
              (typeof base.message === "string" && base.message.trim()) ||
              `No login endpoint at ${BACKEND_BASE_URL}/api/auth/login. Start Spring on that host or set BACKEND_BASE_URL / NEXT_PUBLIC_API_BASE in .env.local.`,
          },
          { status: 404 }
        );
      }
      return NextResponse.json(upstream ?? {}, { status });
    }
    return NextResponse.json(
      { message: "Login proxy failed" },
      { status: 500 }
    );
  }
}

