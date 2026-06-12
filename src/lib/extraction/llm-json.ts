import OpenAI from "openai";
import {
  getAiProviderPreference,
  isOpenAiConfigured,
} from "@/lib/ai/config";
import { ollamaChatJson } from "@/lib/ai/ollama";
import { EXTRACTION_SYSTEM_PROMPT } from "@/lib/extraction/prompt";

function getOpenAIClient(): OpenAI | null {
  if (!isOpenAiConfigured()) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/** Call Ollama or OpenAI and return raw JSON text from the model. */
export async function callLlmJson(
  userPrompt: string
): Promise<{ content: string; model: string }> {
  const preference = getAiProviderPreference();
  const errors: string[] = [];

  if (preference === "ollama" || preference === "auto") {
    try {
      const { content, model } = await ollamaChatJson(
        EXTRACTION_SYSTEM_PROMPT,
        userPrompt
      );
      return { content, model };
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "Ollama extraction failed"
      );
      if (preference === "ollama") throw new Error(errors.join("; "));
    }
  }

  if (
    (preference === "openai" || preference === "auto") &&
    isOpenAiConfigured()
  ) {
    const client = getOpenAIClient();
    if (client) {
      const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
      const response = await client.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
      });
      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("Empty response from extraction model");
      return { content, model };
    }
  }

  throw new Error(errors.join("; ") || "No AI provider available");
}

export function parseJsonContent(content: string): unknown {
  return JSON.parse(content);
}
