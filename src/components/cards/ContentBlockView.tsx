'use client';

import React, { useState } from 'react';
import { ContentBlock } from '@/lib/cards/content';
import { SpreadsheetTable } from './SpreadsheetTable';
import { Download, ChevronDown, FileSpreadsheet } from 'lucide-react';
import { parseSpreadsheet } from '@/lib/cards/spreadsheet';

interface ContentBlockViewProps {
  block: ContentBlock;
  index?: number;
  assetUrl?: string; // e.g., `/api/assets/{assetId}` for non-text blocks
  assetMimeType?: string;
  assetOriginalName?: string;
  textExtract?: string; // Pre-extracted CSV preview for spreadsheets
  className?: string;
  maxWidth?: string;
  /**
   * Constrain media height so it fits inside fixed-height containers
   * (flashcard flip cards, review cards) without causing scroll.
   */
  compact?: boolean;
}

/**
 * Unified renderer for all content block types.
 * Used by: flashcard carousel, Review mode, quiz prompts, etc.
 */
export function ContentBlockView({
  block,
  index,
  assetUrl,
  assetMimeType,
  assetOriginalName,
  textExtract,
  className = '',
  maxWidth = 'max-w-2xl',
  compact = false,
}: ContentBlockViewProps) {
  const [spreadsheetExpanded, setSpreadsheetExpanded] = useState(true);
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  // Text block
  if (block.type === 'text') {
    const indent = Math.min(Math.max(block.indent ?? 0, 0), 6);
    const listIndex = index ?? block.position ?? 0;
    const listMarker = block.listType === 'bullet' ? '•' : block.listType === 'numbered' ? `${listIndex + 1}.` : null;
    return (
      <div
        className={`prose prose-sm max-w-none ${className}`}
        style={{ marginLeft: `${indent * 1.25}rem` }}
      >
        <div className="flex items-start gap-2">
          {listMarker && <span className="min-w-5 shrink-0 text-right font-semibold text-primary" aria-hidden="true">{listMarker}</span>}
          <p className="whitespace-pre-wrap">{block.text}</p>
        </div>
      </div>
    );
  }

  // Require assetUrl for non-text blocks
  if (!assetUrl) {
    return (
      <div className={`text-muted-foreground text-sm italic ${className}`}>
        [{block.type} asset not available]
      </div>
    );
  }

  // Switch on block type for non-text rendering
  const blockType = block.type as string;
  switch (blockType) {
    case 'image':
      return (
        <div className={`${compact ? 'w-auto' : maxWidth} ${className}`}>
          {imageLoading && (
            <div className={`bg-muted rounded animate-pulse ${compact ? 'h-40' : 'h-64'}`} />
          )}
          {imageError ? (
            <div className="bg-muted rounded p-4 text-center text-muted-foreground">
              Failed to load image
            </div>
          ) : (
            <img
              // Cached images (e.g. after navigating back from a quiz) can
              // finish loading before React attaches onLoad, so the handler
              // never fires and the pulse placeholder would stay forever.
              // Detect the already-complete case as soon as the node mounts.
              ref={(node) => {
                if (node?.complete) setImageLoading(false);
              }}
              src={assetUrl}
              alt="card content"
              className={
                compact
                  ? 'rounded border border-border max-h-40 w-auto max-w-full object-contain mx-auto'
                  : 'rounded border border-border max-w-full h-auto'
              }
              onLoad={() => setImageLoading(false)}
              onError={() => {
                setImageLoading(false);
                setImageError(true);
              }}
            />
          )}
        </div>
      );

    case 'audio':
      return (
        <div className={`${className}`}>
          <audio
            controls
            className="w-full max-w-md"
            src={assetUrl}
          >
            Your browser does not support the audio element.
          </audio>
          {assetOriginalName && (
            <p className="text-xs text-muted-foreground mt-1">{assetOriginalName}</p>
          )}
        </div>
      );

    case 'video':
      return (
        <div className={`${compact ? 'w-auto' : maxWidth} ${className}`}>
          <video
            controls
            className={
              compact
                ? 'rounded border border-border max-h-40 w-auto mx-auto'
                : 'rounded border border-border w-full'
            }
            src={assetUrl}
          >
            Your browser does not support the video element.
          </video>
          {assetOriginalName && (
            <p className="text-xs text-muted-foreground mt-1">{assetOriginalName}</p>
          )}
        </div>
      );

    case 'file': {
      // Spreadsheet rendering
      if (assetMimeType && assetMimeType.includes('spreadsheet')) {
        return (
          <div className={`${maxWidth} ${className}`}>
            <div className="border border-border rounded">
              <button
                onClick={() => setSpreadsheetExpanded(!spreadsheetExpanded)}
                aria-expanded={spreadsheetExpanded}
                className="w-full flex items-center justify-between p-3 bg-muted/50 hover:bg-muted transition"
              >
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                  <FileSpreadsheet size={14} aria-hidden="true" />
                  Spreadsheet: {assetOriginalName}
                </span>
                <ChevronDown
                  size={16}
                  className={`transition-transform ${
                    spreadsheetExpanded ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {spreadsheetExpanded && textExtract && (
                <div className="p-3 bg-card overflow-x-auto border-t border-border">
                  <SpreadsheetTable
                    rows={textExtract.split('\n').map((row) =>
                      row.split(',').map((cell) =>
                        // Simple CSV parsing (assumes no escaped quotes for now)
                        cell.replace(/^"|"$/g, ''),
                      ),
                    )}
                    maxRows={10}
                  />
                </div>
              )}
            </div>
            <div className="mt-2">
              <a
                href={assetUrl}
                download={assetOriginalName}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Download size={12} /> Download
              </a>
            </div>
          </div>
        );
      }
      // PDF or other file types
      return (
        <div className={`${className}`}>
          <div className="inline-flex items-center gap-2 bg-muted/50 border border-border rounded px-3 py-2">
            <span className="text-sm">{assetOriginalName}</span>
            <a
              href={assetUrl}
              download={assetOriginalName}
              aria-label={`Download ${assetOriginalName ?? 'file'}`}
              className="text-primary hover:text-primary/80"
            >
              <Download size={14} />
            </a>
          </div>
        </div>
      );
    }

    default:
      // Every branch above returns, so this is the only unknown-type fallback.
      // A second one used to sit after the switch, permanently unreachable.
      return (
        <div className={`text-muted-foreground text-sm italic ${className}`}>
          [{blockType || 'unknown'} asset]
        </div>
      );
  }
}
