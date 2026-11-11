:root {
  /* ── пастельная палитра ─────────────────────────────────────────── */
  --bg:        #f7f6f3;   /* тёплый бумажный */
  --bg-2:      #fbfaf8;
  --bg-3:      #f1efec;
  --bg-4:      #e9e6e2;

  --ink:       #2b2b30;   /* не чёрный — графитовый */
  --ink-soft:  #6b6b73;
  --ink-faint: #9a9aa2;

  /* пастельные акценты */
  --lav:       #b8a4d4;   /* лаванда */
  --mint:      #a8cdbf;   /* мята */
  --peach:     #e8c4b0;   /* персик */
  --sky:       #a9c3dd;   /* пудровый голубой */
  --accent:    #8b9dc9;   /* сдержанный синий акцент */
  --accent-2:  #b8a4d4;
  --accent-soft: rgba(139, 157, 201, 0.10);

  --ok:        #8fbc9d;
  --warn:      #e0b894;
  --bad:       #d4a0a0;
  --bad-soft:  rgba(212, 160, 160, 0.12);

  /* ── поверхности и тени ─────────────────────────────────────────── */
  --surface:        rgba(255, 255, 255, 0.72);
  --surface-solid:  #ffffff;
  --surface-border: rgba(43, 43, 48, 0.06);

  /* многослойные тени низкой плотности — «премиум», не «колхоз» */
  --shadow-sm:
    0 1px 2px rgba(30, 30, 50, 0.04),
    0 4px 12px -4px rgba(30, 30, 50, 0.06);
  --shadow-md:
    0 1px 2px rgba(30, 30, 50, 0.04),
    0 8px 24px -8px rgba(30, 30, 50, 0.08),
    0 24px 56px -24px rgba(30, 30, 50, 0.10);
  --shadow-lift:
    0 2px 4px rgba(30, 30, 50, 0.05),
    0 12px 32px -12px rgba(30, 30, 50, 0.10),
    0 32px 80px -32px rgba(30, 30, 50, 0.12);
  --inner-hi: inset 0 1px 0 rgba(255, 255, 255, 0.9);

  /* ── fluid-движок: единый источник правды ───────────────────────── */
  /* шрифты — vw + vh, чтобы масштаб учитывал и высоту */
  --fs-xs:   clamp(12px, 0.82vw + 0.48vh, 14px);
  --fs-sm:   clamp(13px, 0.95vw + 0.55vh, 16px);
  --fs-md:   clamp(15px, 1.05vw + 0.65vh, 18px);
  --fs-lg:   clamp(18px, 1.35vw + 0.85vh, 24px);
  --fs-xl:   clamp(22px, 1.85vw + 1.05vh, 30px);
  --fs-hero: clamp(32px, 3.6vw + 1.6vh, 64px);

  /* отступы */
  --sp-1: clamp(6px,  0.5vw, 10px);
  --sp-2: clamp(10px, 0.9vw, 16px);
  --sp-3: clamp(16px, 1.5vw, 24px);
  --sp-4: clamp(24px, 2.4vw, 40px);
  --sp-5: clamp(32px, 3.5vw, 56px);

  /* радиусы */
  --r-card:  clamp(20px, 1.8vw, 28px);
  --r-zone:  clamp(16px, 1.5vw, 22px);
  --r-input: clamp(12px, 1vw, 16px);
  --r-chip:  980px;

  /* тап-таргет — минимум 44px по Apple HIG */
  --tap: clamp(44px, 5.5vh, 56px);

  /* ── easing ─────────────────────────────────────────────────────── */
  --ease:      cubic-bezier(0.22, 0.61, 0.36, 1);
  --ease-out:  cubic-bezier(0.16, 1, 0.3, 1);
}

/* ── reset ──────────────────────────────────────────────────────────── */
*,
*::before,
*::after { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  min-height: 100dvh;
  color: var(--ink);
  background: var(--bg);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display",
    "SF Pro Text", "Segoe UI", "Inter", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: var(--fs-md);
  line-height: 1.5;
  letter-spacing: -0.011em;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  overflow-x: hidden;
}

h1, h2, p { margin: 0; }

button {
  font: inherit;
  color: inherit;
  border: 0;
  background: none;
  cursor: pointer;
}

textarea { font: inherit; color: inherit; }

::selection {
  background: rgba(184, 164, 212, 0.28);
  color: var(--ink);
}

