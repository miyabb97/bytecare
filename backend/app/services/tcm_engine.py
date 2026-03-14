"""TCM safety interaction checking service with OCR support."""

from __future__ import annotations

import difflib
import io
import re
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import SessionLocal
from app.models import Medication, User
from app.services.meralion_client import MeralionClient, MeralionClientError


# ── Expanded herb-drug interaction database ──
# Each entry: herb_key -> { display_name, risk_level, drug_classes, guidance }
HERB_INTERACTIONS: Dict[str, Dict[str, Any]] = {
    # ── HIGH RISK ──
    "ginseng": {
        "display_name": "Ginseng (人参)",
        "risk_level": "high",
        "drug_classes": ["warfarin", "anticoagulant", "antiplatelet", "insulin", "metformin", "diabetes"],
        "guidance": "Ginseng may lower blood sugar and interfere with blood-thinning medications. "
                    "Consult your doctor before combining with diabetes or anticoagulant drugs.",
    },
    "ginkgo": {
        "display_name": "Ginkgo Biloba (银杏)",
        "risk_level": "high",
        "drug_classes": ["warfarin", "aspirin", "anticoagulant", "antiplatelet", "ibuprofen", "nsaid"],
        "guidance": "Ginkgo increases bleeding risk significantly when used with blood thinners or NSAIDs. "
                    "Stop use 2 weeks before any surgery.",
    },
    "dong quai": {
        "display_name": "Dong Quai (当归)",
        "risk_level": "high",
        "drug_classes": ["warfarin", "anticoagulant", "antiplatelet", "heparin"],
        "guidance": "Dong Quai has blood-thinning properties and may cause dangerous bleeding with anticoagulants.",
    },
    "st john's wort": {
        "display_name": "St John's Wort (贯叶连翘)",
        "risk_level": "high",
        "drug_classes": ["ssri", "antidepressant", "cyclosporine", "warfarin", "contraceptive", "statin",
                         "digoxin", "hiv", "antiretroviral", "tacrolimus"],
        "guidance": "St John's Wort reduces effectiveness of many drugs including antidepressants, "
                    "blood thinners, birth control, statins, and organ rejection drugs. Very high interaction risk.",
    },
    "danshen": {
        "display_name": "Danshen / Red Sage (丹参)",
        "risk_level": "high",
        "drug_classes": ["warfarin", "anticoagulant", "antiplatelet", "digoxin"],
        "guidance": "Danshen strongly increases bleeding risk with warfarin and may interfere with digoxin. "
                    "Do not combine without medical supervision.",
    },
    "ma huang": {
        "display_name": "Ma Huang / Ephedra (麻黄)",
        "risk_level": "high",
        "drug_classes": ["maoi", "antidepressant", "blood pressure", "antihypertensive", "caffeine",
                         "theophylline", "digoxin", "diabetes"],
        "guidance": "Ma Huang contains ephedrine. Can cause dangerous blood pressure spikes with MAOIs, "
                    "heart problems with digoxin, and reduced effectiveness of blood pressure drugs.",
    },
    "aconite": {
        "display_name": "Aconite / Fu Zi (附子)",
        "risk_level": "high",
        "drug_classes": ["antiarrhythmic", "digoxin", "blood pressure", "antihypertensive"],
        "guidance": "Aconite is highly toxic and can cause fatal heart arrhythmias. "
                    "Extremely dangerous with heart medications. Must only be used under strict TCM supervision.",
    },
    "kava": {
        "display_name": "Kava (卡瓦胡椒)",
        "risk_level": "high",
        "drug_classes": ["sedative", "benzodiazepine", "alcohol", "antidepressant", "levodopa",
                         "hepatotoxic"],
        "guidance": "Kava is toxic to the liver and greatly increases sedation with benzodiazepines, "
                    "alcohol, and antidepressants. May worsen Parkinson's symptoms with levodopa.",
    },
    # ── MODERATE RISK ──
    "licorice": {
        "display_name": "Licorice Root (甘草)",
        "risk_level": "moderate",
        "drug_classes": ["diuretic", "blood pressure", "antihypertensive", "digoxin", "corticosteroid",
                         "warfarin"],
        "guidance": "Licorice can raise blood pressure and lower potassium. "
                    "Avoid with blood pressure medications, diuretics, and digoxin.",
    },
    "turmeric": {
        "display_name": "Turmeric (姜黄)",
        "risk_level": "moderate",
        "drug_classes": ["warfarin", "anticoagulant", "antiplatelet", "diabetes", "antacid"],
        "guidance": "High-dose turmeric may increase bleeding risk with blood thinners "
                    "and enhance effects of diabetes medications.",
    },
    "garlic": {
        "display_name": "Garlic (大蒜)",
        "risk_level": "moderate",
        "drug_classes": ["warfarin", "anticoagulant", "antiplatelet", "hiv", "saquinavir"],
        "guidance": "Concentrated garlic supplements may increase bleeding risk with anticoagulants "
                    "and reduce effectiveness of HIV protease inhibitors.",
    },
    "lingzhi": {
        "display_name": "Lingzhi / Reishi (灵芝)",
        "risk_level": "moderate",
        "drug_classes": ["warfarin", "anticoagulant", "antiplatelet", "blood pressure", "antihypertensive",
                         "immunosuppressant"],
        "guidance": "Lingzhi may enhance blood-thinning effects and lower blood pressure. "
                    "May also interfere with immunosuppressant drugs.",
    },
    "goji berry": {
        "display_name": "Goji Berry (枸杞)",
        "risk_level": "moderate",
        "drug_classes": ["warfarin", "anticoagulant", "diabetes", "blood pressure", "antihypertensive"],
        "guidance": "Goji berries may significantly increase warfarin's blood-thinning effect "
                    "and enhance the action of diabetes and blood pressure medications.",
    },
    "astragalus": {
        "display_name": "Astragalus (黄芪)",
        "risk_level": "moderate",
        "drug_classes": ["immunosuppressant", "cyclosporine", "lithium", "diabetes"],
        "guidance": "Astragalus stimulates the immune system and may counteract immunosuppressants. "
                    "May also enhance diabetes medication effects.",
    },
    "cinnamon": {
        "display_name": "Cinnamon / Rou Gui (肉桂)",
        "risk_level": "moderate",
        "drug_classes": ["diabetes", "insulin", "metformin", "blood thinner", "hepatotoxic", "statin"],
        "guidance": "Cassia cinnamon in large doses may lower blood sugar excessively with diabetes drugs "
                    "and contains coumarin which may stress the liver when combined with statins.",
    },
    "evening primrose": {
        "display_name": "Evening Primrose Oil (月见草油)",
        "risk_level": "moderate",
        "drug_classes": ["anticoagulant", "warfarin", "antiplatelet", "phenothiazine", "antipsychotic"],
        "guidance": "Evening primrose oil may increase bleeding risk with blood thinners "
                    "and lower seizure threshold with certain antipsychotics.",
    },
    "saw palmetto": {
        "display_name": "Saw Palmetto (锯棕榈)",
        "risk_level": "moderate",
        "drug_classes": ["anticoagulant", "warfarin", "antiplatelet", "contraceptive", "hormone"],
        "guidance": "Saw palmetto may increase bleeding risk and has hormonal effects "
                    "that could interfere with hormone therapies and oral contraceptives.",
    },
    "milk thistle": {
        "display_name": "Milk Thistle (水飞蓟)",
        "risk_level": "moderate",
        "drug_classes": ["statin", "diabetes", "metformin", "antiretroviral", "immunosuppressant"],
        "guidance": "Milk thistle may alter liver enzyme levels affecting how statins and other drugs "
                    "are metabolized. Monitor closely with diabetes medications.",
    },
    "bitter melon": {
        "display_name": "Bitter Melon (苦瓜)",
        "risk_level": "moderate",
        "drug_classes": ["diabetes", "insulin", "metformin", "glipizide"],
        "guidance": "Bitter melon has strong blood-sugar-lowering effects. "
                    "Combining with diabetes medications may cause dangerously low blood sugar.",
    },
    "fenugreek": {
        "display_name": "Fenugreek (胡芦巴)",
        "risk_level": "moderate",
        "drug_classes": ["diabetes", "insulin", "anticoagulant", "warfarin"],
        "guidance": "Fenugreek may lower blood sugar and has mild blood-thinning effects. "
                    "Use with caution alongside diabetes and anticoagulant medications.",
    },
    "valerian": {
        "display_name": "Valerian (缬草)",
        "risk_level": "moderate",
        "drug_classes": ["sedative", "benzodiazepine", "barbiturate", "antidepressant", "alcohol",
                         "anaesthetic"],
        "guidance": "Valerian increases sedation when combined with benzodiazepines, barbiturates, "
                    "or alcohol. Discontinue 2 weeks before surgery due to anaesthesia interactions.",
    },
    "ginger": {
        "display_name": "Ginger (生姜)",
        "risk_level": "moderate",
        "drug_classes": ["warfarin", "anticoagulant", "antiplatelet", "diabetes", "blood pressure"],
        "guidance": "Concentrated ginger supplements may increase bleeding risk with blood thinners "
                    "and enhance effects of diabetes and blood pressure medications.",
    },
    "hawthorn": {
        "display_name": "Hawthorn Berry (山楂)",
        "risk_level": "moderate",
        "drug_classes": ["digoxin", "blood pressure", "antihypertensive", "beta blocker",
                         "calcium channel blocker", "nitrate"],
        "guidance": "Hawthorn may enhance the effects of heart medications including digoxin and "
                    "blood pressure drugs, causing dangerous drops in blood pressure.",
    },
    "cordyceps": {
        "display_name": "Cordyceps (冬虫夏草)",
        "risk_level": "moderate",
        "drug_classes": ["immunosuppressant", "cyclosporine", "anticoagulant", "diabetes"],
        "guidance": "Cordyceps may stimulate the immune system (counteracting immunosuppressants) "
                    "and has mild blood-thinning and blood-sugar-lowering effects.",
    },
    # ── LOW RISK ──
    "green tea": {
        "display_name": "Green Tea (绿茶)",
        "risk_level": "low",
        "drug_classes": ["warfarin", "anticoagulant"],
        "guidance": "Green tea contains vitamin K which may reduce warfarin effectiveness. "
                    "Moderate intake is usually fine.",
    },
    "chamomile": {
        "display_name": "Chamomile (洋甘菊)",
        "risk_level": "low",
        "drug_classes": ["warfarin", "anticoagulant", "sedative", "benzodiazepine"],
        "guidance": "Chamomile may mildly increase effects of blood thinners and sedatives.",
    },
    "echinacea": {
        "display_name": "Echinacea (紫锥花)",
        "risk_level": "low",
        "drug_classes": ["immunosuppressant", "cyclosporine"],
        "guidance": "Echinacea may reduce effectiveness of immunosuppressant drugs.",
    },
    "chrysanthemum": {
        "display_name": "Chrysanthemum (菊花)",
        "risk_level": "low",
        "drug_classes": ["blood pressure", "antihypertensive"],
        "guidance": "Chrysanthemum tea may mildly lower blood pressure. "
                    "Generally safe but mention it to your doctor if on BP meds.",
    },
    "red date": {
        "display_name": "Red Date / Jujube (红枣)",
        "risk_level": "low",
        "drug_classes": ["sedative", "diabetes"],
        "guidance": "Red dates may mildly enhance sedation and slightly affect blood sugar. "
                    "Generally considered very safe in normal food amounts.",
    },
    "lemongrass": {
        "display_name": "Lemongrass (香茅)",
        "risk_level": "low",
        "drug_classes": ["diuretic", "blood pressure"],
        "guidance": "Lemongrass has mild diuretic effects. Generally safe but inform your doctor "
                    "if taking diuretics or blood pressure medications.",
    },
    "peppermint": {
        "display_name": "Peppermint (薄荷)",
        "risk_level": "low",
        "drug_classes": ["antacid", "cyclosporine", "diabetes"],
        "guidance": "Peppermint oil may interact with antacids and cyclosporine. "
                    "Generally safe as tea but concentrated oil capsules need more care.",
    },
    "lotus seed": {
        "display_name": "Lotus Seed (莲子)",
        "risk_level": "low",
        "drug_classes": ["diabetes"],
        "guidance": "Lotus seeds may have mild blood-sugar-lowering effects. "
                    "Safe in normal dietary amounts.",
    },
}

