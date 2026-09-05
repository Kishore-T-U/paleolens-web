"use client";
import { useState, useRef, ChangeEvent, useEffect, useCallback } from "react";
import * as ort from "onnxruntime-web";
// import { supabase } from "@/lib/supabase"; // <-- Update this to your actual Supabase client path

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";

const LABELS = [
  "Ammonites", "Belemnites", "Corals", 
  "Crinoids", "Leaf fossils", "Trilobites"
];

// Upgraded Database with Authoritative Taxonomic Sourcing
interface FossilMeta {
  period: string;
  era: string;
  environment: string;
  biozoneRole: string;
  keyMorphology: string;
  sourceName: string;
  sourceUrl: string;
}

const PALEO_DATABASE: Record<string, FossilMeta> = {
  "Ammonites": {
    period: "Devonian – Cretaceous (419 – 66 Ma)",
    era: "Mesozoic Index Fossil",
    environment: "Pelagic / Open Marine (Nektonic)",
    biozoneRole: "Primary biostratigraphic index zone marker for Mesozoic marine strata.",
    keyMorphology: "Planispiral chambered phragmocone with complex suture patterns.",
    sourceName: "Taxonomic Reference (Ammonoidea)",
    sourceUrl: "https://en.wikipedia.org/wiki/Ammonoidea"
  },
  "Belemnites": {
    period: "Early Jurassic – Late Cretaceous (201 – 66 Ma)",
    era: "Mesozoic Cephalopod",
    environment: "Pelagic / Shelf Marine (Nektonic)",
    biozoneRole: "Critical belemnite biozonation marker in Boreal Jurassic-Cretaceous basins.",
    keyMorphology: "Solid calcite rostrum (guard), internal phragmocone, hooked tentacular arms.",
    sourceName: "Taxonomic Reference (Belemnoidea)",
    sourceUrl: "https://en.wikipedia.org/wiki/Belemnoidea"
  },
  "Corals": {
    period: "Ordovician – Holocene (485 Ma – Present)",
    era: "Paleozoic to Cenozoic",
    environment: "Shallow Marine Carbonate Platform / Benthic Reef",
    biozoneRole: "Paleo-bathymetric and warm-water paleoclimate paleolatitude indicator.",
    keyMorphology: "Calcareous corallite skeleton, radiating septa, colonial or solitary rugose/tabulate structure.",
    sourceName: "Taxonomic Reference (Anthozoa)",
    sourceUrl: "https://en.wikipedia.org/wiki/Anthozoa"
  },
  "Crinoids": {
    period: "Ordovician – Holocene (485 Ma – Present)",
    era: "Paleozoic Peak (Carboniferous)",
    environment: "Sessile Benthic Marine (High-energy shelf / crinoid meadows)",
    biozoneRole: "Primary limestone contributor ('encrinite'); indicator of oxygenated, normal-salinity marine shelf.",
    keyMorphology: "Pentameral columnal stems, calyx (cup), and feeding arms with pinnules.",
    sourceName: "Taxonomic Reference (Crinoidea)",
    sourceUrl: "https://en.wikipedia.org/wiki/Crinoid"
  },
  "Leaf fossils": {
    period: "Silurian – Holocene (430 Ma – Present)",
    era: "Paleozoic to Modern Continental",
    environment: "Terrestrial / Fluvial-Lacustrine Floodplain",
    biozoneRole: "Paleobotanical continental climate indicator (leaf margin analysis for paleotemperatures).",
    keyMorphology: "Reticulate or parallel venation, petiole, and carbonized cuticular film.",
    sourceName: "Paleobotanical Reference",
    sourceUrl: "https://en.wikipedia.org/wiki/Paleobotany"
  },
  "Trilobites": {
    period: "Early Cambrian – End Permian (521 – 252 Ma)",
    era: "Paleozoic Index Fossil",
    environment: "Benthic Marine Shelf / Continental Slope",
    biozoneRole: "Standard global biostratigraphic index fossil for Cambrian and Ordovician strata.",
    keyMorphology: "Trilobed chitinous exoskeleton (cephalon, thorax, pygidium) with holochroal/schizochroal eyes.",
    sourceName: "Taxonomic Reference (Trilobita)",
    sourceUrl: "https://en.wikipedia.org/wiki/Trilobite"
  }
};

