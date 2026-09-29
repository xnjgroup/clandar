import Link from "next/link";
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
import { count, firstParam, money0, pageInfo, pageParam, pagerHrefs } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { listLocations, locationStats } from "@/lib/queries";

const PAGE_SIZE = 12;
const PATH = "/locations";

const COLUMNS: Column[] = [
  { label: "Location", track: "minmax(120px,1.6fr)" },
  { label: "Region", track: "minmax(90px,1fr)" },
  { label: "Assets", track: "minmax(90px,1fr)" },
  { label: "Monthly cost", track: "minmax(90px,1fr)", align: "right" },
];

export default async function LocationsPage({ searchParams }: PageProps<"/locations">) {
  const params = await searchParams;
  const search = firstParam(params.q);
  const page = pageParam(params.page);
  const { org } = await requireSession();

  const [stats, { rows, total }] = await Promise.all([
    locationStats(org.id),
    listLocations(org.id, { search, page, size: PAGE_SIZE }),
  ]);

  const info = pageInfo(total, page, PAGE_SIZE);
  const { prevHref, nextHref } = pagerHrefs(PATH, params, info);

  const cards = [
    {
      label: "Total locations",
      value: count(stats.total),
      sub: `across ${count(stats.regions)} regions`,
    },
    {
      label: "Avg assets / location",
      value: count(stats.avgAssets),
      sub: `median ${count(stats.medianAssets)}`,
    },
    {
      label: "Total monthly cost",
      value: money0(stats.monthlyCost),
      sub: "all locations combined",
    },
  ];

  return (
    <PageBody>
      <StatRow>
        {cards.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </StatRow>

      <SearchForm
        action={PATH}
        placeholder="Search locations…"
        defaultValue={search}
        className="max-w-[340px]"
      />

      <TableCard>
        <TableHeader>
          <TableTitle>{search ? `Locations matching “${search}”` : "All locations"}</TableTitle>
          <span className="font-mono text-[10.5px] text-faint">{count(total)} locations</span>
        </TableHeader>

        {rows.length === 0 ? (
          <EmptyRow>No locations match this search.</EmptyRow>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={rows.map((l) => [
              <Link
                key={l.name}
                href={`/assets?q=${encodeURIComponent(l.name)}`}
                className="underline"
                title={l.address}
              >
                {l.name}
              </Link>,
              l.region,
              `${count(l.assets)} assets`,
              `${money0(l.cost)}/mo`,
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