# Common OCR aliases and alternate names
HERB_ALIASES: Dict[str, str] = {
    # Ginkgo
    "gingko": "ginkgo", "gingko biloba": "ginkgo", "ginkgo biloba": "ginkgo",
    "bai guo": "ginkgo", "白果": "ginkgo",
    # Lingzhi / Reishi
    "reishi": "lingzhi", "ling zhi": "lingzhi", "ganoderma": "lingzhi",
    "ganoderma lucidum": "lingzhi", "灵芝": "lingzhi",
    # Danshen
    "red sage": "danshen", "dan shen": "danshen", "salvia miltiorrhiza": "danshen",
    "丹参": "danshen",
    # Dong Quai
    "dong gui": "dong quai", "angelica sinensis": "dong quai",
    "dang gui": "dong quai", "当归": "dong quai",
    # Ginseng
    "ren shen": "ginseng", "panax ginseng": "ginseng", "panax": "ginseng",
    "american ginseng": "ginseng", "xi yang shen": "ginseng", "人参": "ginseng",
    # Licorice
    "gan cao": "licorice", "glycyrrhiza": "licorice", "glycyrrhiza glabra": "licorice",
    "甘草": "licorice",
    # St John's Wort
    "st johns wort": "st john's wort", "st. john's wort": "st john's wort",
    "hypericum": "st john's wort", "hypericum perforatum": "st john's wort",
    # Ma Huang / Ephedra
    "ephedra": "ma huang", "ephedra sinica": "ma huang", "麻黄": "ma huang",
    # Aconite
    "fu zi": "aconite", "monkshood": "aconite", "wolfsbane": "aconite",
    "aconitum": "aconite", "附子": "aconite",
    # Kava
    "kava kava": "kava", "piper methysticum": "kava",
    # Goji
    "goji": "goji berry", "wolfberry": "goji berry", "gou qi": "goji berry",
    "gou qi zi": "goji berry", "lycium": "goji berry", "枸杞": "goji berry",
    # Astragalus
    "huang qi": "astragalus", "astragalus membranaceus": "astragalus", "黄芪": "astragalus",
    # Cinnamon
    "rou gui": "cinnamon", "cassia": "cinnamon", "cinnamomum": "cinnamon", "肉桂": "cinnamon",
    # Evening Primrose
    "evening primrose oil": "evening primrose", "epo": "evening primrose",
    # Saw Palmetto
    "serenoa repens": "saw palmetto", "sabal palm": "saw palmetto",
    # Milk Thistle
    "silybum": "milk thistle", "silymarin": "milk thistle",
    # Bitter Melon
    "bitter gourd": "bitter melon", "momordica": "bitter melon",
    "momordica charantia": "bitter melon", "苦瓜": "bitter melon",
    # Fenugreek
    "trigonella": "fenugreek", "hu lu ba": "fenugreek",
    # Valerian
    "valeriana": "valerian", "valeriana officinalis": "valerian",
    # Ginger
    "sheng jiang": "ginger", "zingiber": "ginger", "生姜": "ginger",
    # Hawthorn
    "shan zha": "hawthorn", "crataegus": "hawthorn", "山楂": "hawthorn",
    # Cordyceps
    "dong chong xia cao": "cordyceps", "caterpillar fungus": "cordyceps",
    "冬虫夏草": "cordyceps", "虫草": "cordyceps",
    # Chrysanthemum
    "ju hua": "chrysanthemum", "菊花": "chrysanthemum",
    # Red Date
    "jujube": "red date", "da zao": "red date", "ziziphus": "red date",
    "红枣": "red date", "大枣": "red date",
    # Lemongrass
    "cymbopogon": "lemongrass", "香茅": "lemongrass",
    # Peppermint
    "bo he": "peppermint", "mentha": "peppermint", "薄荷": "peppermint",
    # Lotus Seed
    "lian zi": "lotus seed", "nelumbo": "lotus seed", "莲子": "lotus seed",
    # Turmeric
    "curcumin": "turmeric", "curcuma": "turmeric", "jiang huang": "turmeric", "姜黄": "turmeric",
    # Garlic
    "da suan": "garlic", "allium sativum": "garlic", "大蒜": "garlic",
    # Green Tea
    "camellia sinensis": "green tea", "绿茶": "green tea", "matcha": "green tea",
    # Chamomile
    "matricaria": "chamomile", "洋甘菊": "chamomile",
    # Echinacea
    "purple coneflower": "echinacea",
}


