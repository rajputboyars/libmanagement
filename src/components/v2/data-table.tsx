"use client";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { useLayoutMode } from "./layout";
import { EmptyState, Skeleton } from "./primitives";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Hide this column in the mobile card (e.g. an actions column rendered separately). */
  hideOnCard?: boolean;
  /** Use this column as the card title instead of a label/value row. */
  primary?: boolean;
};

/** A table on tablet/desktop that becomes a stack of cards on mobile. Pass `renderCard` for a custom card. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  renderCard,
  empty,
  loading,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  renderCard?: (row: T) => ReactNode;
  empty?: ReactNode;
  loading?: boolean;
  caption: string;
}) {
  const mode = useLayoutMode();
  if (loading) return <Skeleton lines={5} />;
  if (!rows.length) return <>{empty ?? <EmptyState icon={Inbox} title="Nothing here yet" />}</>;
  if (mode === "mobile") {
    const primary = columns.find((c) => c.primary);
    const rest = columns.filter((c) => !c.primary && !c.hideOnCard);
    return (
      <div className="sq-v2-cards" role="list" aria-label={caption}>
        {rows.map((r) => {
          const inner = renderCard ? (
            renderCard(r)
          ) : (
            <>
              {primary && <strong style={{ display: "block", marginBottom: 6, fontSize: 15 }}>{primary.render(r)}</strong>}
              {rest.map((c) => (
                <div className="sq-v2-cardrow" key={c.key}>
                  <span>{c.header}</span>
                  <div>{c.render(r)}</div>
                </div>
              ))}
            </>
          );
          return onRowClick ? (
            <button key={rowKey(r)} type="button" role="listitem" className="sq-v2-card" onClick={() => onRowClick(r)}>
              {inner}
            </button>
          ) : (
            <div key={rowKey(r)} role="listitem" className="sq-v2-card">
              {inner}
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div className="sq-v2-tablewrap">
      <table className="sq-v2-table">
        <caption className="sq-v2-sr">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              data-click={!!onRowClick}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => (e.key === "Enter" ? onRowClick(r) : undefined) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
