import React, { useState } from "react";
import { X } from "lucide-react";

interface CategoryPickerProps {
  selectedCategories: string[];
  onChange: (categories: string[]) => void;
  availableCategories: string[];
}

export function CategoryPicker({
  selectedCategories,
  onChange,
  availableCategories,
}: CategoryPickerProps) {
  const [input, setInput] = useState("");

  const addCategory = (category: string) => {
    if (category && !selectedCategories.includes(category)) {
      onChange([...selectedCategories, category]);
      setInput("");
    }
  };

  const removeCategory = (category: string) => {
    onChange(selectedCategories.filter((c) => c !== category));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {selectedCategories.map((c) => (
          <span
            key={c}
            className="flex items-center gap-1 rounded bg-blue-100 px-2 py-1 text-sm text-blue-800"
          >
            {c}
            <button onClick={() => removeCategory(c)}>
              <X size={14} />
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        placeholder="Add category..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addCategory(input);
          }
        }}
        className="w-full rounded border p-2 text-sm"
      />
    </div>
  );
}
