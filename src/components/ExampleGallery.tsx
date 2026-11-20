import { useMemo, useState, type CSSProperties } from "react";
import { ArrowRight, Search } from "lucide-react";
import type { DiagramTemplate } from "../types";
import { TEMPLATES } from "../lib/templates";
import { getTheme } from "../lib/themes";
import Modal from "./Modal";

export default function ExampleGallery({
  onChoose,
  onClose,
}: {
  onChoose: (template: DiagramTemplate) => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const categories = useMemo(
    () => ["All", ...new Set(TEMPLATES.map((template) => template.category))],
    [],
  );
  const matches = TEMPLATES.filter(
    (template) =>
      (category === "All" || template.category === category) &&
      `${template.title} ${template.description} ${template.category}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <Modal
      title="Find your starting point."
      eyebrow="EXAMPLE COLLECTION"
      wide
      onClose={onClose}
      initialFocus="input"
    >
      <p className="modal-intro">
        Every example opens as a new project. Your existing work stays saved.
      </p>
      <label className="search-field">
        <Search size={16} />
        <input
          aria-label="Search examples"
          placeholder="Search examples, diagram types, or ideas…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="filter-chips" aria-label="Example categories">
        {categories.map((value) => (
          <button
            key={value}
            className={value === category ? "selected" : ""}
            aria-pressed={value === category}
            onClick={() => setCategory(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="example-grid">
        {matches.map((template, index) => (
          <button
            key={template.id}
            className="example-card"
            onClick={() => onChoose(template)}
            style={
              {
                "--example-accent": getTheme(template.theme).accent,
                "--example-background": getTheme(template.theme).canvas,
              } as CSSProperties
            }
          >
            <div className="example-art" aria-hidden="true">
              <svg viewBox="0 0 240 105">
                <path
                  d={
                    index % 2
                      ? "M48 52H100M140 52H192M120 32V12M120 72V94"
                      : "M65 30H120V72H179M65 30H179"
                  }
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  opacity=".45"
                />
                <rect
                  x="25"
                  y={index % 2 ? 36 : 14}
                  width="55"
                  height="32"
                  rx="6"
                />
                <rect x="95" y="36" width="55" height="32" rx="6" />
                <rect
                  x="165"
                  y={index % 2 ? 36 : 56}
                  width="55"
                  height="32"
                  rx="6"
                />
              </svg>
              <span>{template.category}</span>
            </div>
            <div className="example-copy">
              <h3>{template.title}</h3>
              <p>{template.description}</p>
              <span>
                Use this example
                <ArrowRight size={14} />
              </span>
            </div>
          </button>
        ))}
      </div>
      {!matches.length && (
        <p className="empty-search">
          No examples found. Try a different search or category.
        </p>
      )}
    </Modal>
  );
}
