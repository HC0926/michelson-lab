"""
Analyze all interference videos to find optimal fringe detection parameters.
"""
import cv2
import numpy as np
import json
from pathlib import Path

VIDEOS = sorted(Path(__file__).parent.glob("VID_*.mp4"))
ROI_SIZE = 100  # match widget.js
MAX_FRAMES = 2000  # analyze up to 2000 frames per video

def extract_signal(video_path):
    """Extract mean intensity of central ROI for each frame."""
    cap = cv2.VideoCapture(str(video_path))
    intensities = []
    frame_idx = 0
    while cap.isOpened() and frame_idx < MAX_FRAMES:
        ret, frame = cap.read()
        if not ret:
            break
        h, w = frame.shape[:2]
        cx, cy = w // 2, h // 2
        half = ROI_SIZE // 2
        roi = frame[cy - half:cy + half, cx - half:cx + half]
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        intensities.append(float(np.mean(gray)))
        frame_idx += 1
        if frame_idx % 500 == 0:
            print(f"  processed {frame_idx} frames...")
    cap.release()
    return np.array(intensities)

def test_params(signal, noise_gate, smooth_window, ema_alpha):
    """Count fringes with given parameters. Returns count, false_positives estimate."""
    smoothed = np.convolve(signal, np.ones(smooth_window) / smooth_window, mode='same')
    baseline = smoothed[0]
    ema = np.zeros_like(smoothed)
    for i in range(len(smoothed)):
        baseline += ema_alpha * (smoothed[i] - baseline)
        ema[i] = baseline

    diff = smoothed - ema
    half_cycle = False
    last_state = None
    count = 0
    crossings = []

    for i in range(10, len(diff)):
        if abs(diff[i]) > noise_gate:
            state = "above" if diff[i] > 0 else "below"
            if last_state and state != last_state:
                if half_cycle:
                    count += 1
                    crossings.append(i)
                    half_cycle = False
                else:
                    half_cycle = True
            last_state = state

    return count, crossings, smoothed, ema, diff

def find_optimal_params(signal, name):
    """Grid search for optimal parameters."""
    print(f"\n{'='*60}")
    print(f"Analyzing: {name}")
    print(f"Frames: {len(signal)}, Range: [{signal.min():.1f}, {signal.max():.1f}]")

    noise_gates = [0.3, 0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0]
    smooth_windows = [1, 2, 3, 5, 7, 10, 15]
    ema_alphas = [0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2]

    best_score = -1
    best = None
    results = []

    for ng in noise_gates:
        for sw in smooth_windows:
            for alpha in ema_alphas:
                count, crossings, smoothed, ema, diff = test_params(signal, ng, sw, alpha)

                if count == 0 or len(crossings) < 3:
                    continue

                # Score: prefer stable intervals between crossings (real fringes have regular spacing)
                intervals = np.diff(crossings)
                cv = np.std(intervals) / (np.mean(intervals) + 1e-9)  # coefficient of variation

                # Amplitude ratio: signal amplitude vs noise gate
                amp_ratio = np.std(diff) / (ng + 1e-9)

                # We want: low CV (regular spacing), high amplitude ratio, reasonable count
                stability_score = 1.0 / (cv + 1e-9)
                count_score = min(count, 200)  # cap to not overweight high counts
                score = stability_score * 0.5 + amp_ratio * 0.2 + count_score * 0.3

                results.append({
                    "noise_gate": ng, "smooth_window": sw, "ema_alpha": alpha,
                    "count": count, "cv": round(cv, 3), "amp_ratio": round(amp_ratio, 1),
                    "score": round(score, 1)
                })

                if score > best_score:
                    best_score = score
                    best = {"noise_gate": ng, "smooth_window": sw, "ema_alpha": alpha,
                            "count": count, "cv": round(cv, 3), "amp_ratio": round(amp_ratio, 1)}

    if results:
        # Top 5 sorted by score
        top = sorted(results, key=lambda r: r["score"], reverse=True)[:5]
        print(f"\nTop 5 parameter sets:")
        for i, r in enumerate(top):
            print(f"  #{i+1}: noise_gate={r['noise_gate']}, smooth_window={r['smooth_window']}, "
                  f"ema_alpha={r['ema_alpha']} → count={r['count']}, CV={r['cv']}, "
                  f"amp_ratio={r['amp_ratio']}, score={r['score']}")
        print(f"\nBest: {best}")
    else:
        print("No valid detection found")

    return best, results

def main():
    results = {}
    for video_path in VIDEOS:
        name = video_path.name
        print(f"\nLoading: {name} ({video_path.stat().st_size // 1024 // 1024} MB)")
        signal = extract_signal(video_path)
        best, _ = find_optimal_params(signal, name)
        if best:
            results[name] = best

    print(f"\n{'='*60}")
    print("SUMMARY: Best parameters per video:")
    for name, r in results.items():
        print(f"  {name[:30]}: noise_gate={r['noise_gate']}, smooth={r['smooth_window']}, "
              f"ema={r['ema_alpha']}, count={r['count']}")

    # Consensus: median of best params across videos
    if len(results) >= 2:
        ng = sorted(r["noise_gate"] for r in results.values())[len(results) // 2]
        sw = sorted(r["smooth_window"] for r in results.values())[len(results) // 2]
        ea = sorted(r["ema_alpha"] for r in results.values())[len(results) // 2]
        print(f"\n*** RECOMMENDED PARAMS: noise_gate={ng}, smooth_window={sw}, ema_alpha={ea} ***")

if __name__ == "__main__":
    main()