def extract_text_from_image(image_bytes: bytes) -> str:
    """Extract text from image using OCR (pytesseract)."""
    try:
        from PIL import Image
        import pytesseract
    except ImportError:
        return "[OCR unavailable – pytesseract or pillow not installed]"

    try:
        img = Image.open(io.BytesIO(image_bytes))
        text = pytesseract.image_to_string(img, lang="eng+chi_sim")
        return text.strip()
    except Exception as e:
        return f"[OCR error: {e}]"


def _meralion_normalize_herb(raw_text: str) -> Optional[str]:
    """Use MERaLiON to identify and normalize a TCM herb name from raw OCR text."""
    known_herbs = ", ".join(
        f"{k} ({v['display_name']})" for k, v in HERB_INTERACTIONS.items()
    )
    prompt = (
        "You are a TCM (Traditional Chinese Medicine) expert. "
        "Given the following text extracted from a product label or image, "
        "identify the TCM herb or supplement name.\n\n"
        "Known herbs in our database:\n"
        f"{known_herbs}\n\n"
        "Rules:\n"
        "1) Return ONLY the simple English herb name (e.g. 'ginseng', 'ginkgo', 'danshen').\n"
        "2) If the text contains a Chinese herb name, translate it to its English equivalent.\n"
        "3) If you cannot identify any herb, return exactly: UNKNOWN\n"
        "4) Do NOT add any explanation, just the herb name or UNKNOWN.\n\n"
        f"Text from image: {raw_text}\n\n"
        "Identified herb:"
    )
    client = MeralionClient()
    if not client.enabled:
        return None
    try:
        reply = client.chat(prompt, hyperparameters={"temperature": 0.1, "topP": 0.9})
        cleaned = reply.strip().lower().strip("\"'.,!? ")
        if not cleaned or "unknown" in cleaned:
            return None
        return cleaned
    except MeralionClientError:
        return None


