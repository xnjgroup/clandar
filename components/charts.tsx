"use client";

import { useEffect, useRef } from "react";
import type { ApexOptions } from "apexcharts";
import { SPEND_BY_CATEGORY, UTILITIES_TREND } from "@/lib/data";

const FONT = "var(--font-instrument-sans), Instrument Sans, sans-serif";
const MONO_LABEL = {
  fontSize: "10.5px",
  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
  colors: "#9aa097",
};
const ANIMATIONS = {
  enabled: true,
  easing: "easeout" as const,
  speed: 750,
  animateGradually: { enabled: false, delay: 0 },
  dynamicAnimation: { enabled: false, speed: 0 },
};

const usd = (v: number) => `$${v}`;

/** ApexCharts touches `window` on construction, so it is imported at render time. */
function useApexChart(options: ApexOptions) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let chart: { destroy: () => void } | null = null;
    let cancelled = false;

    void import("apexcharts").then(({ default: ApexCharts }) => {
      if (cancelled || !ref.current) return;
      const instance = new ApexCharts(ref.current, options);
      chart = instance;
      void instance.render();
    });

    return () => {
      cancelled = true;
      chart?.destroy();
    };
  }, [options]);

  return ref;
}

const donutOptions: ApexOptions = {
  chart: {
    type: "donut",
    height: 220,
    width: "100%",
    toolbar: { show: false },
    fontFamily: FONT,
    animations: ANIMATIONS,
  },
  series: SPEND_BY_CATEGORY.series,
  labels: SPEND_BY_CATEGORY.labels,
  colors: SPEND_BY_CATEGORY.colors,
  dataLabels: { enabled: false },
  legend: {
    position: "bottom",
    fontSize: "11.5px",
    markers: { size: 5, shape: "square", strokeWidth: 0 },
    itemMargin: { horizontal: 6, vertical: 2 },
  },
  stroke: { width: 2, colors: ["#fff"] },
  plotOptions: {
    pie: {
      donut: {
        size: "62%",
        labels: {
          show: true,
          total: { show: true, label: "Total", formatter: () => SPEND_BY_CATEGORY.total },
        },
      },
    },
  },
  tooltip: { y: { formatter: usd } },
};

export function SpendByCategoryChart() {
  const ref = useApexChart(donutOptions);
  return <div ref={ref} className="h-[220px] w-full min-w-0" />;
}

const barOptions: ApexOptions = {
  chart: {
    type: "bar",
    height: 200,
    width: "100%",
    toolbar: { show: false },
    fontFamily: FONT,
    animations: ANIMATIONS,
  },
  series: UTILITIES_TREND.series,
  colors: UTILITIES_TREND.colors,
  plotOptions: { bar: { columnWidth: "58%", borderRadius: 5 } },
  dataLabels: { enabled: false },
  legend: {
    position: "top",
    horizontalAlign: "left",
    fontSize: "11px",
    markers: { size: 4, shape: "square", strokeWidth: 0 },
    itemMargin: { horizontal: 7 },
    offsetY: -2,
  },
  grid: { borderColor: "#eef0ec", strokeDashArray: 3 },
  xaxis: {
    categories: UTILITIES_TREND.categories,
    labels: { style: MONO_LABEL },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  yaxis: { labels: { formatter: usd, style: MONO_LABEL } },
  tooltip: { y: { formatter: usd } },
};

export function UtilitiesTrendChart() {
  const ref = useApexChart(barOptions);
  return <div ref={ref} className="h-[200px] w-full min-w-0" />;
}
