'use client';

import React, { useState } from 'react';
import { ContentBlock } from '@/lib/cards/content';
import { SpreadsheetTable } from './SpreadsheetTable';
import { Download, ChevronDown } from 'lucide-react';
import { parseSpreadsheet } from '@/lib/cards/spreadsheet';

interface ContentBlockViewProps {
  block: ContentBlock;
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
    return (
      <div className={`prose prose-sm max-w-none ${className}`}>
        <p className="whitespace-pre-wrap">{block.text}</p>
      </div>
    );
  }

  // Require assetUrl for non-text blocks
  if (!assetUrl) {
    return (
      <div className={`text-gray-400 text-sm italic ${className}`}>
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
            <div className={`bg-gray-100 rounded animate-pulse ${compact ? 'h-40' : 'h-64'}`} />
          )}
          {imageError ? (
            <div className="bg-gray-100 rounded p-4 text-center text-gray-500">
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
                  ? 'rounded border border-gray-200 max-h-40 w-auto max-w-full object-contain mx-auto'
                  : 'rounded border border-gray-200 max-w-full h-auto'
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
            <p className="text-xs text-gray-500 mt-1">{assetOriginalName}</p>
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
                ? 'rounded border border-gray-200 max-h-40 w-auto mx-auto'
                : 'rounded border border-gray-200 w-full'
            }
            src={assetUrl}
          >
            Your browser does not support the video element.
          </video>
          {assetOriginalName && (
            <p className="text-xs text-gray-500 mt-1">{assetOriginalName}</p>
          )}
        </div>
      );

    case 'file': {
      // Spreadsheet rendering
      if (assetMimeType && assetMimeType.includes('spreadsheet')) {
        return (
          <div className={`${maxWidth} ${className}`}>
            <div className="border border-gray-200 rounded">
              <button
                onClick={() => setSpreadsheetExpanded(!spreadsheetExpanded)}
                className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition"
              >
                <span className="text-sm font-semibold text-gray-700">
                  📊 Spreadsheet: {assetOriginalName}
                </span>
                <ChevronDown
                  size={16}
                  className={`transition-transform ${
                    spreadsheetExpanded ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {spreadsheetExpanded && textExtract && (
                <div className="p-3 bg-white overflow-x-auto border-t border-gray-200">
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
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
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
          <div className="inline-flex items-center gap-2 bg-gray-50 border border-gray-200 rounded px-3 py-2">
            <span className="text-sm text-gray-700">{assetOriginalName}</span>
            <a
              href={assetUrl}
              download={assetOriginalName}
              className="text-blue-600 hover:text-blue-700"
            >
              <Download size={14} />
            </a>
          </div>
        </div>
      );
    }

    default:
      return (
        <div className={`text-gray-400 text-sm italic ${className}`}>
          [{blockType} asset]
        </div>
      );
  }

  // Fallback for unknown types
  return (
    <div className={`text-gray-400 text-sm italic ${className}`}>
      [{block.type || 'unknown'} asset]
    </div>
  );
}
