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
        "drug_classes": ["ssri", "antidepressant", "cyclosporine", "warfarin", "contraceptive", "statin"],
        "guidance": "St John's Wort reduces effectiveness of many drugs including antidepressants, "
                    "blood thinners, birth control, and statins. Very high interaction risk.",
    },
    "licorice": {
        "display_name": "Licorice Root (甘草)",
        "risk_level": "moderate",
        "drug_classes": ["diuretic", "blood pressure", "antihypertensive", "digoxin", "corticosteroid"],
        "guidance": "Licorice can raise blood pressure and lower potassium. "
                    "Avoid with blood pressure medications and diuretics.",
    },
    "turmeric": {
        "display_name": "Turmeric (姜黄)",
        "risk_level": "moderate",
        "drug_classes": ["warfarin", "anticoagulant", "antiplatelet", "diabetes"],
        "guidance": "High-dose turmeric may increase bleeding risk with blood thinners "
                    "and enhance effects of diabetes medications.",
    },
    "garlic": {
        "display_name": "Garlic (大蒜)",
        "risk_level": "moderate",
        "drug_classes": ["warfarin", "anticoagulant", "antiplatelet", "hiv"],
        "guidance": "Concentrated garlic supplements may increase bleeding risk with anticoagulants.",
    },
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
    "lingzhi": {
        "display_name": "Lingzhi / Reishi (灵芝)",
        "risk_level": "moderate",
        "drug_classes": ["warfarin", "anticoagulant", "antiplatelet", "blood pressure", "antihypertensive"],
        "guidance": "Lingzhi may enhance blood-thinning effects and lower blood pressure. "
                    "Use with caution alongside anticoagulants or BP meds.",
    },
    "danshen": {
        "display_name": "Danshen / Red Sage (丹参)",
        "risk_level": "high",
        "drug_classes": ["warfarin", "anticoagulant", "antiplatelet", "digoxin"],
        "guidance": "Danshen strongly increases bleeding risk with warfarin and may interfere with digoxin. "
                    "Do not combine without medical supervision.",
    },
}

# Common OCR aliases
HERB_ALIASES: Dict[str, str] = {
    "gingko": "ginkgo",
    "gingko biloba": "ginkgo",
    "ginkgo biloba": "ginkgo",
    "reishi": "lingzhi",
    "red sage": "danshen",
    "dan shen": "danshen",
    "dong gui": "dong quai",
    "angelica sinensis": "dong quai",
    "ren shen": "ginseng",
    "panax ginseng": "ginseng",
    "gan cao": "licorice",
    "glycyrrhiza": "licorice",
    "st johns wort": "st john's wort",
    "st. john's wort": "st john's wort",
    "ling zhi": "lingzhi",
    "ganoderma": "lingzhi",
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
