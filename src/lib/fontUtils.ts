import * as opentype from 'opentype.js';

export type FontCategory = 'kanji' | 'hiragana' | 'katakana' | 'latin' | 'symbols';

export const isInRange = (code: number, category: FontCategory): boolean => {
  switch (category) {
    case 'hiragana':
      return code >= 0x3040 && code <= 0x309F;
    case 'katakana':
      return code >= 0x30A0 && code <= 0x30FF;
    case 'kanji':
      return (code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF);
    case 'latin':
      return (code >= 0x0020 && code <= 0x007E);
    case 'symbols':
      return (code >= 0x0020 && code <= 0x002F) || 
             (code >= 0x003A && code <= 0x0040) ||
             (code >= 0x005B && code <= 0x0060) ||
             (code >= 0x007B && code <= 0x007E) ||
             (code >= 0x3000 && code <= 0x303F);
    default:
      return false;
  }
};

interface Point { x: number; y: number }

export const interpolatePaths = (pathA: any, pathB: any, ratio: number): any => {
  if (ratio <= 0.001) return pathA;
  if (ratio >= 0.999) return pathB;

  const cmdsA = pathA.commands;
  const cmdsB = pathB.commands;

  // 構造が完全一致する場合の高速直接補間
  if (cmdsA.length === cmdsB.length && cmdsA.every((c: any, i: number) => c.type === cmdsB[i].type)) {
    return directInterpolate(cmdsA, cmdsB, ratio);
  }

  // 構造が異なる場合のリサンプリング補間（安定版）
  return resampledInterpolate(cmdsA, cmdsB, ratio);
};

function directInterpolate(cmdsA: any[], cmdsB: any[], ratio: number): any {
  const path = new opentype.Path();
  const lerp = (v1: number, v2: number) => v1 + (v2 - v1) * ratio;

  for (let i = 0; i < cmdsA.length; i++) {
    const a = cmdsA[i], b = cmdsB[i];
    switch (a.type) {
      case 'M': path.moveTo(lerp(a.x, b.x), lerp(a.y, b.y)); break;
      case 'L': path.lineTo(lerp(a.x, b.x), lerp(a.y, b.y)); break;
      case 'Q': path.quadraticCurveTo(lerp(a.x1, b.x1), lerp(a.y1, b.y1), lerp(a.x, b.x), lerp(a.y, b.y)); break;
      case 'C': path.curveTo(lerp(a.x1, b.x1), lerp(a.y1, b.y1), lerp(a.x2, b.x2), lerp(a.y2, b.y2), lerp(a.x, b.x), lerp(a.y, b.y)); break;
      case 'Z': path.close(); break;
    }
  }
  return path;
}

function resampledInterpolate(cmdsA: any[], cmdsB: any[], ratio: number): any {
  const contoursA = commandsToContours(cmdsA);
  const contoursB = commandsToContours(cmdsB);
  
  // 向き（Winding）を正規化（すべて時計回りに）
  contoursA.forEach(c => normalizeWinding(c));
  contoursB.forEach(c => normalizeWinding(c));

  const matched = matchContours(contoursA, contoursB);
  const path = new opentype.Path();

  for (const { cA, cB } of matched) {
    if (!cA && cB) { addContourToPath(path, cB, ratio); continue; }
    if (cA && !cB) { addContourToPath(path, cA, 1.0 - ratio); continue; }
    if (!cA || !cB) continue;

    // 複雑な漢字に対応するためサンプル数を増加 (128点固定)
    const N = 128; 
    let ptsA = resampleContour(cA, N);
    let ptsB = alignStartingPoint(ptsA, resampleContour(cB, N));

    const interpolated = ptsA.map((p, i) => ({
      x: p.x + (ptsB[i].x - p.x) * ratio,
      y: p.y + (ptsB[i].y - p.y) * ratio
    }));

    // 安定性を重視し、高密度ポリラインとして再構築
    reconstructPath(path, interpolated);
  }
  return path;
}

function commandsToContours(cmds: any[]): Point[][] {
  const contours: Point[][] = [];
  let current: Point[] = [];
  let cx = 0, cy = 0;

  for (const cmd of cmds) {
    switch (cmd.type) {
      case 'M':
        if (current.length > 0) contours.push(current);
        current = [{ x: cmd.x, y: cmd.y }];
        cx = cmd.x; cy = cmd.y;
        break;
      case 'L':
        current.push({ x: cmd.x, y: cmd.y });
        cx = cmd.x; cy = cmd.y;
        break;
      case 'Q': {
        const steps = 6;
        for (let t = 1; t <= steps; t++) {
          const tt = t / steps;
          const inv = 1 - tt;
          current.push({
            x: inv * inv * cx + 2 * inv * tt * cmd.x1 + tt * tt * cmd.x,
            y: inv * inv * cy + 2 * inv * tt * cmd.y1 + tt * tt * cmd.y
          });
        }
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case 'C': {
        const steps = 8;
        for (let t = 1; t <= steps; t++) {
          const tt = t / steps;
          const inv = 1 - tt;
          current.push({
            x: inv*inv*inv*cx + 3*inv*inv*tt*cmd.x1 + 3*inv*tt*tt*cmd.x2 + tt*tt*tt*cmd.x,
            y: inv*inv*inv*cy + 3*inv*inv*tt*cmd.y1 + 3*inv*tt*tt*cmd.y2 + tt*tt*tt*cmd.y
          });
        }
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case 'Z':
        if (current.length > 0) contours.push(current);
        current = [];
        break;
    }
  }
  if (current.length > 0) contours.push(current);
  return contours;
}

function normalizeWinding(pts: Point[]) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += (pts[i].x * pts[j].y) - (pts[j].x * pts[i].y);
  }
  if (area < 0) pts.reverse();
}