/* ── ФОН: три слоя глубины, fixed, за контентом ─────────────────────── */

/* слой 1: базовый градиент бумаги */
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -3;
  background:
    radial-gradient(120% 80% at 50% 0%, #fdfcfa 0%, transparent 60%),
    linear-gradient(180deg, #f7f6f3 0%, #f2f0ec 100%);
}

/* слой 2: два огромных размытых пастельных пятна */
body::after {
  content: "";
  position: fixed;
  inset: -10%;
  z-index: -2;
  pointer-events: none;
  background:
    radial-gradient(40vw 40vw at 12% 18%, rgba(184, 164, 212, 0.28) 0%, transparent 65%),
    radial-gradient(44vw 44vw at 88% 82%, rgba(168, 205, 191, 0.26) 0%, transparent 65%),
    radial-gradient(36vw 36vw at 78% 12%, rgba(232, 196, 176, 0.20) 0%, transparent 65%);
  filter: blur(60px);
  transform: translateZ(0);
}

/* слой 3: тонкая шумовая текстура — «плёночная» премиальность */
.blobs {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  opacity: 0.35;
  mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.18'/%3E%3C/svg%3E");
}

/* ── каркас ─────────────────────────────────────────────────────────── */
.shell {
  max-width: 100%;
  width: 100%;
  min-height: 100dvh;
  margin: 0 auto;
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

/* brand */
.brand {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: var(--sp-1);
}

.brand__mark {
  width: var(--tap);
  height: var(--tap);
  flex: none;
  border-radius: calc(var(--tap) * 0.30);
  background: linear-gradient(145deg, var(--lav) 0%, var(--accent) 100%);
  box-shadow:
    var(--shadow-sm),
    var(--inner-hi);
  display: grid;
  place-items: center;
  color: #ffffff;
}

.brand__mark svg { width: 56%; height: 56%; }

.brand__name {
  font-size: var(--fs-xl);
  font-weight: 600;
  letter-spacing: -0.028em;
  color: var(--ink);
}

.brand__name em {
  font-style: normal;
  font-weight: 400;
  color: var(--ink-soft);
}

/* hero */
.hero { margin-bottom: var(--sp-2); }

.hero__title {
  font-size: var(--fs-hero);
  font-weight: 600;
  line-height: 1.06;
  letter-spacing: -0.038em;
  color: var(--ink);
}

.hero__title em {
  font-style: normal;
  background: linear-gradient(90deg, var(--accent) 0%, var(--lav) 60%, var(--peach) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.hero__subtitle {
  margin-top: var(--sp-2);
  max-width: 42em;
  font-size: var(--fs-md);
  color: var(--ink-soft);
  line-height: 1.5;
  letter-spacing: -0.014em;
}

/* ── карточка ───────────────────────────────────────────────────────── */
.glass {
  flex: 1 1 auto;
  background: var(--surface);
  border: 1px solid var(--surface-border);
  border-radius: var(--r-card);
  box-shadow:
    var(--shadow-md),
    var(--inner-hi);
  -webkit-backdrop-filter: blur(20px) saturate(120%);
  backdrop-filter: blur(20px) saturate(120%);
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  animation: rise 0.6s var(--ease-out) both;
}

@keyframes rise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: none; }
}

.glass + .glass {
  animation-delay: 0.06s;
}

/* ── зона загрузки ──────────────────────────────────────────────────── */
.zone {
  position: relative;
  width: 100%;
  flex: 1 1 auto;
  min-height: clamp(180px, 30dvh, 400px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-4);
  border-radius: var(--r-zone);
  border: 1.5px dashed rgba(139, 157, 201, 0.35);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.15) 100%);
  overflow: hidden;
  transition:
    border-color 0.35s var(--ease),
    background 0.35s var(--ease),
    transform 0.25s var(--ease);
}

.zone:hover,
.zone--over {
  border-color: var(--accent);
  border-style: solid;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0.35) 100%);
}

.zone__icon {
  width: clamp(56px, 6vw + 3vh, 88px);
  height: clamp(56px, 6vw + 3vh, 88px);
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--accent);
  background: rgba(139, 157, 201, 0.10);
  border: 1px solid rgba(139, 157, 201, 0.22);
  box-shadow:
    var(--shadow-sm),
    var(--inner-hi);
  transition:
    transform 0.35s var(--ease),
    background 0.35s var(--ease);
}

