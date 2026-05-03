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
      return (code >= 0x0030 && code <= 0x0039) || // 0-9
             (code >= 0x0041 && code <= 0x005A) || // A-Z
             (code >= 0x0061 && code <= 0x007A);   // a-z
    case 'symbols':
      return (code >= 0x0020 && code <= 0x002F) || 
             (code >= 0x003A && code <= 0x0040) ||
             (code >= 0x005B && code <= 0x0060) ||
             (code >= 0x007B && code <= 0x007E) ||
             (code >= 0x3000 && code <= 0x303F);   // JP Symbols
    default:
      return false;
  }
};

export const interpolatePaths = (pathA: any, pathB: any, ratio: number): any => {
  const newPath = new opentype.Path();
  if (pathA.commands.length !== pathB.commands.length) {
    return ratio < 0.5 ? pathA : pathB;
  }
  for (let i = 0; i < pathA.commands.length; i++) {
    const cmdA = pathA.commands[i];
    const cmdB = pathB.commands[i];
    if (cmdA.type !== cmdB.type) return ratio < 0.5 ? pathA : pathB;
    const newCmd = { ...cmdA };
    ['x', 'y', 'x1', 'y1', 'x2', 'y2'].forEach(key => {
      if (key in cmdA && key in cmdB) {
        newCmd[key] = Number(cmdA[key]) + (Number(cmdB[key]) - Number(cmdA[key])) * ratio;
      }
    });
    newPath.commands.push(newCmd);
  }
  return newPath;
};

export const scalePath = (path: any, scale: number): any => {
  if (scale === 1) return path;
  const newPath = new opentype.Path();
  path.commands.forEach((cmd: any) => {
    const newCmd = { ...cmd };
    ['x', 'y', 'x1', 'y1', 'x2', 'y2'].forEach(key => {
      if (key in newCmd) newCmd[key] *= scale;
    });
    newPath.commands.push(newCmd);
  });
  return newPath;
};

export const getWeightNumber = (name: string): number => {
  const weights: Record<string, number> = {
    'Light': 300,
    'Regular': 400,
    'Medium': 500,
    'SemiBold': 600,
    'Bold': 700,
    'Black': 900
  };
  return weights[name] || 400;
};
