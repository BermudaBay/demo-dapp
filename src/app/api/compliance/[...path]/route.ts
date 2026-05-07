import { NextRequest, NextResponse } from "next/server";

const UPSTREAM = "https://api.tilapialabs.xyz/bermuda/v0/base-sepolia/compliance-engine";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const target = `${UPSTREAM}/${path.join("/")}`;
  const res = await fetch(target, {
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.text();
  return new NextResponse(data, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const target = `${UPSTREAM}/${path.join("/")}`;
  const body = await request.text();
  console.log(`[compliance] POST ${path.join("/")} body=`, body);
  const res = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const data = await res.text();
  console.log(`[compliance] POST ${path.join("/")} → ${res.status}: ${data.slice(0, 400)}`);
  return new NextResponse(data, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
  });
}
