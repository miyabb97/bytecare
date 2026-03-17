"""Patient chat response generation service."""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Dict, List
from uuid import uuid4

from fastapi import HTTPException

from app.db import SessionLocal
from app.models import Appointment, ChatMessage, Medication, User
from app.services.agent_engine import determine_next_action
from app.services.drift_engine import detect_adherence_drift
from app.services.food_query_parser import parse_food_query
from app.services.meralion_client import MeralionClient, MeralionClientError
from app.services.nutrition_engine import get_adaptive_nutrition_recommendation


def _rule_based_reply(name: str, message: str, next_action: str) -> str:
    """Generate fallback reply when MERaLiON is unavailable."""
    if next_action == "caregiver_alert":
        return f"{name}, I hear you. Please take your medication now, and I can help alert your caregiver if needed."
    if next_action == "strong_reminder":
        return f"{name}, thanks for sharing. Let us get back on track by taking your medication now."
    if next_action == "patient_nudge":
        return f"{name}, thanks for the update. A gentle reminder to follow your medication schedule today."
    return f"Thanks for sharing, {name}. You are doing well, and I am here to support you."


def _build_prompt(user: Dict[str, Any], message: str, drift: Dict[str, Any], action: Dict[str, Any],
                  medications: list, appointments: list, dose_text: list) -> str:
    """Build structured prompt for MERaLiON chat generation."""
    med_text = "; ".join(f"{m['name']} ({m['dose']})" for m in medications) if medications else "none recorded"
    appt_text = "; ".join(appointments) if appointments else "none upcoming"

    return (
        "You are ByteCare, a caring medication adherence support assistant for older adults in Singapore. "
        "You know everything about this patient — their profile, medications, conditions, and appointments. "
        "Answer the patient's question directly using the context below.\n\n"
        "Safety rules (must follow): "
        "1) Do NOT provide medical diagnosis. "
        "2) Do NOT recommend medication changes (do not start, stop, skip, or change dose/timing). "
        "3) If user asks for diagnosis or medication change, advise them to check with their doctor or pharmacist. "
        "4) Keep response supportive, calm, and concise (2-3 short sentences, max 50 words). "
        "5) Use simple words suitable for elderly users in Singapore. "
        "6) Singlish-friendly phrasing is allowed (light, respectful, optional lah/leh/lor). "
        "7) If the patient asks about their medications, conditions, or appointments, answer using the context below. "
        "8) If the patient greets you, reply warmly and briefly.\n\n"
        "Output rules: "
        "Return only the patient-facing reply text. "
        "Do not output JSON. "
        "Do not include internal reasoning.\n\n"
        f"User profile: name={user.get('name','Patient')}, age={user.get('age')}, timezone={user.get('timezone')}\n"
        f"Conditions: {', '.join(user.get('conditions', [])) or 'none'}\n"
        f"Current medications: {med_text}\n"
        f"Upcoming appointments: {appt_text}\n"
        f"Adherence: drift_detected={drift.get('drift_detected')}, severity={drift.get('severity')}, trigger={drift.get('trigger')}\n"
        f"Recommended next action: {action.get('next_action')}\n\n"
        f"Patient message: {message}\n"
        "Tone: warm, respectful, encouraging, not patronizing."
    )


def _normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value).lower()).strip()


def _extract_conditions(nutrition_result: Dict[str, Any]) -> List[str]:
    raw = str(nutrition_result.get("condition") or "").strip()
    if not raw or raw == "general_wellness":
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def _human_join(items: List[str], conjunction: str = "or") -> str:
    cleaned = [str(item).strip() for item in items if str(item).strip()]
    if not cleaned:
        return ""
    if len(cleaned) == 1:
        return cleaned[0]
    if len(cleaned) == 2:
        return f"{cleaned[0]} {conjunction} {cleaned[1]}"
    return f"{', '.join(cleaned[:-1])}, {conjunction} {cleaned[-1]}"


def _condition_caution_phrase(conditions: List[str]) -> str:
    condition_set = {_normalize_text(item) for item in conditions}
    if "diabetes" in condition_set and "hypertension" in condition_set:
        return "since you are managing blood sugar and blood pressure"
    if "diabetes" in condition_set:
        return "since you are managing diabetes"
    if "hypertension" in condition_set:
        return "since you are managing blood pressure"
    return ""


def _build_food_quick_replies(parsed_food: Dict[str, Any], nutrition_result: Dict[str, Any]) -> List[str]:
    food_query = str(parsed_food.get("food_query") or "").strip()
    conditions = {_normalize_text(item) for item in _extract_conditions(nutrition_result)}
    recommendation_level = str(nutrition_result.get("recommendation_level") or "").strip()

    if food_query:
        if "diabetes" in conditions:
            return ["Suggest healthier snacks", "Show lower-sugar choices", "Check another food"]
        if "hypertension" in conditions:
            return ["Suggest lower-salt options", "What can I eat today?", "Check another food"]
        if recommendation_level in {"avoid", "caution"}:
            return ["Suggest safer alternatives", "What can I eat today?", "Check another food"]
        return ["Suggest a lighter option", "What can I eat today?", "Check another food"]

    if "diabetes" in conditions:
        return ["Suggest dinner ideas", "Show lower-sugar choices", "Check another food"]
    if "hypertension" in conditions:
        return ["Suggest dinner ideas", "Show lower-salt choices", "Check another food"]
    return ["Suggest dinner ideas", "Show healthier alternatives", "Check another food"]


