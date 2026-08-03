const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.warn("ANTHROPIC_API_KEY is not set — receipt verification will always fail closed.");
}

interface ReceiptCheckResult {
  matches: boolean;
  reason: string;
}

/**
 * Sends a receipt photo to Claude vision and asks whether it's a genuine purchase
 * receipt from the given brand. Fails closed (matches: false) on any error, missing
 * key, or ambiguous read — this endpoint auto-rejects on anything less than a clear match.
 */
export async function checkReceiptMatchesBrand(
  imageBase64: string,
  mediaType: string,
  brandName: string
): Promise<ReceiptCheckResult> {
  if (!ANTHROPIC_API_KEY) {
    return { matches: false, reason: "Receipt verification is not configured." };
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: imageBase64 },
              },
              {
                type: "text",
                text:
                  `Look at this photo. Is it a genuine purchase receipt (till slip / invoice) ` +
                  `from a store or business belonging to the brand "${brandName}"? ` +
                  `Respond with ONLY a JSON object, no other text, no markdown fences, in exactly this shape: ` +
                  `{"matches": true or false, "reason": "one short sentence"}. ` +
                  `Only answer true if the receipt clearly shows this brand's name/logo and looks like a real receipt. ` +
                  `If it's blurry, cropped, unreadable, a screenshot of something else, or from a different brand, answer false.`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error("Anthropic API error during receipt check:", response.status, errBody);
      return { matches: false, reason: "Could not verify the receipt right now." };
    }

    const data = await response.json();
    const text = (data.content || [])
      .map((block: any) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    const cleaned = text.replace(/^```json\s*|```$/g, "").trim();
    const parsed = JSON.parse(cleaned);

    if (typeof parsed.matches !== "boolean") {
      return { matches: false, reason: "Could not read the receipt clearly." };
    }

    return {
      matches: parsed.matches,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch (err) {
    console.error("Failed to verify receipt via Anthropic API:", err);
    return { matches: false, reason: "Could not verify the receipt right now." };
  }
}