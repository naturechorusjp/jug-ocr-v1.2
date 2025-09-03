import React, { useMemo, useState, useRef, useEffect } from "react";
import Tesseract from "tesseract.js";

/* -----------------------
   機種プリセット
----------------------- */
const PRESETS = {
  "マイジャグラーV": {
    replay: 7.298, cherry: 36, bell: 1024, piero: 1024,
    bigAvg: 239.25, regAvg: 95.25, cherryPay: 2, bellPay: 14, pieroPay: 10,
  },
  "SアイムジャグラーEX": {
    replay: 7.298, cherry: 35.62, bell: 1092.27, piero: 1092.27,
    bigAvg: 251.25, regAvg: 95.25, cherryPay: 2, bellPay: 14, pieroPay: 10,
  },
  "ハッピージャグラーVⅢ": {
    replay: 7.298, cherry: 56.55, bell: 655.36, piero: 655.36,
    bigAvg: 239.7, regAvg: 95.7, cherryPay: 4, bellPay: 14, pieroPay: 10,
  },
  "ファンキージャグラー2": {
    replay: 7.298, cherry: 35.62, bell: 1092.27, piero: 1092.27,
    bigAvg: 239.25, regAvg: 95.25, cherryPay: 2, bellPay: 14, pieroPay: 10,
  },
  "ゴーゴージャグラー3": {
    replay: 7.298, cherry: 32.2, bell: 1092.27, piero: 1092.27,
    bigAvg: 239.25, regAvg: 95.25, cherryPay: 2, bellPay: 14, pieroPay: 10,
  },
  "ミスタージャグラー": {
    replay: 7.298, cherry: 37.24, bell: 420, piero: 655,
    bigAvg: 239.25, regAvg: 95.25, cherryPay: 4, bellPay: 14, pieroPay: 10,
  },
} as const;

/* -----------------------
   永続化（入力と履歴）
----------------------- */
const STORAGE_KEY = "jug-ocr-v1.2:state";
const HISTORY_KEY = "jug-ocr-v1.2:history";
const HISTORY_MAX = 10;

type SavedState = {
  modelKey?: keyof typeof PRESETS;
  G?: string | number;
  big?: string | number;
  reg?: string | number;
  diff?: string | number;
};

type HistoryRow = {
  modelKey: string;
  probRandom: string; // 適当打ち
  probC90: string;    // チェリー狙い(90%)
  probC100: string;   // チェリー狙い(100%)
  probFull: string;   // 完全攻略
};

function loadSaved(): SavedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveState(partial: Partial<SavedState>) {
  try {
    const cur = loadSaved();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...cur, ...partial }));
  } catch {}
}

function loadHistory(): HistoryRow[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryRow[]) : [];
  } catch {
    return [];
  }
}
function saveHistory(rows: HistoryRow[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(rows.slice(0, HISTORY_MAX)));
  } catch {}
}

/* -----------------------
   打法ごとの取得率
----------------------- */
const STRATEGIES = [
  { key: "random",   label: "適当打ち",         capture: { cherry: 0.667, bell: 0.1,  piero: 0.05 } },
  { key: "cherry90", label: "チェリー狙い(90%)", capture: { cherry: 0.90,  bell: 0.05, piero: 0.01 } },
  { key: "cherry100",label: "チェリー狙い(100%)",capture: { cherry: 1.00,  bell: 0.00, piero: 0.00 } },
  { key: "full",     label: "完全攻略",         capture: { cherry: 1.00,  bell: 1.00, piero: 1.00 } },
] as const;

/* -----------------------
   共通ユーティリティ
----------------------- */
function numberOr(val: any, fallback: number) {
  const n = typeof val === "number" ? val : parseFloat(String(val ?? "").replace(/,/g, ""));
  return isFinite(n) ? n : fallback;
}
function formatInt(n: number) {
  if (!isFinite(n)) return "-";
  return Math.round(n).toLocaleString();
}
function formatProb(x: number) {
  if (!isFinite(x) || x <= 0) return "-";
  return `1/${x.toFixed(2)}`;
}

/* -----------------------
   入力UIの共通寸法（高さ揃え）
----------------------- */
const CTRL_H = 40;
const PAD_X = 12;

