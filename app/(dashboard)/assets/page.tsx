import Link from "next/link";
import { Icon } from "@/components/icons";
import { TabLinks } from "@/components/tabs";
import {
  DataTable,
  EmptyRow,
  PageBody,
  Pager,
  SearchForm,
  StatCard,
  StatRow,
  TableCard,
  TableHeader,
  TableTitle,
  type Column,
} from "@/components/ui";
import {
  count,
  firstParam,
  hrefWith,
  money,
  money0,
  pageInfo,
  pageParam,
  pagerHrefs,
} from "@/lib/data";
import { requireSession } from "@/lib/auth";
import {
  ASSET_TYPE_TABS,
  assetRegions,
  assetStats,
  listAssets,
  type AssetTypeTab,
} from "@/lib/queries";

const PAGE_SIZE = 12;
const PATH = "/assets";

const COLUMNS: Column[] = [
  { label: "Asset", track: "minmax(160px,1.8fr)" },
  { label: "Vendor", track: "minmax(110px,1fr)" },
  { label: "Identifier", track: "minmax(90px,0.9fr)", mono: true },
  { label: "Location", track: "minmax(80px,0.8fr)" },
  { label: "Status", track: "minmax(60px,0.7fr)" },
  { label: "Cost/mo", track: "minmax(70px,0.8fr)", align: "right" },
];

export default async function AssetsPage({ searchParams }: PageProps<"/assets">) {
  const params = await searchParams;
  const { org } = await requireSession();
  const regions = await assetRegions(org.id);

  const requestedType = firstParam(params.type) as AssetTypeTab;
  const type = ASSET_TYPE_TABS.includes(requestedType) ? requestedType : "All types";
  const requestedRegion = firstParam(params.region);
  const region = regions.includes(requestedRegion) ? requestedRegion : "All regions";
  const search = firstParam(params.q);
  const page = pageParam(params.page);

  const [stats, { rows, total }] = await Promise.all([
    assetStats(org.id),
    listAssets(org.id, { type, region, search, page, size: PAGE_SIZE }),
  ]);

  const info = pageInfo(total, page, PAGE_SIZE);
  const { prevHref, nextHref } = pagerHrefs(PATH, params, info);

  // The region control cycles to the next region, keeping the page server-rendered.
  const nextRegion = regions[(regions.indexOf(region) + 1) % regions.length];

  const cards = [
    {
      label: "Total assets tracked",
      value: count(stats.total),
      sub: `across ${count(stats.regions)} regions`,
    },
    { label: "Monthly cost", value: money0(stats.monthlyCost), sub: "sum of all active assets" },
    {
      label: "Idle / unused",
      value: count(stats.idle),
      sub: "flagged for cancellation review",
    },
    {
      label: "Locations",
      value: count(stats.locations),
      sub: `in ${count(stats.regions)} regions`,
    },
  ];

  return (
    <PageBody>
      <StatRow>
        {cards.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </StatRow>

      <div className="flex flex-wrap items-center gap-[9px]">
        <SearchForm
          action={PATH}
          placeholder="Search asset, vendor, identifier…"
          defaultValue={search}
          keep={{
            type: type === "All types" ? undefined : type,
            region: region === "All regions" ? undefined : region,
          }}
          className="max-w-[340px] flex-1"
        />
        <Link
          href={hrefWith(PATH, params, {
            region: nextRegion === "All regions" ? null : nextRegion,
            page: null,
          })}
          className="flex shrink-0 items-center gap-2 rounded-[14px] border border-line bg-surface px-[13px] py-[9px]"
        >
          <Icon name="building" size={16} className="shrink-0 text-body-soft" />
          <span className="text-[12.5px] font-medium">{region}</span>
          <Icon name="chev" size={15} className="shrink-0 text-faint" />
        </Link>
      </div>

      <TabLinks
        options={ASSET_TYPE_TABS}
        value={type}
        label="Asset type"
        href={(option) =>
          hrefWith(PATH, params, { type: option === "All types" ? null : option, page: null })
        }
      />

      <TableCard>
        <TableHeader>
          <TableTitle>All assets</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">
            {count(total)} assets matching filter
          </span>
          <button type="button" className="ml-auto cursor-pointer text-[11.5px] font-medium underline">
            Export CSV
          </button>
        </TableHeader>

        {rows.length === 0 ? (
          <EmptyRow>No assets match this filter.</EmptyRow>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={rows.map((a) => [
              a.label,
              a.vendor,
              a.identifier,
              a.location ?? "—",
              a.idle ? "idle" : "active",
              money(a.monthlyCost),
            ])}
          />
        )}

        <Pager
          label={`${count(info.from)}–${count(info.to)} of ${count(info.total)}`}
          prevHref={prevHref}
          nextHref={nextHref}
        />
      </TableCard>
    </PageBody>
  );
}
