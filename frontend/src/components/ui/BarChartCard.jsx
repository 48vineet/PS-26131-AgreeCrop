import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/* ============================================================
   PREMIUM CROP DESIGN SYSTEM — CHART PALETTE
   ============================================================ */

const SERIES_COLORS = ["#F26A4B", "#1E1E1E", "#5E5A52", "#A89F8F", "#CFC8B8"];

/* ============================================================
   TOOLTIP
   ============================================================ */

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <div
      className="
        min-w-[150px]
        rounded-md
        border
        border-border
        bg-card
        px-3.5
        py-3
        shadow-[0_6px_15px_rgba(0,0,0,0.10)]
      "
    >
      {label !== undefined && (
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {label}
        </p>
      )}

      <div className="space-y-1.5">
        {payload.map((entry) => (
          <div key={entry.dataKey} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor: entry.color,
              }}
              aria-hidden="true"
            />

            <span className="min-w-0 truncate text-muted-foreground">
              {entry.name}
            </span>

            <span
              className="
                ml-auto
                font-medium
                tabular-nums
                text-foreground
              "
            >
              {entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   LEGEND
   ============================================================ */

function ChartLegend({ payload }) {
  if (!payload || payload.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
      {payload.map((entry) => (
        <div
          key={entry.dataKey}
          className="
            flex
            items-center
            gap-1.5
            text-xs
            text-muted-foreground
          "
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{
              backgroundColor: entry.color,
            }}
            aria-hidden="true"
          />

          <span>{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   BAR CHART CARD
   ============================================================ */

export default function BarChartCard({
  title,
  subtitle,
  data,
  xKey,
  series,
  height = 280,
  emptyMessage = "Not enough data yet",
  className = "",
}) {
  const hasData =
    Array.isArray(data) &&
    data.length > 0 &&
    Array.isArray(series) &&
    series.length > 0;

  return (
    <div
      className={`
        rounded-md
        border
        border-border
        bg-card
        p-5
        sm:p-6
        ${className}
      `}
    >
      {/* ======================================================
          HEADER
         ====================================================== */}

      {(title || subtitle) && (
        <div className="mb-5">
          {title && (
            <h3
              className="
                text-sm
                font-semibold
                tracking-tight
                text-foreground
              "
            >
              {title}
            </h3>
          )}

          {subtitle && (
            <p
              className="
                mt-1
                text-xs
                leading-5
                text-muted-foreground
              "
            >
              {subtitle}
            </p>
          )}
        </div>
      )}

      {/* ======================================================
          CHART
         ====================================================== */}

      {hasData ? (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={data}
            barCategoryGap="24%"
            margin={{
              top: 4,
              right: 4,
              left: 0,
              bottom: 0,
            }}
          >
            <CartesianGrid
              stroke="#D2CBBB"
              strokeOpacity={0.65}
              vertical={false}
            />

            <XAxis
              dataKey={xKey}
              tick={{
                fontSize: 12,
                fill: "#5E5A52",
              }}
              axisLine={false}
              tickLine={false}
              tickMargin={8}
            />

            <YAxis
              tick={{
                fontSize: 12,
                fill: "#5E5A52",
              }}
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              width={36}
            />

            <Tooltip
              content={<ChartTooltip />}
              cursor={{
                fill: "#CFC8B8",
                fillOpacity: 0.18,
              }}
            />

            {series.length > 1 && <Legend content={<ChartLegend />} />}

            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={s.color || SERIES_COLORS[i % SERIES_COLORS.length]}
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : (
        /* ======================================================
           EMPTY STATE
           ====================================================== */

        <div
          className="
            flex
            min-h-[280px]
            items-center
            justify-center
          "
        >
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              No data available
            </p>

            <p className="mt-1 text-xs text-muted-foreground">{emptyMessage}</p>
          </div>
        </div>
      )}
    </div>
  );
}
