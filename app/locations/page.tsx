"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
import { LOCATION_STATS, LOCATION_TOTAL, LOCATIONS, money0, paginate } from "@/lib/data";

const PAGE_SIZE = 12;

const COLUMNS: Column[] = [
  { label: "Location", track: "minmax(120px,1.6fr)" },
  { label: "Region", track: "minmax(90px,1fr)" },
  { label: "Assets", track: "minmax(90px,1fr)" },
  { label: "Monthly cost", track: "minmax(90px,1fr)", align: "right" },
];

export default function LocationsPage() {
  const [page, setPage] = useState(0);
  const slice = useMemo(() => paginate(LOCATIONS, page, PAGE_SIZE), [page]);

  return (
    <PageBody>
      <StatRow>
        {LOCATION_STATS.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </StatRow>

      <SearchBox placeholder="Search locations…" className="max-w-[340px]" />

      <TableCard>
        <TableHeader>
          <TableTitle>All locations</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">{LOCATION_TOTAL} locations</span>
        </TableHeader>

        <DataTable
          columns={COLUMNS}
          rows={slice.rows.map((l) => [
            <Link key={l.name} href="/assets" className="underline">
              {l.name}
            </Link>,
            l.region,
            `${l.assetCount} assets`,
            `${money0(l.cost)}/mo`,
          ])}
        />

        <Pager
          label={`${slice.from}–${slice.to} of ${slice.total}`}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => Math.min(slice.pages - 1, p + 1))}
          disablePrev={slice.page === 0}
          disableNext={slice.page >= slice.pages - 1}
        />
      </TableCard>
    </PageBody>
  );
}