def identify_herb_from_image(image_bytes: bytes) -> Dict[str, Any]:
    """Identify a herb from an image. Tries Vision LLM → CLIP → OCR → MERaLiON."""
    import logging
    _log = logging.getLogger(__name__)

    # ── Step 1: Vision LLM (GPT-4o-mini) ──
    try:
        from app.services.vision_llm import analyze_herb_image, is_vision_available
        if is_vision_available():
            vision_result = analyze_herb_image(image_bytes)
            if vision_result and vision_result.get("herb_name"):
                herb_name = vision_result["herb_name"]
                extracted = vision_result.get("extracted_text") or ""
                confidence = vision_result.get("confidence", "medium")
                reasoning = vision_result.get("reasoning", "")

                # Try to match against our interaction database
                herb_key = detect_herb_from_text(herb_name)
                display = HERB_INTERACTIONS[herb_key]["display_name"] if herb_key and herb_key in HERB_INTERACTIONS else herb_name

                return {
                    "extracted_text": extracted if extracted else f"[Vision AI: {reasoning}]",
                    "identified_herb": display,
                    "herb_key": herb_key,
                    "confidence": confidence,
                    "source": "vision_llm",
                }
    except Exception as exc:
        _log.warning("Vision LLM unavailable: %s", exc)

    # ── Step 2: CLIP zero-shot image classification ──
    try:
        from app.services.herb_classifier import classify_herb_image
        clip_result = classify_herb_image(image_bytes)
        if clip_result:
            herb_key, confidence = clip_result
            if herb_key in HERB_INTERACTIONS:
                return {
                    "extracted_text": f"[CLIP vision: {confidence:.0%} confidence]",
                    "identified_herb": HERB_INTERACTIONS[herb_key]["display_name"],
                    "herb_key": herb_key,
                    "confidence": "medium" if confidence > 0.4 else "low",
                    "source": "clip_vision",
                }
    except Exception as exc:
        _log.warning("CLIP classifier unavailable: %s", exc)

    # ── Step 3: OCR text extraction + local fuzzy matching ──
    extracted_text = extract_text_from_image(image_bytes)

    local_match = detect_herb_from_text(extracted_text)
    if local_match and local_match in HERB_INTERACTIONS:
        return {
            "extracted_text": extracted_text,
            "identified_herb": HERB_INTERACTIONS[local_match]["display_name"],
            "herb_key": local_match,
            "confidence": "medium",
            "source": "ocr_match",
        }

    # ── Step 4: MERaLiON text normalization ──
    meralion_herb = _meralion_normalize_herb(extracted_text)
    if meralion_herb:
        herb_key = detect_herb_from_text(meralion_herb)
        if herb_key and herb_key in HERB_INTERACTIONS:
            return {
                "extracted_text": extracted_text,
                "identified_herb": HERB_INTERACTIONS[herb_key]["display_name"],
                "herb_key": herb_key,
                "confidence": "medium",
                "source": "meralion",
            }
        # MERaLiON identified something not in our DB — still return it
        return {
            "extracted_text": extracted_text,
            "identified_herb": meralion_herb.title(),
            "herb_key": None,
            "confidence": "low",
            "source": "meralion",
        }

    # ── Step 5: Could not identify ──
    return {
        "extracted_text": extracted_text,
        "identified_herb": None,
        "herb_key": None,
        "confidence": None,
        "source": "unidentified",
    }