def _build_general_quick_replies(intent: str) -> List[str]:
    """Build quick reply suggestions. Only used for food-related intents."""
    return []


def build_safe_patient_reply(intent: str, context: Dict[str, Any], recommendation: Dict[str, Any]) -> str:
    if intent != "food_advice":
        return str(recommendation.get("explanation") or recommendation.get("warning_message") or "").strip()

    food_query = str(context.get("food_query") or "").strip()
    warning_message = str(recommendation.get("warning_message") or "").strip()
    recommendation_level = str(recommendation.get("recommendation_level") or "").strip()
    interaction_warning = bool(recommendation.get("interaction_warning"))
    recommended_foods = [
        str(item).strip()
        for item in (recommendation.get("recommended_foods") or recommendation.get("recommendations") or [])
        if str(item).strip()
    ]
    conditions = _extract_conditions(recommendation)
    caution_phrase = _condition_caution_phrase(conditions)

    if food_query:
        acknowledge = f"Thanks for checking about {food_query}."
    else:
        acknowledge = "Thanks for checking before you eat."

    if interaction_warning and warning_message:
        warning_parts = [part.strip() for part in re.split(r"[.?!]\s*", warning_message) if part.strip()]
        guidance = f"{warning_parts[0]}." if warning_parts else warning_message
    elif recommendation_level == "avoid":
        if food_query and caution_phrase:
            guidance = f"It is better to be careful with {food_query} {caution_phrase}."
        elif food_query:
            guidance = f"It is better to be careful with {food_query} today."
        else:
            guidance = "It is better to be careful with richer or riskier foods today."
    elif recommendation_level == "caution":
        if food_query and caution_phrase:
            guidance = f"A small portion may be better than a regular serving for {food_query} {caution_phrase}."
        elif food_query:
            guidance = f"A small portion may be better than a regular serving for {food_query} today."
        else:
            guidance = "A lighter choice may be better than a richer meal today."
    elif recommendation_level == "generally_ok":
        if food_query:
            guidance = f"There is no direct medicine-food conflict in today's rules for {food_query}, but moderate portions are still the safer choice."
        else:
            guidance = "There is no direct medicine-food conflict in today's rules, but moderate portions are still the safer choice."
    else:
        guidance = "This looks like a safer choice for today, but keeping portions sensible is still a good idea."

    alternatives = ""
    if recommended_foods:
        alternatives = f"You could consider {_human_join(recommended_foods[:3])} instead."
    elif recommendation_level in {"avoid", "caution"} and food_query:
        alternatives = f"If you still feel like having something similar, a smaller portion or a lighter version may be better than the usual one."

    quick_replies = _build_food_quick_replies(context, recommendation)
    if quick_replies:
        follow_up = f"Would you like me to {quick_replies[0].lower()}, or shall I {quick_replies[-1].lower()}?"
    else:
        follow_up = "Would you like me to suggest a safer option for today?"

    sentences = [acknowledge, guidance]
    if alternatives:
        sentences.append(alternatives)
    sentences.append(follow_up)
    return " ".join(sentence.strip() for sentence in sentences[:4] if sentence.strip())


def _build_food_chat_reply(message: str, parsed_food: Dict[str, Any], nutrition_result: Dict[str, Any]) -> str:
    return build_safe_patient_reply(
        "food_advice",
        {"food_query": parsed_food.get("food_query"), "message": message},
        nutrition_result,
    )


def _localize_food_chat_reply(message: str, parsed_food: Dict[str, Any], nutrition_result: Dict[str, Any]) -> str:
    fallback = _build_food_chat_reply(message, parsed_food, nutrition_result)
    client = MeralionClient()
    if not client.enabled:
        return fallback

    facts = {
        "original_message": message,
        "food_query": parsed_food.get("food_query"),
        "recommendation_level": nutrition_result.get("recommendation_level"),
        "interaction_warning": nutrition_result.get("interaction_warning"),
        "warning_message": nutrition_result.get("warning_message"),
        "recommended_foods": nutrition_result.get("recommended_foods") or nutrition_result.get("recommendations") or [],
        "avoid_foods": nutrition_result.get("avoid_foods") or [],
        "condition": nutrition_result.get("condition"),
        "base_reply": fallback,
        "medications_taken_today": nutrition_result.get("medications_taken_today") or [],
        "reasoning": nutrition_result.get("reasoning") or [],
    }

    prompt = (
        "You are ByteCare, replying to an elderly patient in Singapore who asked a food question.\n"
        "Rewrite the deterministic nutrition result into a short, safe, supportive chat reply.\n\n"
        "Rules:\n"
        "1. Use only the facts provided.\n"
        "2. Do not invent food-drug interactions or medical advice.\n"
        "3. Keep it to 4 short sentences or fewer.\n"
        "4. Follow this order when appropriate: acknowledge the question, give safe guidance, offer better alternatives, ask one simple follow-up.\n"
        "5. Do not sound overly permissive. Avoid phrases like 'no worries' or 'yes, can eat'. Use careful wording like 'better to be careful', 'a small portion may be better', or 'you may want to limit'.\n"
        "6. Make it sound local and natural for Singapore English; light Singlish is okay.\n"
        "7. Keep it concise, warm, and readable for an older patient.\n"
        "8. Return plain text only.\n\n"
        f"FACTS_JSON:\n{json.dumps(facts, ensure_ascii=True)}"
    )

    try:
        localized = client.chat(prompt, hyperparameters={"temperature": 0.25, "topP": 0.9}).strip()
        return localized or fallback
    except MeralionClientError:
        return fallback


