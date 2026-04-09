/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, RotateCcw, Home, Crown, Sparkles } from 'lucide-react';
import { getAITip } from './services/geminiService';

// --- GAME CONSTANTS ---
const BOARD_SIZE = 8;
const STORAGE_KEY = 'BLOCKY_BEST_SCORE_FINAL';

// Dual-Tone Gradients for "Juicy" look
const C_YELLOW = 'from-[#FFEA00] to-[#FF9500] shadow-[0_0_15px_rgba(255,242,0,0.5)]';
const C_PINK = 'from-[#FF007A] to-[#BC005A] shadow-[0_0_15px_rgba(255,78,145,0.5)]';
const C_GREEN = 'from-[#00FF88] to-[#00A357] shadow-[0_0_15px_rgba(82,255,184,0.5)]';
const C_BLUE = 'from-[#00D4FF] to-[#0072FF] shadow-[0_0_15px_rgba(176,239,255,0.5)]';

const EASY_SHAPES = [
  { shape: [[1]], color: C_YELLOW }, 
  { shape: [[1, 1]], color: C_PINK },
  { shape: [[1], [1]], color: C_GREEN },
  { shape: [[1, 1], [1, 1]], color: C_BLUE },
];

const MEDIUM_SHAPES = [
  ...EASY_SHAPES,
  { shape: [[1, 1, 1]], color: C_YELLOW },
  { shape: [[1], [1], [1]], color: C_PINK },
  { shape: [[1, 1, 1], [0, 1, 0]], color: C_GREEN },
  { shape: [[1, 0], [1, 1]], color: C_BLUE },
];

const HARD_SHAPES = [
  ...MEDIUM_SHAPES,
  { shape: [[1, 1, 1, 1]], color: C_YELLOW },
  { shape: [[1], [1], [1], [1]], color: C_PINK },
  { shape: [[1, 1, 1], [1, 0, 0], [1, 0, 0]], color: C_GREEN },
  { shape: [[1, 1], [1, 1], [1, 1]], color: C_BLUE },
];

const EMOJIS = ['🍭', '🎈', '🌈', '🍦', '🍩', '🍬', '⚡', '✨'];

// Sound system jo lag nahi karega
const audioManager = {
  ctx: null as AudioContext | null,
  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  },
  play(type: 'pick' | 'drop' | 'clear' | 'rotate' | 'tick') {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const now = this.ctx.currentTime;
      const playTone = (freq: number, start: number, duration: number, vol = 0.1, type: OscillatorType = 'sine') => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(vol, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        osc.start(start);
        osc.stop(start + duration);
      };
      if (type === 'pick') playTone(800, now, 0.05, 0.03, 'sine');
      else if (type === 'drop') { 
        playTone(150, now, 0.1, 0.2, 'triangle'); 
        playTone(300, now + 0.02, 0.05, 0.1, 'sine'); 
      }
      else if (type === 'clear') [523, 659, 783, 1046].forEach((f, i) => playTone(f, now + (i * 0.08), 0.25, 0.08, 'sine'));
      else if (type === 'rotate') {
        playTone(1000, now, 0.05, 0.05, 'sine');
        playTone(1500, now + 0.02, 0.03, 0.03, 'sine');
      }
      else if (type === 'tick') {
        playTone(150, now, 0.02, 0.05, 'square');
      }
    } catch(e) {}
  }
};

interface Block {
  shape: number[][];
  color: string;
}