def detect_herb_from_text(text: str) -> Optional[str]:
    """Try to detect a known herb name from OCR or user text."""
    lower = text.lower().strip()

    # Direct match
    if lower in HERB_INTERACTIONS:
        return lower

    # Alias match
    if lower in HERB_ALIASES:
        return HERB_ALIASES[lower]

    # Substring search
    for alias, canonical in HERB_ALIASES.items():
        if alias in lower:
            return canonical
    for herb_key in HERB_INTERACTIONS:
        if herb_key in lower:
            return herb_key
        display = HERB_INTERACTIONS[herb_key]["display_name"].lower()
        if any(part in lower for part in display.split() if len(part) > 2):
            return herb_key

    # Fuzzy match — catches typos like "ginsng", "ginko", "tumeric"
    all_names = list(HERB_INTERACTIONS.keys()) + list(HERB_ALIASES.keys())
    close = difflib.get_close_matches(lower, all_names, n=1, cutoff=0.6)
    if close:
        match = close[0]
        return HERB_ALIASES.get(match, match)

    return None


# ── Singlish Fallback Templates ──
_SINGLISH_TCM_TEMPLATES = {
    "high": (
        "Ah, thank you for checking ah. This one {herb} can be quite serious when taken with certain medicine. "
        "{guidance} "
        "Please do check with your doctor first before taking, okay? Better to be safe lah."
    ),
    "moderate": (
        "Good that you checked! This {herb} one, need to be a bit careful lah. "
        "{guidance} "
        "If you're not sure, best to ask your doctor or pharmacist, they can advise you properly."
    ),
    "low": (
        "Don't worry too much ah, this {herb} is generally quite safe one. "
        "{guidance} "
        "But still good to let your doctor know you're taking it, just to be sure!"
    ),
    "unknown": (
        "Hmm, sorry ah, I cannot find this herb in my database leh. "
        "No worries, you can check with your doctor or pharmacist — they will know best!"
    ),
}


