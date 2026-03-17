"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  CalendarDays,
  CheckCircle2,
  Heart,
  Home,
  MessageSquare,
  Mic,
  Play,
  Settings,
  Sparkles,
  User,
  Volume2,
  XCircle,
  Eye,
  Ear,
} from "lucide-react";
import {
  api,
  type MemoryCheckQuestion,
  type MemoryCheckResult,
  type UserProfile,
} from "../../../../lib/api";

const PROFILE_IMAGE_URL =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuDrpjijg5RYen-KEp80Ku17lHJt6RK6oQ8jsW9yOGV8G22INjaHluVxszAVSYh7377YZduJY0z1JadmjpP-_slJeGgQKFmm53tOjbijQFoPrqrf32G8qlRqKcx5fRUjfVjGlREMUBlc9xtjTdcHypDPv6OA4gWbCQ2VxJVehPCypeFLrmiGy3QwVzlKW5gKU4PVT0_SQBD3riOiporPY9unbl6_T7IjdEnwDL7j1yxZItw3L9Fgj9T6Q8f8esWe3APv7JdvBOUrA0M";

type Tab = "home" | "chat" | "events" | "health" | "profile";
type Phase = "intro" | "loading" | "questions" | "recall-choose" | "recall-see" | "recall-hear" | "recall-respond" | "submitting" | "result" | "history" | "error";
type Lang = "en" | "zh" | "yue" | "ms" | "ta" | "hi";