const baseButton: React.CSSProperties = {
  height: CTRL_H,
  padding: `0 ${PAD_X}px`,
  border: "1px solid #333",
  borderRadius: 8,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
  boxSizing: "border-box",
};

const baseInput: React.CSSProperties = {
  height: CTRL_H,
  padding: `0 ${PAD_X}px`,
  border: "1px solid #333",
  borderRadius: 8,
  textAlign: "right",
  lineHeight: 1,
  boxSizing: "border-box",
};

/* =========================================================
   App 本体
========================================================= */
export default function App() {
  // プリセット
  const [modelKey, setModelKey] = useState<keyof typeof PRESETS>(() => {
    const s = loadSaved();
    return (s.modelKey as keyof typeof PRESETS) ?? "マイジャグラーV";
  });
  const p = PRESETS[modelKey];

  // 入力（初期はブランク）
  const [G, setG]     = useState<string | number>(() => loadSaved().G   ?? "");
  const [big, setBig] = useState<string | number>(() => loadSaved().big ?? "");
  const [reg, setReg] = useState<string | number>(() => loadSaved().reg ?? "");
  const [diff, setDiff] = useState<string | number>(() => loadSaved().diff ?? "");

  // 前提（編集可）
  const [replay, setReplay] = useState<number>(p.replay);
  const [cherry, setCherry] = useState<number>(p.cherry);
  const [bell, setBell] = useState<number>(p.bell);
  const [piero, setPiero] = useState<number>(p.piero);
  const [bigAvg, setBigAvg] = useState<number>(p.bigAvg);
  const [regAvg, setRegAvg] = useState<number>(p.regAvg);
  const [cherryPay, setCherryPay] = useState<number>(p.cherryPay);
  const [bellPay, setBellPay] = useState<number>(p.bellPay);
  const [pieroPay, setPieroPay] = useState<number>(p.pieroPay);

  // OCR
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrLog, setOcrLog] = useState("");

  // 履歴
  const [history, setHistory] = useState<HistoryRow[]>(() => loadHistory());

  // 入力・プリセットの保存
  useEffect(() => {
    saveState({ modelKey, G, big, reg, diff });
  }, [modelKey, G, big, reg, diff]);

  // 参照
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // プリセット切替
  function loadPreset(key: keyof typeof PRESETS) {
    setModelKey(key);
    const np = PRESETS[key];
    setReplay(np.replay);
    setCherry(np.cherry);
    setBell(np.bell);
    setPiero(np.piero);
    setBigAvg(np.bigAvg);
    setRegAvg(np.regAvg);
    setCherryPay(np.cherryPay);
    setBellPay(np.bellPay);
    setPieroPay(np.pieroPay);
    // 入力はクリア
    setG("");
    setBig("");
    setReg("");
    setDiff("");
  }

  // リセット（入力だけクリア）
  function handleReset() {
    setG("");
    setBig("");
    setReg("");
    setDiff("");
  }

  // 計算コア
  function calcResultByCapture(capture: { cherry: number; bell: number; piero: number }) {
    const g = numberOr(G, 0);
    const B = numberOr(big, 0);
    const R = numberOr(reg, 0);
    const D = numberOr(diff, 0);

    const coinIn = 3 * g - 3 * (g / replay);
    const outBigReg = B * bigAvg + R * regAvg;
    const outOthers =
      (g / cherry) * cherryPay * capture.cherry +
      (g / bell) * bellPay   * capture.bell   +
      (g / piero) * pieroPay * capture.piero;
    const outKnown = outBigReg + outOthers;

    const grapesCountRaw = (D + coinIn - outKnown) / 8;
    const grapesCount = Math.max(0, grapesCountRaw);
    const grapeProb = grapesCount > 0 ? g / grapesCount : Infinity;

    return { grapesCount, grapeProb };
  }

  const resultsByStrategy = useMemo(() => {
    return STRATEGIES.map(s => ({
      key: s.key,
      label: s.label,
      res: calcResultByCapture(s.capture),
    }));
  }, [G, big, reg, diff, replay, cherry, bell, piero, bigAvg, regAvg, cherryPay, bellPay, pieroPay]);

  // 履歴に追加
  function handleAddHistory() {
    const lookup = Object.fromEntries(
      resultsByStrategy.map(r => [r.key, r.res.grapeProb] as const)
    );
    const row: HistoryRow = {
      modelKey: modelKey as string,
      probRandom: formatProb(lookup["random"] ?? Infinity),
      probC90:    formatProb(lookup["cherry90"] ?? Infinity),
      probC100:   formatProb(lookup["cherry100"] ?? Infinity),
      probFull:   formatProb(lookup["full"] ?? Infinity),
    };
    const next = [row, ...history].slice(0, HISTORY_MAX);
    setHistory(next);
    saveHistory(next);
  }

  // 画像 → OCR → 自動入力
  async function handleImageFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setOcrBusy(true); setOcrLog("");
    try {
      const file = files[0];
      setOcrLog(s => s + `読み取り開始: ${file.name}\n`);
      const { data } = await Tesseract.recognize(file, "jpn+eng", {
        logger: m => { if (m.status) setOcrLog(s => s + `${m.status} ${Math.round((m.progress ?? 0)*100)}%\n`); }
      });
      const text = (data.text || "").trim();
      setOcrLog(s => s + "\n--- 抽出テキスト ---\n" + text + "\n-------------------\n");

      const parsed = parseFromText(text);
      if (parsed) {
        if (parsed.modelKey && PRESETS[parsed.modelKey as keyof typeof PRESETS]) {
          loadPreset(parsed.modelKey as keyof typeof PRESETS);
        }
        if (parsed.G   != null) setG(parsed.G);
        if (parsed.big != null) setBig(parsed.big);
        if (parsed.reg != null) setReg(parsed.reg);
        if (parsed.diff!= null) setDiff(parsed.diff);
        setOcrLog(s => s + "\n✅ 数値を反映しました。\n");
      } else {
        setOcrLog(s => s + "\n⚠️ 必要項目を特定できませんでした。数値を大きく写したスクショでお試しください。\n");
      }
    } catch (e: any) {
      setOcrLog(s => s + `\n❌ OCRエラー: ${e?.message || e}\n`);
    } finally {
      setOcrBusy(false);
    }
  }
  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    handleImageFiles(e.dataTransfer.files);
  }

  return (
    <div
      className="min-h-screen w-full bg-neutral-50 text-neutral-900 p-4 md:p-8"
      onDragOver={(e)=>e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="max-w-3xl mx-auto space-y-8">
        {/* タイトル */}
        <header className="flex items-center justify-between">
          <h1 style={{ fontSize: "20px", lineHeight: 1.2, margin: 0, fontWeight: 700 }}>
            ジャグラーぶどう逆算
          </h1>
          <div className="text-6px opacity-70">画像OCR対応※β版</div>
        </header>

        {/* セレクト + リセット + 履歴に追加（横並び） */}
        <section className="bg-white rounded-2xl shadow p-4 md:p-6">
          <div className="flex items-center gap-3 flex-nowrap whitespace-nowrap overflow-x-auto">
            <select
              aria-label="機種プリセット"
              className="h-10 px-3 rounded-xl border shrink-0"
              value={modelKey as string}
              onChange={(e) => loadPreset(e.target.value as keyof typeof PRESETS)}
            >
              {Object.keys(PRESETS).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>

            <button
              type="button"
              className="h-10 px-4 rounded-lg border shrink-0 hover:bg-neutral-50"
              onClick={handleReset}
            >
              リセット
            </button>

            <button
              type="button"
              className="h-10 px-4 rounded-lg border shrink-0 hover:bg-neutral-50"
              onClick={handleAddHistory}
            >
              履歴に追加
            </button>
          </div>
        </section>

        {/* 出力：打法4枚を横一列（常に4列） */}
        <section className="bg-white rounded-2xl shadow p-4 md:p-6 space-y-3">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 8,
              overflowX: "hidden",
              width: "100%",
            }}
          >
            {resultsByStrategy.map(({ key, label, res }) => (
              <div
                key={key}
                style={{
                  border: "1px solid #e5e5e5",
                  borderRadius: 10,
                  padding: 8,
                  textAlign: "center",
                  minWidth: 0,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 12 }}>{label}</div>
                <div style={{ fontSize: 11, opacity: 0.7, lineHeight: 1 }}>確率</div>
                <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.1, marginBottom: 4 }}>
                  {formatProb(res.grapeProb)}
                </div>
                <div style={{ fontSize: 11, opacity: 0.7, lineHeight: 1 }}>回数</div>
                <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.1 }}>
                  {formatInt(res.grapesCount)}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 手入力 */}
        <section className="bg-white rounded-2xl shadow p-4 md:p-6 space-y-4">
          {/* 総回転数（1行） */}
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: "1 1 auto" }}>
              <NumberField
                label="総回転数 G"
                value={G}
                setValue={setG}
                step={100}
                min={0}
                compact
                inputWidthCh={24}            {/* ← 幅を拡大 */}
                // 左に−1000、右に＋1000
                extraLeft={[{ label: "−1000", delta: -1000 }]}
                extraRight={[{ label: "+1000", delta: 1000 }]}
              />
            </div>
          </div>

          {/* BIG/REG 横並び */}
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <BRField label="BIG回数" value={big} setValue={setBig} />
            </div>
            <div style={{ flex: 1 }}>
              <BRField label="REG回数" value={reg} setValue={setReg} />
            </div>
          </div>

          {/* 差枚 */}
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: "1 1 auto" }}>
              <DiffField label="差枚（±）" value={diff} setValue={setDiff} />
            </div>
          </div>
        </section>

        {/* 履歴（表） */}
        <section className="bg-white rounded-2xl shadow p-4 md:p-6 space-y-3">
          <h2 className="text-base font-semibold">履歴</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-neutral-50 text-sm">
                  <th className="text-left  p-2">機種名</th>
                  <th className="text-right p-2">適当打</th>
                  <th className="text-right p-2">C90%</th>
                  <th className="text-right p-2">C100%</th>
                  <th className="text-right p-2">完全攻略</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="p-2">{h.modelKey}</td>
                    <td className="text-right p-2 font-mono whitespace-nowrap tabular-nums">{h.probRandom}</td>
                    <td className="text-right p-2 font-mono whitespace-nowrap tabular-nums">{h.probC90}</td>
                    <td className="text-right p-2 font-mono whitespace-nowrap tabular-nums">{h.probC100}</td>
                    <td className="text-right p-2 font-mono whitespace-nowrap tabular-nums">{h.probFull}</td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td className="p-3 text-sm text-neutral-500" colSpan={5}>
                      まだ履歴がありません。「履歴に追加」を押すとここに溜まります（最大{HISTORY_MAX}件）。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* OCR */}
        <section className="bg-white rounded-2xl shadow p-4 md:p-6 space-y-3">
          <p className="text-sm text-neutral-600">
            カメラ撮影または画像（スクショ）を選択して数値を自動入力できます。
          </p>
          <div className="flex flex-col gap-3">
            <div className="border-2 border-dashed rounded-2xl p-6 text-center">
              <div className="mb-3">ここに画像をドロップ（PC）</div>
              <div className="flex gap-2 justify-center">
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border hover:bg-neutral-50"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  📷 カメラで撮る
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border hover:bg-neutral-50"
                  onClick={() => fileInputRef.current?.click()}
                >
                  🖼 画像を選ぶ
                </button>
              </div>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => handleImageFiles(e.target.files)}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleImageFiles(e.target.files)}
              />
            </div>
            {ocrBusy && <div className="text-sm">読み取り中…</div>}
            {ocrLog && (
              <pre className="bg-neutral-100 rounded-xl p-3 text-xs overflow-auto max-h-48 whitespace-pre-wrap">
                {ocrLog}
              </pre>
            )}
          </div>
        </section>

        {/* 前提（編集） */}
        <section className="bg-white rounded-2xl shadow p-4 md:p-6 space-y-4">
          <details open>
            <summary className="cursor-pointer text-lg font-semibold">前提（編集可）</summary>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <NumberField label="リプレイ分母" value={replay} setValue={setReplay} />
              <NumberField label="チェリー分母" value={cherry} setValue={setCherry} />
              <NumberField label="ベル分母" value={bell} setValue={setBell} />
              <NumberField label="ピエロ分母" value={piero} setValue={setPiero} />
              <NumberField label="BIG平均枚数" value={bigAvg} setValue={setBigAvg} />
              <NumberField label="REG平均枚数" value={regAvg} setValue={setRegAvg} />
              <NumberField label="チェリー払い出し" value={cherryPay} setValue={setCherryPay} />
              <NumberField label="ベル払い出し" value={bellPay} setValue={setBellPay} />
              <NumberField label="ピエロ払い出し" value={pieroPay} setValue={setPieroPay} />
            </div>
          </details>
        </section>

        <footer className="text-xs text-neutral-500 pb-12">
          <p>スマホで拡大不要。ホームに追加してアプリ感覚で使えます。</p>
        </footer>
      </div>
    </div>
  );
}

