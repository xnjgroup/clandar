import { NextResponse } from "next/server";
import { api, apiSession } from "@/lib/api";
import { assetStats, listAssets, listLocations, locationStats, vendorDirectory } from "@/lib/queries";

/** GET → vendors (with spend), assets and locations (first 100 each, with their stats). */
export const GET = api(async () => {
  const { org } = await apiSession();
  const [vendors, assets, assetSummary, locations, locationSummary] = await Promise.all([
    vendorDirectory(org.id),
    listAssets(org.id, { type: "All types", region: "", search: "", page: 0, size: 100 }),
    assetStats(org.id),
    listLocations(org.id, { search: "", page: 0, size: 100 }),
    locationStats(org.id),
  ]);
  return NextResponse.json({
    vendors,
    assets: { rows: assets.rows, total: assets.total, summary: assetSummary },
    locations: { rows: locations.rows, total: locations.total, summary: locationSummary },
  });
});