// ---------------------------------------------------------------------------
// Full UI translation strings
// ---------------------------------------------------------------------------
const UI: Record<Lang, Record<string, string>> = {
  en: {
    pageTitle: "Memory & Focus",
    pageSubtitle: "Quick 30-sec daily check-in. Not a medical test.",
    language: "Language:",
    quickCheckIn: "Quick Check-In",
    introDesc: "Answer 3 short questions to track your focus and memory over time.",
    startCheckIn: "Start Check-In",
    viewPastResults: "View Past Results",
    generating: "Generating your questions...",
    orientation: "Orientation",
    attention: "Attention",
    memoryRecall: "Memory Recall",
    typeAnswer: "Type your answer...",
    next: "Next",
    submit: "Submit",
    back: "Back",
    done: "Done",
    tryAgain: "Try Again",
    recallTitle: "Memory Recall",
    recallDesc: "You will be given 3 words to remember. How would you like to receive them?",
    seeWords: "See Words",
    seeWordsDesc: "Shown for 10 seconds",
    hearWords: "Hear Words",
    hearWordsDesc: "Played once",
    memoriseWords: "Memorise these words",
    remaining: "remaining",
    listenCarefully: "Listen carefully...",
    listenDesc: "The 3 words are being played now. You will hear them once.",
    whatWereWords: "What were the 3 words?",
    typeOrSay: "Type or say the words you remember",
    recallPlaceholder: "e.g. apple, table, penny",
    checkingAnswers: "Checking your answers...",
    withinRange: "Within your usual range",
    slightlyLower: "Slightly lower than usual",
    insight: "Insight",
    breakdown: "Breakdown",
    disclaimer: "This is a wellness check-in, not a medical diagnosis.",
    pastResults: "Past Results",
    trendAnalysis: "Your Trend Analysis",
    analysing: "Analysing your results...",
    noAnalysis: "Complete check-ins to see your trend analysis.",
    noPast: "No past sessions yet.",
    score: "Score",
    normal: "Normal",
    lower: "Lower",
    goBack: "Go Back",
    listening: "Listening...",
    voiceInput: "Voice input",
    listen: "Listen",
    voiceNotSupported: "Voice input is not supported in this browser. Please use Chrome or Edge.",
    alertTitle: "Care Team Notified",
    alertBody: "We've noticed your scores have been lower than usual over your last 3 check-ins. This has been flagged and your clinician and caregiver have been informed to follow up with you.",
  },
  zh: {
    pageTitle: "记忆与专注力",
    pageSubtitle: "每日30秒快速检查，非医学测试。",
    language: "语言：",
    quickCheckIn: "快速检查",
    introDesc: "回答3个简短问题，追踪您的专注力和记忆力。",
    startCheckIn: "开始检查",
    viewPastResults: "查看过往结果",
    generating: "正在生成您的问题...",
    orientation: "定向力",
    attention: "注意力",
    memoryRecall: "记忆回忆",
    typeAnswer: "输入您的答案...",
    next: "下一题",
    submit: "提交",
    back: "返回",
    done: "完成",
    tryAgain: "再试一次",
    recallTitle: "记忆回忆",
    recallDesc: "您将获得3个词语来记忆。您希望如何接收？",
    seeWords: "看词语",
    seeWordsDesc: "显示10秒",
    hearWords: "听词语",
    hearWordsDesc: "播放一次",
    memoriseWords: "记住这些词语",
    remaining: "秒剩余",
    listenCarefully: "仔细听...",
    listenDesc: "3个词语正在播放，只播放一次。",
    whatWereWords: "那3个词语是什么？",
    typeOrSay: "输入或说出您记住的词语",
    recallPlaceholder: "例如：苹果、桌子、硬币",
    checkingAnswers: "正在检查您的答案...",
    withinRange: "在您的正常范围内",
    slightlyLower: "比平时稍低",
    insight: "分析",
    breakdown: "详情",
    disclaimer: "这是健康检查，不是医学诊断。",
    pastResults: "过往结果",
    trendAnalysis: "您的趋势分析",
    analysing: "正在分析您的结果...",
    noAnalysis: "完成检查以查看趋势分析。",
    noPast: "暂无过往记录。",
    score: "分数",
    normal: "正常",
    lower: "偏低",
    goBack: "返回",
    listening: "正在聆听...",
    voiceInput: "语音输入",
    listen: "播放",
    voiceNotSupported: "此浏览器不支持语音输入，请使用Chrome或Edge。",
    alertTitle: "已通知护理团队",
    alertBody: "我们注意到您最近3次检查的分数低于平时。这已被记录，您的医生和护理人员将与您跟进。",
  },
  yue: {
    pageTitle: "記憶同專注力",
    pageSubtitle: "每日30秒快速檢查，唔係醫學測試。",
    language: "語言：",
    quickCheckIn: "快速檢查",
    introDesc: "答3條簡短問題，追蹤你嘅專注力同記憶力。",
    startCheckIn: "開始檢查",
    viewPastResults: "睇返過去結果",
    generating: "正在生成你嘅問題...",
    orientation: "定向力",
    attention: "注意力",
    memoryRecall: "記憶回想",
    typeAnswer: "輸入你嘅答案...",
    next: "下一題",
    submit: "提交",
    back: "返回",
    done: "完成",
    tryAgain: "再試一次",
    recallTitle: "記憶回想",
    recallDesc: "你會收到3個詞語嚟記住。你想點樣接收？",
    seeWords: "睇詞語",
    seeWordsDesc: "顯示10秒",
    hearWords: "聽詞語",
    hearWordsDesc: "播放一次",
    memoriseWords: "記住呢啲詞語",
    remaining: "秒剩餘",
    listenCarefully: "留心聽...",
    listenDesc: "3個詞語而家播緊，淨係播一次。",
    whatWereWords: "嗰3個詞語係咩？",
    typeOrSay: "輸入或者講出你記得嘅詞語",
    recallPlaceholder: "例如：蘋果、桌子、硬幣",
    checkingAnswers: "正在檢查你嘅答案...",
    withinRange: "喺你嘅正常範圍內",
    slightlyLower: "比平時稍低",
    insight: "分析",
    breakdown: "詳情",
    disclaimer: "呢個係健康檢查，唔係醫學診斷。",
    pastResults: "過去結果",
    trendAnalysis: "你嘅趨勢分析",
    analysing: "正在分析你嘅結果...",
    noAnalysis: "完成檢查嚟睇趨勢分析。",
    noPast: "暫時冇過去紀錄。",
    score: "分數",
    normal: "正常",
    lower: "偏低",
    goBack: "返回",
    listening: "聽緊...",
    voiceInput: "語音輸入",
    listen: "播放",
    voiceNotSupported: "呢個瀏覽器唔支援語音輸入，請用Chrome或Edge。",
    alertTitle: "已通知護理團隊",
    alertBody: "我們留意到你最近3次檢查嘅分數比平時低。呢個已被記錄，你嘅醫生同護理人員會同你跟進。",
  },
  ms: {
    pageTitle: "Memori & Fokus",
    pageSubtitle: "Semakan harian 30 saat. Bukan ujian perubatan.",
    language: "Bahasa:",
    quickCheckIn: "Semakan Pantas",
    introDesc: "Jawab 3 soalan ringkas untuk jejak fokus dan memori anda.",
    startCheckIn: "Mula Semakan",
    viewPastResults: "Lihat Keputusan Lepas",
    generating: "Menjana soalan anda...",
    orientation: "Orientasi",
    attention: "Perhatian",
    memoryRecall: "Ingatan Semula",
    typeAnswer: "Taip jawapan anda...",
    next: "Seterusnya",
    submit: "Hantar",
    back: "Kembali",
    done: "Selesai",
    tryAgain: "Cuba Lagi",
    recallTitle: "Ingatan Semula",
    recallDesc: "Anda akan diberi 3 perkataan untuk diingati. Bagaimana anda ingin menerimanya?",
    seeWords: "Lihat Perkataan",
    seeWordsDesc: "Ditunjukkan selama 10 saat",
    hearWords: "Dengar Perkataan",
    hearWordsDesc: "Dimainkan sekali",
    memoriseWords: "Ingat perkataan ini",
    remaining: "saat lagi",
    listenCarefully: "Dengar dengan teliti...",
    listenDesc: "3 perkataan sedang dimainkan sekarang. Anda hanya dengar sekali.",
    whatWereWords: "Apakah 3 perkataan tadi?",
    typeOrSay: "Taip atau sebut perkataan yang anda ingat",
    recallPlaceholder: "cth: epal, meja, syiling",
    checkingAnswers: "Menyemak jawapan anda...",
    withinRange: "Dalam julat biasa anda",
    slightlyLower: "Sedikit lebih rendah dari biasa",
    insight: "Pandangan",
    breakdown: "Pecahan",
    disclaimer: "Ini adalah semakan kesejahteraan, bukan diagnosis perubatan.",
    pastResults: "Keputusan Lepas",
    trendAnalysis: "Analisis Trend Anda",
    analysing: "Menganalisis keputusan anda...",
    noAnalysis: "Selesaikan semakan untuk melihat analisis trend.",
    noPast: "Belum ada sesi lepas.",
    score: "Skor",
    normal: "Normal",
    lower: "Rendah",
    goBack: "Kembali",
    listening: "Mendengar...",
    voiceInput: "Input suara",
    listen: "Dengar",
    voiceNotSupported: "Input suara tidak disokong di pelayar ini. Sila gunakan Chrome atau Edge.",
    alertTitle: "Pasukan Penjagaan Dimaklumkan",
    alertBody: "Kami perasan skor anda telah lebih rendah daripada biasa dalam 3 semakan terakhir. Ini telah direkodkan dan doktor serta penjaga anda akan menghubungi anda.",
  },
  ta: {
    pageTitle: "நினைவாற்றல் & கவனம்",
    pageSubtitle: "தினசரி 30 வினாடி சரிபார்ப்பு. மருத்துவ பரிசோதனை அல்ல.",
    language: "மொழி:",
    quickCheckIn: "விரைவு சரிபார்ப்பு",
    introDesc: "உங்கள் கவனம் மற்றும் நினைவாற்றலை கண்காணிக்க 3 சுருக்கமான கேள்விகளுக்கு பதிலளிக்கவும்.",
    startCheckIn: "சரிபார்ப்பு தொடங்கு",
    viewPastResults: "கடந்த முடிவுகளைப் பார்",
    generating: "உங்கள் கேள்விகளை உருவாக்குகிறது...",
    orientation: "நோக்குநிலை",
    attention: "கவனம்",
    memoryRecall: "நினைவு நினைவுகூர்தல்",
    typeAnswer: "உங்கள் பதிலை தட்டச்சு செய்யவும்...",
    next: "அடுத்து",
    submit: "சமர்ப்பி",
    back: "திரும்பு",
    done: "முடிந்தது",
    tryAgain: "மீண்டும் முயற்சி",
    recallTitle: "நினைவு நினைவுகூர்தல்",
    recallDesc: "நினைவில் வைக்க 3 வார்த்தைகள் தரப்படும். எப்படி பெற விரும்புகிறீர்கள்?",
    seeWords: "வார்த்தைகளைப் பார்",
    seeWordsDesc: "10 வினாடி காட்டப்படும்",
    hearWords: "வார்த்தைகளைக் கேள்",
    hearWordsDesc: "ஒரு முறை இயக்கப்படும்",
    memoriseWords: "இந்த வார்த்தைகளை நினைவில் கொள்ளுங்கள்",
    remaining: "வினாடி மீதம்",
    listenCarefully: "கவனமாகக் கேளுங்கள்...",
    listenDesc: "3 வார்த்தைகள் இப்போது இயக்கப்படுகின்றன. ஒரு முறை மட்டுமே கேட்பீர்கள்.",
    whatWereWords: "அந்த 3 வார்த்தைகள் என்ன?",
    typeOrSay: "நீங்கள் நினைவில் வைத்திருக்கும் வார்த்தைகளை தட்டச்சு செய்யவும் அல்லது சொல்லவும்",
    recallPlaceholder: "எ.கா: ஆப்பிள், மேசை, நாணயம்",
    checkingAnswers: "உங்கள் பதில்களை சரிபார்க்கிறது...",
    withinRange: "உங்கள் வழக்கமான வரம்பில் உள்ளது",
    slightlyLower: "வழக்கத்தை விட சற்று குறைவு",
    insight: "நுண்ணறிவு",
    breakdown: "விவரம்",
    disclaimer: "இது ஒரு நல்வாழ்வு சரிபார்ப்பு, மருத்துவ நோயறிதல் அல்ல.",
    pastResults: "கடந்த முடிவுகள்",
    trendAnalysis: "உங்கள் போக்கு பகுப்பாய்வு",
    analysing: "உங்கள் முடிவுகளை பகுப்பாய்வு செய்கிறது...",
    noAnalysis: "போக்கு பகுப்பாய்வைக் காண சரிபார்ப்புகளை முடிக்கவும்.",
    noPast: "இதுவரை பதிவுகள் இல்லை.",
    score: "மதிப்பெண்",
    normal: "சாதாரண",
    lower: "குறைவு",
    goBack: "திரும்பு",
    listening: "கேட்கிறது...",
    voiceInput: "குரல் உள்ளீடு",
    listen: "கேள்",
    voiceNotSupported: "இந்த உலாவியில் குரல் உள்ளீடு ஆதரிக்கப்படவில்லை. Chrome அல்லது Edge பயன்படுத்தவும்.",
    alertTitle: "பராமரிப்பு குழு அறிவிக்கப்பட்டது",
    alertBody: "கடந்த 3 சரிபார்ப்புகளில் உங்கள் மதிப்பெண்கள் வழக்கத்தை விட குறைவாக இருப்பதை கவனித்தோம். இது பதிவு செய்யப்பட்டுள்ளது மற்றும் உங்கள் மருத்துவர் மற்றும் பராமரிப்பாளர் தொடர்பு கொள்வார்கள்.",
  },
  hi: {
    pageTitle: "स्मृति और ध्यान",
    pageSubtitle: "दैनिक 30 सेकंड की जांच। चिकित्सा परीक्षण नहीं।",
    language: "भाषा:",
    quickCheckIn: "त्वरित जांच",
    introDesc: "अपनी ध्यान और स्मृति को ट्रैक करने के लिए 3 छोटे सवालों के जवाब दें।",
    startCheckIn: "जांच शुरू करें",
    viewPastResults: "पिछले परिणाम देखें",
    generating: "आपके सवाल तैयार हो रहे हैं...",
    orientation: "अभिविन्यास",
    attention: "ध्यान",
    memoryRecall: "स्मृति स्मरण",
    typeAnswer: "अपना उत्तर टाइप करें...",
    next: "अगला",
    submit: "जमा करें",
    back: "वापस",
    done: "हो गया",
    tryAgain: "फिर कोशिश करें",
    recallTitle: "स्मृति स्मरण",
    recallDesc: "आपको याद रखने के लिए 3 शब्द दिए जाएंगे। आप उन्हें कैसे प्राप्त करना चाहेंगे?",
    seeWords: "शब्द देखें",
    seeWordsDesc: "10 सेकंड दिखाया जाएगा",
    hearWords: "शब्द सुनें",
    hearWordsDesc: "एक बार बजाया जाएगा",
    memoriseWords: "इन शब्दों को याद करें",
    remaining: "सेकंड शेष",
    listenCarefully: "ध्यान से सुनें...",
    listenDesc: "3 शब्द अभी बजाए जा रहे हैं। आप उन्हें एक बार ही सुनेंगे।",
    whatWereWords: "वे 3 शब्द क्या थे?",
    typeOrSay: "जो शब्द याद हैं उन्हें टाइप करें या बोलें",
    recallPlaceholder: "उदा: सेब, मेज, सिक्का",
    checkingAnswers: "आपके उत्तर जांचे जा रहे हैं...",
    withinRange: "आपकी सामान्य सीमा में",
    slightlyLower: "सामान्य से थोड़ा कम",
    insight: "अंतर्दृष्टि",
    breakdown: "विवरण",
    disclaimer: "यह एक कल्याण जांच है, चिकित्सा निदान नहीं।",
    pastResults: "पिछले परिणाम",
    trendAnalysis: "आपका रुझान विश्लेषण",
    analysing: "आपके परिणामों का विश्लेषण हो रहा है...",
    noAnalysis: "रुझान विश्लेषण देखने के लिए जांच पूरी करें।",
    noPast: "अभी तक कोई पिछला सत्र नहीं।",
    score: "स्कोर",
    normal: "सामान्य",
    lower: "कम",
    goBack: "वापस जाएं",
    listening: "सुन रहा है...",
    voiceInput: "आवाज इनपुट",
    listen: "सुनें",
    voiceNotSupported: "इस ब्राउज़र में आवाज इनपुट समर्थित नहीं है। कृपया Chrome या Edge का उपयोग करें।",
    alertTitle: "देखभाल टीम को सूचित किया गया",
    alertBody: "हमने देखा है कि आपके पिछले 3 चेक-इन में स्कोर सामान्य से कम रहे हैं। यह दर्ज किया गया है और आपके डॉक्टर और देखभालकर्ता आपसे संपर्क करेंगे।",
  },
};