/* =========================================================
   入力用コンポーネント
========================================================= */

// BB/RB 専用フィールド（±1/±10）
type BRFieldProps = {
  label: string;
  value: string | number;
  setValue: (v: any) => void;
};
function BRField({ label, value, setValue }: BRFieldProps) {
  const curr = Number.isFinite(Number(value)) ? Number(value) : 0;

  const apply = (d: number) => {
    const next = Math.max(0, curr + d);
    setValue(String(next));
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d]/g, "");
    setValue(raw.slice(0, 4));
  };

  const btnStyle = baseButton;
  const inputStyle: React.CSSProperties = { ...baseInput, width: "8ch" };

  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 14, opacity: 0.7, marginBottom: 4 }}>{label}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" style={btnStyle} onClick={() => apply(-10)}>-10</button>
        <button type="button" style={btnStyle} onClick={() => apply(-1)}>-1</button>
        <input type="text" inputMode="numeric" value={value as any} onChange={onChange} style={inputStyle} />
        <button type="button" style={btnStyle} onClick={() => apply(+1)}>+1</button>
        <button type="button" style={btnStyle} onClick={() => apply(+10)}>+10</button>
      </div>
    </label>
  );
}

// ±ボタン付きの数値入力（汎用）
function NumberField({
  label,
  value,
  setValue,
  step = 1,
  min,
  max,
  placeholder,
  allowNegative = false,
  compact = false,
  inputWidthCh,                // ★ 追加：入力幅（ch単位）
  // 左右に任意ボタンを並べられる
  extraLeft = [],
  extraRight = [],
}: {
  label: string;
  value: any;
  setValue: (v: any) => void;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  allowNegative?: boolean;
  compact?: boolean;
  inputWidthCh?: number;       // ★ 追加
  extraLeft?: { label: string; delta: number }[];
  extraRight?: { label: string; delta: number }[];
}) {
  const current = isFinite(Number(value)) ? Number(value) : 0;

  const apply = (delta: number) => {
    let next = (isFinite(current) ? current : 0) + delta;
    if (!allowNegative && (min ?? 0) >= 0) next = Math.max(min ?? 0, next);
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    setValue(String(Math.round(next)));
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d]/g, "");
    const clipped = raw.slice(0, 6); // 最大6桁
    setValue(clipped);
  };

  const widthStyle =
    inputWidthCh ? `${inputWidthCh}ch` : (compact ? "5ch" : undefined);
  const btnStyle: React.CSSProperties = { ...baseButton, fontSize: compact ? 12 : undefined };

  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 14, opacity: 0.7, marginBottom: 4 }}>
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
        {/* 左側 追加ボタン */}
        {extraLeft.map((b, i) => (
          <button key={`L${i}`} type="button" style={btnStyle} onClick={() => apply(b.delta)}>
            {b.label}
          </button>
        ))}
        {/* 既定の -step */}
        <button type="button" style={btnStyle} onClick={() => apply(-step)}>
          −{step}
        </button>

        <input
          type="text"
          inputMode="numeric"
          pattern="\\d*"
          style={{ ...baseInput, width: widthStyle }}
          value={value as any}
          onChange={onChange}
          placeholder={placeholder}
        />

        {/* 既定の +step */}
        <button type="button" style={btnStyle} onClick={() => apply(step)}>
          +{step}
        </button>
        {/* 右側 追加ボタン */}
        {extraRight.map((b, i) => (
          <button key={`R${i}`} type="button" style={btnStyle} onClick={() => apply(b.delta)}>
            {b.label}
          </button>
        ))}
      </div>
    </label>
  );
}