def _build_singlish_tcm_prompt(herb_name: str, guidance: str, risk_level: str, flagged: List[str]) -> str:
    flagged_str = ", ".join(flagged) if flagged else "none"
    return (
        "You are ByteCare, a friendly and polite medication safety assistant in Singapore. "
        "Rephrase the following herb-drug interaction warning in warm, respectful Singlish "
        "(use lah, ah, leh gently — do NOT use harsh words like aiyoh or wah). "
        "Rules: "
        "1) Keep all the medical facts accurate — do NOT change the medical meaning. "
        "2) Be concise (2-3 sentences). "
        "3) Sound like a kind, respectful caregiver speaking to an elderly person. "
        "4) Use simple English suitable for elderly Singaporean users. "
        "5) Always encourage them to check with their doctor. "
        "6) If there are flagged medications, mention them gently.\n\n"
        f"Herb: {herb_name}\n"
        f"Risk level: {risk_level}\n"
        f"Flagged medications: {flagged_str}\n"
        f"Original guidance: {guidance}\n\n"
        "Singlish reply:"
    )


def _singlish_tcm_message(herb_name: str, guidance: str, risk_level: str, flagged: List[str]) -> str:
    """Rephrase TCM guidance in Singlish via MERaLiON, with rule-based fallback."""
    client = MeralionClient()
    if client.enabled:
        prompt = _build_singlish_tcm_prompt(herb_name, guidance, risk_level, flagged)
        try:
            reply = client.chat(prompt, hyperparameters={"temperature": 0.4, "topP": 0.9})
            if reply and len(reply.strip()) > 10:
                return reply.strip()
        except MeralionClientError:
            pass

    # Rule-based Singlish fallback
    template = _SINGLISH_TCM_TEMPLATES.get(risk_level, _SINGLISH_TCM_TEMPLATES["unknown"])
    return template.format(herb=herb_name, guidance=guidance)