.zone:hover .zone__icon {
  transform: scale(1.04);
  background: rgba(139, 157, 201, 0.16);
}

.zone__icon svg { width: 42%; height: 42%; }

.zone__title {
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: -0.022em;
  color: var(--ink);
}

.zone__hint {
  font-size: var(--fs-sm);
  color: var(--ink-faint);
  letter-spacing: -0.012em;
}

.zone kbd {
  font: inherit;
  font-size: var(--fs-xs);
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 8px;
  color: var(--accent);
  background: rgba(139, 157, 201, 0.10);
  border: 1px solid rgba(139, 157, 201, 0.22);
}

/* preview */
.preview {
  position: relative;
  margin-top: var(--sp-2);
  border-radius: var(--r-zone);
  overflow: hidden;
  border: 1px solid var(--surface-border);
  background: var(--bg-3);
  box-shadow: var(--shadow-sm);
}

.preview img {
  display: block;
  width: 100%;
  max-height: 45dvh;
  object-fit: contain;
}

.preview__scrim {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(251, 250, 248, 0.65);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}

/* ── чипы языков ────────────────────────────────────────────────────── */
.langs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-1) var(--sp-2);
  margin-top: var(--sp-3);
}

.langs__label {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--ink-faint);
  margin-right: 4px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.chip {
  padding: var(--sp-1) var(--sp-3);
  border-radius: var(--r-chip);
  font-weight: 500;
  font-size: var(--fs-sm);
  letter-spacing: -0.014em;
  color: var(--ink-soft);
  background: rgba(43, 43, 48, 0.035);
  border: 1px solid transparent;
  transition:
    background 0.25s var(--ease),
    color 0.25s var(--ease),
    border-color 0.25s var(--ease),
    transform 0.15s var(--ease);
}

.chip:hover {
  color: var(--ink);
  background: rgba(43, 43, 48, 0.06);
}

.chip:active { transform: scale(0.97); }

.chip--on {
  color: #ffffff;
  background: linear-gradient(145deg, var(--accent) 0%, var(--lav) 100%);
  border-color: transparent;
  box-shadow:
    0 1px 2px rgba(139, 157, 201, 0.30),
    0 6px 16px -6px rgba(139, 157, 201, 0.40),
    var(--inner-hi);
}

.chip__dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-left: 7px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.75;
  vertical-align: 1px;
}

.chip--on .chip__dot { opacity: 1; }

/* ── статус и прогресс ──────────────────────────────────────────────── */
.status {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-input);
  font-weight: 500;
  font-size: var(--fs-sm);
  letter-spacing: -0.012em;
  color: var(--ink-soft);
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid var(--surface-border);
  box-shadow: var(--inner-hi);
}

.status__spinner {
  width: clamp(15px, 1.3vw, 18px);
  height: clamp(15px, 1.3vw, 18px);
  flex: none;
  border-radius: 50%;
  border: 2px solid rgba(139, 157, 201, 0.18);
  border-top-color: var(--accent);
  animation: spin 0.9s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.progress {
  margin-top: var(--sp-2);
  height: clamp(4px, 0.5vw, 6px);
  border-radius: 999px;
  background: rgba(43, 43, 48, 0.06);
  overflow: hidden;
}

.progress__bar {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent) 0%, var(--lav) 50%, var(--peach) 100%);
  transition: width 0.5s var(--ease-out);
}

/* ── кнопки ─────────────────────────────────────────────────────────── */
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: var(--tap);
  padding: var(--sp-2) var(--sp-4);
  border-radius: var(--r-chip);
  font-weight: 600;
  font-size: var(--fs-md);
  letter-spacing: -0.016em;
  transition:
    background 0.25s var(--ease),
    color 0.25s var(--ease),
    border-color 0.25s var(--ease),
    transform 0.15s var(--ease),
    opacity 0.2s var(--ease);
  -webkit-tap-highlight-color: transparent;
}

.btn:active { transform: scale(0.97); }

.btn svg {
  width: clamp(16px, 1.3vw, 19px);
  height: clamp(16px, 1.3vw, 19px);
}

.btn--primary {
  color: #ffffff;
  background: linear-gradient(145deg, var(--accent) 0%, var(--lav) 100%);
  box-shadow:
    0 1px 2px rgba(139, 157, 201, 0.30),
    0 8px 20px -8px rgba(139, 157, 201, 0.45),
    var(--inner-hi);
}