// 差枚：±50 / ±100 / ±1000（±10は削除済み）
function DiffField({
  label,
  value,
  setValue,
}: {
  label: string;
  value: any;
  setValue: (v: any) => void;
}) {
  const current = isFinite(Number(value)) ? Number(value) : 0;
  const apply = (delta: number) => setValue(String(Math.round(current + delta)));

  // 先頭±許可＆6桁まで
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/[^\d+-]/g, "");
    const sign = raw.startsWith("-") ? "-" : raw.startsWith("+") ? "+" : "";
    const digits = raw.replace(/[+-]/g, "").slice(0, 6);
    setValue(sign + digits);
  };

  const btnStyle: React.CSSProperties = {
    ...baseButton,
    fontSize: 12,
    whiteSpace: "nowrap",
    flex: "0 0 auto",
  };
  const inputStyle: React.CSSProperties = {
    ...baseInput,
    width: "8ch",
    flex: "0 0 auto",
  };

  // label を外側の div で表示（クリック領域のバグ回避）
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, opacity: 0.7 }}>{label}</span>

      {/* 折り返し禁止＆必要時のみ横スクロール */}
      <div
        style={{
          display: "flex",
          flexWrap: "nowrap",
          gap: 8,
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          alignItems: "center",
        }}
      >
        {/* 左側（マイナス） */}
        <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
          <button type="button" style={btnStyle} onClick={() => apply(-1000)}>−1000</button>
          <button type="button" style={btnStyle} onClick={() => apply(-100)}>−100</button>
          <button type="button" style={btnStyle} onClick={() => apply(-50)}>−50</button>
        </div>

        {/* 入力欄（プレースホルダ削除で“灰色の0”を消す） */}
        <input
          type="text"
          inputMode="numeric"
          value={value as any}
          onChange={onChange}
          style={inputStyle}
        />

        {/* 右側（プラス） */}
        <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
          <button type="button" style={btnStyle} onClick={() => apply(+50)}>+50</button>
          <button type="button" style={btnStyle} onClick={() => apply(+100)}>+100</button>
          <button type="button" style={btnStyle} onClick={() => apply(+1000)}>+1000</button>
        </div>
      </div>
    </div>
  );
}

