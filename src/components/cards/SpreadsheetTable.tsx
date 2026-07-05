import React from 'react';

interface SpreadsheetTableProps {
  rows: string[][];
  maxRows?: number;
  className?: string;
}

/**
 * Render a 2D array of strings as an HTML table.
 * Useful for displaying spreadsheet previews.
 */
export function SpreadsheetTable({ rows, maxRows = 20, className = '' }: SpreadsheetTableProps) {
  if (!rows || rows.length === 0) {
    return <div className="text-gray-400 text-sm italic">Empty spreadsheet</div>;
  }

  const displayRows = rows.slice(0, maxRows);
  const hasMoreRows = rows.length > maxRows;

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-sm">
        <tbody>
          {displayRows.map((row, rowIdx) => (
            <tr key={rowIdx} className="border-b border-gray-200 hover:bg-gray-50">
              {row.map((cell, colIdx) => (
                <td
                  key={colIdx}
                  className="px-2 py-1 border-r border-gray-200 text-gray-700"
                  style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {hasMoreRows && (
        <div className="text-xs text-gray-400 p-2">
          Showing {displayRows.length} of {rows.length} rows
        </div>
      )}
    </div>
  );
}
