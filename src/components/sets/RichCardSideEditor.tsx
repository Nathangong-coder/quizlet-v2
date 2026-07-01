import React, { useRef, useState } from "react";
import { ContentBlock } from "@/lib/cards/content";
import { Trash2, Plus, Upload, Loader2 } from "lucide-react";
import { AIAutocompleteButton } from "./AIAutocompleteButton";
import { uploadCardAsset } from "@/actions/uploads";
import { toast } from "sonner";

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);

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

  const handleFileUpload = async (index: number, file: File) => {
    setUploadingIndex(index);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("setId", setId);
      // cardId is optional here as it's assigned on save, but we could pass it if available

      const result = await uploadCardAsset(formData);
      if (result.assetId) {
        updateBlock(index, { assetId: result.assetId });
        toast.success("File uploaded successfully");
      }
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploadingIndex(null);
    }
  };

  const onFileChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(index, file);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-grow relative">
            {block.type === "text" ? (
              <div className="relative">
                <textarea
                  className="w-full rounded border p-2 pr-8 text-sm"
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
              <div className="relative group">
                <div className="flex items-center gap-2 rounded border bg-gray-50 p-2 text-sm block">
                  {uploadingIndex === i ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  <span>{block.type} asset {block.assetId ? `(ID: ${block.assetId})` : "(pending)"}</span>
                </div>
                <input
                  type="file"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={(e) => onFileChange(i, e)}
                />
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-primary hover:underline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingIndex === i}
                >
                  {block.assetId ? "Change" : "Upload"}
                </button>
              </div>
            )}
          </div>
          <button onClick={() => removeBlock(i)} className="mt-1">
            <Trash2 size={16} className="text-red-500" />
          </button>
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <button className="flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200" onClick={() => addBlock("text")}>
          <Plus size={12} /> Text
        </button>
        <button className="flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200" onClick={() => addBlock("image")}>
          <Plus size={12} /> Image
        </button>
        <button className="flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200" onClick={() => addBlock("video")}>
          <Plus size={12} /> Video
        </button>
        <button className="flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200" onClick={() => addBlock("file")}>
          <Plus size={12} /> File
        </button>
      </div>
    </div>
  );
}