export default function PaleoLensApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const lastImageSourceRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  const lastOutputTensorRef = useRef<{ data: Float32Array; dims: readonly number[] } | null>(null);

  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [useCamera, setUseCamera] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const [inferenceTime, setInferenceTime] = useState<number | null>(null);
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.40);
  const [classScores, setClassScores] = useState<number[]>(Array(6).fill(0));
  const [detectedSpecimens, setDetectedSpecimens] = useState<string[]>([]);
  
  // NEW: Analytical state for model limitations
  const [taphonomicWarning, setTaphonomicWarning] = useState<string | null>(null);

  const startCamera = async () => {
    try {
      // 1. Clear the canvas overlay so old bounding boxes disappear
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      }

      // 2. Start the live camera stream
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: true 
      });
      setStream(mediaStream);
      setUseCamera(true);
    } catch (err) {
      console.error("Camera access denied:", err);
      alert("Could not access camera. Check browser permissions.");
    }
  };

  // 2. Stop Camera
  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    setStream(null);
    setUseCamera(false);
  }, [stream]);

  // 3. The ONLY useEffect you need for the video
  useEffect(() => {
    let playPromise: Promise<void> | undefined;
    const currentVideo = videoRef.current;

    if (useCamera && stream && currentVideo) {
      currentVideo.srcObject = stream;
      
      playPromise = currentVideo.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          if (err.name !== 'AbortError') {
            console.error("Video play error:", err);
          }
        });
      }
    }

    // Only detach the source on cleanup, DO NOT kill the hardware tracks here
    return () => {
      if (currentVideo) {
        currentVideo.srcObject = null;
      }
    };
  }, [useCamera, stream]);

  const redrawDetections = useCallback((threshold: number) => {
    if (!lastImageSourceRef.current || !lastOutputTensorRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.drawImage(lastImageSourceRef.current, 0, 0, 224, 224);
    parseAndDrawBoxes(
            lastOutputTensorRef.current.data,
            lastOutputTensorRef.current.dims,
            ctx,
            threshold
          );
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);

  const handleSliderChange = (newThreshold: number) => {
    setConfidenceThreshold(newThreshold);
    redrawDetections(newThreshold);
  };

  const runInference = async (source: HTMLImageElement | HTMLVideoElement) => {
    setLoading(true);
    setTaphonomicWarning(null); // Clear previous warnings
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    canvas.width = 224;
    canvas.height = 224;
    ctx.drawImage(source, 0, 0, 224, 224);
    lastImageSourceRef.current = source;

    const imageData = ctx.getImageData(0, 0, 224, 224).data;
    const input = new Float32Array(224 * 224 * 3);

    for (let i = 0; i < 224 * 224; i++) {
      input[i] = imageData[i * 4] / 255.0;
      input[i + 224 * 224] = imageData[i * 4 + 1] / 255.0;
      input[i + 2 * 224 * 224] = imageData[i * 4 + 2] / 255.0;
    }

    try {
      const tensor = new ort.Tensor("float32", input, [1, 3, 224, 224]);
      const session = await ort.InferenceSession.create("/models/best.onnx");

      const startTime = performance.now();
      const results = await session.run({ images: tensor });
      const endTime = performance.now();
      setInferenceTime(Math.round(endTime - startTime));

      const outputTensor = results[session.outputNames[0]];
      const rawData = outputTensor.data as Float32Array;
      const dims = outputTensor.dims;

      lastOutputTensorRef.current = { data: rawData, dims };
      parseAndDrawBoxes(rawData, dims, ctx, confidenceThreshold);
    } catch (err) {
      console.error("Inference Error:", err);
    }
    setLoading(false);
  };

  // STEP 3: Algorithmic Error Analysis Engine
  // STEP 3: Scalable Rule-Based Expert System for Error Analysis
  const evaluateTaphonomicOverlap = (scores: number[]) => {
    // Map scores to class names for easier logic
    const scoreMap = {
      "Ammonites": scores[0],
      "Belemnites": scores[1],
      "Corals": scores[2],
      "Crinoids": scores[3],
      "Leaf fossils": scores[4],
      "Trilobites": scores[5]
    };

    // The Diagnostic Rules Matrix (Scalable to hundreds of rules)
    const TAPHONOMIC_RULES = [
      {
        dominant: "Trilobites", secondary: "Belemnites", 
        warning: "Taphonomic Convergence Alert: Ribbed tentacular preservation in cephalopods (Belemnites) frequently mimics trilobite thoracic segmentation. Verify bilateral symmetry manually."
      },
      {
        dominant: "Ammonites", secondary: "Trilobites", 
        warning: "Diagnostic Alert: Crushed planispiral shells can present edge-compression pseudo-segmentation resembling arthropod pygidia."
      },
      {
        dominant: "Corals", secondary: "Crinoids", 
        warning: "Morphological Overlap: Crinoid stem cross-sections in limestone matrix closely mimic colonial rugose corallite tubes. Cross-reference with standard paleoenvironment."
      },
      {
        dominant: "Leaf fossils", secondary: "Crinoids", 
        warning: "Matrix Alert: Carbonized crinoid pinnules (feeding arms) can visually simulate leaf venation in 2D compression fossils."
      }
    ];

    // Evaluate the neural network output against the Rules Matrix
    let activeWarning = null;
    
    for (const rule of TAPHONOMIC_RULES) {
      const dominantScore = scoreMap[rule.dominant as keyof typeof scoreMap];
      const secondaryScore = scoreMap[rule.secondary as keyof typeof scoreMap];
      
      // If the dominant class is high (> 40%) but a known confusing class is also registering (> 1%)
      if (dominantScore > 0.40 && secondaryScore > 0.01) {
        activeWarning = rule.warning;
        break; // Stop at the first triggered rule
      }
    }

    setTaphonomicWarning(activeWarning);
  };

  const parseAndDrawBoxes = (
    output: Float32Array,
    dims: readonly number[],
    ctx: CanvasRenderingContext2D,
    threshold: number
  ) => {
    const numClasses = 6;
    const numAnchors = dims[2];
    const maxScores = Array(numClasses).fill(0);
    const activeDetections: string[] = [];

    for (let i = 0; i < numAnchors; i++) {
      let maxConf = 0;
      let classId = -1;

      for (let c = 0; c < numClasses; c++) {
        const conf = output[(4 + c) * numAnchors + i];
        if (conf > maxConf) {
          maxConf = conf;
          classId = c;
        }
      }

      if (maxConf > maxScores[classId]) maxScores[classId] = maxConf;

      if (maxConf > threshold) {
        const xc = output[0 * numAnchors + i];
        const yc = output[1 * numAnchors + i];
        const w = output[2 * numAnchors + i];
        const h = output[3 * numAnchors + i];
        const x1 = xc - w / 2;
        const y1 = yc - h / 2;

        ctx.strokeStyle = "#2dd4bf";
        ctx.lineWidth = 2;
        ctx.strokeRect(x1, y1, w, h);

        const label = `${LABELS[classId]} ${(maxConf * 100).toFixed(1)}%`;
        ctx.fillStyle = "#2dd4bf";
        ctx.font = "12px sans-serif";
        const textWidth = ctx.measureText(label).width;
        ctx.fillRect(x1, y1 > 18 ? y1 - 18 : 0, textWidth + 6, 18);
        ctx.fillStyle = "#0f172a";
        ctx.fillText(label, x1 + 3, y1 > 18 ? y1 - 4 : 14);

        if (!activeDetections.includes(LABELS[classId])) activeDetections.push(LABELS[classId]);
      }
    }

    setClassScores(maxScores);
    setDetectedSpecimens(activeDetections);
    evaluateTaphonomicOverlap(maxScores);
  };

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (useCamera) stopCamera();

    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => runInference(img);
  };

  const handleCaptureCamera = () => {
    if (videoRef.current) runInference(videoRef.current);
    stopCamera();
  };

  // STEP 4 Prep: Edge-to-Cloud Telemetry Synchronization
  const syncToSupabase = async () => {
    if (!topClassName) return;
    setSyncing(true);

    // 1. Fetch live GPS coordinates from the device
    let lat = null;
    let lng = null;
    
    if ("geolocation" in navigator) {
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { 
            timeout: 5000, 
            enableHighAccuracy: true 
          });
        });
        lat = position.coords.latitude;
        lng = position.coords.longitude;
      } catch (geoError) {
        console.warn("GPS access denied or unavailable. Proceeding without location.", geoError);
      }
    }
    
    // 2. Build the payload
    const payload = {
      primary_identification: topClassName,
      confidence_score: topScore,
      assemblage: detectedSpecimens,
      inference_latency_ms: inferenceTime,
      taphonomic_flag: taphonomicWarning ? true : false,
      latitude: lat,
      longitude: lng,
      timestamp: new Date().toISOString()
    };

    try {
      console.log("Transmitting telemetry to Supabase:", payload);
      // Uncomment this when your Supabase client is imported!
      // await supabase.from('paleo_diagnostics').insert([payload]);
      
      await new Promise(res => setTimeout(res, 800)); 
      alert(`Diagnostic synced to cloud! ${lat !== null && lng !== null ? `\nLocation Tagged: ${lat.toFixed(4)}, ${lng.toFixed(4)}` : ''}`);
    } catch (error) {
      console.error("Supabase sync failed", error);
    }
    setSyncing(false);
  };

  const topScore = Math.max(...classScores);
  const topClassIndex = classScores.indexOf(topScore);
  const topClassName = topScore > 0 ? LABELS[topClassIndex] : null;
  const activeFossilData = topClassName ? PALEO_DATABASE[topClassName] : null;

  return (
    <div className="flex flex-col items-center gap-6 p-8 bg-slate-950 text-white min-h-screen font-sans">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-teal-400 mb-1">PaleoLens Field Diagnostic Engine</h1>
        <p className="text-slate-400 text-sm">Edge Inferencing with Cloud Telemetry Synchronization</p>
      </div>

      <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 shadow-xl flex flex-col items-center w-full max-w-xl">
        <div className="flex gap-4 mb-4 w-full justify-center print:hidden">
          <label className="bg-slate-800 hover:bg-slate-700 text-teal-400 border border-teal-500/30 px-4 py-2 rounded-lg cursor-pointer transition-colors text-sm font-medium">
            Upload Matrix Image
            <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
          </label>
          <button 
  onClick={useCamera ? stopCamera : startCamera} 
  className={`px-4 py-2 rounded-md font-medium transition text-sm ${
    useCamera 
      ? "border border-red-900 bg-red-950/30 text-red-400 hover:bg-red-900/50" 
      : "border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700"
  }`}
>
  {useCamera ? "Halt Camera Feed" : "Initialize Camera"}
</button>
        </div>

        <div className="w-full mb-6 bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col gap-2 print:hidden">
          <div className="flex justify-between text-xs font-bold tracking-wider text-slate-400">
            <span>DETECTION SENSITIVITY (CONFIDENCE CUTOFF)</span>
            <span className="text-teal-400 font-mono">{(confidenceThreshold * 100).toFixed(0)}%</span>
          </div>
          <input type="range" min="0.05" max="0.95" step="0.02" value={confidenceThreshold} onChange={(e) => handleSliderChange(parseFloat(e.target.value))} className="w-full accent-teal-500 cursor-pointer" />
        </div>

        {/* The AR Scanner Effect (Only shows when camera is active) */}

        {useCamera && <div className="scanner-laser print:hidden" />}

        <div className="relative w-full h-[224px] bg-slate-950 rounded-lg overflow-hidden flex justify-center">
          <div className="absolute top-2 left-2 z-30 bg-slate-900/90 text-[10px] text-teal-400 p-2 rounded border border-teal-500/30 font-mono flex flex-col gap-1 pointer-events-none">
            <div className="flex justify-between gap-4"><span className="text-slate-500">BACKEND:</span><span>WASM-SIMD</span></div>
            <div className="flex justify-between gap-4"><span className="text-slate-500">LATENCY:</span><span>{inferenceTime ? `${inferenceTime}ms` : "---"}</span></div>
          </div>
          {loading && <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 z-20"><p className="text-teal-400 font-medium text-xs animate-pulse font-mono">RUNNING CLIENT TENSORS...</p></div>}
          {useCamera && (
  <video
  ref={videoRef}
  autoPlay
  playsInline
  muted={true}
  className="absolute inset-0 w-full h-full object-cover bg-black"
/>
)}
          <canvas ref={canvasRef} className={`block w-[224px] h-[224px] ${useCamera ? "z-10 relative pointer-events-none" : ""}`}></canvas>
        </div>

        {useCamera && <button onClick={handleCaptureCamera} className="bg-teal-500 hover:bg-teal-600 text-slate-900 font-bold px-6 py-2.5 rounded-lg mb-6 transition-colors w-full text-sm">Freeze Frame & Classify</button>}

        {/* STEP 3 Feature: Taphonomic Warning System */}
        {taphonomicWarning && (
          <div className="w-full bg-amber-950/40 border border-amber-500/50 rounded-lg p-4 mb-6 text-left shadow-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-amber-500 text-lg">⚠️</span>
              <span className="text-[11px] font-mono tracking-widest text-amber-500 font-bold uppercase">Automated Error Analysis</span>
            </div>
            <p className="text-amber-200 text-xs leading-relaxed font-mono">{taphonomicWarning}</p>
          </div>
        )}

        {activeFossilData && topClassName && (
          <div className="w-full bg-slate-950 border border-teal-500/30 rounded-lg p-5 mb-6 text-left">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3 mb-3">
              <div>
                <span className="text-[10px] font-mono tracking-widest text-teal-400 font-bold block">STRATIGRAPHIC CONTEXT</span>
                <h3 className="text-lg font-bold text-slate-100">{topClassName}</h3>
              </div>
              <span className="bg-teal-950 text-teal-300 border border-teal-600/40 text-[11px] px-2.5 py-1 rounded font-mono font-medium">{activeFossilData.era}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs mb-3">
              <div className="bg-slate-900 p-2.5 rounded border border-slate-800">
                <span className="text-slate-500 block mb-1 font-mono uppercase text-[10px]">Geological Range</span>
                <span className="text-slate-200 font-semibold">{activeFossilData.period}</span>
              </div>
              <div className="bg-slate-900 p-2.5 rounded border border-slate-800">
                <span className="text-slate-500 block mb-1 font-mono uppercase text-[10px]">Depositional Facies</span>
                <span className="text-slate-200 font-semibold">{activeFossilData.environment}</span>
              </div>
            </div>

            <div className="bg-slate-900 p-2.5 rounded border border-slate-800 mb-3 text-xs">
              <span className="text-slate-500 block mb-1 font-mono uppercase text-[10px]">Taxonomic Source Verification</span>
              <a href={activeFossilData.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:text-teal-300 underline underline-offset-2 transition-colors flex items-center gap-2">
                {activeFossilData.sourceName} ↗
              </a>
            </div>

            {detectedSpecimens.length > 1 && (
              <div className="mt-3 p-2.5 bg-indigo-950/40 border border-indigo-500/30 rounded text-xs">
                <span className="text-indigo-400 font-bold font-mono text-[10px] uppercase block mb-1">Co-occurring Fossil Assemblage</span>
                <span className="text-indigo-200">Detected concurrent taxa: {detectedSpecimens.join(", ")}. Consistent with multi-taxa fossiliferous horizon.</span>
              </div>
            )}
            
            {/* Supabase Sync Button */}
            <button 
              onClick={syncToSupabase}
              disabled={syncing}
              className="mt-4 w-full bg-slate-800 hover:bg-slate-700 text-teal-400 border border-teal-500/30 py-2 rounded transition-colors text-xs font-mono tracking-widest font-bold disabled:opacity-50"
            >
              {syncing ? "UPLOADING TO SUPABASE..." : "SYNC DIAGNOSTIC TO SUPABASE CLOUD"}
            </button>

            {/* PDF Export Button */}
            <button 
              onClick={() => window.print()}
              className="mt-3 w-full bg-slate-200 hover:bg-white text-slate-900 border border-slate-300 py-2 rounded transition-colors text-xs font-mono tracking-widest font-bold print:hidden"
            >
              EXPORT LAB DIAGNOSTIC (PDF)
            </button>

          </div>
        )}
      </div>
    </div>
  );
}