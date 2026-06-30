import React from "react";
import { ContentBlock } from "@/lib/cards/content";
import { Trash2, Plus } from "lucide-react";
import { AIAutocompleteButton } from "./AIAutocompleteButton";

interface RichCardSideEditorProps {
  blocks: ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
  setId: string;
  side: "term" | "definition";
  categories: string[];
}

export function RichCardSideEditor({
  blocks,
  onChange,
  setId,
  side,
  categories,
}: RichCardSideEditorProps) {
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
        <div key={i} className="flex items-start gap-2">
          <div className="flex-grow relative">
            {block.type === "text" ? (
              <div className="relative">
                <textarea
                  className="w-full rounded border p-2 pr-8"
                  value={block.text || ""}
                  onChange={(e) => updateBlock(i, { text: e.target.value })}
                />
                <div className="absolute right-1 top-1">
                  <AIAutocompleteButton
                    setId={setId}
                    currentText={block.text || ""}
                    side={side}
                    categories={categories}
                    onSelect={(s) => updateBlock(i, { text: s })}
                  />
                </div>
              </div>
            ) : (
              <span className="flex-grow rounded border bg-gray-50 p-2 text-sm block">
                {block.type} asset (ID: {block.assetId || "pending"})
              </span>
            )}
          </div>
          <button onClick={() => removeBlock(i)}>
            <Trash2 size={16} className="text-red-500 mt-2" />
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
