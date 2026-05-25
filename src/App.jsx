import { useState, useRef, useEffect } from "react";

const SYSTEM_PROMPT = `You are MOTO-RAG, a strict motorcycle diagnostic assistant. Your knowledge is LIMITED EXCLUSIVELY to the owner's/service manual provided as a PDF document in this conversation.

ABSOLUTE OPERATING RULES — ZERO EXCEPTIONS:
1. ONLY answer using information explicitly stated in the provided PDF manual. Never use external knowledge, training data, or general mechanical expertise.
2. ALWAYS cite the exact section name and page number from the manual (e.g., "Per Section 5.3 - Troubleshooting Engine Faults, Page 82").
3. If the answer or procedure is NOT found in the manual, respond EXACTLY with this message and nothing else: "⚠️ NOT IN MANUAL — This specific issue is not documented in the provided reference manual. Please consult an authorized service center or qualified mechanic for your safety."
4. Never speculate, infer, or extrapolate beyond what the manual explicitly states.
5. When analyzing images: describe only the visible symptoms you observe, then cross-reference ONLY with manual content.
6. Structure every diagnostic response as follows:
   🔍 DIAGNOSIS: [what the issue appears to be based on manual]
   📖 MANUAL REFERENCE: [exact section title and page number]
   🔧 PROCEDURE: [numbered step-by-step instructions copied from the manual]
   ⚠️ SAFETY NOTES: [any warnings or cautions the manual mentions for this procedure]
7. If a safety risk exists and is mentioned in the manual, you MUST include it.
8. For questions about general motorcycle topics not related to diagnostics/troubleshooting, still restrict answers to what appears in the manual.`;

const STARTER_PROMPTS = [
  "Engine won't start — what should I check?",
  "Explain the warning lights on my dashboard",
  "My exhaust is producing white smoke",
  "How do I check and adjust the chain slack?",
];

