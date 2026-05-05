import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Rect, Circle, Wedge, Line, Group, Transformer } from 'react-konva';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Square, 
  Circle as CircleIcon, 
  Triangle as TriangleIcon,
  LayoutGrid,
  Trash2, 
  RotateCcw, 
  Shapes,
  Maximize2,
  Minimize2,
  Move,
  Moon,
  Sun,
  Upload,
  Sparkles,
  Loader2
} from 'lucide-react';
import { cn } from './lib/utils';

const GRID_SIZE = 40;
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 450;

type ShapeType = 'quarter-circle' | 'half-circle' | 'full-circle' | 'triangle' | 'square' | 'rectangle';
type Size = 'small' | 'medium' | 'large';

interface MosaicShape {
  id: string;
  type: ShapeType;
  size: Size;
  x: number;
  y: number;
  rotation: number;
  color: string;
}

const COLORS = ['#FFFFFF'];

const SIZE_MULTIPLIERS = {
  small: 1,
  medium: 2,
  large: 4
};

const SHAPE_CONFIGS = {
  'quarter-circle': { label: 'Quarter Circle', icon: CircleIcon, qcC: 1, tC: 0 },
  'half-circle': { label: 'Semi Circle', icon: CircleIcon, qcC: 2, tC: 0 },
  'triangle': { label: 'Triangle', icon: TriangleIcon, qcC: 0, tC: 1 },
  'square': { label: 'Square', icon: Square, qcC: 0, tC: 2 },
};