function matchContours(cA: Point[][], cB: Point[][]) {
  const infoA = cA.map((c, i) => ({ idx: i, ...contourInfo(c) }));
  const infoB = cB.map((c, i) => ({ idx: i, ...contourInfo(c) }));
  const usedB = new Set<number>();
  const matched: { cA: Point[] | null, cB: Point[] | null }[] = [];

  for (const a of infoA) {
    let bestIdx = -1;
    let bestScore = Infinity;
    for (const b of infoB) {
      if (usedB.has(b.idx)) continue;
      // 重心距離と面積差でマッチング
      const score = Math.sqrt(Math.pow(a.cx - b.cx, 2) + Math.pow(a.cy - b.cy, 2)) + Math.abs(Math.sqrt(a.area) - Math.sqrt(b.area)) * 2;
      if (score < bestScore) { bestScore = score; bestIdx = b.idx; }
    }
    if (bestIdx >= 0) { usedB.add(bestIdx); matched.push({ cA: cA[a.idx], cB: cB[bestIdx] }); }
    else { matched.push({ cA: cA[a.idx], cB: null }); }
  }
  for (const b of infoB) if (!usedB.has(b.idx)) matched.push({ cA: null, cB: cB[b.idx] });
  return matched;
}

function contourInfo(pts: Point[]) {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    area += cross; cx += (pts[i].x + pts[j].x) * cross; cy += (pts[i].y + pts[j].y) * cross;
  }
  area = Math.abs(area) / 2;
  if (area > 1) { cx /= (6 * area); cy /= (6 * area); }
  else { cx = pts.reduce((s, p) => s + p.x, 0) / pts.length; cy = pts.reduce((s, p) => s + p.y, 0) / pts.length; }
  return { area, cx, cy };
}

function resampleContour(pts: Point[], N: number): Point[] {
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) {
    lengths.push(lengths[i-1] + Math.sqrt(Math.pow(pts[i].x-pts[i-1].x, 2) + Math.pow(pts[i].y-pts[i-1].y, 2)));
  }
  const total = lengths[lengths.length-1] + Math.sqrt(Math.pow(pts[0].x-pts[pts.length-1].x, 2) + Math.pow(pts[0].y-pts[pts.length-1].y, 2));
  const res: Point[] = [];
  const closedPts = [...pts, pts[0]];
  const closedArcs = [...lengths, total];

  for (let i = 0; i < N; i++) {
    const target = (i / N) * total;
    let lo = 0, hi = closedArcs.length - 2;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (closedArcs[mid+1] < target) lo = mid + 1; else hi = mid; }
    const t = (target - closedArcs[lo]) / (closedArcs[lo+1] - closedArcs[lo] || 1);
    res.push({ x: closedPts[lo].x + (closedPts[lo+1].x - closedPts[lo].x) * t, y: closedPts[lo].y + (closedPts[lo+1].y - closedPts[lo].y) * t });
  }
  return res;
}

function alignStartingPoint(ptsA: Point[], ptsB: Point[]): Point[] {
  const N = ptsA.length;
  let bestOffset = 0, bestDist = Infinity;
  // 全探索で最適な開始位置を探る
  for (let i = 0; i < N; i++) {
    let dist = 0;
    for (let j = 0; j < N; j++) {
      dist += Math.pow(ptsA[j].x - ptsB[(j+i)%N].x, 2) + Math.pow(ptsA[j].y - ptsB[(j+i)%N].y, 2);
    }
    if (dist < bestDist) { bestDist = dist; bestOffset = i; }
  }
  return [...ptsB.slice(bestOffset), ...ptsB.slice(0, bestOffset)];
}

function reconstructPath(path: any, pts: Point[]) {
  if (pts.length < 2) return;
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    path.lineTo(pts[i].x, pts[i].y);
  }
  path.close();
}

function addContourToPath(path: any, contour: Point[], opacity: number) {
  if (contour.length < 2 || opacity < 0.01) return;
  const cx = contour.reduce((s, p) => s + p.x, 0) / contour.length;
  const cy = contour.reduce((s, p) => s + p.y, 0) / contour.length;
  const scaled = contour.map(p => ({ x: cx + (p.x-cx)*opacity, y: cy + (p.y-cy)*opacity }));
  reconstructPath(path, scaled);
}

export const scalePath = (path: any, scale: number): any => {
  if (scale === 1) return path;
  const newPath = new opentype.Path();
  path.commands.forEach((cmd: any) => {
    const newCmd = { ...cmd };
    ['x', 'y', 'x1', 'y1', 'x2', 'y2'].forEach(key => { if (key in newCmd) newCmd[key] *= scale; });
    newPath.commands.push(newCmd);
  });
  return newPath;
};

export const getWeightNumber = (name: string): number => {
  const weights: Record<string, number> = { 'Light': 300, 'Regular': 400, 'Medium': 500, 'SemiBold': 600, 'Bold': 700, 'Black': 900 };
  return weights[name] || 400;
};
