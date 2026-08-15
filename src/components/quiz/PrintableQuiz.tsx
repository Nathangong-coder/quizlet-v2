"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft, FileText } from "lucide-react";
import type { PrintableTest, PrintBlock, PrintSection } from "@/lib/quiz/printable";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Captures the first frame of a video to a canvas so it prints as an image. */
function VideoThumb({ src, name }: { src: string; name?: string }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = document.createElement("video");
    // Same-origin (/api/assets proxy) — no crossOrigin so the auth cookie is
    // still sent; same-origin frames don't taint the canvas.
    video.muted = true;
    video.preload = "auto";
    video.src = src;

    const grab = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 180;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          setThumb(canvas.toDataURL("image/png"));
        }
      } catch {
        setFailed(true);
      }
    };
    const onLoaded = () => {
      try {
        video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
      } catch {
        grab();
      }
    };

    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("seeked", grab);
    video.addEventListener("error", () => setFailed(true));
    return () => {
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("seeked", grab);
    };
  }, [src]);

  if (thumb) {
    return (
      <span className="inline-block">
        <img src={thumb} alt={name || "video frame"} className="max-h-48 rounded border" />
        <span className="block text-xs text-muted-foreground mt-1">🎬 {name} (video still)</span>
      </span>
    );
  }
  if (failed) return <FileNotice name={name} url={src} label="video" />;
  return <span className="text-xs text-muted-foreground">Capturing video frame…</span>;
}

function FileNotice({ name, url, label = "file" }: { name?: string; url?: string; label?: string }) {
  return (
    <span className="inline-flex flex-col gap-1 rounded border border-input bg-muted/50 p-3 text-sm">
      <span className="flex items-center gap-2 font-medium">
        <FileText className="h-4 w-4" /> {name || label}
      </span>
      <span className="text-xs text-muted-foreground">
        This {label} can’t be shown on paper — access it digitally
        {url ? (
          <>
            {" "}
            at{" "}
            <a href={url} className="text-primary underline break-all">
              {url}
            </a>
          </>
        ) : null}
        .
      </span>
    </span>
  );
}

function Blocks({ blocks }: { blocks: PrintBlock[] }) {
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        if (b.kind === "text") return <p key={i} className="text-lg whitespace-pre-wrap">{b.text}</p>;
        if (b.kind === "image")
          return (
            <img key={i} src={b.assetUrl} alt={b.text || "image"} className="max-h-56 rounded border" />
          );
        if (b.kind === "video") return <VideoThumb key={i} src={b.assetUrl || ""} name={b.text} />;
        return <FileNotice key={i} name={b.text} url={b.assetUrl} />;
      })}
    </div>
  );
}

function TestSection({ section }: { section: PrintSection }) {
  return (
    <div className="space-y-6 page-break-inside-avoid">
      <h2 className="text-2xl font-bold border-b pb-1">{section.title}</h2>

      {section.mode === "matching" ? (
        <div className="grid grid-cols-2 gap-8">
          <div className="space-y-4">
            {section.matchItems?.map((item) => (
              <div key={item.number} className="flex items-start gap-2">
                <span className="font-bold w-6">{item.number}.</span>
                <div className="flex-1"><Blocks blocks={item.promptBlocks} /></div>
                {/* A ruled blank the learner writes on. Token-derived rather
                    than a literal grey so it survives dark mode on screen; the
                    print rules force a light ground, so it stays legible on
                    paper either way. */}
                <span className="w-10 border-b border-foreground/50 text-center">&nbsp;</span>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {section.matchPool?.map((p) => (
              <div key={p.label} className="flex gap-2 text-sm">
                <span className="font-bold">{p.label}.</span>
                <span>{p.text}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {section.questions.map((q) => (
            <div key={q.number} className="flex gap-3 page-break-inside-avoid">
              <span className="font-bold">{q.number}.</span>
              <div className="flex-grow space-y-3">
                <Blocks blocks={q.promptBlocks} />

                {section.mode === "multiple-choice" && q.options && (
                  <div className="grid grid-cols-1 gap-1.5 pl-2">
                    {q.options.map((opt, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <span className="inline-block h-4 w-4 rounded-full border border-border mt-0.5" />
                        <span className="text-sm">
                          <span className="font-medium mr-1">{LETTERS[idx]}.</span>
                          {opt}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {section.mode === "short-answer" && (
                  <div className="space-y-3 pt-1">
                    <div className="h-6 border-b border-input" />
                    <div className="h-6 border-b border-input" />
                    <div className="h-6 border-b border-input" />
                  </div>
                )}

                {section.mode === "true-false" && (
                  <div className="space-y-2">
                    <div className="rounded border bg-muted/50 p-2 text-sm">
                      {q.statement && <Blocks blocks={q.statement} />}
                    </div>
                    <div className="flex gap-6 text-sm">
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-4 w-4 rounded-full border border-border" /> True
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-4 w-4 rounded-full border border-border" /> False
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnswerSection({ section }: { section: PrintSection }) {
  return (
    <div className="space-y-3 page-break-inside-avoid">
      <h2 className="text-xl font-bold border-b pb-1">{section.title}</h2>
      {section.mode === "matching" ? (
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          {section.matchItems?.map((item) => (
            <div key={item.number} className="flex gap-2">
              <span className="font-bold w-6">{item.number}.</span>
              <span className="font-medium text-success">{item.answerLabel}</span>
            </div>
          ))}
        </div>
      ) : (
        <ol className="space-y-1.5 text-sm">
          {section.questions.map((q) => (
            <li key={q.number} className="flex gap-2">
              <span className="font-bold w-6">{q.number}.</span>
              <span className="font-medium text-success">
                {section.mode === "multiple-choice" && q.correctOptionIndex !== undefined && q.correctOptionIndex >= 0
                  ? `${LETTERS[q.correctOptionIndex]}. ${q.answerText}`
                  : section.mode === "true-false"
                  ? q.tfCorrect
                    ? "True"
                    : "False"
                  : q.answerText}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function PrintableQuiz({ test }: { test: PrintableTest }) {
  const [view, setView] = useState<"test" | "answers">("test");

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="flex justify-between items-center mb-8 print:hidden">
        <Button variant="outline" onClick={() => window.history.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <div className="flex gap-2">
          <Button variant={view === "test" ? "default" : "outline"} onClick={() => setView("test")}>
            Test
          </Button>
          <Button variant={view === "answers" ? "default" : "outline"} onClick={() => setView("answers")}>
            Answer Key
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Print PDF
          </Button>
        </div>
      </div>

      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold mb-2">
          {test.title}
          {view === "answers" && <span className="text-2xl font-normal text-muted-foreground"> — Answer Key</span>}
        </h1>
        {view === "test" && (
          <p className="text-muted-foreground">Name: __________________________ Date: __________</p>
        )}
      </div>

      {test.sections.length === 0 ? (
        <p className="text-center text-muted-foreground">No questions to print.</p>
      ) : (
        <div className="space-y-12">
          {test.sections.map((section) =>
            view === "test" ? (
              <TestSection key={section.mode} section={section} />
            ) : (
              <AnswerSection key={section.mode} section={section} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
