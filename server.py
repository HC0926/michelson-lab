"""
Michelson Interferometer Web Assistant — FastAPI Backend
=========================================================
Serves the embeddable widget and proxies AI requests to DashScope Qwen API.
"""

import base64
import json
import os
from pathlib import Path

import httpx
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

BASE_DIR = Path(__file__).parent
API_KEY = os.getenv("DASHSCOPE_API_KEY", "sk-d2597a91690e4d44ba211a2158457b51")
BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
CHAT_MODEL = "qwen3.6-plus"
VISION_MODEL = "qwen3-vl-plus"

SYSTEM_PROMPT = """You are a Michelson Interferometer Lab Assistant, an expert AI that helps students and researchers with Michelson interferometer experiments.

Your knowledge includes:

## Principles
- Michelson interferometer is an amplitude-splitting interference device
- Light is split by a beam splitter, reflected by two mirrors, and recombined to produce interference
- A compensator plate equalizes the glass path for both beams

## Key Formulas
- Optical Path Difference: Δ = 2d·cosθ (d = equivalent air film thickness, θ = angle from normal)
- Bright fringe condition: 2d·cosθ = kλ (k = 0, 1, 2, ...)
- Dark fringe condition: 2d·cosθ = (2k+1)·λ/2
- Mirror displacement & fringe count: Δd = N·λ/2 (each fringe = λ/2 mirror travel)
- For He-Ne laser (λ=632.8nm): 50 fringes ≈ 15.82 μm mirror displacement

## Types of Interference
- Equal Inclination (d fixed): concentric circular fringes, center has highest order
- Equal Thickness (d varies): straight fringes from wedge-shaped air film

## Common Issues & Diagnostics
| Symptom | Cause | Solution |
|---------|-------|----------|
| No fringes | Beams not overlapping | Align with pinhole first |
| Non-circular fringes | M1 not perpendicular | Adjust M1 tilt screws |
| Fringes too dense | d too large | Reduce mirror distance |
| Low contrast | Near coherence limit | Make d ≈ 0; check laser |
| Fringe jitter | Vibration | Check isolation table |
| Pattern off-center | Optical axis misaligned | Re-center beam expander |

## Experimental Procedure
1. Level the laser beam
2. Align both reflected beams to overlap on screen
3. Fine-tune M1 tilt until spots merge
4. Insert beam expander to see fringes
5. Adjust for circular, centered fringes
6. For wavelength measurement: turn micrometer slowly in ONE direction while counting fringes
7. Record initial and final micrometer readings
8. Calculate: λ = 2|d1-d0|/N
9. Repeat multiple times, compute uncertainty

## Safety
- Never look directly at laser beam or its reflections
- Handle optical components by edges only
- Turn micrometer in one direction to avoid backlash

Answer questions in Chinese if the user writes in Chinese, otherwise in English. Be concise and helpful. For photo analysis, describe the fringe pattern quality and give specific corrections."""

app = FastAPI(title="Michelson Lab Assistant")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Static files & templates ────────────────────────────────────
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.get("/widget.js")
async def widget_js():
    """Serve the embeddable widget script."""
    return HTMLResponse(
        content=(BASE_DIR / "static" / "widget.js").read_text(encoding="utf-8"),
        media_type="application/javascript",
    )


@app.get("/", response_class=HTMLResponse)
async def index():
    """Standalone demo page."""
    return (BASE_DIR / "templates" / "index.html").read_text(encoding="utf-8")


# ── API Endpoints ────────────────────────────────────────────────

@app.post("/api/chat")
async def chat(request: dict):
    """Chat with the Michelson assistant (streaming)."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages += request.get("messages", [])

    async def stream():
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                f"{BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": CHAT_MODEL,
                    "messages": messages,
                    "stream": True,
                    "temperature": 0.7,
                },
            ) as resp:
                buffer = ""
                async for chunk in resp.aiter_bytes():
                    buffer += chunk.decode("utf-8", errors="replace")
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if line.startswith("data: "):
                            data = line[6:]
                            if data == "[DONE]":
                                yield "data: [DONE]\n\n"
                                return
                            try:
                                parsed = json.loads(data)
                                delta = parsed.get("choices", [{}])[0].get("delta", {})
                                content = delta.get("content", "")
                                if content:
                                    yield f"data: {json.dumps({'content': content})}\n\n"
                            except Exception:
                                pass

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.post("/api/analyze-image")
async def analyze_image(file: UploadFile = File(...)):
    """Analyze an interference pattern photo."""
    image_bytes = await file.read()
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Analyze this Michelson interferometer interference pattern photo. "
                        "Report in Chinese:\n"
                        "1. 条纹形状（圆形/椭圆/不规则）和质量\n"
                        "2. 对比度评估\n"
                        "3. 对准状态诊断\n"
                        "4. 具体改善建议\n"
                        "5. 是否适合进行波长测量实验"
                    ),
                },
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"},
                },
            ],
        },
    ]

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": VISION_MODEL,
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 2000,
            },
        )
        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        return {"analysis": content}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
