import { NextResponse } from "next/server";

const MORPHO_API_URL = "https://api.morpho.org/graphql";
const CHAIN_ID = 8453; // Base mainnet

const VAULTS_QUERY = `
  query GetVaults($chainId: [Int!]) {
    vaults(
      where: { chainId_in: $chainId, totalAssetsUsd_gte: 100 }
      first: 50
      orderBy: TotalAssetsUsd
      orderDirection: Desc
    ) {
      items {
        address
        symbol
        name
        state {
          totalAssetsUsd
          apy
          netApy
          fee
          totalAssets
          curator
        }
        asset {
          address
          symbol
          decimals
        }
      }
    }
  }
`;

export async function GET() {
  try {
    const res = await fetch(MORPHO_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: VAULTS_QUERY,
        variables: { chainId: [CHAIN_ID] },
      }),
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Morpho API returned ${res.status}` },
        { status: 502 },
      );
    }

    const json = await res.json();
    return NextResponse.json(json.data?.vaults?.items || []);
  } catch (err) {
    console.error("[Morpho API] Failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch vaults" },
      { status: 500 },
    );
  }
}