export default function App() {
  const [shapes, setShapes] = useState<MosaicShape[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<Size>('medium');
  const [darkMode, setDarkMode] = useState(true);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isVisionLoading, setIsVisionLoading] = useState(false);
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const stageRef = useRef<any>(null);
  const transformerRef = useRef<any>(null);

  const totalQC = shapes.reduce((acc, s) => acc + SHAPE_CONFIGS[s.type].qcC, 0);

  useEffect(() => {
    if (transformerRef.current && selectedId) {
      const selectedNode = stageRef.current.findOne('#' + selectedId);
      if (selectedNode) {
        transformerRef.current.nodes([selectedNode]);
        transformerRef.current.getLayer().batchDraw();
      }
    }
  }, [selectedId]);

  const addShape = (type: ShapeType, x = CANVAS_WIDTH / 2, y = CANVAS_HEIGHT / 2, rotation = 0) => {
    const finalType = type;
    const finalSize = selectedSize;

    const newShape: MosaicShape = {
      id: `shape-${Date.now()}`,
      type: finalType,
      size: finalSize,
      x: Math.round(x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(y / GRID_SIZE) * GRID_SIZE,
      rotation: rotation,
      color: '#FFFFFF',
    };

    // If not first shape, find a valid touching position if current is invalid
    if (shapes.length > 0) {
      const hasOverlap = shapes.some(s => checkOverlap(newShape, s));
      const isTouchingAny = shapes.some(s => isTouching(newShape, s));
      
      if (hasOverlap || !isTouchingAny) {
        // Search for the closest valid spot to the click position
        let found = false;
        const searchRange = 10;
        let minDistance = Infinity;
        let bestX = newShape.x;
        let bestY = newShape.y;

        for (let r = 1; r <= searchRange; r++) {
          for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
              if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
              
              const testX = newShape.x + dx * GRID_SIZE;
              const testY = newShape.y + dy * GRID_SIZE;
              const testShape = { ...newShape, x: testX, y: testY };
              
              if (!shapes.some(s => checkOverlap(testShape, s)) && shapes.some(s => isTouching(testShape, s))) {
                const dist = Math.sqrt(Math.pow(dx, 2) + Math.pow(dy, 2));
                if (dist < minDistance) {
                  minDistance = dist;
                  bestX = testX;
                  bestY = testY;
                  found = true;
                }
              }
            }
          }
          if (found) break;
        }

        if (found) {
          newShape.x = bestX;
          newShape.y = bestY;
        } else {
          return; // Could not find a spot
        }
      }
    }

    setShapes([...shapes, newShape]);
    setSelectedId(newShape.id);
  };

  const getDims = (shape: MosaicShape) => {
    const size = GRID_SIZE * SIZE_MULTIPLIERS[shape.size];
    let w = size;
    let h = size;

    if (shape.type === 'rectangle') {
      w = size * 2;
      const normalizedRot = Math.abs(shape.rotation % 180);
      if (normalizedRot > 45 && normalizedRot < 135) {
        [w, h] = [h, w];
      }
    } else if (shape.type === 'half-circle') {
      const normalizedRot = Math.abs(shape.rotation % 180);
      if (normalizedRot > 45 && normalizedRot < 135) {
        w = size; h = size * 2;
      } else {
        w = size * 2; h = size;
      }
    }
    return { w, h };
  };

  const checkOverlap = (s1: MosaicShape, s2: MosaicShape) => {
    const d1 = getDims(s1);
    const d2 = getDims(s2);

    const aabbOverlap = !(s1.x + d1.w <= s2.x || 
                          s2.x + d2.w <= s1.x || 
                          s1.y + d1.h <= s2.y || 
                          s2.y + d2.h <= s1.y);
    
    if (!aabbOverlap) return false;

    // If they are at the same position and same size, check for complementary shapes
    if (s1.x === s2.x && s1.y === s2.y && s1.size === s2.size) {
      const r1 = (Math.round(s1.rotation / 90) * 90) % 360;
      const r2 = (Math.round(s2.rotation / 90) * 90) % 360;
      const normR1 = r1 < 0 ? r1 + 360 : r1;
      const normR2 = r2 < 0 ? r2 + 360 : r2;

      // Helper to get quadrants occupied (0=TL, 90=TR, 180=BR, 270=BL)
      const getQuadrants = (type: string, rot: number) => {
        if (type === 'quarter-circle') return [rot];
        if (type === 'half-circle') return [rot, (rot + 90) % 360];
        if (type === 'full-circle') return [0, 90, 180, 270];
        if (type === 'triangle') return [rot]; // Simple model: triangle occupies its "facing" quadrant
        return [0, 90, 180, 270]; // Squares/Rects occupy all
      };

      // Special case for triangles: 0 and 180 are perfect complements in a square
      if (s1.type === 'triangle' && s2.type === 'triangle') {
        return Math.abs(normR1 - normR2) !== 180;
      }

      const q1 = getQuadrants(s1.type, normR1);
      const q2 = getQuadrants(s2.type, normR2);

      const hasSharedQuadrant = q1.some(q => q2.includes(q));
      return hasSharedQuadrant;
    }
    
    return true;
  };

  const isTouching = (s1: MosaicShape, s2: MosaicShape) => {
    if (s1.x === s2.x && s1.y === s2.y && s1.size === s2.size) return true;
    
    const d1 = getDims(s1);
    const d2 = getDims(s2);

    const xOverlap = Math.max(0, Math.min(s1.x + d1.w, s2.x + d2.w) - Math.max(s1.x, s2.x));
    const yOverlap = Math.max(0, Math.min(s1.y + d1.h, s2.y + d2.h) - Math.max(s1.y, s2.y));
    
    const touchingX = (Math.abs(s1.x + d1.w - s2.x) < 0.1 || Math.abs(s2.x + d2.w - s1.x) < 0.1) && yOverlap > 0;
    const touchingY = (Math.abs(s1.y + d1.h - s2.y) < 0.1 || Math.abs(s2.y + d2.h - s1.y) < 0.1) && xOverlap > 0;
    
    return touchingX || touchingY;
  };

  const handleDragEnd = (id: string, e: any) => {
    const x = Math.round(e.target.x() / GRID_SIZE) * GRID_SIZE;
    const y = Math.round(e.target.y() / GRID_SIZE) * GRID_SIZE;
    
    const movingShape = shapes.find(s => s.id === id);
    if (!movingShape) return;

    const newShape = { ...movingShape, x, y };
    const otherShapes = shapes.filter(s => s.id !== id);

    // Validation
    const hasOverlap = otherShapes.some(s => checkOverlap(newShape, s));
    const isTouchingAny = otherShapes.length === 0 || otherShapes.some(s => isTouching(newShape, s));

    if (hasOverlap || !isTouchingAny) {
      // Revert position
      e.target.x(movingShape.x);
      e.target.y(movingShape.y);
      return;
    }

    setShapes(shapes.map(s => s.id === id ? { ...s, x, y } : s));
  };

  const handleDelete = () => {
    if (selectedId) {
      setShapes(shapes.filter(s => s.id !== selectedId));
      setSelectedId(null);
    }
  };

  const handleRotate = () => {
    if (selectedId) {
      const shape = shapes.find(s => s.id === selectedId);
      if (!shape) return;
      
      const newRotation = (shape.rotation + 90) % 360;
      const newShape = { ...shape, rotation: newRotation };
      const otherShapes = shapes.filter(s => s.id !== selectedId);
      
      const hasOverlap = otherShapes.some(s => checkOverlap(newShape, s));
      const isTouchingAny = otherShapes.length === 0 || otherShapes.some(s => isTouching(newShape, s));
      
      if (hasOverlap || !isTouchingAny) {
        return;
      }
      
      setShapes(shapes.map(s => s.id === selectedId ? { ...s, rotation: newRotation } : s));
    }
  };

  const snapToShape = (target: 'circle' | 'triangle') => {
    if (shapes.length === 0) return;

    // Calculate center of current arrangement
    const avgX = shapes.reduce((acc, s) => acc + s.x, 0) / shapes.length;
    const avgY = shapes.reduce((acc, s) => acc + s.y, 0) / shapes.length;
    const centerX = Math.round(avgX / GRID_SIZE) * GRID_SIZE;
    const centerY = Math.round(avgY / GRID_SIZE) * GRID_SIZE;

    const availableSquares = [...shapes.filter(s => s.type === 'square')];
    const availableQCs = [...shapes.filter(s => s.type === 'quarter-circle')];
    
    let newShapes: MosaicShape[] = [];

    if (target === 'circle') {
      // Symmetrical Circle Logic using 4-way symmetry around grid intersection
      const groups: {dx: number, dy: number, rot: number}[][] = [];
      const seen = new Set<string>();
      const maxSearch = 15;

      // Generate potential slots sorted by distance from center
      const potentialSlots: {dx: number, dy: number, dist: number}[] = [];
      for (let x = -maxSearch; x < maxSearch; x++) {
        for (let y = -maxSearch; y < maxSearch; y++) {
          const cx = x + 0.5;
          const cy = y + 0.5;
          potentialSlots.push({ dx: x, dy: y, dist: Math.sqrt(cx*cx + cy*cy) });
        }
      }
      potentialSlots.sort((a, b) => a.dist - b.dist);

      for (const slot of potentialSlots) {
        const {dx, dy} = slot;
        const key = `${dx},${dy}`;
        if (seen.has(key)) continue;

        // 4-way symmetry around (-0.5, -0.5)
        const group = [
          {dx: dx, dy: dy, rot: 0},       // Quadrant 4 (LR)
          {dx: -dx-1, dy: dy, rot: 90},   // Quadrant 3 (LL)
          {dx: dx, dy: -dy-1, rot: 270},  // Quadrant 1 (UR)
          {dx: -dx-1, dy: -dy-1, rot: 180} // Quadrant 2 (UL)
        ];

        const uniqueGroup: typeof group = [];
        const groupSeen = new Set<string>();
        for (const g of group) {
          const gKey = `${g.dx},${g.dy}`;
          if (!groupSeen.has(gKey)) {
            groupSeen.add(gKey);
            uniqueGroup.push(g);
            seen.add(gKey);
          }
        }
        groups.push(uniqueGroup);
      }

      let groupIdx = 0;
      while (groupIdx < groups.length && (availableSquares.length > 0 || availableQCs.length > 0)) {
        const group = groups[groupIdx];
        if (availableSquares.length + availableQCs.length < group.length) break;

        // Use QCs for "diagonal" groups to round the circle
        const isDiagonal = Math.abs(group[0].dx + 0.5) === Math.abs(group[0].dy + 0.5);
        
        if (isDiagonal && availableQCs.length >= group.length) {
          group.forEach(g => {
            const qc = availableQCs.pop()!;
            newShapes.push({...qc, x: centerX + g.dx * GRID_SIZE, y: centerY + g.dy * GRID_SIZE, rotation: g.rot});
          });
        } else if (availableSquares.length >= group.length) {
          group.forEach(g => {
            const sq = availableSquares.pop()!;
            newShapes.push({...sq, x: centerX + g.dx * GRID_SIZE, y: centerY + g.dy * GRID_SIZE, rotation: 0});
          });
        } else if (availableQCs.length >= group.length) {
          group.forEach(g => {
            const qc = availableQCs.pop()!;
            newShapes.push({...qc, x: centerX + g.dx * GRID_SIZE, y: centerY + g.dy * GRID_SIZE, rotation: 0});
          });
        }
        groupIdx++;
      }
    } else if (target === 'triangle') {
      // Symmetrical Triangle (Pyramid) Logic
      // Pattern: 1, 3, 5, 7... to maintain grid symmetry
      let row = 1;
      let currentSquares = [...availableSquares];
      let currentQCs = [...availableQCs];
      
      while (currentSquares.length + currentQCs.length > 0) {
        const rowWidth = (row * 2) - 1;
        if (currentSquares.length + currentQCs.length < rowWidth) break;

        const startX = centerX - Math.floor(rowWidth / 2) * GRID_SIZE;
        const y = centerY + (row - 1) * GRID_SIZE;

        for (let i = 0; i < rowWidth; i++) {
          const x = startX + i * GRID_SIZE;
          let shape: MosaicShape;
          let rotation = 0;

          // Use QCs for the tips/edges if available
          if (i === 0 && currentQCs.length > 0) {
            shape = currentQCs.pop()!;
            rotation = 180; // UL
          } else if (i === rowWidth - 1 && currentQCs.length > 0) {
            shape = currentQCs.pop()!;
            rotation = 270; // UR
          } else if (currentSquares.length > 0) {
            shape = currentSquares.pop()!;
          } else {
            shape = currentQCs.pop()!;
          }

          newShapes.push({ ...shape, x, y, rotation });
        }
        row++;
      }
    }

    // Apply updates
    if (newShapes.length > 0) {
      setShapes(prev => {
        const updated = [...prev];
        newShapes.forEach(ns => {
          const idx = updated.findIndex(s => s.id === ns.id);
          if (idx !== -1) updated[idx] = ns;
        });
        return updated;
      });
    }
  };

  const generateWithAI = async () => {
    if (!aiPrompt.trim()) return;
    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      // 1. Generate an image from the prompt
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              text: `A simple, clean, high-contrast graphic icon of: ${aiPrompt}. Minimalist style, solid colors, no gradients, white background.`,
            },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
          },
        },
      });

      let base64Image = "";
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          base64Image = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }

      if (!base64Image) throw new Error("No image generated");

      // 2. Convert the generated image to pixels
      const img = new Image();
      img.onload = () => {
        const tempCanvas = document.createElement('canvas');
        const ctx = tempCanvas.getContext('2d');
        if (!ctx) return;

        const maxDim = 16; // Smaller for AI generated icons to keep it clean
        let width = img.width;
        let height = img.height;

        if (width > height) {
          height *= maxDim / width;
          width = maxDim;
        } else {
          width *= maxDim / height;
          height = maxDim;
        }

        tempCanvas.width = width;
        tempCanvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const newShapes: MosaicShape[] = [];
        const startX = Math.round((CANVAS_WIDTH / 3) / GRID_SIZE) * GRID_SIZE;
        const startY = Math.round((CANVAS_HEIGHT / 4) / GRID_SIZE) * GRID_SIZE;

        const used = new Array(width * height).fill(false);

        // Helper to check if a block is filled
        const isBlockFilled = (bx: number, by: number, bsize: number) => {
          if (bx + bsize > width || by + bsize > height) return false;
          for (let dy = 0; dy < bsize; dy++) {
            for (let dx = 0; dx < bsize; dx++) {
              if (used[(by + dy) * width + (bx + dx)]) return false;
              const idx = ((by + dy) * width + (bx + dx)) * 4;
              const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
              const isWhite = r > 240 && g > 240 && b > 240;
              if (a <= 128 || isWhite) return false;
            }
          }
          return true;
        };

        // 1. Try Large (4x4)
        for (let y = 0; y <= height - 4; y += 4) {
          for (let x = 0; x <= width - 4; x += 4) {
            if (isBlockFilled(x, y, 4)) {
              newShapes.push({
                id: `ai-pixel-l-${Date.now()}-${x}-${y}`,
                type: 'square',
                size: 'large',
                x: startX + x * GRID_SIZE,
                y: startY + y * GRID_SIZE,
                rotation: 0,
                color: '#FFFFFF',
              });
              for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) used[(y + dy) * width + (x + dx)] = true;
            }
          }
        }

        // 2. Try Medium (2x2)
        for (let y = 0; y <= height - 2; y += 2) {
          for (let x = 0; x <= width - 2; x += 2) {
            if (isBlockFilled(x, y, 2)) {
              newShapes.push({
                id: `ai-pixel-m-${Date.now()}-${x}-${y}`,
                type: 'square',
                size: 'medium',
                x: startX + x * GRID_SIZE,
                y: startY + y * GRID_SIZE,
                rotation: 0,
                color: '#FFFFFF',
              });
              for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) used[(y + dy) * width + (x + dx)] = true;
            }
          }
        }

        // 3. Remaining Small (1x1)
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (used[y * width + x]) continue;
            const idx = (y * width + x) * 4;
            const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
            const isWhite = r > 240 && g > 240 && b > 240;
            if (a > 128 && !isWhite) {
              newShapes.push({
                id: `ai-pixel-s-${Date.now()}-${x}-${y}`,
                type: 'square',
                size: 'small',
                x: startX + x * GRID_SIZE,
                y: startY + y * GRID_SIZE,
                rotation: 0,
                color: '#FFFFFF',
              });
            }
          }
        }

        setShapes([...shapes, ...newShapes]);
        setIsGenerating(false);
        setAiPrompt("");
      };
      img.src = base64Image;
    } catch (error) {
      console.error("AI Generation failed:", error);
      setIsGenerating(false);
    }
  };

  const generateFromImageAI = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsVisionLoading(true);

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const dataUrl = event.target?.result as string;
        setSourceImage(dataUrl);
        const base64Data = dataUrl.split(',')[1];
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
        
        const prompt = `Analyze this image and convert it into a geometric mosaic. 
        Return ONLY a JSON array of shapes. 
        Each shape must be an object with: 
        - type: "square" | "triangle" | "half-circle"
        - x: (0 to 800, multiple of 40)
        - y: (0 to 450, multiple of 40)
        - size: "small" | "medium" | "large"
        - rotation: (0 | 90 | 180 | 270)
        
        CRITICAL RULES:
        1. Sizes: "small" (40x40), "medium" (80x80), or "large" (160x160).
        2. Shapes: 
           - "square": Standard pixel block.
           - "triangle": Right-angled triangle (half of a square).
           - "half-circle": Semicircle filling one square side.
        3. Aim to use as FEW shapes as possible by using larger shapes for solid areas.
        4. The primary goal is to make the mosaic look as close to the original image as possible.
        5. Use "small" shapes for fine details and precise edges.
        6. Use "triangle" and "half-circle" to better represent curves and diagonal lines in the source or to smooth edges.
        7. All shapes will be white (#FFFFFF), so focus on representing the luminance and structure of the image.
        8. Limit to 200 shapes total.
        9. Return the JSON directly, no markdown formatting.`;

        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: [
            {
              parts: [
                { text: prompt },
                { inlineData: { data: base64Data, mimeType: file.type } }
              ]
            }
          ],
          config: {
            responseMimeType: "application/json"
          }
        });

        const shapesData = JSON.parse(response.text);
        const newShapes: MosaicShape[] = shapesData.map((s: any, i: number) => ({
          ...s,
          id: `ai-vision-${Date.now()}-${i}`,
          size: (['small', 'medium', 'large'].includes(s.size)) ? s.size : 'small',
          x: Math.round(s.x / GRID_SIZE) * GRID_SIZE,
          y: Math.round(s.y / GRID_SIZE) * GRID_SIZE,
          color: '#FFFFFF',
          rotation: s.rotation || 0,
        }));

        setShapes([...shapes, ...newShapes]);
        setIsVisionLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("AI Vision failed:", error);
      setIsVisionLoading(false);
    }
  };

  const renderShape = (shape: MosaicShape) => {
    const baseSize = GRID_SIZE * SIZE_MULTIPLIERS[shape.size];
    const { key, ...restProps } = {
      key: shape.id,
      id: shape.id,
      x: shape.x,
      y: shape.y,
      rotation: shape.rotation,
      fill: shape.color,
      draggable: true,
      onDragEnd: (e: any) => handleDragEnd(shape.id, e),
      onTransformEnd: (e: any) => {
        const node = e.target;
        const rotation = Math.round(node.rotation() / 45) * 45;
        node.rotation(rotation); // Snap visually
        
        const movingShape = shapes.find(s => s.id === shape.id);
        if (!movingShape) return;

        const newShape = { ...movingShape, rotation };
        const otherShapes = shapes.filter(s => s.id !== shape.id);

        const hasOverlap = otherShapes.some(s => checkOverlap(newShape, s));
        const isTouchingAny = otherShapes.length === 0 || otherShapes.some(s => isTouching(newShape, s));

        if (hasOverlap || !isTouchingAny) {
          node.rotation(movingShape.rotation);
          return;
        }
        setShapes(shapes.map(s => s.id === shape.id ? { ...s, rotation } : s));
      },
      onClick: () => setSelectedId(shape.id),
      onTap: () => setSelectedId(shape.id),
      stroke: '#000',
      strokeWidth: 1,
      shadowColor: selectedId === shape.id ? (darkMode ? '#fff' : '#444') : 'transparent',
      shadowBlur: selectedId === shape.id ? 5 : 0,
      shadowOpacity: 1,
    };

    // Calculate offsets to keep (x, y) as the top-left of the bounding box
    const rot = (Math.round(shape.rotation / 90) * 90) % 360;
    const normalizedRot = rot < 0 ? rot + 360 : rot;

    switch (shape.type) {
      case 'quarter-circle': {
        let offX = 0, offY = 0;
        if (normalizedRot === 90) offX = baseSize;
        else if (normalizedRot === 180) { offX = baseSize; offY = baseSize; }
        else if (normalizedRot === 270) offY = baseSize;
        return <Wedge key={key} {...restProps} radius={baseSize} angle={90} offsetX={-offX} offsetY={-offY} />;
      }
      case 'half-circle': {
        let offX = baseSize, offY = 0;
        if (normalizedRot === 90) { offX = baseSize; offY = baseSize; }
        else if (normalizedRot === 180) { offX = baseSize; offY = baseSize; }
        else if (normalizedRot === 270) { offX = 0; offY = baseSize; }
        return <Wedge key={key} {...restProps} radius={baseSize} angle={180} offsetX={-offX} offsetY={-offY} />;
      }
      case 'full-circle':
        return <Circle key={key} {...restProps} radius={baseSize / 2} offsetX={-baseSize / 2} offsetY={-baseSize / 2} />;
      case 'triangle': {
        let offX = 0, offY = 0;
        if (normalizedRot === 90) offX = baseSize;
        else if (normalizedRot === 180) { offX = baseSize; offY = baseSize; }
        else if (normalizedRot === 270) offY = baseSize;
        return <Line key={key} {...restProps} points={[0, 0, baseSize, 0, 0, baseSize]} closed fill={shape.color} offsetX={-offX} offsetY={-offY} />;
      }
      case 'square':
        return <Rect key={key} {...restProps} width={baseSize} height={baseSize} />;
      case 'rectangle':
        return <Rect key={key} {...restProps} width={baseSize * 2} height={baseSize} />;
      default:
        return null;
    }
  };

  return (
    <div className={cn(
      "flex h-screen font-sans transition-colors duration-300",
      darkMode ? "bg-[#121212] text-gray-100" : "bg-[#f0f0f0] text-[#333]"
    )}>
      {/* Sidebar */}
      <div className={cn(
        "w-80 border-r flex flex-col shadow-lg z-10 transition-colors",
        darkMode ? "bg-[#1e1e1e] border-gray-800" : "bg-white border-gray-200"
      )}>
        <div className={cn("p-6 border-b", darkMode ? "border-gray-800" : "border-gray-100")}>
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Shapes className={cn("w-6 h-6", darkMode ? "text-slate-400" : "text-slate-600")} />
              Mosaic
            </h1>
          </div>
          <p className={cn("text-sm mt-1 italic", darkMode ? "text-gray-400" : "text-gray-500")}>Geometric Assembly</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">

          {/* Shape Selection */}
          <section>
            <h2 className={cn("text-xs font-semibold uppercase tracking-wider mb-4", darkMode ? "text-gray-500" : "text-gray-400")}>
              Base Shapes
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(SHAPE_CONFIGS) as ShapeType[])
                .filter(type => ['square', 'triangle', 'half-circle'].includes(type))
                .map(type => {
                  const Config = SHAPE_CONFIGS[type];
                  return (
                    <button
                      key={type}
                      onClick={() => addShape(type)}
                      className={cn(
                        "flex flex-col items-center justify-center p-4 border rounded-xl transition-all group",
                        darkMode 
                          ? "border-gray-800 hover:bg-slate-900/20 hover:border-slate-800" 
                          : "border-gray-100 hover:bg-slate-50 hover:border-slate-200"
                      )}
                    >
                      <div className={cn(
                        "w-10 h-10 flex items-center justify-center rounded-lg mb-2 transition-colors",
                        darkMode ? "bg-gray-800 group-hover:bg-gray-700" : "bg-gray-50 group-hover:bg-white"
                      )}>
                        <Config.icon className={cn(
                          "w-6 h-6 transition-colors",
                          darkMode ? "text-gray-400 group-hover:text-slate-400" : "text-gray-600 group-hover:text-slate-600"
                        )} />
                      </div>
                      <span className="text-[10px] font-medium text-center leading-tight">{Config.label}</span>
                    </button>
                  );
                })}
            </div>
          </section>

          {/* Presets & AI */}
          <section className="space-y-6">
              <div>
                <h2 className={cn("text-xs font-semibold uppercase tracking-wider mb-4", darkMode ? "text-gray-500" : "text-gray-400")}>Snap to Shape</h2>
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <button
                    onClick={() => snapToShape('circle')}
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 p-4 border rounded-xl transition-all group",
                      darkMode ? "border-gray-800 hover:bg-gray-700" : "border-gray-100 hover:bg-gray-50"
                    )}
                  >
                    <CircleIcon className={cn("w-6 h-6", darkMode ? "text-gray-400 group-hover:text-slate-400" : "text-gray-600 group-hover:text-slate-600")} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">Snap Circle</span>
                  </button>
                  <button
                    onClick={() => snapToShape('triangle')}
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 p-4 border rounded-xl transition-all group",
                      darkMode ? "border-gray-800 hover:bg-gray-700" : "border-gray-100 hover:bg-gray-50"
                    )}
                  >
                    <TriangleIcon className={cn("w-6 h-6", darkMode ? "text-gray-400 group-hover:text-slate-400" : "text-gray-600 group-hover:text-slate-600")} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">Snap Triangle</span>
                  </button>
                </div>

                <h2 className={cn("text-xs font-semibold uppercase tracking-wider mb-4", darkMode ? "text-gray-500" : "text-gray-400")}>AI Generation</h2>
                <div className="space-y-3">
                  <div className="relative">
                    <input 
                      type="text"
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="Describe a design..."
                      className={cn(
                        "w-full px-4 py-3 text-xs rounded-xl border transition-all pr-10",
                        darkMode 
                          ? "bg-gray-800 border-gray-700 text-white focus:border-slate-500" 
                          : "bg-white border-gray-200 text-gray-900 focus:border-slate-400"
                      )}
                      onKeyDown={(e) => e.key === 'Enter' && generateWithAI()}
                    />
                    <Sparkles className={cn("absolute right-3 top-3 w-4 h-4 opacity-30", darkMode ? "text-slate-400" : "text-slate-600")} />
                  </div>
                  <button
                    onClick={generateWithAI}
                    disabled={isGenerating || !aiPrompt.trim()}
                    className={cn(
                      "w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all shadow-lg",
                      isGenerating || !aiPrompt.trim()
                        ? (darkMode ? "bg-gray-800 text-gray-600" : "bg-gray-100 text-gray-400")
                        : (darkMode ? "bg-slate-600 text-white hover:bg-slate-500" : "bg-slate-600 text-white hover:bg-slate-700")
                    )}
                  >
                    {isGenerating ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    {isGenerating ? "Generating..." : "Generate Design"}
                  </button>
                </div>
              </div>

              <div>
                <h2 className={cn("text-xs font-semibold uppercase tracking-wider mb-4", darkMode ? "text-gray-500" : "text-gray-400")}>Usable Pixels</h2>
                <div className="grid grid-cols-1 gap-3">
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      onClick={() => {
                        setSelectedSize('small');
                        addShape('square');
                      }}
                      className={cn(
                        "flex items-center gap-3 p-3 border rounded-xl transition-all",
                        darkMode ? "border-gray-800 hover:bg-gray-700" : "border-gray-100 hover:bg-gray-50"
                      )}
                    >
                      <Square className={cn("w-3 h-3", darkMode ? "text-gray-400" : "text-gray-600")} />
                      <span className="text-xs font-medium">Small Pixel</span>
                    </button>
                    <button
                      onClick={() => {
                        setSelectedSize('medium');
                        addShape('square');
                      }}
                      className={cn(
                        "flex items-center gap-3 p-3 border rounded-xl transition-all",
                        darkMode ? "border-gray-800 hover:bg-gray-700" : "border-gray-100 hover:bg-gray-50"
                      )}
                    >
                      <Square className={cn("w-4 h-4", darkMode ? "text-gray-400" : "text-gray-600")} />
                      <span className="text-xs font-medium">Medium Pixel</span>
                    </button>
                    <button
                      onClick={() => {
                        setSelectedSize('large');
                        addShape('square');
                      }}
                      className={cn(
                        "flex items-center gap-3 p-3 border rounded-xl transition-all",
                        darkMode ? "border-gray-800 hover:bg-gray-700" : "border-gray-100 hover:bg-gray-50"
                      )}
                    >
                      <Square className={cn("w-5 h-5", darkMode ? "text-gray-400" : "text-gray-600")} />
                      <span className="text-xs font-medium">Large Pixel</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => addShape('quarter-circle', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 180)}
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 p-3 border rounded-xl transition-all",
                        darkMode ? "border-gray-800 hover:bg-gray-700" : "border-gray-100 hover:bg-gray-50"
                      )}
                      title="Upper Left Quarter"
                    >
                      <div className="relative w-6 h-6">
                        <div className={cn("absolute top-0 left-0 w-3 h-3 rounded-tl-full", darkMode ? "bg-gray-400" : "bg-gray-600")} />
                      </div>
                      <span className="text-[10px] font-medium">Upper Left</span>
                    </button>
                    <button
                      onClick={() => addShape('quarter-circle', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 270)}
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 p-3 border rounded-xl transition-all",
                        darkMode ? "border-gray-800 hover:bg-gray-700" : "border-gray-100 hover:bg-gray-50"
                      )}
                      title="Upper Right Quarter"
                    >
                      <div className="relative w-6 h-6">
                        <div className={cn("absolute top-0 right-0 w-3 h-3 rounded-tr-full", darkMode ? "bg-gray-400" : "bg-gray-600")} />
                      </div>
                      <span className="text-[10px] font-medium">Upper Right</span>
                    </button>
                    <button
                      onClick={() => addShape('quarter-circle', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 90)}
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 p-3 border rounded-xl transition-all",
                        darkMode ? "border-gray-800 hover:bg-gray-700" : "border-gray-100 hover:bg-gray-50"
                      )}
                      title="Lower Left Quarter"
                    >
                      <div className="relative w-6 h-6">
                        <div className={cn("absolute bottom-0 left-0 w-3 h-3 rounded-bl-full", darkMode ? "bg-gray-400" : "bg-gray-600")} />
                      </div>
                      <span className="text-[10px] font-medium">Lower Left</span>
                    </button>
                    <button
                      onClick={() => addShape('quarter-circle', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 0)}
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 p-3 border rounded-xl transition-all",
                        darkMode ? "border-gray-800 hover:bg-gray-700" : "border-gray-100 hover:bg-gray-50"
                      )}
                      title="Lower Right Quarter"
                    >
                      <div className="relative w-6 h-6">
                        <div className={cn("absolute bottom-0 right-0 w-3 h-3 rounded-br-full", darkMode ? "bg-gray-400" : "bg-gray-600")} />
                      </div>
                      <span className="text-[10px] font-medium">Lower Right</span>
                    </button>
                  </div>

                <div className="pt-2">
                  <label className={cn(
                    "flex items-center justify-center gap-3 p-4 border-2 border-dashed rounded-xl cursor-pointer transition-all mt-3",
                    darkMode 
                      ? "border-slate-900/50 hover:border-slate-400 hover:bg-slate-900/20" 
                      : "border-slate-100 hover:border-slate-500 hover:bg-slate-50"
                  )}>
                    {isVisionLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
                    ) : (
                      <Sparkles className={cn("w-5 h-5", darkMode ? "text-slate-400" : "text-slate-600")} />
                    )}
                    <div className="text-left">
                      <p className="text-xs font-bold">{isVisionLoading ? "Analyzing..." : "AI Magic from Image"}</p>
                      <p className="text-[10px] opacity-50">AI interprets your photo</p>
                    </div>
                    <input 
                      type="file" 
                      accept="image/png,image/jpeg" 
                      className="hidden" 
                      onChange={generateFromImageAI}
                      disabled={isVisionLoading}
                    />
                  </label>
                </div>
              </div>
            </div>
          </section>

          {/* Size Selection */}
          <section>
            <h2 className={cn("text-xs font-semibold uppercase tracking-wider mb-4", darkMode ? "text-gray-500" : "text-gray-400")}>Brush Size</h2>
            <div className="flex gap-2">
              {(['small', 'medium', 'large'] as Size[]).map(size => (
                <button
                  key={size}
                  onClick={() => setSelectedSize(size)}
                  className={cn(
                    "flex-1 py-2 text-xs font-medium rounded-lg border transition-all capitalize",
                    selectedSize === size 
                      ? (darkMode ? "bg-slate-500 border-slate-500 text-white shadow-md" : "bg-slate-600 border-slate-600 text-white shadow-md")
                      : (darkMode ? "bg-gray-800 border-gray-700 text-gray-400 hover:border-slate-800" : "bg-white border-gray-200 text-gray-600 hover:border-slate-300")
                  )}
                >
                  {size}
                </button>
              ))}
            </div>
          </section>

          {/* Stats */}
          <section className={cn("rounded-2xl p-5 border transition-colors", darkMode ? "bg-gray-800/50 border-gray-800" : "bg-gray-50 border-gray-100")}>
            <h2 className={cn("text-xs font-semibold uppercase tracking-wider mb-4", darkMode ? "text-gray-500" : "text-gray-400")}>Composition</h2>
            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <span className={cn("text-xs", darkMode ? "text-gray-400" : "text-gray-500")}>Quarter Circles</span>
                <span className={cn("text-2xl font-mono font-bold", darkMode ? "text-slate-400" : "text-slate-600")}>{totalQC}</span>
              </div>
            </div>
          </section>
        </div>

        {/* Footer Controls */}
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 relative overflow-hidden flex flex-col">
        {/* Canvas Toolbar */}
        <div className={cn(
          "h-16 border-b flex items-center justify-between px-8 shadow-sm transition-colors",
          darkMode ? "bg-[#1e1e1e] border-gray-800" : "bg-white border-gray-200"
        )}>
          <div className="flex items-center gap-4">
            <div className={cn("flex items-center gap-2", darkMode ? "text-gray-500" : "text-gray-400")}>
              <LayoutGrid className="w-4 h-4" />
              <span className="text-xs font-medium">Grid Snapping Active</span>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setDarkMode(!darkMode)}
              className={cn(
                "p-2 rounded-lg transition-colors",
                darkMode ? "hover:bg-gray-800 text-yellow-400" : "hover:bg-gray-100 text-gray-600"
              )}
              title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <div className={cn("w-px h-6 mx-1", darkMode ? "bg-gray-800" : "bg-gray-200")} />
            <button 
              onClick={handleRotate}
              disabled={!selectedId}
              className={cn(
                "p-2 rounded-lg disabled:opacity-30 transition-colors",
                darkMode ? "hover:bg-gray-800 text-gray-400" : "hover:bg-gray-100 text-gray-600"
              )}
              title="Rotate 90°"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
            <div className={cn("w-px h-6 mx-1", darkMode ? "bg-gray-800" : "bg-gray-200")} />
            <button 
              onClick={handleDelete}
              disabled={!selectedId}
              className={cn(
                "p-2 rounded-lg disabled:opacity-30 transition-colors",
                darkMode ? "hover:bg-red-900/20 text-gray-400 hover:text-red-400" : "hover:bg-red-50 text-gray-600 hover:text-red-600"
              )}
              title="Delete Selected"
            >
              <Trash2 className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setShapes([])}
              className={cn(
                "ml-4 px-4 py-2 text-xs font-bold rounded-lg transition-colors",
                darkMode ? "bg-slate-600 text-white hover:bg-slate-500" : "bg-gray-900 text-white hover:bg-gray-800"
              )}
            >
              Clear Canvas
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className={cn(
          "flex-1 relative overflow-auto p-12 flex justify-center items-start transition-colors",
          darkMode ? "bg-[#0a0a0a]" : "bg-[#e5e5e5]"
        )}>
          <div 
            className={cn(
              "shadow-2xl relative transition-colors",
              darkMode ? "bg-black" : "bg-white"
            )}
            style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
          >
            {/* Grid Pattern Overlay */}
            <div 
              className={cn("absolute inset-0 pointer-events-none transition-opacity", darkMode ? "opacity-10" : "opacity-5")}
              style={{
                backgroundImage: `linear-gradient(to right, ${darkMode ? '#fff' : '#000'} 1px, transparent 1px), linear-gradient(to bottom, ${darkMode ? '#fff' : '#000'} 1px, transparent 1px)`,
                backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`
              }}
            />
            
            <Stage 
              width={CANVAS_WIDTH} 
              height={CANVAS_HEIGHT}
              ref={stageRef}
              onMouseDown={(e) => {
                if (e.target === e.target.getStage()) {
                  setSelectedId(null);
                }
              }}
            >
              <Layer>
                {shapes.map(renderShape)}
                {selectedId && (
                  <Transformer
                    ref={transformerRef}
                    rotateEnabled={true}
                    rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
                    enabledAnchors={[]}
                    boundBoxFunc={(oldBox, newBox) => newBox}
                    anchorStroke={darkMode ? '#fff' : '#000'}
                    borderStroke={darkMode ? '#fff' : '#000'}
                  />
                )}
              </Layer>
            </Stage>

            {/* Source Image Preview */}
            {sourceImage && (
              <div className={cn(
                "absolute bottom-4 right-4 p-2 rounded-lg border-2 shadow-xl overflow-hidden transition-all group",
                darkMode ? "bg-black border-slate-800" : "bg-white border-slate-200"
              )} style={{ width: 120, height: 120 }}>
                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-[8px] text-white font-bold uppercase tracking-widest bg-black/60 px-2 py-1 rounded">Source</span>
                </div>
                <img 
                  src={sourceImage} 
                  alt="Source" 
                  className="w-full h-full object-cover rounded"
                  referrerPolicy="no-referrer"
                />
              </div>
            )}
          </div>
        </div>

        {/* Floating Help */}
        <div className={cn(
          "absolute bottom-8 right-8 backdrop-blur-md p-4 rounded-2xl border shadow-xl max-w-xs transition-colors",
          darkMode ? "bg-gray-900/80 border-gray-800 text-gray-300" : "bg-white/80 border-white text-gray-700"
        )}>
          <h3 className={cn("text-xs font-bold mb-2 flex items-center gap-2", darkMode ? "text-gray-100" : "text-gray-900")}>
            <Move className="w-3 h-3" /> Shortcuts
          </h3>
          <ul className={cn("text-[10px] space-y-1", darkMode ? "text-gray-400" : "text-gray-500")}>
            <li>• Drag shapes to move (snaps to grid)</li>
            <li>• Click a shape to select it</li>
            <li>• Use the toolbar to rotate or delete</li>
            <li>• Auto-arrange creates geometric layouts</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
