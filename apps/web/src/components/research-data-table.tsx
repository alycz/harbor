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
import { ChevronLeft, ChevronRight, Columns3 } from 'lucide-react';
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
  /** The column a reader compares first; drawn in the accent. */
  emphasis?: boolean;
  cell: (row: Row) => ReactNode;
};

/** A ruled, paged table with optional columns. `compact` drops the toolbar and paging for short lists. */
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
    <div className="research-data-table min-w-0">
      {!compact ? (
        <div className="research-table-toolbar">
          {controls}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" className="ml-auto h-11" />}>
              <Columns3 /> Columns
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{label} columns</DropdownMenuLabel>
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
      <div className="border border-line bg-card">
        <Table containerClassName="overflow-auto" containerLabel={`${label} observations`} className="w-full">
          <TableHeader>
            <TableRow className="border-line hover:bg-transparent">
              {visibleColumns.map((column, index) => (
                <TableHead
                  key={column.id}
                  className={`sticky top-0 z-20 h-10 bg-secondary text-[11px] font-medium tracking-[0.6px] text-muted-foreground uppercase ${index === 0 ? 'left-0 z-30' : ''} ${column.numeric ? 'text-right' : ''}`}
                >
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => (
              <TableRow key={getRowId(row)} className="border-line hover:bg-secondary/60">
                {visibleColumns.map((column, index) => (
                  <TableCell
                    key={column.id}
                    className={`py-3 ${index === 0 ? 'sticky left-0 z-10 max-w-[18rem] whitespace-normal break-words bg-card' : ''} ${column.numeric ? 'text-right tabular-nums' : ''} ${column.emphasis ? 'font-semibold text-primary' : ''}`}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {!rows.length ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visibleColumns.length} className="py-10 text-center text-muted-foreground">
                  Nothing matches these filters.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      {!compact && rows.length > 0 ? (
        <div className="research-pagination">
          <span aria-live="polite">
            {first}–{last} of {rows.length} {label.toLowerCase()}
          </span>
          <div className="flex flex-wrap items-center gap-2">
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
              <SelectTrigger aria-label={`${label} rows per page`} className="h-11">
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
            <nav aria-label={`${label} pages`} className="flex items-center">
              <Button
                variant="outline"
                size="icon"
                className="size-11"
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
                    variant="outline"
                    className="-ml-px size-11 aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
                    aria-label={`Page ${index + 1}`}
                    aria-current={index === safePage ? 'page' : undefined}
                    onClick={() => setPage(index)}
                  >
                    {index + 1}
                  </Button>
                ))}
              <Button
                variant="outline"
                size="icon"
                className="-ml-px size-11"
                aria-label="Next page"
                disabled={safePage + 1 >= pages}
                onClick={() => setPage(safePage + 1)}
              >
                <ChevronRight />
              </Button>
            </nav>
          </div>
        </div>
      ) : null}
    </div>
  );
}