export default function App() {
  const [phase, setPhase] = useState("upload");
  const [manualBase64, setManualBase64] = useState(null);
  const [manualName, setManualName] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [isLoadingManual, setIsLoadingManual] = useState(false);

  const manualInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const loadManual = (file) => {
    if (!file) return;
    if (file.type !== "application/pdf") {
      setUploadError("Only PDF files are supported. Please upload your motorcycle's manual as a PDF.");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setUploadError("File size exceeds 50MB. Please use a smaller PDF.");
      return;
    }
    setUploadError("");
    setIsLoadingManual(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      setManualBase64(e.target.result.split(",")[1]);
      setManualName(file.name.replace(/\.pdf$/i, ""));
      setPhase("chat");
      setIsLoadingManual(false);
    };
    reader.onerror = () => {
      setUploadError("Failed to read file. Please try again.");
      setIsLoadingManual(false);
    };
    reader.readAsDataURL(file);
  };

  const loadImage = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setPendingImage({ base64: e.target.result.split(",")[1], mime: file.type, preview: e.target.result });
    };
    reader.readAsDataURL(file);
  };

  const autoResize = (el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

 const buildApiMessages = (msgs) => {
    return msgs.map((msg, idx) => {
      if (msg.role === "user") {
        const content = [];
        if (idx === 0 && manualBase64) {
          content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: manualBase64 } });
        }
        if (msg.imageBase64) {
          content.push({ type: "image", source: { type: "base64", media_type: msg.imageMime, data: msg.imageBase64 } });
        }
        content.push({ type: "text", text: msg.text });
        return { role: "user", content };
      }
      return { role: "assistant", content: msg.text };
    });
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text && !pendingImage) return;
    if (isLoading) return;

    const userMsg = {
      role: "user",
      text: text || "(Submitted image for visual diagnosis)",
      imageBase64: pendingImage?.base64 || null,
      imageMime: pendingImage?.mime || null,
      imagePreview: pendingImage?.preview || null,
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setPendingImage(null);
    if (textareaRef.current) textareaRef.current.style.height = "44px";
    setIsLoading(true);

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
      headers: { 
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "pdfs-2024-09-25", // <-- THIS IS THE MISSING MAGIC LINE
          "anthropic-dangerous-direct-browser-access": "true" 
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: buildApiMessages(newMessages),
        }),
      });
      
      const data = await res.json();
      const reply = data.content?.map((b) => b.text || "").join("") || "No response received.";
      setMessages((prev) => [...prev, { role: "assistant", text: reply }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "⚠️ CONNECTION ERROR — Please check your connection." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const resetSession = () => { setPhase("upload"); setMessages([]); setManualBase64(null); setManualName(""); setPendingImage(null); setInput(""); };

  const isNotInManual = (text) => text.startsWith("⚠️ NOT IN MANUAL");
  const isError = (text) => text.startsWith("⚠️ CONNECTION ERROR") || text.startsWith("⚠️ ERROR");

  if (phase === "upload") {
    return (
      <>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html, body { background: #090909; height: 100%; }
          .upload-btn:hover { border-color: #F59E0B !important; color: #F59E0B !important; }
          .chip:hover { border-color: #444 !important; color: #AAA !important; cursor: default; }
        `}</style>
        <div style={{ fontFamily: "'Rajdhani', sans-serif", background: "#090909", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", color: "#E0D8C8" }}>

          {/* Logo strip */}
          <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "2.5rem" }}>
            <div style={{ width: "44px", height: "44px", background: "#1A1A0A", border: "1px solid #F59E0B", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px" }}>🏍️</div>
            <div>
              <div style={{ fontSize: "26px", fontWeight: "700", color: "#F59E0B", letterSpacing: "0.12em", lineHeight: 1 }}>MOTO-RAG</div>
              <div style={{ fontSize: "10px", color: "#555", letterSpacing: "0.2em", marginTop: "3px" }}>MANUAL-GROUNDED DIAGNOSTIC SYSTEM</div>
            </div>
          </div>

          {/* Upload card */}
          <div style={{ background: "#111", border: "1px solid #252525", borderRadius: "6px", padding: "2.5rem", maxWidth: "500px", width: "100%" }}>
            <p style={{ fontSize: "14px", color: "#666", lineHeight: "1.7", marginBottom: "1.5rem", textAlign: "center" }}>
              Upload your motorcycle's owner's or service manual (PDF) to begin.<br />
              All diagnostic answers are sourced exclusively from your document.
            </p>

            {/* Drop zone */}
            <div
              style={{ border: `2px dashed ${dragOver ? "#F59E0B" : "#2A2A2A"}`, borderRadius: "6px", padding: "2.5rem 1.5rem", textAlign: "center", cursor: "pointer", transition: "all 0.2s", background: dragOver ? "rgba(245,158,11,0.04)" : "transparent", position: "relative" }}
              onClick={() => !isLoadingManual && manualInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); loadManual(e.dataTransfer.files[0]); }}
            >
              {isLoadingManual ? (
                <>
                  <div style={{ fontSize: "30px", marginBottom: "0.75rem" }}>⏳</div>
                  <div style={{ fontSize: "15px", fontWeight: "600", color: "#F59E0B", letterSpacing: "0.05em" }}>PARSING MANUAL...</div>
                  <div style={{ fontSize: "12px", color: "#444", marginTop: "0.5rem" }}>This may take a moment for large files</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: "36px", marginBottom: "1rem" }}>📄</div>
                  <div style={{ fontSize: "16px", fontWeight: "600", color: dragOver ? "#F59E0B" : "#CCC", letterSpacing: "0.04em", marginBottom: "0.375rem" }}>Drop your PDF manual here</div>
                  <div style={{ fontSize: "12px", color: "#444" }}>or click to browse files</div>
                  <div style={{ display: "flex", gap: "6px", justifyContent: "center", marginTop: "1.25rem", flexWrap: "wrap" }}>
                    {["Owner's Manual", "Service Manual", "Workshop Manual"].map(t => (
                      <span key={t} className="chip" style={{ fontSize: "11px", color: "#444", border: "1px solid #222", borderRadius: "20px", padding: "2px 10px", transition: "all 0.15s" }}>{t}</span>
                    ))}
                  </div>
                </>
              )}
            </div>

            {uploadError && (
              <div style={{ marginTop: "1rem", color: "#F87171", fontSize: "13px", padding: "0.625rem 0.875rem", background: "#1C0A0A", borderRadius: "4px", border: "1px solid #3A1515" }}>{uploadError}</div>
            )}

            <input ref={manualInputRef} type="file" accept=".pdf,application/pdf" style={{ display: "none" }} onChange={(e) => loadManual(e.target.files[0])} />

            {/* Guardrails panel */}
            <div style={{ marginTop: "1.5rem", padding: "1rem", background: "#0A0A0A", border: "1px solid #1E1E1E", borderRadius: "4px" }}>
              <div style={{ fontSize: "10px", color: "#F59E0B", letterSpacing: "0.15em", fontWeight: "700", marginBottom: "0.75rem" }}>● ACTIVE GUARDRAILS</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px" }}>
                {[
                  "Zero hallucination policy",
                  "Manual-only knowledge",
                  "Section + page citations",
                  "Rejects unverifiable queries",
                  "Multimodal image input",
                  "Safety warnings enforced",
                ].map(g => (
                  <div key={g} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#3A6A3A" }}>
                    <span style={{ color: "#4ADE80", fontSize: "10px" }}>✓</span> {g}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginTop: "1.5rem", fontSize: "11px", color: "#333", letterSpacing: "0.08em" }}>
            SUPPORTS: ROYAL ENFIELD · TVS · BAJAJ · HONDA · YAMAHA · KAWASAKI · ANY BRAND
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #090909; height: 100%; overflow: hidden; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0A0A0A; } ::-webkit-scrollbar-thumb { background: #2A2A2A; border-radius: 2px; }
        textarea { resize: none; }
        textarea:focus { border-color: #F59E0B !important; box-shadow: 0 0 0 1px #F59E0B22 !important; outline: none; }
        .icon-btn:hover { border-color: #F59E0B !important; color: #F59E0B !important; }
        .starter-btn:hover { border-color: #333 !important; color: #999 !important; background: #1A1A1A !important; }
        .reset-btn:hover { border-color: #444 !important; color: #888 !important; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .msg-bubble { animation: fadeIn 0.25s ease forwards; }
        .scanning-cursor { animation: pulse 1s infinite; }
      `}</style>
      <div style={{ fontFamily: "'Rajdhani', sans-serif", background: "#090909", height: "100vh", display: "flex", overflow: "hidden", color: "#E0D8C8" }}>

        {/* SIDEBAR */}
        <div style={{ width: "210px", background: "#0F0F0F", borderRight: "1px solid #1E1E1E", display: "flex", flexDirection: "column", padding: "1.25rem", gap: "1.25rem", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: "17px", fontWeight: "700", color: "#F59E0B", letterSpacing: "0.1em" }}>MOTO-RAG</div>
            <div style={{ fontSize: "9px", color: "#383838", letterSpacing: "0.18em", marginTop: "2px" }}>DIAGNOSTIC SYSTEM</div>
          </div>

          <div style={{ background: "#141414", border: "1px solid #222", borderRadius: "4px", padding: "0.75rem" }}>
            <div style={{ fontSize: "9px", color: "#F59E0B66", letterSpacing: "0.12em", marginBottom: "6px", fontWeight: "600" }}>LOADED MANUAL</div>
            <div style={{ fontSize: "12px", color: "#BBB", lineHeight: "1.5", wordBreak: "break-word" }}>📄 {manualName}</div>
          </div>

          <div style={{ background: "#0B140B", border: "1px solid #162016", borderRadius: "4px", padding: "0.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#4ADE80" }}></div>
              <span style={{ fontSize: "9px", color: "#4ADE80", letterSpacing: "0.12em", fontWeight: "600" }}>GUARDRAILS ACTIVE</span>
            </div>
            <div style={{ fontSize: "11px", color: "#2A4A2A", lineHeight: "1.8" }}>
              ✓ Zero hallucination<br />
              ✓ Manual-only answers<br />
              ✓ Section citations<br />
              ✓ Image diagnostics
            </div>
          </div>

          <div style={{ background: "#14100A", border: "1px solid #2A1E0A", borderRadius: "4px", padding: "0.75rem" }}>
            <div style={{ fontSize: "9px", color: "#F59E0B66", letterSpacing: "0.12em", marginBottom: "6px", fontWeight: "600" }}>SESSION STATS</div>
            <div style={{ fontSize: "11px", color: "#4A3A1A", lineHeight: "1.8" }}>
              Queries: <span style={{ color: "#F59E0B" }}>{messages.filter(m => m.role === "user").length}</span><br />
              Status: <span style={{ color: isLoading ? "#F59E0B" : "#4ADE80" }}>{isLoading ? "SCANNING" : "READY"}</span>
            </div>
          </div>

          <div style={{ marginTop: "auto" }}>
            <button className="reset-btn" onClick={resetSession} style={{ width: "100%", background: "transparent", border: "1px solid #222", borderRadius: "4px", color: "#444", padding: "0.5rem", cursor: "pointer", fontSize: "11px", fontFamily: "'Rajdhani', sans-serif", letterSpacing: "0.08em", transition: "all 0.15s" }}>
              ← LOAD NEW MANUAL
            </button>
          </div>
        </div>

        {/* MAIN CHAT */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Header */}
          <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #1A1A1A", background: "#0D0D0D", display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: isLoading ? "#F59E0B" : "#4ADE80", transition: "background 0.3s" }}></div>
            <span style={{ fontSize: "12px", color: "#444", letterSpacing: "0.06em" }}>
              {isLoading ? "DIAGNOSTIC ENGINE SCANNING MANUAL..." : `DIAGNOSTIC ENGINE READY — ${manualName.slice(0, 40)}${manualName.length > 40 ? "..." : ""}`}
            </span>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>

            {messages.length === 0 && (
              <div style={{ textAlign: "center", marginTop: "2.5rem" }}>
                <div style={{ fontSize: "40px", marginBottom: "1rem" }}>🏍️</div>
                <div style={{ fontSize: "20px", fontWeight: "700", color: "#2A2A2A", letterSpacing: "0.06em" }}>AWAITING DIAGNOSTIC QUERY</div>
                <div style={{ fontSize: "13px", color: "#2A2A2A", marginTop: "0.625rem", lineHeight: "1.8" }}>
                  Describe your issue in text — or attach a photo of<br />
                  exhaust smoke, dashboard lights, leaks, or damage.
                </div>
                <div style={{ display: "flex", gap: "8px", justifyContent: "center", marginTop: "1.5rem", flexWrap: "wrap" }}>
                  {STARTER_PROMPTS.map(p => (
                    <button key={p} className="starter-btn" onClick={() => setInput(p)} style={{ background: "#111", border: "1px solid #222", borderRadius: "4px", color: "#555", padding: "0.5rem 0.875rem", cursor: "pointer", fontSize: "12px", fontFamily: "'Rajdhani', sans-serif", transition: "all 0.15s" }}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, idx) => {
              const isUser = msg.role === "user";
              const isBad = !isUser && (isNotInManual(msg.text) || isError(msg.text));
              return (
                <div key={idx} className="msg-bubble" style={{ display: "flex", flexDirection: isUser ? "row-reverse" : "row", gap: "10px", alignItems: "flex-start" }}>
                  <div style={{ width: "30px", height: "30px", borderRadius: "3px", background: isUser ? "#1E1608" : "#111", border: `1px solid ${isUser ? "#F59E0B" : "#222"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: "700", color: isUser ? "#F59E0B" : "#444", flexShrink: 0, letterSpacing: "0.04em" }}>
                    {isUser ? "YOU" : "AI"}
                  </div>
                  <div style={{ maxWidth: "76%", background: isUser ? "#150F06" : isBad ? "#150A0A" : "#0F0F0F", border: `1px solid ${isUser ? "#F59E0B33" : isBad ? "#3A1515" : "#1E1E1E"}`, borderRadius: "4px", padding: "0.875rem 1.1rem" }}>
                    {msg.imagePreview && (
                      <img src={msg.imagePreview} alt="Attached" style={{ maxWidth: "180px", maxHeight: "130px", objectFit: "cover", borderRadius: "3px", marginBottom: "0.625rem", display: "block", border: "1px solid #2A2A2A" }} />
                    )}
                    <div style={{ fontFamily: isUser ? "'Rajdhani', sans-serif" : "'JetBrains Mono', 'Courier New', monospace", fontSize: isUser ? "15px" : "12.5px", lineHeight: isUser ? "1.5" : "1.75", color: isUser ? "#D8CEB8" : isBad ? "#F87171" : "#B8B0A0", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {msg.text}
                    </div>
                  </div>
                </div>
              );
            })}

            {isLoading && (
              <div className="msg-bubble" style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <div style={{ width: "30px", height: "30px", borderRadius: "3px", background: "#111", border: "1px solid #222", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "#444", flexShrink: 0 }}>AI</div>
                <div style={{ background: "#0F0F0F", border: "1px solid #1E1E1E", borderRadius: "4px", padding: "0.875rem 1.1rem" }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", color: "#F59E0B" }}>
                    SCANNING MANUAL<span className="scanning-cursor">▋</span>
                  </span>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input area */}
          <div style={{ borderTop: "1px solid #1A1A1A", padding: "1rem", background: "#0D0D0D" }}>

            {pendingImage && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "0.75rem", padding: "0.5rem 0.75rem", background: "#141414", borderRadius: "4px", border: "1px solid #252525" }}>
                <img src={pendingImage.preview} alt="" style={{ width: "44px", height: "36px", objectFit: "cover", borderRadius: "3px", border: "1px solid #2A2A2A" }} />
                <div>
                  <div style={{ fontSize: "11px", color: "#F59E0B", letterSpacing: "0.08em" }}>IMAGE ATTACHED</div>
                  <div style={{ fontSize: "11px", color: "#444", marginTop: "1px" }}>Will be analyzed against manual</div>
                </div>
                <button onClick={() => setPendingImage(null)} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#444", cursor: "pointer", fontSize: "18px", lineHeight: 1, padding: "2px 6px" }}>×</button>
              </div>
            )}

            <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
              <button className="icon-btn" title="Attach image for visual diagnosis" onClick={() => imageInputRef.current?.click()} style={{ background: "#141414", border: "1px solid #252525", borderRadius: "4px", color: "#555", width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.15s", flexShrink: 0, fontSize: "16px" }}>
                📷
              </button>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); autoResize(e.target); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Describe your motorcycle issue... (Shift+Enter for new line)"
                style={{ flex: 1, background: "#141414", border: "1px solid #252525", borderRadius: "4px", color: "#D8CEB8", fontFamily: "'Rajdhani', sans-serif", fontSize: "15px", padding: "0.625rem 0.875rem", minHeight: "44px", maxHeight: "120px", transition: "border-color 0.15s, box-shadow 0.15s", lineHeight: "1.5", letterSpacing: "0.02em" }}
              />

              <button
                onClick={sendMessage}
                disabled={(!input.trim() && !pendingImage) || isLoading}
                style={{ background: (!input.trim() && !pendingImage) || isLoading ? "#1A1A1A" : "#F59E0B", border: "none", borderRadius: "4px", color: (!input.trim() && !pendingImage) || isLoading ? "#333" : "#0A0A0A", width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center", cursor: (!input.trim() && !pendingImage) || isLoading ? "not-allowed" : "pointer", transition: "all 0.2s", flexShrink: 0, fontSize: "18px", fontWeight: "700" }}
              >
                ↑
              </button>
            </div>

            <input ref={imageInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { loadImage(e.target.files[0]); e.target.value = ""; }} />

            <div style={{ marginTop: "0.625rem", fontSize: "11px", color: "#2A2A2A", textAlign: "center", letterSpacing: "0.06em" }}>
              ANSWERS GROUNDED EXCLUSIVELY IN: {manualName.toUpperCase()}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}