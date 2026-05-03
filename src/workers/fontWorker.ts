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
  console.log('Worker received message', { fontAWeight, fontBWeight, config });
  
  try {
    console.log('Parsing fontA...');
    const fontA = opentype.parse(fontABuffer);
    console.log('Parsing fontB...');
    const fontB = opentype.parse(fontBBuffer);
    
    console.log('Collecting unicodes...');
    const glyphs: opentype.Glyph[] = [];
    const baseFont = fontA;
    const charSet = new Set<number>();
    
    // Efficiency: collect unique unicodes
    const collectUnicodes = (font: opentype.Font) => {
      for (let i = 0; i < font.numGlyphs; i++) {
        const g = font.glyphs.get(i);
        if (g.unicode !== undefined) charSet.add(g.unicode);
        if (g.unicodes) g.unicodes.forEach(u => charSet.add(u));
      }
    };
    collectUnicodes(fontA);
    collectUnicodes(fontB);

    console.log(`Unique unicodes collected: ${charSet.size}`);
    glyphs.push(fontA.glyphs.get(0)); // .notdef

    const codePoints = Array.from(charSet).sort((a, b) => a - b);
    const scaleBToA = baseFont.unitsPerEm / fontB.unitsPerEm;
    const targetWeightNum = getWeightNumber(config.weightName);

    console.log('Processing glyphs...');
    let processedCount = 0;
    for (const code of codePoints) {
      processedCount++;
      if (processedCount % 1000 === 0) console.log(`Processed ${processedCount}/${codePoints.length} glyphs...`);
      const char = String.fromCodePoint(code);
      let targetMode = 'A';

      // Determine category
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

      // Weight Compensation
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
    
    console.log(`Finished processing all ${glyphs.length} glyphs. Creating font...`);

    const mixedFont = new opentype.Font({
      familyName: config.familyName || 'MixedFont',
      styleName: config.weightName || 'Regular',
      unitsPerEm: baseFont.unitsPerEm,
      ascender: baseFont.ascender,
      descender: baseFont.descender,
      glyphs: glyphs
    });

    console.log('Generating toArrayBuffer...');
    const buffer = mixedFont.toArrayBuffer();
    console.log('Font buffer generated successfully.');
    (self as any).postMessage({ buffer }, [buffer]);
  } catch (err) {
    console.error('Worker error:', err);
    (self as any).postMessage({ error: (err as any).toString() });
  }
};