.btn--primary:hover {
  background: linear-gradient(145deg, #7f92c2 0%, #ad98cb 100%);
}

.btn--primary:active {
  background: linear-gradient(145deg, #7587b8 0%, #a18dc2 100%);
}

.btn--ghost {
  color: var(--accent);
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(139, 157, 201, 0.30);
  box-shadow: var(--inner-hi);
}

.btn--ghost:hover {
  background: rgba(255, 255, 255, 0.8);
  border-color: rgba(139, 157, 201, 0.55);
}

.btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.btn--done {
  color: #ffffff;
  background: linear-gradient(145deg, var(--ok) 0%, #a8cdbf 100%);
  border-color: transparent;
  box-shadow:
    0 1px 2px rgba(143, 188, 157, 0.30),
    0 8px 20px -8px rgba(143, 188, 157, 0.45),
    var(--inner-hi);
}

/* ── результат ──────────────────────────────────────────────────────── */
.result {
  margin-top: var(--sp-3);
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
}

.result__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-1) var(--sp-2);
  margin-bottom: var(--sp-2);
}

.result__title {
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: -0.022em;
  color: var(--ink);
}

.pill {
  padding: 4px 10px;
  border-radius: 8px;
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #ffffff;
  background: var(--accent);
}

.pill--mid {
  color: #ffffff;
  background: var(--warn);
}

.pill__meta {
  margin-left: auto;
  font-size: var(--fs-xs);
  font-weight: 400;
  color: var(--ink-faint);
  letter-spacing: -0.008em;
}

.result__text {
  width: 100%;
  flex: 1 1 auto;
  min-height: clamp(140px, 26dvh, 400px);
  max-height: 60dvh;
  resize: vertical;
  padding: var(--sp-3);
  border-radius: var(--r-input);
  border: 1px solid var(--surface-border);
  background: rgba(255, 255, 255, 0.55);
  line-height: 1.5;
  font-size: var(--fs-md);
  letter-spacing: -0.012em;
  color: var(--ink);
  outline: none;
  box-shadow: var(--inner-hi);
  transition:
    border-color 0.25s var(--ease),
    background 0.25s var(--ease),
    box-shadow 0.25s var(--ease);
}

.result__text:focus {
  border-color: var(--accent);
  background: rgba(255, 255, 255, 0.85);
  box-shadow:
    0 0 0 3px rgba(139, 157, 201, 0.15),
    var(--inner-hi);
}

/* ── ошибка ─────────────────────────────────────────────────────────── */
.error {
  margin-top: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-input);
  color: #a86b6b;
  background: var(--bad-soft);
  border: 1px solid rgba(212, 160, 160, 0.25);
  font-weight: 500;
  font-size: var(--fs-sm);
  letter-spacing: -0.01em;
}

/* ── подвал ─────────────────────────────────────────────────────────── */
.footer {
  margin-top: auto;
  padding-top: var(--sp-3);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1) var(--sp-3);
  text-align: center;
  font-size: var(--fs-xs);
  font-weight: 400;
  color: var(--ink-faint);
  letter-spacing: -0.008em;
}

.footer__lock {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
}

.footer__lock svg {
  width: clamp(12px, 1vw, 15px);
  height: clamp(12px, 1vw, 15px);
}

/* ── доступность ────────────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* ── адаптив ────────────────────────────────────────────────────────── */

/* телефон портрет */
@media (max-width: 720px) {
  .shell { padding: var(--sp-3); gap: var(--sp-2); }
  .glass { padding: var(--sp-3); }
  .btn { width: 100%; }
  .pill__meta { margin-left: 0; }
}

/* низкий ландшафт — приоритет высоте */
@media (max-height: 560px) and (orientation: landscape) {
  .hero { margin-bottom: var(--sp-1); }
  .zone {
    min-height: 120px;
    padding: var(--sp-2) var(--sp-3);
  }
  .zone__icon {
    width: 44px;
    height: 44px;
  }
  .glass { padding: var(--sp-2) var(--sp-3); }
}

/* большие экраны — больше воздуха */
@media (min-width: 1200px) {
  .shell {
    padding: var(--sp-5) clamp(48px, 7vw, 120px);
  }
  .glass {
    padding: var(--sp-5) clamp(40px, 4vw, 64px);
  }
}

/* очень широкие — ограничиваем ширину контента для читаемости */
@media (min-width: 1800px) {
  .shell { max-width: 1600px; }
}