const LANG_SPEECH_MAP: Record<string, string> = {
  en: "en-SG",
  zh: "zh-CN",
  yue: "zh-HK",
  ms: "ms-MY",
  ta: "ta-SG",
  hi: "hi-IN",
};

function BottomNavIcon({ tab, active }: { tab: Tab; active: boolean }) {
  const s = { size: 19, strokeWidth: active ? 2.15 : 1.95 };
  if (tab === "home") return <Home {...s} />;
  if (tab === "chat") return <MessageSquare {...s} />;
  if (tab === "events") return <CalendarDays {...s} />;
  if (tab === "health") return <Heart {...s} />;
  return <User {...s} />;
}

function safeMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

export default function MemoryCheckPage() {
  const params = useParams();
  const router = useRouter();
  const userId = Array.isArray(params.userId) ? params.userId[0] : (params.userId ?? "");

  // --- State ---
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const [phase, setPhase] = useState<Phase>("intro");
  const [sessionId, setSessionId] = useState("");
  const [questions, setQuestions] = useState<MemoryCheckQuestion[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [responses, setResponses] = useState<string[]>([]);
  const [result, setResult] = useState<MemoryCheckResult | null>(null);
  const [history, setHistory] = useState<MemoryCheckResult[]>([]);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [alertNotified, setAlertNotified] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [error, setError] = useState("");

  // Recall timer state
  const [recallTimer, setRecallTimer] = useState(0);
  const recallIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Audio/voice state
  const [isRecording, setIsRecording] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);

  // Shorthand for current translation
  const t = UI[lang];

  // --- Load profile ---
  useEffect(() => {
    api.getUser(userId).then(setUserProfile).catch(() => {});
  }, [userId]);

  // --- Helpers ---
  const playTTS = useCallback(async (text: string) => {
    if (audioPlaying || audioLoading) return;
    setAudioLoading(true);
    try {
      const ttsLang = lang === "yue" ? "zh" : lang;
      const blob = await api.postTTS(text, ttsLang);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      setAudioPlaying(true);
      setAudioLoading(false);
      audio.onended = () => { setAudioPlaying(false); URL.revokeObjectURL(url); };
      audio.onerror = () => { setAudioPlaying(false); URL.revokeObjectURL(url); };
      audio.play().catch(() => setAudioPlaying(false));
    } catch {
      setAudioLoading(false);
    }
  }, [lang, audioPlaying, audioLoading]);

  const startVoiceInput = useCallback((onResult: (transcript: string) => void) => {
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setError(t.voiceNotSupported);
      return;
    }
    if (isRecording) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = LANG_SPEECH_MAP[lang] || "en-SG";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    setIsRecording(true);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript.trim()) onResult(transcript.trim());
      setIsRecording(false);
    };
    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);
    recognition.start();
  }, [lang, isRecording, t.voiceNotSupported]);

  // --- API calls ---
  const startSession = useCallback(async () => {
    setPhase("loading");
    setError("");
    try {
      const data = await api.startMemoryCheck(userId, lang);
      setSessionId(data.session_id);
      setQuestions(data.questions);
      setResponses(Array(data.questions.length).fill(""));
      setCurrentQ(0);
      setResult(null);
      setPhase("questions");
    } catch (err) {
      setError(safeMessage(err));
      setPhase("error");
    }
  }, [userId, lang]);

  const submitResponses = useCallback(async () => {
    setPhase("submitting");
    try {
      const data = await api.submitMemoryCheck(userId, sessionId, responses, lang);
      setResult(data);
      setPhase("result");
    } catch (err) {
      setError(safeMessage(err));
      setPhase("error");
    }
  }, [userId, sessionId, responses, lang]);

  const loadHistory = useCallback(async () => {
    try {
      const data = await api.getMemoryCheckHistory(userId);
      setHistory(data.sessions);
    } catch { /* silent */ }
  }, [userId]);

  const loadAnalysis = useCallback(async () => {
    setAnalysisLoading(true);
    try {
      const data = await api.getMemoryCheckAnalysis(userId, lang);
      setAnalysis(data.analysis);
      setAlertNotified(data.alert_notified ?? false);
    } catch {
      setAnalysis(null);
      setAlertNotified(false);
    } finally {
      setAnalysisLoading(false);
    }
  }, [userId, lang]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // --- Recall timer logic ---
  const startRecallSeeTimer = useCallback(() => {
    setRecallTimer(10);
    setPhase("recall-see");
    if (recallIntervalRef.current) clearInterval(recallIntervalRef.current);
    recallIntervalRef.current = setInterval(() => {
      setRecallTimer((prev) => {
        if (prev <= 1) {
          if (recallIntervalRef.current) clearInterval(recallIntervalRef.current);
          setPhase("recall-respond");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const startRecallHear = useCallback(() => {
    setPhase("recall-hear");
    const recallQ = questions.find((q) => q.type === "recall");
    if (recallQ?.words) {
      const wordsText = recallQ.words.join(", ");
      setAudioLoading(true);
      const ttsLang = lang === "yue" ? "zh" : lang;
      api.postTTS(wordsText, ttsLang, true).then((blob) => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        setAudioLoading(false);
        setAudioPlaying(true);
        audio.onended = () => {
          setAudioPlaying(false);
          URL.revokeObjectURL(url);
          setPhase("recall-respond");
        };
        audio.onerror = () => {
          setAudioPlaying(false);
          URL.revokeObjectURL(url);
          setPhase("recall-respond");
        };
        audio.play().catch(() => {
          setAudioPlaying(false);
          setPhase("recall-respond");
        });
      }).catch(() => {
        setAudioLoading(false);
        setPhase("recall-respond");
      });
    }
  }, [questions, lang]);

  useEffect(() => {
    return () => {
      if (recallIntervalRef.current) clearInterval(recallIntervalRef.current);
    };
  }, []);

  // --- Navigation ---
  const updateResponse = (index: number, value: string) => {
    setResponses((prev) => { const next = [...prev]; next[index] = value; return next; });
  };

  const goNext = () => {
    if (currentQ < questions.length - 1) {
      const nextQ = questions[currentQ + 1];
      if (nextQ.type === "recall") {
        setCurrentQ(currentQ + 1);
        setPhase("recall-choose");
        return;
      }
      setCurrentQ(currentQ + 1);
      setPhase("questions");
    } else {
      submitResponses();
    }
  };

  const goNextFromRecall = () => {
    if (currentQ < questions.length - 1) {
      setCurrentQ(currentQ + 1);
      setPhase("questions");
    } else {
      submitResponses();
    }
  };

  // After questions load, check if first one is recall
  useEffect(() => {
    if (phase === "questions" && questions.length > 0 && questions[currentQ]?.type === "recall") {
      setPhase("recall-choose");
    }
  }, [phase, questions, currentQ]);

  function navigateToTab(tab: Tab) {
    const base = `/dashboard/${encodeURIComponent(userId)}`;
    if (tab === "home") { router.push(base); return; }
    if (tab === "events") { router.push(`${base}/events`); return; }
    router.push(`${base}?tab=${tab}`);
  }

  // --- Recall question ref ---
  const recallQ = questions.find((q) => q.type === "recall") ?? null;

  // --- Audio button helper ---
  const AudioBtn = ({ text, light }: { text: string; light?: boolean }) => (
    <button
      type="button"
      onClick={() => playTTS(text)}
      disabled={audioLoading || audioPlaying}
      style={{
        width: "1.75rem", height: "1.75rem", flexShrink: 0, margin: 0, padding: 0,
        display: "grid", placeItems: "center",
        background: light ? "white" : "#eff6ff", color: "#2563eb",
        border: "1px solid #bfdbfe", borderRadius: "999px", cursor: "pointer",
      }}
      title={t.listen}
    >
      {audioLoading ? (
        <span style={{ display: "inline-block", width: "0.7rem", height: "0.7rem", border: "2px solid #bfdbfe", borderTopColor: "#2563eb", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
      ) : audioPlaying ? (
        <Volume2 size={14} strokeWidth={2.1} />
      ) : (
        <Play size={14} strokeWidth={2.1} />
      )}
    </button>
  );

  // --- Mic button helper ---
  const MicBtn = ({ onResult }: { onResult: (t: string) => void }) => (
    <button
      type="button"
      onClick={() => startVoiceInput(onResult)}
      disabled={isRecording}
      style={{
        width: "2.6rem", height: "2.6rem", margin: 0, padding: 0, display: "grid", placeItems: "center",
        borderRadius: "999px", border: isRecording ? "1px solid #fca5a5" : "1px solid #bfdbfe",
        background: isRecording ? "#fee2e2" : "#eff6ff",
        color: isRecording ? "#b91c1c" : "#334155",
        cursor: "pointer", flexShrink: 0,
        animation: isRecording ? "pulse-record 1s ease-in-out infinite" : "none",
      }}
      title={isRecording ? t.listening : t.voiceInput}
    >
      <Mic size={18} strokeWidth={2.1} />
    </button>
  );

  // --- Render ---
  return (
    <main className="flex min-h-screen justify-center bg-slate-100">
      <div className="flex min-h-screen w-full max-w-md flex-col bg-slate-50 md:border-x md:border-slate-200 md:shadow-[0_24px_80px_rgba(15,23,42,0.08)]">

        {/* App header */}
        <header className="app-header">
          <div className="header-left">
            <Image
              src={PROFILE_IMAGE_URL}
              alt="ByteCare logo"
              width={38}
              height={38}
              className="h-[2.35rem] w-[2.35rem] rounded-full border-2 border-blue-100 object-cover"
              referrerPolicy="no-referrer"
            />
            <div className="header-copy">
              <h1>ByteCare</h1>
              <p className="muted">{userProfile?.name ?? "Loading profile..."}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Settings"
            className="tc-icon-btn inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
          >
            <Settings size={20} />
          </button>
        </header>

        {/* Page title */}
        <section className="border-b border-slate-200 bg-white px-4 py-5">
          <div className="mb-1 flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push(`/dashboard/${encodeURIComponent(userId)}`)}
              className="tc-icon-btn inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100"
            >
              <ArrowLeft size={22} />
            </button>
            <div className="flex items-center gap-2">
              <Brain size={24} className="text-violet-600" />
              <h1 className="text-[1.6rem] font-bold leading-none tracking-tight text-slate-900">{t.pageTitle}</h1>
            </div>
          </div>
          <p className="pl-[3.25rem] text-[0.77rem] text-slate-600">{t.pageSubtitle}</p>
        </section>

        {/* Content area */}
        <section className="flex-1 space-y-4 px-4 py-4">

          {/* Language selector */}
          {phase !== "loading" && phase !== "submitting" && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">{t.language}</span>
              <select
                className="chat-lang-select"
                value={lang}
                onChange={(e) => setLang(e.target.value as Lang)}
                style={{ width: "auto", fontSize: "0.78rem", padding: "0.3rem 0.5rem", borderRadius: "8px", border: "1px solid #e2e8f0", background: "#f8fafc", marginTop: 0 }}
              >
                <option value="en">SG English</option>
                <option value="zh">普通话 Mandarin</option>
                <option value="yue">廣東話 Cantonese</option>
                <option value="ms">Bahasa Melayu</option>
                <option value="ta">தமிழ் Tamil</option>
                <option value="hi">हिन्दी Hindi</option>
              </select>
            </div>
          )}

          {/* ==================== INTRO ==================== */}
          {phase === "intro" && (
            <div className="space-y-4">
              <div className="rounded-[1.75rem] border border-violet-200 bg-violet-50 p-5 text-center">
                <Brain className="mx-auto mb-3 h-12 w-12 text-violet-500" />
                <h2 className="text-lg font-bold text-slate-900">{t.quickCheckIn}</h2>
                <p className="mt-2 text-sm text-slate-600">{t.introDesc}</p>
              </div>

              <button
                type="button"
                onClick={startSession}
                className="w-full rounded-2xl bg-violet-600 py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-violet-700 active:scale-[0.98]"
              >
                {t.startCheckIn}
              </button>

              {history.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setPhase("history"); loadAnalysis(); }}
                  className="w-full rounded-2xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                  style={{ background: "white" }}
                >
                  {t.viewPastResults} ({history.length})
                </button>
              )}
            </div>
          )}

          {/* ==================== LOADING ==================== */}
          {phase === "loading" && (
            <div className="flex flex-col items-center justify-center gap-3 py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
              <p className="text-sm text-slate-500">{t.generating}</p>
            </div>
          )}

          {/* ==================== QUESTIONS (orientation / attention) ==================== */}
          {phase === "questions" && questions.length > 0 && questions[currentQ]?.type !== "recall" && (
            <div className="space-y-4">
              {/* Progress bar */}
              <div className="flex items-center gap-2">
                {questions.map((_, i) => (
                  <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i < currentQ ? "bg-violet-500" : i === currentQ ? "bg-violet-400" : "bg-slate-200"}`} />
                ))}
              </div>

              {/* Question card */}
              <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {questions[currentQ].type === "orientation"
                      ? <Sparkles className="h-5 w-5 text-blue-500" />
                      : <Sparkles className="h-5 w-5 text-amber-500" />}
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      {questions[currentQ].type === "orientation" ? t.orientation : t.attention} — {currentQ + 1}/{questions.length}
                    </span>
                  </div>
                  <AudioBtn text={questions[currentQ].question} />
                </div>

                <p className="text-base font-semibold text-slate-800">{questions[currentQ].question}</p>

                <div className="mt-4 flex items-center gap-2">
                  <input
                    type="text"
                    value={responses[currentQ] ?? ""}
                    onChange={(e) => updateResponse(currentQ, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && responses[currentQ]?.trim()) goNext(); }}
                    placeholder={t.typeAnswer}
                    className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    autoFocus
                  />
                  <MicBtn onResult={(txt) => updateResponse(currentQ, txt)} />
                </div>
              </div>

              {/* Nav buttons */}
              <div className="flex gap-3">
                {currentQ > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const prevQ = questions[currentQ - 1];
                      setCurrentQ(currentQ - 1);
                      setPhase(prevQ.type === "recall" ? "recall-respond" : "questions");
                    }}
                    className="tc-btn flex-1 rounded-2xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
                    style={{ background: "white" }}
                  >
                    {t.back}
                  </button>
                )}
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!responses[currentQ]?.trim()}
                  className="flex-1 rounded-2xl bg-violet-600 py-3 text-sm font-bold text-white shadow transition hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {currentQ < questions.length - 1 ? t.next : t.submit}
                </button>
              </div>
            </div>
          )}

          {/* ==================== RECALL: CHOOSE SEE OR HEAR ==================== */}
          {phase === "recall-choose" && recallQ && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {questions.map((_, i) => (
                  <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i < currentQ ? "bg-violet-500" : i === currentQ ? "bg-violet-400" : "bg-slate-200"}`} />
                ))}
              </div>

              <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm text-center">
                <Brain className="mx-auto mb-3 h-10 w-10 text-violet-500" />
                <h3 className="text-base font-bold text-slate-900 mb-1">{t.recallTitle}</h3>
                <p className="text-sm text-slate-600 mb-5">{t.recallDesc}</p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={startRecallSeeTimer}
                    className="flex-1 flex flex-col items-center gap-2 rounded-2xl border-2 border-violet-200 bg-violet-50 p-4 transition hover:border-violet-400"
                    style={{ background: "#f5f3ff" }}
                  >
                    <Eye className="h-6 w-6 text-violet-600" />
                    <span className="text-sm font-bold text-violet-700">{t.seeWords}</span>
                    <span className="text-[10px] text-slate-500">{t.seeWordsDesc}</span>
                  </button>
                  <button
                    type="button"
                    onClick={startRecallHear}
                    className="flex-1 flex flex-col items-center gap-2 rounded-2xl border-2 border-blue-200 bg-blue-50 p-4 transition hover:border-blue-400"
                    style={{ background: "#eff6ff" }}
                  >
                    <Ear className="h-6 w-6 text-blue-600" />
                    <span className="text-sm font-bold text-blue-700">{t.hearWords}</span>
                    <span className="text-[10px] text-slate-500">{t.hearWordsDesc}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ==================== RECALL: SEE (timer) ==================== */}
          {phase === "recall-see" && recallQ && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {questions.map((_, i) => (
                  <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i < currentQ ? "bg-violet-500" : i === currentQ ? "bg-violet-400" : "bg-slate-200"}`} />
                ))}
              </div>

              <div className="rounded-[1.75rem] border border-violet-200 bg-violet-50 p-6 text-center">
                <p className="text-xs font-bold uppercase tracking-wider text-violet-400 mb-3">{t.memoriseWords}</p>
                <div className="flex flex-col items-center gap-3 mb-4">
                  {recallQ.words?.map((w, i) => (
                    <span key={i} className="text-2xl font-black text-violet-700">{w}</span>
                  ))}
                </div>
                <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-1.5">
                  <div className="h-3 w-3 rounded-full bg-violet-500 animate-pulse" />
                  <span className="text-sm font-bold text-violet-600">{recallTimer}s {t.remaining}</span>
                </div>
              </div>
            </div>
          )}

          {/* ==================== RECALL: HEAR (audio playing) ==================== */}
          {phase === "recall-hear" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {questions.map((_, i) => (
                  <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i < currentQ ? "bg-violet-500" : i === currentQ ? "bg-violet-400" : "bg-slate-200"}`} />
                ))}
              </div>

              <div className="rounded-[1.75rem] border border-blue-200 bg-blue-50 p-6 text-center">
                <Ear className="mx-auto mb-3 h-10 w-10 text-blue-500" />
                <p className="text-base font-bold text-slate-900 mb-2">{t.listenCarefully}</p>
                <p className="text-sm text-slate-600">{t.listenDesc}</p>
                {audioLoading && (
                  <div className="mt-4 flex justify-center">
                    <div className="h-6 w-6 animate-spin rounded-full border-[3px] border-blue-200 border-t-blue-600" />
                  </div>
                )}
                {audioPlaying && (
                  <div className="mt-4 flex justify-center">
                    <Volume2 className="h-8 w-8 text-blue-600 animate-pulse" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ==================== RECALL: RESPOND ==================== */}
          {phase === "recall-respond" && recallQ && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {questions.map((_, i) => (
                  <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i < currentQ ? "bg-violet-500" : i === currentQ ? "bg-violet-400" : "bg-slate-200"}`} />
                ))}
              </div>

              <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <Brain className="h-5 w-5 text-violet-500" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{t.memoryRecall} — {currentQ + 1}/{questions.length}</span>
                </div>

                <p className="text-base font-semibold text-slate-800 mb-1">{t.whatWereWords}</p>
                <p className="text-xs text-slate-500 mb-3">{t.typeOrSay}</p>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={responses[currentQ] ?? ""}
                    onChange={(e) => updateResponse(currentQ, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && responses[currentQ]?.trim()) goNextFromRecall(); }}
                    placeholder={t.recallPlaceholder}
                    className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    autoFocus
                  />
                  <MicBtn onResult={(txt) => updateResponse(currentQ, txt)} />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={goNextFromRecall}
                  disabled={!responses[currentQ]?.trim()}
                  className="flex-1 rounded-2xl bg-violet-600 py-3 text-sm font-bold text-white shadow transition hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {currentQ < questions.length - 1 ? t.next : t.submit}
                </button>
              </div>
            </div>
          )}

          {/* ==================== SUBMITTING ==================== */}
          {phase === "submitting" && (
            <div className="flex flex-col items-center justify-center gap-3 py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
              <p className="text-sm text-slate-500">{t.checkingAnswers}</p>
            </div>
          )}

          {/* ==================== RESULT ==================== */}
          {phase === "result" && result && (
            <div className="space-y-4">
              <div className={`rounded-[1.75rem] border p-5 text-center ${
                result.status === "within_range" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
              }`}>
                <div className="mb-2 text-4xl font-black text-slate-900">
                  {result.score}<span className="text-lg font-semibold text-slate-400">/3</span>
                </div>
                <p className={`text-sm font-bold ${result.status === "within_range" ? "text-emerald-600" : "text-amber-600"}`}>
                  {result.status === "within_range" ? t.withinRange : t.slightlyLower}
                </p>
              </div>

              <div className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{t.insight}</span>
                  </div>
                  <AudioBtn text={result.insight} />
                </div>
                <p className="text-sm leading-relaxed text-slate-700">{result.insight}</p>
              </div>

              {/* Alert card — shown when 3 consecutive low scores detected */}
              {result.alert_triggered && (
                <div className="rounded-[1.75rem] border border-amber-300 bg-amber-50 p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <span className="text-xs font-bold uppercase tracking-wider text-amber-600">{t.alertTitle}</span>
                    </div>
                    {result.alert_message && <AudioBtn text={result.alert_message} />}
                  </div>
                  <p className="text-sm leading-relaxed text-amber-900">
                    {result.alert_message || t.alertBody}
                  </p>
                </div>
              )}

              {result.scoring_details && (
                <div className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">{t.breakdown}</h3>
                  <div className="space-y-2">
                    {result.scoring_details.map((d, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        {d.correct
                          ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                          : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />}
                        <span className="text-sm text-slate-700">{d.question}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setPhase("intro"); loadHistory(); }}
                  className="tc-btn flex-1 rounded-2xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
                  style={{ background: "white" }}
                >
                  {t.done}
                </button>
                <button
                  type="button"
                  onClick={startSession}
                  className="flex-1 rounded-2xl bg-violet-600 py-3 text-sm font-bold text-white shadow transition hover:bg-violet-700"
                >
                  {t.tryAgain}
                </button>
              </div>

              <p className="text-center text-[10px] text-slate-400">{t.disclaimer}</p>
            </div>
          )}

          {/* ==================== HISTORY ==================== */}
          {phase === "history" && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setPhase("intro")}
                className="tc-icon-btn flex items-center gap-1 text-sm font-semibold text-violet-600"
              >
                <ArrowLeft className="h-4 w-4" /> {t.back}
              </button>

              <h2 className="text-base font-bold text-slate-900">{t.pastResults}</h2>

              <div className="rounded-[1.75rem] border border-violet-200 bg-violet-50 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    <span className="text-xs font-bold uppercase tracking-wider text-violet-400">{t.trendAnalysis}</span>
                  </div>
                  {analysis && <AudioBtn text={analysis} light />}
                </div>
                {analysisLoading ? (
                  <div className="flex items-center gap-2 py-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
                    <span className="text-xs text-slate-500">{t.analysing}</span>
                  </div>
                ) : analysis ? (
                  <p className="text-sm leading-relaxed text-slate-700">{analysis}</p>
                ) : (
                  <p className="text-xs text-slate-500">{t.noAnalysis}</p>
                )}
              </div>

              {/* Alert notification card — shown when care team was notified */}
              {alertNotified && (
                <div className="rounded-[1.75rem] border border-amber-300 bg-amber-50 p-4 shadow-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-600">{t.alertTitle}</span>
                  </div>
                  <p className="text-sm leading-relaxed text-amber-900">{t.alertBody}</p>
                </div>
              )}

              {history.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">{t.noPast}</p>
              ) : (
                <div className="space-y-2.5">
                  {history.map((s) => (
                    <div
                      key={s.session_id}
                      className="flex items-center justify-between rounded-[1.75rem] border border-slate-200 bg-white px-4 py-3 shadow-sm"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{t.score}: {s.score}/3</p>
                        <p className="text-[11px] text-slate-400">
                          {new Date(
                            s.created_at.endsWith("Z") || s.created_at.includes("+")
                              ? s.created_at
                              : s.created_at + "Z"
                          ).toLocaleDateString("en-SG", {
                            day: "numeric", month: "short", year: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                        s.status === "within_range" ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"
                      }`}>
                        {s.status === "within_range" ? t.normal : t.lower}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ==================== ERROR ==================== */}
          {phase === "error" && (
            <div className="space-y-4 py-10 text-center">
              <XCircle className="mx-auto h-10 w-10 text-red-400" />
              <p className="text-sm text-slate-600">{error}</p>
              <button
                type="button"
                onClick={() => setPhase("intro")}
                className="rounded-2xl bg-violet-600 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-violet-700"
              >
                {t.goBack}
              </button>
            </div>
          )}

        </section>

        {/* Bottom nav */}
        <div className="w-full pb-[max(env(safe-area-inset-bottom),0px)]">
          <nav className="tc-bottom-nav flex w-full items-center justify-between border-t border-slate-200 bg-white px-2 py-3">
            {(["home", "chat", "events", "health", "profile"] as Tab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className="flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-slate-400 transition hover:text-blue-500"
                onClick={() => navigateToTab(tab)}
              >
                <BottomNavIcon tab={tab} active={false} />
                <span className="text-[11px] font-normal capitalize">{tab}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>
    </main>
  );
}