/* -----------------------
   OCRテキスト → 数値抽出
----------------------- */
function parseFromText(raw: string) {
  if (!raw) return null;
  const text = raw
    .replace(/[\uFF10-\uFF19]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFF10 + 0x30))
    .replace(/[ ,\t]+/g, " ")
    .replace(/,/g, "")
    .replace(/Ｇ/g, "G")
    .replace(/－/g, "-")
    .replace(/＋/g, "+")
    .toLowerCase();

  let modelKey: string | undefined;
  for (const key of Object.keys(PRESETS)) {
    const keyNorm = key.toLowerCase().replace(/\s/g, "");
    if (text.replace(/\s/g, "").includes(keyNorm)) { modelKey = key; break; }
  }

  let G: number | undefined;
  const gPatterns = [
    /(総?回転数|g数|回転数)\s*[:：]?\s*(\d{2,6})\s*g?/,
    /(\d{3,6})\s*g(?!\/)/,
  ];
  for (const r of gPatterns) {
    const m = text.match(r);
    if (m) { G = parseInt(m[2] || m[1], 10); break; }
  }

  let big: number | undefined;
  let reg: number | undefined;
  const bbPatterns = [/(bb|big|ビッグ)\s*[:：]?\s*(\d{1,3})/];
  const rbPatterns = [/(rb|reg|レギュラー)\s*[:：]?\s*(\d{1,3})/];
  for (const r of bbPatterns) { const m = text.match(r); if (m) { big = parseInt(m[2], 10); break; } }
  for (const r of rbPatterns) { const m = text.match(r); if (m) { reg = parseInt(m[2], 10); break; } }

  let diff: number | undefined;
  const diffPatterns = [
    /(差枚(数)?|差玉|差枚数)\s*[:：]?\s*([+-]?\d{1,6})/,
    /([+-]\d{1,6})\s*(枚)?/,
  ];
  for (const r of diffPatterns) {
    const m = text.match(r);
    if (m) { diff = parseInt(m[3] || m[1], 10); break; }
  }

  if (G == null && big == null && reg == null && diff == null) return null;
  return { modelKey, G, big, reg, diff };
}

