import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PALETTE = ["#F26A4B", "#1E1E1E", "#5E5A52", "#A89F8F", "#CFC8B8"];

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <div
      className="
        rounded-md
        border
        border-border
        bg-card
        p-2.5
        text-xs
        shadow-[0_6px_15px_rgba(0,0,0,0.10)]
      "
    >
      {label !== undefined && (
        <p className="mb-1.5 font-medium text-foreground">{label}</p>
      )}

      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.dataKey} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
              aria-hidden="true"
            />

            <span className="text-muted-foreground">{entry.name}</span>

            <span className="ml-auto font-medium tabular-nums text-foreground">
              {entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartLegend({ payload }) {
  if (!payload || payload.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: entry.color }}
            aria-hidden="true"
          />

          <span>{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function LineChartCard({
  title,
  subtitle,
  data,
  xKey,
  series,
  height = 280,
  emptyMessage = "Not enough data yet",
  className = "",
}) {
  const isEmpty = !data || data.length === 0;

  return (
    <div
      className={`
        rounded-md
        border
        border-border
        bg-card
        p-5
        text-card-foreground
        sm:p-6
        ${className}
      `}
    >
      {(title || subtitle) && (
        <div className="mb-4">
          {title && (
            <p className="text-sm font-semibold tracking-tight text-foreground">
              {title}
            </p>
          )}

          {subtitle && (
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
      )}

      {isEmpty ? (
        <div
          className="
            flex
            min-h-[180px]
            items-center
            justify-center
            px-4
            py-12
            text-center
          "
        >
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart
            data={data}
            margin={{
              top: 4,
              right: 8,
              left: 0,
              bottom: 4,
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
              dy={6}
            />

            <YAxis
              tick={{
                fontSize: 12,
                fill: "#5E5A52",
              }}
              axisLine={false}
              tickLine={false}
              width={36}
            />

            <Tooltip
              content={<ChartTooltip />}
              cursor={{
                stroke: "#D2CBBB",
                strokeWidth: 1,
              }}
            />

            {series.length > 1 && (
              <Legend
                content={<ChartLegend />}
                wrapperStyle={{
                  paddingTop: 12,
                }}
              />
            )}

            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color || PALETTE[i % PALETTE.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
