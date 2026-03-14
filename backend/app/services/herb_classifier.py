"""CLIP-based zero-shot TCM herb image classifier.

Uses OpenAI's CLIP (ViT-B/32) to classify herb images against known TCM herb
labels without any fine-tuning.  The model is lazy-loaded on first call so it
doesn't slow down server startup.
"""

from __future__ import annotations

import io
import logging
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── Label mapping ──
# Descriptive CLIP-friendly prompts → canonical herb key used in tcm_engine.py
HERB_PROMPTS: Dict[str, str] = {
    # HIGH RISK
    "a photo of ginseng root, a traditional Chinese herbal medicine":                      "ginseng",
    "a photo of ginkgo biloba leaves, a herbal supplement":                                "ginkgo",
    "a photo of dong quai angelica sinensis root, a Chinese herb":                         "dong quai",
    "a photo of St John's Wort hypericum perforatum yellow flower":                        "st john's wort",
    "a photo of danshen salvia miltiorrhiza red sage root":                                "danshen",
    "a photo of ma huang ephedra plant stems, Chinese medicine":                           "ma huang",
    "a photo of aconite monkshood fu zi root, traditional Chinese medicine":               "aconite",
    "a photo of kava kava root or kava drink":                                             "kava",
    # MODERATE RISK
    "a photo of licorice root glycyrrhiza glabra, Chinese medicine":                       "licorice",
    "a photo of turmeric curcuma longa root or yellow powder":                             "turmeric",
    "a photo of garlic allium sativum cloves or supplement capsules":                      "garlic",
    "a photo of lingzhi reishi ganoderma mushroom":                                        "lingzhi",
    "a photo of red goji berries wolfberries":                                             "goji berry",
    "a photo of astragalus huang qi root slices, Chinese medicine":                        "astragalus",
    "a photo of cinnamon sticks or cassia bark":                                           "cinnamon",
    "a photo of evening primrose yellow flowers or oil capsules":                          "evening primrose",
    "a photo of saw palmetto berries or supplement":                                       "saw palmetto",
    "a photo of milk thistle purple flower or silymarin supplement":                       "milk thistle",
    "a photo of bitter melon bitter gourd vegetable":                                      "bitter melon",
    "a photo of fenugreek seeds or fenugreek supplement":                                  "fenugreek",
    "a photo of valerian root or valerian supplement":                                     "valerian",
    "a photo of fresh ginger root or dried ginger":                                        "ginger",
    "a photo of hawthorn berries or hawthorn supplement":                                  "hawthorn",
    "a photo of cordyceps caterpillar fungus mushroom":                                    "cordyceps",
    # LOW RISK
    "a photo of green tea camellia sinensis leaves or tea bag":                            "green tea",
    "a photo of chamomile matricaria daisy flowers or chamomile tea":                      "chamomile",
    "a photo of echinacea purple coneflower herbal supplement":                            "echinacea",
    "a photo of chrysanthemum flowers or chrysanthemum tea":                               "chrysanthemum",
    "a photo of red dates jujube dried fruit":                                             "red date",
    "a photo of lemongrass stalks or lemongrass tea":                                      "lemongrass",
    "a photo of peppermint leaves or peppermint tea":                                      "peppermint",
    "a photo of lotus seeds or lotus seed soup":                                           "lotus seed",
    # catch-all so the model has somewhere to put non-herb images
    "a photo of food, pills, a medicine bottle, or unknown objects":                       "__other__",
}

# ── Lazy-loaded singleton ──
_model = None
_processor = None
_device = "cpu"


def _load_model():
    """Load CLIP model and processor once, then cache globally."""
    global _model, _processor
    if _model is not None:
        return _model, _processor

    try:
        from transformers import CLIPModel, CLIPProcessor
    except ImportError:
        raise RuntimeError(
            "transformers and torch are required for herb classification. "
            "Install with: pip install transformers torch --index-url https://download.pytorch.org/whl/cpu"
        )

    model_name = "openai/clip-vit-base-patch32"
    logger.info("Loading CLIP model %s (first call only)…", model_name)
    _processor = CLIPProcessor.from_pretrained(model_name)
    # Use safetensors format to avoid torch.load CVE-2025-32434 restriction
    try:
        _model = CLIPModel.from_pretrained(model_name, use_safetensors=True)
    except Exception:
        _model = CLIPModel.from_pretrained(model_name)
    _model.eval()
    logger.info("CLIP model loaded.")
    return _model, _processor


def classify_herb_image(
    image_bytes: bytes,
    confidence_threshold: float = 0.20,
) -> Optional[Tuple[str, float]]:
    """Classify a herb image using CLIP zero-shot classification.

    Returns (herb_key, confidence) if the best match is above *confidence_threshold*,
    or ``None`` if the image doesn't match any known herb confidently enough.
    """
    import torch
    from PIL import Image

    model, processor = _load_model()

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    labels: List[str] = list(HERB_PROMPTS.keys())

    inputs = processor(text=labels, images=image, return_tensors="pt", padding=True)

    with torch.no_grad():
        outputs = model(**inputs)

    logits = outputs.logits_per_image[0]          # shape: (num_labels,)
    probs = logits.softmax(dim=0)

    best_idx = int(probs.argmax().item())
    best_prob = float(probs[best_idx].item())
    best_label = labels[best_idx]
    herb_key = HERB_PROMPTS[best_label]

    logger.info(
        "CLIP classification: %s (%.1f%%) — threshold %.0f%%",
        herb_key, best_prob * 100, confidence_threshold * 100,
    )

    if herb_key == "__other__" or best_prob < confidence_threshold:
        return None

    return herb_key, best_prob
