// Deterministic block segmentation (SPECS "Parsing heuristics"): font-size
// jumps, numbering patterns, all-caps lines, and vertical whitespace gaps
// turn a flat stream of positioned text items into ordered Block[]. Pure and
// unit-tested against easy.pdf (D-009).
//
// v1 reads items in the order pdf.js emits them per page and ignores
// x-position when grouping lines (SPECS "ignore x-position in v1") — this is
// what breaks on a multi-column page (hard.pdf); accepted (D-004).

import type { BBox, Block, PositionedItem } from '../types';
import { assignBlockIds } from '../id';

type Line = {
  page: number;
  y: number;
  fontSize: number;
  text: string;
  bbox: BBox;
};

const Y_EPSILON = 3; // items within this many pt of each other share a line
const DEDUPE_BUCKET = 2; // collapses the same text redrawn at ~the same spot (bold/shadow rendering)

// Requires an actual period (or decimal dotting) after the leading number —
// "1. Introduction" / "2.1 Scope" — not just a bare digit, which would
// false-positive on street numbers ("305 S Elm Street").
const NUMBERING_RE = /^(\d+(\.\d+)+|\d+\.|[A-Z]\.)\s+\S/;
const SECTION_RE = /^SECTION\s+\d+/i;
const ALL_CAPS_RE = /^[A-Z0-9][A-Z0-9 &/,.'()-]*$/;
const MAX_HEADING_CHARS = 70;

/**
 * pdf.js sometimes emits the identical glyph run twice at (near) the same
 * position (bold-via-double-draw, drop shadows), not necessarily adjacent in
 * the raw stream and not always at the exact same coordinate. Collapse any
 * item whose (page, text) matches a previously accepted one within
 * DEDUPE_BUCKET points on both axes.
 */
export function dedupe(items: PositionedItem[]): PositionedItem[] {
  const out: PositionedItem[] = [];
  const accepted = new Map<string, PositionedItem[]>();
  for (const it of items) {
    const key = `${it.page}:${it.text}`;
    const prior = accepted.get(key);
    const isDuplicate = prior?.some(
      (p) => Math.abs(p.x - it.x) <= DEDUPE_BUCKET && Math.abs(p.y - it.y) <= DEDUPE_BUCKET,
    );
    if (isDuplicate) continue;
    out.push(it);
    if (prior) prior.push(it);
    else accepted.set(key, [it]);
  }
  return out;
}

/** Groups items that share a y-coordinate (within Y_EPSILON) into one visual
 * line, sorting each line's items left-to-right for correct word order. */
function groupLines(items: PositionedItem[]): Line[] {
  const lines: Line[] = [];
  let bucket: PositionedItem[] = [];

  const flush = () => {
    if (!bucket.length) return;
    const sorted = [...bucket].sort((a, b) => a.x - b.x);
    const text = sorted
      .map((i) => i.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) {
      const x0 = Math.min(...sorted.map((i) => i.bbox[0]));
      const y0 = Math.min(...sorted.map((i) => i.bbox[1]));
      const x1 = Math.max(...sorted.map((i) => i.bbox[2]));
      const y1 = Math.max(...sorted.map((i) => i.bbox[3]));
      const fontSize = Math.max(...sorted.map((i) => i.fontSize ?? 0));
      lines.push({ page: sorted[0].page, y: sorted[0].y, fontSize, text, bbox: [x0, y0, x1, y1] });
    }
    bucket = [];
  };

  for (const it of items) {
    const last = bucket[bucket.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= Y_EPSILON) {
      bucket.push(it);
    } else {
      flush();
      bucket.push(it);
    }
  }
  flush();
  return lines;
}

function isHeadingLine(text: string, fontSize: number, bodyFontSize: number): boolean {
  if (text.length > MAX_HEADING_CHARS) return false;
  if (SECTION_RE.test(text)) return true;
  if (NUMBERING_RE.test(text)) return true;
  if (fontSize > bodyFontSize * 1.3) return true;
  if (ALL_CAPS_RE.test(text) && /[A-Z]/.test(text)) return true;
  return false;
}

/** Mode of rounded line font sizes — the dominant body-text size, used as the
 * baseline for the font-size-jump heading signal. */
function bodyFontSizeOf(lines: Line[]): number {
  const counts = new Map<number, number>();
  for (const l of lines) {
    const rounded = Math.round(l.fontSize);
    counts.set(rounded, (counts.get(rounded) ?? 0) + 1);
  }
  let mode = 12;
  let best = 0;
  for (const [size, count] of counts) {
    if (count > best) {
      best = count;
      mode = size;
    }
  }
  return mode;
}

function mergeBBox(a: BBox, b: BBox): BBox {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

type Draft = { type: 'heading' | 'paragraph'; page: number; text: string[]; bbox: BBox };

export function segment(rawItems: PositionedItem[]): Block[] {
  const items = dedupe(rawItems);
  const lines = groupLines(items);
  if (!lines.length) return [];

  const bodyFontSize = bodyFontSizeOf(lines);

  // Typical single-line gap (median), used to tell "wrapped line" from "new
  // paragraph" apart. Computed once globally — a proposal's body typography
  // is fairly uniform, which is good enough for v1 scope.
  const gaps = lines
    .map((l, i) => (i > 0 && lines[i - 1].page === l.page ? lines[i - 1].y - l.y : null))
    .filter((g): g is number => g !== null && g > 0)
    .sort((a, b) => a - b);
  const typicalGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 14;
  const paragraphBreakGap = typicalGap * 1.6;

  const drafts: Draft[] = [];
  let prevLine: Line | null = null;

  for (const line of lines) {
    const type: 'heading' | 'paragraph' = isHeadingLine(line.text, line.fontSize, bodyFontSize)
      ? 'heading'
      : 'paragraph';
    const last = drafts[drafts.length - 1];
    const sameBlock =
      prevLine !== null &&
      last !== undefined &&
      last.type === type &&
      prevLine.page === line.page &&
      prevLine.y - line.y <= paragraphBreakGap;

    if (sameBlock) {
      last.text.push(line.text);
      last.bbox = mergeBBox(last.bbox, line.bbox);
    } else {
      drafts.push({ type, page: line.page, text: [line.text], bbox: line.bbox });
    }
    prevLine = line;
  }

  const raw = drafts.map((d) => ({
    type: d.type,
    text: d.text.join(' ').replace(/\s+/g, ' ').trim(),
    page: d.page,
    bbox: d.bbox,
  }));

  return assignBlockIds(raw);
}
