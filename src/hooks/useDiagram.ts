import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RenderResult, StudioDocument } from "../types";
import { normalizeSource } from "../lib/storage";
import { renderDiagram, renderFingerprint } from "../lib/render";

export function useDiagram(document: StudioDocument) {
  const [result, setResult] = useState<RenderResult | null>(null);
  const [renderedDocument, setRenderedDocument] =
    useState<StudioDocument | null>(null);
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(false);
  const [live, setLive] = useState(true);
  const [request, setRequest] = useState(0);
  const [completed, setCompleted] = useState("");
  const previousRequest = useRef(-1);
  const latest = useRef(document);
  latest.current = document;
  const source = useMemo(
    () => normalizeSource(document.source),
    [document.source],
  );
  const blank = source.trim() === "";
  const fingerprint = useMemo(
    () =>
      renderFingerprint(
        source,
        document.settings,
        document.nodeAccents,
        document.design,
      ),
    [source, document.settings, document.nodeAccents, document.design],
  );
  const renderNow = useCallback(() => setRequest((value) => value + 1), []);

  useEffect(() => {
    const manual = previousRequest.current !== request;
    previousRequest.current = request;
    if (blank) {
      setResult(null);
      setRenderedDocument(null);
      setError("");
      setRendering(false);
      setCompleted(fingerprint);
      return;
    }
    if (!live && !manual) {
      setRendering(false);
      return;
    }
    const controller = new AbortController();
    setRendering(true);
    const timer = window.setTimeout(
      async () => {
        const current = latest.current;
        try {
          const next = await renderDiagram(
            source,
            current.settings,
            current.nodeAccents,
            current.design,
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          setResult(next);
          setRenderedDocument(current);
          setError("");
          setCompleted(fingerprint);
        } catch (reason) {
          if (!controller.signal.aborted)
            setError(
              reason instanceof Error
                ? reason.message.slice(0, 2200)
                : "Could not render this diagram. Check the source and try again.",
            );
        } finally {
          if (!controller.signal.aborted) setRendering(false);
        }
      },
      manual ? 0 : 280,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [fingerprint, source, blank, live, request]);

  const stale = !blank && completed !== fingerprint;
  // A failed edit keeps the last known drawing and its styling together. Framing
  // metadata can still update without triggering layout or changing source.
  const stageDocument = useMemo(
    () =>
      stale && renderedDocument
        ? {
            ...renderedDocument,
            title: document.title,
            subtitle: document.subtitle,
            storyboard: document.storyboard,
            settings: {
              ...renderedDocument.settings,
              frame: document.settings.frame,
              padding: document.settings.padding,
              showTitle: document.settings.showTitle,
              showBrand: document.settings.showBrand,
              background: document.settings.background,
              ambient: document.settings.ambient,
            },
          }
        : document,
    [stale, renderedDocument, document],
  );
  return {
    result,
    error,
    rendering,
    live,
    setLive,
    renderNow,
    fingerprint,
    stale,
    blank,
    stageDocument,
  };
}
