import { useTranslation } from "react-i18next";
import EmptyState from "./EmptyState";
import LoadingState from "./LoadingState";

const ALIGN_CLASSES = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export default function DataTable({
  columns,
  data,
  keyField = "id",
  onRowClick,
  loading = false,
  emptyState,
  className = "",
}) {
  const { t } = useTranslation();

  /* ============================================================
     LOADING STATE
     ============================================================ */

  if (loading) {
    return (
      <div
        className={`
          overflow-hidden
          rounded-md
          border
          border-border
          bg-card
          ${className}
        `}
      >
        <div className="p-4">
          <LoadingState variant="table" />
        </div>
      </div>
    );
  }

  /* ============================================================
     EMPTY STATE
     ============================================================ */

  if (data.length === 0) {
    return (
      <div
        className={`
          overflow-hidden
          rounded-md
          border
          border-border
          bg-card
          ${className}
        `}
      >
        {emptyState || <EmptyState title={t("common.noRecords")} />}
      </div>
    );
  }

  /* ============================================================
     TABLE
     ============================================================ */

  return (
    <div
      className={`
        overflow-hidden
        rounded-md
        border
        border-border
        bg-card
        ${className}
      `}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-full text-left">
          {/* ==================================================
              HEADER
             ================================================== */}

          <thead>
            <tr className="border-b border-border">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`
                    whitespace-nowrap
                    px-4
                    py-3
                    text-xs
                    font-semibold
                    uppercase
                    tracking-wide
                    text-muted-foreground
                    ${ALIGN_CLASSES[col.align] || ALIGN_CLASSES.left}
                    ${col.className || ""}
                  `}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>

          {/* ==================================================
              BODY
             ================================================== */}

          <tbody>
            {data.map((row, index) => (
              <tr
                key={row[keyField] ?? index}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`
                  ${
                    index !== data.length - 1 ? "border-b border-border/60" : ""
                  }

                  ${
                    onRowClick
                      ? `
                        cursor-pointer
                        transition-colors
                        duration-150
                        hover:bg-background/60
                      `
                      : ""
                  }
                `}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`
                      px-4
                      py-3.5
                      text-sm
                      text-foreground
                      ${ALIGN_CLASSES[col.align] || ALIGN_CLASSES.left}
                      ${col.className || ""}
                    `}
                  >
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
