import React, { useRef, useState } from "react";
import { ContentBlock } from "@/lib/cards/content";
import { Trash2, Plus, Upload, Loader2 } from "lucide-react";
import { AIAutocompleteButton } from "./AIAutocompleteButton";
import { uploadCardAsset } from "@/actions/uploads";
import { toast } from "sonner";

interface RichCardSideEditorProps {
  blocks: ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
  onUploadStatusChange?: (isUploading: boolean) => void;
  setId: string;
  side: "term" | "definition";
  categories: string[];
}

export function RichCardSideEditor({
  blocks,
  onChange,
  onUploadStatusChange,
  setId,
  side,
  categories,
}: RichCardSideEditorProps) {
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);

  const addBlock = (type: ContentBlock["type"]) => {
    onChange([
      ...blocks,
      {
        id: `${Date.now()}-${Math.random()}`, // Unique ID for stable React key
        type,
        position: blocks.length,
        text: type === "text" ? "" : undefined
      },
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
    onUploadStatusChange?.(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("setId", setId);

      const result = await uploadCardAsset(formData);
      if (!result?.assetId) {
        throw new Error("Upload failed: no asset ID returned");
      }

      updateBlock(index, { assetId: result.assetId });
      toast.success("✓ File uploaded successfully");
    } catch (e: any) {
      const errorMsg = e.message?.includes("BLOB_READ_WRITE_TOKEN")
        ? "Server error: Vercel Blob credentials missing. Contact admin."
        : e.message || "Upload failed. Please try again.";
      toast.error(errorMsg, { duration: 5000 });
      console.error("Upload error:", e);
    } finally {
      setUploadingIndex(null);
      onUploadStatusChange?.(false);
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
        <div key={block.id || i} className="flex items-start gap-2">
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
                <div className="rounded border bg-muted/50 p-3">
                  {uploadingIndex === i ? (
                    <div className="flex items-center justify-center gap-2 py-4">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Uploading...</span>
                    </div>
                  ) : block.assetId ? (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">
                        {block.type.toUpperCase()} ASSET
                      </div>
                      {block.type === "image" ? (
                        <img
                          src={`/api/assets/${block.assetId}`}
                          alt="uploaded asset preview"
                          className="max-h-40 w-auto max-w-full rounded border border-border object-contain"
                        />
                      ) : block.type === "video" ? (
                        <video
                          src={`/api/assets/${block.assetId}`}
                          controls
                          className="max-h-40 w-auto max-w-full rounded border border-border"
                        />
                      ) : (
                        <div className="bg-muted rounded p-2 text-xs text-muted-foreground">
                          File attached
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-8 gap-2">
                      <Upload className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">No file uploaded</span>
                    </div>
                  )}
                  <input
                    type="file"
                    className="hidden"
                    ref={(el) => {
                      if (el && block.id) fileInputRefs.current[block.id] = el;
                    }}
                    onChange={(e) => onFileChange(i, e)}
                  />
                  <button
                    type="button"
                    className="mt-2 w-full text-xs text-accent-foreground hover:underline rounded bg-accent py-1 font-medium disabled:opacity-50"
                    onClick={() => {
                      if (block.id && fileInputRefs.current[block.id]) {
                        fileInputRefs.current[block.id]?.click();
                      }
                    }}
                    disabled={uploadingIndex === i}
                  >
                    {block.assetId ? "Change File" : "Upload File"}
                  </button>
                </div>
              </div>
            )}
          </div>
          <button type="button" onClick={() => removeBlock(i)} className="mt-1">
            <Trash2 size={16} className="text-destructive" />
          </button>
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <button type="button" className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs hover:bg-muted" onClick={() => addBlock("text")}>
          <Plus size={12} /> Text
        </button>
        <button type="button" className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs hover:bg-muted" onClick={() => addBlock("image")}>
          <Plus size={12} /> Image
        </button>
        <button type="button" className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs hover:bg-muted" onClick={() => addBlock("video")}>
          <Plus size={12} /> Video
        </button>
        <button type="button" className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs hover:bg-muted" onClick={() => addBlock("file")}>
          <Plus size={12} /> File
        </button>
      </div>
    </div>
  );
}
