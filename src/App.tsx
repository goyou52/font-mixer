/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useMemo, ChangeEvent, FormEvent } from 'react';
import * as opentype from 'opentype.js';
import { 
  FontCategory
} from './lib/fontUtils';
import { 
  Upload, 
  Download, 
  Settings2, 
  Layers, 
  Type, 
  RefreshCcw, 
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Info,
  Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type MixMode = 'A' | 'B' | 'mix';

interface FontSource {
  file: File | null;
  font: opentype.Font | null;
  buffer: ArrayBuffer | null;
  name: string;
  weight: number; // usWeightClass (e.g. 400)
}

interface MixingConfig {
  categories: Record<FontCategory, MixMode>;
  kanaScale: number;
  kanaOffsetY: number;
  blendRatio: number;
  thickness: number; 
  autoBalanceWeight: boolean; // New toggle
  familyName: string;
  weightName: string;
}

const CATEGORIES: { id: FontCategory; label: string; description: string; sample: string }[] = [
  { id: 'kanji', label: '漢字', description: '常用・第一水準・第二水準漢字', sample: '永' },
  { id: 'hiragana', label: 'ひらがな', description: '平仮名、濁点、半濁点', sample: 'あ' },
  { id: 'katakana', label: 'カタカナ', description: '片仮名、長音符', sample: 'ア' },
  { id: 'latin', label: '英数字', description: 'A-Z, a-z, 0-9', sample: 'G' },
  { id: 'symbols', label: '記号', description: '句読点、括弧、一般記号', sample: '＆' },
];

const WEIGHT_OPTIONS = ['Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'Black'];

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState(false);

  const [fontA, setFontA] = useState<FontSource>({ file: null, font: null, buffer: null, name: 'フォントA', weight: 400 });
  const [fontB, setFontB] = useState<FontSource>({ file: null, font: null, buffer: null, name: 'フォントB', weight: 400 });
  const [config, setConfig] = useState<MixingConfig>({
    categories: {
      kanji: 'A',
      hiragana: 'mix',
      katakana: 'mix',
      latin: 'A',
      symbols: 'A',
    },
    kanaScale: 1.0,
    kanaOffsetY: 0,
    blendRatio: 0.5,
    thickness: 0,
    autoBalanceWeight: true,
    familyName: 'MixedFont',
    weightName: 'Regular',
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState('あいうえお 漢字 ABC 123');
  const [previewFontUrl, setPreviewFontUrl] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // Initialize the worker correctly for Vite
    workerRef.current = new Worker(new URL('./workers/fontWorker.ts', import.meta.url), { type: 'module' });
    
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>, side: 'A' | 'B') => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const font = opentype.parse(arrayBuffer);
      
      // Extract weight class from OS/2 table or default to 400 (Regular)
      const weight = font.tables.os2?.usWeightClass || 400;
      
      const source = { file, font, buffer: arrayBuffer, name: file.name, weight };
      if (side === 'A') setFontA(source);
      else setFontB(source);
    } catch (err) {
      setError(`${side === 'A' ? 'フォントA' : 'フォントB'} の読み込みに失敗しました。正しいフォントファイル（.ttf, .otf）を選択してください。`);
      console.error(err);
    }
  };

  const generateMixedFont = async () => {
    if (!fontA.buffer || !fontB.buffer || !workerRef.current) {
      setError('2つのフォントをアップロードしてください。');
      return;
    }

    if (isProcessing) return; // Prevent overlapping runs

    setIsProcessing(true);
    setStatus('フォントを生成中...');
    setError(null);

    const fontABuffer = fontA.buffer.slice(0); // Clone for transfer
    const fontBBuffer = fontB.buffer.slice(0);

    const onWorkerMessage = async (e: MessageEvent) => {
      console.log('Worker message received:', e.data);
      if (e.data.error) {
        setError('フォントの生成中にエラーが発生しました: ' + e.data.error);
        console.error('Worker error data:', e.data.error);
        setIsProcessing(false);
        return;
      }

      const { buffer } = e.data;
      const blob = new Blob([buffer], { type: 'font/opentype' });
      const url = URL.createObjectURL(blob);
      
      if (previewFontUrl) URL.revokeObjectURL(previewFontUrl);
      setPreviewFontUrl(url);

      try {
        // Clear previous font if it exists to ensure refresh
        const fontName = 'MixedPreview';
        const fontFace = new FontFace(fontName, buffer);
        await fontFace.load();
        
        // Remove any old fonts with the same name
        document.fonts.forEach(f => {
          if (f.family === fontName) document.fonts.delete(f);
        });
        
        document.fonts.add(fontFace);
        setStatus('完了しました！');
      } catch (err) {
        console.error('FontFace load failed:', err);
        setError('プレビューの読み込みに失敗しました。');
      } finally {
        setIsProcessing(false);
        setTimeout(() => setStatus(''), 3000);
      }
    };

    workerRef.current.onmessage = onWorkerMessage;
    workerRef.current.onerror = (err) => {
      console.error('Worker critical error:', err);
      setError('Workerの実行に失敗しました。ブラウザがWeb Worker(Module)をサポートしているか確認してください。');
      setIsProcessing(false);
    };

    console.log('Posting message to worker...');
    workerRef.current.postMessage({
      fontABuffer,
      fontBBuffer,
      config,
      fontAWeight: fontA.weight,
      fontBWeight: fontB.weight
    }, [fontABuffer, fontBBuffer]);
  };

  const downloadFont = () => {
    if (!previewFontUrl) return;
    const a = document.createElement('a');
    a.href = previewFontUrl;
    const fileName = `${(config.familyName || 'MixedFont').replace(/\s+/g, '_')}-${config.weightName}.otf`;
    a.download = fileName;
    a.click();
  };

  const handleLogin = (e: FormEvent) => {
    e.preventDefault();
    const correctPassword = (import.meta as any).env.VITE_APP_PASSWORD || 'mixedfont2026';
    if (passwordInput === correctPassword) {
      setIsAuthenticated(true);
      setAuthError(false);
    } else {
      setAuthError(true);
      setPasswordInput('');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-6 text-white selection:bg-[#FF3E00] selection:text-white overflow-hidden">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md relative"
        >
          {/* Background Accent */}
          <div className="absolute -top-24 -left-24 w-64 h-64 bg-[#FF3E00] opacity-5 blur-[120px]" />
          
          <div className="mb-12 relative">
            <h1 className="text-[64px] font-black leading-[0.8] tracking-tighter uppercase mb-2 italic">
              MIXED<br />
              <span className="text-[#FF3E00]">FONT</span>
            </h1>
            <div className="flex items-center gap-3">
              <div className="h-[1px] w-12 bg-zinc-800" />
              <p className="text-zinc-500 font-mono text-[10px] uppercase tracking-[0.3em]">
                Secure Access Protocol v2.0
              </p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-6 relative">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-zinc-600 ml-1">Identity Verification Required</label>
              <div className="relative group">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-[#FF3E00] transition-colors">
                  <Lock size={18} />
                </div>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="ENTER ACCESS KEY"
                  className="w-full bg-neutral-900 border border-neutral-800 py-5 pl-14 pr-6 text-base font-bold tracking-widest uppercase focus:border-[#FF3E00]/50 focus:bg-neutral-900/50 focus:outline-none transition-all rounded-none placeholder:text-zinc-800"
                  autoFocus
                />
              </div>
            </div>

            <AnimatePresence mode="wait">
              {authError && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-red-500/10 border border-red-500/20 p-4"
                >
                  <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest flex items-center gap-2">
                    <AlertCircle size={14} /> Identity Mismatch. Access denied.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              className="w-full bg-white text-black py-5 font-black uppercase tracking-[0.3em] text-[11px] hover:bg-[#FF3E00] hover:text-white transition-all active:scale-[0.98] flex items-center justify-center gap-3 group"
            >
              Initialize System <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </form>

          <div className="mt-32 pt-8 border-t border-neutral-900 grid grid-cols-2 gap-4 text-[8px] font-mono text-zinc-700 uppercase tracking-widest">
            <div>
              <p className="text-zinc-500 border-b border-neutral-900 pb-1 mb-2 inline-block">System Status</p>
              <p>Network / Secure</p>
              <p>Env / Cloud-Native</p>
            </div>
            <div className="text-right">
              <p className="text-zinc-500 border-b border-neutral-900 pb-1 mb-2 inline-block">Architecture</p>
              <p>© 2024 Hybrid Engine</p>
              <p>Build 0502-A</p>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:h-screen lg:overflow-hidden bg-[#F2F2F2] flex flex-col lg:flex-row font-sans selection:bg-[#FF3E00] selection:text-white">
      {/* Sidebar Controls */}
      <aside className="w-full lg:w-[380px] bg-white border-r border-[#E0E0E0] p-8 flex flex-col justify-between overflow-y-auto shrink-0">
        <div className="space-y-10">
          <header>
            <h1 className="text-5xl font-black tracking-tighter leading-[0.85] mb-2 italic">
              FONT<br />MIXER
            </h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-400 font-bold">Japanese Hybrid Engine v2.0</p>
          </header>

          {/* Font Uploads */}
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 block mb-2">SOURCE A (BASE)</label>
              <div className={`
                relative border border-dashed rounded-none p-4 transition-all
                ${fontA.file ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-300 hover:border-neutral-900'}
              `}>
                <input 
                  type="file" 
                  accept=".ttf,.otf" 
                  onChange={(e) => handleFileUpload(e, 'A')} 
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-none ${fontA.file ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-400'}`}>
                    <Type size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono font-bold truncate tracking-tight">{fontA.file ? fontA.file.name : 'LOAD FONT A'}</p>
                    <p className="text-[9px] text-neutral-400 font-mono italic">{fontA.file ? `${(fontA.file.size / 1024 / 1024).toFixed(2)} MB` : '.TTF / .OTF'}</p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 block mb-2">SOURCE B (ACCENT)</label>
              <div className={`
                relative border border-dashed rounded-none p-4 transition-all
                ${fontB.file ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-300 hover:border-neutral-900'}
              `}>
                <input 
                  type="file" 
                  accept=".ttf,.otf" 
                  onChange={(e) => handleFileUpload(e, 'B')} 
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-none ${fontB.file ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-400'}`}>
                    <Type size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono font-bold truncate tracking-tight">{fontB.file ? fontB.file.name : 'LOAD FONT B'}</p>
                    <p className="text-[9px] text-neutral-400 font-mono italic">{fontB.file ? `${(fontB.file.size / 1024 / 1024).toFixed(2)} MB` : '.TTF / .OTF'}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Character Set Mixer */}
          <div>
            <h2 className="text-[10px] font-black uppercase tracking-widest mb-4 flex justify-between">
              <span>CHARACTER SETS</span>
              <span className="text-neutral-300 tracking-normal">MODE SELECT</span>
            </h2>
            <div className="space-y-1">
              {CATEGORIES.map((cat) => (
                <div key={cat.id} className="flex items-center justify-between py-3 border-b border-neutral-100 last:border-0 hover:bg-neutral-50/50 px-2 -mx-2 transition-colors">
                  <div className="flex-1 flex items-center gap-4">
                    <div className="w-10 h-10 bg-neutral-900 text-white flex items-center justify-center text-xl font-bold italic" style={previewFontUrl ? { fontFamily: 'MixedPreview' } : {}}>
                      {cat.sample}
                    </div>
                    <div>
                      <p className="text-sm font-bold tracking-tight">{cat.label} <span className="text-[9px] text-neutral-300 font-mono ml-1">{cat.id.toUpperCase()}</span></p>
                      <p className="text-[9px] text-neutral-400 font-mono leading-none mt-1">{config.categories[cat.id] === 'mix' ? 'INTERPOLATED' : `FROM SOURCE ${config.categories[cat.id]}`}</p>
                    </div>
                  </div>
                  <div className="flex bg-neutral-100 p-1 rounded-full overflow-hidden shrink-0">
                    <button 
                      onClick={() => setConfig(prev => ({ ...prev, categories: { ...prev.categories, [cat.id]: 'A' } }))}
                      className={`
                        w-8 h-8 rounded-full text-[10px] font-black transition-all flex items-center justify-center
                        ${config.categories[cat.id] === 'A' ? 'bg-black text-white' : 'text-neutral-400 hover:text-neutral-600'}
                      `}
                    >
                      A
                    </button>
                    <button 
                      onClick={() => setConfig(prev => ({ ...prev, categories: { ...prev.categories, [cat.id]: 'B' } }))}
                      className={`
                        w-8 h-8 rounded-full text-[10px] font-black transition-all flex items-center justify-center
                        ${config.categories[cat.id] === 'B' ? 'bg-black text-white' : 'text-neutral-400 hover:text-neutral-600'}
                      `}
                    >
                      B
                    </button>
                    <button 
                      onClick={() => setConfig(prev => ({ ...prev, categories: { ...prev.categories, [cat.id]: 'mix' } }))}
                      className={`
                        w-8 h-8 rounded-full text-[10px] font-black transition-all flex items-center justify-center
                        ${config.categories[cat.id] === 'mix' ? 'bg-[#FF3E00] text-white' : 'text-neutral-400 hover:text-neutral-600'}
                      `}
                    >
                      M
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Adjustments */}
          <div>
            <h2 className="text-[10px] font-black uppercase tracking-widest mb-4">MORPHOLOGY CONTROLS</h2>
            <div className="space-y-6">
              <div>
                <div className="flex justify-between text-[10px] mb-2 font-mono font-bold uppercase tracking-tighter">
                  <span>Interpolation Ratio (A ↔ B)</span>
                  <span className="text-[#FF3E00]">{Math.round(config.blendRatio * 100)}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.01" 
                  value={config.blendRatio} 
                  onChange={(e) => setConfig(prev => ({ ...prev, blendRatio: parseFloat(e.target.value) }))}
                  className="w-full"
                />
                <p className="text-[8px] text-neutral-400 mt-1 uppercase font-bold tracking-tight">※パス構造が同じ場合のみ中間値を計算します</p>
              </div>

              <div>
                <div className="flex justify-between text-[10px] mb-2 font-mono font-bold uppercase tracking-tighter">
                  <span>Thickness (Fake Weight)</span>
                  <span className="text-[#FF3E00]">{config.thickness > 0 ? `+${config.thickness}` : config.thickness}%</span>
                </div>
                <input 
                  type="range" 
                  min="-20" 
                  max="50" 
                  step="1" 
                  value={config.thickness} 
                  onChange={(e) => setConfig(prev => ({ ...prev, thickness: parseInt(e.target.value) }))}
                  className="w-full"
                />
                
                <div className="mt-3 flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    id="autoBalance"
                    checked={config.autoBalanceWeight}
                    onChange={(e) => setConfig(prev => ({ ...prev, autoBalanceWeight: e.target.checked }))}
                    className="accent-[#FF3E00]"
                  />
                  <label htmlFor="autoBalance" className="text-[10px] font-bold uppercase tracking-tight text-neutral-600 cursor-pointer">
                    Auto-Balance Weight (Beta)
                  </label>
                  <Info size={10} className="text-neutral-300" />
                </div>
                <p className="text-[8px] text-neutral-400 mt-1 uppercase font-bold tracking-tight">異なるウェイトのフォントを混ぜる際、自動で太さを補正します</p>
              </div>
              
              <div>
                <div className="flex justify-between text-[10px] mb-2 font-mono font-bold uppercase tracking-tighter">
                  <span>Kana Size Scale</span>
                  <span className="text-[#FF3E00]">{config.kanaScale.toFixed(2)}x</span>
                </div>
                <input 
                  type="range" 
                  min="0.5" 
                  max="1.5" 
                  step="0.01" 
                  value={config.kanaScale} 
                  onChange={(e) => setConfig(prev => ({ ...prev, kanaScale: parseFloat(e.target.value) }))}
                  className="w-full"
                />
              </div>

              <div>
                <div className="flex justify-between text-[10px] mb-2 font-mono font-bold uppercase tracking-tighter">
                  <span>Kana Y-Offset</span>
                  <span className="text-[#FF3E00]">{config.kanaOffsetY}px</span>
                </div>
                <input 
                  type="range" 
                  min="-100" 
                  max="100" 
                  step="1" 
                  value={config.kanaOffsetY} 
                  onChange={(e) => setConfig(prev => ({ ...prev, kanaOffsetY: parseInt(e.target.value) }))}
                  className="w-full"
                />
              </div>

              {/* Interpolation Visualizer Graph */}
              <div className="pt-4 border-t border-neutral-100">
                <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-neutral-300 mb-4">Morphing Sequence</h3>
                <div className="grid grid-cols-5 gap-1">
                  {[0, 0.25, 0.5, 0.75, 1].map((step) => (
                    <div key={step} className="flex flex-col items-center">
                      <div 
                        className={`w-full aspect-square border ${Math.abs(config.blendRatio - step) < 0.13 ? 'border-[#FF3E00] bg-red-50' : 'border-neutral-100 bg-neutral-50'} flex items-center justify-center text-xl overflow-hidden relative`}
                        style={previewFontUrl ? { fontFamily: 'MixedPreview' } : {}}
                      >
                         <span className="opacity-80">永</span>
                         {/* This visually represents the progress but real morphing is handled by the font engine */}
                         <div className="absolute bottom-0 left-0 h-0.5 bg-neutral-200" style={{ width: `${step * 100}%` }} />
                      </div>
                      <span className="text-[8px] font-mono mt-1 text-neutral-400">{Math.round(step * 100)}%</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 p-3 bg-neutral-900 text-white font-mono text-[9px] leading-relaxed uppercase">
                   <div className="flex justify-between mb-1"><span>Target Path Compatibility</span> <span className="text-green-400">High</span></div>
                   <div className="flex justify-between"><span>Active Mesh Blend</span> <span>{Math.round(config.blendRatio * 100)}/100</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 space-y-4">
          <div className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 block">Export Settings</label>
            <input 
              type="text"
              value={config.familyName}
              onChange={(e) => setConfig(prev => ({ ...prev, familyName: e.target.value }))}
              placeholder="FAMILY NAME"
              className="w-full bg-neutral-100 p-3 text-xs font-mono font-bold border-b-2 border-black outline-none"
            />
            <select 
              value={config.weightName}
              onChange={(e) => setConfig(prev => ({ ...prev, weightName: e.target.value }))}
              className="w-full bg-neutral-100 p-3 text-xs font-mono font-bold border-b-2 border-black outline-none appearance-none"
            >
              {WEIGHT_OPTIONS.map(w => <option key={w} value={w}>{w.toUpperCase()}</option>)}
            </select>
          </div>

          <button 
            onClick={generateMixedFont}
            disabled={isProcessing || !fontA.font || !fontB.font}
            className="w-full bg-black text-white py-4 font-black uppercase tracking-widest hover:bg-neutral-800 transition-colors flex items-center justify-center gap-3 disabled:bg-neutral-200 disabled:text-neutral-400"
          >
            {isProcessing && <RefreshCcw size={16} className="animate-spin" />}
            Generate Preview
          </button>
          
          {previewFontUrl && (
            <button 
              onClick={downloadFont}
              className="w-full bg-[#FF3E00] text-white py-4 font-black uppercase tracking-widest hover:bg-[#E03600] transition-colors shadow-xl shadow-red-500/20"
            >
              Export .OTF ({config.weightName})
            </button>
          )}
        </div>
      </aside>

      {/* Main Preview Area */}
      <main className="flex-1 flex flex-col h-full bg-[#F2F2F2] overflow-hidden relative">
        {/* Large Watermark Glyph */}
        <div className="absolute -right-20 -top-20 text-[600px] leading-none text-neutral-200 opacity-20 font-black pointer-events-none select-none italic font-display">
          あ
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-8 md:p-12 lg:p-20 relative z-10 overflow-y-auto">
          {/* Typography Preview Box */}
          <div className="w-full max-w-2xl bg-white p-10 md:p-14 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.15)] rounded-none border border-neutral-100">
            <div className="border-b border-neutral-100 pb-10 mb-10 overflow-hidden">
              <input 
                type="text" 
                value={previewText} 
                onChange={(e) => setPreviewText(e.target.value)}
                placeholder="TYPE TO PREVIEW..."
                className="w-full text-5xl md:text-7xl font-black tracking-tighter leading-none mb-6 italic outline-none uppercase placeholder:text-neutral-100"
                style={previewFontUrl ? { fontFamily: 'MixedPreview' } : {}}
              />
              <div className="flex flex-wrap gap-6 text-[10px] font-mono font-bold text-neutral-300 uppercase tracking-widest">
                <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-green-500" /> System Active</span>
                <span>Kerning: Auto</span>
                <span>Mixed Metrics: EM {fontA.font?.unitsPerEm || 1000}</span>
                <span>Status: {status || 'Ready'}</span>
              </div>
            </div>

            <div className="space-y-10">
              <div 
                className="text-3xl md:text-4xl leading-snug font-bold break-all"
                style={previewFontUrl ? { fontFamily: 'MixedPreview' } : {}}
              >
                {previewText || '漢字かな混じりの、美しいタイポグラフィ作品を。'}
              </div>
              <p 
                className="text-sm md:text-base leading-relaxed text-neutral-500 max-w-xl"
                style={previewFontUrl ? { fontFamily: 'MixedPreview' } : {}}
              >
                春はあけぼの。やうやう白くなりゆく山ぎは、すこしあかりて、紫だちたる雲のほそくたなびきたる。夏は夜。月のころはさらなり、闇もなほ、螢の多く飛びちがひたる。また、ただ一つ二つなど、ほのかにうち光りて行くもをかし。雨など降るもをかし。
              </p>
            </div>
          </div>

          {/* Bottom Toolbar */}
          <div className="mt-12 flex flex-wrap justify-center gap-4">
            <div className="px-5 py-2.5 bg-black text-white text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-black/20 cursor-default">
              Character Map
            </div>
            <div className="px-5 py-2.5 bg-white text-black text-[10px] font-black uppercase tracking-[0.2em] border border-black hover:bg-neutral-100 transition-colors  cursor-default">
              Baseline Grid
            </div>
            <div className="px-5 py-2.5 bg-white text-black text-[10px] font-black uppercase tracking-[0.2em] border border-black hover:bg-neutral-100 transition-colors  cursor-default">
              Compare Mode
            </div>
          </div>
        </div>

        {/* Footer info bar */}
        <footer className="h-12 border-t border-neutral-200 bg-white/80 backdrop-blur-md flex items-center justify-between px-8 text-[9px] font-mono font-bold text-neutral-300 uppercase shrink-0">
          <div className="flex items-center gap-4">
            <span>ENGINE: OPENTYPE.JS (V1.3.4)</span>
            <span className="hidden md:inline">•</span>
            <span className="hidden md:inline text-neutral-400">READY TO BAKE</span>
          </div>
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              SESSION: CONNECTED
            </span>
          </div>
        </footer>
      </main>

      {/* Persistent notifications moved inside the layout or handled as specific UI pieces */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md z-[100]"
          >
            <div className="bg-white p-10 rounded-none shadow-2xl max-w-sm w-full border-t-8 border-red-600">
              <div className="flex items-center gap-3 text-red-600 mb-6 font-black tracking-tighter uppercase text-xl">
                <AlertCircle size={28} strokeWidth={3} />
                <h3>SYSTEM ERROR</h3>
              </div>
              <p className="text-neutral-600 text-xs font-mono mb-10 leading-relaxed uppercase tracking-tight">{error}</p>
              <button 
                onClick={() => setError(null)}
                className="w-full py-4 bg-black text-white font-black uppercase tracking-widest hover:bg-neutral-800 transition-colors italic"
              >
                Close Connection
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
