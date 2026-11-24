import { useMemo, useState, type CSSProperties } from "react";
import { ArrowRight, Search } from "lucide-react";
import type { DiagramTemplate } from "../types";
import { TEMPLATES } from "../lib/templates";
import { getTheme } from "../lib/themes";
import Modal from "./Modal";

const thumbnails = import.meta.glob<string>("../assets/examples/*.webp", { eager: true, query: "?inline", import: "default" });

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
        {matches.map((template) => (
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
              <img src={thumbnails[`../assets/examples/${template.id}.webp`]} alt="" width={540} height={240} loading="lazy" />
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
