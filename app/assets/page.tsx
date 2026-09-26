"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { TabList } from "@/components/tabs";
import {
  DataTable,
  PageBody,
  Pager,
  SearchBox,
  StatCard,
  StatRow,
  TableCard,
  TableHeader,
  TableTitle,
  type Column,
} from "@/components/ui";
import {
  ASSET_STATS,
  ASSET_TYPE_TABS,
  REGIONS,
  assetPage,
  money,
  type AssetTypeTab,
  type Region,
} from "@/lib/data";

const PAGE_SIZE = 12;

const COLUMNS: Column[] = [
  { label: "Asset", track: "minmax(160px,1.8fr)" },
  { label: "Vendor", track: "minmax(110px,1fr)" },
  { label: "Identifier", track: "minmax(90px,0.9fr)", mono: true },
  { label: "Location", track: "minmax(80px,0.8fr)" },
  { label: "Status", track: "minmax(60px,0.7fr)" },
  { label: "Cost/mo", track: "minmax(70px,0.8fr)", align: "right" },
];

export default function AssetsPage() {
  const [type, setType] = useState<AssetTypeTab>("All types");
  const [region, setRegion] = useState<Region>("All regions");
  const [page, setPage] = useState(0);

  const slice = useMemo(() => assetPage(type, region, page, PAGE_SIZE), [type, region, page]);

  function cycleRegion() {
    const i = REGIONS.indexOf(region);
    setRegion(REGIONS[(i + 1) % REGIONS.length]);
    setPage(0);
  }

  function selectType(next: AssetTypeTab) {
    setType(next);
    setPage(0);
  }

  return (
    <PageBody>
      <StatRow>
        {ASSET_STATS.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </StatRow>

      <div className="flex flex-wrap items-center gap-[9px]">
        <SearchBox placeholder="Search asset, vendor, identifier…" className="max-w-[340px] flex-1" />
        <button
          type="button"
          onClick={cycleRegion}
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-[14px] border border-line bg-surface px-[13px] py-[9px]"
        >
          <Icon name="building" size={16} className="shrink-0 text-body-soft" />
          <span className="text-[12.5px] font-medium">{region}</span>
          <Icon name="chev" size={15} className="shrink-0 text-faint" />
        </button>
      </div>

      <TabList options={ASSET_TYPE_TABS} value={type} onChange={selectType} label="Asset type" />

      <TableCard>
        <TableHeader>
          <TableTitle>All assets</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">
            {slice.total.toLocaleString("en-US")} assets matching filter
          </span>
          <button type="button" className="ml-auto cursor-pointer text-[11.5px] font-medium underline">
            Export CSV
          </button>
        </TableHeader>

        <DataTable
          columns={COLUMNS}
          rows={slice.rows.map((a) => [
            a.label,
            a.vendor,
            a.identifier,
            a.location,
            a.idle ? "idle" : "active",
            money(a.amount),
          ])}
        />

        <Pager
          label={`${slice.from.toLocaleString("en-US")}–${slice.to.toLocaleString("en-US")} of ${slice.total.toLocaleString("en-US")}`}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => Math.min(slice.pages - 1, p + 1))}
          disablePrev={slice.page === 0}
          disableNext={slice.page >= slice.pages - 1}
        />
      </TableCard>
    </PageBody>
  );
}
