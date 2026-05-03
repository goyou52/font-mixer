import * as opentype from 'opentype.js';
import { 
  isInRange, 
  interpolatePaths, 
  scalePath, 
  getWeightNumber,
  FontCategory
} from '../lib/fontUtils';

self.onmessage = async (e) => {
  const { fontABuffer, fontBBuffer, config, fontAWeight, fontBWeight } = e.data;
  
  try {
    const fontA = opentype.parse(fontABuffer);
    const fontB = opentype.parse(fontBBuffer);
    
    const glyphs: opentype.Glyph[] = [];
    const baseFont = fontA;
    const charSet = new Set<number>();
    
    // サブセットの決定
    if (config.subset) {
      // プレビュー用: 文字列に含まれる文字のみ
      for (const char of config.subset) {
        charSet.add(char.codePointAt(0));
      }
      // 基本的な英数字を含める
      for (let i = 32; i <= 126; i++) charSet.add(i);
    } else {
      // 書き出し用: 全文字
      const collectUnicodes = (font: opentype.Font) => {
        for (let i = 0; i < font.numGlyphs; i++) {
          const g = font.glyphs.get(i);
          if (g.unicode) charSet.add(g.unicode);
          if (g.unicodes) g.unicodes.forEach(u => charSet.add(u));
        }
      };
      collectUnicodes(fontA);
      collectUnicodes(fontB);
    }

    glyphs.push(fontA.glyphs.get(0)); // .notdef

    const codePoints = Array.from(charSet).sort((a, b) => a - b);
    const scaleBToA = baseFont.unitsPerEm / fontB.unitsPerEm;
    const targetWeightNum = getWeightNumber(config.weightName);

    for (const code of codePoints) {
      if (code === 0) continue;
      const char = String.fromCodePoint(code);
      let targetMode = 'A';

      // カテゴリ判定
      const categories: FontCategory[] = ['kanji', 'hiragana', 'katakana', 'latin', 'symbols'];
      for (const catId of categories) {
        if (isInRange(code, catId)) {
          targetMode = config.categories[catId];
          break;
        }
      }

      let glyph: opentype.Glyph;
      
      if (targetMode === 'mix') {
        const glyphA = fontA.charToGlyph(char);
        const glyphBRaw = fontB.charToGlyph(char);
        const hasA = glyphA.unicode !== undefined && glyphA.index !== 0;
        const hasB = glyphBRaw.unicode !== undefined && glyphBRaw.index !== 0;

        if (hasA && hasB) {
          const glyphBNormalized = {
            path: scalePath(glyphBRaw.path, scaleBToA),
            advanceWidth: glyphBRaw.advanceWidth * scaleBToA
          };
          const mixedPath = interpolatePaths(glyphA.path, glyphBNormalized.path, config.blendRatio);
          const mixedAdvance = glyphA.advanceWidth + (glyphBNormalized.advanceWidth - glyphA.advanceWidth) * config.blendRatio;
          glyph = new opentype.Glyph({
            name: glyphA.name || glyphBRaw.name || `uni${code.toString(16)}`,
            unicode: code,
            advanceWidth: mixedAdvance,
            path: mixedPath
          });
        } else {
          const original = hasA ? glyphA : glyphBRaw;
          const currentScale = hasA ? 1.0 : scaleBToA;
          glyph = new opentype.Glyph({
            name: original.name || `uni${code.toString(16)}`,
            unicode: code,
            advanceWidth: original.advanceWidth * currentScale,
            path: scalePath(original.path, currentScale)
          });
        }
      } else {
        const useB = targetMode === 'B';
        const sourceFont = useB ? fontB : fontA;
        let original = sourceFont.charToGlyph(char);
        let currentScale = useB ? scaleBToA : 1.0;

        if (useB && original.index === 0) {
          original = fontA.charToGlyph(char);
          currentScale = 1.0;
        }

        glyph = new opentype.Glyph({
          name: original.name || `uni${code.toString(16)}`,
          unicode: code,
          advanceWidth: original.advanceWidth * currentScale,
          path: scalePath(original.path, currentScale)
        });
      }

      // ウェイト補正とかな調整
      let sourceWeight = fontAWeight;
      if (targetMode === 'B') sourceWeight = fontBWeight;
      else if (targetMode === 'mix') sourceWeight = fontAWeight + (fontBWeight - fontAWeight) * config.blendRatio;
      
      const weightCompensation = config.autoBalanceWeight ? (targetWeightNum - sourceWeight) / 7 : 0;
      const isKana = isInRange(code, 'hiragana') || isInRange(code, 'katakana');
      const finalThickness = config.thickness + weightCompensation;

      if (isKana || finalThickness !== 0) {
        const scale = isKana ? config.kanaScale : 1.0;
        const offsetY = isKana ? (config.kanaOffsetY * (baseFont.unitsPerEm / 100)) : 0;
        const thickness = finalThickness;
        const newPath = new opentype.Path();
        const bbox = glyph.getBoundingBox();
        const gCenterX = (bbox.x1 + bbox.x2) / 2;
        const gCenterY = (bbox.y1 + bbox.y2) / 2;
        const emCenter = baseFont.unitsPerEm / 2;

        glyph.path.commands.forEach((cmd: any) => {
          const transformedCmd = { ...cmd };
          ['x', 'y', 'x1', 'y1', 'x2', 'y2'].forEach(k => {
            if (k in transformedCmd) {
              if (isKana) {
                if (k.startsWith('x')) transformedCmd[k] = (transformedCmd[k] - emCenter) * scale + emCenter;
                if (k.startsWith('y')) transformedCmd[k] = (transformedCmd[k] - emCenter) * scale + emCenter + offsetY;
              }
              if (thickness !== 0) {
                const factor = 1 + (thickness / 100);
                if (k.startsWith('x')) transformedCmd[k] = (transformedCmd[k] - gCenterX) * factor + gCenterX;
                if (k.startsWith('y')) transformedCmd[k] = (transformedCmd[k] - gCenterY) * factor + gCenterY;
              }
            }
          });
          newPath.commands.push(transformedCmd);
        });

        glyph = new opentype.Glyph({
          name: glyph.name,
          unicode: code,
          advanceWidth: glyph.advanceWidth * (isKana ? scale : 1.0),
          path: newPath
        });
      }

      if (glyph.unicode !== undefined) {
        glyphs.push(glyph);
      }
    }

    const mixedFont = new opentype.Font({
      familyName: config.familyName || 'MixedFont',
      styleName: config.weightName || 'Regular',
      unitsPerEm: baseFont.unitsPerEm,
      ascender: baseFont.ascender,
      descender: baseFont.descender,
      glyphs: glyphs
    });

    const buffer = mixedFont.toArrayBuffer();
    (self as any).postMessage({ buffer }, [buffer]);
  } catch (err) {
    (self as any).postMessage({ error: (err as any).toString() });
  }
};
