import { Button } from '@harbor/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@harbor/ui/components/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@harbor/ui/components/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@harbor/ui/components/table';
import { ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

const PREFERENCES = new Map<string, TablePreferences>();
const PAGE_SIZES = [10, 25, 50] as const;
const INITIAL_PREFERENCES: TablePreferences = { hidden: [], pageSize: 10 };

type TablePreferences = { hidden: string[]; pageSize: 10 | 25 | 50 };
type Column<Row> = {
  id: string;
  label: string;
  required?: boolean;
  numeric?: boolean;
  /** The column a reader compares first; set a step heavier. */
  emphasis?: boolean;
  cell: (row: Row) => ReactNode;
};

/**
 * Royco's market table: one card, the filters in its header, quiet sentence-case column heads, roomy
 * rows and numbers right-aligned. `compact` drops the toolbar and paging for short lists.
 */
export function ResearchDataTable<Row>({
  tableKey,
  label,
  rows,
  columns,
  getRowId,
  compact = false,
  controls,
}: {
  tableKey: string;
  label: string;
  rows: Row[];
  columns: Column<Row>[];
  getRowId: (row: Row) => string;
  compact?: boolean;
  controls?: ReactNode;
}) {
  const [preferences, setPreferences] = useState(() => PREFERENCES.get(tableKey) ?? INITIAL_PREFERENCES);
  const [page, setPage] = useState(0);
  useEffect(() => {
    PREFERENCES.set(tableKey, preferences);
  }, [tableKey, preferences]);
  const visibleColumns = columns.filter(
    (column, index) => index === 0 || column.required || !preferences.hidden.includes(column.id),
  );
  const pages = Math.max(1, Math.ceil(rows.length / preferences.pageSize));
  const safePage = Math.min(page, pages - 1);
  const visibleRows = compact
    ? rows
    : rows.slice(safePage * preferences.pageSize, (safePage + 1) * preferences.pageSize);
  const first = safePage * preferences.pageSize + 1;
  const last = Math.min((safePage + 1) * preferences.pageSize, rows.length);
  return (
    <div className="ws-card min-w-0 overflow-hidden">
      {!compact ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 border-b border-border px-4 py-3">
          {controls}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" className="ml-auto h-9 gap-2 px-2.5 text-[13px] text-muted-foreground" />}
            >
              <SlidersHorizontal className="size-3.5" /> Columns
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                {columns.map((column, index) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={index === 0 || column.required || !preferences.hidden.includes(column.id)}
                    disabled={index === 0 || column.required}
                    onCheckedChange={(checked) =>
                      setPreferences((previous) => ({
                        ...previous,
                        hidden: checked
                          ? previous.hidden.filter((id) => id !== column.id)
                          : [...previous.hidden, column.id],
                      }))
                    }
                  >
                    {column.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      <Table
        containerClassName="ws-table overflow-auto"
        containerLabel={`${label} observations`}
        className="w-full"
        style={{ ['--ws-cols' as string]: visibleColumns.length }}
      >
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {visibleColumns.map((column, index) => (
              <TableHead key={column.id} className={`sticky top-0 z-20 bg-card ${index === 0 ? 'left-0 z-30' : ''}`}>
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map((row) => (
            <TableRow key={getRowId(row)}>
              {visibleColumns.map((column, index) => (
                <TableCell
                  key={column.id}
                  className={`${index === 0 ? 'ws-sticky-cell sticky left-0 z-10 bg-card transition-colors duration-150' : ''} ${column.numeric ? 'ws-num' : ''} ${column.emphasis ? 'font-semibold text-foreground' : ''}`}
                >
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {!rows.length ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={visibleColumns.length}
                className="py-14 text-center text-[13.5px] text-muted-foreground"
              >
                Nothing matches these filters.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
      {!compact && rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-2.5 text-[12.5px] text-muted-foreground">
          <span aria-live="polite" className="ws-num mr-auto">
            {first}–{last} of {rows.length} {label.toLowerCase()}
          </span>
          <Select
            value={String(preferences.pageSize)}
            onValueChange={(value) => {
              if (value === '10' || value === '25' || value === '50') {
                const pageSize = value === '10' ? 10 : value === '25' ? 25 : 50;
                setPreferences((previous) => ({ ...previous, pageSize }));
                setPage(0);
              }
            }}
          >
            <SelectTrigger aria-label={`${label} rows per page`} className="h-8 gap-1.5 text-[12.5px]">
              <SelectValue>{preferences.pageSize} per page</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} per page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <nav aria-label={`${label} pages`} className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground pointer-coarse:size-11"
              aria-label="Previous page"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              <ChevronLeft />
            </Button>
            {Array.from({ length: pages }, (_, index) => index)
              .filter((index) => index === 0 || index === pages - 1 || Math.abs(index - safePage) <= 1)
              .map((index) => (
                <Button
                  key={index}
                  variant="ghost"
                  className="ws-num size-8 px-0 text-[12.5px] text-muted-foreground aria-[current=page]:bg-secondary aria-[current=page]:text-foreground pointer-coarse:size-11"
                  aria-label={`Page ${index + 1}`}
                  aria-current={index === safePage ? 'page' : undefined}
                  onClick={() => setPage(index)}
                >
                  {index + 1}
                </Button>
              ))}
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground pointer-coarse:size-11"
              aria-label="Next page"
              disabled={safePage + 1 >= pages}
              onClick={() => setPage(safePage + 1)}
            >
              <ChevronRight />
            </Button>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
