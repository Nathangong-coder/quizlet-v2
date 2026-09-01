'use client'

import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  ContentBlock,
  getNumberedListIndex,
  isTextMarkActive,
  remapTextMarksForTextChange,
  toggleTextMark,
  type InlineMarkKey,
} from "@/lib/cards/content";
import {
  Bold,
  Highlighter,
  Italic,
  Trash2,
  Plus,
  Upload,
  Loader2,
  List,
  ListOrdered,
  IndentIncrease,
  IndentDecrease,
  Underline,
} from "lucide-react";
import { AIAutocompleteButton } from "./AIAutocompleteButton";
import { uploadCardAsset } from "@/actions/uploads";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function AutoResizeTextarea({
  value,
  onChange,
  onKeyDown,
  onSelect,
  onKeyUp,
  onClick,
  inputRef,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  onSelect?: React.ReactEventHandler<HTMLTextAreaElement>;
  onKeyUp?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  onClick?: React.MouseEventHandler<HTMLTextAreaElement>;
  inputRef?: React.Ref<HTMLTextAreaElement>;
  className?: string;
  ariaLabel: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset before measuring so the field also shrinks when text is deleted.
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    resize();
  }, [resize, value]);

  return (
    <textarea
      ref={inputRef ?? textareaRef}
      aria-label={ariaLabel}
      className={cn(
        "block min-h-[10rem] w-full resize-none overflow-hidden rounded-[6px] border border-transparent bg-card px-3 py-3 text-sm leading-6 transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      value={value}
      onChange={onChange}
      onInput={resize}
      onKeyDown={onKeyDown}
      onSelect={onSelect}
      onKeyUp={onKeyUp}
      onClick={onClick}
    />
  );
}

interface RichCardSideEditorProps {
  blocks: ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
  onUploadStatusChange?: (isUploading: boolean) => void;
  setId: string;
  side: "term" | "definition";
  categories: string[];
  referenceText: string;
  onFillCard: (term: string, definition: string) => void;
}

export function RichCardSideEditor({
  blocks,
  onChange,
  onUploadStatusChange,
  setId,
  side,
  categories,
  referenceText,
  onFillCard,
}: RichCardSideEditorProps) {
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const selectionRefs = useRef<Record<string, { start: number; end: number }>>({});
  const [selectionByBlock, setSelectionByBlock] = useState<Record<string, { start: number; end: number }>>({});
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);

  const getBlockKey = (block: ContentBlock, index: number) => `${side}:${block.id ?? index}`;

  const rememberSelection = (key: string, textarea: HTMLTextAreaElement) => {
    const next = { start: textarea.selectionStart ?? 0, end: textarea.selectionEnd ?? 0 };
    selectionRefs.current[key] = next;
    setSelectionByBlock((previous) => {
      const current = previous[key];
      if (current?.start === next.start && current.end === next.end) return previous;
      return { ...previous, [key]: next };
    });
  };

  const addBlock = (type: ContentBlock["type"]) => {
    onChange([
      ...blocks,
      {
        id: `${Date.now()}-${Math.random()}`, // Unique ID for stable React key
        type,
        position: blocks.length,
        text: type === "text" ? "" : undefined,
        listType: null,
        indent: 0,
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

  const toggleList = (index: number, listType: 'bullet' | 'numbered') => {
    const block = blocks[index]
    updateBlock(index, { listType: block.listType === listType ? null : listType })
  }

  const changeIndent = (index: number, delta: number) => {
    const current = blocks[index]?.indent ?? 0
    updateBlock(index, { indent: Math.min(6, Math.max(0, current + delta)) })
  }

  const applyTextMark = (index: number, key: InlineMarkKey) => {
    const block = blocks[index];
    if (block?.type !== 'text') return;

    const blockKey = getBlockKey(block, index);
    const selection = selectionRefs.current[blockKey] ?? { start: 0, end: 0 };
    if (selection.start === selection.end) return;

    updateBlock(index, {
      marks: toggleTextMark(
        block.marks,
        selection.start,
        selection.end,
        key,
        (block.text ?? '').length,
      ),
    });

    // Keep the selection visible after the controlled textarea re-renders.
    requestAnimationFrame(() => {
      const textarea = textareaRefs.current[blockKey];
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(selection.start, selection.end);
    });
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
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Upload failed. Please try again.";
      const errorMsg = message.includes("BLOB_READ_WRITE_TOKEN")
        ? "Server error: Vercel Blob credentials missing. Contact admin."
        : message;
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
    <div className="flex min-w-0 flex-col gap-2">
      {blocks.map((block, i) => (
        <div key={block.id || i} className="flex min-w-0 items-start gap-2">
          <div className="relative min-w-0 flex-grow">
            {block.type === "text" ? (
              <div className="relative rounded-[6px] border border-input bg-card">
                <div className="flex flex-wrap items-center gap-1 border-b border-border/70 px-2 py-1.5" role="toolbar" aria-label={`Formatting for paragraph ${i + 1}`}>
                  <span className="mr-1 shrink-0 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Paragraph {i + 1}</span>
                  {([
                    { key: 'bold', label: 'Bold', Icon: Bold },
                    { key: 'italic', label: 'Italic', Icon: Italic },
                    { key: 'underline', label: 'Underline', Icon: Underline },
                    { key: 'highlight', label: 'Highlight', Icon: Highlighter },
                  ] as const).map(({ key, label, Icon }) => {
                    const blockKey = getBlockKey(block, i);
                    const selection = selectionByBlock[blockKey] ?? { start: 0, end: 0 };
                    const active = isTextMarkActive(
                      block.marks,
                      selection.start,
                      selection.end,
                      key,
                      (block.text ?? '').length,
                    );

                    return (
                      <button
                        key={key}
                        type="button"
                        aria-label={label}
                        aria-pressed={active}
                        title={`${label} selected text`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applyTextMark(i, key)}
                        className={cn(
                          "inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                          active && "bg-primary/10 text-primary",
                        )}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    aria-label="Bulleted list"
                    aria-pressed={block.listType === 'bullet'}
                    title="Bulleted list"
                    onClick={() => toggleList(i, 'bullet')}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${block.listType === 'bullet' ? 'bg-primary/10 text-primary' : ''}`}
                  >
                    <List className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Numbered list"
                    aria-pressed={block.listType === 'numbered'}
                    title="Numbered list"
                    onClick={() => toggleList(i, 'numbered')}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${block.listType === 'numbered' ? 'bg-primary/10 text-primary' : ''}`}
                  >
                    <ListOrdered className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
                  <button
                    type="button"
                    aria-label="Decrease paragraph indent"
                    title="Decrease indent"
                    onClick={() => changeIndent(i, -1)}
                    disabled={(block.indent ?? 0) === 0}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35"
                  >
                    <IndentDecrease className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Increase paragraph indent"
                    title="Increase indent"
                    onClick={() => changeIndent(i, 1)}
                    disabled={(block.indent ?? 0) >= 6}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35"
                  >
                    <IndentIncrease className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <div className="ml-auto flex shrink-0 items-center gap-1 border-l border-border/70 pl-1">
                    <AIAutocompleteButton
                      setId={setId}
                      currentText={block.text || ""}
                      side={side}
                      categories={categories}
                      referenceText={referenceText}
                      onSelect={(s) => updateBlock(i, { text: s })}
                      onFillCard={onFillCard}
                    />
                  </div>
                </div>
                <div className="flex justify-end border-b border-border/50 px-2 py-1">
                  <span className="text-[0.68rem] leading-none text-muted-foreground">Tab to indent · Shift+Tab to outdent</span>
                </div>
                <div className="relative">
                  {block.listType && (
                    <span
                      className="pointer-events-none absolute left-3 top-3 min-w-5 text-right text-sm font-semibold leading-6 text-primary"
                      aria-hidden="true"
                    >
                      {block.listType === 'bullet' ? '•' : `${getNumberedListIndex(blocks, i) + 1}.`}
                    </span>
                  )}
                  <AutoResizeTextarea
                    inputRef={(node) => {
                      textareaRefs.current[getBlockKey(block, i)] = node;
                    }}
                    value={block.text || ""}
                    ariaLabel={`${side === 'term' ? 'Term' : 'Definition'} paragraph ${i + 1}`}
                    className={block.listType ? "pl-11" : undefined}
                    onChange={(event) => {
                      const textarea = event.currentTarget;
                      const nextText = textarea.value;
                      const blockKey = getBlockKey(block, i);
                      rememberSelection(blockKey, textarea);
                      updateBlock(i, {
                        text: nextText,
                        marks: remapTextMarksForTextChange(block.marks, block.text || "", nextText),
                      });
                    }}
                    onSelect={(event) => rememberSelection(getBlockKey(block, i), event.currentTarget)}
                    onKeyUp={(event) => rememberSelection(getBlockKey(block, i), event.currentTarget)}
                    onClick={(event) => rememberSelection(getBlockKey(block, i), event.currentTarget)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Tab') return
                      const currentIndent = block.indent ?? 0
                      const nextIndent = event.shiftKey
                        ? Math.max(0, currentIndent - 1)
                        : Math.min(6, currentIndent + 1)

                      // Keep normal keyboard navigation available at the
                      // boundaries. Tab only becomes an indent shortcut when
                      // there is actually an indentation change to make.
                      if (nextIndent === currentIndent) return
                      event.preventDefault()
                      changeIndent(i, event.shiftKey ? -1 : 1)
                    }}
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
          <Plus size={12} /> Paragraph
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
