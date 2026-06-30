import React from "react";
import { ContentBlock } from "@/lib/cards/content";
import { Trash2, Plus } from "lucide-react";

interface RichCardSideEditorProps {
  blocks: ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
}

export function RichCardSideEditor({ blocks, onChange }: RichCardSideEditorProps) {
  const addBlock = (type: ContentBlock["type"]) => {
    onChange([
      ...blocks,
      { type, position: blocks.length, text: type === "text" ? "" : undefined },
    ]);
  };

  const removeBlock = (index: number) => {
    onChange(blocks.filter((_, i) => i !== index));
  };

  const updateBlock = (index: number, updates: Partial<ContentBlock>) => {
    onChange(
      blocks.map((b, i) => (i === index ? { ...b, ...updates } : b))
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, i) => (
        <div key={i} className="flex items-center gap-2">
          {block.type === "text" ? (
            <textarea
              className="flex-grow rounded border p-2"
              value={block.text || ""}
              onChange={(e) => updateBlock(i, { text: e.target.value })}
            />
          ) : (
            <span className="flex-grow rounded border bg-gray-50 p-2 text-sm">
              {block.type} asset (ID: {block.assetId || "pending"})
            </span>
          )}
          <button onClick={() => removeBlock(i)}>
            <Trash2 size={16} className="text-red-500" />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <button className="flex items-center gap-1 rounded bg-gray-100 p-2 text-sm" onClick={() => addBlock("text")}>
          <Plus size={14} /> Add Text
        </button>
        <button className="flex items-center gap-1 rounded bg-gray-100 p-2 text-sm" onClick={() => addBlock("image")}>
          <Plus size={14} /> Add Image
        </button>
      </div>
    </div>
  );
}