def generate_patient_reply(user_id: str, message: str, language: str = "en") -> Dict[str, Any]:
    """Generate a short patient-facing chat reply using the Conversation Care Agent."""
    with SessionLocal() as db:
        if not db.query(User).filter_by(user_id=user_id).first():
            raise HTTPException(status_code=404, detail="User not found")

    # Also fetch drift/action for context response (kept for frontend compatibility)
    try:
        drift = detect_adherence_drift(user_id)
        action = determine_next_action(user_id)
    except Exception:
        drift = {"drift_detected": False, "severity": "green"}
        action = {"next_action": "none"}

    parsed_food = parse_food_query(message)
    quick_replies: List[str] = []
    if parsed_food.get("is_food_query"):
        nutrition_result = get_adaptive_nutrition_recommendation(
            user_id=user_id,
            food_query=parsed_food.get("food_query"),
        )
        reply = _localize_food_chat_reply(message, parsed_food, nutrition_result)
        quick_replies = _build_food_quick_replies(parsed_food, nutrition_result)
        context = {
            "drift_detected": drift["drift_detected"],
            "severity": drift["severity"],
            "next_action": action["next_action"],
            "suggested_action": "none",
            "intent": "food_advice",
            "food_query": parsed_food.get("food_query"),
            "recommendation_level": nutrition_result.get("recommendation_level"),
            "reminder_mode": None,
            "reminder_delay_seconds": None,
            "navigation": None,
        }
    else:
        # Route through the Conversation Care Agent for intent detection + reply generation
        from app.agents.conversation_agent import generate_agent_response
        agent_result = generate_agent_response(user_id, message)
        reply = agent_result["reply"]
        quick_replies = _build_general_quick_replies(str(agent_result.get("intent") or ""))
        navigation = agent_result.get("navigation")

        # If agent detected a reminder intent, persist the reminder preference
        if agent_result["suggested_action"] == "set_reminder":
            try:
                reminder_mode = agent_result.get("reminder_mode")
                if reminder_mode == "timer" and agent_result.get("reminder_delay_seconds"):
                    from app.agents.reminder_agent import schedule_quick_reminder
                    schedule_quick_reminder(user_id, int(agent_result["reminder_delay_seconds"]))
                else:
                    from app.agents.reminder_agent import set_medication_reminder
                    set_medication_reminder(user_id, None, offset_minutes=10)
            except Exception:
                pass  # non-fatal — reply still delivered

        context = {
            "drift_detected": drift["drift_detected"],
            "severity": drift["severity"],
            "next_action": action["next_action"],
            "suggested_action": agent_result["suggested_action"],
            "intent": agent_result["intent"],
            "reminder_mode": agent_result.get("reminder_mode"),
            "reminder_delay_seconds": agent_result.get("reminder_delay_seconds"),
            "navigation": navigation,
        }

    # Translate if a non-English language is requested
    reply_en = reply
    final_reply = reply
    final_lang = "en"

    if language and language != "en":
        try:
            from app.services.voice_engine import translate_text
            translated = translate_text(reply, language)
            final_reply = translated
            final_lang = language
        except Exception:
            pass

    # Persist user message and assistant reply
    now_str = datetime.now().isoformat(timespec="seconds")
    with SessionLocal() as db:
        db.add(ChatMessage(
            message_id=str(uuid4()),
            user_id=user_id,
            role="user",
            content=message,
            language=language or "en",
            is_read=1,
            created_at=now_str,
        ))
        db.add(ChatMessage(
            message_id=str(uuid4()),
            user_id=user_id,
            role="assistant",
            content=final_reply,
            language=final_lang,
            is_read=1,
            created_at=now_str,
        ))
        # Mark system messages as read since user is actively in chat
        db.query(ChatMessage).filter_by(user_id=user_id, role="system", is_read=0).update({"is_read": 1})
        db.commit()

    result = {
        "reply": final_reply,
        "context": context,
        "language": final_lang,
    }
    if quick_replies:
        translated_quick_replies = quick_replies
        if final_lang != "en":
            try:
                from app.services.voice_engine import translate_text
                translated_quick_replies = [translate_text(item, final_lang) for item in quick_replies]
            except Exception:
                translated_quick_replies = quick_replies
        result["quick_replies"] = translated_quick_replies
    if final_lang != "en":
        result["reply_en"] = reply_en
    return result
