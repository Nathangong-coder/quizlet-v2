'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';

interface ExpandableTextProps {
  text: string;
  limit?: number;
  className?: string;
}

export function ExpandableText({ text, limit = 150, className }: ExpandableTextProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!text) return null;
  if (text.length <= limit) return <span className={className}>{text}</span>;

  return (
    <span className={className}>
      {isExpanded ? text : `${text.substring(0, limit)}...`}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
        className="ml-1 text-primary font-bold hover:underline text-xs"
      >
        {isExpanded ? 'less' : 'more'}
      </button>
    </span>
  );
}