export default function App() {
  const [board, setBoard] = useState<(string | null)[][]>(() => Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)));
  const [availableBlocks, setAvailableBlocks] = useState<(Block | null)[]>([]);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [emojiPop, setEmojiPop] = useState<{ emoji: string, x: number, y: number } | null>(null);
  const [clearingLines, setClearingLines] = useState<{ rows: number[], cols: number[] }>({ rows: [], cols: [] });
  const [isShaking, setIsShaking] = useState(false);
  const [particles, setParticles] = useState<{id: number, emoji: string, x: number, y: number, tx: string, ty: string, rot: string}[]>([]);
  
  const [dragState, setDragState] = useState<{ 
    active: boolean, 
    blockIndex: number | null, 
    block: Block | null,
    pos: { x: number, y: number },
    isValid: boolean,
    gridPos: { row: number, col: number },
    previewClears: { rows: number[], cols: number[] }
  }>({ 
    active: false, 
    blockIndex: null, 
    block: null,
    pos: { x: 0, y: 0 },
    isValid: false,
    gridPos: { row: -1, col: -1 },
    previewClears: { rows: [], cols: [] }
  });
  const dragRef = useRef({ offsetX: 0, offsetY: 0, startX: 0, startY: 0, moved: false });
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setHighScore(parseInt(saved, 10));
  }, []);

  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
      localStorage.setItem(STORAGE_KEY, score.toString());
    }
  }, [score, highScore]);

  const rankInfo = useMemo(() => {
    if (score < 200) return { title: 'NEWBIE', icon: '🥚', color: 'bg-slate-400' };
    if (score < 500) return { title: 'ROOKIE', icon: '🐥', color: 'bg-green-400' };
    if (score < 1000) return { title: 'PRO', icon: '🔥', color: 'bg-orange-400' };
    if (score < 2000) return { title: 'ELITE', icon: '💎', color: 'bg-blue-400' };
    return { title: 'LEGEND', icon: '🏆', color: 'bg-purple-500' };
  }, [score]);

  const difficulty = useMemo(() => {
    if (score < 200) return { level: 1, pool: EASY_SHAPES, label: 'EASY' };
    if (score < 600) return { level: 2, pool: MEDIUM_SHAPES, label: 'NORMAL' };
    if (score < 1200) return { level: 3, pool: HARD_SHAPES, label: 'HARD' };
    if (score < 2500) return { level: 4, pool: HARD_SHAPES, label: 'EXPERT' };
    return { level: 5, pool: HARD_SHAPES, label: 'INSANE' };
  }, [score]);

  const generateBlocks = useCallback(() => {
    const pool = difficulty.pool;
    // As level increases, we might want to force at least one "hard" block
    const newBlocks = Array.from({ length: 3 }, (_, i) => {
      let selectedPool = pool;
      if (difficulty.level >= 4 && i === 0) {
        // Force a hard shape from the end of the pool if level is high
        const startIndex = Math.floor(pool.length * 0.7);
        return { ...pool[startIndex + Math.floor(Math.random() * (pool.length - startIndex))] };
      }
      return { ...pool[Math.floor(Math.random() * pool.length)] };
    });
    setAvailableBlocks(newBlocks);
  }, [difficulty]);

  useEffect(() => {
    if (availableBlocks.length === 0 || availableBlocks.every(b => b === null)) {
      generateBlocks();
    }
  }, [availableBlocks, generateBlocks]);

  const rotateBlock = useCallback((index: number) => {
    if (availableBlocks[index]) {
      const block = availableBlocks[index]!;
      const newShape = block.shape[0].map((_, colIndex) => block.shape.map(row => row[colIndex]).reverse());
      const newBlocks = [...availableBlocks];
      newBlocks[index] = { ...block, shape: newShape };
      setAvailableBlocks(newBlocks);
      audioManager.play('rotate');
    }
  }, [availableBlocks]);

  const canPlace = useCallback((r: number, c: number, shape: number[][], boardState = board) => {
    if (r < 0 || c < 0) return false;
    for (let i = 0; i < shape.length; i++) {
      for (let j = 0; j < shape[i].length; j++) {
        if (shape[i][j]) {
          const tr = r + i;
          const tc = c + j;
          if (tr >= BOARD_SIZE || tc >= BOARD_SIZE || boardState[tr][tc]) return false;
        }
      }
    }
    return true;
  }, [board]);

  const checkGameOver = (currentBoard: (string | null)[][], nextBlocks: (Block | null)[]) => {
    const remaining = nextBlocks.filter(b => b !== null) as Block[];
    if (remaining.length === 0) return;
    let isPossible = false;
    for (const b of remaining) {
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (canPlace(r, c, b.shape, currentBoard)) { isPossible = true; break; }
        }
        if (isPossible) break;
      }
      if (isPossible) break;
    }
    if (!isPossible) {
      setTimeout(() => setGameOver(true), 500);
    }
  };

  const handlePlace = useCallback((r: number, c: number, block: Block, blockIndex: number, x: number, y: number) => {
    if (!block || !canPlace(r, c, block.shape)) return;

    audioManager.play('drop');
    
    let newBoard = board.map(row => [...row]);
    block.shape.forEach((row, i) => {
      row.forEach((val, j) => {
        if (val) newBoard[r + i][c + j] = block.color;
      });
    });

    const rowsToClear: number[] = [];
    const colsToClear: number[] = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      if (newBoard[i].every(cell => cell)) rowsToClear.push(i);
      let colFull = true;
      for (let j = 0; j < BOARD_SIZE; j++) if (!newBoard[j][i]) colFull = false;
      if (colFull) colsToClear.push(i);
    }

    const nextBlocks = [...availableBlocks];
    nextBlocks[blockIndex] = null;
    setAvailableBlocks(nextBlocks);

    if (rowsToClear.length > 0 || colsToClear.length > 0) {
      setClearingLines({ rows: rowsToClear, cols: colsToClear });
      audioManager.play('clear');
      const lines = rowsToClear.length + colsToClear.length;
      if (lines >= 3) setFeedback("GAZAB!");
      else if (lines === 2) setFeedback("DOUBLE!");
      else setFeedback("WAH!");
      
      setIsShaking(true);
      
      // Particles fly towards score counter (top left)
      const newParticles = Array.from({ length: lines * 12 }).map((_, i) => ({
        id: Date.now() + i,
        emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
        x: x + (Math.random() - 0.5) * 100,
        y: y + (Math.random() - 0.5) * 100,
        tx: -x + 50 + (Math.random() - 0.5) * 50,
        ty: -y + 50 + (Math.random() - 0.5) * 50,
        rot: `${(Math.random() - 0.5) * 720}deg`
      }));
      setParticles(prev => [...prev, ...newParticles]);
      
      setTimeout(() => {
        setParticles(prev => prev.filter(p => !newParticles.find(np => np.id === p.id)));
      }, 800);

      setTimeout(() => {
        setIsShaking(false);
        rowsToClear.forEach(ri => newBoard[ri].fill(null));
        colsToClear.forEach(ci => { for (let i = 0; i < BOARD_SIZE; i++) newBoard[i][ci] = null; });
        
        const lines = rowsToClear.length + colsToClear.length;
        const newCombo = combo + 1;
        setCombo(newCombo);
        
        const comboBonus = newCombo > 1 ? newCombo * 50 : 0;
        const bonus = lines > 1 ? lines * 100 : 0;
        
        setScore(s => s + (lines * 50) + 10 + bonus + comboBonus);
        
        if (newCombo > 1) {
          setFeedback(`COMBO x${newCombo}!`);
        }

        setBoard(newBoard);
        setClearingLines({ rows: [], cols: [] });
        setTimeout(() => setFeedback(null), 1000);
        checkGameOver(newBoard, nextBlocks);
      }, 350);
    } else {
      setCombo(0);
      setBoard(newBoard);
      setScore(s => s + 10);
      checkGameOver(newBoard, nextBlocks);
    }
  }, [board, availableBlocks, canPlace, combo]);

  const onDown = (e: React.PointerEvent, b: Block | null, i: number) => {
    if (!b || gameOver) return;
    
    audioManager.init();
    audioManager.play('pick');
    
    const clientX = e.clientX;
    const clientY = e.clientY;
    const rect = e.currentTarget.getBoundingClientRect();

    dragRef.current = {
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
      startX: clientX,
      startY: clientY,
      moved: false
    };

    setDragState({ 
      active: true, 
      blockIndex: i, 
      block: b,
      pos: { x: clientX, y: clientY },
      isValid: false,
      gridPos: { row: -1, col: -1 },
      previewClears: { rows: [], cols: [] }
    });
  };

  const getClears = useCallback((boardState: (string | null)[][]) => {
    const rowsToClear: number[] = [];
    const colsToClear: number[] = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      if (boardState[i].every(cell => cell !== null)) rowsToClear.push(i);
      let colFull = true;
      for (let j = 0; j < BOARD_SIZE; j++) if (!boardState[j][i]) colFull = false;
      if (colFull) colsToClear.push(i);
    }
    return { rows: rowsToClear, cols: colsToClear };
  }, []);

  const onMove = (e: React.PointerEvent) => {
    if (!dragState.active) return;
    
    const clientX = e.clientX;
    const clientY = e.clientY;
    
    const dist = Math.hypot(clientX - dragRef.current.startX, clientY - dragRef.current.startY);
    if (dist > 8) dragRef.current.moved = true;

    let isValid = false;
    let gridPos = { row: -1, col: -1 };
    let previewClears = { rows: [], cols: [] };

    if (boardRef.current) {
      const firstCell = boardRef.current.querySelector('[data-row="0"][data-col="0"]');
      const secondCell = boardRef.current.querySelector('[data-row="0"][data-col="1"]');
      const cellBelow = boardRef.current.querySelector('[data-row="1"][data-col="0"]');
      
      if (firstCell && secondCell && cellBelow) {
        const cellRect = firstCell.getBoundingClientRect();
        const hStride = secondCell.getBoundingClientRect().left - cellRect.left;
        const vStride = cellBelow.getBoundingClientRect().top - cellRect.top;
        
        const shape = dragState.block!.shape;
        const cellW = cellRect.width;
        const cellH = cellRect.height;
        const gapH = hStride - cellW;
        const gapV = vStride - cellH;

        const blockW = shape[0].length * cellW + (shape[0].length - 1) * gapH;
        const blockH = shape.length * cellH + (shape.length - 1) * gapV;

        // Match the translate(-50%, -120%) from the preview exactly
        const dropX = clientX - (blockW * 0.5);
        const dropY = clientY - (blockH * 1.2);

        const col = Math.round((dropX - cellRect.left) / hStride);
        const row = Math.round((dropY - cellRect.top) / vStride);
        
        if (canPlace(row, col, shape)) {
          isValid = true;
          gridPos = { row, col };

          // Calculate preview clears
          const tempBoard = board.map(r => [...r]);
          for (let r = 0; r < shape.length; r++) {
            for (let c = 0; c < shape[0].length; c++) {
              if (shape[r][c]) tempBoard[row + r][col + c] = dragState.block!.color;
            }
          }
          previewClears = getClears(tempBoard) as any;
        }
      }
    }

    setDragState(prev => ({ ...prev, pos: { x: clientX, y: clientY }, isValid, gridPos, previewClears }));
  };

  const onUp = (e: React.PointerEvent) => {
    if (!dragState.active) return;
    
    const block = dragState.block!;
    const blockIndex = dragState.blockIndex!;
    const { isValid, gridPos } = dragState;
    
    setDragState({ 
      active: false, 
      blockIndex: null, 
      block: null,
      pos: { x: 0, y: 0 },
      isValid: false,
      gridPos: { row: -1, col: -1 },
      previewClears: { rows: [], cols: [] }
    });
    
    if (!dragRef.current.moved) {
      rotateBlock(blockIndex);
      return;
    }

    if (isValid) {
      handlePlace(gridPos.row, gridPos.col, block, blockIndex, e.clientX, e.clientY);
    }
  };

  return (
    <div 
      className="min-h-screen w-full max-w-md mx-auto bg-gradient-to-b from-[#2A9DF4] to-[#1167B1] flex flex-col items-center font-fredoka select-none touch-none overflow-hidden pb-8 relative"
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
    >
      {/* Background Decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Animated Blobs */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-400/20 rounded-full blur-[120px] animate-pulse"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-500/20 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '2s' }}></div>
        
        {/* Floating Emojis & Shapes */}
        <div className="absolute top-[15%] left-[5%] animate-float-idle opacity-30 text-4xl">🧩</div>
        <div className="absolute top-[25%] right-[8%] animate-float-idle opacity-20 text-5xl" style={{ animationDelay: '1s' }}>✨</div>
        <div className="absolute bottom-[40%] left-[12%] animate-float-idle opacity-25 text-3xl" style={{ animationDelay: '2.5s' }}>🔥</div>
        <div className="absolute bottom-[15%] right-[20%] animate-float-idle opacity-20 text-4xl" style={{ animationDelay: '1.5s' }}>💎</div>
        
        {/* Geometric Outlines */}
        <div className="absolute top-[60%] right-[5%] animate-float-idle opacity-10 rotate-12">
          <div className="w-24 h-24 border-8 border-white rounded-3xl"></div>
        </div>
        <div className="absolute top-[20%] left-[20%] animate-float-idle opacity-10 -rotate-12" style={{ animationDelay: '2s' }}>
          <div className="w-16 h-16 border-4 border-yellow-300 rounded-full"></div>
        </div>
        
        {/* Grid Pattern Overlay */}
        <div className="absolute inset-0 opacity-[0.03]" style={{ 
          backgroundImage: `radial-gradient(circle at 2px 2px, white 1px, transparent 0)`,
          backgroundSize: '40px 40px'
        }}></div>
      </div>

      {/* Top Header */}
      <div className="w-full max-w-md px-6 pt-8 pb-2 flex flex-col items-center z-20 pointer-events-none">
        <div className="flex items-center gap-2 mb-1">
          <span className="bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-black text-white tracking-widest border border-white/20">
            LEVEL {difficulty.level}: {difficulty.label}
          </span>
        </div>
        <h1 className="text-5xl font-black text-white text-sticker mb-4 tracking-tighter transform -rotate-2 animate-bounce-soft">
          BLOCKY <span className="text-yellow-300">BLAST!</span>
        </h1>
        
        <div className="w-full flex justify-between items-center px-2">
          <div className="flex flex-col">
            <p className="text-[10px] font-black text-white/70 uppercase tracking-[0.2em] text-sticker">SCORE</p>
            <div className="flex items-baseline gap-1">
              <p className="text-4xl font-black text-white text-sticker">{score}</p>
              {combo > 1 && <span className="text-yellow-300 font-black text-xs animate-bounce">x{combo}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end">
            <p className="text-[10px] font-black text-white/70 uppercase tracking-[0.2em] text-sticker flex items-center gap-1">
              <Crown size={12} className="text-yellow-400" /> BEST
            </p>
            <p className="text-4xl font-black text-white text-sticker">{highScore}</p>
          </div>
        </div>
      </div>

      {/* AI Tips Section */}
      <div className="w-full max-w-md px-6 z-10 mt-2 flex flex-col gap-3">
        <AITips score={score} />
        
        {/* Power-up Button */}
        <button 
          onClick={() => {
            generateBlocks();
            setFeedback("BLOCKS REFRESHED! 🔄");
            setTimeout(() => setFeedback(null), 2000);
          }}
          disabled={gameOver}
          className="w-full bg-gradient-to-r from-purple-500 to-indigo-600 p-3 rounded-2xl border-b-4 border-indigo-900 flex items-center justify-between shadow-lg active:translate-y-1 active:border-b-0 transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-1.5 rounded-lg">
              <RotateCcw size={18} className="text-white group-hover:rotate-180 transition-transform duration-500" />
            </div>
            <span className="text-white font-black text-xs tracking-wider uppercase">Refresh Blocks</span>
          </div>
          <div className="bg-white/20 px-2 py-1 rounded-md flex items-center gap-1 shadow-sm">
            <span className="text-[10px] font-black text-white">FREE</span>
            <Sparkles size={10} className="text-white" />
          </div>
        </button>
      </div>

      {/* Main Board Area */}
      <div className="flex-1 flex items-center justify-center w-full px-6 z-10">
        <div 
          className={`bg-[#1B1E32]/80 p-3 rounded-[32px] shadow-[0_0_30px_#3D4CCF] border-4 border-[#3D4CCF]/30 transition-all duration-700 ${isShaking ? 'animate-shake' : ''} ${gameOver ? 'grayscale scale-95' : ''}`}
        >
          <div ref={boardRef} className="grid grid-cols-8 gap-1.5 p-1.5 bg-[#1B1E32]/50 rounded-[24px]">
            {board.map((row, ri) => row.map((color, ci) => {
              const isClearing = clearingLines.rows.includes(ri) || clearingLines.cols.includes(ci);
              const isPreviewClearing = dragState.active && dragState.isValid && (dragState.previewClears.rows.includes(ri) || dragState.previewClears.cols.includes(ci));
              
              // Ghost Block Logic
              let isGhost = false;
              if (dragState.active && dragState.isValid) {
                const { row: startRow, col: startCol } = dragState.gridPos;
                const shape = dragState.block!.shape;
                for (let r = 0; r < shape.length; r++) {
                  for (let c = 0; c < shape[0].length; c++) {
                    if (shape[r][c] && startRow + r === ri && startCol + c === ci) {
                      isGhost = true;
                    }
                  }
                }
              }

              return (
                <div key={`${ri}-${ci}`} data-row={ri} data-col={ci}
                  className={`w-9 h-9 sm:w-11 sm:h-11 rounded-lg transition-all duration-200 relative ${
                    color ? `bg-gradient-to-b ${color} ${isClearing ? 'scale-0 opacity-0' : 'scale-100'}` : 
                    isGhost ? `bg-gradient-to-b ${dragState.block!.color} opacity-40 border-2 border-white/50 scale-105 z-10 shadow-[0_0_15px_rgba(255,255,255,0.3)]` :
                    'bg-[#1B1E32]/40 shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]'
                  } ${isPreviewClearing ? 'brightness-125' : ''}`}
                >
                  {isClearing && <div className="absolute inset-0 bg-white/60 rounded-lg animate-ping"></div>}
                  {isGhost && <div className="absolute inset-0 bg-white/20 rounded-lg animate-pulse"></div>}
                  {isPreviewClearing && <div className="absolute inset-0 border-2 border-white/30 rounded-lg animate-pulse"></div>}
                </div>
              );
            }))}
          </div>
          
          {/* Visual Feedback Texts */}
          {feedback && <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50"><span className="text-5xl font-black text-white text-sticker animate-pop-bounce text-center">{feedback}</span></div>}
        </div>
      </div>

      {/* Game Over Overlay */}
      <AnimatePresence>
        {gameOver && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 glass-morphism flex items-center justify-center z-[100] p-6"
          >
            <motion.div 
              initial={{ y: -100, scale: 0.8, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              transition={{ type: 'spring', damping: 15, stiffness: 100 }}
              className="bg-white p-8 rounded-[40px] shadow-[0_20px_50px_rgba(0,0,0,0.5)] text-center border-4 border-white w-full max-w-sm"
            >
              <Trophy size={64} className="mx-auto text-yellow-500 mb-4 animate-bounce" />
              <h2 className="text-[#1B1E32] text-4xl font-black mb-2 uppercase tracking-tight">Game Over</h2>
              
              <div className="bg-slate-100 rounded-3xl p-6 mb-8 border-2 border-slate-200">
                <p className="text-slate-400 text-xs font-black uppercase tracking-widest mb-1">Final Score</p>
                <ScoreCounter target={score} onTick={() => audioManager.play('tick')} />
                
                {score >= highScore && score > 0 && (
                  <div className="mt-2 text-pink-500 font-black text-sm animate-pulse">NEW BEST SCORE! 👑</div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <button 
                  onClick={() => {
                    setScore(0);
                    setBoard(Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)));
                    setAvailableBlocks([]);
                    setGameOver(false);
                    setCombo(0);
                  }} 
                  className="bg-white text-[#1167B1] border-2 border-[#1167B1] px-8 py-4 rounded-2xl font-black text-xl shadow-[0_8px_0_#1167B1] active:translate-y-1 active:shadow-[0_2px_0_#1167B1] transition-all"
                >
                  PLAY AGAIN
                </button>
                
                <button 
                  onClick={() => window.location.reload()} 
                  className="text-slate-400 font-bold text-xs hover:text-slate-600 transition-colors mt-2"
                >
                  BACK TO HOME
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dock Area */}
      <div className="mt-auto mb-6 w-full max-w-md px-6 z-10">
        <div className="bg-white/10 backdrop-blur-md rounded-[40px] p-6 flex justify-around items-center h-40 border-2 border-white/20 shadow-2xl">
          {availableBlocks.map((b, i) => (
            <div key={i} 
              className={`flex items-center justify-center transition-all ${dragState.active && dragState.blockIndex === i ? 'opacity-0' : 'hover:scale-105 active:scale-90 cursor-pointer touch-none'}`}
              onPointerDown={(e) => onDown(e, b, i)}>
              {b && (
                <div className="animate-pop-in" style={{ animationDelay: `${i * 0.1}s` }}>
                  <div className="animate-float-idle" style={{ animationDelay: `${i * 0.2}s` }}>
                    <ShapeView shape={b.shape} color={b.color} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Particles */}
      {particles.map(p => (
        <div key={p.id} className="fixed pointer-events-none z-[60] text-2xl animate-particle-to-score" style={{
          left: p.x, top: p.y,
          '--tx': `${p.tx}px`, '--ty': `${p.ty}px`,
        } as any}>
          {p.emoji}
        </div>
      ))}

      {/* Drag Preview */}
      {dragState.active && (
        <div className="fixed pointer-events-none z-[100] transition-transform duration-75" style={{
          left: dragState.pos.x,
          top: dragState.pos.y,
          transform: `translate(-50%, -120%) scale(${dragState.isValid ? 1.05 : 1})`,
          opacity: 0.9
        }}>
          <ShapeView shape={dragState.block!.shape} color={dragState.block!.color} isLarge />
        </div>
      )}
    </div>
  );
}

// --- HELPER COMPONENTS ---

const AITips = ({ score }: { score: number }) => {
  const [tip, setTip] = useState("Tip: Hamesha bade blocks ke liye jagah bachao! 🧩");
  const [isLoading, setIsLoading] = useState(false);
  const scoreRef = useRef(score);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    const fetchTip = async () => {
      setIsLoading(true);
      const newTip = await getAITip(scoreRef.current);
      setTip(newTip);
      setIsLoading(false);
    };

    fetchTip();
    // Fetch a new tip every 45 seconds to avoid hitting rate limits
    const interval = setInterval(fetchTip, 45000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-white/10 backdrop-blur-md border-2 border-white/20 rounded-[24px] p-4 flex items-center gap-4 shadow-xl relative overflow-hidden group min-h-[70px]">
      <div className="absolute top-0 right-0 w-16 h-16 bg-white/5 rounded-full -mr-8 -mt-8"></div>
      <div className={`bg-gradient-to-br from-yellow-300 to-orange-500 p-2.5 rounded-2xl shadow-lg transform group-hover:rotate-12 transition-transform ${isLoading ? 'animate-pulse' : ''}`}>
        <Sparkles size={20} className="text-white" />
      </div>
      <div className="flex flex-col flex-1">
        <p className="text-white/60 text-[9px] font-black uppercase tracking-widest mb-0.5">AI Master Tip</p>
        <p className={`text-white text-xs font-bold tracking-wide leading-tight transition-opacity duration-300 ${isLoading ? 'opacity-50' : 'opacity-100'}`}>
          {tip}
        </p>
      </div>
    </div>
  );
};

const ScoreCounter = ({ target, onTick }: { target: number, onTick: () => void }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let start = 0;
    const duration = 1000; // 1 second
    const increment = target / (duration / 16); // 60fps
    
    const timer = setInterval(() => {
      start += increment;
      if (start >= target) {
        setCount(target);
        clearInterval(timer);
      } else {
        setCount(Math.floor(start));
        onTick();
      }
    }, 16);

    return () => clearInterval(timer);
  }, [target]);

  return <p className="text-5xl font-black text-[#1B1E32] tabular-nums">{count}</p>;
};

const ShapeView = React.memo(({ shape, color, isLarge = false }: { shape: number[][], color: string, isLarge?: boolean }) => {
  const cellClass = isLarge ? "w-9 h-9 sm:w-11 sm:h-11 rounded-lg" : "w-6 h-6 sm:w-7 sm:h-7 rounded-md";
  const gapClass = isLarge ? "gap-1.5" : "gap-1";

  return (
    <div className={`flex flex-col ${gapClass}`}>
      {shape.map((row, ri) => (
        <div key={ri} className={`flex ${gapClass}`}>
          {row.map((cell, ci) => (
            <div key={ci} 
              className={`${cellClass} relative transition-all ${cell ? `bg-gradient-to-b ${color} border-t border-white/30` : 'bg-transparent'}`}
            >
               {cell === 1 && <div className="absolute top-1 left-1 w-1.5 h-1.5 bg-white/40 rounded-full blur-[0.5px]"></div>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});