def _get_user_medications(user_id: str) -> List[str]:
    """Get list of medication names for a user."""
    with SessionLocal() as db:
        meds = db.query(Medication).filter_by(user_id=user_id).all()
        return [m.name.lower() for m in meds]


def _check_medication_overlap(herb_key: str, med_names: List[str]) -> List[str]:
    """Check if any of the user's medications match the herb's risk drug classes."""
    info = HERB_INTERACTIONS.get(herb_key)
    if not info:
        return []
    drug_classes = info["drug_classes"]
    flagged = []
    for med in med_names:
        med_lower = med.lower()
        for drug_class in drug_classes:
            if drug_class in med_lower:
                flagged.append(med)
                break
    return flagged


def check_tcm_interactions(user_id: str, herb: str) -> Dict[str, Any]:
    """Check a herb interaction warning against the patient's medications."""
    with SessionLocal() as db:
        user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    herb_key = detect_herb_from_text(herb)
    med_names = _get_user_medications(user_id)

    if not herb_key or herb_key not in HERB_INTERACTIONS:
        no_data_msg = f"No known interaction data for '{herb}' in our database."
        return {
            "interaction_warning": False,
            "herb_detected": herb.strip(),
            "risk_level": "unknown",
            "flagged_medications": [],
            "message": no_data_msg,
            "singlish_message": _singlish_tcm_message(herb.strip(), no_data_msg, "unknown", []),
        }

    info = HERB_INTERACTIONS[herb_key]
    flagged = _check_medication_overlap(herb_key, med_names)
    warning = bool(flagged) or info["risk_level"] in ("high", "moderate")

    return {
        "interaction_warning": warning,
        "herb_detected": info["display_name"],
        "risk_level": info["risk_level"],
        "flagged_medications": flagged,
        "message": info["guidance"],
        "singlish_message": _singlish_tcm_message(
            info["display_name"], info["guidance"], info["risk_level"], flagged
        ),
    }


def check_tcm_from_image(user_id: str, image_bytes: bytes) -> Dict[str, Any]:
    """Run OCR on image, detect herb, then check interactions."""
    with SessionLocal() as db:
        user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    extracted_text = extract_text_from_image(image_bytes)
    herb_key = detect_herb_from_text(extracted_text)

    if not herb_key:
        no_detect_msg = "Could not detect a known herb from the image. Try typing the herb name manually."
        return {
            "extracted_text": extracted_text,
            "interaction_warning": False,
            "herb_detected": None,
            "risk_level": "unknown",
            "flagged_medications": [],
            "message": no_detect_msg,
            "singlish_message": _singlish_tcm_message("this herb", no_detect_msg, "unknown", []),
        }

    info = HERB_INTERACTIONS[herb_key]
    med_names = _get_user_medications(user_id)
    flagged = _check_medication_overlap(herb_key, med_names)

    warning = bool(flagged) or info["risk_level"] in ("high", "moderate")

    return {
        "extracted_text": extracted_text,
        "interaction_warning": warning,
        "herb_detected": info["display_name"],
        "risk_level": info["risk_level"],
        "flagged_medications": flagged,
        "message": info["guidance"],
        "singlish_message": _singlish_tcm_message(
            info["display_name"], info["guidance"], info["risk_level"], flagged
        ),
    }
