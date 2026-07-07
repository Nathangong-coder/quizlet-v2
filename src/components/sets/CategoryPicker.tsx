import React, { useId, useState } from "react";
import { X } from "lucide-react";
import { normalizeCategoryName } from "@/lib/cards/categories";

interface CategoryOption {
  name: string;
  color?: string | null;
}

interface CategoryPickerProps {
  value: string[];
  available: CategoryOption[];
  onChange: (names: string[]) => void;
  onCreateCategory?: (name: string) => void;
}

export function CategoryPicker({
  value,
  available,
  onChange,
  onCreateCategory,
}: CategoryPickerProps) {
  const [input, setInput] = useState("");
  const listId = useId();

  const colorFor = (name: string) =>
    available.find(
      (c) => normalizeCategoryName(c.name) === normalizeCategoryName(name),
    )?.color ?? null;

  const addCategory = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    const norm = normalizeCategoryName(name);
    if (value.some((v) => normalizeCategoryName(v) === norm)) {
      setInput("");
      return;
    }
    const isNew = !available.some((c) => normalizeCategoryName(c.name) === norm);
    if (isNew) onCreateCategory?.(name);
    onChange([...value, name]);
    setInput("");
  };

  const removeCategory = (name: string) =>
    onChange(value.filter((v) => v !== name));

  const suggestions = available.filter(
    (c) => !value.some((v) => normalizeCategoryName(v) === normalizeCategoryName(c.name)),
  );

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((name) => {
            const color = colorFor(name);
            return (
              <span
                key={name}
                className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
                style={
                  color
                    ? { backgroundColor: `${color}20`, borderColor: color, color }
                    : undefined
                }
              >
                {name}
                <button
                  type="button"
                  onClick={() => removeCategory(name)}
                  aria-label={`Remove ${name}`}
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <input
        type="text"
        list={listId}
        placeholder="Add category..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addCategory(input);
          }
        }}
        onBlur={() => {
          if (input.trim()) addCategory(input);
        }}
        className="w-full rounded border p-2 text-sm"
      />
      <datalist id={listId}>
        {suggestions.map((c) => (
          <option key={c.name} value={c.name} />
        ))}
      </datalist>
    </div>
  );
}
